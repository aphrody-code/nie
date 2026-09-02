/**
 * Outils « exploitation » — état réel de la production Rose Griffon.
 *
 * Tout est en lecture seule et sur liste blanche : on n'expose ni `systemctl
 * restart`, ni une commande arbitraire. Un agent distant peut diagnostiquer
 * (service tombé, site en 500, journal d'erreurs) ; agir reste une décision
 * humaine, prise sur la machine.
 */

import { z } from "zod";
import { structured, text } from "../protocol/types.ts";
import { defineTool, type RegisteredTool } from "../registry.ts";

/** Unités systemd du périmètre Rose Griffon, vérifiées sur le VPS. */
export const KNOWN_SERVICES = [
	"azalee-web.service",
	"azalee-api.service",
	"azalee-mirror-sync.service",
	"website-web.service",
	"rg-cron.service",
	"rg-cdn.service",
	"rg-rag-embed.service",
	"rag-api.service",
	"cdn-variants.service",
	"nie-model-serve.service",
	"rg-mcp.service",
] as const;

/** Points d'entrée publics dont on vérifie le code de retour. */
export const KNOWN_ENDPOINTS: Record<string, string> = {
	azalee: "https://azalee.rosegriffon.fr/",
	website: "https://rosegriffon.fr/",
	api: "https://api.rosegriffon.fr/health",
	"api-azalee": "https://api.rosegriffon.fr/azalee/health",
	cdn: "https://cdn.rosegriffon.fr/health",
};

async function capture(command: string[], timeoutMs = 15_000): Promise<string> {
	const proc = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
	const timer = setTimeout(() => proc.kill(), timeoutMs);
	try {
		const [stdout, stderr] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
		]);
		await proc.exited;
		return (stdout || stderr).trim();
	} finally {
		clearTimeout(timer);
	}
}

async function serviceState(unit: string): Promise<{ unit: string; active: string; since?: string }> {
	const raw = await capture([
		"systemctl",
		"show",
		unit,
		"--property=ActiveState",
		"--property=SubState",
		"--property=ActiveEnterTimestamp",
		"--property=LoadState",
	]);
	const fields = Object.fromEntries(
		raw
			.split("\n")
			.filter(Boolean)
			.map((line) => {
				const index = line.indexOf("=");
				return [line.slice(0, index), line.slice(index + 1)];
			}),
	);
	if (fields.LoadState === "not-found") return { unit, active: "absent" };
	const substate = fields.SubState ? ` (${fields.SubState})` : "";
	return {
		unit,
		active: `${fields.ActiveState ?? "inconnu"}${substate}`,
		since: fields.ActiveEnterTimestamp || undefined,
	};
}

async function endpointState(name: string, url: string): Promise<Record<string, unknown>> {
	const started = performance.now();
	try {
		const response = await fetch(url, {
			method: "GET",
			redirect: "manual",
			signal: AbortSignal.timeout(8000),
			headers: { "user-agent": "rg-mcp/1.0 (healthcheck)" },
		});
		return {
			name,
			url,
			status: response.status,
			ok: response.status < 400,
			ms: Math.round(performance.now() - started),
		};
	} catch (error) {
		return { name, url, status: 0, ok: false, error: error instanceof Error ? error.message : String(error) };
	}
}

export function opsTools(): RegisteredTool[] {
	return [
		defineTool({
			name: "ops_status",
			title: "État de la production Rose Griffon",
			description:
				"Vue d'ensemble de la production : état de chaque service systemd du périmètre (wiki Azalée, site principal, cron, CDN, RAG, serveur de modèles 3D) et code HTTP des points d'entrée publics. Premier outil à appeler pour un diagnostic.",
			inputSchema: z.object({
				services: z.boolean().default(true).describe("Inclure l'état des services systemd."),
				endpoints: z.boolean().default(true).describe("Inclure les vérifications HTTP publiques."),
			}),
			annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: true },
			handler: async ({ services, endpoints }, context) => {
				context.progress(0, 2, "interrogation des services");
				const result: Record<string, unknown> = {};
				if (services) {
					result.services = await Promise.all(KNOWN_SERVICES.map((unit) => serviceState(unit)));
				}
				context.progress(1, 2, "vérification des points d'entrée");
				if (endpoints) {
					result.endpoints = await Promise.all(
						Object.entries(KNOWN_ENDPOINTS).map(([name, url]) => endpointState(name, url)),
					);
				}
				context.progress(2, 2, "terminé");
				return structured(result);
			},
		}),

		defineTool({
			name: "ops_logs",
			title: "Journal d'un service",
			description:
				"Dernières lignes du journal systemd d'un service du périmètre Rose Griffon. Utiliser après ops_status pour comprendre pourquoi un service est tombé ou redémarre en boucle.",
			inputSchema: z.object({
				service: z.enum(KNOWN_SERVICES).describe("Unité systemd."),
				lines: z.int().min(1).max(300).default(50).describe("Nombre de lignes."),
				priority: z
					.enum(["all", "err", "warning"] as const)
					.default("all")
					.describe("Filtre de gravité : toutes, erreurs seules, avertissements et pire."),
			}),
			annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: false },
			handler: async ({ service, lines, priority }) => {
				const args = ["journalctl", "-u", service, "-n", String(lines), "--no-pager", "--output=short-iso"];
				if (priority !== "all") args.push("-p", priority);
				const output = await capture(args, 20_000);
				return { content: [text(output || "(journal vide)")] };
			},
		}),

		defineTool({
			name: "ops_http",
			title: "Vérifier une URL du périmètre",
			description:
				"Effectue une requête HTTP GET sur une URL des domaines Rose Griffon (rosegriffon.fr et sous-domaines) et renvoie le statut, les en-têtes utiles et le début du corps. Refuse tout autre domaine.",
			inputSchema: z.object({
				url: z.url().describe("URL à tester (domaine rosegriffon.fr uniquement)."),
				bodyChars: z.int().min(0).max(4000).default(400).describe("Caractères de corps renvoyés."),
			}),
			annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: true },
			handler: async ({ url, bodyChars }) => {
				const parsed = new URL(url);
				if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
					throw new Error("Seuls http(s) sont acceptés.");
				}
				if (parsed.hostname !== "rosegriffon.fr" && !parsed.hostname.endsWith(".rosegriffon.fr")) {
					throw new Error(`Domaine refusé : ${parsed.hostname} (rosegriffon.fr uniquement).`);
				}
				const response = await fetch(parsed, {
					redirect: "manual",
					signal: AbortSignal.timeout(15_000),
					headers: { "user-agent": "rg-mcp/1.0 (diagnostic)" },
				});
				const body = bodyChars > 0 ? (await response.text()).slice(0, bodyChars) : "";
				return structured({
					url: parsed.toString(),
					status: response.status,
					contentType: response.headers.get("content-type"),
					cacheControl: response.headers.get("cache-control"),
					location: response.headers.get("location"),
					server: response.headers.get("server"),
					body,
				});
			},
		}),
	];
}
