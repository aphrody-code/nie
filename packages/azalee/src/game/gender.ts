/**
 * @file gender.ts
 * @description Utilitaires pour la gestion du type gender (number/string)
 *
 * Le genre peut être :
 * - number: 0 = male, 1 = female (format inagle)
 * - string: "M"/"F" ou "Male"/"Female" (format DB/API)
 */

/**
 * Type union pour les valeurs de genre possibles
 */
export type GenderValue = number | string | "M" | "F" | "Male" | "Female" | undefined | null;

/**
 * Vérifie si le genre est féminin
 *
 * @example
 * isFemaleGender(1)        // true
 * isFemaleGender(0)        // false
 * isFemaleGender("F")      // true
 * isFemaleGender("M")      // false
 * isFemaleGender("Female") // true
 */
export function isFemaleGender(gender: GenderValue): boolean {
	if (gender === undefined || gender === null) {
		return false;
	}
	if (typeof gender === "number") {
		return gender === 1;
	}
	const g = String(gender).toLowerCase();
	return g === "f" || g === "female" || g === "1";
}

/**
 * Vérifie si le genre est masculin
 */
export function isMaleGender(gender: GenderValue): boolean {
	if (gender === undefined || gender === null) {
		return true;
	} // Default to male
	if (typeof gender === "number") {
		return gender === 0;
	}
	const g = String(gender).toLowerCase();
	return g === "m" || g === "male" || g === "0";
}

/**
 * Normalise le genre vers un number (0 ou 1)
 */
export function normalizeGender(gender: GenderValue): 0 | 1 {
	return isFemaleGender(gender) ? 1 : 0;
}
