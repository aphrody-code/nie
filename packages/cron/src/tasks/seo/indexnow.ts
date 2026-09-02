/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tâche SEO : soumission des URLs des sitemaps au protocole IndexNow.
 *
 * IndexNow (https://www.indexnow.org) est un protocole ouvert poussant les URLs
 * mises à jour aux moteurs participants (Bing, Yandex, Seznam, Naver…). La clé
 * est publique PAR DESIGN : un fichier `<clé>.txt` contenant la clé doit être
 * servi à la racine de chaque domaine pour prouver la propriété. Ce n'est donc
 * PAS un secret — voir apps/website/public/<clé>.txt et apps/azalee/public/<clé>.txt.
 *
 * Ce qui est garanti : la soumission est acceptée (HTTP 200/202) et relayée aux
 * moteurs IndexNow. Ce qui ne l'est PAS : l'indexation effective reste à la
 * discrétion de chaque moteur. Google ne participe pas à IndexNow.
 */

// Clé IndexNow publique (fallback si INDEXNOW_KEY absent de l'env). Doit matcher
// le fichier <clé>.txt servi par chaque site.
export const INDEXNOW_KEY_FALLBACK = "fd6605d39faf4ed0bef411e08138ed59";

export function getIndexNowKey(): string {
	return process.env.INDEXNOW_KEY || INDEXNOW_KEY_FALLBACK;
}

interface SiteTarget {
	name: string;
	host: string; // host nu, sans schéma
	sitemapUrl: string;
}

const SITES: SiteTarget[] = [
	{
		name: "website",
		host: "rosegriffon.fr",
		sitemapUrl: "https://rosegriffon.fr/sitemap.xml",
	},
	{
		name: "azalee",
		host: "azalee.rosegriffon.fr",
		sitemapUrl: "https://azalee.rosegriffon.fr/sitemap.xml",
	},
];

// IndexNow recommande de ne pas soumettre plus de 10 000 URLs par requête.
// On plafonne raisonnablement pour éviter tout abus / risque de bannissement.
const MAX_URLS_PER_SITE = 5000;

// Taille de lot par requête. Les gros envois (plusieurs milliers d'URLs en une
// seule requête) sont rejetés par l'endpoint (HTTP 403/422), alors qu'un lot
// modéré passe (HTTP 200/202). On découpe donc en lots de 100, conformément aux
// bonnes pratiques IndexNow, avec une courte pause entre lots.
const BATCH_SIZE = 100;
const BATCH_DELAY_MS = 500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Récupère toutes les URLs `<loc>` d'un sitemap XML (gère les sitemap index
 * imbriqués en suivant un niveau de profondeur).
 */
async function fetchSitemapUrls(sitemapUrl: string, depth = 0): Promise<string[]> {
	try {
		const res = await fetch(sitemapUrl, {
			headers: { "User-Agent": "Rose-Griffon-Cron-IndexNow" },
		});
		if (!res.ok) {
			console.error(`[SEO IndexNow] Sitemap ${sitemapUrl} a renvoyé HTTP ${res.status}`);
			return [];
		}
		const xml = await res.text();
		const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)]
			.map((m) => (m[1] ?? "").replace(/&amp;/g, "&").trim())
			.filter((u) => u.length > 0);

		// Sitemap index : les <loc> pointent vers d'autres sitemaps.
		const isIndex = /<sitemapindex/i.test(xml);
		if (isIndex && depth < 1) {
			const nested = await Promise.all(locs.map((loc) => fetchSitemapUrls(loc, depth + 1)));
			return nested.flat();
		}
		return locs;
	} catch (err: any) {
		console.error(`[SEO IndexNow] Échec de récupération du sitemap ${sitemapUrl} :`, err.message || err);
		return [];
	}
}

/**
 * Soumet un lot d'URLs à l'endpoint IndexNow pour un host donné.
 */
async function submitToIndexNow(
	site: SiteTarget,
	urls: string[],
	key: string
): Promise<{ status: number; ok: boolean }> {
	const endpoint = "https://api.indexnow.org/indexnow";
	const body = {
		host: site.host,
		key,
		keyLocation: `https://${site.host}/${key}.txt`,
		urlList: urls,
	};

	const res = await fetch(endpoint, {
		method: "POST",
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			"User-Agent": "Rose-Griffon-Cron-IndexNow",
		},
		body: JSON.stringify(body),
	});

	// IndexNow : 200 = OK, 202 = accepté (validation de la clé en attente).
	return { status: res.status, ok: res.status === 200 || res.status === 202 };
}

export async function runSeoIndexNow(): Promise<{ success: boolean; error?: string }> {
	const key = getIndexNowKey();
	console.log(`[SEO IndexNow] Démarrage de la soumission IndexNow (clé : ${key.slice(0, 8)}…).`);

	let anyFailure = false;
	const summary: string[] = [];

	for (const site of SITES) {
		const urls = await fetchSitemapUrls(site.sitemapUrl);
		if (urls.length === 0) {
			console.warn(`[SEO IndexNow] Aucune URL trouvée pour ${site.name} (${site.sitemapUrl}).`);
			summary.push(`${site.name}: 0 URL`);
			continue;
		}

		const capped = urls.slice(0, MAX_URLS_PER_SITE);
		// Découpage en lots : les très gros envois en une requête sont rejetés (403).
		const batches: string[][] = [];
		for (let i = 0; i < capped.length; i += BATCH_SIZE) {
			batches.push(capped.slice(i, i + BATCH_SIZE));
		}

		let okBatches = 0;
		const statuses: number[] = [];
		try {
			for (let b = 0; b < batches.length; b++) {
				const { status, ok } = await submitToIndexNow(site, batches[b]!, key);
				statuses.push(status);
				if (ok) okBatches++;
				if (b < batches.length - 1) await sleep(BATCH_DELAY_MS);
			}
			const lastStatus = statuses[statuses.length - 1] ?? 0;
			const allOk = okBatches === batches.length;
			console.log(
				`[SEO IndexNow] ${site.name} : ${capped.length} URLs en ${batches.length} lot(s), ${okBatches}/${batches.length} OK (dernier HTTP ${lastStatus}).`
			);
			summary.push(`${site.name}: ${capped.length} URLs, ${okBatches}/${batches.length} lots OK (HTTP ${lastStatus})`);
			if (!allOk) anyFailure = true;
		} catch (err: any) {
			console.error(`[SEO IndexNow] Erreur de soumission pour ${site.name} :`, err.message || err);
			summary.push(`${site.name}: ERREUR ${err.message || err}`);
			anyFailure = true;
		}
	}

	console.log(`[SEO IndexNow] Terminé. Résumé : ${summary.join(" | ")}`);
	return anyFailure
		? { success: false, error: `Au moins une soumission a échoué : ${summary.join(" | ")}` }
		: { success: true };
}
