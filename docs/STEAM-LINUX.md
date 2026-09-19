# Steam on Linux

This repository uses `nie-steam` for Steam depot access. It does not automate the
graphical Steam client: it authenticates against Steam's native protocol and writes a
Steam-compatible install tree. A legally owned copy of IEVR is still required.

## Paths

The prepared Linux layout is:

| Purpose | Path |
|---|---|
| Steam client and libraries | `/home/ubuntu/.local/share/Steam` |
| IEVR install root | `/home/ubuntu/.local/share/Steam/iecode/inazuma` |
| niers Steam refresh-token store | `/home/ubuntu/.local/share/niers/steam-tokens.json` |
| Wine/Proton runtime, logs and caches | `/home/ubuntu/.local/share/niers/runtime` |
| Wine prefix | `/home/ubuntu/.local/share/niers/runtime/proton-prefix/pfx` |

The same values are kept in the private files `.env.local` and
`~/.config/niers/steam.env`. Both files must remain mode `0600` and must never be
committed or pasted into logs. The repository ignores `.env` and `.env.local`.

## Inspect, authenticate, and download

Inspect the app and content depot without downloading:

```bash
set -a; . ~/.config/niers/steam.env; set +a
target/debug/nie-steam --depot "$NIE_STEAM_DEPOT" list "$NIE_STEAM_APP_ID"
```

The first credential login may require `STEAM_GUARD_CODE` or mobile confirmation. A
successful login stores a refresh token, so later runs do not need the password:

```bash
set -a; . ~/.config/niers/steam.env; set +a
target/release/nie-steam \
  --depot "$NIE_STEAM_DEPOT" \
  sync -o "$IEVR_GAME_DIR"
```

The download is resumable and verifies existing files by default. Do not pass
`--no-verify` unless a full redownload is intentional. The content depot is `2799861`
for app `2799860`; the constants are defined by `nie-steam`, not by this document.

For the Bun pipeline, the equivalent command is `bun run sync:gamedata`. It uses
`IEVR_GAME_DIR`, `STEAM_TOKEN_STORE`, and the same native Rust downloader.

## Proton and Wine

The system Wine package is only a fallback. The supported path for running the real
Windows binary uses the Proton runtime shipped with the downloaded game under
`$NIE_GAME_PATH/files`.

### The native path: `niers live`

`nie_trace::proton` carries this chain in Rust, so acquisition, execution and memory
reading are one binary rather than three shell scripts:

```bash
niers live env          # every resolved path and the exact launch environment
niers live doctor       # each prerequisite, and which one is missing (non-zero if any)
niers live setup        # build the prefix from Proton's default_pfx
niers live run          # launch nie.exe under Proton, as a child of niers
niers live probe --rva 0xF600CA --len 64
```

`--game-dir` here is **not** `NIE_GAME_DIR`. Two roots coexist: `NIE_GAME_DIR` is the tree
whose VFS `niers` reads, while `NIE_GAME_PATH` is the Steam install — the only one carrying
`files/`, and therefore Proton.

`probe` exists because of a permission rule that the shell scripts satisfied by accident.
Under `kernel.yama.ptrace_scope=1`, `process_vm_readv(2)` is allowed only against a
**descendant of the reading process**. `boot-nie-direct.sh` made the *shell* that ancestor,
so `niers mem` only worked when launched from that same shell. `niers live run` followed by a
separate `niers mem` does not inherit that property: the second process is nobody's ancestor.
`probe` launches and reads in one process, where the rule holds by construction — no
`CAP_SYS_PTRACE`, no `setcap`, and so no disturbance of the Vulkan environment.

### The shell path

The scripts remain, and `nie-wine-setup.sh` additionally starts Xvfb and openbox, which the
Rust port deliberately does not:

```bash
set -a; . ~/.config/niers/steam.env; set +a
scripts/nie-wine-setup.sh
```

The setup copies Proton's default prefix by value, installs DXVK/vkd3d DLLs, creates
`c:`/`z:` mappings, and prepares Xvfb/openbox for a headless display. It must fail
until the game has supplied `files/bin/wine`; that failure means the download is not
complete, not that system Wine should replace Proton.

`STEAM_COMPAT_CLIENT_INSTALL_PATH` points at the native Steam root and
`STEAM_COMPAT_DATA_PATH` at the niers Proton prefix area. The environment is ready
for Proton after the game files arrive; no fake Proton tree is created in advance.

## Headless verification

The deterministic Rust simulation does not require Steam or game assets:

```bash
cargo run -p nie-headless -- match
```

After the download, set `NIE_GAME_DIR` from the private environment file and use
`nie-headless detect/menu`, `nie-game --capture`, or `nie-play` for asset-backed checks.
A headless simulation is not a run of the original `nie.exe`.

## Operational boundaries

- Never put Steam credentials, Guard codes, or refresh tokens in tracked files or command
  arguments.
- `nie-steam` writes the target tree directly; it does not modify Steam's GUI library
  database or claim that the original game is runnable until `data/cpk_list.cfg.bin` and
  the Proton files are present.
- Running the full sync is an explicit action: it can consume tens of gigabytes and must
  be followed by a meaningful file/VFS check, not only an exit code.
