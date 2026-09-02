"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "@/lib/auth-helpers";
import { isAdminRole } from "@/lib/auth-roles";
import { createClient } from "@/lib/supabase/server";
import { convertTableToHtml, fetchGoogleSheetData, parseCsvData } from "@/lib/table-importer";

async function requireImportAdmin() {
	const session = await getServerSession();
	if (!session?.user) {
		return { error: "Non authentifié" as const, user: null };
	}

	const supabase = await createClient();
	const { data: profile } = await supabase
		.from("profiles")
		.select("role")
		.eq("id", session.user.id)
		.single();

	if (!profile || !isAdminRole(profile.role)) {
		return { error: "Permissions insuffisantes" as const, user: null };
	}

	return { error: null, user: session.user };
}

// Common helper to save article
async function saveArticle(title: string, content: string, userId: string, category: string) {
	const supabase = await createClient();

	// Unique slug
	const baseSlug = title
		.toLowerCase()
		.replaceAll(/[^a-z0-9]+/g, "-")
		.replaceAll(/^-|-$/g, "");
	const slug = `${baseSlug}-${Date.now().toString().slice(-6)}`;

	const { data, error } = await supabase
		.from("articles")
		.insert({
			title,
			content,
			author_id: userId,
			status: "draft",
			slug,
			category,
			excerpt: "Tableau de données importé",
		})
		.select()
		.single();

	if (error) {
		throw new Error(error.message);
	}
	return data;
}

export async function importGoogleSheet(sheetId: string) {
	try {
		const { error: authError, user } = await requireImportAdmin();
		if (authError || !user) {
			return { success: false, error: authError || "Non authentifié" };
		}

		const data = await fetchGoogleSheetData(sheetId);
		if (!data || data.length === 0) {
			return { error: "Le sheet est vide ou inaccessible.", success: false };
		}

		const title = `Import Sheet ${sheetId.slice(0, 8)}`;
		const html = convertTableToHtml(data, title);

		const article = await saveArticle(title, html, user.id, "Data");

		revalidatePath("/dashboard/news");
		return { data: article, success: true };
	} catch (error: unknown) {
		console.error("Sheet Import Error:", error);
		return {
			error: error instanceof Error ? error.message : "Une erreur inconnue est survenue",
			success: false,
		};
	}
}

export async function importCsv(title: string, csvContent: string) {
	try {
		const { error: authError, user } = await requireImportAdmin();
		if (authError || !user) {
			return { success: false, error: authError || "Non authentifié" };
		}

		const data = parseCsvData(csvContent);
		const html = convertTableToHtml(data, title);

		const article = await saveArticle(title, html, user.id, "Data");

		revalidatePath("/dashboard/news");
		return { data: article, success: true };
	} catch (error: unknown) {
		console.error("CSV Import Error:", error);
		return {
			error: error instanceof Error ? error.message : "Une erreur inconnue est survenue",
			success: false,
		};
	}
}
