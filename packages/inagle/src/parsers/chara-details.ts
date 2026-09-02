import { existsSync, readFileSync } from "node:fs";
import { resolveGameDataFile } from "../core/paths.js";

export interface ParsedCharaDetails {
	charaId: string;
	personalityType: number;
	firstPerson: string;
	secondPersonMale: string;
	secondPersonFemale: string;
}

/**
 * Parse character details config containing personality types and pronoun IDs
 */
export function parseCharaDetails(): Map<string, ParsedCharaDetails> {
	const map = new Map<string, ParsedCharaDetails>();
	const filePath = resolveGameDataFile("character", "chara_details_config");

	if (!filePath || !existsSync(filePath)) {
		return map;
	}

	try {
		const data = JSON.parse(readFileSync(filePath, "utf-8"));
		const list = data.lists?.find((l: any) => l.name === "m_charaDetailsList");
		if (list?.values) {
			for (const val of list.values) {
				const charaId = val.chara_id.toUpperCase();
				map.set(charaId, {
					charaId,
					personalityType: val.personality_type,
					firstPerson: val.first_person.toUpperCase(),
					secondPersonMale: val.second_person_male.toUpperCase(),
					secondPersonFemale: val.second_person_female.toUpperCase(),
				});
			}
		}
	} catch (e) {
		console.error("[CharaDetails] Failed to parse chara_details_config", e);
	}

	return map;
}
