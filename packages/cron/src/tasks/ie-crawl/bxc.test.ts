/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tests d'INTÉGRATION du moteur bxc et de la pile réseau utilisée par les
 * tâches de crawl (`level5.ts`, `news.ts`, `cross.ts`, `re.ts`, `x-radar.ts`).
 *
 * Ces tests sortent réellement sur Internet : c'est le but (un moteur de
 * scraping qui ne parle qu'à des maquettes ne prouve rien). Ils ne doivent en
 * revanche JAMAIS échouer « au hasard » sur une machine sans réseau : une sonde
 * unique est exécutée au chargement du fichier et, si elle échoue, toute la
 * suite est SAUTÉE (`describe.skipIf`) au lieu de tomber en erreur.
 *
 * Rappel : `bunfig.toml` précharge `happydom.ts` pour tous les tests. Ce
 * préchargement rend explicitement à Bun ses primitives réseau natives, sans
 * quoi la politique du même origine de happy-dom bloquerait tout `fetch`
 * transverse ici.
 */

import { beforeAll, describe, expect, it } from "bun:test";
import { Browser, Page } from "@aphrody-code/bxc";

/** Profil bxc utilisé par les tests, alignable via `BXC_PROFILE`. */
type ProfilBxc = "stealth" | "max" | "static" | "fast" | "http";

const PROFIL_PAR_DEFAUT: ProfilBxc = "max";

/** Délai maximal accordé à la sonde de connectivité. */
const SONDE_TIMEOUT_MS = 8000;

/**
 * Sonde de connectivité : une requête HEAD sur un hôte stable. On la fait une
 * seule fois, au chargement du module, pour décider si la suite s'exécute.
 * Toute erreur (DNS, TLS, coupure, proxy) vaut « hors ligne ».
 */
async function reseauJoignable(): Promise<boolean> {
	try {
		const reponse = await fetch("https://example.com", {
			method: "HEAD",
			signal: AbortSignal.timeout(SONDE_TIMEOUT_MS),
		});
		return reponse.ok;
	} catch {
		return false;
	}
}

const enLigne = await reseauJoignable();
if (!enLigne) {
	console.warn(
		"[Test BXC] Réseau injoignable — suite d'intégration sautée (aucun échec attendu hors ligne)."
	);
}

/** Récupère le contenu d'une URL et referme la page quoi qu'il arrive. */
async function avecPage<T>(profil: ProfilBxc, action: (page: Page) => Promise<T>): Promise<T> {
	const page = (await Browser.newPage({ profile: profil })) as Page;
	try {
		return await action(page);
	} finally {
		await page.close().catch(() => undefined);
	}
}

describe.skipIf(!enLigne)("Intégration du moteur BXC", () => {
	let profil: ProfilBxc = PROFIL_PAR_DEFAUT;

	beforeAll(() => {
		profil = (process.env.BXC_PROFILE as ProfilBxc | undefined) ?? PROFIL_PAR_DEFAUT;
	});

	it(
		"démarre le navigateur et lit le contenu rendu de example.com",
		async () => {
			const { contenu, titre } = await avecPage(profil, async (page) => {
				await page.goto("https://example.com");
				await page.waitForSelector("h1", 10_000).catch(() => undefined);
				return {
					contenu: (await page.content()) as string,
					titre: (await page.evaluate(
						() => (globalThis as unknown as { document: { title: string } }).document.title
					)) as string,
				};
			});

			expect(contenu).toContain("Example Domain");
			expect(titre).toBe("Example Domain");
		},
		60_000
	);

	it(
		"atteint l'index des topics Inazuma Eleven: Victory Road",
		async () => {
			const contenu = await avecPage(profil, async (page) => {
				await page.goto("https://www.inazuma.jp/victory-road/topics/");
				await page.waitForSelector("body", 15_000).catch(() => undefined);
				return (await page.content()) as string;
			});

			expect(contenu).toContain("victory-road");
		},
		60_000
	);

	it(
		"lit une source Markdown brute sur raw.githubusercontent.com",
		async () => {
			const reponse = await fetch(
				"https://raw.githubusercontent.com/mundimark/awesome-markdown/master/README.md",
				{ signal: AbortSignal.timeout(15_000) }
			);
			expect(reponse.status).toBe(200);
			expect(await reponse.text()).toContain("Awesome Markdown");
		},
		20_000
	);

	it(
		"lit la documentation Markdown de Bun à sa source",
		async () => {
			const reponse = await fetch(
				"https://raw.githubusercontent.com/oven-sh/bun/main/docs/runtime/markdown.mdx",
				{ signal: AbortSignal.timeout(15_000) }
			);
			expect(reponse.status).toBe(200);
			expect(await reponse.text()).toContain("Bun.markdown");
		},
		20_000
	);
});
