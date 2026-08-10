/**
 * Tests @niers/catalog.
 *
 * Deux suites :
 *  1. CatalogDb sur données synthétiques (in-memory) — toujours exécutés.
 *  2. indexVfs sur le vrai VFS — gated sur NIE_GAME_DIR / présence de
 *     data/cpk_list.cfg.bin (skipIf absent).
 *
 * Lancer :
 *   bun test packages/nie-catalog/
 *   NIE_GAME_DIR=/home/aphrody/niers bun test packages/nie-catalog/
 */

import { describe, test, expect } from "bun:test";
import { existsSync } from "node:fs";
import { CatalogDb, indexVfs, type AssetRow, type ExtStat } from "./catalog.ts";

// ─── gate jeu réel ────────────────────────────────────────────────────────────

const GAME_DIR = process.env["NIE_GAME_DIR"] ?? "/home/aphrody/niers";
const DATA_DIR = `${GAME_DIR}/data`;
const HAS_GAME = existsSync(`${DATA_DIR}/cpk_list.cfg.bin`);

// ─── données synthétiques ─────────────────────────────────────────────────────

const SYNTHETIC: ReadonlyArray<{ path: string; cpk: string; size: number }> = [
  { path: "data/dx11/menu/mainmenu01.g4tx",    cpk: "menu.cpk",      size: 131072 },
  { path: "data/dx11/menu/title02.g4tx",       cpk: "menu.cpk",      size: 65536  },
  { path: "data/common/gamedata/main.cfg.bin", cpk: "common.cpk",    size: 2048   },
  { path: "data/dx11/chara/c001/c001.g4pkm",  cpk: "chara.cpk",     size: 8192   },
  { path: "data/common/sound/bgm01.lip",       cpk: "sound.cpk",     size: 32768  },
  { path: "data/dx11/chara/c002/c002.g4pkm",  cpk: "chara.cpk",     size: 8200   },
  { path: "data/common/no-extension",          cpk: "misc.cpk",      size: 256    },
];

// ─── suite 1 : CatalogDb in-memory, données synthétiques ─────────────────────

describe("CatalogDb (in-memory, synthétique)", () => {
  test("index() retourne le nombre de lignes insérées", () => {
    using db = new CatalogDb();
    const n = db.index(SYNTHETIC);
    expect(n).toBe(SYNTHETIC.length);
  });

  test("index([]) retourne 0", () => {
    using db = new CatalogDb();
    expect(db.index([])).toBe(0);
  });

  test("byExt('g4tx') retourne exactement les 2 .g4tx synthétiques", () => {
    using db = new CatalogDb();
    db.index(SYNTHETIC);
    const rows = db.byExt("g4tx");
    expect(rows.length).toBe(2);
    expect(rows.every((r: AssetRow) => r.ext === "g4tx")).toBe(true);
  });

  test("byExt accepte un point initial ('.g4tx' ≡ 'g4tx')", () => {
    using db = new CatalogDb();
    db.index(SYNTHETIC);
    expect(db.byExt(".g4tx").length).toBe(2);
  });

  test("byExt est insensible à la casse de l'argument", () => {
    using db = new CatalogDb();
    db.index(SYNTHETIC);
    expect(db.byExt("G4TX").length).toBe(2);
    expect(db.byExt("G4Tx").length).toBe(2);
  });

  test("byExt sur extension absente retourne []", () => {
    using db = new CatalogDb();
    db.index(SYNTHETIC);
    expect(db.byExt("png").length).toBe(0);
  });

  test("AssetRow.internal_path correspond au chemin d'origine", () => {
    using db = new CatalogDb();
    db.index(SYNTHETIC);
    // extOf extrait APRES le DERNIER point : "main.cfg.bin" → ext="bin"
    const rows = db.byExt("bin");
    expect(rows.length).toBe(1);
    expect(rows[0]!.internal_path).toBe("data/common/gamedata/main.cfg.bin");
  });

  test("AssetRow.id est un number (Bun.hash wyhash converti)", () => {
    using db = new CatalogDb();
    db.index(SYNTHETIC);
    const rows = db.byExt("g4tx");
    for (const row of rows) {
      expect(typeof row.id).toBe("number");
      expect(Number.isFinite(row.id)).toBe(true);
    }
  });

  test("AssetRow.size est préservé exactement", () => {
    using db = new CatalogDb();
    db.index(SYNTHETIC);
    const rows = db.byExt("g4tx");
    const sizes = rows.map((r: AssetRow) => r.size).sort((a, b) => a - b);
    expect(sizes).toEqual([65536, 131072]);
  });

  test("search('**/*.g4tx') correspond aux 2 g4tx", () => {
    using db = new CatalogDb();
    db.index(SYNTHETIC);
    const rows = db.search("**/*.g4tx");
    expect(rows.length).toBe(2);
    expect(rows.every((r: AssetRow) => r.ext === "g4tx")).toBe(true);
  });

  test("search('**/*.g4pkm') correspond aux 2 g4pkm", () => {
    using db = new CatalogDb();
    db.index(SYNTHETIC);
    const rows = db.search("**/*.g4pkm");
    expect(rows.length).toBe(2);
  });

  test("search avec chemin partiel spécifique ne retourne qu'un subset", () => {
    using db = new CatalogDb();
    db.index(SYNTHETIC);
    // Seuls les chara
    const rows = db.search("data/dx11/chara/**");
    expect(rows.length).toBe(2);
  });

  test("search sur pattern sans correspondance retourne []", () => {
    using db = new CatalogDb();
    db.index(SYNTHETIC);
    expect(db.search("**/*.xyz").length).toBe(0);
  });

  test("stats() contient une entrée par extension distincte", () => {
    using db = new CatalogDb();
    db.index(SYNTHETIC);
    const s: ExtStat[] = db.stats();
    // extensions: g4tx(2), g4pkm(2), bin(1), lip(1), ""(1)
    expect(s.length).toBe(5);
    const exts = s.map((e: ExtStat) => e.ext);
    expect(exts).toContain("g4tx");
    expect(exts).toContain("g4pkm");
    expect(exts).toContain("bin");
    expect(exts).toContain("lip");
    expect(exts).toContain("");         // "no-extension"
  });

  test("stats() est trié par count desc", () => {
    using db = new CatalogDb();
    db.index(SYNTHETIC);
    const s: ExtStat[] = db.stats();
    for (let i = 1; i < s.length; i++) {
      expect(s[i - 1]!.count).toBeGreaterThanOrEqual(s[i]!.count);
    }
  });

  test("stats() sur base vide retourne []", () => {
    using db = new CatalogDb();
    db.index([]);
    expect(db.stats()).toEqual([]);
  });

  test("[Symbol.dispose] (using) ferme sans throw", () => {
    expect(() => {
      using db = new CatalogDb();
      db.index(SYNTHETIC);
      // db est fermé ici automatiquement
    }).not.toThrow();
  });

  test("close() est idempotent", () => {
    const db = new CatalogDb();
    db.index(SYNTHETIC);
    expect(() => {
      db.close();
      db.close();
    }).not.toThrow();
  });
});

// ─── suite 2 : indexVfs sur le vrai VFS (gated) ──────────────────────────────

describe("indexVfs (VFS réel, gated NIE_GAME_DIR)", () => {
  test.skipIf(!HAS_GAME)(
    "indexe le VFS réel → ≥ 40 000 lignes (cap Rust 50 k)",
    async () => {
      const { db, count, elapsedMs } = await indexVfs(DATA_DIR);
      try {
        // Décompte : nie_vfs_list_json_out plafonne à 50 000 entrées côté Rust.
        // Le vrai VFS contient 254 202 assets, mais on reçoit le cap.
        expect(count).toBeGreaterThanOrEqual(40_000);
        // Durée positive (Bun.nanoseconds a tourné)
        expect(elapsedMs).toBeGreaterThan(0);

        // byExt("g4tx") retourne des résultats non vides et cohérents
        const g4tx = db.byExt("g4tx");
        expect(g4tx.length).toBeGreaterThan(0);
        expect(g4tx.every((r: AssetRow) => r.ext === "g4tx")).toBe(true);

        // stats() a des entrées + g4tx est dedans
        const s: ExtStat[] = db.stats();
        expect(s.length).toBeGreaterThan(0);
        const g4txStat = s.find((e: ExtStat) => e.ext === "g4tx");
        expect(g4txStat).toBeDefined();
        expect(g4txStat!.count).toBe(g4tx.length);
      } finally {
        db.close();
      }
    },
    120_000,
  );

  test.skipIf(!HAS_GAME)(
    "search sur le vrai VFS retourne des chemins cohérents",
    async () => {
      const { db, count } = await indexVfs(DATA_DIR);
      try {
        expect(count).toBeGreaterThanOrEqual(40_000);
        const results = db.search("data/dx11/menu/**/*.g4tx");
        expect(results.length).toBeGreaterThan(0);
        for (const r of results) {
          expect(r.internal_path).toMatch(/^data\/dx11\/menu\//);
          expect(r.ext).toBe("g4tx");
        }
      } finally {
        db.close();
      }
    },
    120_000,
  );

  test.skipIf(HAS_GAME)("skip si jeu absent (gate)", () => {
    expect(HAS_GAME).toBe(false);
  });
});
