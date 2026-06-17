/**
 * nie-plugin/src/index.ts — API programmatique publique.
 *
 * Re-exporte l'API haut niveau de `nie` et ajoute le chemin vers register.ts.
 * La registration du plugin (Bun.plugin) vit dans `./register.ts` et est chargée
 * séparément via bunfig.toml preload. Cet index n'appelle PAS Bun.plugin().
 */

import { resolve } from "node:path";

export {
  crc32,
  CRand,
  version,
  detectFormat,
  decode,
  decodeFile,
  decodeToPng,
  decodeToPngFile,
  vfsOpen,
  VfsHandle,
  callOut,
  cstr,
  SO_PATH,
  type FormatInfo,
  type VfsEntry,
} from "nie";

// ─── Artefacts RE du .exe (data/re) + scripts Lua décompilés (data/lua_scripts) ───
//
// Accès PROGRAMMATIQUE robuste (fiable au runtime). Le namespace virtuel `nie:re/*`
// du plugin (register.ts) fonctionne en contexte BUNDLER (`Bun.build`), mais les
// plugins RUNTIME de Bun ne résolvent pas les schémas virtuels via `onResolve` —
// d'où cette API qui lit directement les fichiers (déjà JSON/octets, sans FFII).

const _root = resolve(import.meta.dir, "../../.."); // packages/nie-plugin/src → racine repo
const RE_DIR = `${_root}/data/re`;
const LUA_DIR = `${_root}/data/lua_scripts`;

/**
 * Charge un artefact RE statique du `.exe` reversé : `data/re/<name>.json`.
 * Ex. : `loadRe("funclua-cmdid-handlers")`, `loadRe("menu-region-index")`.
 */
export async function loadRe<T = unknown>(name: string): Promise<T> {
  return (await Bun.file(`${RE_DIR}/${name}.json`).json()) as T;
}

/**
 * Charge un script Lua décompilé du jeu : `data/lua_scripts/<name>` (octets bruts).
 * Lister via `new Bun.Glob("*.lua.bin").scan(LUA_DIR)`.
 */
export async function loadLuaScript(name: string): Promise<Uint8Array> {
  return new Uint8Array(await Bun.file(`${LUA_DIR}/${name}`).arrayBuffer());
}

/** Répertoires sources (artefacts RE et scripts Lua). */
export const RE_PATHS = { reDir: RE_DIR, luaDir: LUA_DIR } as const;
