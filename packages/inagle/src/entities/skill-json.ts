import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { rewriteZukanUrl } from "../core/images.js";
import { DATA_ROOT } from "../core/paths.js";
import type { ZukanSkill } from "../zukan/types.js";

let zukanSkillCache: Map<string, ZukanSkill> | null = null;

export function loadZukanSkills(): Map<string, ZukanSkill> {
	if (zukanSkillCache) return zukanSkillCache;

	zukanSkillCache = new Map();
	// We use db_skills.json from Zukan folder
	const path = join(DATA_ROOT, "zukan/db_skills.json");

	if (!existsSync(path)) {
		return zukanSkillCache;
	}

	try {
		const content = readFileSync(path, "utf-8");
		const data = JSON.parse(content) as ZukanSkill[];

		for (const skill of data) {
			// Rewrite URLs
			if (skill.videoUrl) skill.videoUrl = rewriteZukanUrl(skill.videoUrl) as string;
			if (skill.posterUrl) skill.posterUrl = rewriteZukanUrl(skill.posterUrl) as string;
			if (skill.thumbnailUrl) skill.thumbnailUrl = rewriteZukanUrl(skill.thumbnailUrl) as string;

			// Index by ID
			zukanSkillCache.set(skill.id, skill);
		}
	} catch (e) {
		console.error("[ZukanLoader] Failed to parse db_skills.json", e);
	}

	return zukanSkillCache;
}
