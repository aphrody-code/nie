#!/usr/bin/env bun
/**
 * nie-decode — CLI de décodage des formats de jeu IEVR.
 *
 * Usage :
 *   bun run apps/nie-decode/src/main.ts [options] <source> <outdir>
 *   bun run apps/nie-decode/src/main.ts --scripts <outdir>
 *
 * Options :
 *   --jobs N     Nombre de Bun Workers parallèles (défaut 1 = séquentiel).
 *   --compress   Compresse les sorties JSON en .json.zst (zstd niveau défaut).
 *   --build      Lance cargo build -p nie-ffi avant le décodage.
 *
 * Modes :
 *   <source> = chemin fichier    → décode ce fichier unique
 *   <source> = chemin dossier    → décode récursivement par extension
 *   --scripts <outdir>           → copie data/lua_scripts/ → <outdir>
 *
 * Extensions reconnues :
 *   .g4tx   → .png   (BC1-BC5 ; BC7/NXTCH ignoré avec avertissement)
 *   .cfg.bin, .objbin, .g4pkm, .lip, .p3lip, .mev, .mevbin, .g4md → .json[.zst]
 *
 * Nouveautés (cluster 2) :
 *   - Worker pool : --jobs N crée N Bun Workers qui décodent en parallèle ;
 *     chaque worker appelle libnie_ffi.so et transfère (zero-copy) les octets
 *     décodés vers le thread principal via postMessage.
 *   - Intégrité : Bun.CryptoHasher("sha256") sur chaque sortie → manifest.json.
 *   - Compression : Bun.zstdCompressSync sur les JSON si --compress.
 *   - Manifest : construit octet par octet avec Bun.ArrayBufferSink.
 *   - Build : Bun.which("cargo") + Bun.$ pour reconstruire libnie_ffi.so.
 *   - Timing : Bun.nanoseconds pour le débit en Mo/s.
 */

import { decode, decodeToPng } from "nie";
import type { DecodeTask, DecodeResult, WorkerReply } from "./worker.ts";
import { mkdirSync } from "node:fs";
import { join, basename, extname, dirname } from "node:path";

// ─── types ───────────────────────────────────────────────────────────────────

interface Flags {
  jobs: number;
  compress: boolean;
  build: boolean;
}

interface FileResult {
  outPath: string;
  sha256: string;
  bytesIn: number;
  bytesOut: number;
  ok: boolean;
  warn?: string;
  err?: string;
}

// ─── parsing des arguments ───────────────────────────────────────────────────

function parseArgs(argv: string[]): { flags: Flags; rest: string[] } {
  const flags: Flags = { jobs: 1, compress: false, build: false };
  const rest: string[] = [];
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === undefined) break;
    if (a === "--jobs" || a === "-j") {
      const nStr = argv[++i];
      const n = nStr !== undefined ? parseInt(nStr, 10) : NaN;
      if (isNaN(n) || n < 1) {
        console.error(`[error] --jobs doit être un entier >= 1 (reçu: ${nStr ?? "rien"})`);
        process.exit(1);
      }
      flags.jobs = n;
    } else if (a === "--compress") {
      flags.compress = true;
    } else if (a === "--build") {
      flags.build = true;
    } else {
      rest.push(a);
    }
    i++;
  }
  return { flags, rest };
}

// ─── extensions reconnues ────────────────────────────────────────────────────

const TEXT_EXTS  = new Set<string>([".cfg.bin", ".objbin", ".g4pkm", ".lip", ".p3lip", ".mev", ".mevbin", ".g4md"]);
const IMAGE_EXTS = new Set<string>([".g4tx"]);

function outputExt(path: string): ".png" | ".json" | null {
  if (path.endsWith(".cfg.bin")) return ".json";
  if (path.endsWith(".p3lip"))   return ".json";
  const ext = extname(path);
  if (IMAGE_EXTS.has(ext)) return ".png";
  if (TEXT_EXTS.has(ext))  return ".json";
  return null;
}

function globPattern(): string {
  return "**/*.{g4tx,objbin,g4pkm,lip,p3lip,mev,mevbin,g4md,cfg.bin}";
}

// ─── décodage séquentiel (--jobs 1) ─────────────────────────────────────────

/**
 * Décode srcPath → destPath en mode séquentiel (thread principal).
 * Calcule le sha256 de la sortie via Bun.CryptoHasher.
 * Si compress=true et sortie JSON, compresse en .json.zst via Bun.zstdCompressSync.
 */
async function decodeOneSeq(
  srcPath: string,
  destPath: string,
  compress: boolean,
): Promise<FileResult> {
  const outExt = outputExt(srcPath);
  if (outExt === null) {
    return { outPath: destPath, sha256: "", bytesIn: 0, bytesOut: 0, ok: false, warn: "extension non reconnue" };
  }

  let bytesIn = 0;
  try {
    const ab = await Bun.file(srcPath).arrayBuffer();
    const raw = new Uint8Array(ab);
    bytesIn = raw.byteLength;

    let outBytes: Uint8Array;
    let actualDest = destPath;

    if (outExt === ".png") {
      const png = decodeToPng(raw);
      if (png === null) {
        console.log(`[warn]  ${srcPath} → PNG échoué (BC7/NXTCH non supporté ?)`);
        return { outPath: destPath, sha256: "", bytesIn, bytesOut: 0, ok: false, warn: "BC7/NXTCH" };
      }
      outBytes = png;
    } else {
      const obj = decode(raw);
      if (obj === null) {
        console.log(`[warn]  ${srcPath} → JSON échoué (format non supporté)`);
        return { outPath: destPath, sha256: "", bytesIn, bytesOut: 0, ok: false, warn: "format non supporté" };
      }
      const jsonBytes = new TextEncoder().encode(JSON.stringify(obj, null, 2));
      if (compress) {
        outBytes = Bun.zstdCompressSync(jsonBytes);
        actualDest = destPath + ".zst";
      } else {
        outBytes = jsonBytes;
      }
    }

    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(outBytes);
    const sha256 = hasher.digest("hex");
    const bytesOut = outBytes.byteLength;

    mkdirSync(dirname(actualDest), { recursive: true });
    await Bun.write(actualDest, outBytes);

    const label = outExt === ".png" ? "[png]  " : compress ? "[json.zst]" : "[json] ";
    console.log(`${label} ${actualDest}`);

    return { outPath: actualDest, sha256, bytesIn, bytesOut, ok: true };
  } catch (e) {
    return { outPath: destPath, sha256: "", bytesIn, bytesOut: 0, ok: false, err: String(e) };
  }
}

// ─── pool de workers (--jobs N > 1) ─────────────────────────────────────────

/**
 * Exécute une liste de tâches sur un pool de N Bun Workers.
 *
 * Chaque worker tourne dans son propre thread OS :
 *   - appelle dlopen(libnie_ffi.so) indépendamment
 *   - décode, compresse, hash la sortie
 *   - transfère l'ArrayBuffer résultant (zero-copy) vers le thread principal
 *   - le thread principal écrit le fichier et collecte les métadonnées
 *
 * La distribution est round-robin lazy : chaque slot de worker prend la
 * prochaine tâche disponible dès qu'il est libre (aucune pré-partition).
 */
async function runWorkerPool(tasks: DecodeTask[], jobCount: number): Promise<FileResult[]> {
  if (tasks.length === 0) return [];

  const n = Math.min(jobCount, tasks.length);
  const results: FileResult[] = [];
  let taskIdx = 0;

  // Chaque worker envoie un WorkerReply contenant éventuellement un outData transféré.
  async function driveWorker(worker: Worker, workerIdx: number): Promise<void> {
    while (taskIdx < tasks.length) {
      const task = tasks[taskIdx++]!;

      const reply = await new Promise<WorkerReply>((resolve) => {
        worker.onmessage = (evt: MessageEvent<WorkerReply>) => resolve(evt.data);
        worker.postMessage(task);
      });

      const { result, outData } = reply;

      if (result.ok && outData !== null) {
        // Écriture depuis le thread principal (outData reçu par transfer zero-copy).
        mkdirSync(dirname(result.destPath), { recursive: true });
        await Bun.write(result.destPath, new Uint8Array(outData));
        const label = result.destPath.endsWith(".png") ? "[png]  "
          : result.destPath.endsWith(".zst") ? "[json.zst]"
          : "[json] ";
        console.log(`${label} ${result.destPath}  [w${workerIdx}]`);
      } else if (!result.ok) {
        const msg = result.warn ?? result.err ?? "erreur inconnue";
        console.log(`[warn]  ${result.srcPath} (${msg})`);
      }

      const fr: FileResult = {
        outPath:  result.destPath,
        sha256:   result.sha256,
        bytesIn:  result.bytesIn,
        bytesOut: result.bytesOut,
        ok:       result.ok,
        ...(result.warn !== undefined ? { warn: result.warn } : {}),
        ...(result.err  !== undefined ? { err:  result.err  } : {}),
      };
      results.push(fr);
    }
  }

  const workers = Array.from({ length: n }, () =>
    new Worker(new URL("./worker.ts", import.meta.url)),
  );

  await Promise.all(workers.map((w, idx) => driveWorker(w, idx)));

  for (const w of workers) w.terminate();
  return results;
}

// ─── manifest (Bun.ArrayBufferSink) ─────────────────────────────────────────

/**
 * Construit les octets du manifest.json en utilisant Bun.ArrayBufferSink
 * pour assembler la chaîne JSON morceau par morceau sans concaténation.
 *
 * Format :
 * {
 *   "version": "1",
 *   "generated": "<ISO8601>",
 *   "totalBytesIn": N,
 *   "totalBytesOut": N,
 *   "elapsedMs": N,
 *   "files": {
 *     "/abs/path.png": { "sha256": "...", "sizeIn": N, "sizeOut": N },
 *     ...
 *   }
 * }
 */
function buildManifestBytes(
  entries: FileResult[],
  totalBytesIn: number,
  totalBytesOut: number,
  elapsedMs: number,
): Uint8Array {
  const sink = new Bun.ArrayBufferSink();
  sink.start({ asUint8Array: true });

  sink.write(`{\n`);
  sink.write(`  "version": "1",\n`);
  sink.write(`  "generated": ${JSON.stringify(new Date().toISOString())},\n`);
  sink.write(`  "totalBytesIn": ${totalBytesIn},\n`);
  sink.write(`  "totalBytesOut": ${totalBytesOut},\n`);
  sink.write(`  "elapsedMs": ${elapsedMs.toFixed(2)},\n`);
  sink.write(`  "files": {\n`);

  const ok = entries.filter((e) => e.ok);
  for (let i = 0; i < ok.length; i++) {
    if (i > 0) sink.write(`,\n`);
    const e = ok[i]!;
    sink.write(`    ${JSON.stringify(e.outPath)}: `);
    sink.write(
      JSON.stringify({ sha256: e.sha256, sizeIn: e.bytesIn, sizeOut: e.bytesOut }),
    );
  }

  sink.write(`\n  }\n}`);

  return sink.end() as Uint8Array;
}

// ─── modes de décodage ───────────────────────────────────────────────────────

/**
 * Décode un fichier unique (toujours séquentiel, manifest de 1 entrée).
 */
async function decodeFile(src: string, outdir: string, flags: Flags): Promise<FileResult[]> {
  const outExt = outputExt(src);
  if (outExt === null) {
    console.log(`[skip]  ${src} (extension non reconnue)`);
    return [];
  }

  let base = basename(src);
  if (base.endsWith(".cfg.bin")) base = base.slice(0, -".cfg.bin".length);
  else if (base.endsWith(".p3lip")) base = base.slice(0, -".p3lip".length);
  else base = base.slice(0, -extname(base).length);

  mkdirSync(outdir, { recursive: true });
  const dest = join(outdir, base + outExt);
  const result = await decodeOneSeq(src, dest, flags.compress);
  return [result];
}

/**
 * Décode récursivement un dossier source.
 * Si flags.jobs > 1 : distribue sur un pool de Bun Workers.
 * Sinon : décode séquentiellement dans le thread principal.
 */
async function decodeFolder(srcDir: string, outdir: string, flags: Flags): Promise<FileResult[]> {
  const glob = new Bun.Glob(globPattern());

  // Collecte de tous les fichiers à traiter (nécessaire avant de créer les workers).
  const pairs: { srcPath: string; destPath: string; isImage: boolean }[] = [];

  for await (const rel of glob.scan({ cwd: srcDir, onlyFiles: true })) {
    const srcPath = join(srcDir, rel);
    const outExt  = outputExt(rel);
    if (outExt === null) continue;

    let relOut = rel;
    if (relOut.endsWith(".cfg.bin")) relOut = relOut.slice(0, -".cfg.bin".length) + ".json";
    else if (relOut.endsWith(".p3lip")) relOut = relOut.slice(0, -".p3lip".length) + ".json";
    else relOut = relOut.slice(0, -extname(relOut).length) + outExt;

    pairs.push({ srcPath, destPath: join(outdir, relOut), isImage: outExt === ".png" });
  }

  if (pairs.length === 0) {
    console.log(`[done]  0 fichier(s) trouvé(s) dans ${srcDir}`);
    return [];
  }

  let results: FileResult[];

  if (flags.jobs > 1) {
    console.log(`[pool]  ${pairs.length} fichier(s), ${Math.min(flags.jobs, pairs.length)} worker(s)`);
    const tasks: DecodeTask[] = pairs.map((p, i) => ({
      type: "decode" as const,
      id: i,
      srcPath: p.srcPath,
      destPath: p.destPath,
      isImage: p.isImage,
      compress: flags.compress,
    }));
    const wResults = await runWorkerPool(tasks, flags.jobs);
    // runWorkerPool renvoie déjà des FileResult
    results = wResults;
  } else {
    results = [];
    for (const p of pairs) {
      results.push(await decodeOneSeq(p.srcPath, p.destPath, flags.compress));
    }
  }

  console.log(`[done]  ${pairs.length} fichier(s) traité(s) depuis ${srcDir}`);
  return results;
}

async function decodeScripts(outdir: string): Promise<void> {
  const wsRoot = `${import.meta.dir}/../../..`;
  const luaDir = `${wsRoot}/data/lua_scripts`;

  if (!(await Bun.file(luaDir).exists())) {
    console.error(`[error] data/lua_scripts/ absent (NIE_GAME_DIR non configuré ?)`);
    process.exit(1);
  }

  mkdirSync(outdir, { recursive: true });
  const glob = new Bun.Glob("**/*.lua.bin");
  let count = 0;
  for await (const rel of glob.scan({ cwd: luaDir, onlyFiles: true })) {
    const srcPath  = join(luaDir, rel);
    const destPath = join(outdir, rel);
    mkdirSync(dirname(destPath), { recursive: true });
    await Bun.write(destPath, Bun.file(srcPath));
    count++;
  }
  console.log(`[done]  ${count} script(s) Lua copié(s) vers ${outdir}`);
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const t0 = Bun.nanoseconds();
  const { flags, rest } = parseArgs(process.argv.slice(2));

  if (rest[0] === "--help" || rest[0] === "-h" || (rest.length === 0 && !flags.build)) {
    console.log(`nie-decode — outil de décodage formats IEVR

Usage :
  bun run apps/nie-decode/src/main.ts [options] <source> <outdir>
  bun run apps/nie-decode/src/main.ts --scripts <outdir>

Options :
  --jobs N     N workers Bun parallèles (défaut 1)
  --compress   Compresse les JSON en .json.zst (zstd)
  --build      Reconstruit libnie_ffi.so via cargo avant décodage

Modes :
  <source> = fichier   décode ce fichier unique
  <source> = dossier   décode récursivement (glob **/*.{g4tx,cfg.bin,...})
  --scripts <outdir>   copie data/lua_scripts/ vers <outdir>

Extensions reconnues :
  .g4tx              -> .png  (DDS BC1-BC5 ; BC7 ignoré)
  .cfg.bin .objbin .g4pkm .lip .p3lip .mev .mevbin .g4md -> .json[.zst]

Après décodage (dossier/fichier), écrit <outdir>/manifest.json.
`);
    process.exit(0);
  }

  // ── --build : Bun.which + Bun.$ pour reconstruire libnie_ffi.so ───────────
  if (flags.build) {
    const cargoBin = Bun.which("cargo");
    if (cargoBin === null) {
      console.error("[error] cargo introuvable dans PATH — installer Rust via https://rustup.rs");
      process.exit(1);
    }
    console.log(`[build] cargo : ${cargoBin}`);
    await Bun.$`${cargoBin} build -p nie-ffi`.quiet();
    console.log("[build] libnie_ffi.so reconstruit");
    if (rest.length === 0) return; // --build seul : arrêter ici
  }

  if (rest[0] === "--scripts") {
    const outdir = rest[1] ?? "./out/scripts";
    await decodeScripts(outdir);
    return;
  }

  if (rest.length < 2) {
    console.error("[error] Usage : nie-decode [options] <source> <outdir>");
    process.exit(1);
  }

  const src    = rest[0]!;
  const outdir = rest[1]!;

  // ── décodage ───────────────────────────────────────────────────────────────
  let results: FileResult[];

  const srcFile = Bun.file(src);
  if (await srcFile.exists()) {
    // Fichier unique → toujours séquentiel
    results = await decodeFile(src, outdir, flags);
  } else {
    // Dossier → séquentiel ou worker pool selon --jobs
    results = await decodeFolder(src, outdir, flags);
  }

  // ── timing ─────────────────────────────────────────────────────────────────
  const elapsedNs  = Bun.nanoseconds() - t0;
  const elapsedMs  = elapsedNs / 1e6;
  const totalIn    = results.reduce((s, r) => s + r.bytesIn, 0);
  const totalOut   = results.reduce((s, r) => s + r.bytesOut, 0);
  const throughput = totalIn > 0 ? (totalIn / 1e6) / (elapsedMs / 1e3) : 0;
  const ok         = results.filter((r) => r.ok).length;
  const skipped    = results.length - ok;

  console.log(
    `[timing] ${ok} ok, ${skipped} ignoré(s) — ` +
    `${elapsedMs.toFixed(0)}ms — ` +
    `entrée ${(totalIn / 1e6).toFixed(2)} Mo — ` +
    `sortie ${(totalOut / 1e6).toFixed(2)} Mo — ` +
    `${throughput.toFixed(1)} Mo/s`,
  );

  // ── manifest (Bun.ArrayBufferSink) ─────────────────────────────────────────
  if (results.length > 0) {
    mkdirSync(outdir, { recursive: true });
    const manifestBytes = buildManifestBytes(results, totalIn, totalOut, elapsedMs);
    const manifestPath  = join(outdir, "manifest.json");
    await Bun.write(manifestPath, manifestBytes);
    console.log(
      `[manifest] ${manifestPath}  ` +
      `(${ok} fichier(s), ${manifestBytes.byteLength} octets)`,
    );
  }
}

await main();
