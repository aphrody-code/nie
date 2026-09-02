/**
 * @file rarity.ts
 * @description Source unique pour la conversion des codes de rareté de personnage.
 *
 * Ce module factorise deux fonctions auparavant dupliquées (et divergentes) dans
 * `parsers/star-sign.ts`, `parsers/chara-param.ts` et `stat-calculator.ts` :
 *   - `rarityCodeToName`   : code de rareté → label d'affichage français
 *   - `rarityToGrowthRank` : code de rareté → rang de la table de croissance (0-5)
 *
 * Les codes proviennent de `starSignCharaInfo.charaRarity` :
 *   0  = Normal        (EN: COMMON,    drop ~90%)
 *   2  = Expérimenté   (EN: ADVANCED,  drop ~9.5%)
 *   5/6/7 = Légendaire (EN: LEGENDARY, drop ~0.5%)
 *  20  = BASARA        (depuis basaraBuildInfo)
 *
 * NOTE: "Héros" (code 10) n'est PAS posé par le code de rareté starSign ; il est
 * appliqué par le script d'enrichissement match-heroes pour les personnages ayant
 * un chemin d'évolution héroïque (Fire/Black/Pink). On le gère ici pour rester
 * exhaustif côté affichage.
 *
 * Les codes 1 (En progression) et 3 (Émérite) sont des paliers d'amélioration,
 * jamais attribués comme rareté de base via la gacha.
 */

/**
 * Convertit un code de rareté en label d'affichage français.
 *
 * Labels officiels (system_text NOUN_INFO 76-82) :
 *   EN: COMMON / GROWING / ADVANCED / TOP / LEGENDARY / HERO / FABLED
 *   FR: Normal / En progression / Expérimenté / Émérite / Légendaire / Héros / BASARA
 */
export function rarityCodeToName(code: number): string {
	switch (code) {
		case 0:
		case 1:
			return "Normal";
		case 2:
			return "Expérimenté";
		case 3:
			return "Émérite";
		case 4:
			return "Normal";
		case 5:
		case 6:
		case 7:
			return "Légendaire";
		case 10:
			return "Héros";
		case 20:
			return "BASARA";
		default:
			return `Rank${code}`;
	}
}

/**
 * Mappe un code de rareté vers le rang de la table de croissance (pour le calcul
 * des stats). La table de croissance utilise les rangs 0-5 pour `charaRank`.
 *
 * starSign codes : 0=N, 2=R, 5=UR, 6=LR, 7=Legend, 20=BASARA
 */
export function rarityToGrowthRank(code: number): number {
	// Rangs de la table de croissance : 0, 1, 2, 3, 4, 5
	switch (code) {
		case 0:
			return 0; // N -> rang 0
		case 2:
			return 2; // R -> rang 2
		case 3:
			return 3; // SR -> rang 3
		case 4:
			return 4; // SSR -> rang 4
		case 5:
			return 5; // UR -> rang 5
		case 6:
			return 5; // LR -> stats UR
		case 7:
			return 5; // Legend -> stats UR
		case 20:
			return 5; // BASARA -> stats UR
		default:
			return code <= 5 ? code : 5;
	}
}
