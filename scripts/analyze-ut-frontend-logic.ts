import fs from "fs";

const js = fs.readFileSync("var/mirror/ievr-ut/site/ievr-ultimate-team.fly.dev/assets/index-BJtdwxwy.js", "utf8");

function searchKeyword(keyword: string, window = 400) {
  let idx = 0;
  const matches: string[] = [];
  while ((idx = js.indexOf(keyword, idx)) !== -1) {
    const start = Math.max(0, idx - 100);
    const end = Math.min(js.length, idx + window);
    matches.push(js.slice(start, end));
    idx += keyword.length;
    if (matches.length >= 10) break;
  }
  return matches;
}

console.log("=== EXPORT / SAVE / LAUNCHER ===");
for (const k of ["export", "launcher", "mod", "save", "eac", "utmod", "descargar", "cifrar", "equipo_"]) {
  const m = searchKeyword(k, 300);
  if (m.length > 0) {
    console.log(`--- Keyword: ${k} (${m.length} hits) ---`);
    console.log(m[0].slice(0, 300));
  }
}

console.log("\n=== CHEMISTRY / QUIMICA / FORMATION ===");
for (const k of ["quimica", "sinergia", "media", "valoracion", "química", "formacion", "afinidad"]) {
  const m = searchKeyword(k, 300);
  if (m.length > 0) {
    console.log(`--- Keyword: ${k} (${m.length} hits) ---`);
    console.log(m[0].slice(0, 300));
  }
}

console.log("\n=== PACK OPENING ===");
for (const k of ["animacion", "abrir_sobre", "prob_", "ruleta", "bronce", "oro"]) {
  const m = searchKeyword(k, 300);
  if (m.length > 0) {
    console.log(`--- Keyword: ${k} (${m.length} hits) ---`);
    console.log(m[0].slice(0, 300));
  }
}
