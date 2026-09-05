/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

import { createSupabaseServiceClient, cache } from "@rosegriffon/db";
import { buildOrderMap, crawlZukanOrderPages } from "@rosegriffon/inagle/zukan/order";
import { sql } from "../../lib/db.js";

// Le scraper d'ordre (navigation bxc + parsing cheerio des pages chara_param) est
// désormais unifié dans `@rosegriffon/inagle/zukan/order` (leaf, hors barrel car
// il tire @aphrody-code/bxc). Ce fichier ne garde que l'orchestration prod :
// diff Redis + écriture `zukan_order` sur Supabase. Comportement identique.

/** @deprecated Réexport de compatibilité — type unifié dans le module order. */
export type { ZukanOrderCharacter as ZukanCharacter } from "@rosegriffon/inagle/zukan/order";

export async function crawlZukanOrder(): Promise<{
	success: boolean;
	count: number;
	error?: string;
}> {
	console.log("[Crawl Zukan] Démarrage du crawl de l'ordre officiel des personnages...");

	const client = createSupabaseServiceClient();

	try {
		// Lue AVANT le crawl (indépendante de son résultat), et réellement `await`ée
		// ici (un tag `sql\`…\`` est un thenable paresseux chez Bun.SQL, il ne part
		// sur le fil qu'au premier `await` — le stocker dans une promesse sans
		// l'attendre ne l'exécute PAS plus tôt). Le crawl navigue ~30 pages en
		// headless (plusieurs minutes) via un Chrome enfant ; lancé APRÈS cette
		// lecture, il ne peut plus lui faire perdre sa connexion Postgres directe
		// (`ERR_POSTGRES_CONNECTION_CLOSED` constaté le 1/9/2026 quand la requête
		// n'était exécutée qu'après le crawl).
		const dbChars = await sql<
			{ id: string; zukan_hash: string | null; name_en: string | null }[]
		>`SELECT id, zukan_hash, name_en FROM inagle_characters`;

		const allCharacters = await crawlZukanOrderPages();

		if (allCharacters.length === 0) {
			return { success: true, count: 0 };
		}

		console.log(
			`[Crawl Zukan] Fin du crawl. ${allCharacters.length} personnages trouvés. Vérification des changements via Redis...`
		);

		const orderMapObj = buildOrderMap(allCharacters);
		// Groupe d'âge / année scolaire / surnom : mêmes cartes que l'ordre, mais leur
		// propre signature — sinon un ordre inchangé masquerait un age_group/nickname
		// corrigé sur zukan (ou simplement pas encore synchronisé, cf. déploiement du
		// 1/9/2026) puisque la comparaison ci-dessous décide SEULE si on écrit en base.
		const bioMapObj: Record<
			string,
			{
				a: string | null;
				s: string | null;
				n: string | null;
				g: string | null;
				r: string | null;
				d: string | null;
			}
		> = {};
		for (const c of allCharacters) {
			if (c.zukanHash) {
				bioMapObj[c.zukanHash] = {
					a: c.ageGroup,
					s: c.schoolYear,
					n: c.nickname,
					g: c.gender,
					r: c.characterRole,
					d: c.description,
				};
			}
		}
		const snapshot = { bio: bioMapObj, order: orderMapObj };

		const cacheKey = "crawl:zukan:orders";
		const cachedSnapshot = await cache.get<typeof snapshot>(cacheKey);

		const hasChanged =
			!cachedSnapshot || JSON.stringify(cachedSnapshot) !== JSON.stringify(snapshot);

		if (!hasChanged) {
			console.log(
				"[Crawl Zukan] L'ordre des personnages n'a pas changé par rapport au dernier crawl. Synchronisation sautée."
			);
			return { success: true, count: allCharacters.length };
		}

		console.log(
			"[Crawl Zukan] Des changements ont été détectés (ordre et/ou biographie). Mise à jour de Supabase..."
		);

		// Mise à jour de la table inagle_characters dans Supabase
		let updatedCount = 0;

		if (dbChars && dbChars.length > 0) {
			// Créer une map hash -> order
			const hashToOrder = new Map<string, number>();
			for (const key of Object.keys(orderMapObj)) {
				const val = orderMapObj[key];
				if (val !== undefined) {
					hashToOrder.set(key, val);
				}
			}

			// Un `null` de crawl ne doit jamais écraser une valeur déjà connue en base
			// (page de secours/erreur de rendu ponctuelle) : on n'envoie que du renseigné.
			for (const char of dbChars) {
				if (char.zukan_hash) {
					const order = hashToOrder.get(char.zukan_hash);
					const bio = bioMapObj[char.zukan_hash];
					const updatePayload: {
						zukan_order?: number;
						age_group?: string;
						school_year?: string;
						nickname?: string;
						gender?: string;
						description_en?: string;
					} = {};
					if (order !== undefined) updatePayload.zukan_order = order;
					if (bio?.a) updatePayload.age_group = bio.a;
					if (bio?.s) updatePayload.school_year = bio.s;
					if (bio?.n) updatePayload.nickname = bio.n;
					if (bio?.g) {
						const genderMap: Record<string, string> = {
							Male: "M",
							Female: "F",
							Unknown: "U",
							Neutral: "N",
						};
						if (genderMap[bio.g]) updatePayload.gender = genderMap[bio.g];
					}
					if (bio?.d) updatePayload.description_en = bio.d;

					if (Object.keys(updatePayload).length > 0) {
						const { error: updateError } = await client
							.from("inagle_characters")
							.update(updatePayload)
							.eq("id", char.id);

						if (updateError) {
							console.error(
								`[Crawl Zukan] Erreur de mise à jour pour ${char.name_en} :`,
								updateError.message
							);
						} else {
							updatedCount++;
						}
					}
				}
			}
		}

		// Sauvegarder le nouvel instantané (ordre + biographie) dans Redis
		await cache.set(cacheKey, snapshot, 86400 * 7); // Expiration de 7 jours

		console.log(
			`[Crawl Zukan] Base de données mise à jour. ${updatedCount} personnages synchronisés.`
		);
		return { success: true, count: allCharacters.length };
	} catch (err: any) {
		console.error("[Crawl Zukan] Erreur critique lors du crawl Zukan :", err);
		return { success: false, count: 0, error: err.message || String(err) };
	}
}
