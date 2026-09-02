/**
 * Teams & Formations module
 *
 * - Teams: Club and national teams
 * - Formations: 111 tactical formations (offensive/defensive/balanced)
 * - Uniforms: 727 team uniforms
 *
 * @example
 * ```typescript
 * import { createTeamsAPI } from '@rosegriffon/inagle/teams';
 *
 * const teams = createTeamsAPI();
 *
 * // Formations
 * const offensive = teams.offensiveFormations();
 * const balanced = teams.balancedFormations();
 *
 * // Teams with uniforms
 * const allTeams = teams.allTeams();
 * const uniforms = teams.teamUniforms(teamId);
 * ```
 */
export * from "./api.js";
