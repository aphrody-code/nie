export const dynamic = "force-dynamic";

import { requireAdmin } from "@/lib/auth-helpers";
import { createAdminClient } from "@/lib/supabase/admin";
import { UserRoleManager } from "./UserRoleManager";

export default async function AdminUsersPage() {
	await requireAdmin();
	// `full_name` est fermé à `anon` : lecture en service-role, après le garde admin.
	const supabase = createAdminClient();

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const { data: users } = await (supabase as any)
		.from("profiles")
		.select("id, username, full_name, avatar_url, role, updated_at")
		.order("updated_at", { ascending: false });

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-2xl font-black text-on-surface tracking-tight">
					Gestion des utilisateurs
				</h1>
				<p className="text-sm text-on-surface-variant mt-1">
					Attribuer les rôles : admin, editor, moderator ou member.
				</p>
			</div>
			<UserRoleManager users={users || []} />
		</div>
	);
}
