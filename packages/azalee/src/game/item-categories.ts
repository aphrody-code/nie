/**
 * Catégories d'objets (`item.category`) d'IEVR et leur libellé FR.
 *
 * Table de données de jeu pure, sans I/O : le dump expose un identifiant en
 * anglais (`craft_obj`, `misanga`…), l'encyclopédie et le CLI affichent le
 * libellé français.
 */

/** Libellés FR indexés par identifiant de catégorie du jeu. */
export const ITEM_CATEGORY_LABELS_FR: Record<string, string> = {
	consume: "Consommable",
	shoes: "Chaussures",
	misanga: "Bracelet",
	accessory: "Accessoire",
	special: "Spécial",
	formation: "Formation",
	special_tactics: "Tactique spéciale",
	super_tactics: "Super tactique",
	special_skill: "Compétence spéciale",
	title: "Titre",
	fashion: "Mode",
	costume: "Costume",
	emblem: "Emblème",
	unique: "Unique",
	craft_obj: "Matériau",
	animal: "Animal",
	kizuna_link: "Lien Kizuna",
	name_plate: "Plaque",
	performance: "Performance",
	important: "Objet clé",
};

/**
 * Libellé FR d'une catégorie d'objet. Une catégorie inconnue est renvoyée
 * telle quelle (identifiant brut) plutôt que masquée.
 */
export function getItemCategoryLabel(category: string | undefined | null): string | undefined {
	if (!category) return undefined;
	return ITEM_CATEGORY_LABELS_FR[category] ?? category;
}
