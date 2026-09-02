/**
 * Inspection de la pile Supabase auto-hébergée.
 *
 * Ce module porte les requêtes de gestion — tables, extensions, migrations,
 * audit de sécurité, stockage — pour qu'elles soient identiques partout. Elles
 * vivaient jusqu'ici uniquement dans `packages/mcp/src/tools/supabase-platform.ts` :
 * l'agent voyait donc des informations que le tableau de bord d'administration
 * n'offrait pas, et les recoder côté site aurait fait diverger les deux.
 *
 * Le module ne choisit PAS son pilote : il reçoit une fonction `query`. Le
 * serveur MCP l'adosse à `Bun.SQL`, le site à son pool `pg`. C'est aussi ce qui
 * évite d'ajouter une dépendance de base à `@rosegriffon/db`, consommé par le
 * bot et les tâches planifiées.
 */

/** Exécute une requête paramétrée (`$1`, `$2`…) et renvoie les lignes. */
export type SqlQuery = <T = Record<string, unknown>>(
	text: string,
	params?: unknown[]
) => Promise<T[]>;

// ─────────────────────────────── tables ───────────────────────────────

export interface PlatformTable {
	schema: string;
	name: string;
	rows: number;
	size: string;
	rlsEnabled: boolean;
	policies: number;
}

/**
 * Tables d'un schéma avec leur volumétrie et leur état RLS.
 *
 * `n_live_tup` est une estimation issue des statistiques du planificateur : pas
 * un `count(*)`, mais la seule mesure qui reste instantanée sur les tables à
 * plusieurs millions de lignes.
 */
export async function listTables(query: SqlQuery, schema = "public"): Promise<PlatformTable[]> {
	return query<PlatformTable>(
		`select n.nspname                                        as schema,
		        c.relname                                        as name,
		        coalesce(s.n_live_tup, 0)::int                    as rows,
		        pg_size_pretty(pg_total_relation_size(c.oid))     as size,
		        c.relrowsecurity                                  as "rlsEnabled",
		        (select count(*)::int from pg_policies p
		          where p.schemaname = n.nspname and p.tablename = c.relname) as policies
		   from pg_class c
		   join pg_namespace n on n.oid = c.relnamespace
		   left join pg_stat_user_tables s on s.relid = c.oid
		  where n.nspname = $1 and c.relkind = 'r'
		  order by coalesce(s.n_live_tup, 0) desc, c.relname`,
		[schema]
	);
}

// ───────────────────────────── extensions ─────────────────────────────

export interface PlatformExtension {
	name: string;
	version: string;
	schema: string | null;
}

export async function listExtensions(query: SqlQuery): Promise<PlatformExtension[]> {
	return query<PlatformExtension>(
		`select e.extname as name, e.extversion as version, n.nspname as schema
		   from pg_extension e
		   left join pg_namespace n on n.oid = e.extnamespace
		  order by e.extname`
	);
}

// ───────────────────────────── migrations ─────────────────────────────

export interface PlatformMigration {
	version: string;
	name: string | null;
	appliedAt: string | null;
}

/**
 * Migrations appliquées.
 *
 * La table n'existe que si des migrations ont déjà été jouées par l'outillage :
 * son absence n'est pas une erreur, on renvoie une liste vide.
 */
export async function listMigrations(query: SqlQuery): Promise<PlatformMigration[]> {
	const exists = await query<{ present: boolean }>(
		`select exists (
		   select 1 from information_schema.tables
		    where table_schema = 'supabase_migrations' and table_name = 'schema_migrations'
		 ) as present`
	);
	if (!exists[0]?.present) {
		return [];
	}
	return query<PlatformMigration>(
		`select version, name, null::text as "appliedAt"
		   from supabase_migrations.schema_migrations
		  order by version desc`
	);
}

// ─────────────────────────────── audit ────────────────────────────────

export type AdvisorLevel = "error" | "warning" | "info";

export interface AdvisorFinding {
	level: AdvisorLevel;
	category: string;
	object: string;
	detail: string;
}

export interface AdvisorReport {
	total: number;
	byLevel: Record<AdvisorLevel, number>;
	findings: AdvisorFinding[];
}

/**
 * Contrôles de sécurité et de performance.
 *
 * Le croisement droits × RLS est essentiel : une colonne accordée à `anon` mais
 * verrouillée par la RLS n'est pas une fuite. Sans ce croisement, dix-sept faux
 * positifs noient la seule ligne qui compte — c'est ce contrôle qui a révélé le
 * 11/8/2026 que les e-mails de tous les comptes étaient publics.
 */
export async function getAdvisors(
	query: SqlQuery,
	type: "security" | "performance" | "all" = "all"
): Promise<AdvisorReport> {
	const findings: AdvisorFinding[] = [];

	if (type !== "performance") {
		const pii = await query<{
			table_name: string;
			column_name: string;
			rls: boolean;
			policy_ouverte: boolean | null;
		}>(
			`select cp.table_name, cp.column_name,
			        c.relrowsecurity as rls,
			        (select bool_or(coalesce(p.qual, 'true') in ('true', 'True'))
			           from pg_policies p
			          where p.schemaname = 'public' and p.tablename = cp.table_name
			            and p.cmd in ('SELECT', 'ALL') and p.permissive = 'PERMISSIVE'
			            and (p.roles::text[] @> array['anon'] or p.roles::text[] @> array['public'])
			        ) as policy_ouverte
			   from information_schema.column_privileges cp
			   join pg_class c on c.relname = cp.table_name
			   join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
			  where cp.grantee = 'anon' and cp.privilege_type = 'SELECT' and cp.table_schema = 'public'
			    and cp.column_name ~* '(email|phone|address|postal|birth|iban|ssn|passport|full_name|ip_address)'
			  order by 1, 2`
		);
		for (const r of pii) {
			const atteignable = !r.rls || r.policy_ouverte === true;
			findings.push({
				category: atteignable ? "pii_exposee" : "pii_grantee_mais_rls_bloque",
				detail: atteignable
					? "Colonne personnelle réellement lisible par tout visiteur : ni RLS, ni prédicat restrictif."
					: "Droit accordé à `anon` mais la RLS bloque la table. À révoquer par principe, sans urgence.",
				level: atteignable ? "error" : "info",
				object: `public.${r.table_name}.${r.column_name}`,
			});
		}

		const sansPolicy = await query<{ name: string }>(
			`select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
			  where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
			    and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)
			  order by 1`
		);
		for (const r of sansPolicy) {
			findings.push({
				category: "rls_sans_policy",
				detail:
					"RLS activée sans aucune policy : la table est inaccessible sauf au propriétaire et au service_role.",
				level: "warning",
				object: `public.${r.name}`,
			});
		}

		const sansRls = await query<{ name: string }>(
			`select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
			  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
			    and has_table_privilege('anon', c.oid, 'SELECT')
			  order by 1`
		);
		for (const r of sansRls) {
			findings.push({
				category: "table_sans_rls",
				detail: "Lisible par `anon` sans RLS : toutes les lignes sont publiques.",
				level: "warning",
				object: `public.${r.name}`,
			});
		}

		const definer = await query<{ name: string }>(
			`select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
			  where n.nspname = 'public' and p.prosecdef
			    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
			  order by 1`
		);
		for (const r of definer) {
			findings.push({
				category: "search_path_mutable",
				detail:
					"Fonction `security definer` sans `search_path` figé : vecteur d'escalade de privilèges.",
				level: "warning",
				object: `public.${r.name}()`,
			});
		}
	}

	if (type !== "security") {
		const fkSansIndex = await query<{ table_name: string; constraint_name: string }>(
			`select c.conrelid::regclass::text as table_name, c.conname as constraint_name
			   from pg_constraint c
			  where c.contype = 'f' and c.connamespace = 'public'::regnamespace
			    and not exists (
			        select 1 from pg_index i
			         where i.indrelid = c.conrelid
			           and (i.indkey::smallint[])[0:array_length(c.conkey, 1) - 1] @> c.conkey)
			  order by 1`
		);
		for (const r of fkSansIndex) {
			findings.push({
				category: "fk_sans_index",
				detail: `Clé étrangère \`${r.constraint_name}\` sans index de couverture.`,
				level: "info",
				object: r.table_name,
			});
		}
	}

	const byLevel: Record<AdvisorLevel, number> = { error: 0, info: 0, warning: 0 };
	for (const f of findings) {
		byLevel[f.level] += 1;
	}
	return { byLevel, findings, total: findings.length };
}

// ─────────────────────────────── storage ──────────────────────────────

export interface PlatformBucket {
	name: string;
	public: boolean;
	objects: number;
	bytes: number;
}

export async function listStorageBuckets(query: SqlQuery): Promise<PlatformBucket[]> {
	const exists = await query<{ present: boolean }>(
		`select exists (
		   select 1 from information_schema.tables
		    where table_schema = 'storage' and table_name = 'buckets'
		 ) as present`
	);
	if (!exists[0]?.present) {
		return [];
	}
	return query<PlatformBucket>(
		`select b.name,
		        coalesce(b.public, false)                                     as public,
		        (select count(*)::int from storage.objects o
		          where o.bucket_id = b.id)                                   as objects,
		        coalesce((select sum((o.metadata->>'size')::bigint) from storage.objects o
		          where o.bucket_id = b.id), 0)::bigint                       as bytes
		   from storage.buckets b
		  order by b.name`
	);
}

// ──────────────────────────── santé de la pile ────────────────────────

export interface PlatformDatabaseInfo {
	version: string;
	database: string;
	sizePretty: string;
	connections: number;
	maxConnections: number;
}

export async function getDatabaseInfo(query: SqlQuery): Promise<PlatformDatabaseInfo> {
	const rows = await query<PlatformDatabaseInfo>(
		`select current_setting('server_version')                              as version,
		        current_database()                                             as database,
		        pg_size_pretty(pg_database_size(current_database()))           as "sizePretty",
		        (select count(*)::int from pg_stat_activity)                   as connections,
		        current_setting('max_connections')::int                        as "maxConnections"`
	);
	return (
		rows[0] ?? {
			connections: 0,
			database: "?",
			maxConnections: 0,
			sizePretty: "?",
			version: "?",
		}
	);
}

/** Formate un nombre d'octets pour l'affichage (Ko/Mo/Go, unités françaises). */
export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) {
		return "0 o";
	}
	const units = ["o", "Ko", "Mo", "Go", "To"];
	const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
	const value = bytes / 1024 ** i;
	return `${value.toFixed(i === 0 ? 0 : 1).replace(".", ",")} ${units[i]}`;
}
