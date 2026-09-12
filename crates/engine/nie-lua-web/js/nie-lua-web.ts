// Bun/browser glue for `nie_lua_web.wasm` (wasm32-unknown-emscripten, STANDALONE_WASM + --no-entry).
//
// This module is NOT loaded through emscripten's own JS driver (rustc's emcc invocation here
// links directly via wasm-ld, `-sSTANDALONE_WASM=1 -Wl,--no-entry`, and emits no `.js` glue —
// measured 2026-09-12, `target/wasm32-unknown-emscripten/release/deps/` has no sibling `.js`).
// So this file reimplements, by hand, only the imports this specific module actually asked for
// (`WebAssembly.Module.imports`), not emscripten's full runtime.
//
// KNOWN GAP, stated plainly: the `invoke_*` / `__cxa_find_matching_catch_3` imports are
// emscripten's classic JS-trampoline exception ABI (used by Lua's `lua_pcall`/`luaD_throw` C++
// longjmp emulation under `-fwasm-exceptions`). A faithful implementation needs emscripten's
// `ExceptionInfo` runtime (type-info walking against `std::type_info`), which this module does
// not export the support tables for (no `setThrew`/`stackSave` exports either). The
// implementation below is best-effort: it rethrows synchronously and never resumes a matched
// catch inside Lua's C code. It has NOT been proven correct against a script that actually
// exercises `pcall`/an internal Lua error — see `scripts/differential.ts`'s measured results.

export interface LuaRuntime {
  loadScript(path: string, bytes: Uint8Array): void;
  clearScripts(): void;
  /** Returns the raw JSON string produced by `nie_lua_web_replay` (a `ReplayOutput` or `{"error": "..."}`). */
  replay(screen: string, requestJson: string): string;
}

function utf8Encode(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function utf8Decode(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

/** Instantiates the module and returns a small, memory-safe wrapper over its C ABI. */
export async function createLuaRuntime(wasmBytes: BufferSource): Promise<LuaRuntime> {
  let memory: WebAssembly.Memory;
  let table: WebAssembly.Table;

  // Emscripten's classic (non-native) exception trampolines: call the indexed table entry,
  // and on a thrown JS value, ask `__cxa_find_matching_catch_3` (imported from us, since this
  // module was linked without emscripten's own JS-side implementation of it) — we cannot walk
  // C++ RTTI from here, so this always reports "no match", which native Lua interprets as an
  // unhandled exception. Documented gap above.
  function makeInvoke(signature: string) {
    return (index: number, ...args: number[]) => {
      const fn = table.get(index) as (...a: number[]) => number | void;
      try {
        return fn(...args);
      } catch (error) {
        console.error(`[nie-lua-web makeInvoke ${signature}] fn table index=${index}, args=${args} caught:`, error);
        if (typeof error === "number") throw error; // a real wasm trap / abort code
        // Signal "exception thrown, no JS-visible match" back into C via the imported hook.
        // Le typage de `exports` est `ExportValue`, qui n'est pas appelable : ce hook EST une
        // fonction exportée, et c'est à l'appelant de le dire, pas au typage de le deviner.
        (instance.exports.__cxa_find_matching_catch_3 as ((code: number) => void) | undefined)?.(0);
        throw error;
      }
    };
  }

  const imports: WebAssembly.Imports = {
    env: {
      invoke_vii: makeInvoke("vii"),
      invoke_iiii: makeInvoke("iiii"),
      invoke_vi: makeInvoke("vi"),
      invoke_ii: makeInvoke("ii"),
      invoke_viii: makeInvoke("viii"),
      __cxa_find_matching_catch_3: (_thrownType: number) => 0,
      __syscall_dup3: () => -1,
      __syscall_getcwd: () => -1,
      __syscall_unlinkat: () => -1,
      __syscall_rmdir: () => -1,
      __syscall_renameat: () => -1,
      _emscripten_system: () => -1,
    },
    wasi_snapshot_preview1: {
      proc_exit: (code: number) => {
        throw new Error(`nie_lua_web: wasm proc_exit(${code})`);
      },
      fd_close: () => 0,
      fd_seek: () => 0,
      fd_read: () => 0,
      fd_write: (fd: number, iovPtr: number, iovCount: number, writtenPtr: number) => {
        // Only stdout/stderr are ever written by the vendored Lua C runtime (print/error
        // paths); mirror them to the host console so a script's own `print()` is not silent.
        const view = new DataView(memory.buffer);
        let written = 0;
        let text = "";
        for (let i = 0; i < iovCount; i += 1) {
          const base = iovPtr + i * 8;
          const ptr = view.getUint32(base, true);
          const len = view.getUint32(base + 4, true);
          text += utf8Decode(new Uint8Array(memory.buffer, ptr, len));
          written += len;
        }
        if (text.length > 0) {
          (fd === 2 ? console.error : console.log)(`[nie-lua-web fd${fd}]`, text);
        }
        view.setUint32(writtenPtr, written, true);
        return 0;
      },
      clock_time_get: (_clockId: number, _precision: bigint, resultPtr: number) => {
        const view = new DataView(memory.buffer);
        view.setBigUint64(resultPtr, BigInt(Math.round(Date.now() * 1_000_000)), true);
        return 0;
      },
      random_get: (ptr: number, len: number) => {
        const bytes = new Uint8Array(memory.buffer, ptr, len);
        crypto.getRandomValues(bytes);
        return 0;
      },
    },
  };

  // Compiler PUIS instancier, au lieu de `instantiate(bytes, …)` : la surcharge à deux formes
  // de cette API rend soit `{ module, instance }`, soit `Instance`, et le typage choisissait la
  // seconde pour des octets. Deux appels, un seul type, aucun cast.
  const module = await WebAssembly.compile(wasmBytes);
  const instance = await WebAssembly.instantiate(module, imports);
  memory = instance.exports.memory as WebAssembly.Memory;
  table = instance.exports.__indirect_function_table as WebAssembly.Table;

  const exportsFn = instance.exports as {
    nie_lua_web_alloc(len: number): number;
    nie_lua_web_dealloc(ptr: number, len: number): void;
    nie_lua_web_free_string(ptr: number): void;
    nie_lua_web_load_script(pathPtr: number, dataPtr: number, len: number): void;
    nie_lua_web_replay(screenPtr: number, requestPtr: number): number;
    __cxa_find_matching_catch_3?(a: number): number;
  };

  function writeBytes(bytes: Uint8Array): { ptr: number; len: number } {
    const ptr = exportsFn.nie_lua_web_alloc(bytes.length || 1);
    if (ptr === 0) throw new Error("nie_lua_web_alloc returned null");
    new Uint8Array(memory.buffer, ptr, bytes.length).set(bytes);
    return { ptr, len: bytes.length };
  }

  function writeCString(value: string): { ptr: number; len: number } {
    return writeBytes(utf8Encode(`${value}\0`));
  }

  function readCString(ptr: number): string {
    const bytes = new Uint8Array(memory.buffer);
    let end = ptr;
    while (bytes[end] !== 0) end += 1;
    return utf8Decode(bytes.subarray(ptr, end));
  }

  return {
    loadScript(path, bytes) {
      const { ptr: pathPtr, len: pathLen } = writeCString(path);
      const { ptr: dataPtr, len: dataLen } = writeBytes(bytes);
      exportsFn.nie_lua_web_load_script(pathPtr, dataPtr, bytes.length);
      exportsFn.nie_lua_web_dealloc(pathPtr, pathLen);
      exportsFn.nie_lua_web_dealloc(dataPtr, dataLen);
    },
    clearScripts() {
      (instance.exports as { nie_lua_web_clear_scripts(): void }).nie_lua_web_clear_scripts();
    },
    replay(screen, requestJson) {
      const { ptr: screenPtr, len: screenLen } = writeCString(screen);
      const { ptr: requestPtr, len: requestLen } = writeCString(requestJson);
      const resultPtr = exportsFn.nie_lua_web_replay(screenPtr, requestPtr);
      exportsFn.nie_lua_web_dealloc(screenPtr, screenLen);
      exportsFn.nie_lua_web_dealloc(requestPtr, requestLen);
      const result = readCString(resultPtr);
      exportsFn.nie_lua_web_free_string(resultPtr);
      return result;
    },
  };
}
