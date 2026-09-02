/**
 * BASARA Module - Entry point for BASARA/FABLED character API
 *
 * @example
 * ```typescript
 * import { createBasaraAPI } from '@rosegriffon/inagle/basara';
 *
 * const basara = createBasaraAPI();
 *
 * // Get all BASARA
 * const all = basara.all();
 *
 * // Search by name
 * const shuya = basara.search('Shuya');
 *
 * // By element/position
 * const fireFW = basara.fire().filter(b => b.position === 'FW');
 * ```
 */

export type { BasaraAPI, BasaraIndexes, EnrichedBasara } from "./api.js";
export { buildBasaraDatabase, createBasaraAPI } from "./api.js";
export type {
	BasaraBuild,
	BasaraCharacter,
	BasaraDatabase,
	BasaraIcons,
	BasaraStats,
	Element,
	HeroVariants,
	MultilingualName,
	Position,
} from "./types.js";
export { ELEMENT_NAMES, POSITION_MAP, POSITION_NAMES } from "./types.js";
