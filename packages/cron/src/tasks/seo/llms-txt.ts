/**
 * Generate LLM discovery files for the optional external editorial site.
 *
 * `nie-site` is the sole owner of the game-data site and generates its own documents. This task
 * deliberately has no legacy wiki target: running cron must not recreate removed legacy files.
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { depotRoseGriffon } from "../../lib/racine";

const RG = depotRoseGriffon();
const WEBSITE_PUBLIC = RG ? join(RG, "apps", "website", "public") : null;

function today(): string {
	return new Date().toISOString().slice(0, 10);
}

function websiteIndex(): string {
	return `# Rose Griffon

> French Inazuma Eleven community association.

Site: https://rosegriffon.fr
Generated: ${today()}

## Pages

- [Home](https://rosegriffon.fr/)
- [Team](https://rosegriffon.fr/notre-equipe)
- [About](https://rosegriffon.fr/a-propos)
- [Projects](https://rosegriffon.fr/projets)
- [Events](https://rosegriffon.fr/evenements)
- [News](https://rosegriffon.fr/chroniques)
- [Support](https://rosegriffon.fr/nous-soutenir)
`;
}

export async function runSeoLlmsTxt(): Promise<{ success: boolean; error?: string }> {
	if (!WEBSITE_PUBLIC) {
		return { success: true };
	}

	try {
		const content = websiteIndex();
		for (const name of ["llms.txt", "llm.txt", "llms.md", "llm.md"]) {
			await writeFile(join(WEBSITE_PUBLIC, name), content, "utf8");
		}
		return { success: true };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { success: false, error: message };
	}
}
