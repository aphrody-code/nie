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

### Measured NEGATIVE result: `-fwasm-exceptions` at link time does not fix the abort

In the page, the module aborts on Lua's first protected error with `fatal runtime error: Rust
cannot catch foreign exceptions` (measured 2026-09-12 on the deployed site). The obvious reading
is that the link lacks emscripten's exception support, so the link was retried with

```sh
-C link-arg=-fwasm-exceptions -C link-arg=-sSUPPORT_LONGJMP=wasm \
CFLAGS_wasm32_unknown_emscripten=-fwasm-exceptions
```

**It changes nothing**, and a second attempt ruled out the obvious explanation. Measured twice:

| Attempt | Result |
|---|---|
| link flags only | 870,512 bytes, 5 `invoke_*`, 1 `__cxa_find_matching_catch` |
| `cargo clean -p mlua-sys` + rebuild (55 s of real C compilation) with `CFLAGS_wasm32_unknown_emscripten=-fwasm-exceptions` | **the same 870,512 bytes, the same 5 `invoke_*`, the same 1 `__cxa_find_matching_catch`** |
| add `-C target-feature=+exception-handling` on nightly (installed here) and rebuild again, 1 min 14 s | **again the same 870,512 bytes and the same counts** — single output file, freshly timestamped, so the rebuild is real |
| `cargo +nightly -Z build-std=std,panic_abort` with the same flags | **the artifact finally MOVES: 867,669 bytes** (−2,843). `invoke_*` and `__cxa_find_matching_catch` still present. Run end to end against the live VFS, the replay no longer reports a foreign exception — it traps: `RuntimeError: Unreachable code should not be executed` inside `nie_lua_web_replay`, which is what `panic_abort` makes of a Rust panic |

A forced recompilation of Lua's C sources that changes NOTHING in the output means the
trampolines do not come from those sources. They come from the Rust side: `rustc` emits the
JS-trampoline exception path on `wasm32-unknown-emscripten`, and `mlua` propagates Lua errors
through Rust unwinding (`catch_unwind`), which is what then meets a foreign exception and aborts.

Three real rebuilds producing a byte-identical artifact mean the flags do not reach code
generation on this target at all. `-Z emscripten-wasm-eh` does not exist in the nightly
installed here (`rustc 1.98.0-nightly 2026-06-04`, `-Z help` lists 287 options and none match
`emscripten`/`exception`), and `-C target-feature=+exception-handling` changes nothing either.
The `-v` build was read: the five link args of this file DO reach rustc, so the config is
applied. The lever that finally moves the artifact is `-Z build-std` — rebuilding the standard
library, whose prebuilt form carries the JS-exception ABI. With `panic_abort` the module then
stops complaining about foreign exceptions and traps instead, on a Rust panic inside
`nie_lua_web_replay`.

That panic was then read, and it is not a panic. Rebuilt with `-Z build-std=std` (unwinding
kept) and driven end to end against the live VFS, the module prints:

```text
[nie-lua-web fd2] fatal runtime error: Rust cannot catch foreign exceptions, aborting
```

**The causal chain, established:**

1. `-fwasm-exceptions` is active in the link. This is not a guess — asking for the JS-based
   `longjmp` instead makes `emcc` refuse outright:
   `SUPPORT_LONGJMP=emscripten is not compatible with -fwasm-exceptions`.
2. Lua's protected calls therefore unwind through the C++/wasm unwinder.
3. `mlua` wraps its calls into Lua in `catch_unwind`.
4. Rust's standard library on `wasm32-unknown-emscripten` uses the *emscripten* (JS) exception
   ABI, so that `catch_unwind` meets a foreign exception and aborts by design.
5. Making `rustc` emit WebAssembly exception handling instead needs `-Z emscripten-wasm-eh`,
   which **does not exist** in the nightly installed here (`rustc 1.98.0-nightly`, 2026-06-04):
   `-Z help` has exactly one wasm option, `wasm-c-abi`.

Two ways out remain, and both are decisions rather than flags: a newer nightly that carries the
wasm-EH switch, or removing `-fwasm-exceptions` from Lua's C compilation, which means patching
or forking `lua-src`'s build script. Until it is resolved the browser driver
(`apps/nie-web/src/game/lua-runtime.ts`) returns an empty table and the screens fall back on the
server's resolution.

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

## Generalised beyond menu screens (2026-09-12)

The entry-script resolution accepts any registered `.lua.bin` under
`data/common/script/lua/`, not only `.../menu/` — `chara`, `system`, `kizuna`, `story_mode_*`
and `action` scripts share the exact same `HostRegistry::standard` (there is no separate
per-family Lua host in `nie-lua` yet). A missing `*_setting.cfg.bin` is treated as an empty
layer list, not a hard error, so non-menu families can still be replayed for their
callback/host-call surface — though `nie_lua::menu_runtime::replay` itself still requires a
**non-empty** layer list, so a family with no menu config will report `"Invalid menu layer
count"` until `nie-lua` grows a non-menu replay entry point (see `PLAN.md`).

## JS/Bun glue (`js/nie-lua-web.ts`)

The module emits **no** `.js` glue of its own — rustc's `emcc` invocation for a `cdylib` bypasses
emscripten's JS-emitting driver entirely and links straight to `.wasm` via `wasm-ld`. `js/nie-lua-web.ts`
hand-implements exactly the imports `WebAssembly.Module.imports()` reports for this build
(WASI `fd_write`/`clock_time_get`/`random_get`/…, plus emscripten's `env` syscalls and
`invoke_*` exception trampolines) and exposes `createLuaRuntime(wasmBytes)` with
`loadScript`/`clearScripts`/`replay`.

Proven working (measured 2026-09-12): the FFI plumbing itself — string/byte marshalling via
the exported `nie_lua_web_alloc`/`nie_lua_web_dealloc` (wrapping `malloc`/`free`) — round-trips
correctly for any call path that stays in pure-Rust validation:
`replay("!!!", "{}")` → `{"error":"invalid menu screen"}`;
`replay("nonexistent_screen_xyz", "{}")` → `{"error":"script not loaded for screen: ..."}`.

## Differential proof (`scripts/differential.ts`) — measured 0/14

Run against the live site (`127.0.0.1:8085`) for the 14 `runtime_matrix.results` families in
`data/menu/manifest.json`, having registered all 651 `.lua.bin` under
`data/common/script/lua/` and every `*_setting.cfg.bin` under
`data/common/gamedata/menu/cfg/` (fetched via `/api/v1/recherche?prefixe=...` + `/f/{path}`):

- **`shop_menu`**: fails identically on both sides for the same reason — there is no top-level
  `shop_menu.lua.bin`, only `shop_menu_basara_*`/`shop_menu_buy_*`/`shop_menu_sell` variants.
  Native: `{"genre":"introuvable","message":"Menu script unavailable"}`. wasm:
  `{"error":"script not loaded for screen: shop_menu"}`. Different shape, same root cause.
- **The other 13 families all abort the wasm instance**: `thread '<unnamed>' (1) panicked at
  .../panicking.rs:225:5: panic in a function that cannot unwind`, surfacing in JS as
  `Unreachable code should not be executed`.

**Diagnosed root cause** (not fixed in this pass): `mlua` registers Rust closures as Lua C
functions through `extern "C"` trampolines and relies on `std::panic::catch_unwind` internally
so an accidental Rust panic inside a host callback becomes a recoverable `mlua::Error` instead
of crossing the C-ABI boundary raw. On `wasm32-unknown-emscripten`, Rust's unwinding is
implemented via the Itanium C++ exception ABI — the exact `invoke_*` / `__cxa_find_matching_catch_3`
imports this module declares. This crate's hand-written JS glue stubs
`__cxa_find_matching_catch_3` to always report "no match" and does not re-throw through nested
`invoke_*` frames the way emscripten's real JS runtime does, so `catch_unwind` never finds its
landing pad and the panic escapes as a genuine `abort()`. This is a JS-glue gap, not a bug in
`nie-lua`/`mlua` itself. See `PLAN.md`'s "Real Lua 5.2.4 VM in the browser" section for the
two candidate fixes (port emscripten's real exception runtime, or force `panic = "abort"`
end-to-end) and the ranked list of what is still missing to turn this bring-up into a shipped
browser feature.

## Known gaps (be honest about these)

- `wasm-opt` was not run on the release artifact in this pass (binaryen not installed on this
  box within the time box); the 867,690-byte figure above is raw rustc/emcc output.
- Localized text is stubbed to empty, see above.
- 0/14 families reach a comparable `MenuScene` today — see the differential section above.
