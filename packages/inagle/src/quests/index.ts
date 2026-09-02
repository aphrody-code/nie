/**
 * Quests module - 750+ quests with multilingual descriptions
 *
 * @example
 * ```typescript
 * import { createQuestsAPI } from '@rosegriffon/inagle/quests';
 *
 * const quests = createQuestsAPI();
 *
 * // By phase
 * const phase1 = quests.byPhase(1);
 *
 * // With rewards
 * const withRewards = quests.withRewards();
 *
 * // Search
 * const results = quests.search('win');
 * ```
 */
export * from "./api.js";
