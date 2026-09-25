/**
 * `@aphrody/nie` must be importable without `iecode`, and must fail loudly — naming the build
 * command — only when a native function is actually called.
 *
 * Why it matters: `bunfig.toml` preloads `@nie/plugin`, which imports this module. When the
 * import itself ran `dlopen`, a missing library broke EVERY `bun` command in the repository
 * (typecheck, docs:check, lint, tests with no native code), with an `ERR_DLOPEN_FAILED` that
 * pointed nowhere near the cause.
 *
 * The absent-library cases run in a child process: this process may already have opened the
 * real library, and module state cannot be reset in place. `NIE_FFI_PATH` pins the child to a
 * path that does not exist, whatever `target/` contains.
 */

import { describe, expect, test } from "bun:test";
import { suffix } from "bun:ffi";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { SO_CANDIDATES } from "./index.ts";

const ENTRY = pathToFileURL(resolve(import.meta.dir, "index.ts")).href;
const MISSING = join(tmpdir(), `nie-lazy-load-${process.pid}`, `iecode.${suffix}`);

interface Probe {
  soPath: string;
  available: boolean;
  emptyCrc: number;
  emptyFormat: string;
  cstrBytes: number;
  error: { name: string; message: string; path: string } | null;
}

/** Imports the module in a fresh Bun with no reachable library, then calls into it. */
function probeWithoutLibrary(call: string): Probe {
  const script = `
    const nie = await import(${JSON.stringify(ENTRY)});
    const probe = {
      soPath: nie.SO_PATH,
      available: nie.nativeAvailable(),
      emptyCrc: nie.crc32(""),
      emptyFormat: nie.detectFormat(new Uint8Array(0)).name,
      cstrBytes: nie.cstr("ab").byteLength,
      error: null,
    };
    try { ${call}; } catch (e) { probe.error = { name: e.name, message: e.message, path: e.path }; }
    console.log(JSON.stringify(probe));
  `;
  const child = Bun.spawnSync([process.execPath, "-e", script], {
    cwd: import.meta.dir,
    env: { ...process.env, NIE_FFI_PATH: MISSING },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = child.stdout.toString().trim();
  if (child.exitCode !== 0) {
    throw new Error(`child exited with ${child.exitCode}: ${child.stderr.toString()}`);
  }
  return JSON.parse(stdout.split(/\r?\n/).at(-1)!) as Probe;
}

describe("lazy native loading", () => {
  test("import without the library does not throw, and pure paths stay usable", () => {
    const probe = probeWithoutLibrary("void 0");
    expect(probe.soPath).toBe(MISSING);
    expect(probe.available).toBe(false);
    // These early-return before any symbol lookup and must keep working with no library.
    expect(probe.emptyCrc).toBe(0);
    expect(probe.emptyFormat).toBe("Unknown");
    expect(probe.cstrBytes).toBe(3);
    expect(probe.error).toBeNull();
  });

  test("a native call without the library throws NativeLibraryError naming the build command", () => {
    const probe = probeWithoutLibrary('nie.crc32("Focus")');
    expect(probe.error).not.toBeNull();
    expect(probe.error!.name).toBe("NativeLibraryError");
    expect(probe.error!.path).toBe(MISSING);
    expect(probe.error!.message).toContain(MISSING);
    expect(probe.error!.message).toContain("the file does not exist");
    expect(probe.error!.message).toContain("cargo build -p nie-ffi");
    expect(probe.error!.message).toContain("NIE_FFI_PATH");
  });

  test("every entry point that reaches Rust fails the same explicit way", () => {
    for (const call of [
      'nie.decode(new Uint8Array([1, 2, 3]))',
      'nie.decodeToPng(new Uint8Array([1]))',
      'nie.version()',
      'new nie.CRand(1)',
      'nie.vfsOpen("missing")',
      'nie.wiki({ op: "search" })',
    ]) {
      const probe = probeWithoutLibrary(call);
      expect(probe.error?.name).toBe("NativeLibraryError");
    }
  });
});

describe("library search order", () => {
  test("host-default target/<profile> locations keep priority over target/<triple> builds", () => {
    const normalized = SO_CANDIDATES.map((path) => path.replaceAll("\\", "/"));
    const firstTriple = normalized.findIndex((path) => /\/target\/[^/]+-[^/]+\/(debug|release)\//.test(path));
    const defaults = normalized.filter((path) => /\/target\/(debug|release)\//.test(path));
    expect(defaults.length).toBeGreaterThan(0);
    expect(normalized.slice(0, defaults.length)).toEqual(defaults);
    // debug before release, as before the triple-aware search existed.
    expect(defaults[0]).toContain("/target/debug/");
    expect(defaults.at(-1)).toContain("/target/release/");
    if (firstTriple !== -1) expect(firstTriple).toBe(defaults.length);
  });

  test.if(process.platform === "win32" && process.arch === "x64")(
    "the windows-gnu build output is searched",
    () => {
      const normalized = SO_CANDIDATES.map((path) => path.replaceAll("\\", "/"));
      expect(normalized.some((path) => path.endsWith("/target/x86_64-pc-windows-gnu/release/iecode.dll"))).toBe(true);
    },
  );
});
