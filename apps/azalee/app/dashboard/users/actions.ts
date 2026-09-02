"use server";

import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit";
import { getServerSession } from "@/lib/auth-helpers";
import { USER_MANAGEMENT_ROLES } from "@/lib/auth-roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

async function requireAdminSession() {
	const session = await getServerSession();
	if (!session?.user) {
		return { error: "Non authentifié", role: null, session: null };
	}

	const supabase = await createClient();
	const { data: profile } = await supabase
		.from("profiles")
		.select("role")
		.eq("id", session.user.id)
		.single();

	if (
		!profile ||
		!USER_MANAGEMENT_ROLES.includes(profile.role as (typeof USER_MANAGEMENT_ROLES)[number])
	) {
		return { error: "Permissions insuffisantes", role: null, session: null };
	}

	return { error: null, role: profile.role as string, session };
}

export async function changeUserRole(targetUserId: string, newRole: string) {
	const { error: authError, session, role: currentUserRole } = await requireAdminSession();
	if (authError || !session) {
		return { error: authError || "Non authentifié", success: false };
	}

	// Validate role value
	const validRoles = ["member", "editor", "moderator", "admin"];
	if (!validRoles.includes(newRole)) {
		return { error: "Rôle invalide", success: false };
	}

	// Prevent self-modification
	if (targetUserId === session.user.id) {
		return { error: "Vous ne pouvez pas modifier votre propre rôle", success: false };
	}

	// Only superadmin can promote to admin
	if (newRole === "admin" && currentUserRole !== "superadmin") {
		return { error: "Seul un superadmin peut promouvoir au rôle admin", success: false };
	}

	// Check target isn't superadmin
	const adminDb = createAdminClient();
	const { data: targetProfile } = await (adminDb as any)
		.from("profiles")
		.select("role, username")
		.eq("id", targetUserId)
		.single();

	if (!targetProfile) {
		return { error: "Utilisateur introuvable", success: false };
	}

	if (targetProfile.role === "superadmin") {
		return { error: "Impossible de modifier un superadmin", success: false };
	}

	// Update role
	const { error } = await (adminDb as any)
		.from("profiles")
		.update({ role: newRole })
		.eq("id", targetUserId);

	if (error) {
		console.error("Error changing role:", error);
		return { error: "Erreur lors de la modification du rôle", success: false };
	}

	await logAudit(session.user.id, "role_change", {
		newRole,
		oldRole: targetProfile.role,
		targetUserId,
		targetUsername: targetProfile.username,
	});

	revalidatePath("/dashboard/users");
	return { success: true };
}

export async function banUser(targetUserId: string) {
	const { error: authError, session } = await requireAdminSession();
	if (authError || !session) {
		return { error: authError || "Non authentifié", success: false };
	}

	// Prevent self-ban
	if (targetUserId === session.user.id) {
		return { error: "Vous ne pouvez pas vous bannir vous-même", success: false };
	}

	// Check target isn't superadmin or admin
	const adminDb = createAdminClient();
	const { data: targetProfile } = await (adminDb as any)
		.from("profiles")
		.select("role, username")
		.eq("id", targetUserId)
		.single();

	if (!targetProfile) {
		return { error: "Utilisateur introuvable", success: false };
	}

	if (targetProfile.role === "superadmin" || targetProfile.role === "admin") {
		return { error: "Impossible de bannir un administrateur", success: false };
	}

	// Set role to banned
	const { error } = await (adminDb as any)
		.from("profiles")
		.update({ role: "banned" })
		.eq("id", targetUserId);

	if (error) {
		console.error("Error banning user:", error);
		return { error: "Erreur lors du bannissement", success: false };
	}

	await logAudit(session.user.id, "user_ban", {
		previousRole: targetProfile.role,
		targetUserId,
		targetUsername: targetProfile.username,
	});

	revalidatePath("/dashboard/users");
	return { success: true };
}
