/**
 * Outils « dépôt » — lecture du monorepo depuis une machine distante.
 *
 * C'est ce qui donne son intérêt à la connexion distante : un Claude qui
 * tourne sur un autre poste n'a aucun accès au système de fichiers du VPS.
 * Ces outils lui ouvrent le dépôt **en lecture seule**, avec trois garde-fous
 * non contournables :
 *
 * 1. **prison de chemin** — tout chemin est résolu (liens symboliques compris)
 *    et doit rester sous la racine du dépôt ;
 * 2. **liste noire** — secrets, sauvegardes contenant des données
 *    personnelles, artefacts binaires et `node_modules` sont invisibles ;
 * 3. **plafonds** — taille de fichier et nombre de résultats bornés, pour ne
 *    pas noyer le contexte du modèle.
 */

import { z } from "zod";
import { structured, text, toolError } from "../protocol/types.ts";
import { defineTool, type RegisteredTool } from "../registry.ts";
import { isDenied, resolveInside } from "./paths.ts";

export interface RepoToolsOptions {
	/** Racine du dépôt. Tout accès en dehors est refusé. */
	root: string;
	/** Taille maximale d'un fichier lu, en octets. */
	maxFileBytes?: number;
}

const DEFAULT_MAX_FILE_BYTES = 512 * 1024;

async function runGit(root: string, args: string[]): Promise<string> {
	const proc = Bun.spawn(["git", "-C", root, ...args], { stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
	await proc.exited;
	return stdout.trim() || stderr.trim();
}

export function repoTools(options: RepoToolsOptions): RegisteredTool[] {
	const root = options.root.replace(/\/+$/, "");
	const maxBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;

	return [
		defineTool({
			name: "repo_list",
			title: "Lister un répertoire du monorepo",
			description:
				"Liste les fichiers et dossiers d'un répertoire du monorepo Rose Griffon sur le VPS. Chemin relatif à la racine du dépôt ; vide = racine. Les secrets, sauvegardes, binaires et node_modules sont masqués.",
			inputSchema: z.object({
				path: z.string().default("").describe("Chemin relatif, ex. `packages/azalee/src`."),
				depth: z.int().min(1).max(3).default(1).describe("Profondeur de récursion."),
			}),
			annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
			handler: async ({ path, depth }) => {
				const target = await resolveInside(root, path);
				if (!target) return toolError(`Chemin refusé ou hors du dépôt : ${path}`);
				const entries = await listRecursive(root, target.absolute, target.relative, depth);
				return structured({ path: target.relative, count: entries.length, entries });
			},
		}),

		defineTool({
			name: "repo_read",
			title: "Lire un fichier du monorepo",
			description:
				"Renvoie le contenu texte d'un fichier du dépôt, éventuellement limité à une plage de lignes. Refuse les fichiers binaires, les secrets et tout chemin sortant du dépôt.",
			inputSchema: z.object({
				path: z.string().min(1).describe("Chemin relatif du fichier."),
				startLine: z.int().min(1).optional().describe("Première ligne renvoyée (1 = début)."),
				endLine: z.int().min(1).optional().describe("Dernière ligne renvoyée."),
			}),
			annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
			handler: async ({ path, startLine, endLine }) => {
				const target = await resolveInside(root, path);
				if (!target) return toolError(`Chemin refusé ou hors du dépôt : ${path}`);
				const file = Bun.file(target.absolute);
				if (!(await file.exists())) return toolError(`Fichier introuvable : ${target.relative}`);
				if (file.size > maxBytes) {
					return toolError(
						`Fichier trop volumineux (${file.size} octets, plafond ${maxBytes}). Utiliser startLine/endLine ou repo_grep.`,
					);
				}
				const content = await file.text();
				const lines = content.split("\n");
				const from = (startLine ?? 1) - 1;
				const to = endLine ?? lines.length;
				const slice = lines.slice(from, to).join("\n");
				return {
					content: [text(slice)],
					// Le texte lui-même doit vivre ici aussi : c'est `structuredContent`
					// que les clients affichent (cf. `structured()` plus bas dans ce
					// fichier), et un `content` non dupliqué se retrouvait invisible —
					// seules les métadonnées apparaissaient à l'appelant.
					structuredContent: {
						path: target.relative,
						totalLines: lines.length,
						startLine: from + 1,
						endLine: Math.min(to, lines.length),
						text: slice,
					},
				};
			},
		}),

		defineTool({
			name: "repo_grep",
			title: "Chercher un motif dans le monorepo",
			description:
				"Recherche une expression régulière dans les fichiers texte du dépôt et renvoie les correspondances avec `fichier:ligne`. Restreignable à un sous-répertoire et à un glob d'extension.",
			inputSchema: z.object({
				pattern: z.string().min(1).describe("Expression régulière (syntaxe ripgrep)."),
				path: z.string().default("").describe("Sous-répertoire de recherche."),
				glob: z.string().optional().describe("Filtre de nom, ex. `*.ts`."),
				limit: z.int().min(1).max(300).default(60).describe("Nombre maximum de correspondances."),
				ignoreCase: z.boolean().default(false).describe("Recherche insensible à la casse."),
			}),
			annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
			handler: async ({ pattern, path, glob, limit, ignoreCase }) => {
				const target = await resolveInside(root, path);
				if (!target) return toolError(`Chemin refusé ou hors du dépôt : ${path}`);
				const args = ["rg", "--line-number", "--no-heading", "--color=never", "--max-count", "5"];
				if (ignoreCase) args.push("--ignore-case");
				if (glob) args.push("--glob", glob);
				args.push("--", pattern, target.absolute || root);
				const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe", cwd: root });
				const output = await new Response(proc.stdout).text();
				await proc.exited;
				const matches = output
					.split("\n")
					.filter(Boolean)
					.map((line) => line.replace(`${root}/`, ""))
					.filter((line) => !isDenied(line.split(":")[0] ?? ""))
					.slice(0, limit);
				return structured({ pattern, count: matches.length, matches });
			},
		}),

		defineTool({
			name: "repo_git",
			title: "État Git du monorepo",
			description:
				"Informations Git en lecture seule : branche et fichiers modifiés (`status`), derniers commits (`log`), statistiques de diff (`diff`), ou contenu d'un commit (`show`). Aucune commande ne modifie le dépôt.",
			inputSchema: z.object({
				action: z.enum(["status", "log", "diff", "show"] as const).default("status"),
				ref: z.string().optional().describe("Référence pour `show`/`diff`, ex. `HEAD~1` ou un SHA."),
				limit: z.int().min(1).max(50).default(15).describe("Nombre de commits pour `log`."),
			}),
			annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
			handler: async ({ action, ref, limit }) => {
				switch (action) {
					case "status": {
						const [branch, status] = await Promise.all([
							runGit(root, ["rev-parse", "--abbrev-ref", "HEAD"]),
							runGit(root, ["status", "--porcelain=v1", "--branch"]),
						]);
						return structured({ branch, status: status.split("\n").filter(Boolean) });
					}
					case "log":
						return structured({
							commits: (
								await runGit(root, ["log", `-${limit}`, "--pretty=%h|%ad|%an|%s", "--date=short"])
							)
								.split("\n")
								.filter(Boolean)
								.map((line) => {
									const [hash, date, author, ...rest] = line.split("|");
									return { hash, date, author, subject: rest.join("|") };
								}),
						});
					case "diff":
						return { content: [text(await runGit(root, ["diff", "--stat", ...(ref ? [ref] : [])]))] };
					case "show":
						return {
							content: [text(await runGit(root, ["show", "--stat", "--pretty=fuller", ref ?? "HEAD"]))],
						};
				}
			},
		}),
	];
}

interface RepoEntry {
	path: string;
	type: "file" | "dir";
	size?: number;
}

/**
 * Parcours niveau par niveau avec `Bun.Glob` : un motif `*` par répertoire,
 * et on ne descend que dans les dossiers autorisés. C'est ce qui évite de
 * traverser `node_modules` ou `.next` — un `**` naïf sur la racine mettrait
 * plusieurs secondes et noierait le résultat.
 */
async function listRecursive(
	root: string,
	absolute: string,
	relative: string,
	depth: number,
): Promise<RepoEntry[]> {
	const entries: RepoEntry[] = [];
	let names: string[];
	try {
		names = [...new Bun.Glob("*").scanSync({ cwd: absolute, onlyFiles: false, dot: true })].sort();
	} catch {
		return entries;
	}
	for (const name of names) {
		if (name.startsWith(".") && name !== ".github" && name !== ".claude") continue;
		const childRelative = relative ? `${relative}/${name}` : name;
		if (isDenied(childRelative)) continue;
		const childAbsolute = `${absolute}/${name}`;
		let info: { size: number; isDirectory(): boolean };
		try {
			info = await Bun.file(childAbsolute).stat();
		} catch {
			continue;
		}
		if (info.isDirectory()) {
			entries.push({ path: childRelative, type: "dir" });
			if (depth > 1) entries.push(...(await listRecursive(root, childAbsolute, childRelative, depth - 1)));
		} else {
			entries.push({ path: childRelative, type: "file", size: info.size });
		}
	}
	return entries;
}
