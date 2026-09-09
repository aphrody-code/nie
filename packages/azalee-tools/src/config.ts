/** Runtime configuration for the Azalee compatibility tooling.
 *
 * IEVR artifacts are repository-owned and live under `data/azalee`. They must
 * come from the game VFS, native `nie` exports, or verified `inagle`/`zukan`
 * materializations. The unrelated Cross catalog remains outside this resolver.
 * The SQLite mirror is a local read-only `inagle` materialization.
 */

import { existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** Options de configuration explicites (priorité maximale). */
export interface AzaleeConfig {
	/** Directory containing runtime artifacts (`cpk-index.ndjson.gz`, game-text indexes, and zukan data). */
	dataDir?: string;
	/** Read-only SQLite mirror path for the `inagle_*` tables. */
	mirrorPath?: string;
	/** Cache directory for materialized SQLite files (default: `os.tmpdir()`). */
	cacheDir?: string;
}

const explicit: AzaleeConfig = {};

/**
 * Set runtime configuration. Calls merge and are normally made once by the
 * host application or CLI during startup.
 */
export function configureAzalee(config: AzaleeConfig): void {
	if (config.dataDir !== undefined) explicit.dataDir = path.resolve(config.dataDir);
	if (config.mirrorPath !== undefined) explicit.mirrorPath = path.resolve(config.mirrorPath);
	if (config.cacheDir !== undefined) explicit.cacheDir = path.resolve(config.cacheDir);
}

/** Return the current explicit configuration (read-only). */
export function getAzaleeConfig(): Readonly<AzaleeConfig> {
	return explicit;
}

/** Reset explicit configuration for tests. */
export function resetAzaleeConfig(): void {
	delete explicit.dataDir;
	delete explicit.mirrorPath;
	delete explicit.cacheDir;
}

/**
 * Racine du package (`packages/azalee`), déduite de l'emplacement de ce module.
 * Sert de dernier recours pour remonter jusqu'à `data/azalee` en monorepo.
 */
function packageRoot(): string {
	// `import.meta.dir` (Bun) / `import.meta.url` (Node) → `<pkg>/src`.
	const here =
		typeof import.meta.dir === "string" ? import.meta.dir : path.dirname(new URL(import.meta.url).pathname);
	return path.resolve(here, "..");
}

/** Data-directory candidates, from the most specific to the most generic. */
export function dataDirCandidates(): string[] {
	const root = packageRoot();
	return [
		explicit.dataDir,
		process.env.AZALEE_DATA_DIR,
        // Shared Azalee artifacts live in the repository, outside the Next host.
		path.resolve(process.cwd(), "data/azalee"),
		// Serveur standalone Next (cwd = `.next/standalone/apps/azalee`) et
		// `next build` (cwd = `apps/azalee`).
		path.resolve(process.cwd(), "data"),
        // From `packages/azalee`: ../../data/azalee.
		path.resolve(root, "../../data/azalee"),
	].filter((p): p is string => Boolean(p));
}

/** Markers for a directory containing migrated game artifacts. */
const DATA_DIR_MARKERS = [
	"cpk-index.ndjson.gz",
	"game-text-names.ndjson.gz",
	"zukan-audit.json",
];

/**
 * Resolve the first candidate containing a migrated game artifact. Return
 * `null` when no candidate matches.
 */
export function resolveDataDir(): string | null {
	for (const candidate of dataDirCandidates()) {
		if (!existsSync(candidate)) continue;
		if (DATA_DIR_MARKERS.some((marker) => existsSync(path.join(candidate, marker)))) {
			return candidate;
		}
	}
	return null;
}

/**
 * Resolve an artifact by name. The first existing candidate wins.
 */
export function resolveDataFile(name: string): string | null {
	for (const dir of dataDirCandidates()) {
		const candidate = path.join(dir, name);
		if (existsSync(candidate)) return candidate;
	}
	return null;
}

/**
 * Repository mirror: `var/mirror.sqlite`, published by the local inagle mirror job.
 *
 * The resolver walks up to the repository containing both `Cargo.toml` and
 * `crates`, so an unrelated `var` directory is never selected.
 */
function miroirDuDepot(): string | null {
	let courant = packageRoot();
	for (;;) {
		if (existsSync(path.join(courant, "Cargo.toml")) && existsSync(path.join(courant, "crates"))) {
			const miroir = path.join(courant, "var", "mirror.sqlite");
			return existsSync(miroir) ? miroir : null;
		}
		const parent = path.dirname(courant);
		if (parent === courant) return null;
		courant = parent;
	}
}

/**
 * Resolve the read-only SQLite materialization of the `inagle_*` tables.
 *
 * Production systemd units pin `SQLITE_DB_PATH` to `var/mirror.sqlite`.
 * Without that pin, selecting the lexicographically newest snapshot would be
 * a silent source change.
 */
export function resolveMirrorPath(): string | null {
	if (explicit.mirrorPath) return explicit.mirrorPath;
	if (process.env.SQLITE_DB_PATH) return path.resolve(process.env.SQLITE_DB_PATH);

	// Prefer the repository mirror. It is the only default source.
    const mirror = miroirDuDepot();
    if (mirror) return mirror;

	for (const dir of dataDirCandidates()) {
		const backups = path.join(dir, "backups");
		const pinned = path.join(backups, "mirror.sqlite");
		if (existsSync(pinned)) return pinned;
		try {
			const snapshots = readdirSync(backups)
				.filter((f) => f.startsWith("inagle-") && f.endsWith(".sqlite"))
				.sort((a, b) => b.localeCompare(a));
			if (snapshots.length > 0) return path.join(backups, snapshots[0]);
		} catch {
            // Candidate is absent or unreadable; try the next one.
		}
	}
	return null;
}

/**
 * Dossier de cache des SQLite matérialisés (index CPK, index de texte). Sur le
 * VPS `os.tmpdir()` est un tmpfs : matérialisation en RAM, reconstruite au
 * redémarrage si l'artefact source est plus récent.
 */
export function getCacheDir(sub?: string): string {
	const base = explicit.cacheDir ?? process.env.AZALEE_CACHE_DIR ?? tmpdir();
	return sub ? path.join(base, sub) : base;
}
