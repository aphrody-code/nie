"use server";

import type { MovesetSkill } from "@/components/wiki/MovesetList";
import { getServerSession } from "@/lib/auth-helpers";
import { createClient } from "@/lib/supabase/server";
import type { SavedTeam, TeamData } from "@rosegriffon/azalee/game/team-types";
import { wikiService } from "@/lib/wiki-service";

/** Save a new team */
export async function saveTeam(
	name: string,
	data: TeamData
): Promise<{ id: string } | { error: string }> {
	const session = await getServerSession();
	if (!session?.user) {
		return { error: "Non authentifié" };
	}

	const supabase = await createClient();
	const { data: result, error } = await (supabase as any)
		.from("user_teams")
		.insert({
			formation_data: data,
			formation_id: data.formationId,
			is_public: false,
			name,
			user_id: session.user.id,
		})
		.select("id")
		.single();

	if (error) {
		return { error: error.message };
	}
	return { id: result.id };
}

/** Update an existing team */
export async function updateTeam(
	teamId: string,
	name: string,
	data: TeamData
): Promise<{ success: boolean } | { error: string }> {
	const session = await getServerSession();
	if (!session?.user) {
		return { error: "Non authentifié" };
	}

	const supabase = await createClient();
	const { error } = await (supabase as any)
		.from("user_teams")
		.update({
			formation_data: data,
			formation_id: data.formationId,
			name,
			updated_at: new Date().toISOString(),
		})
		.eq("id", teamId)
		.eq("user_id", session.user.id);

	if (error) {
		return { error: error.message };
	}
	return { success: true };
}

/** Delete a team */
export async function deleteTeam(
	teamId: string
): Promise<{ success: boolean } | { error: string }> {
	const session = await getServerSession();
	if (!session?.user) {
		return { error: "Non authentifié" };
	}

	const supabase = await createClient();
	const { error } = await (supabase as any)
		.from("user_teams")
		.delete()
		.eq("id", teamId)
		.eq("user_id", session.user.id);

	if (error) {
		return { error: error.message };
	}
	return { success: true };
}

/** Get all teams for the current user */
export async function getUserTeams(): Promise<SavedTeam[]> {
	const session = await getServerSession();
	if (!session?.user) {
		return [];
	}

	const supabase = await createClient();
	const { data } = await (supabase as any)
		.from("user_teams")
		.select("*")
		.eq("user_id", session.user.id)
		.order("updated_at", { ascending: false });

	return (data || []) as SavedTeam[];
}

/** Get a single team (public or owned) */
export async function getTeam(teamId: string): Promise<SavedTeam | null> {
	const session = await getServerSession();
	const supabase = await createClient();

	let query = (supabase as any).from("user_teams").select("*").eq("id", teamId);

	if (!session?.user) {
		query = query.eq("is_public", true);
	}

	const { data } = await query.single();
	if (!data) {
		return null;
	}

	if (data.user_id !== session?.user?.id && !data.is_public) {
		return null;
	}

	return data as SavedTeam;
}

/** Toggle team visibility */
export async function toggleTeamVisibility(
	teamId: string
): Promise<{ is_public: boolean } | { error: string }> {
	const session = await getServerSession();
	if (!session?.user) {
		return { error: "Non authentifié" };
	}

	const supabase = await createClient();

	const { data: team } = await (supabase as any)
		.from("user_teams")
		.select("is_public")
		.eq("id", teamId)
		.eq("user_id", session.user.id)
		.single();

	if (!team) {
		return { error: "Équipe introuvable" };
	}

	const newValue = !team.is_public;
	const { error } = await (supabase as any)
		.from("user_teams")
		.update({ is_public: newValue })
		.eq("id", teamId)
		.eq("user_id", session.user.id);

	if (error) {
		return { error: error.message };
	}
	return { is_public: newValue };
}

/** Resolve skills for a character (on-demand, for the detail panel) */
export async function getCharacterSkills(charaId: string): Promise<MovesetSkill[]> {
	const PHANTOM_IDS = new Set(["0xDBEDB6B8"]);

	const supabase = await createClient();
	const { data: rows } = await (supabase as any)
		.from("inagle_characters")
		.select("skills, sheet_data")
		.eq("chara_id", charaId)
		.order("rarity", { ascending: false })
		.limit(1);

	const row = rows?.[0];
	if (!row) {
		return [];
	}

	// Try variant skills from DB
	const rawSkills: Array<{ skillId: string; learnLevel: number }> = Array.isArray(row.skills)
		? row.skills
		: [];
	const skillList = rawSkills
		.map((s: any) => {
			if (typeof s === "string") {
				return { skillId: s, learnLevel: 0 };
			}
			// Fix reversed mapping
			const skillIdNum = typeof s.skillId === "string" ? Number.parseInt(s.skillId, 16) : s.skillId;
			const learnNum =
				typeof s.learnLevel === "number" ? s.learnLevel : Number.parseInt(s.learnLevel, 10);
			if (skillIdNum < 1000 && Math.abs(learnNum) > 1_000_000) {
				const hexSkillId = `0x${(learnNum >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
				return { learnLevel: skillIdNum, skillId: hexSkillId };
			}
			return s;
		})
		.filter((s: any) => !PHANTOM_IDS.has(s.skillId));

	const fetchedSkills = await Promise.all(
		skillList.map((s: any) => wikiService.getSkill(s.skillId))
	);

	const result: MovesetSkill[] = [];
	fetchedSkills.forEach((skill, index) => {
		if (!skill) {
			return;
		}
		const learnLevel = skillList[index]?.learnLevel || 0;
		const isPassive =
			skill.categoryName?.en?.toLowerCase() === "passive" ||
			skill.categoryName?.fr?.toLowerCase() === "talent" ||
			(skill as any).skillType === "passive";

		result.push({
			category: skill.categoryName?.fr || "Spécial",
			element: skill.elementName?.en?.toLowerCase(),
			id: (skill as any).skillId || (skill as any).skillID || (skill as any).skillIDStr,
			imageUrl: skill.image,
			isPassive,
			learnLevel,
			name: skill.displayName || (skill as any).name_FR || (skill as any).name_EN || "???",
			power: skill.power_min ? `${skill.power_min}` : undefined,
			tension: (skill as any).consumeTp || (skill as any).tension_cost,
		});
	});

	// Sort by learn level
	result.sort((a, b) => (a.learnLevel || 0) - (b.learnLevel || 0));
	result.forEach((s, i) => {
		s.slotNumber = i + 1;
	});

	// Fallback: sheet_data firstMoves
	if (result.length === 0 && row.sheet_data?.firstMoves) {
		const moveNames = (row.sheet_data.firstMoves as string)
			.split(/[,\n]/)
			.map((n: string) => n.trim())
			.filter(Boolean);
		const resolved = await Promise.all(moveNames.map((name: string) => wikiService.getSkill(name)));
		resolved.forEach((skill, i) => {
			if (!skill) {
				return;
			}
			result.push({
				element: skill.elementName?.en?.toLowerCase(),
				name: skill.displayName || (skill as any).name_FR || (skill as any).name_EN || moveNames[i],
				power: skill.power_min ? `${skill.power_min}` : undefined,
				slotNumber: result.length + 1,
			});
		});
	}

	return result;
}
