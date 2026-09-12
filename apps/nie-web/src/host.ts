/**
 * What the current host can do — measured, not configured.
 *
 * ## Why one flag and not a build mode
 *
 * The same bundle runs in a page and in the native window, and `import.meta.env.MODE` only says
 * which build produced it, not what the running host actually offers. `__TAURI_INTERNALS__` is
 * the only thing that is true exactly when the Tauri runtime is there — the same test the
 * workspace sidebar and the download button already made, each with its own copy of the constant.
 */

/** `true` inside the Tauri window, `false` in a page. */
export const NATIVE_WINDOW = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Can this host reach the game at `/` ?
 *
 * The game is the site's root screen: it boots on `nie-site` (the VFS index, the layouts, the
 * WebAssembly module) over HTTP, on the origin that serves it. The native window has no origin
 * and no server — it opens on the workspace, and its sidebar does not draw a game section that
 * would lead nowhere.
 */
export const GAME_REACHABLE = !NATIVE_WINDOW;
