// Analyse de la famille de données "zukan" (data/zukan/*.json)
// bun run scripts/analyze_zukan.ts
const DIR = "/home/ubuntu/niers/data/zukan";

function tally(arr: any[], key: (x: any) => any): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of arr) {
    const k = String(key(x));
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}
function sortMap(m: Map<string, number>): [string, number][] {
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}
function show(title: string, m: Map<string, number>, limit = 30) {
  console.log(`\n## ${title} (${m.size} distincts)`);
  for (const [k, v] of sortMap(m).slice(0, limit)) console.log(`  ${k} = ${v}`);
}

async function load(name: string) {
  return await Bun.file(`${DIR}/${name}`).json();
}

// ---------- db_consolidated ----------
{
  const db: any[] = await load("db_consolidated.json");
  console.log(`\n===== db_consolidated.json : ${db.length} entrées =====`);
  console.log("clés entrée[0]:", Object.keys(db[0]).join(", "));
  console.log("exemple[0]:", JSON.stringify(db[0]));
  // champs présents
  const allKeys = new Set<string>();
  for (const e of db) for (const k of Object.keys(e)) allKeys.add(k);
  console.log("union clés:", [...allKeys].join(", "));
  show("position", tally(db, (x) => x.position));
  show("element", tally(db, (x) => x.element));
  show("rarity", tally(db, (x) => x.rarity), 40);
  // imageUrl host
  show("imageUrl host", tally(db, (x) => { try { return new URL(x.imageUrl).host; } catch { return "(none)"; } }));
  // zukanId vs zukanHash equal?
  let sameIdHash = 0;
  for (const e of db) if (e.zukanId === e.zukanHash) sameIdHash++;
  console.log(`\nzukanId===zukanHash : ${sameIdHash}/${db.length}`);
  // hash prefix
  show("hash prefix (2 segs)", tally(db, (x) => (x.zukanHash || "").split("/").slice(0, 1).join("/")));
}

// ---------- param_en ----------
{
  const p: any[] = await load("param_en.json");
  console.log(`\n===== param_en.json : ${p.length} entrées =====`);
  console.log("clés entrée[0]:", Object.keys(p[0]).join(", "));
  console.log("exemple[0]:", JSON.stringify(p[0]));
  const allKeys = new Set<string>();
  for (const e of p) for (const k of Object.keys(e)) allKeys.add(k);
  console.log("union clés:", [...allKeys].join(", "));
  if (p[0].stats) console.log("clés stats:", Object.keys(p[0].stats).join(", "));
  show("position", tally(p, (x) => x.position));
  show("element", tally(p, (x) => x.element));
  show("game", tally(p, (x) => x.game), 40);
  show("gender", tally(p, (x) => x.gender));
  // stats coverage
  let withStats = 0;
  const statKeys = new Set<string>();
  for (const e of p) { if (e.stats) { withStats++; for (const k of Object.keys(e.stats)) statKeys.add(k); } }
  console.log(`\nentrées avec stats: ${withStats}/${p.length}; clés stats vues: ${[...statKeys].join(", ")}`);
  // stat ranges
  for (const sk of ["kick","control","technique","pressure","physical","agility","intelligence"]) {
    let mn = Infinity, mx = -Infinity, sum = 0, n = 0;
    for (const e of p) { const v = e.stats?.[sk]; if (typeof v === "number") { mn = Math.min(mn, v); mx = Math.max(mx, v); sum += v; n++; } }
    if (n) console.log(`  stat ${sk}: min=${mn} max=${mx} moy=${(sum/n).toFixed(1)} (n=${n})`);
  }
}

// ---------- param_ja ----------
{
  const p: any[] = await load("param_ja.json");
  console.log(`\n===== param_ja.json : ${p.length} entrées =====`);
  console.log("clés entrée[0]:", Object.keys(p[0]).join(", "));
  console.log("exemple[0]:", JSON.stringify(p[0]));
  const allKeys = new Set<string>();
  for (const e of p) for (const k of Object.keys(e)) allKeys.add(k);
  console.log("union clés:", [...allKeys].join(", "));
  show("element (ja)", tally(p, (x) => x.element));
  show("gender (ja)", tally(p, (x) => x.gender));
  show("game (ja)", tally(p, (x) => x.game), 40);
  let withDesc = 0;
  for (const e of p) if (e.description) withDesc++;
  console.log(`\nentrées avec description: ${withDesc}/${p.length}`);
  if (p[0].stats) console.log("clés stats ja:", Object.keys(p[0].stats).join(", "));
}

// ---------- zukan_mapping ----------
{
  const m: Record<string, any> = await load("zukan_mapping.json");
  const keys = Object.keys(m);
  console.log(`\n===== zukan_mapping.json : ${keys.length} clés =====`);
  console.log("exemple clé:", keys[0], "=>", JSON.stringify(m[keys[0]]));
  console.log("clés valeur:", Object.keys(m[keys[0]]).join(", "));
  // key format
  let hexKeys = 0;
  for (const k of keys) if (/^0x[0-9A-Fa-f]+$/.test(k)) hexKeys++;
  console.log(`clés au format 0xHEX: ${hexKeys}/${keys.length}`);
  // distinct hashes
  const hashes = new Set<string>();
  let maxOrder = -1;
  for (const k of keys) { hashes.add(m[k].hash); if (typeof m[k].order === "number") maxOrder = Math.max(maxOrder, m[k].order); }
  console.log(`hashes distincts pointés: ${hashes.size}; order max: ${maxOrder}`);
  // how many CRCs per hash (collisions/aliases)
  const perHash = new Map<string, number>();
  for (const k of keys) perHash.set(m[k].hash, (perHash.get(m[k].hash) ?? 0) + 1);
  const dist = tally([...perHash.values()].map(String).map(v => ({v})), x => x.v);
  show("nb de CRC par hash (distribution)", dist, 15);
}

// ---------- zukan_order_en ----------
{
  const o: any[] = await load("zukan_order_en.json");
  console.log(`\n===== zukan_order_en.json : ${o.length} entrées =====`);
  console.log("clés entrée[0]:", Object.keys(o[0]).join(", "));
  console.log("exemple[0]:", JSON.stringify(o[0]));
  show("game", tally(o, (x) => x.game), 40);
  show("position", tally(o, (x) => x.position));
  show("element", tally(o, (x) => x.element));
  let mn = Infinity, mx = -Infinity;
  for (const e of o) { if (typeof e.order === "number") { mn = Math.min(mn, e.order); mx = Math.max(mx, e.order); } }
  console.log(`order: min=${mn} max=${mx}`);
}

// ---------- series_audit ----------
{
  const s: any = await load("series_audit.json");
  console.log(`\n===== series_audit.json =====`);
  console.log("clés racine:", Object.keys(s).join(", "));
  console.log(JSON.stringify({ generatedAt: s.generatedAt, totalCrawled: s.totalCrawled, totalMatched: s.totalMatched, totalWrongSeries: s.totalWrongSeries, totalNotFound: s.totalNotFound }));
  console.log("\nbySeries:");
  for (const [k, v] of Object.entries<any>(s.bySeries ?? {})) {
    console.log(`  ${k}: ok=${v.ok} wrong=${v.wrong_series} not_found=${v.not_found}`);
  }
  // any other keys (e.g. notFound list)?
  for (const k of Object.keys(s)) {
    if (["generatedAt","totalCrawled","totalMatched","totalWrongSeries","totalNotFound","bySeries"].includes(k)) continue;
    const v = (s as any)[k];
    console.log(`  autre clé "${k}": ${Array.isArray(v) ? `array(${v.length}) ex=${JSON.stringify(v[0])}` : JSON.stringify(v).slice(0,200)}`);
  }
}

// ---------- skill-videos ----------
{
  const sv: any[] = await load("skill-videos.json");
  console.log(`\n===== skill-videos.json : ${sv.length} entrées =====`);
  console.log("clés entrée[0]:", Object.keys(sv[0]).join(", "));
  console.log("exemple[0]:", JSON.stringify(sv[0]));
  show("type", tally(sv, (x) => x.type), 30);
  // extensions
  show("videoUrl ext", tally(sv, (x) => (x.videoUrl||"").split(".").pop()));
  show("posterUrl ext", tally(sv, (x) => (x.posterUrl||"").split(".").pop()));
  show("thumbnailUrl ext", tally(sv, (x) => (x.thumbnailUrl||"").split(".").pop()));
  // sample names
  console.log("\nnoms exemples:", sv.slice(0, 15).map((x) => x.name).join(" | "));
}

// ---------- unmatched-skills ----------
{
  const us: any[] = await load("unmatched-skills.json");
  console.log(`\n===== unmatched-skills.json : ${us.length} entrées =====`);
  console.log("clés entrée[0]:", Object.keys(us[0]).join(", "));
  console.log("exemple[0]:", JSON.stringify(us[0]));
  show("type", tally(us, (x) => x.type), 30);
  console.log("\nnoms exemples:", us.slice(0, 20).map((x) => x.name).join(" | "));
}
