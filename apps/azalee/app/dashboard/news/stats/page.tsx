import { Eye, Newspaper, TrendingUp } from "lucide-react";
import Link from "next/link";
import { getArticleStats } from "@/app/actions/articles";
import {
	DashboardStatsCard as DashboardMetricCard,
	AdminPageHeader as DashboardPageHeader,
	Badge,
} from "@rosegriffon/ui";
import { Icon } from "@/components/ui/Icon";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
	title: "Statistiques articles - Dashboard Azalée",
};

export default async function NewsStatsPage() {
	const [stats, categoryData] = await Promise.all([getArticleStats(), getCategoryBreakdown()]);

	// Calculate avg views per article
	const avgViews =
		stats.totalPublished > 0 ? Math.round(stats.totalViews / stats.totalPublished) : 0;

	return (
		<div className="space-y-8">
			<DashboardPageHeader
				breadcrumbs={[
					{ href: "/dashboard", label: "Tableau de bord" },
					{ href: "/dashboard/news", label: "Actualités" },
					{ label: "Statistiques" },
				]}
				title="Statistiques"
				subtitle="Vue d'ensemble des performances des articles"
				icon={<Icon name="bar_chart" size={20} />}
			/>

			{/* Stats cards */}
			<div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
				<DashboardMetricCard
					label="Total articles"
					value={stats.totalArticles}
					icon={<Icon name="description" size={20} />}
					description={`${stats.totalPublished} publiés · ${stats.totalDrafts} brouillons · ${stats.totalScheduled} programmés · ${stats.totalArchived} archivés`}
				/>
				<DashboardMetricCard
					label="Vues totales"
					value={stats.totalViews.toLocaleString("fr-FR")}
					icon={<Icon name="visibility" size={20} />}
					accentColor="bg-blue-500/15 text-blue-600"
				/>
				<DashboardMetricCard
					label="Vues / article"
					value={avgViews.toLocaleString("fr-FR")}
					icon={<Icon name="analytics" size={20} />}
					accentColor="bg-green-500/15 text-green-600"
					description="Moyenne par article publié"
				/>
				<DashboardMetricCard
					label="Taux publication"
					value={
						stats.totalArticles > 0
							? `${Math.round((stats.totalPublished / stats.totalArticles) * 100)}%`
							: "—"
					}
					icon={<Icon name="publish" size={20} />}
					accentColor="bg-amber-500/15 text-amber-600"
					description={`${stats.totalDrafts} brouillon${stats.totalDrafts !== 1 ? "s" : ""} en attente`}
				/>
			</div>

			{/* Category breakdown */}
			{categoryData.length > 0 && (
				<div className="rounded-[24px] bg-surface-container-lowest border border-outline-variant/20 p-6">
					<div className="flex items-center gap-2 mb-5">
						<Icon name="category" size={20} className="text-primary" />
						<h2 className="text-sm font-bold uppercase tracking-wider text-on-surface-variant">
							Articles par catégorie
						</h2>
					</div>
					<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
						{categoryData.map((cat) => (
							<div
								key={cat.category}
								className="flex items-center gap-3 p-3 rounded-2xl bg-surface-container-low border border-outline-variant/10"
							>
								<div className="flex-1 min-w-0">
									<p className="text-sm font-medium text-on-surface truncate">{cat.category}</p>
									<p className="text-xs text-on-surface-variant/60">
										{cat.count} article{cat.count !== 1 ? "s" : ""}
									</p>
								</div>
								<span className="text-lg font-bold text-on-surface-variant/40">{cat.count}</span>
							</div>
						))}
					</div>
				</div>
			)}

			<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
				{/* Top articles */}
				<div className="rounded-[24px] bg-surface-container-lowest border border-outline-variant/20 p-6">
					<div className="flex items-center gap-2 mb-5">
						<TrendingUp className="size-5 text-primary" />
						<h2 className="text-sm font-bold uppercase tracking-wider text-on-surface-variant">
							Articles les plus vus
						</h2>
					</div>
					<div className="space-y-1">
						{stats.topArticles.map((article, i) => (
							<Link
								key={article.id}
								href={`/news/${article.slug}`}
								className="flex items-center gap-3 py-2.5 px-3 rounded-xl hover:bg-surface-container-low transition-colors group"
							>
								<span
									className={`text-xs font-bold w-5 text-right ${
										i < 3 ? "text-primary" : "text-on-surface-variant/40"
									}`}
								>
									{i + 1}
								</span>
								<span className="flex-1 text-sm text-on-surface group-hover:text-primary transition-colors truncate">
									{article.title}
								</span>
								<Badge variant="outline" className="shrink-0 rounded-lg text-[10px]">
									<Eye className="size-3 mr-1" />
									{article.view_count.toLocaleString("fr-FR")}
								</Badge>
							</Link>
						))}
						{stats.topArticles.length === 0 && (
							<p className="text-sm text-on-surface-variant py-4 text-center">
								Aucun article publié
							</p>
						)}
					</div>
				</div>

				{/* Recent articles */}
				<div className="rounded-[24px] bg-surface-container-lowest border border-outline-variant/20 p-6">
					<div className="flex items-center gap-2 mb-5">
						<Newspaper className="size-5 text-primary" />
						<h2 className="text-sm font-bold uppercase tracking-wider text-on-surface-variant">
							Publications récentes
						</h2>
					</div>
					<div className="space-y-1">
						{stats.recentArticles.map((article) => (
							<Link
								key={article.id}
								href={`/news/${article.slug}`}
								className="flex items-center gap-3 py-2.5 px-3 rounded-xl hover:bg-surface-container-low transition-colors group"
							>
								<span className="flex-1 text-sm text-on-surface group-hover:text-primary transition-colors truncate">
									{article.title}
								</span>
								<div className="flex items-center gap-2 shrink-0">
									<Badge variant="outline" className="rounded-lg text-[10px]">
										<Eye className="size-3 mr-1" />
										{article.view_count.toLocaleString("fr-FR")}
									</Badge>
									<span className="text-[10px] text-on-surface-variant">
										{new Date(article.published_at).toLocaleDateString("fr-FR", {
											day: "numeric",
											month: "short",
										})}
									</span>
								</div>
							</Link>
						))}
						{stats.recentArticles.length === 0 && (
							<p className="text-sm text-on-surface-variant py-4 text-center">
								Aucun article publié
							</p>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

async function getCategoryBreakdown(): Promise<Array<{ category: string; count: number }>> {
	const supabase = await createClient();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const { data } = await supabase
		.from("articles")
		.select("category")
		.eq("app", "azalee")
		.eq("status", "published")
		.not("category", "is", null);

	if (!data) {
		return [];
	}

	const counts = new Map<string, number>();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	for (const row of data as any[]) {
		const cat = row.category || "Sans catégorie";
		counts.set(cat, (counts.get(cat) || 0) + 1);
	}

	return [...counts.entries()]
		.map(([category, count]) => ({ category, count }))
		.toSorted((a, b) => b.count - a.count);
}
