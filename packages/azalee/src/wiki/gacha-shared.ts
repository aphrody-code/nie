/**
 * Partie CLIENT-SAFE de la section « Capsules / Gacha + Costumes » (`/capsule`).
 *
 * Contient UNIQUEMENT les types et les helpers PURS (conversion hex, libellés)
 * — aucune dépendance Supabase / SQLite / Node. Importable depuis un composant
 * client. Le data-fetch serveur vit dans `wiki/gacha.ts`
 * (sous-chemin serveur de la lib).
 */

/** Convertit un entier signé int32 en hexadécimal non signé `0xXXXXXXXX`. */
export function toHexU32(n: number): string {
	return `0x${(n >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
}

// ============================================================================
// Capsules / Gacha
// ============================================================================

export interface CapsulePrize {
	/** Hash du lot (= identifiant de la ligne, ex "0x6AE74506"). */
	id: string;
	/** Référence du contenu attribué (hash, non résolu vers les tables extraites). */
	contentRef: string;
	/** Référence de la table/pool de tirage (hash), regroupe les lots. */
	poolRef: string;
	/** Drapeau additionnel (0 pour la grande majorité des lots). */
	extraFlag: number;
	/** Variables brutes telles que parsées (6 entiers signés int32). */
	vars: number[];
}

/** Un pool de tirage = un `poolRef` partagé par plusieurs lots. */
export interface CapsulePool {
	ref: string;
	count: number;
}

export interface CapsuleListResult {
	data: CapsulePrize[];
	total: number;
	page: number;
	limit: number;
	/** Pools de tirage disponibles (pour le filtre), triés par effectif décroissant. */
	pools: CapsulePool[];
}

// ============================================================================
// Costumes
// ============================================================================

/** Libellés des types de costume (valeurs réelles 0/1/2 du config). */
export const COSTUME_TYPE_LABELS: Record<number, string> = {
	0: "Standard",
	1: "Variante A",
	2: "Variante B",
};

export function costumeTypeLabel(type: number): string {
	return COSTUME_TYPE_LABELS[type] ?? `Type ${type}`;
}

export interface Costume {
	id: string;
	index: number;
	type: number;
	typeLabel: string;
	/** Hash CRC du modèle 3D (ex "0x23337402"). */
	modelRef: string;
	flag1: number;
	flag2: number;
}

export interface CostumeListResult {
	data: Costume[];
	total: number;
	page: number;
	limit: number;
	/** Types présents (pour le filtre), avec leur effectif. */
	types: Array<{ type: number; label: string; count: number }>;
}

// ============================================================================
// Compteurs (pour l'en-tête / les onglets)
// ============================================================================

export interface GachaCounts {
	capsules: number;
	costumes: number;
}
