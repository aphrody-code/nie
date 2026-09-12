# nie-lua-web

C-ABI surface over the **real** `nie-lua` VM (mlua, PUC-Rio Lua 5.2.4 vendored in C),
callable from the browser. It mirrors the exact request/response contract of
`POST /api/v1/menu/runtime/{screen}` in `crates/tools/nie-site/src/routes/menu_runtime.rs`:
JS supplies the `.lua.bin` scripts and `*_setting.cfg.bin` bytes (fetched from the site's
`/f/{path}`), this crate replays them through the same `nie_lua::menu_runtime::replay` the
native site uses.

## Two wasm targets, two different worlds

- **`wasm32-unknown-unknown`** (`crates/engine/nie-wasm`) hosts every *pure-Rust* part of the
  engine already in the browser: `nie-formats` (cfg.bin, CRILAYLA, @UTF, G4TX/G4MD/G4MG/G4SK),
  the HCA/ADX audio codec, `nie-core`/`nie-data`/`nie-save`, the CPU-framebuffer game
  (`nie-app`), the local match sim (`nie-runtime`), etc. `nie-lua`'s pure-Rust bytecode decoder
  (`nie_lua::bytecode`, no VM) also lives there.
- **`wasm32-unknown-emscripten`** (this crate) is the *only* wasm target that can host the real
  Lua **VM**. `mlua-sys` compiles PUC-Rio Lua 5.2.4's C sources via the vendored `lua-src`
  crate; that C code needs libc (`setjmp`/`longjmp`, `malloc`), which only emscripten's libc
  shim provides among wasm32 targets — `lua-src` panics outright
  (`don't know how to build Lua for wasm32-unknown-unknown`) if pointed at
  `wasm32-unknown-unknown` (measured 2026-09-12, `cargo check -p nie-game --target
  wasm32-unknown-unknown --no-default-features`).

The two crates never share a `.wasm` module; the browser loads `nie-wasm`'s module for
everything else and this crate's module for menu/scene Lua logic, bridging them via
`nie_lua_web_load_script`/`nie_lua_web_replay` and JS-side plumbing.

## Building (measured 2026-09-12, emsdk 6.0.9, rustc 1.98.1)

```sh
rustup target add wasm32-unknown-emscripten     # rust-std only, already vendored by rustup
git clone --depth 1 https://github.com/emscripten-core/emsdk ~/emsdk
cd ~/emsdk && ./emsdk install latest && ./emsdk activate latest
source ~/emsdk/emsdk_env.sh                      # every shell that invokes cargo/emcc

cd crates/engine/nie-lua-web                     # cargo config discovery starts at $PWD, not
                                                  # the invoked package's manifest dir — running
                                                  # `cargo build -p nie-lua-web` from the
                                                  # workspace root does NOT pick up
                                                  # `.cargo/config.toml` below; `cd` here first.
CC_wasm32_unknown_emscripten=emcc \
CXX_wasm32_unknown_emscripten=em++ \
AR_wasm32_unknown_emscripten=emar \
cargo build --release --target wasm32-unknown-emscripten
```

Output: `target/wasm32-unknown-emscripten/release/deps/nie_lua_web.wasm` (867,791 bytes,
unoptimized `-O3` rustc output; `wasm-opt` was not run in this pass — see Known gaps).

### The three link-time corrections (`.cargo/config.toml`)

`rustc`'s default for a `cdylib` on `wasm32-unknown-emscripten` is an emcc **side module**
(`-sSIDE_MODULE=2`, dynamic-linking position-independent code). That default does not work here:

1. **PIC.** `mlua-sys`'s vendored Lua 5.2.4 C sources are compiled by `lua-src`'s
   `cc::Build` without `-fPIC`. Overriding via `CFLAGS_wasm32_unknown_emscripten=-fPIC` did
   **not** change the fingerprint or the resulting object files (measured: identical
   `mlua-sys-cb238f17e20e17bf` fingerprint hash and identical `wasm-ld` `recompile with -fPIC`
   errors before and after, even after `rm -rf` of the build output). The practical fix is to
   stop requesting a side module and link a standalone, non-PIC module instead
   (`-sSIDE_MODULE=0` + `-sSTANDALONE_WASM=1`).
2. **No `main`.** A standalone, non-side module is linked as an executable by default and
   `wasm-ld` refuses it without a `main` symbol (`undefined symbol: main`,
   `libstandalonewasm.a(__main_void.o)`). Fix: `-Wl,--no-entry` (reactor module, no entry
   point expected).
3. **C++ exception ABI.** Lua's `ldo.c` (protected calls / `longjmp` emulation) is compiled
   under emscripten's default `-fwasm-exceptions`, which needs the C++ unwinder
   (`__cxa_allocate_exception`, `__cxa_throw`, RTTI vtables for `__pointer_type_info` /
   `__class_type_info`). Fix: link `-lc++abi -lc++`.

All three are pinned in this crate's `.cargo/config.toml` (`[target.wasm32-unknown-emscripten]
rustflags`), which — per the constraint above — only takes effect when cargo is invoked with
this directory as its working directory.

## Runtime surface (`src/lib.rs`)

- `nie_lua_web_load_script(path, data, len)` — registers a VFS-path-keyed byte blob (a
  `.lua.bin` script or a `*_setting.cfg.bin`), fetched by JS from the site's `/f/{path}`.
- `nie_lua_web_clear_scripts()` — drops the registry between menu screens.
- `nie_lua_web_replay(screen, request_json) -> *mut c_char` — replays `request_json` (a
  `nie_lua::menu_runtime::ReplayRequest`, `{}` for a bare snapshot) against `screen`, resolving
  `INCLUDE`s and the layer/config setting purely from registered bytes, exactly like the
  native route's VFS closure. Returns a heap `CString` (`ReplayOutput` JSON, or
  `{"error": "..."}`) — call `nie_lua_web_free_string` on the result exactly once.

Localized menu text (`load_menu_text` on the native site) is **not yet wired**: this first
bring-up always replays with an empty text map. That is a known, explicit gap, not a silent
approximation.

## Known gaps (be honest about these)

- `wasm-opt` was not run on the release artifact in this pass (binaryen not installed on this
  box within the time box); the 867,791-byte figure above is raw rustc/emcc output.
- No JS glue (`ccall`/`cwrap` wrapper) was written yet; the C-ABI functions above are the
  contract JS must bind against.
- No differential test against the native `/api/v1/menu/runtime/{screen}` route has been run
  yet from this crate (would need a `scripts/differential.ts`, not yet written).
- Localized text is stubbed to empty, see above.
