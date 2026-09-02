/**
 * Character schemas based on actual JSON structure
 *
 * Source files:
 * - dump/data/common/gamedata/character/basara_chara_config_0.00.00.00.cfg.bin.json
 * - dump/data/common/gamedata/soccer/soccer_chara_unique_rarity_config_1.03.00.00.cfg.bin.json
 * - dump/data/common/text/{locale}/chara_text.cfg.bin.json
 */

/**
 * BASARA_BUILD_TYPE from m_basaraBuildTypeList
 * Defines build types available for BASARA (FABLED) rarity characters
 */
export interface BasaraBuildType {
	type: number; // Build type ID (0-5)
	boardId: string; // hex e.g. "0x8F8C55E6"
}

/**
 * SOCCER_CHARA_UNIQUE_RARITY from m_soccerCharaUniqueRarityList
 * Defines HERO variant availability for characters
 */
export interface SoccerCharaUniqueRarity {
	charaId: string; // hex - base character ID
	isHeroFire: boolean; // Has Fire HERO variant
	charaParamIdHeroFire: string; // hex - Fire HERO param ID
	isHeroBlack: boolean; // Has Black HERO variant
	charaParamIdHeroBlack: string; // hex - Black HERO param ID
	isHeroPink: boolean; // Has Pink HERO variant
	charaParamIdHeroPink: string; // hex - Pink HERO param ID
}

/**
 * Character name from NOUN_INFO in chara_text.cfg.bin.json
 *
 * Variables mapping:
 * - [0] hashId (Int) - CRC32 hash identifier
 * - [1] index (Int) - Name type (0=full, 11=surname, etc.)
 * - [5] name (String) - The actual name
 */
export interface CharacterName {
	hashId: number;
	nameType: number; // 0=full name, 11=surname only
	name: string;
}

/**
 * Character text info from TEXT_INFO entries
 */
export interface CharacterTextInfo {
	hashId: number;
	index: number;
	text: string;
}

/**
 * Character rarity codes from starSignCharaInfo (Players Universe gacha).
 *
 * Official names from game text:
 *   JA: ＮＯＲＭＡＬ / ＧＲＯＷＩＮＧ / ＡＤＶＡＮＣＥＤ / ＴＯＰ / ＬＥＧＥＮＤＡＲＹ / ＨＥＲＯ / ＢＡＳＡＲＡ
 *   EN: Common / Growing / Advanced / Top / Legendary / Hero / Fabled
 *   FR: Normal / En progression / Expérimenté / Émérite / Légendaire / Héros / BASARA
 */
export const Rarity = {
	Normal: 0,
	EnProgression: 1,
	Experimente: 2,
	Emerite: 3,
	Legendaire: 5,
	Hero: 10,
	Basara: 20,
} as const;
export type Rarity = (typeof Rarity)[keyof typeof Rarity];

/**
 * basara_chara_config document structure
 */
export interface BasaraCharaConfigDocument {
	version: 100;
	lists: [
		{
			name: "m_basaraBuildTypeList";
			typeName: "BASARA_BUILD_TYPE";
			values: BasaraBuildType[];
		},
	];
}

/**
 * soccer_chara_unique_rarity_config document structure
 */
export interface SoccerCharaUniqueRarityConfigDocument {
	version: 100;
	lists: [
		{
			name: "m_soccerCharaUniqueRarityList";
			typeName: "SOCCER_CHARA_UNIQUE_RARITY";
			values: SoccerCharaUniqueRarity[];
		},
	];
}
