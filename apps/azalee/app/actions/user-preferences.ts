"use server";

import { getServerSession } from "@/lib/auth-helpers";
import { createClient } from "@/lib/supabase/server";

export type FontSize = "small" | "medium" | "large" | "x-large";

export interface Preferences {
	font_size: FontSize;
	reduced_motion: boolean;
	reading_mode: boolean;
	preferred_categories: string[];
	email_notifications: boolean;
	push_notifications: boolean;
}

const DEFAULT_PREFERENCES: Preferences = {
	email_notifications: true,
	font_size: "medium",
	preferred_categories: [],
	push_notifications: false,
	reading_mode: false,
	reduced_motion: false,
};

/**
 * Retourne les préférences de l'utilisateur connecté.
 * Si aucune préférence n'existe en base, retourne les valeurs par défaut.
 */
export async function getPreferences(): Promise<Preferences> {
	const session = await getServerSession();
	if (!session?.user) {
		throw new Error("Non authentifié");
	}

	const supabase = await createClient();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const client = supabase as any;

	const { data, error } = await client
		.from("user_preferences")
		.select(
			"font_size, reduced_motion, reading_mode, preferred_categories, email_notifications, push_notifications"
		)
		.eq("user_id", session.user.id)
		.maybeSingle();

	if (error) {
		console.error("getPreferences error:", error);
		return { ...DEFAULT_PREFERENCES };
	}

	if (!data) {
		return { ...DEFAULT_PREFERENCES };
	}

	const row = data as {
		font_size: FontSize | null;
		reduced_motion: boolean | null;
		reading_mode: boolean | null;
		preferred_categories: string[] | null;
		email_notifications: boolean | null;
		push_notifications: boolean | null;
	};

	return {
		email_notifications: row.email_notifications ?? DEFAULT_PREFERENCES.email_notifications,
		font_size: row.font_size ?? DEFAULT_PREFERENCES.font_size,
		preferred_categories: row.preferred_categories ?? DEFAULT_PREFERENCES.preferred_categories,
		push_notifications: row.push_notifications ?? DEFAULT_PREFERENCES.push_notifications,
		reading_mode: row.reading_mode ?? DEFAULT_PREFERENCES.reading_mode,
		reduced_motion: row.reduced_motion ?? DEFAULT_PREFERENCES.reduced_motion,
	};
}

/**
 * Met à jour (upsert) les préférences de l'utilisateur connecté.
 * Seuls les champs fournis dans `updates` sont modifiés.
 */
export async function updatePreferences(updates: Partial<Preferences>): Promise<Preferences> {
	const session = await getServerSession();
	if (!session?.user) {
		throw new Error("Non authentifié");
	}

	const supabase = await createClient();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const client = supabase as any;

	const { data, error } = await client
		.from("user_preferences")
		.upsert(
			{
				user_id: session.user.id,
				...updates,
				updated_at: new Date().toISOString(),
			},
			{ onConflict: "user_id" }
		)
		.select(
			"font_size, reduced_motion, reading_mode, preferred_categories, email_notifications, push_notifications"
		)
		.single();

	if (error || !data) {
		console.error("updatePreferences error:", error);
		throw new Error("Impossible de mettre à jour les préférences");
	}

	const row = data as {
		font_size: FontSize | null;
		reduced_motion: boolean | null;
		reading_mode: boolean | null;
		preferred_categories: string[] | null;
		email_notifications: boolean | null;
		push_notifications: boolean | null;
	};

	return {
		email_notifications: row.email_notifications ?? DEFAULT_PREFERENCES.email_notifications,
		font_size: row.font_size ?? DEFAULT_PREFERENCES.font_size,
		preferred_categories: row.preferred_categories ?? DEFAULT_PREFERENCES.preferred_categories,
		push_notifications: row.push_notifications ?? DEFAULT_PREFERENCES.push_notifications,
		reading_mode: row.reading_mode ?? DEFAULT_PREFERENCES.reading_mode,
		reduced_motion: row.reduced_motion ?? DEFAULT_PREFERENCES.reduced_motion,
	};
}

/**
 * Bascule le mode lecture de l'utilisateur connecté.
 * Retourne la nouvelle valeur du champ reading_mode.
 */
export async function toggleReadingMode(): Promise<boolean> {
	const session = await getServerSession();
	if (!session?.user) {
		throw new Error("Non authentifié");
	}

	const supabase = await createClient();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const client = supabase as any;

	// Récupérer la valeur actuelle
	const { data: existing } = await client
		.from("user_preferences")
		.select("reading_mode")
		.eq("user_id", session.user.id)
		.maybeSingle();

	const currentValue =
		(existing as { reading_mode: boolean | null } | null)?.reading_mode ??
		DEFAULT_PREFERENCES.reading_mode;
	const newValue = !currentValue;

	const { error } = await client.from("user_preferences").upsert(
		{
			reading_mode: newValue,
			updated_at: new Date().toISOString(),
			user_id: session.user.id,
		},
		{ onConflict: "user_id" }
	);

	if (error) {
		console.error("toggleReadingMode error:", error);
		throw new Error("Impossible de basculer le mode lecture");
	}

	return newValue;
}
