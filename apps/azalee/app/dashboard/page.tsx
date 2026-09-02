import { format, formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
	DashboardStatsCard as DashboardMetricCard,
	AdminPageHeader as DashboardPageHeader,
} from "@rosegriffon/ui";
import { Icon } from "@/components/ui/Icon";
import { getServerSession } from "@/lib/auth-helpers";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
	const session = await getServerSession();
	if (!session?.user) {
		redirect("/login");
	}

	const supabase = await createClient();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const client = supabase as any;

	// Fetch all counts + recent + scheduled articles + wiki stats in parallel
	const [
		articles,
		published,
		drafts,
		scheduled,
		archived,
		viewsData,
		profiles,
		characters,
		skills,
		recentArticles,
		scheduledArticles,
		// Wiki detailed stats
		charPositions,
		charElements,
		skillCategories,
		skillElements,
		passives,
		items,
		teams,
		formations,
		auras,
		keshins,
		coordinators,
	] = await Promise.all([
		client.from("articles").select("*", { count: "exact", head: true }).eq("app", "azalee"),
		client
			.from("articles")
			.select("*", { count: "exact", head: true })
			.eq("app", "azalee")
			.eq("status", "published"),
		client
			.from("articles")
			.select("*", { count: "exact", head: true })
			.eq("app", "azalee")
			.eq("status", "draft"),
		client
			.from("articles")
			.select("*", { count: "exact", head: true })
			.eq("app", "azalee")
			.eq("status", "scheduled"),
		client
			.from("articles")
			.select("*", { count: "exact", head: true })
			.eq("app", "azalee")
			.eq("status", "archived"),
		client.from("articles").select("view_count").eq("app", "azalee").eq("status", "published"),
		client.from("profiles").select("id", { count: "exact", head: true }),
		client.from("inagle_characters").select("*", { count: "exact", head: true }),
		client.from("inagle_skills").select("*", { count: "exact", head: true }),
		client
			.from("articles")
			.select(
				"id, title, slug, status, updated_at, featured_image_url, category, view_count, author_id"
			)
			.eq("app", "azalee")
			.order("updated_at", { ascending: false })
			.limit(5),
		client
			.from("articles")
			.select("id, title, slug, scheduled_at, category, featured_image_url")
			.eq("app", "azalee")
			.eq("status", "scheduled")
			.order("scheduled_at", { ascending: true })
			.limit(5),
		// Characters by position
		client.from("inagle_characters").select("position"),
		// Characters by element
		client.from("inagle_characters").select("element"),
		// Skills by category
		client.from("inagle_skills").select("category"),
		// Skills by element
		client.from("inagle_skills").select("element"),
		// Other wiki tables counts
		client.from("inagle_passives").select("*", { count: "exact", head: true }),
		client.from("inagle_items").select("*", { count: "exact", head: true }),
		client.from("inagle_teams").select("*", { count: "exact", head: true }),
		client.from("inagle_formations").select("*", { count: "exact", head: true }),
		client.from("inagle_auras").select("*", { count: "exact", head: true }),
		client.from("inagle_keshins").select("*", { count: "exact", head: true }),
		client.from("inagle_coordinators").select("*", { count: "exact", head: true }),
	]);

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const totalViews = (viewsData.data || []).reduce(
		(sum: number, a: any) => sum + (a.view_count || 0),
		0
	);

	// ============ Wiki stats aggregation ============

	// Characters by position
	const positionCounts = new Map<string, number>();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	for (const row of (charPositions.data || []) as any[]) {
		const pos = row.position || "Inconnu";
		positionCounts.set(pos, (positionCounts.get(pos) || 0) + 1);
	}
	const positionLabels: Record<string, string> = {
		Coach: "Entraîneur",
		DF: "Défenseur",
		FW: "Attaquant",
		GK: "Gardien",
		MF: "Milieu",
	};
	const positionStats = [...positionCounts.entries()]
		.map(([pos, count]) => ({ code: pos, count, label: positionLabels[pos] || pos }))
		.toSorted((a, b) => b.count - a.count);

	// Characters by element
	const elementCounts = new Map<string, number>();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	for (const row of (charElements.data || []) as any[]) {
		const el = row.element || "0";
		elementCounts.set(String(el), (elementCounts.get(String(el)) || 0) + 1);
	}
	const elementLabels: Record<string, { label: string; color: string }> = {
		"0": { color: "bg-purple-500/15 text-purple-600", label: "Néant" },
		"1": { color: "bg-emerald-500/15 text-emerald-600", label: "Vent" },
		"2": { color: "bg-green-500/15 text-green-600", label: "Forêt" },
		"3": { color: "bg-red-500/15 text-red-600", label: "Feu" },
		"4": { color: "bg-amber-500/15 text-amber-600", label: "Montagne" },
		"5": { color: "bg-purple-500/15 text-purple-600", label: "Néant" },
	};
	const elementStats = [...elementCounts.entries()]
		.filter(([el]) => el !== "null" && el !== "undefined")
		.map(([el, count]) => ({
			color: elementLabels[el]?.color || "bg-stone-500/15 text-stone-600",
			count,
			id: el,
			label: elementLabels[el]?.label || `Élément ${el}`,
		}))
		.toSorted((a, b) => b.count - a.count);

	// Skills by category
	const skillCatCounts = new Map<string, number>();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	for (const row of (skillCategories.data || []) as any[]) {
		const cat = row.category || "Autre";
		skillCatCounts.set(cat, (skillCatCounts.get(cat) || 0) + 1);
	}
	const skillCatLabels: Record<string, string> = {
		Block: "Défense",
		Catch: "Arrêt",
		Dribble: "Dribble",
		Passive: "Passif",
		Shoot: "Tir",
		Special: "Spécial",
		"Stat Boost": "Boost Stats",
	};
	const skillCatStats = [...skillCatCounts.entries()]
		.map(([cat, count]) => ({ code: cat, count, label: skillCatLabels[cat] || cat }))
		.toSorted((a, b) => b.count - a.count);

	// Skills by element
	const skillElCounts = new Map<string, number>();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	for (const row of (skillElements.data || []) as any[]) {
		const el = row.element || "0";
		skillElCounts.set(String(el), (skillElCounts.get(String(el)) || 0) + 1);
	}
	const skillElStats = [...skillElCounts.entries()]
		.filter(([el]) => el !== "null" && el !== "undefined")
		.map(([el, count]) => ({
			color: elementLabels[el]?.color || "bg-stone-500/15 text-stone-600",
			count,
			id: el,
			label: elementLabels[el]?.label || `Élément ${el}`,
		}))
		.toSorted((a, b) => b.count - a.count);

	// Fetch author names for recent articles
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const recentData = (recentArticles.data || []) as any[];
	const authorIds = [...new Set(recentData.map((a) => a.author_id).filter(Boolean))];
	let authorMap = new Map<string, string>();
	if (authorIds.length > 0) {
		const { data: authorProfiles } = await client
			.from("profiles")
			.select("id, full_name, username")
			.in("id", authorIds);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		authorMap = new Map(
			(authorProfiles || []).map((p: any) => [p.id, p.full_name || p.username || ""])
		);
	}

	const quickLinks = [
		{
			description: "Gérer les articles et publications",
			href: "/dashboard/news",
			icon: "newspaper",
			label: "Actualités",
		},
		{
			description: "Explorer les tables Wiki",
			href: "/dashboard/database",
			icon: "database",
			label: "Base de données",
		},
		{
			description: "Gérer la communauté",
			href: "/dashboard/users",
			icon: "group",
			label: "Utilisateurs",
		},
		{
			description: "Vues, tendances et performances",
			href: "/dashboard/news/stats",
			icon: "bar_chart",
			label: "Stats articles",
		},
		{
			description: "Gérer le feed Twitter",
			href: "/dashboard/tweets",
			icon: "tag",
			label: "Tweets",
		},
		{
			description: "Convertir un document en article",
			href: "/dashboard/import-google-doc",
			icon: "description",
			label: "Import Google Doc",
		},
		{
			description: "Convertir Sheet ou CSV en tableau",
			href: "/dashboard/import-sheet",
			icon: "table_chart",
			label: "Import Tableur",
		},
		{
			description: "Vérifier les images des personnages",
			href: "/dashboard/zukan-review",
			icon: "image_search",
			label: "Audit Zukan",
		},
		{
			description: "Historique des actions",
			href: "/dashboard/audit",
			icon: "history",
			label: "Journal d'audit",
		},
		{
			description: "Traductions et corrections en masse",
			href: "/dashboard/database/verification",
			icon: "verified",
			label: "Modération en masse",
		},
		{
			description: "Configuration du dashboard",
			// Pointait vers /settings (préférences du compte public) : l'admin
			// quittait le dashboard, sans sidebar ni fil d'Ariane.
			href: "/dashboard/settings",
			icon: "settings",
			label: "Paramètres",
		},
	];

	const statusLabel = (status: string) => {
		switch (status) {
			case "published": {
				return "Publié";
			}
			case "draft": {
				return "Brouillon";
			}
			case "scheduled": {
				return "Programmé";
			}
			case "archived": {
				return "Archivé";
			}
			default: {
				return status;
			}
		}
	};

	const statusIcon = (status: string) => {
		switch (status) {
			case "published": {
				return "check_circle";
			}
			case "draft": {
				return "edit_note";
			}
			case "scheduled": {
				return "schedule";
			}
			case "archived": {
				return "archive";
			}
			default: {
				return "article";
			}
		}
	};

	const statusColors = (status: string) => {
		switch (status) {
			case "published": {
				return "bg-tertiary-container/50 text-on-tertiary-container";
			}
			case "draft": {
				return "bg-primary-container/50 text-on-primary-container";
			}
			case "scheduled": {
				return "bg-blue-100/50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300";
			}
			case "archived": {
				return "bg-surface-container-high text-on-surface-variant";
			}
			default: {
				return "bg-surface-container text-on-surface-variant";
			}
		}
	};

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const scheduledData = (scheduledArticles.data || []) as any[];

	return (
		<div className="space-y-6 sm:space-y-8">
			<DashboardPageHeader
				title="Vue d'ensemble"
				icon={<Icon name="dashboard" size={20} />}
				subtitle="Administration Azalée"
			/>

			{/* Metrics row — 2 rows on mobile, 1 row on desktop */}
			<div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-4">
				<DashboardMetricCard
					label="Articles"
					value={articles.count || 0}
					icon={<Icon name="newspaper" size={20} />}
					href="/dashboard/news"
					description={`${published.count || 0} publiés · ${drafts.count || 0} brouillons`}
				/>
				<DashboardMetricCard
					label="Vues totales"
					value={totalViews}
					icon={<Icon name="visibility" size={20} />}
					href="/dashboard/news/stats"
					accentColor="bg-blue-500/15 text-blue-600"
				/>
				<DashboardMetricCard
					label="Utilisateurs"
					value={profiles.count || 0}
					icon={<Icon name="group" size={20} />}
					href="/dashboard/users"
				/>
				<DashboardMetricCard
					label="Personnages"
					value={characters.count || 0}
					icon={<Icon name="person" size={20} />}
					href="/dashboard/database/inagle_characters"
					description={`${(skills.count || 0).toLocaleString("fr-FR")} techniques`}
				/>
			</div>

			{/* Secondary metrics — articles by status */}
			<div className="grid gap-3 sm:gap-4 grid-cols-2 sm:grid-cols-4">
				{[
					{
						color: "bg-green-500/15 text-green-600",
						count: published.count || 0,
						label: "Publiés",
						status: "published",
					},
					{
						color: "bg-amber-500/15 text-amber-600",
						count: drafts.count || 0,
						label: "Brouillons",
						status: "draft",
					},
					{
						color: "bg-blue-500/15 text-blue-600",
						count: scheduled.count || 0,
						label: "Programmés",
						status: "scheduled",
					},
					{
						color: "bg-stone-500/15 text-stone-600",
						count: archived.count || 0,
						label: "Archivés",
						status: "archived",
					},
				].map((item) => (
					<Link
						key={item.status}
						href={`/dashboard/news?status=${item.status}`}
						className="flex items-center gap-3 p-3 sm:p-4 rounded-[20px] bg-surface-container-low border border-outline-variant/20 hover:shadow-level-1 hover:bg-surface-container transition-all group"
					>
						<div
							className={`size-10 rounded-xl flex items-center justify-center shrink-0 ${item.color}`}
						>
							<Icon name={statusIcon(item.status)} size={20} />
						</div>
						<div className="min-w-0">
							<p className="text-lg sm:text-xl font-normal text-on-surface">{item.count}</p>
							<p className="text-xs text-on-surface-variant">{item.label}</p>
						</div>
					</Link>
				))}
			</div>

			{/* Two-column layout: Recent activity + Scheduled articles */}
			<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
				{/* Recent activity */}
				{recentData.length > 0 && (
					<div className="space-y-4">
						<div className="flex items-center justify-between">
							<h2 className="text-lg font-medium text-on-surface">Activité récente</h2>
							<Link href="/dashboard/news" className="text-sm text-primary hover:underline">
								Tout voir
							</Link>
						</div>
						<div className="rounded-[24px] bg-surface-container-low border border-outline-variant/20 overflow-hidden divide-y divide-outline-variant/10">
							{recentData.map((article) => (
								<Link
									key={article.id}
									href={`/dashboard/news/${article.id}`}
									className="flex items-center gap-4 p-4 hover:bg-surface-container transition-colors group"
								>
									<div
										className={`size-10 rounded-xl flex items-center justify-center shrink-0 ${statusColors(article.status)}`}
									>
										<Icon name={statusIcon(article.status)} size={20} />
									</div>
									<div className="min-w-0 flex-1">
										<p className="text-sm font-medium text-on-surface truncate group-hover:text-primary transition-colors">
											{article.title}
										</p>
										<div className="flex items-center gap-2 text-xs text-on-surface-variant/60">
											<span>
												{article.updated_at
													? formatDistanceToNow(new Date(article.updated_at), {
															addSuffix: true,
															locale: fr,
														})
													: "—"}
											</span>
											<span className="size-1 rounded-full bg-outline-variant/40" />
											<span>{statusLabel(article.status)}</span>
											{authorMap.get(article.author_id) && (
												<>
													<span className="size-1 rounded-full bg-outline-variant/40" />
													<span>{authorMap.get(article.author_id)}</span>
												</>
											)}
											{article.view_count > 0 && (
												<>
													<span className="size-1 rounded-full bg-outline-variant/40" />
													<span className="inline-flex items-center gap-0.5">
														<Icon name="visibility" size={10} />
														{article.view_count.toLocaleString("fr-FR")}
													</span>
												</>
											)}
										</div>
									</div>
									<Icon
										name="chevron_right"
										size={18}
										className="text-on-surface-variant/30 group-hover:text-on-surface transition-colors shrink-0"
									/>
								</Link>
							))}
						</div>
					</div>
				)}

				{/* Scheduled articles */}
				<div className="space-y-4">
					<div className="flex items-center justify-between">
						<h2 className="text-lg font-medium text-on-surface">
							Publications programmées
							{scheduledData.length > 0 && (
								<span className="ml-2 text-sm font-normal text-on-surface-variant">
									({scheduled.count || 0})
								</span>
							)}
						</h2>
						<Link
							href="/dashboard/news?status=scheduled"
							className="text-sm text-primary hover:underline"
						>
							Tout voir
						</Link>
					</div>
					{scheduledData.length > 0 ? (
						<div className="rounded-[24px] bg-surface-container-low border border-outline-variant/20 overflow-hidden divide-y divide-outline-variant/10">
							{scheduledData.map((article) => (
								<Link
									key={article.id}
									href={`/dashboard/news/${article.id}`}
									className="flex items-center gap-4 p-4 hover:bg-surface-container transition-colors group"
								>
									<div className="size-10 rounded-xl flex items-center justify-center shrink-0 bg-blue-100/50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
										<Icon name="schedule" size={20} />
									</div>
									<div className="min-w-0 flex-1">
										<p className="text-sm font-medium text-on-surface truncate group-hover:text-primary transition-colors">
											{article.title}
										</p>
										<p className="text-xs text-blue-600 dark:text-blue-400">
											{article.scheduled_at
												? format(new Date(article.scheduled_at), "EEEE d MMMM à HH:mm", {
														locale: fr,
													})
												: "Date non définie"}
										</p>
									</div>
									<Icon
										name="chevron_right"
										size={18}
										className="text-on-surface-variant/30 group-hover:text-on-surface transition-colors shrink-0"
									/>
								</Link>
							))}
						</div>
					) : (
						<div className="rounded-[24px] bg-surface-container-low border border-outline-variant/20 p-8 flex flex-col items-center justify-center text-center">
							<div className="size-12 rounded-2xl bg-surface-container-high flex items-center justify-center mb-3">
								<Icon name="schedule" size={24} className="text-on-surface-variant/40" />
							</div>
							<p className="text-sm text-on-surface-variant">Aucune publication programmée</p>
							<Link
								href="/dashboard/news/new"
								className="text-xs text-primary hover:underline mt-2"
							>
								Créer un article
							</Link>
						</div>
					)}
				</div>
			</div>

			{/* ============ WIKI DATABASE STATS ============ */}
			<div className="space-y-4">
				<div className="flex items-center justify-between">
					<h2 className="text-lg font-medium text-on-surface">Base de données Wiki</h2>
					<Link href="/dashboard/database" className="text-sm text-primary hover:underline">
						Explorer
					</Link>
				</div>

				{/* Main wiki counts */}
				<div className="grid gap-3 sm:gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
					{[
						{
							count: characters.count || 0,
							href: "/dashboard/database/inagle_characters",
							icon: "person",
							label: "Personnages",
						},
						{
							count: skills.count || 0,
							href: "/dashboard/database/inagle_skills",
							icon: "flash_on",
							label: "Techniques",
						},
						{
							count: passives.count || 0,
							href: "/dashboard/database/inagle_passives",
							icon: "shield",
							label: "Passifs",
						},
						{
							count: teams.count || 0,
							href: "/dashboard/database/inagle_teams",
							icon: "groups",
							label: "Équipes",
						},
						{
							count: items.count || 0,
							href: "/dashboard/database/inagle_items",
							icon: "inventory_2",
							label: "Objets",
						},
						{
							count: formations.count || 0,
							href: "/dashboard/database/inagle_formations",
							icon: "schema",
							label: "Formations",
						},
					].map((item) => (
						<Link
							key={item.label}
							href={item.href}
							className="flex items-center gap-3 p-3 sm:p-4 rounded-[20px] bg-surface-container-low border border-outline-variant/20 hover:shadow-level-1 hover:bg-surface-container transition-all group"
						>
							<div className="size-10 rounded-xl bg-primary-container/50 text-on-primary-container flex items-center justify-center shrink-0">
								<Icon name={item.icon} size={20} />
							</div>
							<div className="min-w-0">
								<p className="text-lg font-normal text-on-surface">
									{item.count.toLocaleString("fr-FR")}
								</p>
								<p className="text-[11px] text-on-surface-variant truncate">{item.label}</p>
							</div>
						</Link>
					))}
				</div>

				{/* Detailed breakdowns in 2x2 grid */}
				<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
					{/* Characters by position */}
					<div className="rounded-[24px] bg-surface-container-low border border-outline-variant/20 p-5">
						<div className="flex items-center gap-2 mb-4">
							<Icon name="person" size={18} className="text-primary" />
							<h3 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">
								Personnages par poste
							</h3>
							<span className="ml-auto text-xs text-on-surface-variant/50">
								{(characters.count || 0).toLocaleString("fr-FR")} total
							</span>
						</div>
						<div className="space-y-2">
							{positionStats.map((pos) => {
								const pct = characters.count ? Math.round((pos.count / characters.count) * 100) : 0;
								return (
									<div key={pos.code} className="flex items-center gap-3">
										<span className="text-xs font-bold text-on-surface-variant w-20 truncate">
											{pos.label}
										</span>
										<div className="flex-1 h-2 rounded-full bg-surface-container-high overflow-hidden">
											<div
												className="h-full rounded-full bg-primary/60 transition-all"
												style={{ width: `${pct}%` }}
											/>
										</div>
										<span className="text-xs tabular-nums text-on-surface-variant/70 w-16 text-right">
											{pos.count.toLocaleString("fr-FR")}{" "}
											<span className="text-on-surface-variant/40">({pct}%)</span>
										</span>
									</div>
								);
							})}
						</div>
					</div>

					{/* Characters by element */}
					<div className="rounded-[24px] bg-surface-container-low border border-outline-variant/20 p-5">
						<div className="flex items-center gap-2 mb-4">
							<Icon name="whatshot" size={18} className="text-primary" />
							<h3 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">
								Personnages par élément
							</h3>
						</div>
						<div className="grid grid-cols-2 gap-2">
							{elementStats.map((el) => (
								<div
									key={el.id}
									className={`flex items-center gap-2.5 p-2.5 rounded-xl ${el.color}`}
								>
									<span className="text-lg font-normal">{el.count.toLocaleString("fr-FR")}</span>
									<span className="text-xs font-medium truncate">{el.label}</span>
								</div>
							))}
						</div>
					</div>

					{/* Skills by category */}
					<div className="rounded-[24px] bg-surface-container-low border border-outline-variant/20 p-5">
						<div className="flex items-center gap-2 mb-4">
							<Icon name="flash_on" size={18} className="text-primary" />
							<h3 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">
								Techniques par catégorie
							</h3>
							<span className="ml-auto text-xs text-on-surface-variant/50">
								{(skills.count || 0).toLocaleString("fr-FR")} total
							</span>
						</div>
						<div className="space-y-2">
							{skillCatStats.map((cat) => {
								const pct = skills.count ? Math.round((cat.count / skills.count) * 100) : 0;
								return (
									<div key={cat.code} className="flex items-center gap-3">
										<span className="text-xs font-bold text-on-surface-variant w-20 truncate">
											{cat.label}
										</span>
										<div className="flex-1 h-2 rounded-full bg-surface-container-high overflow-hidden">
											<div
												className="h-full rounded-full bg-tertiary/60 transition-all"
												style={{ width: `${pct}%` }}
											/>
										</div>
										<span className="text-xs tabular-nums text-on-surface-variant/70 w-16 text-right">
											{cat.count.toLocaleString("fr-FR")}{" "}
											<span className="text-on-surface-variant/40">({pct}%)</span>
										</span>
									</div>
								);
							})}
						</div>
					</div>

					{/* Skills by element */}
					<div className="rounded-[24px] bg-surface-container-low border border-outline-variant/20 p-5">
						<div className="flex items-center gap-2 mb-4">
							<Icon name="whatshot" size={18} className="text-primary" />
							<h3 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">
								Techniques par élément
							</h3>
						</div>
						<div className="grid grid-cols-2 gap-2">
							{skillElStats.map((el) => (
								<div
									key={el.id}
									className={`flex items-center gap-2.5 p-2.5 rounded-xl ${el.color}`}
								>
									<span className="text-lg font-normal">{el.count.toLocaleString("fr-FR")}</span>
									<span className="text-xs font-medium truncate">{el.label}</span>
								</div>
							))}
						</div>

						{/* Extra wiki counts */}
						<div className="mt-4 pt-3 border-t border-outline-variant/10 grid grid-cols-2 gap-2 text-xs text-on-surface-variant">
							<div className="flex items-center gap-1.5">
								<Icon name="auto_awesome" size={14} className="text-on-surface-variant/50" />
								<span>{(auras.count || 0).toLocaleString("fr-FR")} auras</span>
							</div>
							<div className="flex items-center gap-1.5">
								<Icon name="pets" size={14} className="text-on-surface-variant/50" />
								<span>{(keshins.count || 0).toLocaleString("fr-FR")} esprits g.</span>
							</div>
							<div className="flex items-center gap-1.5">
								<Icon name="sports" size={14} className="text-on-surface-variant/50" />
								<span>{(coordinators.count || 0).toLocaleString("fr-FR")} coachs</span>
							</div>
						</div>
					</div>
				</div>
			</div>

			{/* Quick access grid */}
			<div className="space-y-4">
				<h2 className="text-lg font-medium text-on-surface">Accès rapide</h2>
				<div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
					{quickLinks.map((link) => (
						<Link key={link.href} href={link.href}>
							<div className="flex items-center gap-4 p-4 sm:p-5 rounded-[24px] bg-surface-container-low border border-outline-variant/20 transition-all duration-300 hover:shadow-level-1 hover:bg-surface-container group h-full">
								<div className="size-12 rounded-[16px] bg-primary-container text-on-primary-container flex items-center justify-center shrink-0 transition-transform group-hover:scale-105 duration-300">
									<Icon name={link.icon} size={24} />
								</div>
								<div className="min-w-0 flex-1">
									<p className="font-medium text-on-surface">{link.label}</p>
									<p className="text-sm text-on-surface-variant">{link.description}</p>
								</div>
								<Icon
									name="arrow_forward"
									size={20}
									className="text-on-surface-variant/50 group-hover:text-on-surface transition-colors shrink-0"
								/>
							</div>
						</Link>
					))}
				</div>
			</div>
		</div>
	);
}
