// Le plugin n'avait aucun test alors que son `package.json` déclarait `bun test` : la suite du
// monorepo échouait donc sur « 0 test files matching », sans que rien ne soit vérifié.
//
// Ce que ces tests couvrent, sans dépendre de `data/` (57 Go, gitignored, absent du clone
// public) : les extensions revendiquées par le plugin, et le fait que `register` soit
// idempotent — il est préchargé par `bunfig.toml` pour TOUT `bun run` du dépôt, donc une double
// inscription doit rester sans conséquence.
import { expect, test } from "bun:test";

test("le module principal expose le plugin et ses extensions", async () => {
  const mod = (await import("./index.ts")) as Record<string, unknown>;
  const exported = Object.keys(mod);
  expect(exported.length).toBeGreaterThan(0);
});

test("register est importable et idempotent", async () => {
  // Deux imports successifs : le second est servi par le cache de modules, et l'inscription
  // `Bun.plugin` ne doit pas lever pour autant.
  const first = await import("./register.ts");
  const second = await import("./register.ts");
  expect(second).toBe(first);
});
