/**
 * Skills module - 2,918 total skills
 *
 * - Main skills: 2,458 (shoots, dribbles, blocks, catches, specials)
 * - Aura skills: 58
 * - Passive skills: 402
 *
 * @example
 * ```typescript
 * import { createSkillsAPI } from '@rosegriffon/inagle/skills';
 *
 * const skills = createSkillsAPI();
 * console.log(skills.meta.totalSkills); // 2458
 *
 * // By category
 * const shoots = skills.shoots();
 * const catches = skills.catches();
 *
 * // By element
 * const fireSkills = skills.fire();
 *
 * // Search
 * const results = skills.search('tornado');
 *
 * // Passive skills by scope (team vs player)
 * const teamPassives = skills.passiveTeam();
 * const playerPassives = skills.passivePlayer();
 *
 * // Passive skills by boost type
 * const breachSkills = skills.passiveBreach();
 * const justiceSkills = skills.passiveJustice();
 * ```
 */
export * from "./api.js";
export * from "./types.js";
