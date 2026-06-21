// Analyse de la famille "soccer-match" — data/common/gamedata/soccer/**/*.json
// Bun + TS. Sortie: JSON résumé sur stdout, consommé pour rédiger le markdown.
import { Glob } from "bun";

const ROOT = "/home/ubuntu/niers/data/common/gamedata/soccer";
const glob = new Glob("**/*.json");

type Variable = { type: string; value: string };
type EntryNode = { name: string; variables?: Variable[]; children?: EntryNode[] };
type ListNode = { name: string; typeName: string; values: any[] };

const files: string[] = [];
for await (const f of glob.scan(ROOT)) files.push(f);
files.sort();

// --- classification ---
const schemaEntries: string[] = [];
const schemaLists: string[] = [];
const schemaOther: string[] = [];

const fileData = new Map<string, any>();
for (const rel of files) {
  const d = await Bun.file(`${ROOT}/${rel}`).json();
  fileData.set(rel, d);
  if (d && typeof d === "object" && Array.isArray(d.entries)) schemaEntries.push(rel);
  else if (d && typeof d === "object" && Array.isArray(d.lists)) schemaLists.push(rel);
  else schemaOther.push(rel);
}

// --- game vs racine ---
const gameFiles = files.filter((f) => f.startsWith("game/"));
const rootFiles = files.filter((f) => !f.startsWith("game/"));

// Catégorise les fichiers game/
const gameTrigger = gameFiles.filter((f) => f.includes("_trigger_"));
const gamePhaseSet = gameFiles.filter((f) => f.includes("_phase_set_"));
const gameOther = gameFiles.filter((f) => !f.includes("_trigger_") && !f.includes("_phase_set_"));

// Préfixes des fbtl
function fbtlPrefix(f: string): string {
  const base = f.replace("game/", "");
  const m = base.match(/^(fbtl_[a-z]+\d*)/);
  if (m) return m[1];
  const m2 = base.match(/^([a-z]+_?[a-z0-9]*)/);
  return m2 ? m2[1] : base;
}
const triggerPrefixes = new Map<string, number>();
for (const f of gameTrigger) {
  const p = fbtlPrefix(f);
  triggerPrefixes.set(p, (triggerPrefixes.get(p) ?? 0) + 1);
}

// === Analyse des fichiers version/lists (typés) ===
type ListSummary = {
  file: string;
  version: number;
  lists: { name: string; typeName: string; count: number; fields: string[]; sample: any }[];
};
const listSummaries: ListSummary[] = [];
for (const rel of schemaLists) {
  const d = fileData.get(rel);
  const lists = (d.lists as ListNode[]).map((l) => {
    const fields = l.values.length ? Object.keys(l.values[0]) : [];
    return {
      name: l.name,
      typeName: l.typeName,
      count: l.values.length,
      fields,
      sample: l.values[0] ?? null,
    };
  });
  listSummaries.push({ file: rel, version: d.version, lists });
}

// === Analyse des fichiers entries racine ===
type EntriesSummary = {
  file: string;
  topCount: number;
  topNames: string[]; // noms uniques (dé-suffixés du _N)
  rawTopSample: string[];
  varTypeHisto: Record<string, number>;
  childNames: string[];
  sampleEntries: any[];
};
function stripIdx(name: string): string {
  return name.replace(/_\d+$/, "");
}
const entriesSummaries: EntriesSummary[] = [];
for (const rel of schemaEntries) {
  const d = fileData.get(rel);
  const entries = d.entries as EntryNode[];
  const topNamesSet = new Map<string, number>();
  const varTypeHisto: Record<string, number> = {};
  const childNamesSet = new Map<string, number>();
  for (const e of entries) {
    const key = stripIdx(e.name);
    topNamesSet.set(key, (topNamesSet.get(key) ?? 0) + 1);
    for (const v of e.variables ?? []) varTypeHisto[v.type] = (varTypeHisto[v.type] ?? 0) + 1;
    for (const c of e.children ?? []) {
      const ck = stripIdx(c.name);
      childNamesSet.set(ck, (childNamesSet.get(ck) ?? 0) + 1);
    }
  }
  entriesSummaries.push({
    file: rel,
    topCount: entries.length,
    topNames: [...topNamesSet.entries()].map(([k, v]) => `${k}(x${v})`),
    rawTopSample: entries.slice(0, 3).map((e) => e.name),
    varTypeHisto,
    childNames: [...childNamesSet.entries()].map(([k, v]) => `${k}(x${v})`).slice(0, 20),
    sampleEntries: entries.slice(0, 2),
  });
}

// === Agrégat des game/ trigger & phase_set : structure DATA_COUNT/DATA_ITEM ===
function summarizeDataItems(relList: string[], label: string) {
  let totalFiles = relList.length;
  let totalItems = 0;
  const varCountHisto: Record<number, number> = {};
  const firstVarTypeHisto: Record<string, number> = {};
  const itemVarLayouts = new Map<string, number>(); // signature des types
  const sampleStrings: string[] = [];
  const firstIntValues = new Map<string, number>();
  for (const rel of relList) {
    const d = fileData.get(rel);
    if (!d || !Array.isArray(d.entries)) continue;
    for (const e of d.entries as EntryNode[]) {
      if (!e.name.startsWith("DATA_ITEM")) continue;
      totalItems++;
      const vars = e.variables ?? [];
      varCountHisto[vars.length] = (varCountHisto[vars.length] ?? 0) + 1;
      const sig = vars.map((v) => v.type[0]).join("");
      itemVarLayouts.set(sig, (itemVarLayouts.get(sig) ?? 0) + 1);
      if (vars[0]) {
        firstVarTypeHisto[vars[0].type] = (firstVarTypeHisto[vars[0].type] ?? 0) + 1;
        if (vars[0].type === "Int") {
          const k = vars[0].value;
          firstIntValues.set(k, (firstIntValues.get(k) ?? 0) + 1);
        }
      }
      for (const v of vars) if (v.type === "String" && sampleStrings.length < 6) sampleStrings.push(v.value);
    }
  }
  return {
    label,
    totalFiles,
    totalItems,
    varCountHisto,
    firstVarTypeHisto,
    topLayouts: [...itemVarLayouts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
    topFirstInt: [...firstIntValues.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15),
    sampleStrings,
  };
}

const triggerAgg = summarizeDataItems(gameTrigger, "trigger");
const phaseAgg = summarizeDataItems(gamePhaseSet, "phase_set");

// === Sortie ===
const out = {
  totals: {
    files: files.length,
    gameFiles: gameFiles.length,
    rootFiles: rootFiles.length,
    schemaEntries: schemaEntries.length,
    schemaLists: schemaLists.length,
    schemaOther: schemaOther.length,
    gameTrigger: gameTrigger.length,
    gamePhaseSet: gamePhaseSet.length,
    gameOther: gameOther.length,
  },
  schemaOther,
  triggerPrefixes: [...triggerPrefixes.entries()].sort((a, b) => b[1] - a[1]),
  rootEntriesFiles: schemaEntries.filter((f) => !f.startsWith("game/")),
  listSummaries,
  entriesSummaries,
  triggerAgg,
  phaseAgg,
};

await Bun.write("/tmp/soccer_analysis.json", JSON.stringify(out, null, 2));
console.log("WROTE /tmp/soccer_analysis.json");
console.log("totals", JSON.stringify(out.totals));
