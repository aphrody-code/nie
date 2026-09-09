#!/usr/bin/env bun
/**
 * Génère l'index CPK d'IEVR consommé par le navigateur/arbre de fichiers d'azalee
 * (`/cpk`, `lib/cpk/index.ts`, `app/api/cpk`).
 *
 * Source of truth: the mounted game VFS, queried through the native `nie` binary.
 *
 * STRATÉGIE D'ARTEFACT (build standalone fresh-checkout) :
 * Un `.sqlite` plein (8 colonnes + index sur 250 k lignes) pèse ~93 Mo — trop
 * lourd à tracker en git. À l'inverse, `*.sqlite` est gitignoré globalement.
 * On tracke donc un NDJSON gzippé compact `data/azalee/cpk-index.ndjson.gz` (~7 Mo, une
 * ligne `[path, cpk]` par fichier) et la lib runtime (`lib/cpk/index.ts`)
 * MATÉRIALISE la table `cpk_index(path, top, sub, dir, name, ext, cpk, depth)`
 * dans un SQLite de cache au premier accès (singleton process-local). Robuste :
 * pas de binaire 93 Mo en git, pas de symlink (piège Turbopack hors-racine), et
 * l'artefact survit au fresh-checkout.
 *
 * Run : `bun scripts/build-cpk-index.ts`
 *   --out=<path>    sortie NDJSON gz (défaut: data/cpk-index.ndjson.gz)
 *   --sqlite        écrit AUSSI un .sqlite plein (debug ; data/cpk-index.sqlite)
 */
import { Database } from "bun:sqlite";
import { gzipSync } from "node:zlib";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { $ } from "bun";
import { buildSqliteFromEntries, type CpkEntry } from "../src/cpk/materialize";

interface Args {
	outPath: string;
	sqlite: boolean;
	niers: string;
}

function parseArgs(argv: string[]): Args {
	const get = (flag: string): string | undefined => {
		const hit = argv.find((a) => a.startsWith(`${flag}=`));
		return hit?.slice(flag.length + 1);
	};
	const scriptDir = path.dirname(new URL(import.meta.url).pathname);
	const repoRoot = path.resolve(scriptDir, "../../..");
	return {
		outPath: path.resolve(get("--out") ?? path.join(repoRoot, "data/azalee/cpk-index.ndjson.gz")),
		sqlite: argv.includes("--sqlite"),
		niers: get("--niers") ?? process.env.NIERS_BIN ?? "/home/ubuntu/niers/target/debug/niers",
	};
}

/**
 * Récupère l'index complet depuis le **VFS live** du jeu, via `niers vfs find --json`.
 *
 * C'est la source à préférer : l'index Redis `iev:file:index` n'est réalimenté par rien
 * d'automatique et se périme silencieusement à chaque mise à jour du jeu. Au 15/08/2026 il
 * portait 250 800 entrées contre 255 308 dans le VFS — **4 508 fichiers ajoutés par les MAJ
 * étaient invisibles dans `/cpk`**, alors que `/textures`, `/sons`, `/videos` et `/modeles`,
 * qui interrogent le VFS live, les voyaient déjà. Rien ne signalait l'écart.
 *
 * `niers` monte les CPK et rend `{path, size, cpk}` — exactement ce que l'index demande.
 * La limite `-n` est explicite : sans elle la commande plafonne à 102 résultats, ce qui
 * produirait un index tronqué d'allure normale.
 */
async function readVfsIndex(niers: string): Promise<CpkEntry[]> {
	const brut = await $`${niers} vfs find data/ --json -n 400000`.quiet().text();
	const lignes = JSON.parse(brut) as { path: string; cpk?: string }[];
	return lignes.filter((e) => e.path && e.cpk).map((e): CpkEntry => [e.path, e.cpk as string]);
}

async function main(): Promise<void> {
	const args = parseArgs(Bun.argv.slice(2));

	const entries = await readVfsIndex(args.niers);
	if (entries.length === 0) {
		console.error(`[build-cpk-index] VFS empty — abort (binary ${args.niers} missing, or game not installed)`);
		process.exit(1);
	}
	console.log(`[build-cpk-index] ${entries.length} entries from the game VFS`);

	mkdirSync(path.dirname(args.outPath), { recursive: true });

	// NDJSON compact : une ligne `["data/...","<hash>.cpk"]` par fichier. La
	// décomposition en colonnes (top/sub/dir/name/ext/depth) est dérivée au
	// chargement (lib/cpk/materialize) → artefact minimal, source unique.
	const ndjson = entries.map((e) => JSON.stringify(e)).join("\n");
	const gz = gzipSync(Buffer.from(ndjson, "utf8"), { level: 9 });
	await Bun.write(args.outPath, gz);
	console.log(`[build-cpk-index] ndjson.gz -> ${args.outPath} (entries=${entries.length}, ${(gz.length / 1024 / 1024).toFixed(1)} Mo)`);

	if (args.sqlite) {
		const sqlitePath = args.outPath.replace(/\.ndjson\.gz$/, ".sqlite");
		const db = new Database(sqlitePath, { create: true });
		buildSqliteFromEntries(db, entries);
		const count = (db.query("SELECT COUNT(*) AS n FROM cpk_index").get() as { n: number }).n;
		db.close();
		console.log(`[build-cpk-index] sqlite (debug) -> ${sqlitePath} (rows=${count})`);
	}

	console.log("[build-cpk-index] git add data/azalee/cpk-index.ndjson.gz  # tracké (artefact source)");
}

await main();
