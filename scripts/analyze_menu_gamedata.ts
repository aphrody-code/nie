// Analyse de la famille de données "menus" : data/common/gamedata/menu/**/*.json
// Bun + TS haut niveau. Sortie : faits réels (anti-hallucination).
import { Glob } from "bun";

const ROOT = "/home/ubuntu/niers/data/common/gamedata/menu";

type Var = { type: string; value: string };
type Node = { name: string; variables: Var[]; children: Node[] };
type EntriesDoc = { entries: Node[] };
type ListsDoc = { version: number; lists: { name: string; typeName: string; values: any[] }[] };

const glob = new Glob("**/*.json");
const files: string[] = [];
for await (const f of glob.scan(ROOT)) files.push(f);
files.sort();

const listsFiles: string[] = [];
const entriesFiles: string[] = [];
const docs = new Map<string, any>();

for (const rel of files) {
  const doc = await Bun.file(`${ROOT}/${rel}`).json();
  docs.set(rel, doc);
  if (doc.lists) listsFiles.push(rel);
  else entriesFiles.push(rel);
}

const stem = (name: string) => name.replace(/_\d+$/, "");

// ---- Walk entries tree ----
function* walk(nodes: Node[]): Generator<Node> {
  for (const n of nodes) {
    yield n;
    if (n.children?.length) yield* walk(n.children);
  }
}

// Global aggregates over entries-schema docs
const stemCount = new Map<string, number>();           // stem -> node count
const stemFileCount = new Map<string, Set<string>>();  // stem -> set of files
// stem -> varIndex -> Map(stringValue -> count)
const stemStringVals = new Map<string, Map<number, Map<string, number>>>();

function bumpStr(s: string, idx: number, val: string) {
  let byIdx = stemStringVals.get(s);
  if (!byIdx) { byIdx = new Map(); stemStringVals.set(s, byIdx); }
  let m = byIdx.get(idx);
  if (!m) { m = new Map(); byIdx.set(idx, m); }
  m.set(val, (m.get(val) ?? 0) + 1);
}

// per-file screen stats (only for cfg/*_setting files)
type ScreenStat = { file: string; layers: number; cmds: number; res: number; focus: number; create: number; groups: number };
const screens: ScreenStat[] = [];

for (const rel of entriesFiles) {
  const doc: EntriesDoc = docs.get(rel);
  const localStem = new Map<string, number>();
  for (const node of walk(doc.entries ?? [])) {
    const s = stem(node.name);
    stemCount.set(s, (stemCount.get(s) ?? 0) + 1);
    localStem.set(s, (localStem.get(s) ?? 0) + 1);
    if (!stemFileCount.has(s)) stemFileCount.set(s, new Set());
    stemFileCount.get(s)!.add(rel);
    node.variables?.forEach((v, i) => {
      if (v.type === "String" && v.value !== "") bumpStr(s, i, v.value);
    });
  }
  if (rel.startsWith("cfg/")) {
    screens.push({
      file: rel.replace("cfg/", "").replace(".cfg.bin.json", ""),
      layers: localStem.get("MENU_LAYER_INFO") ?? 0,
      cmds: localStem.get("MENU_CMD_INFO") ?? 0,
      res: localStem.get("MENU_RES") ?? 0,
      focus: localStem.get("MENU_FOCUS_BASE_INFO") ?? 0,
      create: localStem.get("MENU_CREATE_INFO") ?? 0,
      groups: localStem.get("MENU_LAYER_GROUP_BASE") ?? 0,
    });
  }
}

// ---- Output builder ----
const out: string[] = [];
const p = (s = "") => out.push(s);

p("# Famille de données : menus");
p();
p(`Glob : \`data/common/gamedata/menu/**/*.json\` — **${files.length} fichiers** (décodages \`*.cfg.bin\` → JSON).`);
p();
p("Deux schémas coexistent dans cette famille :");
p();
p(`- **Schéma \`entries\`** (arbre RDBN générique) : ${entriesFiles.length} fichiers. Chaque nœud = \`{name, variables[]:{type,value}, children[]}\`. Les listes sont introduites par un nœud \`*_LIST_BEG_0\` dont la 1re variable \`Int\` donne le nombre d'éléments, suivi des éléments en \`children\`. Aucun bloc \`TEXT_INFO [Int hash, Int, String]\` n'existe dans cette famille (les libellés texte vivent ailleurs ; ici les nœuds référencent des objets UI par hash CRC).`);
p(`- **Schéma \`lists\`** (structs typées à champs nommés) : ${listsFiles.length} fichiers — \`{version, lists[]:{name, typeName, values[]}}\`.`);
p();

// Répartition par répertoire
const byDir = new Map<string, number>();
for (const f of files) {
  const d = f.includes("/") ? f.split("/")[0] : "(racine)";
  byDir.set(d, (byDir.get(d) ?? 0) + 1);
}
p("## Répartition par répertoire");
p();
p("| Répertoire | Fichiers |");
p("|---|---:|");
for (const [d, c] of [...byDir.entries()].sort((a, b) => b[1] - a[1])) p(`| \`${d}\` | ${c} |`);
p();

// ---- Section 1 : schéma entries — types de nœuds ----
p("## Schéma `entries` — types de nœuds (corpus entier)");
p();
p("Stems de `name` (suffixe `_N` retiré), tous fichiers `entries` confondus. Les `*_LIST_BEG` sont les en-têtes de liste ; les autres sont les enregistrements.");
p();
p("| Stem du nœud | Occurrences | Fichiers |");
p("|---|---:|---:|");
const topStems = [...stemCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
for (const [s, c] of topStems) p(`| \`${s}\` | ${c} | ${stemFileCount.get(s)!.size} |`);
p();

// ---- Section 2 : anatomie d'un écran de menu ----
p("## Anatomie d'un écran de menu (`cfg/*_setting.cfg.bin.json`)");
p();
p("Les 440 fichiers de `cfg/` décrivent chacun un écran. Structure type (ordre des variables observé dans les vrais fichiers) :");
p();
p("- **`MENU_RES`** : ressource graphique. `var[0]`=String chemin (`#/menu/...g4tx`), `var[1]`=Int.");
p("- **`MENU_LAYER_INFO`** : un calque/objet UI. `var[0]`=Int(hash CRC du calque), `var[1]`=String(nom logique ex. `title00_01_title_top`), `var[2]`=String(chemin `.objbin`), puis 7 Int (ordre/parent/flags).");
p("- **`MENU_LAYER_GROUP_BASE`** / **`MENU_LAYER_GROUP`** : regroupements de calques (par hash).");
p("- **`MENU_CMD_INFO`** : action/commande. `var[0..1]`=Int(hash), `var[2]`=String(nom de commande ex. `CMD_ENTER`), `var[3..4]`=Int.");
p("- **`MENU_FOCUS_BASE_INFO`** / **`MENU_FOCUS_GROUP`** / **`MENU_FOCUS_SHIFT`** : navigation au pad (focus initial, groupes de focus, décalages directionnels).");
p("- **`MENU_CREATE_INFO`** : ordre de création des objets.");
p();

// Représentatifs : plus gros écrans
p("### Écrans les plus riches (par nombre de calques)");
p();
p("| Écran (`cfg/…_setting`) | Calques | Cmds | Ressources | Focus | Groupes |");
p("|---|---:|---:|---:|---:|---:|");
for (const s of [...screens].sort((a, b) => b.layers - a.layers).slice(0, 25))
  p(`| \`${s.file}\` | ${s.layers} | ${s.cmds} | ${s.res} | ${s.focus} | ${s.groups} |`);
p();
const totalLayers = screens.reduce((a, s) => a + s.layers, 0);
const totalCmds = screens.reduce((a, s) => a + s.cmds, 0);
p(`Totaux corpus écrans : ${screens.length} écrans, ${totalLayers} calques, ${totalCmds} commandes.`);
p();

// ---- Section 3 : valeurs réelles — commandes ----
const cmdVals = stemStringVals.get("MENU_CMD_INFO")?.get(2);
if (cmdVals) {
  p("## Noms de commandes réels (`MENU_CMD_INFO` var[2])");
  p();
  p("| Commande | Occurrences (corpus) |");
  p("|---|---:|");
  for (const [v, c] of [...cmdVals.entries()].sort((a, b) => b[1] - a[1])) p(`| \`${v}\` | ${c} |`);
  p();
}

// ---- Section 4 : objbins / textures référencés ----
const layerObjbin = stemStringVals.get("MENU_LAYER_INFO")?.get(2);
const layerNames = stemStringVals.get("MENU_LAYER_INFO")?.get(1);
const resPaths = stemStringVals.get("MENU_RES")?.get(0);
if (layerObjbin) {
  const distinct = layerObjbin.size;
  p("## Objets UI référencés (`.objbin`)");
  p();
  p(`${distinct} chemins \`.objbin\` distincts référencés par \`MENU_LAYER_INFO\` (\`common/gamedata/menu/obj/*.objbin\`). Exemples :`);
  p();
  p("| Chemin objbin | Réfs |");
  p("|---|---:|");
  for (const [v, c] of [...layerObjbin.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) p(`| \`${v}\` | ${c} |`);
  p();
}
if (resPaths) {
  p("## Atlas / textures d'icônes (`MENU_RES`)");
  p();
  p(`${resPaths.size} chemins de ressources distincts. Exemples :`);
  p();
  p("| Chemin ressource | Réfs |");
  p("|---|---:|");
  for (const [v, c] of [...resPaths.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) p(`| \`${v}\` | ${c} |`);
  p();
}

// ---- Section 5 : configs spéciaux (entries, racine) ----
p("## Fichiers de configuration globaux (racine, schéma `entries`)");
p();

function listChildrenStrings(rel: string, begStem: string, varIdx = 0, limit = 30): { count: number; vals: string[] } {
  const doc: EntriesDoc = docs.get(rel);
  const vals: string[] = [];
  for (const node of walk(doc.entries ?? [])) {
    if (stem(node.name) === begStem) {
      const v = node.variables?.[varIdx];
      if (v && v.type === "String") vals.push(v.value);
    }
  }
  return { count: vals.length, vals: vals.slice(0, limit) };
}

// menu_icon_manage_config : prefixes + filenames
const iconCfg = entriesFiles.find((f) => f.startsWith("menu_icon_manage_config"));
if (iconCfg) {
  const pre = listChildrenStrings(iconCfg, "MENU_ICON_IDPREFIX");
  const fn = listChildrenStrings(iconCfg, "MENU_ICON_FILENAME");
  const pth = listChildrenStrings(iconCfg, "MENU_ICON_PATH");
  p(`### \`${iconCfg}\``);
  p(`Gestion des icônes de menu. Chemin de base : ${pth.vals.map((v) => `\`${v}\``).join(", ")}.`);
  p();
  p(`Préfixes d'ID d'icône (${pre.count}) : ${pre.vals.map((v) => `\`${v}\``).join(", ")}.`);
  p();
  p(`Noms de fichiers d'atlas (${fn.count}) : ${fn.vals.map((v) => `\`${v}\``).join(", ")}.`);
  p();
}

// menu_talk_icon_config
const talkCfg = entriesFiles.find((f) => f.startsWith("menu_talk_icon_config"));
if (talkCfg) {
  const doc: EntriesDoc = docs.get(talkCfg);
  const counts = new Map<string, number>();
  for (const n of walk(doc.entries ?? [])) counts.set(stem(n.name), (counts.get(stem(n.name)) ?? 0) + 1);
  p(`### \`${talkCfg}\``);
  p(`Icônes de dialogue / lignes de bulle. Nœuds : ${[...counts.entries()].filter(([k]) => !k.endsWith("_LIST_BEG")).map(([k, v]) => `\`${k}\`×${v}`).join(", ")}.`);
  p();
}

// menu_map_pos_config
const mapCfg = entriesFiles.find((f) => f.startsWith("menu_map_pos_config"));
if (mapCfg) {
  const doc: EntriesDoc = docs.get(mapCfg);
  const counts = new Map<string, number>();
  for (const n of walk(doc.entries ?? [])) counts.set(stem(n.name), (counts.get(stem(n.name)) ?? 0) + 1);
  p(`### \`${mapCfg}\``);
  p(`Positions de menus sur carte. Nœuds : ${[...counts.entries()].filter(([k]) => !k.endsWith("_LIST_BEG")).map(([k, v]) => `\`${k}\`×${v}`).join(", ")}.`);
  p();
}

// cmd_tag_config
const cmdTag = entriesFiles.find((f) => f.startsWith("cmd_tag_config"));
if (cmdTag) {
  const doc: EntriesDoc = docs.get(cmdTag);
  const counts = new Map<string, number>();
  for (const n of walk(doc.entries ?? [])) counts.set(stem(n.name), (counts.get(stem(n.name)) ?? 0) + 1);
  p(`### \`${cmdTag}\``);
  p(`Tags de commande pad / clavier-souris (icônes de boutons d'aide). Nœuds : ${[...counts.entries()].filter(([k]) => !k.endsWith("_LIST_BEG")).map(([k, v]) => `\`${k}\`×${v}`).join(", ")}.`);
  p();
}

// menu_pop_manage_config + menu_group_capture_config + GroupCapture
for (const key of ["menu_pop_manage_config", "menu_group_capture_config", "menu_create_setting"]) {
  for (const f of entriesFiles.filter((x) => x.startsWith(key))) {
    const doc: EntriesDoc = docs.get(f);
    const counts = new Map<string, number>();
    for (const n of walk(doc.entries ?? [])) counts.set(stem(n.name), (counts.get(stem(n.name)) ?? 0) + 1);
    p(`### \`${f}\``);
    p(`Nœuds : ${[...counts.entries()].map(([k, v]) => `\`${k}\`×${v}`).join(", ")}.`);
    p();
  }
}

// ---- Section 6 : schéma lists ----
p("## Fichiers à schéma `lists` (structs typées à champs nommés)");
p();
for (const rel of listsFiles) {
  const doc: ListsDoc = docs.get(rel);
  p(`### \`${rel}\` (version ${doc.version})`);
  p();
  for (const lst of doc.lists) {
    const v0 = lst.values[0] ?? {};
    const fields = Object.keys(v0);
    p(`- **\`${lst.typeName}\`** (\`${lst.name}\`) — ${lst.values.length} entrées. Champs : ${fields.map((f) => `\`${f}\``).join(", ")}.`);
  }
  // sample real values for the first list
  const first = doc.lists[0];
  if (first && first.values.length) {
    p();
    p(`  Exemples (\`${first.typeName}\`) :`);
    p("  ```json");
    for (const v of first.values.slice(0, 3)) p("  " + JSON.stringify(v));
    p("  ```");
  }
  p();
}

// emblem detail (count + a few names)
const emblem = listsFiles.find((f) => f.startsWith("emblem_resource"));
if (emblem) {
  const doc: ListsDoc = docs.get(emblem);
  const lst = doc.lists.find((l) => l.typeName === "EMBLEM_RESOURCE_INFO");
  if (lst) {
    const names = lst.values.map((v: any) => v.emblemName).filter(Boolean);
    p(`### Emblèmes : ${lst.values.length} entrées`);
    p();
    p(`Noms (échantillon) : ${names.slice(0, 30).map((n: string) => `\`${n}\``).join(", ")}${names.length > 30 ? " …" : ""}.`);
    p();
  }
}

await Bun.write("/home/ubuntu/niers/docs/game-data/menus.md", out.join("\n") + "\n");
console.log("written", out.length, "lines");
console.log("files", files.length, "entries", entriesFiles.length, "lists", listsFiles.length);
console.log("screens", screens.length, "totalLayers", totalLayers, "totalCmds", totalCmds);
console.log("distinct objbin", layerObjbin?.size, "distinct res", resPaths?.size);
console.log("cmd names", cmdVals ? [...cmdVals.keys()].length : 0);
