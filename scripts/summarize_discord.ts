// Résume la famille "discord" : data/discord/**/meta.json (+ index.html voisin)
import { Glob } from "bun";

const ROOT = "/home/ubuntu/niers/data/discord";
const glob = new Glob("*/meta.json");

type Meta = {
  id: string;
  title: string;
  url: string;
  date: string;
  channelName: string;
  category: string;
  language: string;
};

const metas: Meta[] = [];
const fieldCounts = new Map<string, number>();
const extraFields = new Set<string>();

for await (const rel of glob.scan(ROOT)) {
  const p = `${ROOT}/${rel}`;
  const m = (await Bun.file(p).json()) as Meta & Record<string, unknown>;
  metas.push(m);
  for (const k of Object.keys(m)) {
    fieldCounts.set(k, (fieldCounts.get(k) ?? 0) + 1);
    if (!["id", "title", "url", "date", "channelName", "category", "language"].includes(k))
      extraFields.add(k);
  }
}

console.log("FICHIERS meta.json:", metas.length);
console.log("\nCHAMPS (présence /", metas.length, "):");
for (const [k, c] of [...fieldCounts].sort((a, b) => b[1] - a[1]))
  console.log(`  ${k}: ${c}`);
console.log("CHAMPS extra hors schéma standard:", [...extraFields]);

// langues
const langs = new Map<string, number>();
for (const m of metas) langs.set(m.language, (langs.get(m.language) ?? 0) + 1);
console.log("\nLANGUES:", [...langs]);

// catégories
const cats = new Map<string, number>();
for (const m of metas) cats.set(m.category, (cats.get(m.category) ?? 0) + 1);
console.log("CATEGORIES:", [...cats]);

// dates
const dates = metas.map((m) => m.date).sort();
console.log("DATE min:", dates[0], "max:", dates[dates.length - 1]);

// serveur (guild id) extrait de l'url: .../channels/<guild>/<channel>/<msg>
const guilds = new Map<string, number>();
const channelIdsFromUrl = new Set<string>();
for (const m of metas) {
  const mm = m.url.match(/channels\/(\d+)\/(\d+)\/(\d+)/);
  if (mm) {
    guilds.set(mm[1], (guilds.get(mm[1]) ?? 0) + 1);
    channelIdsFromUrl.add(mm[2]);
  }
}
console.log("\nGUILDS (id serveur -> nb segments):", [...guilds]);
console.log("Channels distincts (via url):", channelIdsFromUrl.size);

// channelId extrait de l'id "discord-<channelId>-<part>"
const byChannel = new Map<string, { name: string; parts: number[]; dates: string[] }>();
for (const m of metas) {
  const idm = m.id.match(/^discord-(\d+)-(\d+)$/);
  if (!idm) {
    console.log("ID NON STANDARD:", m.id);
    continue;
  }
  const [, cid, part] = idm;
  const e = byChannel.get(cid) ?? { name: m.channelName, parts: [], dates: [] };
  e.parts.push(Number(part));
  e.dates.push(m.date);
  byChannel.set(cid, e);
}
console.log("\nSALONS distincts (via id):", byChannel.size);

// titres: vérifier le pattern "[Partie N]"
const titleHasPart = metas.filter((m) => /\[Partie \d+\]/.test(m.title)).length;
console.log("Titres avec [Partie N]:", titleHasPart, "/", metas.length);
const titlePrefix = new Set(metas.map((m) => m.title.replace(/#.*$/, "").trim()));
console.log("Préfixes de titre distincts:", [...titlePrefix]);

// table par salon
console.log("\n=== TABLE SALONS ===");
const rows = [...byChannel.entries()]
  .map(([cid, e]) => {
    const ds = e.dates.sort();
    return {
      cid,
      name: e.name,
      segments: e.parts.length,
      maxPart: Math.max(...e.parts),
      dmin: ds[0],
      dmax: ds[ds.length - 1],
    };
  })
  .sort((a, b) => b.segments - a.segments);
for (const r of rows)
  console.log(`${r.name}\t| ${r.cid}\t| seg=${r.segments} maxPart=${r.maxPart}\t| ${r.dmin}..${r.dmax}`);

// index.html: stats messages
console.log("\n=== INDEX.HTML stats (échantillon agrégé) ===");
let totalLi = 0;
let totalAuthors = new Set<string>();
let totalBytes = 0;
const htmlGlob = new Glob("*/index.html");
for await (const rel of htmlGlob.scan(ROOT)) {
  const f = Bun.file(`${ROOT}/${rel}`);
  totalBytes += f.size;
  const txt = await f.text();
  const li = (txt.match(/<li>/g) ?? []).length;
  totalLi += li;
  for (const a of txt.matchAll(/<strong>@([^<]+)<\/strong>/g)) totalAuthors.add(a[1]);
}
console.log("Total <li> (messages):", totalLi);
console.log("Auteurs distincts (@handle):", totalAuthors.size);
console.log("Total octets index.html:", totalBytes);

// dump JSON pour le markdown
await Bun.write(
  "/tmp/discord_summary.json",
  JSON.stringify({ rows, langs: [...langs], cats: [...cats], guilds: [...guilds], totalLi, authors: totalAuthors.size, dmin: dates[0], dmax: dates[dates.length - 1], n: metas.length }, null, 2)
);
