"use server";

import { createClient } from "@/lib/supabase/server";

export interface PatchNoteSummary {
	id: string;
	slug: string;
	title: string;
	date: string;
	platform: string[];
	featured_image: string | null;
}

export interface PatchNoteDetail extends PatchNoteSummary {
	content_html: string;
}

/**
 * Récupère la liste des patch notes
 */
export async function getPatchNotes(
	platform?: string,
	limit?: number
): Promise<PatchNoteSummary[]> {
	const supabase = await createClient();

	let query = supabase
		.from("patch_notes")
		.select("id, url, title, title_fr, date, featured_image, platform")
		.order("date", { ascending: false });

	if (limit) {
		query = query.limit(limit);
	}

	const { data, error } = await query;

	if (error) {
		console.error("Error fetching patch notes:", error);
		return [];
	}

	let notes: PatchNoteSummary[] = ((data as any[]) || []).map((item) => ({
		date: item.date || "",
		featured_image: item.featured_image,
		id: item.id,
		platform: Array.isArray(item.platform) ? item.platform : [],
		slug: item.id, // Use ID as slug
		title: item.title_fr || item.title,
	}));

	// Filtrer par plateforme si spécifié
	if (platform) {
		const platformKey = platform === "ps-steam" ? ["ps4", "ps5", "steam"] : [platform];
		notes = notes.filter((note) => note.platform.some((p) => platformKey.includes(p)));
	}

	return notes;
}

/**
 * Récupère le détail d'un patch note par son ID ou slug
 */
export async function getPatchNoteDetail(idOrSlug: string): Promise<PatchNoteDetail | null> {
	const supabase = await createClient();

	const { data, error } = await supabase
		.from("patch_notes")
		.select(
			"id, url, title, title_fr, date, featured_image, content_html, content_html_fr, platform"
		)
		.eq("id", idOrSlug)
		.single();

	if (error || !data) {
		console.error("Error fetching patch note detail:", error);
		return null;
	}

	const item = data as any;
	return {
		content_html: item.content_html_fr || item.content_html || "",
		date: item.date || "",
		featured_image: item.featured_image,
		id: item.id,
		platform: Array.isArray(item.platform) ? item.platform : [],
		slug: item.id,
		title: item.title_fr || item.title,
	};
}
