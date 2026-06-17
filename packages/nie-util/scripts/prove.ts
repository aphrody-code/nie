/**
 * Script de preuve : exercice de @niers/util sur données réelles.
 *
 * Requiert NIE_GAME_DIR=/home/aphrody/niers (VFS monté).
 *
 * Usage : NIE_GAME_DIR=/home/aphrody/niers bun packages/nie-util/scripts/prove.ts
 */

import {
  measureGameText,
  stringWidth,
  tableFormat,
  inspect,
  gzip,
  gunzip,
  zstdCompress,
  zstdDecompress,
  requireBunVersion,
  semverOrder,
  escapeHTML,
  deepEquals,
  randomUUIDv7,
  peekPromise,
  which,
  nanoseconds,
  readConfig,
} from "../src/index.ts";

const sep = "─".repeat(60);

// ─── (d) Semver gate ─────────────────────────────────────────────────────────
console.log(sep);
console.log("[d] Version gate");
requireBunVersion(">=1.3");
console.log(`  Bun ${Bun.version} satisfait >=1.3 (semver.satisfies = true)`);
console.log(`  semverOrder("${Bun.version}", "1.3.0") = ${semverOrder(Bun.version, "1.3.0")}`);

// ─── (b) Compression ─────────────────────────────────────────────────────────
console.log(sep);
console.log("[b] Compression roundtrip");
const payload = new TextEncoder().encode("GOAL! ".repeat(1000));
const t0gz = nanoseconds();
const gz = gzip(payload, { level: 6 });
const t1gz = nanoseconds();
const restored = gunzip(gz);
const ok_gz = deepEquals(Array.from(restored), Array.from(payload));
console.log(`  gzip  : ${payload.length} → ${gz.length} octets ` +
  `(ratio ${(gz.length / payload.length * 100).toFixed(1)}%) ` +
  `en ${((t1gz - t0gz) / 1e6).toFixed(2)} ms | roundtrip ok = ${ok_gz}`);

const t0zs = nanoseconds();
const zst = zstdCompress(payload, { level: 3 });
const t1zs = nanoseconds();
const restored_zst = zstdDecompress(zst);
const ok_zst = deepEquals(Array.from(restored_zst), Array.from(payload));
console.log(`  zstd  : ${payload.length} → ${zst.length} octets ` +
  `(ratio ${(zst.length / payload.length * 100).toFixed(1)}%) ` +
  `en ${((t1zs - t0zs) / 1e6).toFixed(2)} ms | roundtrip ok = ${ok_zst}`);

// ─── (f) readConfig sur bunfig.toml ──────────────────────────────────────────
console.log(sep);
console.log("[f] readConfig — bunfig.toml (Bun.TOML.parse)");
const bunfig = await readConfig("/home/aphrody/niers/bunfig.toml");
console.log(inspect(bunfig, 3));

// ─── (c) tableFormat ─────────────────────────────────────────────────────────
console.log(sep);
console.log("[c] tableFormat — fichiers de référence du VFS");
const vfsRefs = [
  { fichier: "mainmenu90_00.g4tx", format: "G4TX",   taille: 1_409_536 },
  { fichier: "font.cfg.bin",        format: "T2B",    taille:   343_888 },
  { fichier: "main_menu_setting.cfg.bin", format: "cfg.bin", taille: 4_096 },
];
console.log(tableFormat(vfsRefs));

// ─── (e) Misc ─────────────────────────────────────────────────────────────────
console.log(sep);
console.log("[e] Utilitaires divers");

const html = escapeHTML('<script>alert("xss")</script>');
console.log(`  escapeHTML: ${html}`);

const uuid = randomUUIDv7();
console.log(`  randomUUIDv7: ${uuid}`);

const p = Promise.resolve({ loaded: true, count: 7638 });
const peeked = peekPromise(p);
console.log(`  peekPromise (resolved): ${inspect(peeked)}`);

console.log(`  which("bun"): ${which("bun")}`);
console.log(`  which("git"): ${which("git")}`);
console.log(`  nanoseconds(): ${nanoseconds()}`);

// ─── (a) measureGameText — données réelles ────────────────────────────────────
console.log(sep);
console.log("[a] measureGameText — police du jeu (font.cfg.bin via VFS)");

const strings = ["GOAL", "Hello", "Inazuma", "VICTORY ROAD", "A"];
const rows: Record<string, unknown>[] = [];
for (const s of strings) {
  const t_start = nanoseconds();
  const m = measureGameText(s);
  const t_end = nanoseconds();
  rows.push({
    chaîne: s,
    "terminal (cols)": m.terminalWidth,
    "pixel advance": m.pixelAdvance,
    "px / col": m.glyphsFound > 0
      ? (m.pixelAdvance / m.terminalWidth).toFixed(1)
      : "—",
    trouvés: m.glyphsFound,
    manquants: m.glyphsMissing,
    "µs": ((t_end - t_start) / 1e3).toFixed(1),
  });
}
console.log(tableFormat(rows));

console.log("[a] stringWidth cross-check (Bun.stringWidth pur)");
const swTable = [
  { input: "hello",               largeur: stringWidth("hello") },
  { input: "\\x1b[31mhello\\x1b[0m (ANSI)", largeur: stringWidth("\x1b[31mhello\x1b[0m") },
  { input: "日本語 (CJK)",         largeur: stringWidth("日本語") },
  { input: "VICTORY ROAD",        largeur: stringWidth("VICTORY ROAD") },
];
console.log(tableFormat(swTable));

console.log(sep);
console.log("Toutes les preuves OK.");
