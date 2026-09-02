/**
 * Partie CLIENT-SAFE de la section Wiki « Drops / Taux » (route `/drops`).
 *
 * Contient UNIQUEMENT les types et les helpers PURS (libellés FR) — aucune
 * dépendance Supabase / SQLite / Node. Importable depuis un composant client
 * (`"use client"`). Le data-fetch serveur vit dans `wiki/drops.ts`
 * (sous-chemin serveur de la lib).
 */

/** Une source de drop concret (= un coffre de victoire ou une émission), résolue. */
export interface DropEntry {
	/** Identifiant de ligne (`win_treasure:12`…). */
	id: string;
	/** Type de source. */
	source: "win_treasure" | "item_emission";
	/** Hash du groupe source (coffre / émission). */
	sourceId: string;
	/** Hash de l'objet dropé. */
	itemId: string;
	/** Nom FR de l'objet (repli EN puis hash). */
	itemName: string;
	/** Catégorie de l'objet (`consume`, `super_tactics`…). */
	itemCategory: string | null;
	/** Rareté de l'objet (`inagle_items.rarity`). */
	itemRarity: number | null;
	/** `internal_code` de l'objet (pour l'icône via `getItemIconUrl`). */
	itemInternalCode: string | null;
	/** `image_url` DB de l'objet (pour l'icône via `resolveAssetUrl`). */
	itemImageUrl: string | null;
	/** Poids brut dans le groupe. */
	weight: number;
	/** Probabilité dans le groupe = `weight` / somme des poids du groupe (%). */
	chance: number;
}

/** Un palier de rareté d'un drop d'esprit (spirit_drop), non nominatif. */
export interface SpiritTier {
	id: string;
	/** Index de rareté (0-5). */
	rarity: number | null;
	/** Bonus de rareté de drop (0/10/20). */
	dropRarity: number | null;
	weight: number;
	/**
	 * Probabilité ABSOLUE réelle du palier (%). Pour spirit_drop le `weight` EST déjà
	 * un pourcentage, donc `chance === weight` (PAS une fraction du total du groupe).
	 * La somme des paliers d'un groupe peut être < 100 (le reste = ne rien obtenir).
	 */
	chance: number;
}

/** Un groupe d'esprit (spirit_drop) : un `source_id` et ses paliers de rareté. */
export interface SpiritGroup {
	sourceId: string;
	tiers: SpiritTier[];
	/**
	 * Probabilité d'obtenir un esprit (un palier quelconque) = somme des `chance`.
	 * Si < 100, le complément est la chance de ne rien obtenir.
	 */
	anyChance?: number;
	/** `battle_group_id` qui référencent cette table (via `inagle_drops_battles`). */
	battleGroupIds: number[];
}

/** Bonus passif « Fève » d'une équipe (mécanique distincte du drop d'objet). */
export interface TeamBean {
	id: number;
	team: string;
	game: string;
	fixedBeans: string | null;
	passiveType: string | null;
	no: number | null;
	requirement: string | null;
	stat: string | null;
	value: string | null;
}

/** Compteurs d'en-tête (réels). */
export interface DropsCounts {
	concreteDrops: number;
	dropSources: number;
	spiritGroups: number;
	beans: number;
}

/** Données complètes de la section, prêtes à filtrer côté composant client. */
export interface DropsPageData {
	drops: DropEntry[];
	spiritGroups: SpiritGroup[];
	beans: TeamBean[];
	counts: DropsCounts;
	/** Catégories d'objets présentes parmi les drops (pour le filtre). */
	categories: string[];
	/** Séries de jeu présentes parmi les Fèves (pour le filtre). */
	beanGames: string[];
}

/** Libellé FR d'une source de drop. */
export function dropSourceLabel(source: DropEntry["source"]): string {
	switch (source) {
		case "win_treasure":
			return "Coffre de victoire";
		case "item_emission":
			return "Émission d'objet";
		default:
			return source;
	}
}

/** Libellé FR d'une catégorie d'objet (parmi celles réellement dropées). */
export function dropCategoryLabel(category: string | null): string {
	if (!category) {
		return "Autre";
	}
	const map: Record<string, string> = {
		consume: "Consommables",
		super_tactics: "Hyper Tactiques",
		special_tactics: "Tactiques Sp.",
		accessory: "Pendentifs",
		misanga: "Bracelets",
		shoes: "Chaussures",
		important: "Objets clés",
	};
	return map[category] ?? category;
}
