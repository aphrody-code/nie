import type { Metadata } from "next";
import { AdminPageHeader as DashboardPageHeader } from "@rosegriffon/ui";
import { requireAdmin } from "@/lib/auth-helpers";
import { createClient } from "@/lib/supabase/server";
import { AuditTable } from "./AuditTable";
import { Icon } from "@/components/ui/Icon";

export const metadata: Metadata = {
	description: "Journal des événements de sécurité.",
	title: "Audit Logs | Administration",
};

export const dynamic = "force-dynamic";

interface PageProps {
	searchParams: Promise<{ page?: string; action?: string }>;
}

const PAGE_SIZE = 50;

export default async function AuditPage({ searchParams }: PageProps) {
	await requireAdmin();

	const params = await searchParams;
	const page = Math.max(1, Number.parseInt(params.page || "1", 10));
	const actionFilter = params.action || "";

	const supabase = await createClient();

	let query = supabase
		.from("audit_logs")
		.select("*, profiles:user_id(username, avatar_url)", { count: "exact" })
		.order("created_at", { ascending: false })
		.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

	if (actionFilter) {
		query = query.eq("action", actionFilter);
	}

	const { data: logs, count } = await query;

	const totalPages = Math.ceil((count || 0) / PAGE_SIZE);

	return (
		<div className="space-y-6 sm:space-y-8">
			<DashboardPageHeader
				breadcrumbs={[
					{ href: "/dashboard", label: "Tableau de bord" },
					{ label: "Journal d'audit" },
				]}
				title="Journal d'audit"
				subtitle={`${count || 0} entrée${(count || 0) !== 1 ? "s" : ""}`}
				icon={<Icon name="policy" size={20} />}
			/>

			<AuditTable
				logs={logs || []}
				currentPage={page}
				totalPages={totalPages}
				currentAction={actionFilter}
			/>
		</div>
	);
}
