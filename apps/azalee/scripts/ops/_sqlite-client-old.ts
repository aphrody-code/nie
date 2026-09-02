import type { Database } from "bun:sqlite";
import { readdirSync } from "node:fs";
import path from "node:path";

function getSqlitePath(): string | null {
	if (process.env.SQLITE_DB_PATH) {
		return path.resolve(process.env.SQLITE_DB_PATH);
	}

	// Potential backup directories
	const dirs = [
		path.resolve(process.cwd(), "data/backups"),
		path.resolve(process.cwd(), "apps/azalee/data/backups"),
		"/home/ubuntu/rg/apps/azalee/data/backups",
	];

	for (const dir of dirs) {
		try {
			const files = readdirSync(dir);
			// Filter for supabase-*.sqlite files and sort descending (latest first)
			const sqliteFiles = files
				.filter((f) => f.startsWith("supabase-") && f.endsWith(".sqlite"))
				.sort((a, b) => b.localeCompare(a));

			if (sqliteFiles.length > 0) {
				return path.join(dir, sqliteFiles[0]);
			}
		} catch {
			// ignore directory read errors
		}
	}
	return null;
}

// Surface minimale commune entre `bun:sqlite` (runtime Bun) et `node:sqlite`
// (Node >= 22 — `DatabaseSync`). `SqliteQueryBuilder` n'utilise que `prepare`/
// `exec`, et sur le statement `all`/`get`. Les deux moteurs exposent la même
// forme, on les unifie derrière ce type pour pouvoir builder sous Node.
type SqliteLike = {
	prepare(sql: string): {
		all(...params: unknown[]): unknown[];
		get(...params: unknown[]): unknown;
	};
	exec(sql: string): void;
};

let _sqliteDb: SqliteLike | null = null;
function getSqliteDb(): Database {
	if (_sqliteDb) return _sqliteDb as unknown as Database;
	const dbPath = getSqlitePath();
	if (!dbPath) {
		throw new Error("No SQLite database backup found");
	}

	if (typeof Bun !== "undefined") {
		// Runtime Bun (prod `azalee-web.service`) → bun:sqlite natif.
		// eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy load bun:sqlite sous garde Bun
		const { Database: DBConstructor } = require("bun:sqlite");
		const db = new DBConstructor(dbPath, { readonly: true }) as SqliteLike;
		db.exec("PRAGMA journal_mode = WAL");
		db.exec("PRAGMA temp_store = MEMORY");
		_sqliteDb = db;
		return _sqliteDb as unknown as Database;
	}

	// Runtime Node (>= 22) → node:sqlite (`DatabaseSync`). Indispensable pour
	// `next build` sous /usr/bin/node : Bun déclenche un bug de prerender du
	// /_global-error (dispatcher React null), donc le build de prod tourne sous
	// Node. Sans ce fallback, getSqliteDb retombait sur Postgres → timeouts >60s
	// sur les milliers de fiches perso et build avorté.
	// `process.getBuiltinModule` : résolution 100% runtime du builtin, invisible
	// à l'analyse statique de Turbopack (un `require("node:sqlite")` littéral
	// échoue: "Unsupported external type Url for commonjs reference").
	const nodeSqlite = (
		process as unknown as {
			getBuiltinModule?: (id: string) => { DatabaseSync: new (p: string, o?: unknown) => SqliteLike };
		}
	).getBuiltinModule?.("node:sqlite");
	if (!nodeSqlite) {
		throw new Error("[SQLite Client] node:sqlite indisponible (Node < 22)");
	}
	const db = new nodeSqlite.DatabaseSync(dbPath, { readOnly: true });
	db.exec("PRAGMA temp_store = MEMORY");
	_sqliteDb = db;
	return _sqliteDb as unknown as Database;
}

export class SqliteQueryBuilder {
	private db: Database;
	private table: string;
	private selects: string = "*";
	private wheres: string[] = [];
	private params: Array<string | number | boolean | null> = [];
	private limitValue: number | null = null;
	private offsetValue: number | null = null;
	private orders: string[] = [];
	private isSingle: boolean = false;
	private isMaybeSingle: boolean = false;
	private countOption: string | null = null;

	private needsGrouping: boolean = false;

	constructor(db: Database, table: string) {
		this.db = db;
		if (table.endsWith("_clean")) {
			this.table = table.replace("_clean", "");
			this.needsGrouping = true;
		} else {
			this.table = table;
		}
	}

	select(fields: string = "*", options?: { count?: string }) {
		this.selects = fields;
		if (options?.count) {
			this.countOption = options.count;
		}
		return this;
	}

	private cleanCol(col: string): string {
		if (col.includes("->>")) {
			const [left, right] = col.split("->>");
			return `json_extract(${left}, '$.${right}')`;
		}
		return `"${col}"`;
	}

	eq(col: string, val: string | number | boolean | null) {
		const column = this.cleanCol(col);
		if (val === null) {
			this.wheres.push(`${column} IS NULL`);
		} else {
			this.wheres.push(`${column} = ?`);
			this.params.push(typeof val === "boolean" ? (val ? 1 : 0) : val);
		}
		return this;
	}

	neq(col: string, val: string | number | boolean | null) {
		const column = this.cleanCol(col);
		if (val === null) {
			this.wheres.push(`${column} IS NOT NULL`);
		} else {
			this.wheres.push(`${column} != ?`);
			this.params.push(typeof val === "boolean" ? (val ? 1 : 0) : val);
		}
		return this;
	}

	not(col: string, op: string, val: string | number | boolean | null) {
		const column = this.cleanCol(col);
		if (op === "is" && val === null) {
			this.wheres.push(`${column} IS NOT NULL`);
		} else if (op === "like" || op === "ilike") {
			this.wheres.push(`${column} NOT LIKE ?`);
			this.params.push(val);
		} else {
			this.wheres.push(`${column} != ?`);
			this.params.push(typeof val === "boolean" ? (val ? 1 : 0) : val);
		}
		return this;
	}

	ilike(col: string, pattern: string) {
		const column = this.cleanCol(col);
		this.wheres.push(`${column} LIKE ?`);
		this.params.push(pattern);
		return this;
	}

	gte(col: string, val: string | number | boolean | null) {
		const column = this.cleanCol(col);
		this.wheres.push(`${column} >= ?`);
		this.params.push(typeof val === "boolean" ? (val ? 1 : 0) : val);
		return this;
	}

	lte(col: string, val: string | number | boolean | null) {
		const column = this.cleanCol(col);
		this.wheres.push(`${column} <= ?`);
		this.params.push(typeof val === "boolean" ? (val ? 1 : 0) : val);
		return this;
	}

	in(col: string, arr: Array<string | number | boolean | null>) {
		if (!arr || arr.length === 0) {
			this.wheres.push("1 = 0");
			return this;
		}
		const column = this.cleanCol(col);
		const placeholders = arr.map(() => "?").join(", ");
		this.wheres.push(`${column} IN (${placeholders})`);
		this.params.push(...arr.map((val) => (typeof val === "boolean" ? (val ? 1 : 0) : val)));
		return this;
	}

	/**
	 * Découpe une liste PostgREST `.or()` sur les virgules de NIVEAU SUPÉRIEUR
	 * uniquement — les virgules à l'intérieur d'un littéral `[...]`/`{...}` (valeur
	 * JSON pour l'opérateur `cs`) sont préservées. Indispensable pour ne PAS couper
	 * une valeur multi-mots (ex. `name_fr.eq.Tornade de Feu`) : l'ancien regex
	 * s'arrêtait au 1er espace et tronquait silencieusement la valeur.
	 */
	private splitTopLevel(s: string): string[] {
		const out: string[] = [];
		let depth = 0;
		let cur = "";
		for (const ch of s) {
			if (ch === "[" || ch === "{") {
				depth++;
			} else if (ch === "]" || ch === "}") {
				depth = Math.max(0, depth - 1);
			}
			if (ch === "," && depth === 0) {
				out.push(cur);
				cur = "";
			} else {
				cur += ch;
			}
		}
		if (cur) {
			out.push(cur);
		}
		return out;
	}

	or(orString: string) {
		const conditions: string[] = [];
		const orParams: Array<string | number | boolean | null> = [];

		// Parse chaque condition `colonne.opérateur.valeur` séparément. La colonne
		// (qui peut contenir `->>`) n'a jamais de `.` littéral en PostgREST, donc on
		// coupe au 1er `.`. La valeur est TOUT le reste après l'opérateur (espaces
		// inclus) — corrige la troncature multi-mots de l'ancien parser regex.
		for (const rawToken of this.splitTopLevel(orString)) {
			const token = rawToken.trim();
			if (!token) {
				continue;
			}

			const firstDot = token.indexOf(".");
			if (firstDot === -1) {
				continue;
			}
			const col = token.slice(0, firstDot);
			const rest = token.slice(firstDot + 1);
			const column = this.cleanCol(col);

			// Null checks (PostgREST: `col.is.null` / `col.not.is.null`) — sans param.
			if (rest === "is.null") {
				conditions.push(`${column} IS NULL`);
				continue;
			}
			if (rest === "not.is.null") {
				conditions.push(`${column} IS NOT NULL`);
				continue;
			}

			const opDot = rest.indexOf(".");
			if (opDot === -1) {
				continue;
			}
			const op = rest.slice(0, opDot);
			const val = rest.slice(opDot + 1);
			// Valeur vide (`id.eq.`) → on saute la condition plutôt que de générer un
			// filtre qui matche tout (qui ferait remonter la 1re ligne en maybeSingle).
			if (val === "") {
				continue;
			}

			switch (op) {
				case "ilike": {
					let cleanVal = val;
					if (cleanVal.startsWith("%")) cleanVal = cleanVal.slice(1);
					if (cleanVal.endsWith("%")) cleanVal = cleanVal.slice(0, -1);
					conditions.push(`${column} LIKE ?`);
					orParams.push(`%${cleanVal}%`);
					break;
				}
				case "like":
					// PostgREST `like` : `%`/`*` = joker. On normalise `*` → `%`.
					conditions.push(`${column} LIKE ?`);
					orParams.push(val.replaceAll("*", "%"));
					break;
				case "eq":
					conditions.push(`${column} = ?`);
					orParams.push(val === "true" ? 1 : val === "false" ? 0 : val);
					break;
				case "neq":
					conditions.push(`${column} != ?`);
					orParams.push(val);
					break;
				case "gt":
					conditions.push(`${column} > ?`);
					orParams.push(val);
					break;
				case "gte":
					conditions.push(`${column} >= ?`);
					orParams.push(val);
					break;
				case "lt":
					conditions.push(`${column} < ?`);
					orParams.push(val);
					break;
				case "lte":
					conditions.push(`${column} <= ?`);
					orParams.push(val);
					break;
				case "cs":
					try {
						const parsed = JSON.parse(val);
						if (Array.isArray(parsed) && parsed[0]?.id) {
							conditions.push(
								`EXISTS (SELECT 1 FROM json_each(${column}) WHERE json_each.value->>'id' = ?)`
							);
							orParams.push(parsed[0].id);
						}
					} catch {
						// fallback if JSON parsing fails
					}
					break;
				default:
					break;
			}
		}

		if (conditions.length > 0) {
			this.wheres.push(`(${conditions.join(" OR ")})`);
			this.params.push(...orParams);
		} else {
			// Aucune condition valide (`.or()` malformé / valeurs vides) → matcher
			// RIEN. Sinon l'absence de WHERE ferait remonter toute la table, et un
			// .maybeSingle() renverrait silencieusement la 1re ligne (mauvaise entité
			// au lieu d'un 404).
			this.wheres.push("1 = 0");
		}

		return this;
	}

	limit(n: number) {
		this.limitValue = n;
		return this;
	}

	order(col: string, options?: { ascending?: boolean; nullsFirst?: boolean }) {
		const column = this.cleanCol(col);
		const dir = options?.ascending === false ? "DESC" : "ASC";
		// SQLite trie les NULL EN PREMIER par défaut (ASC) — l'inverse de PostgREST
		// quand `nullsFirst:false`. On émet NULLS FIRST/LAST explicitement (SQLite
		// >= 3.30) pour matcher la sémantique supabase-js, sinon les lignes à
		// valeur NULL (ex. zukan_order) remontent en tête et cassent l'ordre.
		let nulls = "";
		if (options?.nullsFirst === true) nulls = " NULLS FIRST";
		else if (options?.nullsFirst === false) nulls = " NULLS LAST";
		this.orders.push(`${column} ${dir}${nulls}`);
		return this;
	}

	range(from: number, to: number) {
		this.limitValue = to - from + 1;
		this.offsetValue = from;
		return this;
	}

	single() {
		this.isSingle = true;
		return this;
	}

	maybeSingle() {
		this.isMaybeSingle = true;
		return this;
	}

	// Make the class then-able (Promise-like)
	async then<TResult1 = unknown>(
		onfulfilled?:
			| ((value: {
					data: Record<string, unknown> | Array<Record<string, unknown>> | null;
					error: Error | null;
					count: number | null;
			  }) => TResult1 | PromiseLike<TResult1>)
			| undefined
			| null
	) {
		try {
			const data = await this.execute();
			const count = this.countOption ? await this.executeCount() : null;

			const response = {
				data,
				error: null as Error | null,
				count,
			};

			if (onfulfilled) {
				return onfulfilled(response);
			}
			return response;
		} catch (err) {
			const response = {
				data: null,
				error: err instanceof Error ? err : new Error(String(err)),
				count: null,
			};
			if (onfulfilled) {
				return onfulfilled(response);
			}
			return response;
		}
	}

	private compileSelect(): string {
		let sql = `SELECT ${this.selects} FROM "${this.table}"`;
		if (this.wheres.length > 0) {
			sql += ` WHERE ${this.wheres.join(" AND ")}`;
		}
		if (this.needsGrouping) {
			sql += ' GROUP BY "name_fr"';
		}
		if (this.orders.length > 0) {
			sql += ` ORDER BY ${this.orders.join(", ")}`;
		}
		if (this.limitValue !== null) {
			sql += ` LIMIT ${this.limitValue}`;
		}
		if (this.offsetValue !== null) {
			sql += ` OFFSET ${this.offsetValue}`;
		}
		return sql;
	}

	private async execute(): Promise<
		Record<string, unknown> | Array<Record<string, unknown>> | null
	> {
		const sql = this.compileSelect();
		const stmt = this.db.prepare(sql);
		const rawRows = stmt.all(...this.params) as Array<Record<string, unknown>>;

		const parsedRows = rawRows.map((r) => this.parseRow(r));

		if (this.isSingle) {
			if (parsedRows.length === 0) {
				throw new Error("No rows found");
			}
			return parsedRows[0];
		}

		if (this.isMaybeSingle) {
			return parsedRows.length > 0 ? parsedRows[0] : null;
		}

		return parsedRows;
	}

	private async executeCount(): Promise<number> {
		let sql = this.needsGrouping
			? `SELECT COUNT(DISTINCT "name_fr") as count FROM "${this.table}"`
			: `SELECT COUNT(*) as count FROM "${this.table}"`;
		if (this.wheres.length > 0) {
			sql += ` WHERE ${this.wheres.join(" AND ")}`;
		}
		const stmt = this.db.prepare(sql);
		const result = stmt.get(...this.params) as { count: number };
		return result?.count ?? 0;
	}

	private parseRow(row: Record<string, unknown>): Record<string, unknown> {
		const parsed: Record<string, unknown> = {};
		for (const [key, val] of Object.entries(row)) {
			if (typeof val === "string" && (val.startsWith("{") || val.startsWith("["))) {
				try {
					parsed[key] = JSON.parse(val);
				} catch {
					parsed[key] = val;
				}
			} else {
				parsed[key] = val;
			}
		}
		return parsed;
	}
}

export function createSqliteClient() {
	return {
		from(table: string) {
			const db = getSqliteDb();
			return new SqliteQueryBuilder(db, table);
		},
	};
}
