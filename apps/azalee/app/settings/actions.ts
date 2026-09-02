"use server";

import { revalidatePath } from "next/cache";
import { SchemaProfilPublic } from "@rosegriffon/types/profil";
import { z } from "zod";

import { logAudit } from "@/lib/audit";
import { getServerSession } from "@/lib/auth-helpers";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Actions du compte.
 *
 * Écriture en **service-role** après vérification de session : depuis la
 * fermeture PII des `profiles` (11/8/2026), la table n'est plus accessible en
 * `anon` et le client anonyme échouait en 42501 — sans erreur visible côté
 * interface, la sauvegarde semblait réussir sans rien écrire.
 *
 * Chaque action ne touche QUE ses propres colonnes.
 */

// Le schéma vit dans `@rosegriffon/types/profil`, avec celui du site principal :
// les deux écrivent dans la MÊME colonne `profiles.badges`, et une validation
// recopiée finit toujours par diverger. C'est là qu'est la règle des badges
// mérités et le refus des URL `javascript:`.
const profileSchema = SchemaProfilPublic;

export async function updateProfile(
	values: z.input<typeof profileSchema>
): Promise<{ error?: string }> {
	const session = await getServerSession();
	if (!session?.user) {
		return { error: "Session expirée — reconnecte-toi." };
	}

	const parsed = profileSchema.safeParse(values);
	if (!parsed.success) {
		return { error: parsed.error.issues[0]?.message ?? "Données invalides." };
	}

	const { error } = await createAdminClient()
		.from("profiles")
		.update({ ...parsed.data, updated_at: new Date().toISOString() })
		.eq("id", session.user.id);

	if (error) {
		if (error.code === "23505") {
			return { error: "Ce nom d'utilisateur est déjà pris." };
		}
		console.error("[compte] mise à jour du profil impossible", error);
		return { error: "Erreur lors de la mise à jour du profil." };
	}

	await logAudit(session.user.id, "profile_update", { fields: Object.keys(parsed.data) });
	revalidatePath("/settings");
	revalidatePath(`/profil/${parsed.data.username}`);
	return {};
}

/**
 * Enregistre l'URL d'avatar déjà téléversée.
 *
 * L'identifiant vient de la session, jamais d'un paramètre : sinon n'importe
 * quel appelant pourrait réécrire l'avatar d'un autre compte.
 */
export async function updateAvatarUrl(avatarUrl: string): Promise<{ error?: string }> {
	const session = await getServerSession();
	if (!session?.user) {
		return { error: "Session expirée — reconnecte-toi." };
	}

	const { error } = await createAdminClient()
		.from("profiles")
		.update({ avatar_url: avatarUrl, updated_at: new Date().toISOString() })
		.eq("id", session.user.id);

	if (error) {
		console.error("[compte] mise à jour de l'avatar impossible", error);
		return { error: "Impossible d'enregistrer le nouvel avatar." };
	}

	revalidatePath("/settings");
	return {};
}
