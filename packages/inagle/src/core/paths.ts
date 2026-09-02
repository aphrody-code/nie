/**
 * @file paths.ts
 * @description Central path configuration for all game data sources
 */

import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Sync existence check sans node:fs — Bun.Glob.scanSync sert de stat shim. */
function existsSync(p: string): boolean {
	try {
		const gen = new Bun.Glob(basename(p)).scanSync({
			cwd: dirname(p),
			onlyFiles: false,
		});
		return !gen.next().done;
	} catch {
		return false;
	}
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, "../..");

/**
 * Resolve valid data root
 */
function resolveDataRoot(): string {
	// 1. Try environment variable
	if (process.env.DATA_PATH) {
		return resolve(process.env.DATA_PATH);
	}

	// 2. Try local package data (packages/inagle/data) — primary location since data/ move
	const localData = resolve(PACKAGE_ROOT, "data");
	if (existsSync(localData) && existsSync(join(localData, "common"))) {
		return localData;
	}

	// 4. Fallback to cwd/data (used by Next.js and scripts)
	const cwdData = resolve(process.cwd(), "data");
	if (existsSync(cwdData) && existsSync(join(cwdData, "common"))) {
		return cwdData;
	}

	// 5. Ultimate fallback
	return cwdData;
}

export const CDN_URL = process.env.NEXT_PUBLIC_ASSET_URL || "https://azalee.rosegriffon.fr";

/**
 * Data paths relative to dump/data folder
 * Can be overridden by DATA_PATH environment variable (useful for Docker)
 */
export const DATA_ROOT = resolveDataRoot();

export const PATHS = {
	/** Root data folder */
	root: DATA_ROOT,

	/** Pre-processed JSON files for quick access */
	allGamedata: existsSync(join(DATA_ROOT, "all-gamedata"))
		? join(DATA_ROOT, "all-gamedata")
		: join(DATA_ROOT, "entities", "all-gamedata"),

	/** Raw config files from game */
	common: join(DATA_ROOT, "common"),
	gamedata: join(DATA_ROOT, "common/gamedata"),

	/** Character-related config files */
	character: join(DATA_ROOT, "common/gamedata/character"),

	/** Skill-related config files */
	skill: join(DATA_ROOT, "common/gamedata/skill"),

	/** Team-related config files */
	team: join(DATA_ROOT, "common/gamedata/team"),

	/** Formation data */
	formation: join(DATA_ROOT, "common/gamedata/formation"),

	/** Item data */
	item: join(DATA_ROOT, "common/gamedata/item"),

	/** Players Universe data */
	playersUniverse: join(DATA_ROOT, "common/gamedata/players_universe"),

	/** Quest data */
	quest: join(DATA_ROOT, "common/gamedata/quest"),

	/** Soccer battle data */
	soccer: join(DATA_ROOT, "common/gamedata/soccer"),

	/** Localized text files */
	textRoot: join(DATA_ROOT, "common/text"),

	/** Decompiled Lua scripts */
	lua: join(DATA_ROOT, "lua-decompiled"),
	luaScripts: join(DATA_ROOT, "lua-decompiled/lua-scripts"),
	luaCommon: join(DATA_ROOT, "lua-decompiled/common"),

	/** Pre-extracted entities (legacy) */
	entities: join(DATA_ROOT, "entities"),

	/** Image assets */
	images: join(DATA_ROOT, "images"),

	/** Gallery data */
	gallery: join(DATA_ROOT, "common/gamedata/gallery"),

	/** Dictionary data */
	dictionary: join(DATA_ROOT, "common/gamedata/dictionary"),

	/** Extended story data */
	extendStory: join(DATA_ROOT, "common/gamedata/extend_story"),

	/** Capsule (gacha) data */
	capsule: join(DATA_ROOT, "common/gamedata/capsule"),

	/** NFC lottery data */
	nfc: join(DATA_ROOT, "common/gamedata/nfc"),

	/** Inacode (social/stamps) data */
	inacode: join(DATA_ROOT, "common/gamedata/inacode"),

	/** Party config data */
	party: join(DATA_ROOT, "common/gamedata/party"),

	/** Boost group data */
	boostGrp: join(DATA_ROOT, "common/gamedata/boost_grp"),
} as const;

/**
 * Key game data files
 */
export const FILES = {
	// Character files
	charaBase: "chara_base_1.03.98.00.cfg.bin.json",
	charaParam: "chara_param_1.03.66.00.cfg.bin.json",
	charaDetails: "chara_details_config_0.00.00.00.cfg.bin.json",
	charaText: "chara_text.cfg.bin.json",
	charaTextRoma: "chara_text_roma.cfg.bin.json",
	charaDescFr: "chara_description_text.cfg.bin.json",
	basaraConfig: "basara_chara_config_0.00.00.00.cfg.bin.json",

	// Skill files (v4 = base, v5 = DLC Orion supplement)
	skillBase: "skill_base_1.03.95.00.cfg.bin.json",
	skillText: "skill_text.cfg.bin.json",
	skillConfigV4: "skill_config_4.00.17.00.cfg.bin.json",
	skillConfigV5: "skill_config_5.00.07.00.cfg.bin.json",
	passiveSkillConfigV5: "passive_skill_config_5.00.07.00.cfg.bin.json",
	passiveSkillRarityTable: "passive_skill_rarity_table_config_4.00.14.00.cfg.bin.json",
	overrideSkillConfig: "override_skill_config_3.00.21.00.cfg.bin.json",
	teamBuildConfig: "team_build_config_5.00.23.cfg.bin.json",
	specialTacticsConfig: "special_tactics_config_1.04.09.10.cfg.bin.json",
	auraSkillConfig: "aura_skill_config_1.04.09.00.cfg.bin.json",

	// Team files
	teamConfig: "team_config.cfg.bin.json",
	teamConfigVersioned: "team_config_1.04.06.00.cfg.bin.json",

	// VS Route files (v5 = DLC Orion)
	chronicleVsRouteV5: "chronicle_vs_route_config_5.00.30.cfg.bin.json",

	// Scene Archive (DLC Orion)
	sceneArchiveConfig: "scene_archive_config_4.00.18.00.cfg.bin.json",

	// Players Universe
	playersUniverseConfig: "players_universe_config_1.03.59.00.cfg.bin.json",

	// Lua scripts
	progBase: "prog_base_0.00.00.00.lua",
	progCommon: "prog_common_1.04.32.00.lua",

	// Character (extended)
	charaExpTable: "chara_exp_table_config_0.00.00.00.cfg.bin.json",
	growthTableConfig: "growth_table_config_0.00.00.00.cfg.bin.json",
	charaCostume: "chara_costume_1.02.28.00.cfg.bin.json",
	uniformConfig: "uniform_config_1.03.52.00.cfg.bin.json",

	// Skill (extended)
	skillTechnicConfig: "skill_technic_config_1.01.34.00.cfg.bin.json",
	realSkillConfig: "real_skill_config_1.03.74.00.cfg.bin.json",
	changeAuraSkillConfig: "change_aura_skill_config_1.01.73.00.cfg.bin.json",
	trickConfig: "trick_config.cfg.bin.json",
	passiveSkillEffectConfig: "passive_skill_effect_config.cfg.bin.json",
	superTacticsBaseConfig: "super_tactics_config_0.08.86.cfg.bin.json",

	// Team (extended)
	opponentTeamConfig: "opponent_team_config_1.03.05.00.cfg.bin.json",
	enjoyModeTeamConfig: "enjoy_mode_team_config_1.04.02.00.cfg.bin.json",

	// Other configs
	galleryConfig: "gallery_config_1.03.71.00.cfg.bin.json",
	dictionaryConfig: "dictionary_config_0.00.00.cfg.bin.json",
	extendStoryConfig: "extend_story_data_config_0.00.02.00.cfg.bin.json",
	capsuleConfig: "capsule_config_0.00.00.cfg.bin.json",
	nfcLotteryConfig: "nfc_lottery_config.cfg.bin.json",
	inacodeConfig: "inacode_config_1.01.57.00.cfg.bin.json",
	ctrlCharaConfig: "ctrl_chara_config_1.04.17.00.cfg.bin.json",
	boostPlayerGroupConfig: "boost_player_group_config_0.00.00.cfg.bin.json",
} as const;

export type DataPath = keyof typeof PATHS;
export type DataFile = keyof typeof FILES;

/**
 * Compare deux noms de fichiers versionnés du dump et renvoie celui dont le
 * segment `_X.Y.Z.W` est le plus élevé (tri numérique segment par segment).
 *
 * Les noms de fichiers cfg.bin du jeu embarquent la version qui les a produits
 * (ex. `aura_skill_config_1.04.09.00.cfg.bin.json`). Un patch du jeu fait
 * grimper cette version → on doit toujours sélectionner la plus haute, sans
 * supposer un padding constant des segments.
 */
function versionSegments(filename: string): number[] {
	// Capture le dernier groupe `_<chiffres séparés par des points>` avant l'extension
	const m = filename.match(/_(\d+(?:\.\d+)*)\.cfg\.bin/);
	if (!m) return [];
	return m[1].split(".").map((s) => Number.parseInt(s, 10));
}

/** Tri numérique de versions (segment par segment), -1 / 0 / 1. */
function compareVersions(a: string, b: string): number {
	const va = versionSegments(a);
	const vb = versionSegments(b);
	const len = Math.max(va.length, vb.length);
	for (let i = 0; i < len; i++) {
		const da = va[i] ?? 0;
		const db = vb[i] ?? 0;
		if (da !== db) return da < db ? -1 : 1;
	}
	return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Résout un fichier de game data version-agnostique.
 *
 * Globbe `<DATA_ROOT>/<relDir>/<baseName>_*.cfg.bin.json` et renvoie le chemin
 * absolu de la version la plus haute. Tolère les futures mises à jour du jeu
 * qui changent le segment de version dans le nom de fichier.
 *
 * @param relDir   Sous-dossier sous `common/gamedata` (ex. "skill", "character/party").
 * @param baseName Préfixe sans version ni extension (ex. "aura_skill_config").
 * @returns Chemin absolu du fichier, ou `null` si aucun fichier trouvé.
 */
export function resolveGameDataFile(relDir: string, baseName: string): string | null {
	const dir = join(PATHS.gamedata, relDir);
	// N'accepte que `<baseName>_<version numérique>.cfg.bin.json` afin d'éviter les
	// collisions de préfixe (ex. "chara_param" ne doit PAS capter
	// "chara_param_table_config"). Le segment suivant `_` doit commencer par un chiffre.
	const versionedRe = new RegExp(`^${baseName}_\\d[\\d.]*\\.cfg\\.bin\\.json$`);
	try {
		const matches = [
			...new Bun.Glob(`${baseName}_*.cfg.bin.json`).scanSync({
				cwd: dir,
				onlyFiles: true,
			}),
		].filter((f) => versionedRe.test(f));
		if (matches.length > 0) {
			matches.sort(compareVersions);
			return join(dir, matches[matches.length - 1]);
		}
	} catch {
		// dossier absent → on tente le repli exact ci-dessous
	}

	// Repli : nom exact sans segment de version (certains fichiers n'en ont pas)
	const exact = join(dir, `${baseName}.cfg.bin.json`);
	if (existsSync(exact)) return exact;

	return null;
}
