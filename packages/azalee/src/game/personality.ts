/**
 * Personnalités (`personalityType`) d'un personnage d'IEVR et leur libellé FR.
 *
 * Table de données de jeu pure : le moteur stocke un entier, l'encyclopédie et
 * le CLI affichent le libellé. Une seule table pour tous les consommateurs.
 */

/** Libellés FR indexés par `personalityType` (0 = non renseigné). */
export const PERSONALITY_NAMES: Record<number, string> = {
	0: "Inconnu",
	1: "Doux",
	2: "Cool",
	3: "Passionné",
	4: "Timide",
	5: "Mature",
	6: "Joyeux",
	7: "Sérieux",
	8: "Sauvage",
	9: "Mystérieux",
	10: "Élégant",
	11: "Espiègle",
};

/**
 * Libellé FR d'une personnalité. `undefined` → « Inconnu » ; valeur hors table
 * → `Type <n>` (on montre la donnée brute plutôt que de mentir).
 */
export function getPersonalityName(type: number | undefined | null): string {
	if (type === undefined || type === null) return "Inconnu";
	return PERSONALITY_NAMES[type] ?? `Type ${type}`;
}
