#!/usr/bin/env bun
/**
 * Produit l'arborescence DATA_PATH EXACTE consommée par `inagle push`
 * (createInagleService) à partir d'un dump iecode brut.
 *
 * Transformation (cf. packages/pipeline/src/datapath.ts + DataPathExporter.cs) :
 *   - strip du préfixe `data/` hérité de cpk_list,
 *   - décodage de chaque `.cfg.bin` → `.cfg.bin.json` (T2B→{entries}, RDBN→{version,lists}),
 *   - copie du `.cfg.bin` brut à côté (lossless), copie des fichiers loose.
 *
 * Le résultat est directement utilisable : `DATA_PATH=<out> inagle push` ou
 * `createInagleService()` le lit sans transformation supplémentaire.
 *
 * Env / args :
 *   IN  (--in <dir>)   dump iecode (`iecode dump -o <dir>`). Défaut : ~/iecode-dump.
 *                      On accepte un dump avec OU sans préfixe data/, ou l'install /data.
 *   OUT (--out <dir>)  racine DATA_PATH de sortie. Défaut : /tmp/iecode-data-export.
 *   --force            ré-écrit les .json déjà à jour.
 *   --no-raw           n'écrit pas le .cfg.bin brut (json seulement).
 *
 * Usage : bun run scripts/export-datapath.ts --in ~/iecode-dump --out /tmp/iecode-data-export
 */
import { exportDataPath } from "@rose-griffon/iecode-pipeline";
import { join } from "node:path";

function arg(name: string, fallback?: string): string | undefined {
	const i = process.argv.indexOf(`--${name}`);
	if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1];
	return fallback;
}
function flag(name: string): boolean {
	return process.argv.includes(`--${name}`);
}

const HOME = process.env.HOME ?? "/home/ubuntu";
const inputDir = arg("in", process.env.DATAPATH_IN ?? join(HOME, "iecode-dump"))!;
const outDir = arg("out", process.env.DATAPATH_OUT ?? "/tmp/iecode-data-export")!;

console.info(`▸ export DATA_PATH : ${inputDir} → ${outDir}`);
const res = await exportDataPath({
	inputDir,
	outDir,
	force: flag("force"),
	copyRawCfgBin: !flag("no-raw"),
	onLog: (m) => console.info(m),
});

console.info(
	`\n✓ DATA_PATH prêt : ${res.outDir}\n` +
		`  décodés=${res.decoded} à-jour=${res.skipped} échecs=${res.failed} ` +
		`bruts=${res.rawCopied} loose=${res.otherCopied}\n` +
		`  → inagle : DATA_PATH=${res.outDir} (createInagleService / inagle push)`
);
if (res.failed > 0) {
	console.warn(`⚠ ${res.failed} échecs de décodage :`);
	for (const f of res.failures.slice(0, 20)) console.warn(`   - ${f}`);
	process.exitCode = 1;
}
