#!/usr/bin/env bun
// Differential proof: replay the 14 `runtime_matrix.results` families from
// `data/menu/manifest.json` both through the browser-target wasm module (this crate) and
// through the live native site's `POST /api/v1/menu/runtime/{screen}` route, and deep-compare
// the JSON. Run with `bun --bun crates/engine/nie-lua-web/scripts/differential.ts`.
//
// Script discovery: `nie_lua::menu_runtime::replay` resolves `INCLUDE`s lazily against
// whatever paths were registered, exactly like the native VFS closure. So instead of tracing
// includes by hand, this script registers every `.lua.bin` under `data/common/script/lua/`
// (651 files, measured) plus every `*_setting.cfg.bin` under
// `data/common/gamedata/menu/cfg/`, fetched from the site's `/f/{path}`.
import { createLuaRuntime } from "../js/nie-lua-web.ts";

const SITE = "http://127.0.0.1:8085";
// L'artefact vit à la RACINE du profil, pas sous `deps/` : `cargo build` y dépose le cdylib
// final, et `deps/` ne porte que les objets intermédiaires. Le chemin `deps/` de la première
// version n'existait déjà plus au moment où ce script a servi.
const WASM_PATH = new URL(
  "../../../../target/wasm32-unknown-emscripten/release/nie_lua_web.wasm",
  import.meta.url,
).pathname;

interface SearchEntry {
  chemin: string;
  taille: number;
}

interface SearchResponse {
  fichiers: SearchEntry[];
  total: number;
}

async function searchAll(prefixe: string): Promise<SearchEntry[]> {
  const perPage = 500;
  let page = 1;
  const out: SearchEntry[] = [];
  for (;;) {
    const url = `${SITE}/api/v1/recherche?prefixe=${encodeURIComponent(prefixe)}&per_page=${perPage}&page=${page}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`recherche ${prefixe} page ${page}: HTTP ${response.status}`);
    const body = (await response.json()) as SearchResponse;
    out.push(...body.fichiers);
    if (out.length >= body.total || body.fichiers.length === 0) break;
    page += 1;
  }
  return out;
}

async function fetchBytes(path: string): Promise<Uint8Array> {
  const response = await fetch(`${SITE}/f/${path}`);
  if (!response.ok) throw new Error(`/f/${path}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

function firstDifferingPath(a: unknown, b: unknown, path = "$"): string | null {
  if (a === b) return null;
  if (typeof a !== typeof b) return path;
  if (a === null || b === null) return path;
  if (typeof a !== "object") return path;
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(aObj), ...Object.keys(bObj)]);
  for (const key of keys) {
    const sub = firstDifferingPath(aObj[key], bObj[key], `${path}.${key}`);
    if (sub) return sub;
  }
  return null;
}

async function main() {
  const manifestPath = new URL("../../../../data/menu/manifest.json", import.meta.url).pathname;
  const manifest = await Bun.file(manifestPath).json();
  const screens: string[] = manifest.runtime_matrix.results.map((r: { screen: string }) => r.screen);
  console.log(`${screens.length} families from runtime_matrix.results`);

  console.log("Fetching wasm module...");
  const wasmBytes = await Bun.file(WASM_PATH).arrayBuffer();
  const runtime = await createLuaRuntime(wasmBytes);

  console.log("Listing scripts (data/common/script/lua/) and menu configs (data/common/gamedata/menu/cfg/)...");
  const [scripts, configs] = await Promise.all([
    searchAll("data/common/script/lua/"),
    searchAll("data/common/gamedata/menu/cfg/"),
  ]);
  console.log(`  ${scripts.length} .lua.bin under scripts, ${configs.length} entries under menu/cfg`);

  const toLoad = [...scripts, ...configs.filter((entry) => entry.chemin.endsWith("_setting.cfg.bin"))];
  let loaded = 0;
  for (const entry of toLoad) {
    try {
      const bytes = await fetchBytes(entry.chemin);
      runtime.loadScript(entry.chemin, bytes);
      loaded += 1;
    } catch (error) {
      console.error(`  failed to fetch ${entry.chemin}: ${(error as Error).message}`);
    }
  }
  console.log(`Loaded ${loaded}/${toLoad.length} files into the wasm registry`);

  // Le texte localisé, que le site natif lit dans le VFS et que le module ne pouvait pas avoir
  // avant l'ABI `nie_lua_web_load_text` (2026-09-13). Sans lui, les scènes comparées n'ont pas
  // de libellés d'un côté et en ont de l'autre, et treize écrans sur quatorze divergeaient
  // là-dessus sans que la VM soit en cause.
  const menuText: Array<[number, string]> = [];
  for (let page = 1; ; page += 1) {
    const body = await (await fetch(`${SITE}/api/v1/text/fr/menu_text?page=${page}&per_page=200`)).json();
    for (const ligne of body.results?.elements ?? []) menuText.push([ligne.hash, ligne.text]);
    if (page >= (body.results?.pages ?? 1)) break;
  }
  runtime.loadText(menuText);
  console.log(`Loaded ${menuText.length} localised menu lines`);

  let identical = 0;
  const rows: Array<{ screen: string; status: string; detail: string }> = [];
  for (const screen of screens) {
    let wasmJson: unknown;
    let wasmError: string | null = null;
    try {
      const raw = runtime.replay(screen, "{}");
      wasmJson = JSON.parse(raw);
      if (wasmJson && typeof wasmJson === "object" && "error" in (wasmJson as object)) {
        wasmError = (wasmJson as { error: string }).error;
      }
    } catch (error) {
      wasmError = `wasm threw: ${(error as Error).message}`;
    }

    const nativeResponse = await fetch(`${SITE}/api/v1/menu/runtime/${screen}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const nativeText = await nativeResponse.text();
    let nativeJson: unknown;
    try {
      nativeJson = JSON.parse(nativeText);
    } catch {
      nativeJson = { error: `non-JSON native response (HTTP ${nativeResponse.status})` };
    }

    if (wasmError !== null) {
      rows.push({ screen, status: "WASM ERROR", detail: wasmError });
      continue;
    }
    // `missing` décrit ce qui manque À CHAQUE HÔTE, pas ce que la VM calcule : le site a un VFS,
    // le module a ce que JS lui a déposé, et leurs manques n'ont aucune raison de coïncider. Le
    // comparer mesurerait l'écart des MONTAGES — le même piège que `visible` dans la comparaison
    // de layouts, qui rendait « différent » à chaque appel.
    const sansMissing = (v: unknown) => {
      if (!v || typeof v !== "object") return v;
      const { missing, ...reste } = v as Record<string, unknown>;
      return reste;
    };
    const diff = firstDifferingPath(sansMissing(wasmJson), sansMissing(nativeJson));
    if (diff === null) {
      identical += 1;
      rows.push({ screen, status: "IDENTICAL", detail: "-" });
    } else {
      rows.push({ screen, status: "DIFFERS", detail: diff });
    }
  }

  console.log("\n| screen | status | first differing key / error |");
  console.log("|---|---|---|");
  for (const row of rows) {
    console.log(`| ${row.screen} | ${row.status} | ${row.detail} |`);
  }
  console.log(`\n${identical}/${screens.length} identical`);
}

await main();
