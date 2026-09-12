//! C-ABI surface exposed by `emcc`/`wasm-bindgen`-free glue to the browser, calling the exact
//! same [`nie_lua::menu_runtime::replay`] used by `POST /api/v1/menu/runtime/{screen}` in
//! `crates/tools/nie-site/src/routes/menu_runtime.rs`. The site owns a VFS; the browser does
//! not, so the caller (JS) fetches `.lua.bin` scripts and `*_setting.cfg.bin` bytes from the
//! site's `/f/{path}` endpoint and hands them to [`load_script`] before calling [`replay`].
//!
//! Target: `wasm32-unknown-emscripten` only. `wasm32-unknown-unknown` cannot host this crate —
//! `mlua-sys` compiles PUC-Rio Lua 5.2.4's vendored C sources, which need libc (`setjmp`/
//! `longjmp`, `malloc`) that only emscripten's libc shim provides among wasm32 targets.
use std::{
    cell::RefCell,
    collections::BTreeMap,
    ffi::{CStr, CString, c_char},
};

use nie_lua::menu_runtime::{ReplayOutput, ReplayRequest};

thread_local! {
    /// Script registry keyed by VFS path, filled by JS before each [`replay`] call.
    /// Single-threaded by construction (wasm32 has no threads here); `RefCell` is enough.
    static SCRIPTS: RefCell<BTreeMap<String, Vec<u8>>> = RefCell::new(BTreeMap::new());
}

fn cstr_to_string(ptr: *const c_char) -> String {
    if ptr.is_null() {
        return String::new();
    }
    // SAFETY: caller (JS glue via ccall/cwrap) passes a NUL-terminated UTF-8 string it owns
    // for the duration of this call; we copy it out before returning.
    unsafe { CStr::from_ptr(ptr) }
        .to_string_lossy()
        .into_owned()
}

fn string_to_cstr(value: String) -> *mut c_char {
    CString::new(value)
        .unwrap_or_else(|_| CString::new("{}").expect("static fallback is valid C string"))
        .into_raw()
}

/// Frees a string previously returned by [`nie_lua_web_replay`] or [`nie_lua_web_error`].
/// JS glue must call this after copying the result out, exactly once.
///
/// # Safety
/// `ptr` must be a pointer previously returned by one of this crate's `*_web_*` functions,
/// not yet freed.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_lua_web_free_string(ptr: *mut c_char) {
    if ptr.is_null() {
        return;
    }
    // SAFETY: contract documented on the function; ownership was taken via `CString::into_raw`.
    drop(unsafe { CString::from_raw(ptr) });
}

/// Registers or replaces a script/config's bytes in the browser-side registry, keyed by the
/// exact VFS path it was fetched from (e.g. `data/common/script/lua/menu/main_menu.lua.bin`).
/// Mirrors the role `nie-site`'s VFS plays for the native route.
///
/// # Safety
/// `path` must be a NUL-terminated UTF-8 string; `data`/`len` must describe a valid, readable
/// byte slice for the duration of the call. Both are copied out; no ownership is taken.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_lua_web_load_script(
    path: *const c_char,
    data: *const u8,
    len: usize,
) {
    let path = cstr_to_string(path);
    if path.is_empty() {
        return;
    }
    // SAFETY: contract documented on the function.
    let bytes = if data.is_null() || len == 0 {
        Vec::new()
    } else {
        unsafe { std::slice::from_raw_parts(data, len) }.to_vec()
    };
    SCRIPTS.with(|scripts| {
        scripts.borrow_mut().insert(path, bytes);
    });
}

/// Clears every registered script/config. Call between menu screens to bound memory use.
#[unsafe(no_mangle)]
pub extern "C" fn nie_lua_web_clear_scripts() {
    SCRIPTS.with(|scripts| scripts.borrow_mut().clear());
}

fn json_error(message: &str) -> String {
    serde_json::json!({ "error": message }).to_string()
}

/// Replays `request_json` (a [`ReplayRequest`], `{}` for a bare snapshot) against `screen`,
/// resolving `.lua.bin` includes and the `{screen}_setting.cfg.bin` layout purely from bytes
/// registered via [`nie_lua_web_load_script`] — the same include-resolution contract as
/// `nie_lua::menu_runtime::replay`'s `read` closure on the native site.
///
/// Returns a heap `CString` (JSON [`ReplayOutput`] on success, `{"error": "..."}` on failure)
/// that the caller must release with [`nie_lua_web_free_string`].
///
/// # Safety
/// `screen`/`request_json` must be NUL-terminated UTF-8 strings valid for the call's duration.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_lua_web_replay(
    screen: *const c_char,
    request_json: *const c_char,
) -> *mut c_char {
    let screen = cstr_to_string(screen);
    let request_json = cstr_to_string(request_json);
    let result = run_replay(&screen, &request_json);
    string_to_cstr(match result {
        Ok(output) => {
            serde_json::to_string(&output).unwrap_or_else(|error| json_error(&error.to_string()))
        }
        Err(message) => json_error(&message),
    })
}

fn run_replay(screen: &str, request_json: &str) -> Result<ReplayOutput, String> {
    if screen.is_empty()
        || screen.len() > 96
        || !screen
            .bytes()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == b'_')
    {
        return Err("invalid menu screen".into());
    }
    let request: ReplayRequest = if request_json.trim().is_empty() {
        ReplayRequest::default()
    } else {
        serde_json::from_str(request_json).map_err(|error| error.to_string())?
    };
    request.events()?;

    let config_path = format!("data/common/gamedata/menu/cfg/{screen}_setting.cfg.bin");
    let config_bytes = SCRIPTS
        .with(|scripts| scripts.borrow().get(&config_path).cloned())
        .ok_or_else(|| format!("menu config not loaded: {config_path}"))?;
    let root = nie_formats::cfgbin::to_iecode_json(&config_bytes)
        .ok_or("menu config bytes did not decode as cfg.bin")?;
    let setting = nie_data::menu_setting::parse(&root);
    let layers: Vec<u32> = setting
        .layers
        .iter()
        .map(|layer| layer.layer_id.0)
        .collect();

    let (paths, by_name, by_logical) = SCRIPTS.with(|scripts| {
        let scripts = scripts.borrow();
        let paths: Vec<String> = scripts
            .keys()
            .filter(|path| path.ends_with(".lua.bin"))
            .cloned()
            .collect();
        let (by_name, by_logical) = nie_lua::index_script_paths(paths.iter().map(String::as_str));
        (paths, by_name, by_logical)
    });
    let script = nie_lua::resolve_script_path(screen, &by_name, &by_logical)
        .filter(|path| path.starts_with("data/common/script/lua/menu/"))
        .cloned()
        .ok_or_else(|| format!("menu script not loaded for screen: {screen}"))?;

    // Localised text (`load_menu_text`'s job on the native site) is out of scope for this
    // first browser bring-up: the caller passes an empty map, matching an unlocalised replay.
    let localized_text = BTreeMap::new();

    nie_lua::menu_runtime::replay(
        paths,
        |path| SCRIPTS.with(|scripts| scripts.borrow().get(path).cloned()),
        &script,
        &layers,
        localized_text,
        request,
    )
    .map_err(|error| error.to_string())
}
