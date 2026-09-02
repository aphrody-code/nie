/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DOCS_DIR = "/home/ubuntu/rg/docs";
// Les docs de référence externes (crawlées) sont isolées dans docs/reference/
// pour ne pas polluer la racine des docs-projet écrits à la main.
const REFERENCE_DIR = join(DOCS_DIR, "reference");

/**
 * Récupère les documentations de référence sur Markdown et Bun.markdown
 * pour les intégrer au monorepo et au RAG/LLM.
 */
export async function crawlExternalDocs(): Promise<{ success: boolean; error?: string }> {
	console.log("[Crawl External Docs] Récupération de awesome-markdown & bun-markdown...");

	try {
		await mkdir(REFERENCE_DIR, { recursive: true });
		// 1. Fetch awesome-markdown README
		const awesomeRes = await fetch(
			"https://raw.githubusercontent.com/mundimark/awesome-markdown/master/README.md"
		);
		if (!awesomeRes.ok) {
			throw new Error(`Failed to fetch awesome-markdown (status ${awesomeRes.status})`);
		}
		let awesomeContent = await awesomeRes.text();

		// Remplacer les liens relatifs .md par des URLs absolues sur GitHub pour éviter les liens brisés locaux
		awesomeContent = awesomeContent.replaceAll(
			/\]\((?!http|https|mailto:|#)([^)]+\.md)\)/g,
			"](https://github.com/mundimark/awesome-markdown/blob/master/$1)"
		);

		const awesomeFrontmatter = `---
title: "Awesome Markdown"
description: "Index de ressources Markdown de référence compilé par mundimark (outils, extensions, spécifications)."
scope: ["markdown", "ref"]
status: "stable"
---

`;
		await writeFile(join(REFERENCE_DIR, "awesome-markdown.md"), awesomeFrontmatter + awesomeContent);
		console.log("[Crawl External Docs] Fichier awesome-markdown.md enregistré.");

		// 2. Fetch Bun markdown docs (MDX)
		const bunRes = await fetch(
			"https://raw.githubusercontent.com/oven-sh/bun/main/docs/runtime/markdown.mdx"
		);
		if (!bunRes.ok) {
			throw new Error(`Failed to fetch Bun markdown docs (status ${bunRes.status})`);
		}
		let bunContent = await bunRes.text();

		if (!bunContent.startsWith("---")) {
			const bunFrontmatter = `---
title: "Bun Markdown Runtime API"
description: "Documentation de l'API native Bun.markdown de Bun pour le parsing et rendu de Markdown à haute performance."
scope: ["bun", "markdown", "runtime"]
status: "stable"
---

`;
			bunContent = bunFrontmatter + bunContent;
		} else {
			// Injecter scope et status s'ils ne sont pas présents
			bunContent = bunContent.replace(/^---([\s\S]*?)---/, (_, p1) => {
				let parsed = p1;
				if (!parsed.includes("scope:")) {
					parsed += '\nscope: ["bun", "markdown", "runtime"]';
				}
				if (!parsed.includes("status:")) {
					parsed += '\nstatus: "stable"';
				}
				// Remplacer le titre générique par un titre plus explicite
				parsed = parsed.replace(
					/^title:\s*["']?Markdown["']?/m,
					'title: "Bun Markdown Runtime API"'
				);
				return `---\n${parsed.trim()}\n---`;
			});
		}

		await writeFile(join(REFERENCE_DIR, "bun-markdown.md"), bunContent);
		console.log("[Crawl External Docs] Fichier bun-markdown.md enregistré.");

		// 3. Fetch Better Auth README
		try {
			console.log("[Crawl External Docs] Fetching Better Auth README...");
			const baReadmeRes = await fetch("https://raw.githubusercontent.com/better-auth/better-auth/main/README.md");
			if (baReadmeRes.ok) {
				const content = await baReadmeRes.text();
				const frontmatter = `---
title: "Better Auth Overview"
description: "Documentation de base de Better Auth."
scope: ["better-auth", "auth", "ref"]
status: "stable"
---

`;
				await writeFile(join(REFERENCE_DIR, "better-auth-readme.md"), frontmatter + content);
				console.log("[Crawl External Docs] Fichier better-auth-readme.md enregistré.");
			}
		} catch (err) {
			console.warn("[Crawl External Docs] Failed to fetch Better Auth README:", err);
		}

		// 4. Fetch Better Auth Session Management
		try {
			console.log("[Crawl External Docs] Fetching Better Auth Session Management...");
			const baSessionRes = await fetch("https://raw.githubusercontent.com/better-auth/better-auth/main/docs/content/docs/concepts/session-management.mdx");
			if (baSessionRes.ok) {
				const content = await baSessionRes.text();
				const frontmatter = `---
title: "Better Auth Session Management"
description: "Concepts de gestion de session dans Better Auth."
scope: ["better-auth", "auth", "session"]
status: "stable"
---

`;
				await writeFile(join(REFERENCE_DIR, "better-auth-session.md"), frontmatter + content);
				console.log("[Crawl External Docs] Fichier better-auth-session.md enregistré.");
			}
		} catch (err) {
			console.warn("[Crawl External Docs] Failed to fetch Better Auth Session:", err);
		}

		// 5. Fetch Inazuma Index README
		try {
			console.log("[Crawl External Docs] Fetching Inazuma Index README...");
			const indexRes = await fetch("https://raw.githubusercontent.com/realt0w/inazuma-index/main/README.md");
			if (indexRes.ok) {
				const content = await indexRes.text();
				const frontmatter = `---
title: "Inazuma Index"
description: "Index communautaire des statistiques et techniques Inazuma Eleven."
scope: ["inazuma-eleven", "wiki", "index", "ref"]
status: "stable"
---

`;
				await writeFile(join(REFERENCE_DIR, "inazuma-index-readme.md"), frontmatter + content);
				console.log("[Crawl External Docs] Fichier inazuma-index-readme.md enregistré.");
			}
		} catch (err) {
			console.warn("[Crawl External Docs] Failed to fetch Inazuma Index README:", err);
		}

		// 6. Fetch Secteur V README
		try {
			console.log("[Crawl External Docs] Fetching Secteur V README...");
			const secteurRes = await fetch("https://raw.githubusercontent.com/killian1307/secteur-v/main/README.md");
			if (secteurRes.ok) {
				const content = await secteurRes.text();
				const frontmatter = `---
title: "Secteur V E-Sport"
description: "Présentation de la plateforme compétitive Secteur V ELO."
scope: ["inazuma-eleven", "esport", "secteur-v", "ref"]
status: "stable"
---

`;
				await writeFile(join(REFERENCE_DIR, "secteur-v-readme.md"), frontmatter + content);
				console.log("[Crawl External Docs] Fichier secteur-v-readme.md enregistré.");
			}
		} catch (err) {
			console.warn("[Crawl External Docs] Failed to fetch Secteur V README:", err);
		}


		// 8. Fetch Turborepo README
		try {
			console.log("[Crawl External Docs] Fetching Turborepo README...");
			const turboRes = await fetch("https://raw.githubusercontent.com/vercel/turborepo/main/README.md");
			if (turboRes.ok) {
				const content = await turboRes.text();
				const frontmatter = `---
title: "Turborepo Reference"
description: "Présentation et usage de Turborepo pour la gestion de monorepos."
scope: ["turborepo", "monorepo", "ref"]
status: "stable"
---

`;
				await writeFile(join(REFERENCE_DIR, "turborepo-readme.md"), frontmatter + content);
				console.log("[Crawl External Docs] Fichier turborepo-readme.md enregistré.");
			}
		} catch (err) {
			console.warn("[Crawl External Docs] Failed to fetch Turborepo README:", err);
		}

		// 9. Fetch Discord.js README
		try {
			console.log("[Crawl External Docs] Fetching Discord.js README...");
			const discordJsRes = await fetch("https://raw.githubusercontent.com/discordjs/discord.js/main/README.md");
			if (discordJsRes.ok) {
				const content = await discordJsRes.text();
				const frontmatter = `---
title: "Discord.js Reference"
description: "Documentation de base de Discord.js pour le développement de bots Discord."
scope: ["discord", "bot", "ref"]
status: "stable"
---

`;
				await writeFile(join(REFERENCE_DIR, "discordjs-readme.md"), frontmatter + content);
				console.log("[Crawl External Docs] Fichier discordjs-readme.md enregistré.");
			}
		} catch (err) {
			console.warn("[Crawl External Docs] Failed to fetch Discord.js README:", err);
		}

		return { success: true };
	} catch (err: any) {
		console.error("[Crawl External Docs] Échec du crawling externe :", err);
		return { success: false, error: err.message || String(err) };
	}
}
