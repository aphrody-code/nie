/**
 * Partie CLIENT-SAFE de la section ÉQUIPES (`/equipe`).
 *
 * Contient UNIQUEMENT les types et les constantes de libellés (séries, saisons)
 * — aucune dépendance Supabase / SQLite / Node. Importable depuis un composant
 * client. Le data-fetch serveur vit dans `wiki/teams.ts`
 * (sous-chemin serveur de la lib).
 */

/** Clés de série dans `team.kits` / mapping vers le jeu d'origine. */
export const SERIES_LABELS: Record<string, string> = {
	v: "Victory Road",
	go: "Galaxy / GO",
	ie: "Inazuma Eleven (1-3)",
	aresOrion: "Ares / Orion",
};

/** Labels FR des codes de saison (apparitions inter-jeux). */
export const SEASON_LABELS: Record<string, string> = {
	V: "Victory Road",
	IE1: "IE 1",
	IE2: "IE 2",
	IE3: "IE 3",
	GO1: "GO 1",
	GO2: "GO 2",
	GO3: "GO 3",
	ARES: "Ares",
	ORION: "Orion",
};

export interface TeamKitModel {
	/** 0 = domicile, 1 = extérieur. */
	typeId: number;
	uniformFielderModelIdCrc: string;
	uniformKeeperModelIdCrc: string;
	shoesFielderModelIdCrc: string;
	gloveModelIdCrc: string;
}

export interface TeamKit {
	/** Clé de série (`v`, `go`, `ie`, `aresOrion`). */
	series: string;
	seriesLabel: string;
	/** CRC du jeu d'uniforme (= `inagle_uniforms.name_id`). */
	nameId: string;
	models: TeamKitModel[];
}

export interface TeamEmblem {
	series: string;
	seriesLabel: string;
	/** CRC de l'emblème pour cette série. */
	crc: string;
}

export interface TeamListItem {
	id: string;
	name: string;
	nameJa: string | null;
	nameEn: string | null;
	emblemUrl: string | null;
	/** Apparitions jeu (codes saison → nb de personnages). */
	seasons: Record<string, number>;
	/** Séries disposant d'un kit (clés de `kits`). */
	seriesKeys: string[];
	rosterCount: number;
	order: number;
}

export interface TeamRosterMember {
	charaId: string;
	name: string;
	nameJa: string | null;
	slug: string | null;
	position: string | null;
	element: string | null;
	rarity: string | null;
	imageUrl: string;
}

export interface TeamDetail {
	id: string;
	name: string;
	nameEn: string | null;
	nameJa: string | null;
	descriptionFr: string | null;
	descriptionEn: string | null;
	emblemUrl: string | null;
	emblems: TeamEmblem[];
	kits: TeamKit[];
	seasons: Record<string, number>;
	roster: TeamRosterMember[];
}
