/**
 * Items module - Game items, capsules, and gallery
 *
 * @example
 * ```typescript
 * import { createItemsAPI } from '@rosegriffon/inagle/items';
 *
 * const items = createItemsAPI();
 *
 * // By type
 * const consumables = items.consumables();
 * const equipment = items.equipment();
 * const keyItems = items.keyItems();
 *
 * // Capsules (gacha)
 * const capsules = items.allCapsules();
 *
 * // Gallery
 * const gallery = items.allGallery();
 * ```
 */
export * from "./api.js";
export * from "./uniform-mapper.js";
