import type { BaseCharacter, Item, Skill, Team } from "@rosegriffon/inagle";

export interface VerificationResult {
	isValid: boolean;
	issues: string[];
}

// Legacy fields (`name_FR`, `desc_FR`) may still be present on data coming
// From older inagle exports. The current types only know about
// `names.fr` / `descriptions.fr`, hence we read them via this loose shape.
interface LegacyLocalized {
	name_FR?: string;
	desc_FR?: string;
}

export const verifier = {
	validateCharacter(char: BaseCharacter): VerificationResult {
		const issues: string[] = [];

		if (!char.names.fr) issues.push("Nom français manquant");
		// Descriptions are often missing, maybe warning only? strict means fail or warn?
		// Let's mark it as issue.
		if (!char.descriptions?.fr) issues.push("Description française manquante");

		const hasStats = char.variants.some((v) => v.stats?.lv99?.kick > 0);
		if (!hasStats) issues.push("Statistiques manquantes");

		return { isValid: issues.length === 0, issues };
	},

	validateItem(item: Item): VerificationResult {
		const issues: string[] = [];
		if (!item.names?.fr) issues.push("Nom français manquant");
		if (!item.descriptions?.fr) issues.push("Description française manquante");
		return { isValid: issues.length === 0, issues };
	},

	validateSkill(skill: Skill): VerificationResult {
		const issues: string[] = [];
		// EnrichedSkill exposes `name_FR` / `desc_FR`. We also probe `names.fr` /
		// `descriptions.fr` for forward-compat with future schema changes — read
		// through a permissive shape since those fields are not on the type yet.
		const probe = skill as Skill &
			LegacyLocalized & {
				names?: { fr?: string };
				descriptions?: { fr?: string };
			};
		if (!probe.name_FR && !probe.names?.fr) issues.push("Nom français manquant");
		if (!probe.desc_FR && !probe.descriptions?.fr) issues.push("Description française manquante");

		return { isValid: issues.length === 0, issues };
	},

	validateTeam(team: Team): VerificationResult {
		const issues: string[] = [];
		// Legacy `name_FR` field on older Team exports — see LegacyLocalized above.
		const probe = team as Team & LegacyLocalized & { names?: { fr?: string } };
		if (!probe.name_FR && !probe.names?.fr) issues.push("Nom français manquant");
		return { isValid: issues.length === 0, issues };
	},
};
