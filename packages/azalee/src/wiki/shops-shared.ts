/**
 * Partie CLIENT-SAFE de la section « Boutiques » (`/boutique`).
 *
 * Contient UNIQUEMENT les types et la constante de libellés de catégories
 * — aucune dépendance Supabase / SQLite / Node. Importable depuis un composant
 * client. Le data-fetch serveur vit dans `wiki/shops.ts`
 * (sous-chemin serveur de la lib).
 */

export interface ShopItem {
	/** id objet (= inagle_items.id / item_db_id) — sert de slug vers /item/[id] */
	id: string;
	name: string;
	category: string | null;
	/** chemin icône (image_url depuis inagle_items, sinon null → carte affiche fallback) */
	icon: string | null;
	internalCode: string | null;
	slotIndex: number;
	/** true si l'objet est résolu dans inagle_items (nom/catégorie/icône fiables) */
	resolved: boolean;
}

export interface ShopSummary {
	shopId: number;
	name: string;
	nameEn: string | null;
	nameJa: string | null;
	/** nombre total d'objets vendus */
	itemCount: number;
	/** répartition par catégorie (catégorie → nombre), triée desc */
	categories: { category: string; count: number }[];
}

export interface ShopDetail extends ShopSummary {
	items: ShopItem[];
}

/** Libellés FR de catégories d'objets (réutilisés par la carte). */
export const SHOP_CATEGORY_FR: Record<string, string> = {
	accessory: "Pendentifs",
	animal: "Animaux",
	consume: "Consommables",
	costume: "Costumes",
	craft_obj: "Matériaux",
	emblem: "Emblèmes",
	fashion: "Mode",
	important: "Objets-clés",
	kizuna_link: "Liens Kizuna",
	misanga: "Bracelets",
	name_plate: "Plaques",
	performance: "Performances",
	shoes: "Chaussures",
	special: "Spéciaux",
	special_tactics: "Tactiques spéciales",
	super_tactics: "Super tactiques",
	title: "Titres",
};
