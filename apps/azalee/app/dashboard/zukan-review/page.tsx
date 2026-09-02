import type { Metadata } from "next";
import {
	DashboardStatsCard as DashboardMetricCard,
	AdminPageHeader as DashboardPageHeader,
} from "@rosegriffon/ui";
import { requireAdmin } from "@/lib/auth-helpers";
import { createClient } from "@/lib/supabase/server";
import { ZukanReviewClient } from "./ZukanReviewClient";
import type { ZukanCandidate } from "./ZukanReviewClient";
import { Icon } from "@/components/ui/Icon";

export const metadata: Metadata = {
	description: "Vérification des correspondances zukan/images des personnages.",
	title: "Audit Zukan | Administration",
};

export const dynamic = "force-dynamic";

export default async function ZukanReviewPage() {
	await requireAdmin();

	const supabase = await createClient();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const client = supabase as any;

	// Fetch live stats from DB in parallel
	const [
		{ count: totalCharacters },
		{ count: withZukan },
		{ count: withoutZukan },
		{ data: seriesBreakdown },
		{ data: missingBySeriesData },
		auditModule,
		zukanCatalogModule,
	] = await Promise.all([
		client.from("inagle_characters").select("*", { count: "exact", head: true }),
		client
			.from("inagle_characters")
			.select("*", { count: "exact", head: true })
			.not("zukan_hash", "is", null),
		client
			.from("inagle_characters")
			.select("*", { count: "exact", head: true })
			.is("zukan_hash", null),
		client.from("inagle_characters").select("series, zukan_hash").not("series", "is", null),
		client
			.from("inagle_characters")
			.select(
				"id, name_en, name_fr, name_ja, series, rarity_label, element, position, internal_code"
			)
			.is("zukan_hash", null)
			.not("internal_code", "like", "%_5000")
			.not("internal_code", "like", "%×%")
			.order("series", { ascending: true })
			.limit(200),
		import("@/data/zukan-audit.json").then((m) => m.default).catch(() => null),
		import("@/data/zukan/param_en.json")
			.then((m) => m.default as ZukanCandidate[])
			.catch(() => [] as ZukanCandidate[]),
	]);

	const total = totalCharacters || 0;
	const matched = withZukan || 0;
	const missing = withoutZukan || 0;
	const coverage = total > 0 ? Math.round((matched / total) * 100) : 0;

	// Calculate series coverage
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const seriesStats = new Map<string, { total: number; matched: number }>();
	if (seriesBreakdown) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		for (const row of seriesBreakdown as any[]) {
			const s = row.series || "Inconnu";
			if (!seriesStats.has(s)) {
				seriesStats.set(s, { total: 0, matched: 0 });
			}
			const entry = seriesStats.get(s)!;
			entry.total++;
			if (row.zukan_hash) {
				entry.matched++;
			}
		}
	}

	const seriesCoverage = [...seriesStats.entries()]
		.map(([series, stats]) => ({
			coverage: Math.round((stats.matched / stats.total) * 100),
			matched: stats.matched,
			series,
			total: stats.total,
		}))
		.toSorted((a, b) => a.coverage - b.coverage);

	// Static audit issues (if file exists)
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const auditData = auditModule as {
		metadata: { totalAudited: number; totalIssues: number; bySeverity: Record<string, number> };
		issues: any[];
	} | null;

	return (
		<div className="space-y-6 sm:space-y-8">
			<DashboardPageHeader
				breadcrumbs={[{ href: "/dashboard", label: "Tableau de bord" }, { label: "Audit Zukan" }]}
				title="Audit Zukan — Images"
				subtitle={`Couverture globale : ${coverage}% (${matched.toLocaleString("fr-FR")} / ${total.toLocaleString("fr-FR")})`}
				icon={<Icon name="image_search" size={20} />}
			/>

			{/* Live metrics */}
			<div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
				<DashboardMetricCard label="Personnages" value={total} icon={<Icon name="group" size={20} />} />
				<DashboardMetricCard
					label="Avec image Zukan"
					value={matched}
					icon={<Icon name="check_circle" size={20} />}
					accentColor="bg-green-500/15 text-green-600"
					description={`${coverage}% de couverture`}
				/>
				<DashboardMetricCard
					label="Sans image"
					value={missing}
					icon={<Icon name="image_not_supported" size={20} />}
					accentColor="bg-red-500/15 text-red-500"
				/>
				<DashboardMetricCard
					label="Problèmes détectés"
					value={auditData?.metadata.totalIssues || 0}
					icon={<Icon name="warning" size={20} />}
					accentColor="bg-amber-500/15 text-amber-600"
					description={
						auditData
							? `${auditData.metadata.bySeverity.high || 0} élevé · ${auditData.metadata.bySeverity.medium || 0} moyen`
							: undefined
					}
				/>
			</div>

			{/* Series coverage breakdown */}
			<div className="rounded-[24px] bg-surface-container-lowest border border-outline-variant/20 p-6">
				<h2 className="text-sm font-bold uppercase tracking-wider text-on-surface-variant mb-4">
					Couverture par série
				</h2>
				<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
					{seriesCoverage.map((s) => (
						<div
							key={s.series}
							className="flex items-center gap-3 p-3 rounded-2xl bg-surface-container-low border border-outline-variant/10"
						>
							<div className="flex-1 min-w-0">
								<div className="flex items-center justify-between mb-1">
									<span className="text-sm font-medium text-on-surface truncate">{s.series}</span>
									<span
										className={`text-xs font-bold ${
											s.coverage >= 95
												? "text-green-600"
												: s.coverage >= 80
													? "text-amber-600"
													: "text-red-500"
										}`}
									>
										{s.coverage}%
									</span>
								</div>
								<div className="w-full h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
									<div
										className={`h-full rounded-full transition-all ${
											s.coverage >= 95
												? "bg-green-500"
												: s.coverage >= 80
													? "bg-amber-500"
													: "bg-red-500"
										}`}
										style={{ width: `${s.coverage}%` }}
									/>
								</div>
								<span className="text-[10px] text-on-surface-variant/60 mt-0.5">
									{s.matched} / {s.total}
								</span>
							</div>
						</div>
					))}
				</div>
			</div>

			{/* Audit issues + missing characters (both handled by client) */}
			{auditData && auditData.issues.length > 0 && (
				<>
					<h2 className="text-lg font-medium text-on-surface pt-2">
						Problèmes de correspondance ({auditData.metadata.totalIssues})
					</h2>
					<ZukanReviewClient
						issues={auditData.issues}
						bySeverity={auditData.metadata.bySeverity}
						zukanCatalog={zukanCatalogModule || []}
						missingCharacters={(missingBySeriesData as any[]) || []}
					/>
				</>
			)}

			{/* Fallback: if no audit data but missing characters exist */}
			{(!auditData || auditData.issues.length === 0) &&
				missingBySeriesData &&
				(missingBySeriesData as any[]).length > 0 && (
					<ZukanReviewClient
						issues={[]}
						bySeverity={{}}
						zukanCatalog={zukanCatalogModule || []}
						missingCharacters={(missingBySeriesData as any[]) || []}
					/>
				)}
		</div>
	);
}
