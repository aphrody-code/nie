"use server";

import { randomBytes } from "node:crypto";
import { getServerSession, requireAdmin } from "@/lib/auth-helpers";
import { createClient } from "@/lib/supabase/server";

function generateUnsubscribeToken(): string {
	return randomBytes(32).toString("hex");
}

const VALID_FREQUENCIES = ["instant", "daily", "weekly", "monthly"] as const;
type NewsletterFrequency = (typeof VALID_FREQUENCIES)[number];

function normalizeFrequency(
	value: string | undefined,
	fallback: NewsletterFrequency = "weekly"
): NewsletterFrequency {
	return VALID_FREQUENCIES.includes(value as NewsletterFrequency)
		? (value as NewsletterFrequency)
		: fallback;
}

export async function subscribeNewsletter(
	email: string,
	categories?: string[],
	frequency?: NewsletterFrequency
): Promise<{ success: boolean; error?: string }> {
	const session = await getServerSession();
	const supabase = await createClient();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const client = supabase as any;

	const normalizedEmail = email.trim().toLowerCase();
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
		return { error: "Adresse email invalide.", success: false };
	}

	// IMPORTANT : on récupère bien `categories` et `frequency` pour éviter
	// L'écrasement silencieux des préférences existantes.
	const { data: existing } = await client
		.from("newsletter_subscriptions")
		.select("id, user_id, categories, frequency")
		.eq("email", normalizedEmail)
		.maybeSingle();

	if (existing) {
		const { error } = await client
			.from("newsletter_subscriptions")
			.update({
				categories: categories ?? existing.categories ?? [],
				frequency: frequency ?? existing.frequency ?? "weekly",
				is_active: true,
				updated_at: new Date().toISOString(),
				user_id: session?.user?.id ?? existing.user_id ?? null,
			})
			.eq("id", existing.id);

		if (error) {
			console.error("Newsletter update error:", error);
			return { error: error.message, success: false };
		}

		return { success: true };
	}

	const token = generateUnsubscribeToken();
	const { error } = await client.from("newsletter_subscriptions").insert({
		categories: categories ?? [],
		created_at: new Date().toISOString(),
		email: normalizedEmail,
		frequency: frequency ?? "weekly",
		is_active: true,
		unsubscribe_token: token,
		updated_at: new Date().toISOString(),
		user_id: session?.user?.id ?? null,
	});

	if (error) {
		console.error("Newsletter insert error:", error);
		return { error: error.message, success: false };
	}

	return { success: true };
}

export async function unsubscribeNewsletter(
	token: string
): Promise<{ success: boolean; error?: string }> {
	const supabase = await createClient();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const client = supabase as any;

	const { data: subscription, error: fetchError } = await client
		.from("newsletter_subscriptions")
		.select("id")
		.eq("unsubscribe_token", token)
		.maybeSingle();

	if (fetchError || !subscription) {
		return {
			error: "Lien de désabonnement invalide ou expiré.",
			success: false,
		};
	}

	const { error } = await client
		.from("newsletter_subscriptions")
		.update({
			is_active: false,
			updated_at: new Date().toISOString(),
		})
		.eq("id", subscription.id);

	if (error) {
		console.error("Newsletter unsubscribe error:", error);
		return { error: error.message, success: false };
	}

	return { success: true };
}

export async function updateNewsletterPreferences(
	categories: string[],
	frequency: string
): Promise<{ success: boolean; error?: string }> {
	const session = await getServerSession();
	if (!session?.user) {
		return { error: "Non authentifié.", success: false };
	}

	const supabase = await createClient();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const client = supabase as any;

	// On vise la subscription la plus récente liée à ce user_id pour éviter
	// D'écrire en masse si l'historique contient plusieurs lignes.
	const { data: subscription } = await client
		.from("newsletter_subscriptions")
		.select("id")
		.eq("user_id", session.user.id)
		.eq("is_active", true)
		.order("updated_at", { ascending: false })
		.limit(1)
		.maybeSingle();

	if (!subscription) {
		return {
			error: "Aucune subscription active trouvée pour cet utilisateur.",
			success: false,
		};
	}

	const { error } = await client
		.from("newsletter_subscriptions")
		.update({
			categories,
			frequency: normalizeFrequency(frequency),
			updated_at: new Date().toISOString(),
		})
		.eq("id", subscription.id);

	if (error) {
		console.error("Newsletter preferences update error:", error);
		return { error: error.message, success: false };
	}

	return { success: true };
}

export async function getNewsletterStatus(): Promise<{
	id: string;
	email: string;
	categories: string[];
	frequency: string;
	is_active: boolean;
	created_at: string;
} | null> {
	const session = await getServerSession();
	if (!session?.user) {
		return null;
	}

	const supabase = await createClient();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const { data } = await (supabase as any)
		.from("newsletter_subscriptions")
		.select("id, email, categories, frequency, is_active, created_at")
		.eq("user_id", session.user.id)
		.order("updated_at", { ascending: false })
		.limit(1)
		.maybeSingle();

	return data ?? null;
}

export async function getNewsletterSubscribers(categories?: string[]): Promise<
	Array<{
		id: string;
		email: string;
		user_id: string | null;
		categories: string[];
		frequency: string;
		created_at: string;
	}>
> {
	await requireAdmin();

	const supabase = await createClient();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const client = supabase as any;

	let query = client
		.from("newsletter_subscriptions")
		.select("id, email, user_id, categories, frequency, created_at")
		.eq("is_active", true)
		.order("created_at", { ascending: false });

	if (categories && categories.length > 0) {
		query = query.overlaps("categories", categories);
	}

	const { data, error } = await query;

	if (error) {
		console.error("Newsletter subscribers fetch error:", error);
		return [];
	}

	return data || [];
}
