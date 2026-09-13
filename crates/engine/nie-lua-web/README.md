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

## Why there are two modules, and what it would take to have one — MEASURED

The browser loads two WebAssembly modules: `nie-wasm` (`wasm32-unknown-unknown`, pure Rust) and
this one (`wasm32-unknown-emscripten`, Lua in C). That is not a wiring mistake. `mlua` compiles
PUC-Rio Lua 5.2.4's C sources, which need `setjmp`/`longjmp`, and emscripten is the only wasm32
target that provides them.

The only exit is a VM written in Rust, interpreting the bytecode `nie_lua::bytecode` already
decodes — not a third-party interpreter, which would be a DIFFERENT Lua from the one the game
ships. Before writing a line of it, `tests/opcode_survey.rs` in `nie-lua` measures what it would
have to cover, across every `.lua.bin` on this mount:

```text
scripts lus       : 4188 (illisibles : 0)
instructions      : 3905236
opcodes atteints  : 38 / 40
jamais atteints   : LOADKX, EXTRAARG
globales lues     : 6686
dont fournies par l'hôte Rust : 0 / 6686 (0 %) — l'hôte en installe 2 : Debug Math
```

The interpreter is the small half: 38 opcodes, and the two that never appear (`LOADKX`,
`EXTRAARG`) are the wide-constant pair that only very large chunks need. The wall is the other
number. Those scripts read **6 686 distinct globals** — `AddItem`, `ActivateAuraSkill`,
`AdvanceGameTimeZone` — every one of them a function the game's executable provides, and the
Rust host currently binds **none** of them (its two binders are `Debug` and `Math`).

So "one module" is not one commit away, and it is not blocked by the interpreter.

But 6 686 is a bound on the SURFACE, not an estimate of the work, and the difference matters.
That number counts globals read anywhere in the bytecode, branches never taken included;
restricting it to menus and their includes barely moves it (6 081 of 6 686). The dynamic measure
disagrees by two orders of magnitude: `menu_host_gap.rs` replays screens through the real VM and
finds a few hundred units actually missing — 398 over an even sample of 93 screens, of which
**19 replay complete**. A script names hundreds of functions on paths that opening a screen never
takes.

The ranked head of that queue is names, not command ids: `SetCtrlGuideTextCommon` blocks 11 of
the 93, `ShowTitleChangeChildButtonCommon` 9, `SetTitleTextureCommon` 8.

Whether those are `nie.exe` functions is NOT established, and a first reading here said it was.
`SetCtrlGuideTextCommon` appears in 48 `.lua.bin`, two of them includes
(`menu/main_menu_inc`, `menu/go_school_menu_inc`) — so it may well be a Lua function that simply
was not defined at the moment the screen read it, because the include carrying it had not run.
Supplying the bytes is not enough; the script has to `INCLUDE` them. That distinction changes
what the work is, and settling it means reading `SETTABUP` on `_ENV`, not counting occurrences.

Both surveys are checked in so the numbers are re-measured rather than remembered — and so the
day either drops, it drops visibly.

## The differential: 10/14 identical (2026-09-13)

`scripts/differential.ts` replays fourteen screens through this module and through the native
site, then deep-compares. The result is the same number and a completely different situation:

```text
2026-09-12 : 13 aborted the wasm instance, 1 had no script        →  0/14
2026-09-13 : 0 abort, text supplied, per-host gaps excluded       → 10/14
```

Two changes got there. `nie_lua_web_load_text` lets JS hand over the localised table the native
site reads from its VFS — without it, one scene had labels and the other did not, on thirteen
screens. And the comparison now excludes `missing`, which reports what EACH HOST lacks rather
than what the VM computes: the site has a VFS, the module has what JS deposited, and their gaps
have no reason to coincide. Comparing it measured the mounts, exactly as comparing `visible`
did in the layout comparison.

Three screens still differ, all on `$.scene…objects….text` — `chara_bank_menu`, `main_menu`,
`soccer_formation_menu` — and the difference is NOT missing text. Probed on all three, the same
shape each time:

```text
wasm  : null
natif : ""
```

Absent against empty. The object's text slot resolves to nothing on both sides; one records it
as `None`, the other as `Some("")`. It is not a shortage of the table either: the route serves
2 755 lines for `menu_text`, `total_unfiltered` says 2 755, and none of them is empty — so no
empty line was dropped on the way in.

What produces it is now narrowed to one argument. `menu_host.rs`'s `CMD_SET_TEXT` writes
`Some(...)` only when argument 2 is a Lua string or number, and `None` otherwise:

```rust
let text = match args.get(2) {
    Some(Value::String(s)) => Some(s.to_string_lossy()),
    Some(v @ Value::Number(_)) | Some(v @ Value::Integer(_)) => Some(format!("0x{:08X}", …)),
    _ => None,
};
```

So natively the script calls `SetText(obj, idx, "")` with an EMPTY string, and in this module it
calls it with `nil`. The divergence is upstream of the command, in whatever computes that third
argument — not in the text table (proved identical, see
`crates/tools/nie-site/tests/menu_text_shape.rs`) and not in the command handler, which is the
same code on both sides.

What computes it is not established, but the two hosts demonstrably hold DIFFERENT LUA TYPES for
the same value. Comparing each side's `missing` on `main_menu` shows the same unhandled command
logged with the same id and different argument rendering:

```text
module : "0x88154DF4, 1739028016 (cmd 0x88154df4/0x0bf14058)"
natif  : "2283097588, 1739028016 (cmd 0x88154df4/0x0bf14058)"
```

`2283097588 == 0x88154DF4`. Natively that first argument is a Lua **number**; in this module it
is the **string** `"0x88154DF4"`. Same value, different type — and `CMD_SET_TEXT` branches on
exactly that distinction, which is why one host stores a text and the other does not.

Where a number becomes a hex string has a source-backed answer: **this VM's Lua integers are
32-bit**. `vendor/lua-src/lua-5.2.4/luaconf.h` line 462 reads

```c
#define LUA_INTEGER	ptrdiff_t
```

which is 4 bytes on `wasm32-unknown-emscripten` and 8 on `x86-64`. `LUA_NUMBER` stays `double`
on both, so arithmetic agrees — but anything crossing as `lua_Integer` truncates here.

The game keys its menu objects and commands by CRC-32, and `0x88154DF4` is 2 283 097 588, past
`i32::MAX`. Such an id cannot round-trip through a 32-bit `lua_Integer`, so the value arrives as
something other than an integer and the code downstream sees a different Lua type.

That is not a defect of this crate; it is a property of the only wasm target that can host
PUC-Rio Lua's C. Every hash-keyed command in the game is above `i32::MAX` roughly half the time,
which bounds what a 32-bit browser VM can reproduce faithfully — and is worth knowing before
counting on `n/14` to reach 14.

### Can it be widened? Yes, and not in one line

`LUA_INTEGER` is a `luaconf.h` macro, so the vendored build script could define it as
`long long`. That alone would CORRUPT the boundary: `mlua-sys` mirrors the same rule in Rust —

```rust
// mlua-sys-0.10.0/src/lua51/lua.rs
#[cfg(target_pointer_width = "32")]
pub type lua_Integer = i32;
```

— so the C side would push 64 bits where the Rust side reads 32. Widening safely means patching
`mlua-sys` in step with `lua-src`, i.e. vendoring a second crate and keeping the two definitions
in agreement.

**Tried on 2026-09-13, and it makes things worse.** With `mlua-sys` vendored, `lua_Integer`
widened to `i64` on every target, and `LUA_INTEGER=long long` defined for the emscripten build —
both halves moved together, which is the condition stated above — the differential falls from
10/14 to **3/14**, and eleven screens die with `nie_lua_web_alloc returned null`. Moving the two
declarations in step is therefore NECESSARY and NOT SUFFICIENT: `luaconf.h` derives more from
`LUA_INTEGER` than its width (`lua_Unsigned` stays `c_uint` in `mlua-sys`'s 5.2 module, for one),
and the mismatch shows up as heap exhaustion rather than as a type error.

Reverted, and the differential is back to 10/14. Whoever attempts this again should expect to
audit every type `luaconf.h` derives from `LUA_INTEGER`, not just the integer itself. It is one slot
on three screens, and the three replays otherwise match object for object. `shop_menu` remains
scriptless on both sides.

The obvious suspect — the two hosts being fed different tables — was NOT ruled out, and the
attempt is worth recording so it is not repeated blindly. The native replay builds its map with
`routes::menu::load_menu_text` (raw `.cfg.bin` → `nie_data::text::parse_text_file`); the browser
receives `/api/v1/text/{lang}/menu_text` (→ `nie_data::typed::decode_by_key`). Comparing the two
line counts inside a `nie-site` test does not work: the VFS mounts asynchronously and a unit test
has no way to await it, so the test skips itself and proves nothing. Measuring this needs the
running server on both sides, not a test.

Nor does the CLI shortcut work: `niers decode` on the extracted
`text/fr/menu_text.cfg.bin` renders the RAW container structure, not the `{entries}` iecode form
`nie_data::text::parse_text_file` consumes, so counting lines from it answers a different
question. The conversion is `nie_formats::cfgbin::to_iecode_json`, which the CLI exposes only
through `refresh-typed-json`.

Every remaining difference is `$.scene…objects….text` or `$.missing`. Neither is a divergence
of the VM:

- **`.text`** — `run_replay` passes an EMPTY localised-text map, as `src/lib.rs` states: the
  caller was not given a way to supply one. The native site loads `menu_text`, so its scene
  carries labels and this one does not. Closing it means an ABI to hand the table over, exactly
  as `apps/nie-web/src/game/menu-layout.ts` already does for the layout.
- **`.missing`** — the field added on 2026-09-13 so that `complete: false` names what failed.
  The two hosts do not lack the same things, which is precisely what it is for.

`shop_menu` still reports `script not loaded`: the game ships no top-level `shop_menu.lua.bin`,
only `shop_menu_basara_*`/`_buy_*`/`_sell`. The native route fails on it too, differently worded.

One incidental fix: the script looked for the module under `release/deps/`, where `cargo` puts
intermediate objects. The cdylib is at the root of the profile, and the path had been wrong since
the script was written.

## What the official documentation says about the flag this crate depends on

The patched `vendor/lua-src` passes `-sSUPPORT_LONGJMP=wasm` when it compiles Lua **as C**. That
is not a workaround discovered by trial: it is the rule emscripten states.

- `SUPPORT_LONGJMP` takes `emscripten` (JavaScript-based), `wasm` (WebAssembly
  exception-handling-based), `0`, or `1`. `1` is the default and means *"`wasm` if
  `-fwasm-exceptions` is used, `emscripten` otherwise"*.
- *"When combining C and C++ code with `-fwasm-exceptions`, you must explicitly pass
  `-sSUPPORT_LONGJMP=wasm` at C compile time to match the C++ handling model."*
  — <https://emscripten.org/docs/porting/setjmp-longjmp.html>

That is exactly this crate's situation: rustc compiles the Rust half of the module with
`-fwasm-exceptions` on `wasm32-unknown-emscripten`, while `lua-src` compiles Lua's C sources in a
separate `cc::Build` that inherits none of it. Without the explicit flag the two halves disagree
on how a `longjmp` travels, and the link fails on `undefined symbol: emscripten_longjmp`
(measured 2026-09-12). The flag belongs in the build script and nowhere else: cargo does not
fingerprint `CFLAGS_<target>`, so setting it in the environment recompiles nothing.

### The consequence, measured on the artefact

Choosing `wasm` makes the module **require the WebAssembly exception-handling proposal**. This is
readable in the published binary, not inferred:

```
$ # apps/nie-web/public/static/game/nie_lua_web.wasm, sections by id
  section  1 type       452 bytes
  ...
  section 13 tag          5 bytes      <- exception handling
```

Section 13 (`tag`) exists only in that proposal. An engine without it does not misbehave at
runtime — it **refuses to instantiate the module**. `apps/nie-web/src/game/lua-runtime.ts`
therefore probes for it with a 19-byte module before downloading 873 KB, and
`lua-runtime.test.ts` reads the shipped artefact back to keep this paragraph honest: if a future
build drops the `tag` section, the test fails rather than the documentation quietly going stale.

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

The "newer nightly" way out was then TRIED and does not work: the toolchain was updated from
`1.98.0-nightly` (2026-06-04) to **`1.100.0-nightly` (2026-09-11, the day before this
measurement)**. `-Z help` there still lists exactly two wasm options — `wasm-c-abi` and
`wasm-proc-macros` — and no exception switch. Rebuilt with it and `-Z build-std=std`, the
artifact changes again (875,952 bytes, and rustc now emits it at `release/` instead of
`release/deps/`) but the five `invoke_*` remain and the module still traps in
`nie_lua_web_replay`.

**One way out remains**, and it is now located to the line. `lua-src-550.0.0/src/lib.rs`, in its
emscripten branch:

```rust
_ if target.ends_with("emscripten") => {
    config
        .define("LUA_USE_POSIX", None)
        .cpp(true)              // Lua is compiled as C++…
        .flag("-fexceptions");  // …with exceptions, "to be caught"
    // …then every source is copied to `cpp_source/`, with lauxlib.h / lua.h /
    // lualib.h wrapped in `extern "C" { … }`.
}
```

That is the origin of the whole chain: Lua's `LUAI_THROW` becomes a C++ `throw`, which unwinds
through the C++/wasm unwinder, which `mlua`'s `catch_unwind` meets as a foreign exception, which
Rust aborts on. Compiling Lua as C instead (so `LUAI_THROW` is `longjmp`) means dropping
`.cpp(true)`, `-fexceptions` and the `cpp_source` copy — about 35 lines — in a **fork of a
third-party build script**, and then choosing a `longjmp` mode (`-sSUPPORT_LONGJMP=emscripten`
or `=wasm`).

**It is done, and it works.** `vendor/lua-src` is that fork, wired through `[patch.crates-io]` in
the workspace manifest, and it differs from upstream in one branch: on emscripten Lua is compiled
as C (no `.cpp(true)`, no `-fexceptions`, no `cpp_source` copy) with
`-sSUPPORT_LONGJMP=wasm`, which must match the link — rustc enables `-fwasm-exceptions` on this
target, so the JS `longjmp` is refused outright by emcc.

The flag belongs in the build script, not in the environment: `CFLAGS_wasm32_unknown_emscripten`
is not part of cargo's fingerprint, so setting it outside recompiles nothing (measured twice —
same `ldo.o`, same hash).

Measured result: the artifact drops to **870,393 bytes with ZERO `invoke_*`** — the JS exception
trampolines are gone — and driven end to end against the live VFS the VM now instantiates, loads
the screen's four real scripts and RUNS the replay instead of aborting.

### What blocks it now, and it is an ordinary problem

```text
erreur VM Lua : syntax error: chara_bank_menu_6.00.09.00.lua.bin: incompatible precompiled chunk
```

Lua 5.2 bytecode embeds the sizes of `int`, `size_t` and `lua_Number` in its header. The game's
`.lua.bin` were precompiled for a 64-bit build; the wasm VM is 32-bit, so it refuses them. That
is why the same files replay on the server and not in the page.

The way through is already in this repository: `nie_lua::bytecode` is a pure-Rust, byte-exact
Lua 5.2 codec (it is what `mode_index.rs` uses). Transcoding a chunk's header and its embedded
sizes from the 64-bit to the 32-bit layout before `loadbuffer` is the next step — and it is a
decoding job this repository already knows how to do, not a toolchain fight. Until it is resolved the browser driver
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
