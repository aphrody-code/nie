// Analyse de la famille "exports-inagle" : data/exports/**/*.json
// Bun + TS haut niveau. Sortie : faits bruts pour rédiger le markdown.
import { Glob } from "bun";

const ROOT = "/home/ubuntu/niers";
const glob = new Glob("data/exports/**/*.json");

function trunc(s: string, n = 60): string {
  s = String(s ?? "").replace(/\n/g, "\\n");
  return s.length > n ? s.slice(0, n) + "…" : s;
}
function keysOf(o: any): string[] {
  return o && typeof o === "object" && !Array.isArray(o) ? Object.keys(o) : [];
}

const out: string[] = [];
const log = (...a: any[]) => out.push(a.map(String).join(" "));

const files: string[] = [];
for await (const f of glob.scan(ROOT)) files.push(f);
files.sort();
log("FILES:", files.join(", "));

for (const rel of files) {
  const path = `${ROOT}/${rel}`;
  const data = await Bun.file(path).json();
  const base = rel.split("/").pop()!;
  log("\n\n################ " + base + " ################");
  log("topType:", Array.isArray(data) ? `array(${data.length})` : `object{${keysOf(data).join(",")}}`);

  if (base === "character_fr.json") {
    log("sample[0..2]:", JSON.stringify(data.slice(0, 3)));
    log("count:", data.length);
    const withModel = data.filter((d: any) => d.modelId && d.modelId !== "0" && d.modelId !== "");
    log("entries with real modelId:", withModel.length);
    const emptyModel = data.filter((d: any) => d.modelId === "0" || d.modelId === "");
    log("entries empty/0 modelId:", emptyModel.length);
    // prefixes of modelId
    const pref: Record<string, number> = {};
    for (const d of withModel) {
      const m = String(d.modelId).match(/^[a-zA-Z]+/);
      const p = m ? m[0] : "(num)";
      pref[p] = (pref[p] || 0) + 1;
    }
    log("modelId prefixes:", JSON.stringify(Object.fromEntries(Object.entries(pref).sort((a, b) => b[1] - a[1]))));
    log("sample real models:", withModel.slice(0, 12).map((d: any) => `${d.characterId}=${d.modelId}`).join(", "));
    const withName = data.filter((d: any) => d.nameId && d.nameId !== 0);
    log("entries nameId!=0:", withName.length, "sample:", JSON.stringify(withName.slice(0, 3)));
  }

  if (base === "noun_fr.json") {
    log("count:", data.length);
    const nonEmpty = data.filter((d: any) => d.name && d.name !== "");
    log("non-empty names:", nonEmpty.length);
    log("sample:", nonEmpty.slice(0, 14).map((d: any) => `${d.crc32}="${d.name}"`).join("; "));
    // distinct crc32
    const uniq = new Set(data.map((d: any) => d.crc32));
    log("distinct crc32:", uniq.size);
  }

  if (base === "orion-report.json") {
    log("metadata:", JSON.stringify(data.metadata));
    log("statistics:", JSON.stringify(data.statistics));
    log("scenario keys:", keysOf(data.scenario).join(","));
    if (data.scenario?.phases) log("scenario.phases len:", data.scenario.phases.length, "sample:", JSON.stringify(data.scenario.phases[0]));
    // characters?
    for (const k of keysOf(data)) {
      const v = (data as any)[k];
      if (Array.isArray(v)) log(`array field "${k}" len=${v.length} sample0=`, JSON.stringify(v[0]).slice(0, 300));
    }
    // if there's a characters array deeper
    if ((data as any).characters) {
      const c = (data as any).characters;
      log("characters[0]:", JSON.stringify(c[0]).slice(0, 500));
    }
  }

  if (base === "passive-sheets.json") {
    log("keys:", keysOf(data).join(","));
    for (const k of keysOf(data)) {
      const v = (data as any)[k];
      if (Array.isArray(v)) {
        log(`\n-- ${k}: len=${v.length}`);
        log(`  fields:`, keysOf(v[0]).join(","));
        log(`  sample0:`, JSON.stringify(v[0]));
        // distinct stats
        const stats = [...new Set(v.map((x: any) => x.stat).filter(Boolean))];
        log(`  distinct stat (${stats.length}):`, stats.slice(0, 30).join(" | "));
        const reqs = [...new Set(v.map((x: any) => x.requirement).filter(Boolean))];
        log(`  distinct requirement (${reqs.length}):`, reqs.slice(0, 20).map((r) => trunc(r as string, 40)).join(" | "));
      }
    }
  }

  if (base === "sheet_data.json") {
    log("meta:", JSON.stringify(data.meta));
    log("keys:", keysOf(data).join(","));
    for (const k of keysOf(data)) {
      const v = (data as any)[k];
      if (Array.isArray(v)) {
        log(`\n-- ${k}: len=${v.length} fields=${keysOf(v[0]).join(",")}`);
        log(`  sample0:`, JSON.stringify(v[0]));
        log(`  sample1:`, JSON.stringify(v[1]));
        // distinct enum-ish fields
        for (const fld of ["type", "sub_type", "element", "shop1", "shop2", "position", "rarity", "category"]) {
          if (v[0] && fld in v[0]) {
            const vals = [...new Set(v.map((x: any) => x[fld]).filter((x: any) => x !== "" && x != null))];
            log(`  distinct ${fld} (${vals.length}):`, vals.slice(0, 25).join(" | "));
          }
        }
        // names sample
        if (v[0] && "name" in v[0]) log(`  names:`, v.slice(0, 12).map((x: any) => x.name).join(", "));
      }
    }
  }

  if (base === "sheet_export.json") {
    log("title:", data.title);
    const sheets = data.sheets || {};
    const names = keysOf(sheets);
    log("sheet count:", names.length);
    log("sheet names:", names.join(" | "));
    for (const sn of names) {
      const rows = sheets[sn] as any[][];
      const maxCols = Math.max(0, ...rows.map((r) => (Array.isArray(r) ? r.length : 0)));
      log(`\n-- sheet "${sn}": rows=${rows.length} maxCols=${maxCols}`);
      // find first non-empty row as likely header
      const firstFull = rows.find((r) => Array.isArray(r) && r.filter((c) => c !== "").length >= 3);
      log(`  firstFullRow:`, JSON.stringify(firstFull?.map((c: any) => trunc(c, 22))));
      // a couple data rows after
      const idx = rows.indexOf(firstFull as any);
      for (let i = idx + 1; i < Math.min(idx + 3, rows.length); i++) {
        log(`  row[${i}]:`, JSON.stringify((rows[i] || []).map((c: any) => trunc(c, 22))));
      }
    }
  }

  if (base === "inagle_enriched.json") {
    log("count:", data.length);
    log("fields:", keysOf(data[0]).join(","));
    log("sample0:", JSON.stringify(data[0]));
    // distinct enums
    for (const fld of ["gender", "game", "type", "position", "alt_position", "element", "playstyle"]) {
      const vals = [...new Set(data.map((x: any) => x[fld]).filter((x: any) => x !== "" && x != null))];
      log(`distinct ${fld} (${vals.length}):`, vals.slice(0, 30).join(" | "));
    }
    // counts by type
    const byType: Record<string, number> = {};
    for (const d of data) byType[d.type] = (byType[d.type] || 0) + 1;
    log("count by type:", JSON.stringify(byType));
    const byGame: Record<string, number> = {};
    for (const d of data) byGame[d.game] = (byGame[d.game] || 0) + 1;
    log("count by game:", JSON.stringify(byGame));
    // how many have moveset/passives/image
    log("with moveset:", data.filter((d: any) => d.moveset).length);
    log("with passives:", data.filter((d: any) => d.passives).length);
    log("with image_url:", data.filter((d: any) => d.image_url).length);
    log("with name_localised:", data.filter((d: any) => d.name_localised).length);
    // top stat totals
    const players = data.filter((d: any) => typeof d.total_stats === "number");
    const top = [...players].sort((a, b) => b.total_stats - a.total_stats).slice(0, 8);
    log("top total_stats:", top.map((d: any) => `${d.name_romaji}(${d.total_stats})`).join(", "));
    // example with passives
    const wp = data.find((d: any) => d.passives);
    if (wp) log("example passives entry:", JSON.stringify({ name: wp.name_romaji, passives: trunc(wp.passives, 120), moveset: trunc(wp.moveset, 80) }));
  }
}

console.log(out.join("\n"));
