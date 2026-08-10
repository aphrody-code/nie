/**
 * nie-plugin/src/register.ts — Bun.plugin() runtime + nie:re/* virtual namespace.
 *
 * Ce fichier est conçu pour être chargé en préchargement via bunfig.toml [preload].
 * À l'import, il appelle Bun.plugin() une seule fois, enregistrant :
 *
 *   A) onLoad pour les extensions de formats de jeu IEVR :
 *      .g4tx          → Uint8Array PNG (nie_g4tx_to_png_out)
 *      .cfg.bin       → object JSON parsé (nie_decode_json_out, dispatch RDBN)
 *      .objbin        → object JSON parsé (nie_decode_json_out, dispatch T2B/OBJB)
 *      .g4pkm         → object JSON parsé (nie_decode_json_out, dispatch G4PK layout 2D)
 *      .lip / .p3lip  → object JSON parsé (nie_decode_json_out, dispatch LIP)
 *      .mev/.mevbin   → object JSON parsé (nie_decode_json_out, dispatch T2B mevbin)
 *      .g4md          → object JSON parsé (nie_decode_json_out, dispatch G4MD)
 *
 *   B) onResolve + onLoad pour nie:re/* (données RE statiques, sans FFI) :
 *      nie:re/funclua-cmdid-handlers  → objet JSON
 *      nie:re/menu-crc32-dictionary   → objet JSON
 *      nie:re/menu-region-index       → objet JSON
 *      nie:re/lua/<nom>               → Uint8Array (data/lua_scripts/<nom>)
 *
 * Chemins depuis packages/nie-plugin/src/ :
 *   ../../.. = racine workspace niers/
 */

import { decode, decodeToPng } from "nie";

// ─── chemins des données RE ─────────────────────────────────────────────────

// import.meta.dir = packages/nie-plugin/src → 3 niveaux → niers/
const _wsRoot = `${import.meta.dir}/../../..`;
const RE_DIR  = `${_wsRoot}/data/re`;
const LUA_DIR = `${_wsRoot}/data/lua_scripts`;

// ─── utilitaires partagés ───────────────────────────────────────────────────

/** Lit un fichier en Uint8Array via Bun.file (lazy, zero-copy). */
async function readBytes(path: string): Promise<Uint8Array> {
  const ab = await Bun.file(path).arrayBuffer();
  return new Uint8Array(ab);
}

// ─── Bun.plugin() ───────────────────────────────────────────────────────────

Bun.plugin({
  name: "nie-game-formats",

  setup(build) {
    // ── A1 : .g4tx → Uint8Array PNG ────────────────────────────────────────
    build.onLoad({ filter: /\.g4tx$/ }, async ({ path }) => {
      const raw = await readBytes(path);
      const png = decodeToPng(raw);
      if (png === null) {
        throw new Error(`nie-plugin: decodeToPng a échoué pour ${path} (BC7/NXTCH non supporté ?)`);
      }
      return { loader: "object", exports: { default: png } };
    });

    // ── A2 : .cfg.bin → objet JSON ──────────────────────────────────────────
    build.onLoad({ filter: /\.cfg\.bin$/ }, async ({ path }) => {
      const raw = await readBytes(path);
      const obj = decode(raw);
      if (obj === null) {
        throw new Error(`nie-plugin: decode a échoué pour ${path}`);
      }
      return { loader: "object", exports: { default: obj } };
    });

    // ── A3 : .objbin → objet JSON (MenuObject T2B) ──────────────────────────
    build.onLoad({ filter: /\.objbin$/ }, async ({ path }) => {
      const raw = await readBytes(path);
      const obj = decode(raw);
      if (obj === null) {
        throw new Error(`nie-plugin: decode a échoué pour ${path}`);
      }
      return { loader: "object", exports: { default: obj } };
    });

    // ── A4 : .g4pkm → objet JSON (G4pkmLayout) ─────────────────────────────
    build.onLoad({ filter: /\.g4pkm$/ }, async ({ path }) => {
      const raw = await readBytes(path);
      const obj = decode(raw);
      if (obj === null) {
        throw new Error(`nie-plugin: decode a échoué pour ${path}`);
      }
      return { loader: "object", exports: { default: obj } };
    });

    // ── A5 : .lip / .p3lip → objet JSON (LipSync) ──────────────────────────
    build.onLoad({ filter: /\.(p3)?lip$/ }, async ({ path }) => {
      const raw = await readBytes(path);
      const obj = decode(raw);
      if (obj === null) {
        throw new Error(`nie-plugin: decode a échoué pour ${path}`);
      }
      return { loader: "object", exports: { default: obj } };
    });

    // ── A6 : .mev / .mevbin → objet JSON (MevbinDocument) ──────────────────
    build.onLoad({ filter: /\.(mev|mevbin)$/ }, async ({ path }) => {
      const raw = await readBytes(path);
      const obj = decode(raw);
      if (obj === null) {
        throw new Error(`nie-plugin: decode a échoué pour ${path}`);
      }
      return { loader: "object", exports: { default: obj } };
    });

    // ── A7 : .g4md → objet JSON (G4md) ─────────────────────────────────────
    build.onLoad({ filter: /\.g4md$/ }, async ({ path }) => {
      const raw = await readBytes(path);
      const obj = decode(raw);
      if (obj === null) {
        throw new Error(`nie-plugin: decode a échoué pour ${path}`);
      }
      return { loader: "object", exports: { default: obj } };
    });

    // ── B : nie:re/* — données RE statiques ─────────────────────────────────
    build.onResolve({ filter: /^nie:re\// }, ({ path }) => {
      const sfx = path.slice("nie:re/".length);
      return { path: sfx, namespace: "nie-re" };
    });

    build.onLoad({ filter: /.*/, namespace: "nie-re" }, async ({ path }) => {
      if (path.startsWith("lua/")) {
        const name = path.slice("lua/".length);
        const disk = `${LUA_DIR}/${name}`;
        const raw = await readBytes(disk);
        return { loader: "object", exports: { default: raw } };
      }
      // Artefacts RE JSON
      const disk = `${RE_DIR}/${path}.json`;
      const text = await Bun.file(disk).text();
      return { loader: "json", contents: text };
    });
  },
});
