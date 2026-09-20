//! Proton runtime: run the real `nie.exe` on Linux, as a direct child of this process.
//!
//! # Why this module exists
//!
//! [`crate::lancement`] starts the game with a bare `Command::new(exe)`. That is correct on a
//! native Windows host, where `nie.exe` is executable. On Linux it cannot work: the PE needs an
//! interpreter, and the only supported one is the Proton shipped **with the game** under
//! `<game>/files` — it carries DXVK and vkd3d-proton, which the distribution Wine does not.
//!
//! Until now that whole chain lived in three shell scripts outside the binary
//! (`scripts/nie-wine-setup.sh`, `scripts/nie-wine-run.sh`, `scripts/boot-nie-direct.sh`).
//! Every constant below is transcribed from them; each one was paid for with a measured failure,
//! and the scripts' own comments record why.
//!
//! # The reason it belongs in this crate, and not next to the downloader
//!
//! Under `kernel.yama.ptrace_scope=1`, `process_vm_readv(2)` is permitted only against a
//! **descendant** of the calling process. A shell script that launches the game makes the *shell*
//! the ancestor, so `niers mem` only works when it is started from that same shell. When the
//! process that launches the game is the one that later reads its memory, the permission holds by
//! construction — no `CAP_SYS_PTRACE`, no `setcap`, and therefore no disturbance of the Vulkan
//! environment. See [`crate::wine_memory::likely_permitted`].
//!
//! # What this module does *not* do
//!
//! It does not start Xvfb or a window manager, and it does not neutralise EAC. [`doctor`] reports
//! those as prerequisites so a caller can tell which one is missing; [`crate::patch_eac`] handles
//! the second on an explicit copy.

use std::collections::BTreeMap;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::Duration;

use thiserror::Error;

/// Steam application id of Inazuma Eleven: Victory Road.
///
/// Duplicated from `nie_steam::IEVR_STEAM_APP_ID` on purpose: this crate depends on nothing but
/// `thiserror`, and taking the whole Steam downloader as a dependency to read one integer would
/// make the memory reader depend on a network stack.
pub const IEVR_STEAM_APP_ID: u32 = 2_799_860;

/// Process name the game reports to Linux once Proton has mapped it.
///
/// Wine does not virtualise: it loads the PE into the Linux address space of the same process and
/// renames it, so `/proc/<pid>/comm` reads exactly this. `comm` is truncated by the kernel to 15
/// characters, which this name is well under.
pub const GAME_COMM: &str = "nie.exe";

/// Default Wine virtual-desktop size, matching `NIE_RES` in the shell scripts.
pub const DEFAULT_RESOLUTION: &str = "1920x1080";

/// An environment variable's value, treating "exported but empty" as absent.
///
/// This is the shell's `${VAR:-default}`, which `std::env::var` does not reproduce.
fn non_empty(key: &str) -> Option<String> {
    match std::env::var(key) {
        Ok(v) if !v.is_empty() => Some(v),
        _ => None,
    }
}

/// Same, for a path — kept on `OsString` so a non-UTF-8 path survives.
fn non_empty_path(key: &str) -> Option<PathBuf> {
    let v = std::env::var_os(key)?;
    if v.is_empty() {
        None
    } else {
        Some(PathBuf::from(v))
    }
}

/// Anything that stops the game from being launched.
#[derive(Debug, Error)]
pub enum ProtonError {
    /// The game directory does not hold the Proton runtime.
    ///
    /// This means the download is incomplete. It does **not** mean the distribution Wine should
    /// be used instead: it ships neither DXVK nor vkd3d-proton, and the game fails to start on
    /// a missing `D3DCOMPILER_47.dll` rather than on anything that names the real cause.
    #[error("Proton's wine is missing at {0} — the Steam download is incomplete")]
    WineMissing(PathBuf),

    /// The located `wine` is present but carries no executable bit.
    #[error("{0} is not executable")]
    WineNotExecutable(PathBuf),

    /// The executable to run was not found.
    #[error("executable not found: {0}")]
    ExeMissing(PathBuf),

    /// The Proton runtime carries no `default_pfx` to copy the prefix from.
    #[error("Proton's default prefix is missing at {0}")]
    DefaultPrefixMissing(PathBuf),

    /// The source tree recursed past [`MAX_PREFIX_DEPTH`], which means a symlink cycle.
    #[error("{0} is nested too deeply — the source tree has a symlink cycle")]
    PrefixTooDeep(PathBuf),

    /// Any filesystem or spawn failure, with the path it happened on.
    #[error("{context}: {source}")]
    Io {
        /// What was being attempted.
        context: String,
        /// The underlying error.
        #[source]
        source: std::io::Error,
    },
}

impl ProtonError {
    fn io(context: impl Into<String>, source: std::io::Error) -> Self {
        Self::Io {
            context: context.into(),
            source,
        }
    }
}

/// Every path the runtime uses, resolved once.
///
/// The defaults are those of the shell scripts, so a caller that sets none of the environment
/// variables lands on the same tree the scripts already built.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Layout {
    /// Root of the Steam install (`NIE_GAME_PATH`), holding `files/` and `data/`.
    pub game_dir: PathBuf,
    /// Root of the niers runtime area (`NIE_RUNTIME_BASE`): prefix, logs, shader cache.
    pub runtime_base: PathBuf,
    /// `STEAM_COMPAT_DATA_PATH` — the directory *containing* `pfx`, not `pfx` itself.
    pub compat_data: PathBuf,
    /// The Wine prefix (`WINEPREFIX`).
    pub prefix: PathBuf,
    /// Where Wine, DXVK and the launcher write their logs.
    pub logs: PathBuf,
    /// DXVK's shader cache.
    pub dxvk_cache: PathBuf,
    /// X display to run on (`NIE_DISPLAY`).
    pub display: String,
    /// Size of the Wine virtual desktop (`NIE_RES`), e.g. `1920x1080`.
    ///
    /// Not cosmetic. Xvfb reports a refresh rate of **zero** (`xrandr` shows 0.00Hz, dotclock 0),
    /// DXVK divides by that rate, and the game dies on "Unhandled division by zero" inside dxgi
    /// before the first frame. Wine's virtual desktop supplies its own display mode, which is the
    /// only known way around it — Xvfb rejects `xrandr --newmode`.
    pub resolution: String,
}

impl Layout {
    /// Resolve the layout from the environment, falling back to the scripts' defaults.
    ///
    /// A variable exported **empty** falls back, exactly like the scripts' `${VAR:-default}`.
    /// `std::env::var` would hand back `Ok("")` instead, and an empty `NIE_GAME_PATH` — which a
    /// wrapper produces whenever it re-exports something itself unset — would resolve `files/bin/
    /// wine` against the current directory and be reported as "the Steam download is incomplete".
    /// That is a wrong diagnosis for a wrong variable, so the emptiness is handled here.
    #[must_use]
    pub fn from_env() -> Self {
        let home = non_empty_path("HOME").unwrap_or_else(|| PathBuf::from("/"));
        let game_dir = non_empty_path("NIE_GAME_PATH")
            .unwrap_or_else(|| home.join(".local/share/Steam/iecode/inazuma"));
        let runtime_base = non_empty_path("NIE_RUNTIME_BASE")
            .unwrap_or_else(|| home.join(".local/share/niers/runtime"));
        // `NIE_DISPLAY` wins over `DISPLAY` on purpose: it is the one `nie-wine-setup.sh` brings
        // up with Xvfb. Over SSH with X forwarding both are set, and rendering the game into the
        // forwarded display would push every frame over the network.
        let display = non_empty("NIE_DISPLAY")
            .or_else(|| non_empty("DISPLAY"))
            .unwrap_or_else(|| ":99".to_owned());
        let mut layout = Self::rooted(game_dir, runtime_base, display);
        if let Some(res) = non_empty("NIE_RES") {
            layout.resolution = res;
        }
        layout
    }

    /// Build a layout from explicit roots.
    ///
    /// Tests use this rather than [`Layout::from_env`]: since edition 2024 `std::env::set_var` is
    /// `unsafe`, and a test that mutates the process environment is racy against every other test
    /// in the binary anyway.
    #[must_use]
    pub fn rooted(game_dir: PathBuf, runtime_base: PathBuf, display: String) -> Self {
        let compat_data = runtime_base.join("proton-prefix");
        let prefix = compat_data.join("pfx");
        let logs = runtime_base.join("logs");
        let dxvk_cache = runtime_base.join("dxvk-cache");
        Self {
            game_dir,
            runtime_base,
            compat_data,
            prefix,
            logs,
            dxvk_cache,
            display,
            resolution: DEFAULT_RESOLUTION.to_owned(),
        }
    }

    /// The Proton tree shipped with the game.
    #[must_use]
    pub fn proton_files(&self) -> PathBuf {
        self.game_dir.join("files")
    }

    /// The Unix socket the X server listens on for [`Layout::display`].
    ///
    /// Derived rather than probed: checking that `:99` is up otherwise needs an X client library,
    /// and this crate deliberately has no dependency beyond `thiserror`.
    #[must_use]
    pub fn x11_socket(&self) -> Option<PathBuf> {
        let n = self.display.trim().strip_prefix(':')?;
        let n = n.split('.').next()?;
        if n.is_empty() || !n.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        Some(PathBuf::from(format!("/tmp/.X11-unix/X{n}")))
    }

    /// Create the directories the launcher writes into.
    ///
    /// Only logs and the shader cache: creating the prefix is [`prepare_prefix`]'s job, and
    /// creating the game directory would hide a wrong `NIE_GAME_PATH` behind an empty tree.
    pub fn ensure_writable_dirs(&self) -> Result<(), ProtonError> {
        for dir in [&self.logs, &self.dxvk_cache] {
            fs::create_dir_all(dir)
                .map_err(|e| ProtonError::io(format!("creating {}", dir.display()), e))?;
        }
        Ok(())
    }
}

/// A located, usable Proton runtime.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Runtime {
    /// `<game>/files`.
    pub files: PathBuf,
    /// `<game>/files/bin/wine`.
    pub wine: PathBuf,
}

impl Runtime {
    /// Locate Proton inside the game directory, and check it can actually be run.
    ///
    /// Fails loudly when it is absent. That failure means the download has not finished — the
    /// scripts make the same point, because the tempting fix (install the distribution Wine)
    /// produces a game that starts and then dies without a usable renderer.
    pub fn locate(layout: &Layout) -> Result<Self, ProtonError> {
        let files = layout.proton_files();
        let wine = files.join("bin/wine");
        if !wine.is_file() {
            return Err(ProtonError::WineMissing(wine));
        }
        if !is_executable(&wine) {
            return Err(ProtonError::WineNotExecutable(wine));
        }
        Ok(Self { files, wine })
    }

    /// The two native library directories Proton's wine needs on `LD_LIBRARY_PATH`.
    #[must_use]
    pub fn library_dirs(&self) -> [PathBuf; 2] {
        [
            self.files.join("lib/x86_64-linux-gnu"),
            self.files.join("lib/i386-linux-gnu"),
        ]
    }

    /// Proton's pristine prefix, the only correct source for a new one.
    #[must_use]
    pub fn default_prefix(&self) -> PathBuf {
        self.files.join("share/default_pfx")
    }
}

/// Name of a running window manager, if one is up.
///
/// Scans `/proc/<pid>/comm`, the same mechanism [`crate::find_pid_by_name`] uses, so it needs no
/// X client library. It cannot tell which display the manager owns — a second, unrelated X
/// session would satisfy it — but the failure it guards against (no WM at all) is the one that
/// actually happens on a headless host.
#[must_use]
pub fn running_window_manager() -> Option<String> {
    const KNOWN: [&str; 5] = ["openbox", "i3", "mutter", "xfwm4", "kwin_x11"];
    let dir = fs::read_dir("/proc").ok()?;
    for entry in dir.flatten() {
        let name = entry.file_name();
        let Some(s) = name.to_str() else { continue };
        if s.parse::<i32>().is_err() {
            continue;
        }
        let Ok(comm) = fs::read_to_string(format!("/proc/{s}/comm")) else {
            continue;
        };
        let comm = comm.trim();
        if KNOWN.contains(&comm) {
            return Some(comm.to_owned());
        }
    }
    None
}

/// `true` when the file carries an executable bit for anyone.
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt as _;
    fs::metadata(path).is_ok_and(|m| m.permissions().mode() & 0o111 != 0)
}

/// Read an environment variable, or fall back to a default.
///
/// Mirrors the scripts' `${VAR:-default}`: a variable set to the empty string does **not** win,
/// which matters for `WINEDLLOVERRIDES`, where an empty value would silently disable every
/// override rather than apply the defaults.
fn or_env(key: &str, fallback: &str) -> String {
    match std::env::var(key) {
        Ok(v) if !v.is_empty() => v,
        _ => fallback.to_owned(),
    }
}

/// The complete environment the game is launched with, sorted by key.
///
/// Transcribed from `scripts/nie-wine-run.sh` and `scripts/boot-nie-direct.sh`. The groups, and
/// what each one is there to prevent:
///
/// - **Wine/prefix** — `WINEPREFIX`, `WINEARCH`, `LD_LIBRARY_PATH`. Without the two native library
///   directories Proton's wine does not resolve its own `.so` files.
/// - **Software rendering** — this VPS exposes no GPU, so Vulkan comes from lavapipe. Pinning the
///   ICD *and* the device name keeps DXVK from selecting something that is not there.
/// - **DLL overrides** — DXVK's `d3d11`/`dxgi`/`d3d10core`/`d3d9` are copied into the prefix as
///   native; NVAPI is forced builtin and disabled, because the game probes it and lavapipe cannot
///   answer.
/// - **Steam compat** — Proton's own launcher requires these even in `runinprefix`, and
///   `SteamAppId` is read by the game itself.
///
/// Every value honours an already-set variable, so a caller can override one without rebuilding
/// the list.
#[must_use]
pub fn launch_env(layout: &Layout, runtime: &Runtime) -> Vec<(OsString, OsString)> {
    let mut env: BTreeMap<String, String> = BTreeMap::new();

    // ── Wine and its prefix ───────────────────────────────────────────────────────────────
    env.insert(
        "WINEPREFIX".to_owned(),
        layout.prefix.to_string_lossy().into_owned(),
    );
    env.insert("WINEARCH".to_owned(), "win64".to_owned());
    env.insert("WINEESYNC".to_owned(), "1".to_owned());
    env.insert("WINEFSYNC".to_owned(), "1".to_owned());
    env.insert(
        "WINEDEBUG".to_owned(),
        or_env("WINEDEBUG", "fixme-all,err+module"),
    );
    env.insert("DISPLAY".to_owned(), layout.display.clone());

    let mut ld = runtime
        .library_dirs()
        .iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join(":");
    if let Ok(existing) = std::env::var("LD_LIBRARY_PATH")
        && !existing.is_empty()
    {
        ld.push(':');
        ld.push_str(&existing);
    }
    env.insert("LD_LIBRARY_PATH".to_owned(), ld);

    // ── Software rendering through lavapipe ───────────────────────────────────────────────
    const LVP_ICD: &str = "/usr/share/vulkan/icd.d/lvp_icd.json";
    env.insert("VK_DRIVER_FILES".to_owned(), LVP_ICD.to_owned());
    env.insert("VK_ICD_FILENAMES".to_owned(), LVP_ICD.to_owned());
    env.insert("DXVK_FILTER_DEVICE_NAME".to_owned(), "llvmpipe".to_owned());
    env.insert("MESA_VK_DEVICE_SELECT".to_owned(), "llvmpipe".to_owned());
    env.insert("LP_NUM_THREADS".to_owned(), or_env("LP_NUM_THREADS", "10"));

    // ── DXVK ──────────────────────────────────────────────────────────────────────────────
    env.insert(
        "DXVK_STATE_CACHE_PATH".to_owned(),
        layout.dxvk_cache.to_string_lossy().into_owned(),
    );
    env.insert(
        "DXVK_LOG_PATH".to_owned(),
        layout.logs.to_string_lossy().into_owned(),
    );
    env.insert(
        "DXVK_LOG_LEVEL".to_owned(),
        or_env("DXVK_LOG_LEVEL", "info"),
    );
    env.insert("DXVK_ENABLE_NVAPI".to_owned(), "0".to_owned());
    env.insert(
        "WINEDLLOVERRIDES".to_owned(),
        or_env(
            "WINEDLLOVERRIDES",
            "d3d11,dxgi,d3d10core,d3d9=n;nvapi64,nvapi=b;winemenubuilder.exe=d",
        ),
    );

    // ── Steam compatibility ───────────────────────────────────────────────────────────────
    let app = IEVR_STEAM_APP_ID.to_string();
    env.insert(
        "STEAM_COMPAT_DATA_PATH".to_owned(),
        layout.compat_data.to_string_lossy().into_owned(),
    );
    env.insert(
        "STEAM_COMPAT_CLIENT_INSTALL_PATH".to_owned(),
        layout
            .runtime_base
            .join("steam-client")
            .to_string_lossy()
            .into_owned(),
    );
    env.insert(
        "STEAM_COMPAT_INSTALL_PATH".to_owned(),
        layout.game_dir.to_string_lossy().into_owned(),
    );
    env.insert(
        "STEAM_COMPAT_LIBRARY_PATHS".to_owned(),
        layout.game_dir.to_string_lossy().into_owned(),
    );
    env.insert("STEAM_COMPAT_APP_ID".to_owned(), app.clone());
    env.insert("SteamAppId".to_owned(), app.clone());
    env.insert("SteamGameId".to_owned(), app);
    env.insert("PROTON_DISABLE_NVAPI".to_owned(), "1".to_owned());
    env.insert("PROTON_HIDE_NVIDIA_GPU".to_owned(), "1".to_owned());
    env.insert("PROTON_NO_EAC_RUNTIME".to_owned(), "1".to_owned());

    env.into_iter()
        .map(|(k, v)| (OsString::from(k), OsString::from(v)))
        .collect()
}

/// Build the command that runs `exe` under Proton, without spawning it.
///
/// The working directory is the game root on purpose: `nie.exe` performs relative loads
/// (`locale/`, `data/`) very early, and a wrong one leaves a global table NULL, which surfaces as
/// a `0xC0000005` during init rather than as a missing file.
pub fn command(
    layout: &Layout,
    runtime: &Runtime,
    exe: &Path,
    args: &[String],
    desktop: Option<&str>,
) -> Result<Command, ProtonError> {
    if !exe.is_file() {
        return Err(ProtonError::ExeMissing(exe.to_path_buf()));
    }
    let mut cmd = Command::new(&runtime.wine);
    // `explorer /desktop=` is prepended HERE rather than left to the caller, so the `is_file`
    // guard above keeps applying to the real executable: `explorer` is a Wine builtin with no
    // file on disk, and letting a caller pass it as `exe` would have made the guard reject the
    // only invocation that works.
    if let Some(res) = desktop {
        cmd.arg("explorer");
        cmd.arg(format!("/desktop=nie,{res}"));
    }
    cmd.arg(exe);
    cmd.args(args);
    cmd.current_dir(&layout.game_dir);
    for (k, v) in launch_env(layout, runtime) {
        cmd.env(k, v);
    }
    Ok(cmd)
}

/// What a launch produced.
#[derive(Debug)]
pub struct Launch {
    /// The `wine` process this crate spawned.
    ///
    /// Held rather than dropped. Dropping a [`Child`] does **not** detach it on Unix — it only
    /// throws away the handle, so nothing can ever `wait()` it and its exit status is lost. Two
    /// very different outcomes then look identical: a game that died in 200 ms on a missing DLL,
    /// and a game still loading when the timeout expired. Keeping the handle also keeps the
    /// caller in the parent role that `process_vm_readv` requires.
    pub child: Child,
    /// PID of the game itself, once it answers a memory read. `None` on timeout.
    ///
    /// It is normally the same process: Wine maps the PE into the address space of the process it
    /// renames to `nie.exe`. It is read back rather than assumed, because Proton's wrapper chain
    /// may re-exec, and an assumed PID that turns out to be the wrapper reads as an empty game.
    pub game_pid: Option<i32>,
    /// Where the launcher's own output went. One file per run, never overwritten.
    pub log: PathBuf,
}

impl Launch {
    /// PID of the spawned `wine` process.
    #[must_use]
    pub fn launcher_pid(&self) -> u32 {
        self.child.id()
    }

    /// Whether the launcher has already exited, and with what status.
    ///
    /// `None` means it is still running. Call this when [`Launch::game_pid`] is `None` — it is
    /// what separates "died on startup" from "slower than the timeout".
    pub fn exited(&mut self) -> Option<std::process::ExitStatus> {
        self.child.try_wait().ok().flatten()
    }
}

/// Launch the game and wait until its memory is readable.
///
/// The spawned process is a **direct child** of the caller, which is what makes
/// `process_vm_readv(2)` permitted under `kernel.yama.ptrace_scope=1`. A caller that spawns the
/// game and then exits loses that property along with the process tree.
///
/// Waiting is delegated to [`crate::lancement::attendre_process`], which probes until the process
/// exists **and** answers a read — a process that has just started has no mapped module yet, and
/// every read against it fails.
pub fn launch_and_wait(
    layout: &Layout,
    runtime: &Runtime,
    exe: &Path,
    wait: Duration,
    desktop: Option<&str>,
) -> Result<Launch, ProtonError> {
    layout.ensure_writable_dirs()?;

    // One log per run, like `boot-nie-direct.sh`'s `direct-$TS.log`. A fixed name with
    // `File::create` truncates, so every retry would destroy the evidence of the failure being
    // retried — the opposite of what a launcher is for.
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    let log = layout.logs.join(format!("proton-launch-{stamp}.log"));
    let sink = fs::File::create(&log)
        .map_err(|e| ProtonError::io(format!("creating {}", log.display()), e))?;
    let errsink = sink
        .try_clone()
        .map_err(|e| ProtonError::io(format!("duplicating {}", log.display()), e))?;

    let mut cmd = command(layout, runtime, exe, &[], desktop)?;
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::from(sink));
    cmd.stderr(Stdio::from(errsink));

    let child: Child = cmd
        .spawn()
        .map_err(|e| ProtonError::io(format!("spawning {}", runtime.wine.display()), e))?;

    let game_pid = crate::lancement::attendre_process(GAME_COMM, wait);
    Ok(Launch {
        child,
        game_pid,
        log,
    })
}

/// One prerequisite, and whether this machine satisfies it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Check {
    /// Stable identifier, safe to match on.
    pub name: &'static str,
    /// Whether the prerequisite is met.
    pub ok: bool,
    /// What was actually measured — a path, a value, or why it failed.
    pub detail: String,
}

impl Check {
    fn new(name: &'static str, ok: bool, detail: impl Into<String>) -> Self {
        Self {
            name,
            ok,
            detail: detail.into(),
        }
    }

    fn path(name: &'static str, p: &Path, ok: bool) -> Self {
        Self::new(name, ok, p.display().to_string())
    }
}

/// Measure every prerequisite, and say which one is missing.
///
/// Returns a report rather than an error: a caller wants to know *which* step to run, and the
/// first failure is rarely the only one. Nothing here starts, writes or repairs anything.
#[must_use]
pub fn doctor(layout: &Layout) -> Vec<Check> {
    // `vec![]` plutôt que `Vec::new()` suivi d'un `push` : `clippy::vec_init_then_push` est dans
    // le groupe `perf`, que ce workspace garde en `warn`, et la CI lance clippy avec
    // `-D warnings`.
    let mut out = vec![Check::path(
        "game_dir",
        &layout.game_dir,
        layout.game_dir.is_dir(),
    )];

    let cpk = layout.game_dir.join("data/cpk_list.cfg.bin");
    out.push(Check::path("vfs_index", &cpk, cpk.is_file()));

    let wine = layout.proton_files().join("bin/wine");
    out.push(Check::new(
        "proton_wine",
        wine.is_file() && is_executable(&wine),
        wine.display().to_string(),
    ));

    let default_pfx = layout.proton_files().join("share/default_pfx");
    out.push(Check::path(
        "proton_default_prefix",
        &default_pfx,
        default_pfx.is_dir(),
    ));

    out.push(Check::path(
        "prefix",
        &layout.prefix,
        layout.prefix.is_dir(),
    ));

    // The sentinel `nie-wine-setup.sh` itself uses to decide the prefix is complete: a prefix
    // built by `wineboot` on an empty directory lacks it, and the d3dcompiler_47 import then
    // fails with a message that names the wrong library.
    let vkd3d = vkd3d_sentinel(layout);
    out.push(Check::path("prefix_vkd3d", &vkd3d, vkd3d.is_file()));

    for (name, link) in [
        ("dosdevice_c", layout.prefix.join("dosdevices/c:")),
        ("dosdevice_z", layout.prefix.join("dosdevices/z:")),
    ] {
        out.push(Check::new(
            name,
            fs::symlink_metadata(&link).is_ok(),
            link.display().to_string(),
        ));
    }

    match layout.x11_socket() {
        Some(sock) => out.push(Check::new(
            "x_display",
            fs::symlink_metadata(&sock).is_ok(),
            format!("{} -> {}", layout.display, sock.display()),
        )),
        None => out.push(Check::new(
            "x_display",
            false,
            format!("unparsable display {:?}", layout.display),
        )),
    }

    // A bare Xvfb is not enough, and the X socket alone cannot tell you so. The setup script is
    // explicit: without a window manager the game stops receiving mouse events after a few
    // seconds. Probing `_NET_SUPPORTING_WM_CHECK` would need an X client library; the presence of
    // the process does not, which is why it is measured this way.
    let wm = running_window_manager();
    out.push(Check::new(
        "window_manager",
        wm.is_some(),
        wm.map_or_else(
            || "none found (openbox, i3, mutter, xfwm4, kwin_x11)".to_owned(),
            |n| format!("{n} running"),
        ),
    ));

    out.push(Check::new(
        "virtual_desktop",
        true,
        format!(
            "explorer /desktop=nie,{} — required under Xvfb (0 Hz refresh)",
            layout.resolution
        ),
    ));

    let scope = crate::wine_memory::read_ptrace_scope();
    out.push(Check::new(
        "ptrace_scope",
        scope <= 1,
        match scope {
            -1 => "unreadable (/proc/sys/kernel/yama/ptrace_scope)".to_owned(),
            0 => "0 — unrestricted".to_owned(),
            1 => "1 — descendants only, satisfied by launching the game from here".to_owned(),
            n => format!("{n} — process memory cannot be read"),
        },
    ));

    out
}

/// Create the Wine prefix from Proton's pristine one, and make it usable.
///
/// Port of `scripts/nie-wine-setup.sh`, minus the parts that need an X server. Idempotent: an
/// existing prefix is left alone unless `recreate` is set, and the symlinks and DLL copies are
/// re-applied every time.
///
/// Three things here are not obvious, and each was a failure before it was a line of code:
///
/// 1. The copy must **dereference** symlinks. `default_pfx` is a tree of *relative* links into
///    `files/lib/wine`; copied verbatim they all dangle, and the prefix silently loses
///    `libvkd3d-*.dll`.
/// 2. `default_pfx` ships no `dosdevices`. Without `c:` and `z:`, Wine cannot find `kernel32.dll`.
/// 3. DXVK and vkd3d-proton are copied **into** the prefix rather than overridden in place,
///    because the override list names them as native.
///
/// Unlike the script, this never runs `rm -rf` implicitly: replacing a prefix is destructive and
/// has to be asked for.
pub fn prepare_prefix(
    layout: &Layout,
    runtime: &Runtime,
    recreate: bool,
) -> Result<(), ProtonError> {
    let default_pfx = runtime.default_prefix();
    if !default_pfx.is_dir() {
        return Err(ProtonError::DefaultPrefixMissing(default_pfx));
    }

    // Gate on the CONTENTS, not on the directory. `nie-wine-setup.sh` tests for the vkd3d DLL for
    // a reason: a prefix left by a `wineboot` on an empty directory, or by an interrupted copy,
    // exists while missing `libvkd3d-{1,shader-1,utils-1}.dll` — and then the `d3dcompiler_47`
    // import fails with "Library D3DCOMPILER_47.dll not found" and the game never starts. Gating
    // on `exists()` would accept that prefix forever and force the caller to guess `recreate`,
    // which also destroys a healthy one.
    let rebuild = recreate || !prefix_is_complete(layout);

    if rebuild {
        if layout.prefix.exists() {
            fs::remove_dir_all(&layout.prefix)
                .map_err(|e| ProtonError::io(format!("removing {}", layout.prefix.display()), e))?;
        }
        if let Some(parent) = layout.prefix.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| ProtonError::io(format!("creating {}", parent.display()), e))?;
        }
        copy_dereferenced(&default_pfx, &layout.prefix)?;
    }

    apply_dosdevices(layout)?;
    copy_graphics_dlls(layout, runtime)?;
    wineboot(layout, runtime);
    Ok(())
}

/// Path of the DLL whose presence means the prefix was built from `default_pfx` by value.
#[must_use]
pub fn vkd3d_sentinel(layout: &Layout) -> PathBuf {
    layout
        .prefix
        .join("drive_c/windows/system32/libvkd3d-1.dll")
}

/// Whether the prefix looks like a complete, dereferenced copy of `default_pfx`.
#[must_use]
pub fn prefix_is_complete(layout: &Layout) -> bool {
    vkd3d_sentinel(layout).is_file()
}

/// Run `wineboot -u`, best effort.
///
/// Step 4 of `nie-wine-setup.sh`, and it cannot be skipped: `default_pfx` is Proton's skeleton,
/// whose profile is `drive_c/users/steamuser`. `wineboot -u` replays `wine.inf`, re-syncs
/// `system.reg`/`user.reg` against the running Wine build, and creates `drive_c/users/$USER`
/// with its Desktop/Documents/AppData entries. Without it the game's first settings or save write
/// resolves `%USERPROFILE%` to a directory nothing created and fails with `ERROR_PATH_NOT_FOUND`.
///
/// Failure is swallowed, exactly as the script's `|| true` does: a prefix that cannot be booted
/// is still worth handing to the caller, who will see the real error when the game runs.
fn wineboot(layout: &Layout, runtime: &Runtime) {
    let Ok(mut cmd) = wineboot_command(layout, runtime) else {
        return;
    };
    let _ = cmd.status();
}

/// The `wineboot -u` invocation, separated so it can be inspected without being run.
fn wineboot_command(layout: &Layout, runtime: &Runtime) -> Result<Command, ProtonError> {
    let mut cmd = Command::new(&runtime.wine);
    cmd.args(["wineboot", "-u"]);
    cmd.current_dir(&layout.game_dir);
    for (k, v) in launch_env(layout, runtime) {
        cmd.env(k, v);
    }
    // The script silences Wine here; a registry replay is noisy and says nothing useful.
    cmd.env("WINEDEBUG", "-all");
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::null());
    cmd.stderr(Stdio::null());
    Ok(cmd)
}

/// Depth beyond which the source tree is assumed to contain a symlink cycle.
///
/// `cp -L` detects cycles and stops. Following `metadata` blindly does not: a directory symlink
/// pointing at one of its own ancestors recurses until the stack or the disk gives out.
const MAX_PREFIX_DEPTH: usize = 64;

/// Recursive copy that follows symlinks, the equivalent of `cp -aL`.
///
/// A link whose target cannot be resolved is a **hard error**, not a skip. GNU `cp -L` behaves the
/// same way — it `stat`s the target, gets `ENOENT`, and exits non-zero — and the script runs under
/// `set -euo pipefail`, so the whole setup stops there. Skipping instead would turn a loud, total
/// failure into a prefix quietly missing one DLL, found hours later as an obscure loader error.
fn copy_dereferenced(src: &Path, dst: &Path) -> Result<(), ProtonError> {
    copy_dereferenced_at(src, dst, 0)
}

fn copy_dereferenced_at(src: &Path, dst: &Path, depth: usize) -> Result<(), ProtonError> {
    if depth > MAX_PREFIX_DEPTH {
        return Err(ProtonError::PrefixTooDeep(src.to_path_buf()));
    }
    fs::create_dir_all(dst)
        .map_err(|e| ProtonError::io(format!("creating {}", dst.display()), e))?;
    let entries =
        fs::read_dir(src).map_err(|e| ProtonError::io(format!("reading {}", src.display()), e))?;
    for entry in entries {
        let entry = entry.map_err(|e| ProtonError::io(format!("reading {}", src.display()), e))?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        // `metadata` follows symlinks — that is exactly the `-L` in `cp -aL`. Its failure is
        // reported rather than swallowed, so a link broken by a Proton update surfaces here,
        // naming the file, instead of at game start, naming nothing.
        let meta = fs::metadata(&from).map_err(|e| {
            ProtonError::io(format!("resolving {} (broken symlink?)", from.display()), e)
        })?;
        if meta.is_dir() {
            copy_dereferenced_at(&from, &to, depth + 1)?;
        } else {
            fs::copy(&from, &to).map_err(|e| {
                ProtonError::io(format!("copying {} to {}", from.display(), to.display()), e)
            })?;
        }
    }
    Ok(())
}

/// Point `c:` at the prefix's own `drive_c`, and `z:` at the host root.
fn apply_dosdevices(layout: &Layout) -> Result<(), ProtonError> {
    use std::os::unix::fs::symlink;

    let dir = layout.prefix.join("dosdevices");
    fs::create_dir_all(&dir)
        .map_err(|e| ProtonError::io(format!("creating {}", dir.display()), e))?;
    for (link, target) in [("c:", Path::new("../drive_c")), ("z:", Path::new("/"))] {
        let path = dir.join(link);
        // Replace rather than fail: the link may point at a previous prefix location.
        if fs::symlink_metadata(&path).is_ok() {
            fs::remove_file(&path)
                .map_err(|e| ProtonError::io(format!("removing {}", path.display()), e))?;
        }
        symlink(target, &path)
            .map_err(|e| ProtonError::io(format!("linking {}", path.display()), e))?;
    }
    Ok(())
}

/// Copy DXVK and vkd3d-proton into the prefix, both architectures.
fn copy_graphics_dlls(layout: &Layout, runtime: &Runtime) -> Result<(), ProtonError> {
    let system32 = layout.prefix.join("drive_c/windows/system32");
    let syswow64 = layout.prefix.join("drive_c/windows/syswow64");
    for dir in [&system32, &syswow64] {
        fs::create_dir_all(dir)
            .map_err(|e| ProtonError::io(format!("creating {}", dir.display()), e))?;
    }

    for name in ["d3d11", "dxgi", "d3d10core", "d3d9"] {
        let file = format!("{name}.dll");
        for (arch, dest) in [("x86_64-windows", &system32), ("i386-windows", &syswow64)] {
            let from = runtime.files.join("lib/wine/dxvk").join(arch).join(&file);
            if from.is_file() {
                let to = dest.join(&file);
                fs::copy(&from, &to).map_err(|e| {
                    ProtonError::io(format!("copying {} to {}", from.display(), to.display()), e)
                })?;
            }
        }
    }

    let vkd3d = runtime.files.join("lib/wine/vkd3d-proton/x86_64-windows");
    if let Ok(entries) = fs::read_dir(&vkd3d) {
        for entry in entries.flatten() {
            let from = entry.path();
            if from
                .extension()
                .is_some_and(|e| e.eq_ignore_ascii_case("dll"))
            {
                let to = system32.join(entry.file_name());
                fs::copy(&from, &to).map_err(|e| {
                    ProtonError::io(format!("copying {} to {}", from.display(), to.display()), e)
                })?;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn layout() -> Layout {
        Layout::rooted(
            PathBuf::from("/games/inazuma"),
            PathBuf::from("/run/niers"),
            ":99".to_owned(),
        )
    }

    #[test]
    fn the_prefix_sits_inside_the_compat_data_directory() {
        // STEAM_COMPAT_DATA_PATH names the parent, WINEPREFIX the `pfx` inside it. Passing the
        // same path for both is the classic way to get a prefix Proton refuses to reuse.
        let l = layout();
        assert_eq!(l.compat_data, PathBuf::from("/run/niers/proton-prefix"));
        assert_eq!(l.prefix, PathBuf::from("/run/niers/proton-prefix/pfx"));
        assert_eq!(l.prefix.parent(), Some(l.compat_data.as_path()));
    }

    #[test]
    fn a_display_maps_to_its_x11_socket() {
        assert_eq!(
            layout().x11_socket(),
            Some(PathBuf::from("/tmp/.X11-unix/X99"))
        );
        let with_screen =
            Layout::rooted(PathBuf::from("/g"), PathBuf::from("/r"), ":7.0".to_owned());
        assert_eq!(
            with_screen.x11_socket(),
            Some(PathBuf::from("/tmp/.X11-unix/X7"))
        );
    }

    #[test]
    fn a_remote_display_has_no_local_socket() {
        // `host:0` is a TCP display: there is no `/tmp/.X11-unix` entry to look for, and
        // inventing one would report a missing display that is in fact reachable.
        for d in ["localhost:0", "", ":", ":abc"] {
            let l = Layout::rooted(PathBuf::from("/g"), PathBuf::from("/r"), d.to_owned());
            assert_eq!(l.x11_socket(), None, "display {d:?}");
        }
    }

    #[test]
    fn the_launch_environment_carries_the_prefix_the_layout_names() {
        let l = layout();
        let r = Runtime {
            files: PathBuf::from("/games/inazuma/files"),
            wine: PathBuf::from("/games/inazuma/files/bin/wine"),
        };
        let env: BTreeMap<_, _> = launch_env(&l, &r).into_iter().collect();

        assert_eq!(
            env.get(&OsString::from("WINEPREFIX")),
            Some(&OsString::from("/run/niers/proton-prefix/pfx"))
        );
        assert_eq!(
            env.get(&OsString::from("STEAM_COMPAT_DATA_PATH")),
            Some(&OsString::from("/run/niers/proton-prefix"))
        );
        // The game reads this one itself; it is not only Proton bookkeeping.
        assert_eq!(
            env.get(&OsString::from("SteamAppId")),
            Some(&OsString::from("2799860"))
        );
    }

    #[test]
    fn the_native_library_path_names_both_architectures() {
        let r = Runtime {
            files: PathBuf::from("/games/inazuma/files"),
            wine: PathBuf::from("/games/inazuma/files/bin/wine"),
        };
        let dirs = r.library_dirs();
        assert!(dirs[0].ends_with("lib/x86_64-linux-gnu"));
        assert!(dirs[1].ends_with("lib/i386-linux-gnu"));

        let env: BTreeMap<_, _> = launch_env(&layout(), &r).into_iter().collect();
        let ld = env
            .get(&OsString::from("LD_LIBRARY_PATH"))
            .expect("LD_LIBRARY_PATH is always set")
            .to_string_lossy()
            .into_owned();
        assert!(ld.contains("lib/x86_64-linux-gnu"), "{ld}");
        assert!(ld.contains("lib/i386-linux-gnu"), "{ld}");
    }

    #[test]
    fn locating_proton_in_an_empty_tree_names_the_download_not_the_distro_wine() {
        let l = Layout::rooted(
            PathBuf::from("/nonexistent-game-root"),
            PathBuf::from("/run/niers"),
            ":99".to_owned(),
        );
        let err = Runtime::locate(&l).expect_err("no Proton under a path that does not exist");
        assert!(matches!(err, ProtonError::WineMissing(_)), "{err:?}");
    }

    /// A hand-built `Runtime`: `locate` needs a real Proton on disk, which a test cannot assume.
    /// The fields are public for exactly this.
    fn runtime() -> Runtime {
        Runtime {
            files: PathBuf::from("/games/inazuma/files"),
            wine: PathBuf::from("/games/inazuma/files/bin/wine"),
        }
    }

    #[test]
    fn the_virtual_desktop_comes_before_the_executable() {
        // The order `nie-wine-setup.sh` prescribes:
        //   wine explorer /desktop=nie,WxH <exe>
        // Reversed, `/desktop=` becomes an argument of the game, silently ignored — and the game
        // dies in dxgi on Xvfb's zero refresh rate.
        let exe = std::env::current_exe().expect("the test binary is a real file");
        let cmd =
            command(&layout(), &runtime(), &exe, &[], Some("1280x720")).expect("the exe exists");
        let args: Vec<_> = cmd
            .get_args()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        assert_eq!(args[0], "explorer");
        assert_eq!(args[1], "/desktop=nie,1280x720");
        assert_eq!(args[2], exe.to_string_lossy());
    }

    #[test]
    fn without_a_virtual_desktop_the_executable_is_the_first_argument() {
        let exe = std::env::current_exe().expect("the test binary is a real file");
        let cmd = command(&layout(), &runtime(), &exe, &[], None).expect("the exe exists");
        let args: Vec<_> = cmd
            .get_args()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        assert_eq!(args.len(), 1);
        assert_eq!(args[0], exe.to_string_lossy());
    }

    #[test]
    fn a_missing_executable_is_refused_before_anything_is_launched() {
        let err = command(
            &layout(),
            &runtime(),
            Path::new("/nonexistent/nie.exe"),
            &[],
            None,
        )
        .expect_err("a missing executable cannot be launched");
        assert!(matches!(err, ProtonError::ExeMissing(_)), "{err:?}");
    }

    #[test]
    fn prefix_completeness_is_judged_on_the_vkd3d_dll_not_on_the_directory() {
        // The trap `nie-wine-setup.sh` avoids: a prefix that EXISTS without being complete. Were
        // existence enough, a prefix left by a `wineboot` on an empty directory would be accepted
        // forever, and the d3dcompiler_47 import would fail naming a different library from the
        // one actually missing.
        let l = layout();
        assert!(
            vkd3d_sentinel(&l).ends_with("drive_c/windows/system32/libvkd3d-1.dll"),
            "{}",
            vkd3d_sentinel(&l).display()
        );
        assert!(!prefix_is_complete(&l), "no prefix exists under /run/niers");
    }

    #[test]
    fn the_default_resolution_is_the_one_the_scripts_use() {
        assert_eq!(layout().resolution, DEFAULT_RESOLUTION);
        assert_eq!(DEFAULT_RESOLUTION, "1920x1080");
    }

    #[test]
    fn the_doctor_reports_every_prerequisite_even_when_all_fail() {
        let l = Layout::rooted(
            PathBuf::from("/nonexistent-game-root"),
            PathBuf::from("/nonexistent-runtime"),
            ":99".to_owned(),
        );
        let checks = doctor(&l);
        // A report that stopped at the first failure would hide the other eight.
        let names: Vec<_> = checks.iter().map(|c| c.name).collect();
        for expected in [
            "game_dir",
            "vfs_index",
            "proton_wine",
            "proton_default_prefix",
            "prefix",
            "prefix_vkd3d",
            "dosdevice_c",
            "dosdevice_z",
            "x_display",
            "ptrace_scope",
        ] {
            assert!(names.contains(&expected), "missing check {expected}");
        }
        assert!(
            checks.iter().any(|c| c.name == "game_dir" && !c.ok),
            "a game directory that does not exist must fail its check"
        );
    }
}
