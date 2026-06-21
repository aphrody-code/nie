// Analyse de la famille "text-labels" : data/common/text/**/*.json
// Bun + TS haut niveau. Sortie : faits réels pour docs/game-data/text-labels.md
import { Glob } from "bun";

const ROOT = "/home/ubuntu/niers/data/common/text";

type Var = { type: string; value: string };
type Node = { name: string; variables: Var[]; children?: Node[] };
type Doc = { entries: Node[] };

const glob = new Glob("**/*.json");
const files: string[] = [];
for await (const f of glob.scan(ROOT)) files.push(f); // relatif à ROOT
files.sort();

// ---- classification par catégorie & langue ----
function classify(rel: string) {
  const parts = rel.split("/");
  // rel ex: "en/event/ev27_06300.cfg.bin.json", "event/ev23_01210_map.cfg.bin.json",
  //         "common/system_text_map.cfg.bin.json", "en/help_list_text.cfg.bin.json"
  const top = parts[0];
  let lang = "-";
  let cat = "?";
  if (top === "en" || top === "fr" || top === "ja") {
    lang = top;
    if (parts.length === 2) cat = "root";
    else cat = parts[1]; // event/map/phase/purpose
  } else if (top === "common") {
    cat = "common";
  } else if (top === "event") {
    cat = "event_map";
  } else if (top === "map") {
    cat = "npc_text_map";
  }
  return { lang, cat };
}

type Stat = {
  files: number;
  entries: number; // somme des children (TEXT_INFO_n)
  schemas: Map<string, number>; // signature de type -> nb fichiers
  emptyStr: number; // children dont la 1ere String est vide
};
const byKey = new Map<string, Stat>(); // key = `${cat}|${lang}`
function stat(key: string): Stat {
  let s = byKey.get(key);
  if (!s) { s = { files: 0, entries: 0, schemas: new Map(), emptyStr: 0 }; byKey.set(key, s); }
  return s;
}

// signature du schéma d'un fichier = types des variables du 1er child
function sigOf(child: Node): string {
  return child.variables.map(v => v.type === "String" ? "Str" : "Int").join(",");
}

const beginNames = new Map<string, number>(); // nom du noeud BEGIN -> count fichiers

// pour échantillons de libellés sur tables racines clés
const wantSamples = new Set([
  "menu_text", "system_text", "item_text", "skill_text", "chara_text",
  "team_text", "shop_text", "map_text", "soccer_technic_text",
  "rpg_battle_cmd_text", "help_list_text", "trophy_text", "mission_text",
  "quest_title_text", "soccer_quick_action_text", "soccer_team_passive_text",
  "music_name_text", "craft_text", "medal_text", "chara_nickname_text",
  "dictionary_text", "post_text", "chat_text", "setting_text",
]);
const samples = new Map<string, { lang: string; n: number; rows: [number, string][] }>();

let totalChildren = 0;
let parseErr = 0;

for (const rel of files) {
  const { lang, cat } = classify(rel);
  const key = `${cat}|${lang}`;
  const s = stat(key);
  s.files++;
  let doc: Doc;
  try {
    doc = await Bun.file(`${ROOT}/${rel}`).json();
  } catch { parseErr++; continue; }
  const entries = doc.entries ?? [];
  let firstChildSig: string | null = null;
  for (const e of entries) {
    const bn = e.name.replace(/_\d+$/, ""); // TEXT_INFO_BEGIN_0 -> TEXT_INFO_BEGIN
    beginNames.set(bn, (beginNames.get(bn) ?? 0) + 1);
    const ch = e.children ?? [];
    s.entries += ch.length;
    totalChildren += ch.length;
    for (const c of ch) {
      if (firstChildSig === null) firstChildSig = sigOf(c);
      // 1ère String vide ?
      const str = c.variables.find(v => v.type === "String");
      if (str && str.value === "") s.emptyStr++;
    }
  }
  if (firstChildSig) s.schemas.set(firstChildSig, (s.schemas.get(firstChildSig) ?? 0) + 1);

  // échantillons libellés racine
  if (cat === "root") {
    const base = rel.split("/").pop()!.replace(".cfg.bin.json", "");
    if (wantSamples.has(base) && !samples.has(base)) {
      const rows: [number, string][] = [];
      let n = 0;
      for (const e of entries) for (const c of e.children ?? []) {
        n++;
        const hash = parseInt(c.variables[0]?.value ?? "0", 10);
        const str = c.variables.find(v => v.type === "String")?.value ?? "";
        if (str && str.length && rows.length < 24) rows.push([hash, str]);
      }
      samples.set(base, { lang, n, rows });
    }
  }
}

// ---- décodage WASHA_MAP : montrer le layout d'un fichier réel ----
async function dumpLayout(path: string, label: string) {
  const doc: Doc = await Bun.file(path).json();
  const e = doc.entries[0];
  const c = e?.children?.[0];
  console.log(`\n### LAYOUT ${label} (${path.split("/").slice(-2).join("/")})`);
  console.log(`begin=${e?.name} beginVar=${JSON.stringify(e?.variables)}`);
  if (c) {
    console.log(`child[0]=${c.name} : ${c.variables.length} vars`);
    c.variables.forEach((v, i) => console.log(`  [${i}] ${v.type} = ${JSON.stringify(v.value)}`));
  }
}

// ---- parallèle de dialogue ja/en/fr sur un même ev ----
async function parallelDialogue(ev: string) {
  console.log(`\n### DIALOGUE PARALLELE ${ev}`);
  for (const lang of ["ja", "en", "fr"]) {
    const p = `${ROOT}/${lang}/event/${ev}.cfg.bin.json`;
    if (!(await Bun.file(p).exists())) { console.log(`${lang}: (absent)`); continue; }
    const doc: Doc = await Bun.file(p).json();
    const lines: string[] = [];
    for (const e of doc.entries) for (const c of e.children ?? []) {
      const str = c.variables.find(v => v.type === "String")?.value ?? "";
      const hash = c.variables[0]?.value ?? "";
      if (str) lines.push(`    [${hash}] ${str}`);
      if (lines.length >= 5) break;
    }
    console.log(`${lang} (${p.split("/").pop()}):`);
    console.log(lines.join("\n"));
  }
}

// ===== OUTPUT =====
console.log("FILES_TOTAL", files.length, "PARSE_ERR", parseErr, "TOTAL_CHILDREN", totalChildren);
console.log("\n### BEGIN node names (schemas racine)");
for (const [k, v] of [...beginNames.entries()].sort((a, b) => b[1] - a[1])) console.log(`${k}\t${v}`);

console.log("\n### Par catégorie|langue : fichiers, entrées, schéma dominant");
for (const [k, s] of [...byKey.entries()].sort()) {
  const topSchema = [...s.schemas.entries()].sort((a, b) => b[1] - a[1])[0];
  console.log(`${k}\tfiles=${s.files}\tentries=${s.entries}\temptyStr=${s.emptyStr}\tschema=[${topSchema?.[0]}]x${topSchema?.[1]} (#variants=${s.schemas.size})`);
}

console.log("\n### Echantillons libellés (tables racines, langue indiquée)");
for (const base of [...samples.keys()].sort()) {
  const s = samples.get(base)!;
  console.log(`\n--- ${base} [lang=${s.lang}] entries=${s.n} ---`);
  for (const [h, str] of s.rows) console.log(`  ${h}\t${str.replace(/\n/g, "\\n").slice(0, 80)}`);
}

await dumpLayout(`${ROOT}/event/ev23_01210_map.cfg.bin.json`, "TEXT_WASHA_MAP (event speaker map)");
await dumpLayout(`${ROOT}/map/w20_npc_text_map.cfg.bin.json`, "TEXT_WASHA_MAP (npc map)");
await dumpLayout(`${ROOT}/fr/event/ev27_06300.cfg.bin.json`, "TEXT_INFO (dialogue localisé)");
await dumpLayout(`${ROOT}/common/system_text_map.cfg.bin.json`, "common system_text_map");
await dumpLayout(`${ROOT}/common/common_talk_text_map.cfg.bin.json`, "common common_talk_text_map");

// motion map
const mm = files.find(f => f.includes("motion") || false);
// trouve un fichier TEXT_MOTION_MAP
for (const rel of files) {
  const doc: Doc = await Bun.file(`${ROOT}/${rel}`).json().catch(() => ({ entries: [] }));
  if (doc.entries?.[0]?.name?.startsWith("TEXT_MOTION_MAP")) {
    await dumpLayout(`${ROOT}/${rel}`, "TEXT_MOTION_MAP");
    break;
  }
}

await parallelDialogue("ev27_06300");

// taille agrégée des chaînes (poids du contenu réel)
let totalChars = 0, nonEmpty = 0;
console.log("\n### (info) scan terminé");
console.log("DONE");
