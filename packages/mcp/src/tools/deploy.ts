/**
 * Outils de **déploiement** — publication bleu/vert d'Azalée et du site principal.
 *
 * `deploy_status` est en lecture seule : il rend l'état des slots, la version servie et
 * la santé publique, sans rien changer. `deploy_run` est en portée `admin` : il lance
 * une publication réelle sur le VPS.
 *
 * Une publication dure de quelques minutes (sans build) à une vingtaine (avec build) :
 * bien plus qu'un appel MCP. L'outil **détache** donc le processus, rend immédiatement
 * l'identifiant du journal, et laisse l'agent suivre l'avancement avec `deploy_status`
 * — plutôt que de tenir la connexion ouverte et de faire expirer le client.
 *
 * Le mécanisme lui-même vit dans `scripts/ops/deploy.ts` : le serveur MCP n'en est
 * qu'une façade, il ne duplique aucune logique de bascule.
 */

import { z } from "zod";
import { structured, text, toolError } from "../protocol/types.ts";
import { defineTool, type RegisteredTool } from "../registry.ts";

const DEPLOY_SCRIPT = "scripts/ops/deploy.ts";
const RELEASES_ROOT = "/home/ubuntu/rg-releases";
const BUN_BIN = "/home/ubuntu/.bun/bin/bun";

/** Surfaces déployables. `all` traite les deux dans l'ordre. */
const APPS = ["azalee", "website", "all"] as const;

/**
 * Modes de publication. `deploy` construit puis bascule ; `reload` republie la version
 * déjà en production (utile après un échange du miroir SQLite) ; `rollback` revient à la
 * version précédente ; `preview` publie sans toucher à la production ; `promote` passe
 * la prévisualisation en production ; `preview-off` la retire.
 */
const MODES = ["deploy", "reload", "rollback", "preview", "promote", "preview-off"] as const;

interface DeployToolsOptions {
	/** Racine du dépôt sur le VPS. */
	root: string;
	onAudit?: (line: string) => void;
}

async function capture(command: string[], cwd: string, timeoutMs = 60_000): Promise<string> {
	const proc = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
	const minuteur = setTimeout(() => proc.kill(9), timeoutMs);
	try {
		const [stdout, stderr] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
		]);
		await proc.exited;
		return (stdout || stderr).trim();
	} finally {
		clearTimeout(minuteur);
	}
}

/** Dernier journal de publication d'une surface, avec sa fin de fichier. */
async function dernierJournal(app: string, lignes: number): Promise<{ path: string; tail: string } | null> {
	const dossier = `${RELEASES_ROOT}/${app}/logs`;
	const listing = await capture(["sh", "-c", `ls -1t ${dossier} 2>/dev/null | head -1`], RELEASES_ROOT, 10_000);
	if (!listing) return null;
	const path = `${dossier}/${listing}`;
	const contenu = await Bun.file(path)
		.text()
		.catch(() => "");
	return { path, tail: contenu.split("\n").slice(-lignes).join("\n") };
}

export function deployTools(options: DeployToolsOptions): RegisteredTool[] {
	const root = options.root.replace(/\/+$/, "");
	const audit = options.onAudit ?? ((line: string) => process.stderr.write(`${line}\n`));

	return [
		defineTool({
			name: "deploy_status",
			title: "État des déploiements",
			description:
				"Version en production de chaque surface (wiki Azalée, site principal), slot servi par nginx, prévisualisation éventuelle, mémoire disponible et santé publique. À appeler avant et après une publication, et pour suivre une publication en cours.",
			inputSchema: z.object({
				app: z.enum(APPS).default("all").describe("Surface concernée."),
				logLines: z
					.int()
					.min(0)
					.max(200)
					.default(0)
					.describe("Fin du dernier journal de publication à joindre (0 = aucune)."),
			}),
			annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: true },
			handler: async ({ app, logLines }) => {
				const sortie = await capture(
					[BUN_BIN, DEPLOY_SCRIPT, "status", app === "all" ? "all" : app, "--json"],
					root,
					90_000,
				);
				let état: unknown;
				try {
					état = JSON.parse(sortie.slice(sortie.indexOf("{")));
				} catch {
					return toolError(`sortie inattendue de ${DEPLOY_SCRIPT} :\n${sortie.slice(0, 2000)}`);
				}
				if (logLines === 0) return structured(état as Record<string, unknown>);
				const cibles = app === "all" ? ["azalee", "website"] : [app];
				const journaux: Record<string, unknown> = {};
				for (const cible of cibles) journaux[cible] = await dernierJournal(cible, logLines);
				return structured({ ...(état as Record<string, unknown>), journaux });
			},
		}),

		defineTool({
			name: "deploy_run",
			title: "Publier une version (sans coupure)",
			description:
				"Lance une publication bleu/vert : le nouveau build démarre sur un second port, est sondé, puis nginx bascule — le site ne tombe à aucun moment. La commande est détachée et rend aussitôt le chemin de son journal : suivre l'avancement avec deploy_status (logLines > 0). Un build complet prend une dizaine de minutes ; utiliser build: false pour republier des artefacts déjà bâtis.",
			scope: "admin",
			inputSchema: z.object({
				app: z.enum(APPS).describe("Surface à publier."),
				mode: z.enum(MODES).default("deploy").describe("Nature de la publication."),
				build: z.boolean().default(true).describe("Reconstruire (false = publier les artefacts existants)."),
				typeCheck: z.boolean().default(true).describe("Exiger un type-check vert avant de construire."),
				release: z
					.string()
					.optional()
					.describe("Version visée, pour un retour arrière ou une promotion précise."),
			}),
			annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
			handler: async ({ app, mode, build, typeCheck, release }) => {
				const arguments_ = [BUN_BIN, DEPLOY_SCRIPT, mode, app];
				if (!build) arguments_.push("--no-build");
				if (!typeCheck) arguments_.push("--no-gate");
				if (release) arguments_.push(`--to=${release}`);
				audit(`mcp-admin deploy_run ${arguments_.slice(1).join(" ")}`);

				// Détaché : la publication survit à la fin de l'appel MCP. Sans cela, une
				// déconnexion du client tuerait une bascule à mi-parcours.
				const proc = Bun.spawn(arguments_, {
					cwd: root,
					stdout: "ignore",
					stderr: "ignore",
					stdin: "ignore",
					env: { ...process.env },
				});
				proc.unref();

				return {
					content: [
						text(
							`Publication ${mode} de ${app} lancée (pid ${proc.pid}).\n` +
								"Suivre avec deploy_status (logLines: 40). Le site reste servi pendant toute l'opération.",
						),
					],
					structuredContent: { app, mode, build, typeCheck, release: release ?? null, pid: proc.pid },
				};
			},
		}),
	];
}
