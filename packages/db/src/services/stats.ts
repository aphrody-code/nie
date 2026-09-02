import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types.gen";
import type { DashboardStats } from "@rosegriffon/types";

interface CountResult {
	count: number | null;
}

/**
 * Shared service to fetch aggregated dashboard counts.
 * Optimized for performance using head-only queries for counts.
 */
export async function getDashboardStats(
	supabase: SupabaseClient<Database>
): Promise<DashboardStats> {
	const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
	const now = new Date().toISOString();

	async function count<T extends keyof Database["public"]["Tables"]>(
		table: T,
		filter?: (q: any) => any
	): Promise<number> {
		let q = supabase.from(table).select("*", { count: "exact", head: true });

		if (filter) {
			q = filter(q) as any;
		}

		const { count: c, error } = await q;
		if (error) {
			console.error(`[getDashboardStats] Error counting ${table}:`, error.message);
			return 0;
		}
		return c ?? 0;
	}

	const [
		profiles_total,
		profiles_24h,
		admins,
		banned,
		articles_published,
		articles_draft,
		events_upcoming,
		events_past,
		team_members,
		discord_members,
	] = await Promise.all([
		count("profiles"),
		count("profiles", (q) => q.gte("updated_at", yesterday)),
		count("profiles", (q) => q.eq("role", "admin")),
		count("profiles", (q) => q.eq("role", "banned")),
		count("articles", (q) => q.eq("status", "published")),
		count("articles", (q) => q.eq("status", "draft")),
		count("events", (q) => q.gte("end_time", now)),
		count("events", (q) => q.lt("end_time", now)),
		count("team_members", (q) => q.eq("is_active", true)),
		count("discord_members", (q) => q.eq("is_bot", false)),
	]);

	return {
		profiles_total,
		profiles_24h,
		admins,
		banned,
		articles_published,
		articles_draft,
		events_upcoming,
		events_past,
		team_members,
		discord_members,
		generated_at: new Date().toISOString(),
	};
}
