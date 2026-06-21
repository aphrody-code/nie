const ROOT = "/home/ubuntu/niers";
const sd = await Bun.file(`${ROOT}/data/exports/sheet_data.json`).json();
const orion = await Bun.file(`${ROOT}/data/exports/orion-report.json`).json();
const ps = await Bun.file(`${ROOT}/data/exports/passive-sheets.json`).json();

const count = (arr: any[], f: string) => {
  const m: Record<string, number> = {};
  for (const x of arr) { const k = String(x[f]); m[k] = (m[k] || 0) + 1; }
  return m;
};
console.log("hissatsu by type:", JSON.stringify(count(sd.hissatsu, "type")));
console.log("hissatsu by element:", JSON.stringify(count(sd.hissatsu, "element")));
console.log("items by type:", JSON.stringify(count(sd.items, "type")));
console.log("kizuna by size:", JSON.stringify(count(sd.kizuna_items, "size")));
console.log("kizuna shops:", JSON.stringify([...new Set(sd.kizuna_items.map((x: any) => x.shop))]));
console.log("auras by type:", JSON.stringify(count(sd.auras, "type")));
console.log("tactics shops:", JSON.stringify([...new Set(sd.tactics.map((x: any) => x.shop))]));
console.log("drops by passive_type:", JSON.stringify(count(sd.drops, "passive_type")));
console.log("drops games:", JSON.stringify([...new Set(sd.drops.map((x: any) => x.game))]));
console.log("drops fixed_beans:", JSON.stringify([...new Set(sd.drops.map((x: any) => x.fixed_beans))]));
console.log("heroes unique char ids:", new Set(sd.heroes.map((x: any) => x.character_id)).size);
console.log("basara unique char ids:", new Set(sd.basara.map((x: any) => x.character_id)).size);
console.log("coordinators roles:", JSON.stringify(count(sd.coordinators, "role")));
console.log("coordinators games:", JSON.stringify([...new Set(sd.coordinators.map((x: any) => x.game))]));

console.log("\nORION teams:", orion.teams.map((t: any) => `${t.nameEn}(${t.memberCount})`).join(", "));
console.log("ORION rarity dist:", JSON.stringify(count(orion.characters, "rarity")));
console.log("ORION gender dist:", JSON.stringify(count(orion.characters, "gender")));
console.log("ORION scenario triggers len:", orion.scenario.triggers?.length, "objectives len:", orion.scenario.objectives?.length);
console.log("ORION trigger sample:", JSON.stringify(orion.scenario.triggers?.[0]));
console.log("ORION objective sample:", JSON.stringify(orion.scenario.objectives?.[0]));
console.log("ORION textRefs types:", JSON.stringify(count(orion.textReferences, "type")));
console.log("ORION textRefs sample:", orion.textReferences.slice(0, 6).map((t: any) => `${t.type}:${t.text}`).join(" | "));
console.log("ORION recommendations:", JSON.stringify(orion.recommendations));
console.log("ORION dataGaps:", JSON.stringify(orion.dataGaps).slice(0, 400));

console.log("\nplaystyles list:", JSON.stringify(ps.playstyles));
console.log("passive extractedAt:", ps.extractedAt);
