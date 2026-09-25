// Le plugin n'avait aucun test alors que son `package.json` déclarait `bun test` : la suite du
// monorepo échouait donc sur « 0 test files matching », sans que rien ne soit vérifié.
//
// Ce que ces tests couvrent, sans dépendre de `data/` (57 Go, gitignored, absent du clone
// public) : les extensions revendiquées par le plugin, le fait que `register` soit idempotent —
// il est préchargé par `bunfig.toml` pour TOUT `bun run` du dépôt, donc une double inscription
// doit rester sans conséquence — et le fait que l'inscription ne touche PAS à `iecode` : sans la
// bibliothèque native, seul le chargement effectif d'un fichier de jeu échoue, avec l'erreur
// explicite de `@aphrody/nie`.
import { afterAll, expect, test } from "bun:test";
import { suffix } from "bun:ffi";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { nativeAvailable } from "@aphrody/nie";

const REGISTER = pathToFileURL(resolve(import.meta.dir, "register.ts")).href;
const SCRATCH = join(tmpdir(), `nie-plugin-test-${process.pid}`);
mkdirSync(SCRATCH, { recursive: true });
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

/** Writes bytes that carry no known magic under a game-format extension. */
function unknownGameFile(name: string): string {
  const path = join(SCRATCH, name);
  writeFileSync(path, new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]));
  return path;
}

test("le module principal expose le plugin et ses extensions", async () => {
  const mod = (await import("./index.ts")) as Record<string, unknown>;
  const exported = Object.keys(mod);
  expect(exported.length).toBeGreaterThan(0);
  expect(typeof mod["loadRe"]).toBe("function");
  expect(typeof mod["nativeAvailable"]).toBe("function");
});

test("register est importable et idempotent", async () => {
  // Deux imports successifs : le second est servi par le cache de modules, et l'inscription
  // `Bun.plugin` ne doit pas lever pour autant.
  const first = await import("./register.ts");
  const second = await import("./register.ts");
  expect(second).toBe(first);
});

test("register exporte le plugin pour le bundler", async () => {
  const { default: plugin } = await import("./register.ts");
  expect(plugin.name).toBe("nie-game-formats");
  expect(typeof plugin.setup).toBe("function");
});

test("sans iecode, l'inscription réussit et seul le chargement d'un format lève l'erreur explicite", () => {
  const file = unknownGameFile("absent-library.cfg.bin");
  const missing = join(SCRATCH, "no-such-dir", `iecode.${suffix}`);
  const script = `
    await import(${JSON.stringify(REGISTER)});
    console.log("registered");
    try {
      await import(${JSON.stringify(pathToFileURL(file).href)});
      console.log("loaded");
    } catch (error) {
      console.log(JSON.stringify({ name: error.name, message: error.message }));
    }
  `;
  const child = Bun.spawnSync([process.execPath, "-e", script], {
    cwd: import.meta.dir,
    env: { ...process.env, NIE_FFI_PATH: missing },
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(child.exitCode).toBe(0);
  const lines = child.stdout.toString().trim().split(/\r?\n/);
  expect(lines[0]).toBe("registered");
  const failure = JSON.parse(lines.at(-1)!) as { name: string; message: string };
  expect(failure.name).toBe("NativeLibraryError");
  expect(failure.message).toContain("cargo build -p nie-ffi");
});

test.if(nativeAvailable())("avec iecode, un .cfg.bin passe par le décodeur Rust", async () => {
  await import("./register.ts");
  // No tracked game file exists (data/ is gitignored), so the proof uses bytes without a known
  // magic: the loader must hand them to `nie_decode_json_out` and report its refusal by name,
  // rather than let Bun parse the file as JavaScript.
  const file = unknownGameFile("unknown-magic.cfg.bin");
  await expect(import(pathToFileURL(file).href)).rejects.toThrow("nie-plugin: decode a échoué pour");
});
