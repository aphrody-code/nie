// Analyse de la famille "root-manifests" : data/*.json à la racine.
// Bun + TS haut niveau. Lancer : bun run scripts/analyze-root-manifests.ts
import { Glob } from "bun";

const ROOT = "/home/ubuntu/niers/data";
const out: string[] = [];
const log = (s = "") => out.push(s);

function typeOf(v: unknown): string {
  if (Array.isArray(v)) return "array";
  if (v === null) return "null";
  return typeof v;
}

// ---------- asset-cross-reference ----------
async function acr() {
  const j: any = await Bun.file(`${ROOT}/asset-cross-reference.json`).json();
  log("## asset-cross-reference.json");
  log();
  log(`- generatedAt: \`${j.generatedAt}\``);
  log(`- totalAssets: **${j.totalAssets}**, totalSources: **${j.totalSources}**`);
  log(`- clés racine: ${Object.keys(j).join(", ")}`);
  log();
  log("### bucketSummary");
  log("| bucket | count |");
  log("|---|---|");
  for (const [k, v] of Object.entries(j.bucketSummary)) log(`| ${k} | ${v} |`);
  log();
  log("### folderSummary (top 15 par count)");
  const folders = Object.entries(j.folderSummary as Record<string, number>)
    .sort((a, b) => b[1] - a[1]).slice(0, 15);
  log("| folder | count |");
  log("|---|---|");
  for (const [k, v] of folders) log(`| \`${k}\` | ${v} |`);
  log();
  // assets shape
  const assetsKey = ["assets", "entries", "items", "data"].find(k => Array.isArray(j[k]) || (j[k] && typeof j[k] === "object"));
  log(`- autres clés (non résumé): ${Object.keys(j).filter(k => !["generatedAt","totalAssets","totalSources","bucketSummary","folderSummary"].includes(k)).join(", ") || "(aucune)"}`);
  // dig into assets structure
  for (const k of Object.keys(j)) {
    const v = j[k];
    if (Array.isArray(v) && v.length && typeof v[0] === "object") {
      log();
      log(`### \`${k}\` — ${v.length} entrées, type=array`);
      log(`Champs d'une entrée: ${Object.keys(v[0]).map(x => `\`${x}\``).join(", ")}`);
      // entrée représentative : assetPath non vide
      const rep = v.find((e: any) => e.assetPath) ?? v[0];
      log("Exemple (entrée avec assetPath renseigné):");
      log("```json");
      log(JSON.stringify(rep, null, 2));
      log("```");
      // histogramme isTemplate + nb de sources
      const tmpl = v.filter((e: any) => e.isTemplate).length;
      log(`- \`isTemplate\`=true sur **${tmpl}** assets (variantes paramétrées) ; multi-sources fréquent (un asset référencé par plusieurs entries).`);
    } else if (v && typeof v === "object" && !["bucketSummary","folderSummary"].includes(k) && typeof Object.values(v)[0] === "object") {
      const ents = Object.entries(v);
      log();
      log(`### \`${k}\` — ${ents.length} clés (objet)`);
      const [sk, sv] = ents[0];
      log(`Exemple clé \`${sk}\`:`);
      log("```json");
      log(JSON.stringify(sv, null, 2).slice(0, 800));
      log("```");
    }
  }
  log();
}

// ---------- character-face-manifest / character-model-manifest ----------
async function arrayManifest(file: string, title: string) {
  const arr: string[] = await Bun.file(`${ROOT}/${file}`).json();
  log(`## ${file}`);
  log();
  log(`- Type: tableau plat de codes string. **${arr.length}** entrées.`);
  // prefix histogram (first chars classes)
  const prefixes = new Map<string, number>();
  for (const code of arr) {
    const m = code.match(/^[a-z]+/i);
    const p = m ? m[0] : code.slice(0, 3);
    prefixes.set(p, (prefixes.get(p) ?? 0) + 1);
  }
  const top = [...prefixes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18);
  log("### Préfixes (familles de codes)");
  log("| préfixe | count | exemples |");
  log("|---|---|---|");
  for (const [p, c] of top) {
    const ex = arr.filter(x => x.startsWith(p)).slice(0, 3).join(", ");
    log(`| \`${p}\` | ${c} | ${ex} |`);
  }
  log();
  log(`Premiers: ${arr.slice(0, 6).map(x => `\`${x}\``).join(", ")}`);
  log(`Derniers: ${arr.slice(-6).map(x => `\`${x}\``).join(", ")}`);
  log();
}

// ---------- discord-channels-scan ----------
async function discord() {
  const j: any = await Bun.file(`${ROOT}/discord-channels-scan.json`).json();
  log("## discord-channels-scan.json");
  log();
  const s = j.stats;
  log(`- clés racine: ${Object.keys(j).join(", ")}`);
  log(`- scanDate: \`${s.scanDate}\`, durationMs: ${s.durationMs}`);
  log(`- totalChannelsScanned: **${s.totalChannelsScanned}**, totalMessages: **${s.totalMessages}**, totalCharacters: ${s.totalCharacters}, averageMessageLength: ${s.averageMessageLength}`);
  log(`- autres clés stats: ${Object.keys(s).join(", ")}`);
  log();
  if (s.mostActiveAuthors) {
    log("### mostActiveAuthors (top)");
    log("| author | count |");
    log("|---|---|");
    for (const a of s.mostActiveAuthors.slice(0, 8)) log(`| ${a.author} | ${a.count} |`);
    log();
  }
  // channels
  for (const k of Object.keys(j)) {
    const v = j[k];
    if (k === "stats") continue;
    if (Array.isArray(v) && v.length) {
      log(`### \`${k}\` — ${v.length} entrées (array)`);
      if (typeof v[0] === "object") {
        log(`Champs: ${Object.keys(v[0]).map(x => `\`${x}\``).join(", ")}`);
        const samp = { ...v[0] };
        // trim long fields
        for (const kk of Object.keys(samp)) if (typeof samp[kk] === "string" && samp[kk].length > 120) samp[kk] = samp[kk].slice(0, 120) + "…";
        log("```json");
        log(JSON.stringify(samp, null, 2));
        log("```");
      }
      log();
    } else if (v && typeof v === "object") {
      log(`### \`${k}\` (objet, ${Object.keys(v).length} clés)`);
      log(`Clés: ${Object.keys(v).slice(0, 12).join(", ")}`);
      log();
    }
  }
}

// ---------- glossary ----------
async function glossary() {
  const j: any = await Bun.file(`${ROOT}/glossary.json`).json();
  log("## glossary.json");
  log();
  log(`- generatedAt: \`${j._meta.generatedAt}\``);
  log("### _meta.counts");
  log("| catégorie | count |");
  log("|---|---|");
  for (const [k, v] of Object.entries(j._meta.counts)) log(`| ${k} | ${v} |`);
  log();
  log(`- sections (tableaux): ${Object.keys(j).filter(k => k !== "_meta").join(", ")}`);
  log();
  for (const sec of Object.keys(j)) {
    if (sec === "_meta") continue;
    const v = j[sec];
    if (!Array.isArray(v) || !v.length) continue;
    log(`### \`${sec}\` — ${v.length} entrées`);
    log(`Champs: ${Object.keys(v[0]).map(x => `\`${x}\``).join(", ")}`);
    log("Exemples:");
    log("| " + Object.keys(v[0]).join(" | ") + " |");
    log("|" + Object.keys(v[0]).map(() => "---").join("|") + "|");
    for (const e of v.slice(0, 5)) {
      log("| " + Object.keys(v[0]).map(k => String(e[k] ?? "").replace(/\|/g, "\\|").slice(0, 40)).join(" | ") + " |");
    }
    log();
  }
}

// ---------- item-image-manifest ----------
async function itemImage() {
  const j: Record<string, string> = await Bun.file(`${ROOT}/item-image-manifest.json`).json();
  const ents = Object.entries(j);
  log("## item-image-manifest.json");
  log();
  log(`- Type: objet plat \`itemCode -> chemin atlas\`. **${ents.length}** entrées.`);
  // prefix of keys
  const kp = new Map<string, number>();
  for (const [k] of ents) {
    const m = k.match(/^[a-z]+_[a-z]+/i) ?? k.match(/^[a-z]+/i);
    const p = m ? m[0] : k.slice(0, 4);
    kp.set(p, (kp.get(p) ?? 0) + 1);
  }
  log("### Préfixes des codes item (top 15)");
  log("| préfixe | count |");
  log("|---|---|");
  for (const [p, c] of [...kp.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) log(`| \`${p}\` | ${c} |`);
  log();
  // path folders
  const pf = new Map<string, number>();
  for (const [, v] of ents) {
    const dir = v.split("/").slice(0, -1).join("/");
    pf.set(dir, (pf.get(dir) ?? 0) + 1);
  }
  log("### Dossiers cibles (atlas)");
  log("| dossier | count |");
  log("|---|---|");
  for (const [p, c] of [...pf.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) log(`| \`${p}\` | ${c} |`);
  log();
  log("Exemples:");
  log("| code | chemin |");
  log("|---|---|");
  for (const [k, v] of ents.slice(0, 6)) log(`| \`${k}\` | \`${v}\` |`);
  log();
}

// ---------- miximax-icon-manifest ----------
async function miximax() {
  const j: Record<string, string> = await Bun.file(`${ROOT}/miximax-icon-manifest.json`).json();
  const ents = Object.entries(j);
  log("## miximax-icon-manifest.json");
  log();
  log(`- Type: objet plat \`code -> icône\`. **${ents.length}** entrées.`);
  const kp = new Map<string, number>();
  for (const [k] of ents) { const p = k.match(/^[a-z]+/i)?.[0] ?? k.slice(0,3); kp.set(p,(kp.get(p)??0)+1); }
  const vp = new Map<string, number>();
  for (const [,v] of ents) { const p = v.match(/^[a-z]+/i)?.[0] ?? v.slice(0,3); vp.set(p,(vp.get(p)??0)+1); }
  log(`- préfixes clés: ${[...kp.entries()].sort((a,b)=>b[1]-a[1]).map(([p,c])=>`\`${p}\`(${c})`).join(", ")}`);
  log(`- préfixes valeurs (icônes): ${[...vp.entries()].sort((a,b)=>b[1]-a[1]).map(([p,c])=>`\`${p}\`(${c})`).join(", ")}`);
  log();
  log("Exemples:");
  log("| code | icône |");
  log("|---|---|");
  for (const [k, v] of ents.slice(0, 8)) log(`| \`${k}\` | \`${v}\` |`);
  log();
}

// ---------- passive-sheets ----------
async function passive() {
  const j: any = await Bun.file(`${ROOT}/passive-sheets.json`).json();
  log("## passive-sheets.json");
  log();
  log(`- clés racine: ${Object.keys(j).join(", ")}`);
  for (const sec of Object.keys(j)) {
    const v = j[sec];
    if (!Array.isArray(v) || !v.length) { log(`- \`${sec}\`: ${typeOf(v)}`); continue; }
    log(`### \`${sec}\` — ${v.length} entrées`);
    if (sec === "playstyles") {
      log(`Valeurs (tous les playstyles): ${v.map((x: any) => `\`${x}\``).join(", ")}`);
      log();
      continue;
    }
    log(`Champs: ${Object.keys(v[0]).map(x => `\`${x}\``).join(", ")}`);
    log("```json");
    log(JSON.stringify(v[0], null, 2));
    log("```");
    // distinct stats / requirements sample
    const stats = new Set<string>();
    const reqs = new Set<string>();
    for (const e of v) { if (e.stat) stats.add(e.stat); if (e.requirement) reqs.add(e.requirement); }
    if (stats.size) log(`- stats distincts (${stats.size}): ${[...stats].slice(0, 20).join(", ")}`);
    if (reqs.size) log(`- requirements distincts (${reqs.size}), ex.: ${[...reqs].slice(0, 6).map(r=>`"${r}"`).join("; ")}`);
    log();
  }
}

// ---------- zukan-audit + mirror ----------
async function zukan() {
  for (const file of ["zukan-audit.json", "zukan-audit-mirror.json"]) {
    const j: any = await Bun.file(`${ROOT}/${file}`).json();
    log(`## ${file}`);
    log();
    log(`- clés racine: ${Object.keys(j).join(", ")}`);
    log("### metadata");
    log("```json");
    log(JSON.stringify(j.metadata, null, 2));
    log("```");
    const issues = j.issues ?? [];
    log(`- issues: **${issues.length}**`);
    if (issues.length) {
      log(`Champs d'une issue: ${Object.keys(issues[0]).map(x => `\`${x}\``).join(", ")}`);
      const samp = { ...issues[0] };
      log("```json");
      log(JSON.stringify(samp, null, 2));
      log("```");
      // category histogram if present
      const cats = new Map<string, number>();
      for (const it of issues) { const c = it.category ?? it.severity ?? "?"; cats.set(c, (cats.get(c) ?? 0) + 1); }
      log(`- répartition: ${[...cats.entries()].map(([c, n]) => `${c}=${n}`).join(", ")}`);
    }
    log();
  }
}

// ---------- driver ----------
log("# Famille de données : root-manifests");
log();
log("> Index/manifestes d'assets à la racine de `data/`. Glob `data/*.json` (le symlink `sheet_export.json` est exclu).");
log("> Source: parse Bun/TS de chaque fichier. Valeurs = contenu réel des JSON.");
log();
const glob = new Glob("*.json");
const files: string[] = [];
for await (const f of glob.scan(ROOT)) files.push(f);
files.sort();
const SUMMARY: Record<string, [string, string]> = {
  "asset-cross-reference.json": ["objet + array `assets`", "17 353 assets / 35 958 sources — index inverse asset→entries"],
  "character-face-manifest.json": ["array de codes", "5 677 codes de visages de personnages disponibles"],
  "character-model-manifest.json": ["array de codes", "6 028 codes de modèles 3D (persos + pièces customisation)"],
  "discord-channels-scan.json": ["objet (stats + channels)", "scrape communauté Discord (136 salons, 1 751 msgs)"],
  "glossary.json": ["objet de sections", "24 001 libellés trilingues ja/en/fr (persos, techniques, items…)"],
  "item-image-manifest.json": ["objet plat", "1 459 mappings itemCode → atlas d'icône"],
  "miximax-icon-manifest.json": ["objet plat", "36 mappings code Miximax → icône"],
  "passive-sheets.json": ["objet de sections", "175 passifs (joueur/custom/coordinateur) + playstyles"],
  "zukan-audit.json": ["objet (metadata + issues)", "audit cohérence zukan vs DB : 5 463 audités, 12 issues"],
  "zukan-audit-mirror.json": ["objet (metadata + issues)", "même audit, forme condensée + source miroir SQLite"],
};
log("| fichier | type racine | contenu |");
log("|---|---|---|");
for (const f of files) {
  const s = SUMMARY[f];
  if (s) log(`| \`${f}\` | ${s[0]} | ${s[1]} |`);
}
log();

await acr();
await arrayManifest("character-face-manifest.json", "character-face-manifest");
await arrayManifest("character-model-manifest.json", "character-model-manifest");
await glossary();
await itemImage();
await miximax();
await passive();
await discord();
await zukan();

const md = out.join("\n");
await Bun.write("/home/ubuntu/niers/docs/game-data/root-manifests.md", md);
console.log("written", md.length, "bytes");
console.log("files scanned:", files.join(", "));
