/**
 * Tests unitaires de @niers/util — entrées synthétiques uniquement (pas de données jeu).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import {
  stringWidth,
  gzip,
  gunzip,
  zstdCompress,
  zstdDecompress,
  tableFormat,
  inspect,
  requireBunVersion,
  semverOrder,
  escapeHTML,
  deepEquals,
  randomUUIDv7,
  peekPromise,
  which,
  nanoseconds,
  readConfig,
} from "./index.ts";

// ─── (a) stringWidth ─────────────────────────────────────────────────────────

describe("stringWidth", () => {
  test("ASCII basique", () => {
    expect(stringWidth("hello")).toBe(5);
    expect(stringWidth("")).toBe(0);
    expect(stringWidth("a")).toBe(1);
  });

  test("séquences ANSI ignorées par défaut", () => {
    expect(stringWidth("\x1b[31mhello\x1b[0m")).toBe(5);
    expect(stringWidth("\x1b[1;32mGOAL!\x1b[0m")).toBe(5);
  });

  test("séquences ANSI comptées si countAnsiEscapeCodes: true", () => {
    const withAnsi = "\x1b[31mhello\x1b[0m";
    const counted = stringWidth(withAnsi, { countAnsiEscapeCodes: true });
    expect(counted).toBeGreaterThan(5);
  });

  test("caractères CJK larges = 2 colonnes chacun", () => {
    expect(stringWidth("日本語")).toBe(6);
    expect(stringWidth("你好")).toBe(4);
  });

  test("emoji simple = 1 colonne (ambiguousIsNarrow: true par défaut)", () => {
    expect(stringWidth("A")).toBe(1);
  });
});

// ─── (b) Compression ─────────────────────────────────────────────────────────

const _source = new TextEncoder().encode("Inazuma Eleven Victory Road".repeat(200));

describe("gzip / gunzip", () => {
  test("roundtrip", () => {
    const compressed = gzip(_source);
    const restored = gunzip(compressed);
    expect(restored).toEqual(_source);
  });

  test("compressé < original", () => {
    const compressed = gzip(_source);
    expect(compressed.length).toBeLessThan(_source.length);
  });

  test("niveau 9 <= niveau 1", () => {
    const fast = gzip(_source, { level: 1 });
    const best = gzip(_source, { level: 9 });
    expect(best.length).toBeLessThanOrEqual(fast.length);
  });
});

describe("zstdCompress / zstdDecompress", () => {
  test("roundtrip", () => {
    const compressed = zstdCompress(_source);
    const restored = zstdDecompress(compressed);
    expect(restored).toEqual(_source);
  });

  test("compressé < original", () => {
    const compressed = zstdCompress(_source);
    expect(compressed.length).toBeLessThan(_source.length);
  });

  test("niveau explicite roundtrip", () => {
    const compressed = zstdCompress(_source, { level: 19 });
    const restored = zstdDecompress(compressed);
    expect(restored).toEqual(_source);
  });
});

// ─── (c) tableFormat / inspect ───────────────────────────────────────────────

describe("tableFormat", () => {
  test("produit une chaîne non vide", () => {
    const t = tableFormat([
      { name: "foo", size: 42 },
      { name: "bar", size: 1337 },
    ]);
    expect(typeof t).toBe("string");
    expect(t.length).toBeGreaterThan(0);
    expect(t).toContain("name");
    expect(t).toContain("size");
    expect(t).toContain("foo");
    expect(t).toContain("bar");
  });

  test("tableau vide ne plante pas", () => {
    const t = tableFormat([]);
    expect(typeof t).toBe("string");
  });
});

describe("inspect", () => {
  test("retourne une représentation lisible", () => {
    const s = inspect({ a: 1, b: [2, 3] });
    expect(s).toContain("a");
    expect(s).toContain("b");
    expect(s).toContain("1");
  });

  test("profondeur configurable", () => {
    const deep = { x: { y: { z: 99 } } };
    const shallow = inspect(deep, 1);
    const full = inspect(deep, 3);
    expect(full).toContain("99");
    // shallow coupe à depth 1 — z absent
    expect(shallow).not.toContain("99");
  });
});

// ─── (d) requireBunVersion / semverOrder ─────────────────────────────────────

describe("requireBunVersion", () => {
  test("passe pour >=1.3", () => {
    expect(() => requireBunVersion(">=1.3")).not.toThrow();
  });

  test("passe pour ^1.0.0", () => {
    expect(() => requireBunVersion("^1.0.0")).not.toThrow();
  });

  test("lève une erreur pour >=999.0.0", () => {
    expect(() => requireBunVersion(">=999.0.0")).toThrow(/ne satisfait pas/);
  });

  test("message d'erreur contient la version et la contrainte", () => {
    try {
      requireBunVersion(">=999.0.0");
    } catch (e) {
      expect(String(e)).toContain(Bun.version);
      expect(String(e)).toContain(">=999.0.0");
    }
  });
});

describe("semverOrder", () => {
  test("1.3.0 > 1.2.9", () => {
    expect(semverOrder("1.3.0", "1.2.9")).toBe(1);
  });

  test("1.2.9 < 1.3.0", () => {
    expect(semverOrder("1.2.9", "1.3.0")).toBe(-1);
  });

  test("égalité", () => {
    expect(semverOrder("1.3.0", "1.3.0")).toBe(0);
  });
});

// ─── (e) Utilitaires divers ───────────────────────────────────────────────────

describe("escapeHTML", () => {
  test("échappe < > &", () => {
    expect(escapeHTML("<div>")).toBe("&lt;div&gt;");
    expect(escapeHTML("a & b")).toBe("a &amp; b");
  });

  test('échappe les guillemets doubles', () => {
    expect(escapeHTML('"hello"')).toBe("&quot;hello&quot;");
  });

  test("chaîne sans caractères spéciaux — inchangée", () => {
    expect(escapeHTML("hello world")).toBe("hello world");
  });
});

describe("deepEquals", () => {
  test("objets identiques", () => {
    expect(deepEquals({ a: 1, b: [2, 3] }, { a: 1, b: [2, 3] })).toBe(true);
  });

  test("objets différents", () => {
    expect(deepEquals({ a: 1 }, { a: 2 })).toBe(false);
  });

  test("tableaux identiques", () => {
    expect(deepEquals([1, 2, 3], [1, 2, 3])).toBe(true);
  });

  test("primitives", () => {
    expect(deepEquals(42, 42)).toBe(true);
    expect(deepEquals(42, "42")).toBe(false);
  });

  test("mode strict : 0 !== false", () => {
    // sans strict : peut être égal selon implémentation
    // avec strict : 0 !== false
    expect(deepEquals(0, false, true)).toBe(false);
  });
});

describe("randomUUIDv7", () => {
  const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  test("format UUID v7", () => {
    const uuid = randomUUIDv7();
    expect(uuid).toMatch(UUID_V7);
  });

  test("deux appels successifs produisent des valeurs différentes", () => {
    expect(randomUUIDv7()).not.toBe(randomUUIDv7());
  });

  test("ordre croissant (monotonie temporelle)", () => {
    const a = randomUUIDv7();
    const b = randomUUIDv7();
    // UUID v7 tri lexicographique = ordre temporel
    expect(a <= b).toBe(true);
  });
});

describe("peekPromise", () => {
  test("promise déjà résolue — retourne la valeur directement", () => {
    const p = Promise.resolve(42);
    // await la promise pour qu'elle soit settled
    const val = peekPromise(p);
    // La promise est résolue immédiatement par Promise.resolve
    expect(val).toBe(42);
  });

  test("promise résolue après await", async () => {
    const p = Promise.resolve("bonjour");
    await p;
    const val = peekPromise(p);
    expect(val).toBe("bonjour");
  });
});

describe("which", () => {
  test("bun est dans le PATH", () => {
    const path = which("bun");
    expect(path).not.toBeNull();
    expect(path).toContain("bun");
  });

  test("commande inexistante → null", () => {
    expect(which("commande_qui_nexiste_pas_xyz123")).toBeNull();
  });
});

describe("nanoseconds", () => {
  test("retourne un nombre positif", () => {
    const t = nanoseconds();
    expect(typeof t).toBe("number");
    expect(t).toBeGreaterThan(0);
  });

  test("croissant entre deux appels", () => {
    const t0 = nanoseconds();
    const t1 = nanoseconds();
    expect(t1).toBeGreaterThanOrEqual(t0);
  });
});

// ─── (f) readConfig ──────────────────────────────────────────────────────────

describe("readConfig", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "nie-util-test-"));
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test(".toml — Bun.TOML.parse", async () => {
    const path = join(tmpDir, "config.toml");
    await Bun.write(path, `[section]\nkey = "value"\nnumber = 42\n`);
    const cfg = await readConfig(path) as Record<string, unknown>;
    expect((cfg["section"] as Record<string, unknown>)["key"]).toBe("value");
    expect((cfg["section"] as Record<string, unknown>)["number"]).toBe(42);
  });

  test(".yaml — Bun.YAML.parse", async () => {
    const path = join(tmpDir, "config.yaml");
    await Bun.write(path, `name: niers\nversion: 0.1.0\nactive: true\n`);
    const cfg = await readConfig(path) as Record<string, unknown>;
    expect(cfg["name"]).toBe("niers");
    expect(cfg["version"]).toBe("0.1.0");
    expect(cfg["active"]).toBe(true);
  });

  test(".yml — alias de .yaml", async () => {
    const path = join(tmpDir, "config.yml");
    await Bun.write(path, `items:\n  - a\n  - b\n`);
    const cfg = await readConfig(path) as Record<string, unknown>;
    expect(cfg["items"]).toEqual(["a", "b"]);
  });

  test(".jsonl — Bun.JSONL.parse → tableau", async () => {
    const path = join(tmpDir, "data.jsonl");
    await Bun.write(path, `{"id":1,"name":"foo"}\n{"id":2,"name":"bar"}\n`);
    const rows = await readConfig(path) as Array<Record<string, unknown>>;
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.["id"]).toBe(1);
    expect(rows[1]?.["name"]).toBe("bar");
  });

  test(".json — JSON.parse", async () => {
    const path = join(tmpDir, "config.json");
    await Bun.write(path, JSON.stringify({ env: "test", port: 8080 }));
    const cfg = await readConfig(path) as Record<string, unknown>;
    expect(cfg["env"]).toBe("test");
    expect(cfg["port"]).toBe(8080);
  });

  test(".json5 — JSON.parse (sous-ensemble JSON strict)", async () => {
    const path = join(tmpDir, "config.json5");
    await Bun.write(path, `{"key": "value", "num": 1}`);
    const cfg = await readConfig(path) as Record<string, unknown>;
    expect(cfg["key"]).toBe("value");
  });

  test("extension inconnue → lève une erreur", async () => {
    const path = join(tmpDir, "config.ini");
    await Bun.write(path, "[section]\nkey=value\n");
    await expect(readConfig(path)).rejects.toThrow(/extension "\.ini" non reconnue/);
  });
});
