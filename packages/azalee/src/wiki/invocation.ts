/**
 * Accès données pour la section « Invocation (Players Universe) » (route `/invocation`).
 *
 * Le VRAI taux d'invocation vit dans la gamedata `players_universe_config_*.cfg.bin`
 * (PAS en DB) — décodé LIVE en JSON par nie-model-serve via la route CDN `/cfg/`. Deux
 * listes RDBN portent les taux (vérifié sur le dump réel) :
 *  - `m_starSignInfoList` (30) : une entrée par constellation (`starSignNo` 1..30).
 *  - `m_starSignRarityRateInfoList` (90 = 30×3) : 3 paliers de rareté par constellation
 *    (`rarityType` 2/1/0, `rarityRateDefault`, `starSignCharaInfoList`=[offset,count]).
 *
 * Taux RÉEL = `rarityRateDefault / Σ` (la somme des 3 vaut 200 → 0,5 % / 9,5 % / 90 %) ;
 * taux par personnage = taux_palier / count. Le nom de la constellation vient de
 * `inagle_constellations` joint par `idx = starSignNo - 1` (validé : la taille du pool de
 * chaque étoile = `character_count` de la constellation correspondante — 190/157/188…).
 *
 * Anti-hallucination : aucune valeur inventée. Si le décodage CDN échoue, on renvoie `[]`.
 */

import { createClient } from "../db/provider";
import { fetchJson } from "../net";
import type { InvocationSign, InvocationTier } from "./invocation-shared";
import { rarityLabel } from "./invocation-shared";

export type { InvocationSign, InvocationTier } from "./invocation-shared";
export { rarityLabel } from "./invocation-shared";

/** Chemin du config Players Universe (version courante du dump). */
const CONFIG_VFS_PATH =
	"data/common/gamedata/players_universe/players_universe_config_1.03.59.00.cfg.bin";
const CONFIG_CFG_URL = `https://cdn.rosegriffon.fr/cfg/${CONFIG_VFS_PATH}`;

interface RarityRateRow {
	rarityType: number;
	rarityRateDefault: number;
	starSignCharaInfoList: number[];
}
interface SignRow {
	starSignNo: number;
}

/** Décode les taux d'invocation et les joint aux noms de constellations. */
export async function getInvocationRates(): Promise<InvocationSign[]> {
	const cfg = await fetchJson<{ lists?: Array<{ name: string; rows: unknown[] }> }>(
		CONFIG_CFG_URL,
		{ revalidate: 86400 },
	);
	if (!cfg) return [];

	const lists = cfg.lists ?? [];
	const signs = (lists.find((l) => l.name === "m_starSignInfoList")?.rows ?? []) as SignRow[];
	const rates = (lists.find((l) => l.name === "m_starSignRarityRateInfoList")?.rows ??
		[]) as RarityRateRow[];
	if (signs.length === 0 || rates.length < signs.length * 3) return [];

	// Noms des constellations (idx = signNo - 1).
	const byIdx = new Map<number, { name_fr: string; character_count: number }>();
	try {
		const supabase = await createClient();
		const { data } = await supabase
			.from("inagle_constellations")
			.select("idx,name_fr,character_count");
		for (const c of (data ?? []) as Array<{
			idx: number;
			name_fr: string;
			character_count: number;
		}>) {
			byIdx.set(c.idx, { name_fr: c.name_fr, character_count: c.character_count });
		}
	} catch {
		// noms indisponibles → repli « Constellation N »
	}

	const out: InvocationSign[] = [];
	for (let i = 0; i < signs.length; i++) {
		const signNo = signs[i]?.starSignNo ?? i + 1;
		const trio = rates.slice(i * 3, i * 3 + 3);
		const sum = trio.reduce((a, t) => a + (t.rarityRateDefault || 0), 0) || 1;
		const con = byIdx.get(signNo - 1);

		const tiers: InvocationTier[] = trio
			.map((t) => {
				const count = Array.isArray(t.starSignCharaInfoList)
					? (t.starSignCharaInfoList[1] ?? 0)
					: 0;
				const ratePct = (t.rarityRateDefault / sum) * 100;
				return {
					rarityType: t.rarityType,
					label: rarityLabel(t.rarityType),
					ratePct,
					count,
					perCharPct: count > 0 ? ratePct / count : 0,
				};
			})
			.sort((a, b) => b.rarityType - a.rarityType);

		out.push({
			signNo,
			name: con?.name_fr ?? `Constellation ${signNo}`,
			totalChars: con?.character_count ?? tiers.reduce((a, t) => a + t.count, 0),
			tiers,
		});
	}
	out.sort((a, b) => a.signNo - b.signNo);
	return out;
}
