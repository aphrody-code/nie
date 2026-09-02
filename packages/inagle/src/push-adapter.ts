/**
 * @file push-adapter.ts
 * @description Couche d'accès données partagée pour le flux de push Inagle →
 * Supabase. Extraite de cli-push.ts pour que les pushers de catégories
 * (scripts/push-*.ts) puissent réutiliser le MÊME adaptateur (Supabase API ou
 * Direct DB) sans dupliquer le câblage, et sans import circulaire avec
 * cli-push.ts (qui importe ces pushers).
 *
 * Tout upsert est idempotent (ON CONFLICT). Aucune valeur fabriquée ici : ce
 * module ne fait QUE persister des lignes déjà construites depuis le dump réel.
 */

import { createClient } from "@supabase/supabase-js";
import jwt from "jsonwebtoken";
import pg from "pg";

// === Interface ===

export interface DataAdapter {
	upsert(table: string, records: any[], onConflict?: string): Promise<{ error: any }>;
	insert(table: string, records: any[]): Promise<{ error: any }>;
	deleteAllExcept(table: string, column: string, value: any): Promise<{ error: any }>;
	// Lit toutes les lignes (colonnes choisies) — sert à préserver les colonnes
	// curatées hors-pipeline (sheet_data, zukan_order) à travers un delete+reinsert.
	fetchAll(table: string, columns: string): Promise<any[]>;
	close(): Promise<void>;
}

// === Helpers communs ===

export function dedup(records: any[], key = "id") {
	const map = new Map();
	for (const r of records) {
		const k = r[key] || r.id;
		if (k) map.set(k, r);
	}
	return Array.from(map.values());
}

const isValidKey = (val: string | undefined | null): val is string =>
	typeof val === "string" &&
	val.length > 0 &&
	!val.startsWith("eyJ2Ijo") &&
	val !== "undefined" &&
	val !== "null";

const isValidUrl = (val: string | undefined | null): val is string =>
	typeof val === "string" && val.length > 0 && val.startsWith("http") && !val.startsWith("eyJ2Ijo");

// === Adapters ===

export class SupabaseAdapter implements DataAdapter {
	constructor(private client: any) {}
	async upsert(table: string, records: any[], onConflict = "id") {
		if (records.length === 0) return { error: null };
		return this.client.from(table).upsert(records, { onConflict });
	}
	async insert(table: string, records: any[]) {
		if (records.length === 0) return { error: null };
		return this.client.from(table).insert(records);
	}
	async deleteAllExcept(table: string, column: string, value: any) {
		return this.client.from(table).delete().neq(column, value);
	}
	async fetchAll(table: string, columns: string) {
		const out: any[] = [];
		for (let from = 0; ; from += 1000) {
			const { data, error } = await this.client
				.from(table)
				.select(columns)
				.range(from, from + 999);
			if (error || !data || data.length === 0) break;
			out.push(...data);
			if (data.length < 1000) break;
		}
		return out;
	}
	async close() {}
}

export class PostgresAdapter implements DataAdapter {
	private pool: pg.Pool;
	constructor(connectionString: string) {
		this.pool = new pg.Pool({ connectionString });
	}

	async upsert(table: string, records: any[], onConflict = "id") {
		if (records.length === 0) return { error: null };

		// Chunking for Postgres max params (65535)
		// Let's safe limit to 50 rows per insert if many columns
		const CHUNK_SIZE = 50;
		for (let i = 0; i < records.length; i += CHUNK_SIZE) {
			const chunk = records.slice(i, i + CHUNK_SIZE);
			const err = await this._upsertBatch(table, chunk, onConflict);
			if (err) return { error: err };
		}
		return { error: null };
	}

	private async _upsertBatch(table: string, records: any[], onConflict: string) {
		const keys = Object.keys(records[0]);
		let paramIndex = 1;
		const values: any[] = [];
		const rows: string[] = [];

		for (const r of records) {
			const rowParams: string[] = [];
			for (const k of keys) {
				rowParams.push(`$${paramIndex++}`);
				let val = r[k];
				if (typeof val === "object" && val !== null) val = JSON.stringify(val);
				values.push(val);
			}
			rows.push(`(${rowParams.join(", ")})`);
		}

		const updateSet = keys.map((k) => `"${k}" = EXCLUDED."${k}"`).join(", ");

		const conflictCols = onConflict
			.split(",")
			.map((c) => `"${c.trim()}"`)
			.join(", ");
		const query = `
            INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(", ")})
            VALUES ${rows.join(", ")}
            ON CONFLICT (${conflictCols}) DO UPDATE SET ${updateSet}
        `;

		try {
			await this.pool.query(query, values);
			return null;
		} catch (e: any) {
			console.error(`[PostgresAdapter] Error in upsert: ${e.message}`, e);
			return e;
		}
	}

	async insert(table: string, records: any[]) {
		// Simple insert without conflict handling (or could fail)
		// For treasures, we deleted before, so simple insert is fine.
		return this.upsert(table, records, "id"); // treasures has id
	}

	async deleteAllExcept(table: string, column: string, value: any) {
		try {
			await this.pool.query(`DELETE FROM "${table}" WHERE "${column}" != $1`, [value]);
			return { error: null };
		} catch (e: any) {
			return { error: e };
		}
	}

	async fetchAll(table: string, columns: string) {
		try {
			const cols = columns
				.split(",")
				.map((c) => `"${c.trim()}"`)
				.join(", ");
			const res = await this.pool.query(`SELECT ${cols} FROM "${table}"`);
			return res.rows;
		} catch {
			return [];
		}
	}

	async close() {
		await this.pool.end();
	}
}

// === Fabrique de client Supabase (motif partagé cli-push / pushers) ===

/**
 * Construit un client Supabase service-role à partir de l'environnement, selon
 * le même motif que cli-push.ts : URL + service-role key directe, sinon un token
 * service_role signé à partir de SUPABASE_JWT_SECRET / JWT_SECRET. Garde-fou sur
 * les blobs scellés `eyJ2Ijo…`. .env est chargé par Bun (cwd /home/ubuntu/rg).
 */
export function resolveSupabaseClient() {
	// Repli sur la passerelle interne de la pile self-host. Ce paquet tourne côté
	// Bun/Node sans lib DOM : on interroge `globalThis` plutôt que `window`.
	const origineDefaut =
		"location" in globalThis
			? (globalThis as unknown as { location: { origin: string } }).location.origin
			: "http://127.0.0.1:8811";
	let url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || origineDefaut;
	if (!isValidUrl(url)) url = origineDefaut;

	let key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	const jwtSecret = process.env.JWT_SECRET || process.env.SUPABASE_JWT_SECRET;

	if (!isValidKey(key)) {
		if (isValidKey(jwtSecret)) {
			key = jwt.sign(
				{
					role: "service_role",
					iss: "supabase",
					iat: Math.floor(Date.now() / 1000),
					exp: Math.floor(Date.now() / 1000) + 3600,
				},
				jwtSecret
			);
		} else {
			throw new Error(
				"Aucune clé Supabase exploitable (SUPABASE_SERVICE_ROLE_KEY ou SUPABASE_JWT_SECRET requis dans .env)."
			);
		}
	}

	return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Adaptateur Supabase ou Postgres direct prêt à l'emploi, basé sur l'environnement.
 * Pratique pour les pushers exécutés en standalone (scripts/push-*.ts) qui veulent
 * le même adaptateur que le flux principal sans réimplémenter la résolution des creds.
 */
export function createSupabaseAdapter(): DataAdapter {
	if (process.env.DATABASE_URL) {
		console.log("🔌 Using direct PostgreSQL Adapter (DATABASE_URL provided)");
		return new PostgresAdapter(process.env.DATABASE_URL);
	}
	return new SupabaseAdapter(resolveSupabaseClient());
}

