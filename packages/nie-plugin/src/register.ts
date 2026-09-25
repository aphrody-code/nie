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
 * **Registering touches no native code.** This file is preloaded by EVERY `bun` command run from
 * the repository root, so it must not need `iecode`: `@aphrody/nie` is imported on the first
 * game-format load, not here. Without the library, `bun run typecheck`, `docs:check`, `lint` and
 * every test that imports no game file keep working; importing a `.g4tx` then fails with the
 * binding's `NativeLibraryError`, which names the build command.
 *
 * Le plugin est aussi l'export par défaut, pour le bundler :
 *   Bun.build({ plugins: [(await import("@nie/plugin/register")).default] })
 *
 * Chemins depuis packages/nie-plugin/src/ :
 *   ../../.. = racine workspace nie/
 */

import type { BunPlugin } from "bun";

// ─── chemins des données RE ─────────────────────────────────────────────────

// import.meta.dir = packages/nie-plugin/src → 3 niveaux → nie/
const _wsRoot = process.env["NIE_ROOT"] ?? `${import.meta.dir}/../../..`;
const RE_DIR  = `${_wsRoot}/data/re`;
const LUA_DIR = `${_wsRoot}/data/lua_scripts`;

// ─── utilitaires partagés ───────────────────────────────────────────────────

/** Lit un fichier en Uint8Array via Bun.file (lazy, zero-copy). */
async function readBytes(path: string): Promise<Uint8Array> {
  const ab = await Bun.file(path).arrayBuffer();
  return new Uint8Array(ab);
}

let _binding: Promise<typeof import("@aphrody/nie")> | undefined;

/** The FFI binding, imported on first use so that registering stays free of native code. */
function binding(): Promise<typeof import("@aphrody/nie")> {
  _binding ??= import("@aphrody/nie");
  return _binding;
}

/**
 * Extensions decoded to a JSON object by `nie_decode_json_out`, which dispatches on the file's
 * magic bytes. Each entry is registered as its own `onLoad`.
 */
const JSON_FORMATS: readonly RegExp[] = [
  /\.cfg\.bin$/,       // RDBN
  /\.objbin$/,         // MenuObject T2B
  /\.g4pkm$/,          // G4pkmLayout
  /\.(p3)?lip$/,       // LipSync
  /\.(mev|mevbin)$/,   // MevbinDocument
  /\.g4md$/,           // G4md
];

// ─── Bun.plugin() ───────────────────────────────────────────────────────────

const plugin: BunPlugin = {
  name: "nie-game-formats",

  setup(build) {
    // ── A1 : .g4tx → Uint8Array PNG ────────────────────────────────────────
    build.onLoad({ filter: /\.g4tx$/ }, async ({ path }) => {
      const raw = await readBytes(path);
      const png = (await binding()).decodeToPng(raw);
      if (png === null) {
        throw new Error(`nie-plugin: decodeToPng a échoué pour ${path} (BC7/NXTCH non supporté ?)`);
      }
      return { loader: "object", exports: { default: png } };
    });

    // ── A2…A7 : formats décodés en objet JSON ───────────────────────────────
    for (const filter of JSON_FORMATS) {
      build.onLoad({ filter }, async ({ path }) => {
        const raw = await readBytes(path);
        const obj = (await binding()).decode(raw);
        if (obj === null) {
          throw new Error(`nie-plugin: decode a échoué pour ${path}`);
        }
        return { loader: "object", exports: { default: obj } };
      });
    }

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
};

Bun.plugin(plugin);

export default plugin;
