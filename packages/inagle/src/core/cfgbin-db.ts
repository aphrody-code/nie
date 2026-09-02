/**
 * @file cfgbin-db.ts
 * @description Loader cfg.bin natif via la DB SQLite produite par
 * `iecode cfgbin-db build` (~/data/cache/cfgbin.sqlite).
 *
 * Remplace les centaines de milliers de loose `.cfg.bin.json` du
 * filesystem par une seule DB ~2.3 GB lue en O(1) via index PK.
 *
 * Schema attendu :
 *   CREATE TABLE cfgbin (
 *     path   TEXT PRIMARY KEY,    -- ex: "data/common/gamedata/character/chara_param_1.03.66.00.cfg.bin"
 *     cpk    TEXT NOT NULL,
 *     size   INTEGER NOT NULL,
 *     parsed INTEGER NOT NULL,    -- 1=ok, 0=erreur, 2=timeout
 *     format TEXT,                -- "T2B" | "RDBN" | NULL
 *     error  TEXT,
 *     json   TEXT
 *   );
 *   CREATE INDEX idx_cfgbin_cpk ON cfgbin(cpk);
 *
 * Mapping path :
 *   inagle:  loadConfig("character", "chara_param_X.cfg.bin.json")
 *   DB path: "data/common/gamedata/character/chara_param_X.cfg.bin"
 *
 * Trouvable via `IEVR_CFGBIN_DB` env var, fallback ~/data/cache/cfgbin.sqlite.
 *
 * Si la DB n'existe pas, `cfgbinDbAvailable()` retourne false et tous les
 * appelants doivent fallback sur le filesystem (`.cfg.bin.json` loose).
 * C'est le mode par defaut dans azalee — la DB est opt-in via iecode.
 */

import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { Database } from "bun:sqlite";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const DB = typeof Bun !== "undefined" ? (require("bun:sqlite").Database as typeof Database) : null;

const DEFAULT_DB_PATH = join(homedir(), "data/cache/cfgbin.sqlite");

let _db: Database | null = null;
let _enabled: boolean | null = null;
let _findStmt: ReturnType<Database["prepare"]> | null = null;
let _loadStmt: ReturnType<Database["prepare"]> | null = null;
let _listStmt: ReturnType<Database["prepare"]> | null = null;

/**
 * Returns the configured DB path (env override or default).
 */
export function cfgbinDbPath(): string {
	return process.env.IEVR_CFGBIN_DB ?? DEFAULT_DB_PATH;
}

/**
 * True if the DB exists and is usable. Cached after first check.
 * Uses Bun.Glob.scanSync as a sync stat shim (Bun.file().exists() is async-only).
 */
export function cfgbinDbAvailable(): boolean {
	if (_enabled !== null) return _enabled;
	const p = cfgbinDbPath();
	try {
		const gen = new Bun.Glob(basename(p)).scanSync({
			cwd: dirname(p),
			onlyFiles: true,
		});
		_enabled = !gen.next().done;
	} catch {
		_enabled = false;
	}
	return _enabled;
}

/**
 * Lazy-open the DB in read-only mode. Returns null if unavailable.
 * Subsequent calls reuse the same handle.
 */
function getDb(): Database | null {
	if (_db) return _db;
	if (!cfgbinDbAvailable()) return null;
	_db = new DB!(cfgbinDbPath(), { readonly: true });
	_db.exec("PRAGMA journal_mode=WAL");
	_db.exec("PRAGMA temp_store=MEMORY");
	_db.exec("PRAGMA cache_size=-65536");
	return _db;
}

function findStmt(db: Database) {
	if (!_findStmt) {
		_findStmt = db.prepare<{ path: string }, [string]>(
			`SELECT path FROM cfgbin
       WHERE path LIKE ? AND parsed = 1
       ORDER BY path DESC
       LIMIT 1`
		);
	}
	return _findStmt;
}

function loadStmt(db: Database) {
	if (!_loadStmt) {
		_loadStmt = db.prepare<{ json: string | null; error: string | null }, [string]>(
			`SELECT json, error FROM cfgbin WHERE path = ?`
		);
	}
	return _loadStmt;
}

function listStmt(db: Database) {
	if (!_listStmt) {
		_listStmt = db.prepare<{ path: string }, [string]>(
			`SELECT path FROM cfgbin WHERE path LIKE ? AND parsed = 1`
		);
	}
	return _listStmt;
}

/**
 * Internal path inside the CPK for a (category, filename) pair.
 * Strips `.json` since the DB stores the original `.cfg.bin` paths.
 */
export function cfgbinDbPathFor(category: string, filename: string): string {
	const stripped = filename.endsWith(".json") ? filename.slice(0, -".json".length) : filename;
	return `data/common/gamedata/${category}/${stripped}`;
}

/**
 * Internal path for a localized text file.
 *   inagle: textRoot/<locale>/chara_text.cfg.bin.json
 *   DB:     data/common/text/<locale>/chara_text.cfg.bin
 */
export function cfgbinDbTextPathFor(locale: string, filename: string): string {
	const stripped = filename.endsWith(".json") ? filename.slice(0, -".json".length) : filename;
	return `data/common/text/${locale}/${stripped}`;
}

/**
 * Find the latest version of a cfg.bin matching `prefix*` in `category`.
 * Returns the basename (with `.json` suffix added back so callers stay drop-in
 * compatible with the filesystem `findConfigFile`).
 *
 * Returns null if DB unavailable or no match.
 */
export function cfgbinDbFindLatest(category: string, prefix: string): string | null {
	const db = getDb();
	if (!db) return null;
	// Pattern : data/common/gamedata/<category>/<prefix>%cfg.bin
	const pattern = `data/common/gamedata/${category}/${prefix}%cfg.bin`;
	const row = findStmt(db).get(pattern) as { path: string } | null;
	if (!row) return null;
	// Reconstruct filename + .json suffix to stay compatible with loadConfig() callers
	const base = row.path.split("/").pop() ?? "";
	return base ? `${base}.json` : null;
}

/**
 * Returns parsed JSON for a cfg.bin in `category` with `filename`.
 * Throws if the row is absent OR if parsed=0 (the DB knows it failed).
 */
export function cfgbinDbLoad(category: string, filename: string): unknown {
	const db = getDb();
	if (!db) throw new Error("cfgbin-db: DB unavailable");
	const path = cfgbinDbPathFor(category, filename);
	const row = loadStmt(db).get(path) as {
		json: string | null;
		error: string | null;
	} | null;
	if (!row) throw new Error(`cfgbin-db: row not found '${path}'`);
	if (row.json === null) {
		throw new Error(`cfgbin-db: parse failed '${path}': ${row.error ?? "?"}`);
	}
	return JSON.parse(row.json);
}

/**
 * Returns parsed JSON for a localized text cfg.bin (chara_text, skill_text...).
 *
 * Note : par defaut on **bypass** la DB pour les fichiers `text/*` car le parser
 * cfg.bin actuel corrompt les chaines (vars[N] = null au lieu du nom localise,
 * cf. NOUN_INFO_*). Le filesystem fallback (`~/data/common/text/<locale>/*.cfg.bin.json`)
 * a la version correcte. Pour re-activer apres fix parser, exporter
 * `IEVR_CFGBIN_DB_TEXT=1`.
 */
export function cfgbinDbLoadText(locale: string, filename: string): unknown {
	if (!process.env.IEVR_CFGBIN_DB_TEXT) {
		throw new Error(
			"cfgbin-db: text loading disabled (parser bug). Set IEVR_CFGBIN_DB_TEXT=1 to opt in."
		);
	}
	const db = getDb();
	if (!db) throw new Error("cfgbin-db: DB unavailable");
	const path = cfgbinDbTextPathFor(locale, filename);
	const row = loadStmt(db).get(path) as {
		json: string | null;
		error: string | null;
	} | null;
	if (!row) throw new Error(`cfgbin-db: row not found '${path}'`);
	if (row.json === null) {
		throw new Error(`cfgbin-db: parse failed '${path}': ${row.error ?? "?"}`);
	}
	return JSON.parse(row.json);
}

/**
 * Returns parsed JSON for an arbitrary internal_path. Useful for paths that
 * don't fit the (category, filename) shape (e.g., direct `data/common/...`).
 */
export function cfgbinDbLoadByPath(internalPath: string): unknown {
	const db = getDb();
	if (!db) throw new Error("cfgbin-db: DB unavailable");
	const row = loadStmt(db).get(internalPath) as {
		json: string | null;
		error: string | null;
	} | null;
	if (!row) throw new Error(`cfgbin-db: row not found '${internalPath}'`);
	if (row.json === null) {
		throw new Error(`cfgbin-db: parse failed '${internalPath}': ${row.error ?? "?"}`);
	}
	return JSON.parse(row.json);
}

/**
 * Lists all internal_path matching a SQL LIKE pattern. Useful to discover all
 * `chara_param_*.cfg.bin` for a category.
 */
export function cfgbinDbList(pathPattern: string): string[] {
	const db = getDb();
	if (!db) return [];
	const rows = listStmt(db).all(pathPattern) as { path: string }[];
	return rows.map((r) => r.path);
}

/**
 * Closes the DB. Pas obligatoire (le process exit close de toute facon),
 * mais utile pour les tests.
 */
export function cfgbinDbClose(): void {
	if (_db) {
		_db.close();
		_db = null;
		_findStmt = null;
		_loadStmt = null;
		_listStmt = null;
	}
}
