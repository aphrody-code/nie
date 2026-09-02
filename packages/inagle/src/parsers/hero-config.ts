/**
 * @file hero-config.ts
 * @description Parser for soccer_chara_unique_rarity_config
 *
 * Extracts hero variant availability (Fire/Black/Pink) per character.
 * Source: soccer_chara_unique_rarity_config (m_soccerCharaUniqueRarityList)
 *
 * Each entry maps a base charaId to its hero variant charaParamIds:
 *   - HeroFire  (火ヒーロー)
 *   - HeroBlack (黒ヒーロー)
 *   - HeroPink  (桃ヒーロー)
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PATHS } from "../core/paths.js";

export interface HeroVariantInfo {
	charaId: string;
	hasFire: boolean;
	fireParamId?: string;
	hasBlack: boolean;
	blackParamId?: string;
	hasPink: boolean;
	pinkParamId?: string;
}

let heroConfigCache: {
	byCharaId: Map<string, HeroVariantInfo>;
	byParamId: Map<string, "fire" | "black" | "pink">;
} | null = null;

/**
 * Find the soccer_chara_unique_rarity_config file
 */
function findHeroConfigFile(): string | null {
	const soccerDir = PATHS.soccer;
	if (!existsSync(soccerDir)) return null;

	const files = readdirSync(soccerDir);
	const configFile = files
		.filter((f) => f.startsWith("soccer_chara_unique_rarity_config") && f.endsWith(".cfg.bin.json"))
		.sort()
		.pop();

	return configFile ? join(soccerDir, configFile) : null;
}

/**
 * Load and parse the hero config.
 *
 * Returns two maps:
 * - byCharaId: base character ID → hero variant info
 * - byParamId: hero param ID → hero type ("fire" | "black" | "pink")
 */
export function loadHeroConfig() {
	if (heroConfigCache) return heroConfigCache;

	const byCharaId = new Map<string, HeroVariantInfo>();
	const byParamId = new Map<string, "fire" | "black" | "pink">();

	const filePath = findHeroConfigFile();
	if (!filePath) {
		console.warn("[hero-config] Config file not found in", PATHS.soccer);
		heroConfigCache = { byCharaId, byParamId };
		return heroConfigCache;
	}

	try {
		const data = JSON.parse(readFileSync(filePath, "utf-8"));
		const list = data.lists?.find(
			(l: { name: string }) => l.name === "m_soccerCharaUniqueRarityList"
		);

		if (!list?.values) {
			console.warn("[hero-config] No values found in config");
			heroConfigCache = { byCharaId, byParamId };
			return heroConfigCache;
		}

		for (const entry of list.values) {
			const info: HeroVariantInfo = {
				charaId: entry.charaId,
				hasFire: entry.isHeroFire === true,
				hasBlack: entry.isHeroBlack === true,
				hasPink: entry.isHeroPink === true,
			};

			const NULL_ID = "0x00000000";

			if (info.hasFire && entry.charaParamIdHeroFire !== NULL_ID) {
				info.fireParamId = entry.charaParamIdHeroFire;
				byParamId.set(entry.charaParamIdHeroFire, "fire");
			}
			if (info.hasBlack && entry.charaParamIdHeroBlack !== NULL_ID) {
				info.blackParamId = entry.charaParamIdHeroBlack;
				byParamId.set(entry.charaParamIdHeroBlack, "black");
			}
			if (info.hasPink && entry.charaParamIdHeroPink !== NULL_ID) {
				info.pinkParamId = entry.charaParamIdHeroPink;
				byParamId.set(entry.charaParamIdHeroPink, "pink");
			}

			byCharaId.set(entry.charaId, info);
		}

		console.log(
			`[hero-config] Loaded ${byCharaId.size} base characters, ${byParamId.size} hero variants`
		);
	} catch (e) {
		console.error("[hero-config] Failed to parse config:", e);
	}

	heroConfigCache = { byCharaId, byParamId };
	return heroConfigCache;
}

/**
 * Get the hero type for a specific charaParamId.
 * Returns "fire", "black", "pink", or undefined if not a hero variant.
 */
export function getHeroType(charaParamId: string): "fire" | "black" | "pink" | undefined {
	return loadHeroConfig().byParamId.get(charaParamId);
}

/**
 * Get hero variant info for a base character.
 */
export function getHeroVariants(charaId: string): HeroVariantInfo | undefined {
	return loadHeroConfig().byCharaId.get(charaId);
}
