/** Team-rule contracts; historical builder calculations are owned by nie-core::azalee::team_rules. */
import type { TeamMember, TeamMemberStats } from "./team-types";
import type { Formation } from "./formations";

export interface RecalculatedStats extends TeamMemberStats {
  combatPower: number;
}

export interface PositionMatch {
  factor: number;
  status: "match" | "adjacent" | "mismatch" | "none";
}

export interface ElementLink {
  slotA: string;
  slotB: string;
  element: string;
  coordA: { top: number; left: number };
  coordB: { top: number; left: number };
}

export interface ElementSynergyInfo {
  dominantElement: string | null;
  hasHarmony: boolean;
  links: ElementLink[];
}

/** Hosts install native or WASM bindings; no JavaScript rule fallback. */
export interface TeamRulesRuntime {
  team_position_factor(position: string, slot: string, formationJson: string): string;
  team_recalculate_stats(memberJson: string, level: number, slot: string, formationJson: string, dominantElement: string | undefined, harmony: boolean): string;
  team_element_synergies(membersJson: string, formationJson: string): string;
}

let runtime: TeamRulesRuntime | undefined;

export function configureTeamRulesRuntime(bindings: TeamRulesRuntime): void {
  runtime = bindings;
}

function bindings(): TeamRulesRuntime {
  if (!runtime) throw new Error("Team rules runtime is not initialized");
  return runtime;
}

export function getPositionMatchFactor(playerPos: string, slotId: string, formation: Formation): PositionMatch {
  return JSON.parse(bindings().team_position_factor(playerPos, slotId, JSON.stringify(formation))) as PositionMatch;
}

export function recalculateMemberStats(
  member: TeamMember, level: number, slotId: string, formation: Formation,
  dominantElement?: string | null, hasHarmony?: boolean,
): RecalculatedStats {
  return JSON.parse(bindings().team_recalculate_stats(
    JSON.stringify(member), level, slotId, JSON.stringify(formation), dominantElement ?? undefined, !!hasHarmony,
  )) as RecalculatedStats;
}

export function calculateElementSynergies(members: Record<string, TeamMember>, formation: Formation): ElementSynergyInfo {
  return JSON.parse(bindings().team_element_synergies(JSON.stringify(Object.entries(members)), JSON.stringify(formation))) as ElementSynergyInfo;
}
