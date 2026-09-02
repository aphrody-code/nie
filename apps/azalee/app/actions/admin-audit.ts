"use server";

import { getServerSession, requireAdmin } from "@/lib/auth-helpers";
import { createClient } from "@/lib/supabase/server";

export interface AuditLogEntry {
	id: string;
	action: string;
	entity_type: string;
	entity_id: string;
	details: Record<string, unknown> | null;
	created_at: string;
	user: {
		id: string;
		username: string | null;
		full_name: string | null;
		avatar_url: string | null;
	} | null;
}

export interface GetAuditLogOptions {
	limit?: number;
	entityType?: string;
	userId?: string;
}

export interface ExportAuditLogOptions {
	from?: string;
	to?: string;
}

/**
 * Insère une entrée dans le journal d'audit.
 * Nécessite d'être authentifié.
 */
export async function logAuditAction(
	action: string,
	entityType: string,
	entityId: string,
	details?: Record<string, unknown>
): Promise<void> {
	const session = await getServerSession();
	if (!session?.user) {
		throw new Error("Non authentifié");
	}

	const supabase = await createClient();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const client = supabase as any;

	const { error } = await client.from("admin_audit_log").insert({
		action,
		created_at: new Date().toISOString(),
		details: details ?? null,
		entity_id: entityId,
		entity_type: entityType,
		user_id: session.user.id,
	});

	if (error) {
		console.error("logAuditAction error:", error);
		// On ne remonte pas l'erreur pour ne pas bloquer l'action principale
	}
}

/**
 * Retourne les entrées du journal d'audit (admin uniquement).
 * Peut être filtré par type d'entité ou par utilisateur.
 * La limite par défaut est 50.
 */
export async function getAuditLog(options: GetAuditLogOptions = {}): Promise<AuditLogEntry[]> {
	await requireAdmin();

	const { limit = 50, entityType, userId } = options;

	const supabase = await createClient();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const client = supabase as any;

	let query = client
		.from("admin_audit_log")
		.select(
			`id, action, entity_type, entity_id, details, created_at,
       profiles:user_id ( id, username, full_name, avatar_url )`
		)
		.order("created_at", { ascending: false })
		.limit(limit);

	if (entityType) {
		query = query.eq("entity_type", entityType);
	}

	if (userId) {
		query = query.eq("user_id", userId);
	}

	const { data, error } = await query;

	if (error) {
		console.error("getAuditLog error:", error);
		return [];
	}

	if (!data) {
		return [];
	}

	return (
		data as Array<{
			id: string;
			action: string;
			entity_type: string;
			entity_id: string;
			details: Record<string, unknown> | null;
			created_at: string;
			profiles: {
				id: string;
				username: string | null;
				full_name: string | null;
				avatar_url: string | null;
			} | null;
		}>
	).map((row) => ({
		action: row.action,
		created_at: row.created_at,
		details: row.details,
		entity_id: row.entity_id,
		entity_type: row.entity_type,
		id: row.id,
		user: row.profiles ?? null,
	}));
}

/**
 * Exporte les entrées du journal d'audit au format CSV (admin uniquement).
 * Peut être filtré par plage de dates (from/to au format ISO 8601).
 * Retourne une chaîne CSV prête à être téléchargée.
 */
export async function exportAuditLogCSV(options: ExportAuditLogOptions = {}): Promise<string> {
	await requireAdmin();

	const { from, to } = options;

	const supabase = await createClient();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const client = supabase as any;

	let query = client
		.from("admin_audit_log")
		.select(
			`id, action, entity_type, entity_id, details, created_at,
       profiles:user_id ( id, username, full_name, avatar_url )`
		)
		.order("created_at", { ascending: false });

	if (from) {
		query = query.gte("created_at", from);
	}

	if (to) {
		query = query.lte("created_at", to);
	}

	const { data, error } = await query;

	if (error) {
		console.error("exportAuditLogCSV error:", error);
		throw new Error("Impossible d'exporter le journal d'audit");
	}

	const rows =
		(data as Array<{
			id: string;
			action: string;
			entity_type: string;
			entity_id: string;
			details: Record<string, unknown> | null;
			created_at: string;
			profiles: {
				id: string;
				username: string | null;
				full_name: string | null;
				avatar_url: string | null;
			} | null;
		}>) || [];

	// En-têtes CSV
	const headers = [
		"id",
		"date",
		"action",
		"entity_type",
		"entity_id",
		"user_id",
		"username",
		"full_name",
		"details",
	];

	const escapeCSV = (value: string | null | undefined): string => {
		if (value === null || value === undefined) {
			return "";
		}
		const str = String(value);
		// Encadrer de guillemets si la valeur contient une virgule, un guillemet ou un saut de ligne
		if (str.includes(",") || str.includes('"') || str.includes("\n")) {
			return `"${str.replaceAll('"', '""')}"`;
		}
		return str;
	};

	const csvLines: string[] = [headers.join(",")];

	for (const row of rows) {
		const line = [
			escapeCSV(row.id),
			escapeCSV(row.created_at),
			escapeCSV(row.action),
			escapeCSV(row.entity_type),
			escapeCSV(row.entity_id),
			escapeCSV(row.profiles?.id ?? null),
			escapeCSV(row.profiles?.username ?? null),
			escapeCSV(row.profiles?.full_name ?? null),
			escapeCSV(row.details ? JSON.stringify(row.details) : null),
		].join(",");
		csvLines.push(line);
	}

	return csvLines.join("\n");
}
