/**
 * Outils « pile self-host » — lecture LIVE de la base, du GraphQL et du stockage.
 *
 * Les outils `db_*` interrogent le miroir SQLite : rapide, hors-ligne, mais
 * limité aux 65 tables `inagle_*` du jeu et figé au dernier dump nocturne. Ces
 * outils-ci s'adressent à la pile qui a remplacé Supabase
 * (cf. docs/self-host-supabase.md) et donnent accès **en temps réel** aux 120
 * tables du schéma `public` — articles, équipes, quêtes, boutiques, tweets,
 * membres Discord — qui n'existent pas dans le miroir.
 *
 * Garde-fou central : toutes les requêtes portent la clé **anon**, jamais la
 * clé de service. L'agent hérite donc exactement des mêmes protections qu'un
 * visiteur du site — les 170 policies RLS, et la liste blanche de colonnes qui
 * ferme les données personnelles de `profiles`
 * (apps/website/sql/migrations/20260811_profiles_pii.sql). Un outil MCP ne peut
 * pas voir une donnée qu'un navigateur anonyme ne verrait pas.
 *
 * Seul GET est employé côté REST : PostgREST n'a aucun moyen d'écrire sur ce
 * verbe, la lecture seule est donc structurelle et non déclarative.
 */

import { z } from "zod";
import { structured, toolError } from "../protocol/types.ts";
import { defineTool, type RegisteredTool } from "../registry.ts";

/** Passerelle interne : nginx y monte /rest/v1, /graphql/v1 et /storage/v1. */
const BASE = process.env.RG_SUPABASE_URL ?? process.env.SUPABASE_INTERNAL_URL ?? "http://127.0.0.1:8811";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const TIMEOUT_MS = 15_000;
const MAX_ROWS = 200;

function headers(): Record<string, string> {
	return { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, Accept: "application/json" };
}

/** Message d'erreur exploitable : PostgREST répond en JSON structuré. */
async function readError(response: Response): Promise<string> {
	const body = await response.text();
	try {
		const parsed = JSON.parse(body) as { message?: string; hint?: string; code?: string };
		const hint = parsed.hint ? ` (${parsed.hint})` : "";
		return `${response.status} ${parsed.code ?? ""} ${parsed.message ?? body}${hint}`.trim();
	} catch {
		return `${response.status} ${body.slice(0, 300)}`;
	}
}

async function call(path: string, init?: RequestInit): Promise<Response> {
	return fetch(`${BASE}${path}`, {
		...init,
		headers: { ...headers(), ...(init?.headers as Record<string, string> | undefined) },
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
}

/** Cache de la spec OpenAPI : elle pèse ~650 Ko et ne change qu'au redémarrage. */
let specCache: { at: number; value: OpenApiSpec } | undefined;
const SPEC_TTL_MS = 300_000;

interface OpenApiSpec {
	paths?: Record<string, unknown>;
	definitions?: Record<string, { properties?: Record<string, { type?: string; format?: string; description?: string }> }>;
}

async function loadSpec(): Promise<OpenApiSpec> {
	const now = Date.now();
	if (specCache && now - specCache.at < SPEC_TTL_MS) return specCache.value;
	const response = await call("/rest/v1/");
	if (!response.ok) throw new Error(await readError(response));
	const value = (await response.json()) as OpenApiSpec;
	specCache = { at: now, value };
	return value;
}

export function supabaseTools(): RegisteredTool[] {
	return [
		defineTool({
			name: "live_tables",
			title: "Tables exposées en direct",
			description:
				"Liste les tables et vues que l'API REST expose en temps réel, avec leurs colonnes. Couvre tout le schéma `public` (articles, équipes, quêtes, boutiques, tweets, membres…), là où `db_tables` ne voit que les 65 tables de jeu du miroir SQLite. À consulter avant live_select.",
			inputSchema: z.object({
				like: z.string().optional().describe("Filtre sur le nom de table, ex. `article`."),
				withColumns: z.boolean().default(false).describe("Inclure la liste des colonnes de chaque table."),
			}),
			annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
			handler: async ({ like, withColumns }) => {
				let spec: OpenApiSpec;
				try {
					spec = await loadSpec();
				} catch (error) {
					return toolError(`Spec OpenAPI illisible : ${(error as Error).message}`);
				}
				const noms = Object.keys(spec.paths ?? {})
					.filter((p) => p.startsWith("/") && p.length > 1 && !p.startsWith("/rpc/"))
					.map((p) => p.slice(1))
					.filter((n) => !like || n.includes(like))
					.sort();
				const tables = noms.map((nom) => {
					if (!withColumns) return { name: nom };
					const props = spec.definitions?.[nom]?.properties ?? {};
					return {
						name: nom,
						columns: Object.entries(props).map(([col, meta]) => ({
							name: col,
							type: meta.format ?? meta.type ?? "?",
						})),
					};
				});
				const fonctions = Object.keys(spec.paths ?? {})
					.filter((p) => p.startsWith("/rpc/"))
					.map((p) => p.slice("/rpc/".length))
					.sort();
				return structured({ count: tables.length, tables, functions: fonctions });
			},
		}),

		defineTool({
			name: "live_select",
			title: "Lire une table en direct",
			description:
				"Lit une table via l'API REST, sur la base vivante et non sur le miroir. Les filtres suivent la syntaxe PostgREST : `status=eq.published`, `name=ilike.*mark*`, `order=created_at.desc`. Renvoie aussi le total exact. Lecture seule, avec les droits d'un visiteur anonyme : les policies RLS s'appliquent et les colonnes personnelles restent inaccessibles.",
			inputSchema: z.object({
				table: z.string().min(1).describe("Nom exact de la table, cf. live_tables."),
				select: z.string().default("*").describe("Colonnes, ex. `id,slug,title`. Les relations imbriquées PostgREST sont acceptées."),
				filters: z
					.string()
					.optional()
					.describe("Filtres PostgREST bruts, séparés par `&`. Ex. `status=eq.published&order=published_at.desc`."),
				limit: z.number().int().min(1).max(MAX_ROWS).default(25).describe(`Nombre de lignes (max ${MAX_ROWS}).`),
				offset: z.number().int().min(0).default(0).describe("Décalage pour la pagination."),
			}),
			annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
			handler: async ({ table, select, filters, limit, offset }) => {
				const params = new URLSearchParams();
				params.set("select", select);
				params.set("limit", String(limit));
				if (offset > 0) params.set("offset", String(offset));
				const suffixe = filters ? `&${filters}` : "";
				const response = await call(`/rest/v1/${encodeURIComponent(table)}?${params.toString()}${suffixe}`, {
					headers: { Prefer: "count=exact" },
				});
				if (!response.ok) return toolError(await readError(response));
				const rows = (await response.json()) as unknown[];
				// `content-range` porte le total exact : 0-24/1668.
				const total = response.headers.get("content-range")?.split("/")[1];
				return structured({ table, returned: rows.length, total: total ? Number(total) : undefined, rows });
			},
		}),

		defineTool({
			name: "live_graphql",
			title: "Requête GraphQL",
			description:
				"Exécute une requête GraphQL sur la base (pg_graphql). L'introspection est active : `{ __schema { queryType { fields { name } } } }` énumère tout ce qui est interrogeable. Pratique pour récupérer des relations imbriquées en un seul aller-retour, là où l'API REST demanderait plusieurs requêtes.",
			inputSchema: z.object({
				query: z.string().min(1).describe("Document GraphQL. Les collections sont nommées `<table>Collection`."),
				variables: z.record(z.string(), z.unknown()).optional().describe("Variables de la requête."),
			}),
			annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
			handler: async ({ query, variables }) => {
				const response = await call("/graphql/v1", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ query, variables: variables ?? {} }),
				});
				if (!response.ok) return toolError(await readError(response));
				const payload = (await response.json()) as { data?: unknown; errors?: unknown[] };
				if (payload.errors?.length) {
					return structured({ data: payload.data ?? null, errors: payload.errors });
				}
				return structured(payload.data ?? null);
			},
		}),

		defineTool({
			name: "live_storage",
			title: "Parcourir le stockage",
			description:
				"Liste les buckets de fichiers, ou le contenu d'un bucket, et renvoie les URL publiques. Les images de tweets, les visuels d'articles et les assets partagés vivent ici. Sans `bucket`, renvoie la liste des buckets.",
			inputSchema: z.object({
				bucket: z.string().optional().describe("Nom du bucket, ex. `tweets`. Omis : liste les buckets."),
				prefix: z.string().default("").describe("Préfixe de chemin, ex. `1913236736685060315/`."),
				limit: z.number().int().min(1).max(MAX_ROWS).default(50).describe(`Nombre d'objets (max ${MAX_ROWS}).`),
			}),
			annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
			handler: async ({ bucket, prefix, limit }) => {
				if (!bucket) {
					const response = await call("/storage/v1/bucket");
					if (!response.ok) return toolError(await readError(response));
					return structured({ buckets: await response.json() });
				}
				const response = await call(`/storage/v1/object/list/${encodeURIComponent(bucket)}`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ prefix, limit, sortBy: { column: "name", order: "asc" } }),
				});
				if (!response.ok) return toolError(await readError(response));
				const objets = (await response.json()) as Array<{ name: string; metadata?: { size?: number; mimetype?: string } }>;
				const publicBase = process.env.RG_SUPABASE_PUBLIC_URL ?? "https://supabase.rosegriffon.fr";
				return structured({
					bucket,
					count: objets.length,
					objects: objets.map((o) => ({
						name: o.name,
						size: o.metadata?.size,
						type: o.metadata?.mimetype,
						url: `${publicBase}/storage/v1/object/public/${bucket}/${o.name}`,
					})),
				});
			},
		}),
	];
}
