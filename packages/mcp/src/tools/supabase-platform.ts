/**
 * Parité avec le serveur MCP officiel `@supabase/mcp-server-supabase`.
 *
 * Ces outils portent **les noms officiels** pour qu'un agent habitué au serveur
 * de Supabase fonctionne ici sans réapprentissage, mais ils s'adressent à notre
 * pile auto-hébergée (cf. docs/self-host-supabase.md).
 *
 * Familles couvertes : `database`, `debugging`, `development`, `storage`,
 * `docs`. Les familles `branching`, `functions` (Edge Functions Deno) et la
 * gestion de projet/facturation de `account` n'ont pas d'équivalent hors
 * Supabase Cloud — elles sont documentées comme absentes plutôt que simulées
 * par des outils vides, qui ne feraient que dégrader le choix d'outil.
 *
 * Garde-fou majeur : `execute_sql` en portée `read` s'exécute **en rôle
 * `anon`**, dans une transaction annulée à la fin. L'agent voit donc exactement
 * ce qu'un visiteur anonyme verrait — les policies RLS s'appliquent et les
 * colonnes personnelles de `profiles` restent fermées. Sans cela, l'outil
 * contournerait par le bas les protections posées côté REST.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { SQL } from "bun";
import { z } from "zod";
import { structured, toolError } from "../protocol/types.ts";
import { defineTool, type RegisteredTool } from "../registry.ts";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const PG_META = process.env.RG_PG_META_URL ?? "http://127.0.0.1:8813";
const PUBLIC_URL = process.env.RG_SUPABASE_PUBLIC_URL ?? "https://supabase.rosegriffon.fr";
const MIGRATIONS_DIR = "apps/website/sql/migrations";

let pool: SQL | undefined;
function db(): SQL {
	if (!DATABASE_URL) throw new Error("DATABASE_URL absent : la lecture Postgres directe est indisponible.");
	pool ??= new SQL(DATABASE_URL, { max: 4 });
	return pool;
}

/** Une seule instruction, et uniquement de la lecture. */
function isReadOnly(sql: string): boolean {
	const nettoye = sql
		.replace(/--[^\n]*/g, " ")
		.replace(/\/\*[\s\S]*?\*\//g, " ")
		.trim()
		.replace(/;\s*$/, "");
	if (nettoye.includes(";")) return false;
	return /^(select|with|table|explain|show)\b/i.test(nettoye);
}

export function supabasePlatformTools(repoRoot: string): RegisteredTool[] {
	return [
		// ───────────────────────────── database ─────────────────────────────

		defineTool({
			name: "execute_sql",
			title: "Exécuter du SQL",
			description:
				"Exécute du SQL sur la base Postgres vivante. En portée lecture, la requête tourne en rôle `anon` dans une transaction annulée : les policies RLS s'appliquent et seules les instructions de lecture sont acceptées. En portée `admin`, le SQL est exécuté tel quel avec les droits du propriétaire — écritures comprises.",
			inputSchema: z.object({
				query: z.string().min(1).describe("Instruction SQL. Une seule à la fois en portée lecture."),
			}),
			annotations: { readOnlyHint: false, openWorldHint: false },
			handler: async ({ query }, context) => {
				const admin = context.scope === "admin";
				if (!admin && !isReadOnly(query)) {
					return toolError(
						"Portée lecture : seules `select`, `with`, `table`, `explain` et `show` sont acceptées, et une seule instruction à la fois.",
					);
				}
				try {
					if (admin) {
						const rows = await db().unsafe(query);
						return structured({ role: "rg", rows });
					}
					// Rôle abaissé + transaction annulée : aucune écriture possible,
					// même si l'analyse ci-dessus était contournée.
					const rows = await db().begin(async (tx) => {
						await tx.unsafe("set local role anon");
						const out = await tx.unsafe(query);
						await tx.unsafe("rollback");
						return out;
					});
					return structured({ role: "anon", rows });
				} catch (error) {
					return toolError(`SQL refusé : ${(error as Error).message}`);
				}
			},
		}),

		defineTool({
			name: "list_tables",
			title: "Lister les tables",
			description:
				"Tables des schémas demandés, avec leur nombre estimé de lignes, leur taille, l'état de leur RLS et leurs colonnes. Vue catalogue complète, indépendante de ce que l'API REST expose.",
			inputSchema: z.object({
				schemas: z.array(z.string()).default(["public"]).describe("Schémas à inspecter."),
				withColumns: z.boolean().default(false).describe("Inclure les colonnes de chaque table."),
			}),
			annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
			handler: async ({ schemas, withColumns }) => {
				const tables = await db()`
					select n.nspname as schema, c.relname as name, c.relrowsecurity as rls_enabled,
					       c.reltuples::bigint as rows_estimate,
					       pg_size_pretty(pg_total_relation_size(c.oid)) as size,
					       obj_description(c.oid, 'pg_class') as comment
					  from pg_class c join pg_namespace n on n.oid = c.relnamespace
					 where n.nspname = any(string_to_array(${schemas.join(",")}, ',')) and c.relkind in ('r', 'p', 'v', 'm')
					 order by n.nspname, c.relname`;
				if (!withColumns) return structured({ count: tables.length, tables });
				const columns = await db()`
					select table_schema as schema, table_name as name, column_name, data_type, is_nullable
					  from information_schema.columns where table_schema = any(string_to_array(${schemas.join(",")}, ','))
					 order by table_schema, table_name, ordinal_position`;
				const parTable = new Map<string, unknown[]>();
				for (const col of columns as Array<Record<string, unknown>>) {
					const cle = `${col.schema}.${col.name}`;
					if (!parTable.has(cle)) parTable.set(cle, []);
					parTable.get(cle)?.push({ name: col.column_name, type: col.data_type, nullable: col.is_nullable === "YES" });
				}
				return structured({
					count: tables.length,
					tables: (tables as Array<Record<string, unknown>>).map((t) => ({
						...t,
						columns: parTable.get(`${t.schema}.${t.name}`) ?? [],
					})),
				});
			},
		}),

		defineTool({
			name: "list_extensions",
			title: "Lister les extensions",
			description: "Extensions Postgres installées et disponibles, avec leur version et leur schéma.",
			inputSchema: z.object({
				installedOnly: z.boolean().default(true).describe("Ne lister que les extensions installées."),
			}),
			annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
			handler: async ({ installedOnly }) => {
				const rows = installedOnly
					? await db()`select e.extname as name, e.extversion as version, n.nspname as schema
					               from pg_extension e join pg_namespace n on n.oid = e.extnamespace order by 1`
					: await db()`select name, default_version, installed_version, comment from pg_available_extensions order by 1`;
				return structured({ count: rows.length, extensions: rows });
			},
		}),

		defineTool({
			name: "list_migrations",
			title: "Lister les migrations",
			description:
				"Migrations SQL versionnées du dépôt (`apps/website/sql/migrations`). Elles sont appliquées manuellement : ce dossier est la référence de ce qui a été écrit, pas un journal d'exécution.",
			inputSchema: z.object({}),
			annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
			handler: async () => {
				const dossier = join(repoRoot, MIGRATIONS_DIR);
				try {
					const fichiers = (await readdir(dossier)).filter((f) => f.endsWith(".sql")).sort();
					const migrations = await Promise.all(
						fichiers.map(async (nom) => {
							const contenu = await readFile(join(dossier, nom), "utf8");
							const titre = contenu.split("\n").find((l) => l.startsWith("--"))?.replace(/^--\s*/, "") ?? "";
							return { name: nom, version: nom.slice(0, 8), summary: titre, bytes: contenu.length };
						}),
					);
					return structured({ directory: MIGRATIONS_DIR, count: migrations.length, migrations });
				} catch (error) {
					return toolError(`Dossier de migrations illisible : ${(error as Error).message}`);
				}
			},
		}),

		defineTool({
			name: "apply_migration",
			title: "Appliquer une migration",
			description:
				"Exécute une migration SQL et l'enregistre dans `apps/website/sql/migrations`. Réservé à la portée `admin` : c'est une écriture réelle sur la base de production.",
			scope: "admin",
			inputSchema: z.object({
				name: z.string().min(1).describe("Nom court, ex. `ajout_index_articles`. Préfixé par la date."),
				query: z.string().min(1).describe("SQL de la migration."),
			}),
			annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
			handler: async ({ name, query }) => {
				try {
					await db().unsafe(query);
				} catch (error) {
					return toolError(`Migration non appliquée : ${(error as Error).message}`);
				}
				// L'horodatage vient de la base : le serveur MCP ne suppose pas
				// que son horloge locale fasse foi.
				const [{ stamp }] = (await db()`select to_char(now(), 'YYYYMMDD') as stamp`) as Array<{ stamp: string }>;
				const fichier = `${stamp}_${name.replace(/[^a-z0-9_]+/gi, "_").toLowerCase()}.sql`;
				const chemin = join(repoRoot, MIGRATIONS_DIR, fichier);
				await Bun.write(chemin, `-- ${name}\n-- Appliquée via apply_migration (MCP).\n\n${query.trim()}\n`);
				return structured({ applied: true, file: `${MIGRATIONS_DIR}/${fichier}` });
			},
		}),

		// ───────────────────────────── debugging ─────────────────────────────

		defineTool({
			name: "get_advisors",
			title: "Audit sécurité et performance",
			description:
				"Passe la base au crible et signale ce qui mérite correction : tables sans RLS exposées en lecture publique, RLS activée sans aucune policy, colonnes personnelles lisibles par `anon`, fonctions `security definer` au `search_path` mutable, clés étrangères sans index. C'est ce contrôle qui a révélé, le 11/8/2026, que les e-mails de tous les comptes étaient publics.",
			inputSchema: z.object({
				type: z.enum(["security", "performance", "all"]).default("all").describe("Famille de contrôles."),
			}),
			annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
			handler: async ({ type }) => {
				const findings: Array<{ level: string; category: string; object: string; detail: string }> = [];

				if (type !== "performance") {
					// Colonnes au nom sensible ouvertes à `anon`.
					//
					// Le droit sur la colonne ne suffit PAS à conclure : la RLS peut
					// bloquer la table entière. Sur cette base, 17 colonnes sont
					// grantées à `anon` mais toutes verrouillées par RLS — les signaler
					// en erreur noierait la seule qui compte. On ne remonte donc en
					// `error` que ce qui est **réellement atteignable** : table sans RLS,
					// ou policy SELECT permissive au prédicat trivialement vrai (c'est
					// exactement ce qui exposait `profiles.email` avant le 11/8/2026).
					const pii = await db()`
						select cp.table_name, cp.column_name,
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
						 order by 1, 2`;
					for (const r of pii as Array<{ table_name: string; column_name: string; rls: boolean; policy_ouverte: boolean | null }>) {
						const atteignable = !r.rls || r.policy_ouverte === true;
						findings.push({
							level: atteignable ? "error" : "info",
							category: atteignable ? "pii_exposee" : "pii_grantee_mais_rls_bloque",
							object: `public.${r.table_name}.${r.column_name}`,
							detail: atteignable
								? "Colonne personnelle réellement lisible par tout visiteur : ni RLS, ni prédicat restrictif."
								: "Droit accordé à `anon` mais la RLS bloque la table. À révoquer par principe, sans urgence.",
						});
					}

					// RLS activée mais aucune policy → table verrouillée, ou oubli.
					const sansPolicy = await db()`
						select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
						 where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
						   and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)
						 order by 1`;
					for (const r of sansPolicy as Array<{ name: string }>) {
						findings.push({
							level: "warning",
							category: "rls_sans_policy",
							object: `public.${r.name}`,
							detail: "RLS activée sans aucune policy : la table est inaccessible sauf au propriétaire et au service_role.",
						});
					}

					// Table lisible par anon SANS RLS → lecture totale.
					const sansRls = await db()`
						select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
						 where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
						   and has_table_privilege('anon', c.oid, 'SELECT')
						 order by 1`;
					for (const r of sansRls as Array<{ name: string }>) {
						findings.push({
							level: "warning",
							category: "table_sans_rls",
							object: `public.${r.name}`,
							detail: "Lisible par `anon` sans RLS : toutes les lignes sont publiques.",
						});
					}

					// security definer + search_path non figé = vecteur d'escalade.
					const definer = await db()`
						select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
						 where n.nspname = 'public' and p.prosecdef
						   and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
						 order by 1`;
					for (const r of definer as Array<{ name: string }>) {
						findings.push({
							level: "warning",
							category: "search_path_mutable",
							object: `public.${r.name}()`,
							detail: "Fonction `security definer` sans `search_path` figé : vecteur d'escalade de privilèges.",
						});
					}
				}

				if (type !== "security") {
					// Clés étrangères sans index : jointures et cascades lentes.
					const fkSansIndex = await db()`
						select c.conrelid::regclass::text as table_name, c.conname as constraint_name
						  from pg_constraint c
						 where c.contype = 'f' and c.connamespace = 'public'::regnamespace
						   and not exists (
						       select 1 from pg_index i
						        where i.indrelid = c.conrelid
						          and (i.indkey::smallint[])[0:array_length(c.conkey, 1) - 1] @> c.conkey)
						 order by 1`;
					for (const r of fkSansIndex as Array<{ table_name: string; constraint_name: string }>) {
						findings.push({
							level: "info",
							category: "fk_sans_index",
							object: r.table_name,
							detail: `Clé étrangère \`${r.constraint_name}\` sans index de couverture.`,
						});
					}
				}

				const parNiveau = { error: 0, warning: 0, info: 0 } as Record<string, number>;
				for (const f of findings) parNiveau[f.level] = (parNiveau[f.level] ?? 0) + 1;
				return structured({ type, total: findings.length, byLevel: parNiveau, findings });
			},
		}),

		// ──────────────────────────── development ────────────────────────────

		defineTool({
			name: "get_project_url",
			title: "URL de l'API",
			description: "URL publique de la pile, celle à mettre dans `NEXT_PUBLIC_SUPABASE_URL` pour un client externe.",
			inputSchema: z.object({}),
			annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
			handler: () =>
				structured({
					url: PUBLIC_URL,
					rest: `${PUBLIC_URL}/rest/v1`,
					graphql: `${PUBLIC_URL}/graphql/v1`,
					storage: `${PUBLIC_URL}/storage/v1`,
					realtime: `${PUBLIC_URL}/realtime/v1`,
					studio: "https://studio.rosegriffon.fr",
				}),
		}),

		defineTool({
			name: "get_publishable_keys",
			title: "Clés publiables",
			description:
				"Clé anonyme publiable, celle qu'un client navigateur utilise. La clé de service n'est jamais renvoyée : elle contourne la RLS et n'a rien à faire dans un contexte d'agent.",
			inputSchema: z.object({}),
			annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
			handler: () => {
				const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
				if (!anon) return toolError("Clé anonyme absente de l'environnement du serveur.");
				return structured({ anon_key: anon, note: "La clé de service n'est pas exposée par cet outil." });
			},
		}),

		defineTool({
			name: "generate_typescript_types",
			title: "Générer les types TypeScript",
			description:
				"Génère les types TypeScript du schéma, au format attendu par `@supabase/supabase-js`. Équivaut au fichier `packages/db/src/types.gen.ts` du dépôt.",
			inputSchema: z.object({
				schemas: z.array(z.string()).default(["public"]).describe("Schémas à inclure."),
			}),
			annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
			handler: async ({ schemas }) => {
				const url = `${PG_META}/generators/typescript?included_schemas=${schemas.join(",")}`;
				const response = await fetch(url, { signal: AbortSignal.timeout(30_000) }).catch(() => null);
				if (!response?.ok) {
					return toolError(
						`Générateur indisponible (${response?.status ?? "hors ligne"}) — le conteneur rg-pg-meta doit tourner.`,
					);
				}
				const types = await response.text();
				return structured({ schemas, bytes: types.length, types });
			},
		}),

		// ────────────────────────────── storage ──────────────────────────────

		defineTool({
			name: "list_storage_buckets",
			title: "Lister les buckets",
			description: "Buckets de fichiers, avec leur visibilité, leur nombre d'objets et leur poids total.",
			inputSchema: z.object({}),
			annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
			handler: async () => {
				const rows = await db()`
					select b.id, b.name, b.public, b.created_at,
					       count(o.id)::int as objects,
					       coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint as bytes
					  from storage.buckets b left join storage.objects o on o.bucket_id = b.id
					 group by b.id, b.name, b.public, b.created_at order by b.id`;
				return structured({ count: rows.length, buckets: rows });
			},
		}),

		defineTool({
			name: "get_storage_config",
			title: "Configuration du stockage",
			description:
				"Configuration effective du service de stockage : racine sur disque, taille maximale acceptée et buckets déclarés.",
			inputSchema: z.object({}),
			annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
			handler: async () => {
				const buckets = await db()`select id, public from storage.buckets order by id`;
				return structured({
					provider: "rg-storage (Bun, disque local)",
					root: process.env.RG_STORAGE_ROOT ?? "/var/www/rg-storage",
					fileSizeLimit: "512 Mo (client_max_body_size nginx)",
					publicUrlBase: `${PUBLIC_URL}/storage/v1/object/public`,
					buckets,
				});
			},
		}),

		// ─────────────────────────────── docs ───────────────────────────────

		defineTool({
			name: "search_docs",
			title: "Chercher dans la documentation",
			description:
				"Recherche plein texte dans `docs/` du dépôt — l'équivalent local de la documentation Supabase, mais qui décrit NOTRE pile : services, ports, pièges, procédures d'exploitation.",
			inputSchema: z.object({
				query: z.string().min(2).describe("Termes recherchés."),
				limit: z.number().int().min(1).max(30).default(8).describe("Nombre d'extraits."),
			}),
			annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
			handler: async ({ query, limit }) => {
				// Chaque terme est cherché séparément puis les extraits sont classés
				// par nombre de termes distincts trouvés : une recherche en langage
				// naturel ne correspond presque jamais à une sous-chaîne littérale.
				const termes = query.split(/\s+/).filter((t) => t.length >= 2);
				if (termes.length === 0) return structured({ query, count: 0, results: [] });

				const parLigne = new Map<string, { file: string; line: number; excerpt: string; hits: Set<string> }>();
				for (const terme of termes) {
					const proc = Bun.spawnSync(["grep", "-rin", "--include=*.md", "-F", terme, "docs"], {
						cwd: repoRoot,
						stdout: "pipe",
						stderr: "pipe",
					});
					for (const ligne of proc.stdout.toString().split("\n").filter(Boolean)) {
						const [fichier, numero, ...reste] = ligne.split(":");
						if (!fichier || !numero) continue;
						const cle = `${fichier}:${numero}`;
						const entree = parLigne.get(cle) ?? {
							file: fichier,
							line: Number(numero),
							excerpt: reste.join(":").trim().slice(0, 300),
							hits: new Set<string>(),
						};
						entree.hits.add(terme.toLowerCase());
						parLigne.set(cle, entree);
					}
				}
				const results = [...parLigne.values()]
					.sort((a, b) => b.hits.size - a.hits.size)
					.slice(0, limit)
					.map(({ file, line, excerpt, hits }) => ({ file, line, excerpt, matched: [...hits] }));
				return structured({ query, terms: termes, count: results.length, results });
			},
		}),
	];
}
