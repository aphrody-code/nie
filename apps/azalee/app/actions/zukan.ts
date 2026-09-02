"use server";

import type { Character } from "@rosegriffon/inagle";
import { apiClient } from "@/lib/api-client";

type CharacterWithSpirit = Character & { spirit?: { type?: string } };

export async function searchZukan(searchParams: {
	q?: string;
	type?: string;
	element?: string;
	position?: string;
	gender?: string;
	rank?: string;
	page?: string;
	limit?: string;
}) {
	// Map search params to what the library expects
	const query = searchParams.q || "";
	const typeFilter = searchParams.type;
	const elementFilter = searchParams.element;
	const positionFilter = searchParams.position;
	const genderFilter = searchParams.gender;
	// Const rankFilter = searchParams.rank; // Unused
	const page = Number.parseInt(searchParams.page || "1", 10);
	const limit = Number.parseInt(searchParams.limit || "50", 10);

	// Perform search or get all characters
	let allItems: CharacterWithSpirit[];

	if (query) {
		const searchResults = await apiClient.inagle.search(query, 1000);
		// Flatten variants
		allItems = searchResults.flatMap((base) =>
			(base.variants || []).map(
				(v) =>
					({
						...v,
						charaId: base.charaId,
						gender: base.gender,
						internalCode: base.internalCode,
						names: base.names,
					}) as unknown as CharacterWithSpirit
			)
		);
	} else {
		const chars = await apiClient.inagle.getCharacters();
		// Flatten variants
		allItems = chars.flatMap((base) =>
			(base.variants || []).map(
				(v) =>
					({
						...v,
						charaId: base.charaId,
						gender: base.gender,
						internalCode: base.internalCode,
						names: base.names,
					}) as unknown as CharacterWithSpirit
			)
		);
	}

	// Apply filters manually since the search API doesn't support structured filtering yet
	const filtered = allItems.filter((char) => {
		if (typeFilter && char.spirit?.type?.toLowerCase() !== typeFilter.toLowerCase()) {
			return false;
		}
		if (elementFilter && char.element?.toLowerCase() !== elementFilter.toLowerCase()) {
			return false;
		}
		if (positionFilter && char.position?.toLowerCase() !== positionFilter.toLowerCase()) {
			return false;
		}
		if (genderFilter) {
			const charGenderStr = char.gender === 1 ? "female" : "male";
			if (charGenderStr !== genderFilter.toLowerCase()) {
				return false;
			}
		}
		// Rank filtering might require more complex logic depending on data structure
		// If (rankFilter && char.rank !== rankFilter) return false;
		return true;
	});

	// Pagination
	const total = filtered.length;
	const offset = (page - 1) * limit;
	const paged = filtered.slice(offset, offset + limit);

	return {
		count: total,
		items: paged,
	};
}
