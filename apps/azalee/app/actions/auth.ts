"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { logAudit } from "@/lib/audit";
import { auth } from "@/lib/auth";

export async function signOutAction() {
	const reqHeaders = await headers();

	// Get session before signing out to log the event
	try {
		const session = await auth.api.getSession({ headers: reqHeaders });
		if (session?.user) {
			await logAudit(session.user.id, "logout");
		}
	} catch {
		// Continue with sign out even if audit fails
	}

	await auth.api.signOut({ headers: reqHeaders });
	revalidatePath("/", "layout");
	redirect("/");
}
