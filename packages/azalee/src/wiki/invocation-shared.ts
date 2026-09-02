// Types + helpers client-safe pour la section « Invocation (Players Universe) ».
// Aucun import serveur — utilisable depuis un composant `"use client"`.

/** Un palier de rareté d'invocation d'une constellation. */
export interface InvocationTier {
	/** 0 = commun, 1 = rare, 2 = légendaire (du jeu : rarityType). */
	rarityType: number;
	/** Libellé localisable du palier. */
	label: string;
	/** Probabilité ABSOLUE de tomber sur ce palier (%). Les 3 paliers somment à 100. */
	ratePct: number;
	/** Nombre de personnages dans le pool de ce palier. */
	count: number;
	/** Probabilité par personnage du palier (= ratePct / count). */
	perCharPct: number;
}

/** Taux d'invocation d'une constellation (étoile). */
export interface InvocationSign {
	/** Numéro d'étoile dans le jeu (1..30). */
	signNo: number;
	/** Nom localisé de la constellation (depuis inagle_constellations). */
	name: string;
	/** Taille totale du pool de personnages de la constellation. */
	totalChars: number;
	/** Paliers, légendaire en premier. */
	tiers: InvocationTier[];
}

/** Libellé FR d'un `rarityType`. */
export function rarityLabel(rarityType: number): string {
	if (rarityType === 2) return "Légendaire";
	if (rarityType === 1) return "Rare";
	return "Commun";
}
