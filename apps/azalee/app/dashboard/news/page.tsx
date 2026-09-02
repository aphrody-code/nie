import Link from "next/link";
import {
	AdminPageHeader as DashboardPageHeader,
	Button,
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@rosegriffon/ui";
import { NewsListClient } from "@/components/dashboard/news/NewsListClient";
import { Icon } from "@/components/ui/Icon";
import { WikiPagination } from "@/components/wiki/WikiPagination";
import { sanitizeNewsSearchQuery } from "@/lib/news-search";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseSearchParams } from "@/lib/validations";
import { DriveImportButton } from "./drive-actions-client";
import { NewsFilters } from "./NewsFilters";

const STATUS_LABELS: Record<string, { plural: string; suffix: string }> = {
	archived: { plural: "archivés", suffix: "archivé" },
	draft: { plural: "brouillons", suffix: "en brouillon" },
	published: { plural: "publiés", suffix: "publié" },
	scheduled: { plural: "programmés", suffix: "programmé" },
};

export default async function NewsListPage({
	searchParams,
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const rawParams = await searchParams;
	const params = parseSearchParams(rawParams);
	const { q, page: currentPage, status, view, sort, category } = params;
	const authorParam = typeof rawParams.author === "string" ? rawParams.author : null;
	const itemsPerPage = (params.perPage as number | undefined) ?? 20;
	const supabase = createAdminClient();

	// Validate status filter
	const validStatuses = ["published", "draft", "scheduled", "archived"];
	const statusFilter = status && validStatuses.includes(status) ? status : null;

	// Validate category filter
	const validCategories = ["announcement", "event", "critique", "community"];
	const categoryFilter = category && validCategories.includes(category) ? category : null;

	// Sort config — support all 4 sort options
	const validSortFields = ["created_at", "published_at", "updated_at", "view_count"];
	const sortField = sort && validSortFields.includes(sort) ? sort : "created_at";
	const ascending = false;

	// Search term : full-text si on a des tokens utilisables, sinon ilike
	const searchTerm = sanitizeNewsSearchQuery(q);

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const client = supabase as any;

	const applyFilters = (query: ReturnType<typeof client.from>) => {
		let q2 = query;
		if (searchTerm) {
			q2 = q2.textSearch("search_vector", searchTerm, { config: "french" });
		} else if (q) {
			q2 = q2.ilike("title", `%${q}%`);
		}
		if (statusFilter) {
			q2 = q2.eq("status", statusFilter);
		}
		if (categoryFilter) {
			q2 = q2.eq("category", categoryFilter);
		}
		if (authorParam) {
			q2 = q2.eq("author_id", authorParam);
		}
		return q2;
	};

	const [countResult, dataResult, authorsResult] = await Promise.all([
		applyFilters(
			client.from("articles").select("*", { count: "exact", head: true }).eq("app", "azalee")
		),
		applyFilters(client.from("articles").select("*").eq("app", "azalee"))
			.order(sortField, { ascending })
			.range((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage - 1),
		client.from("articles").select("author_id").eq("app", "azalee").not("author_id", "is", null),
	]);

	const totalItems = countResult.count || 0;
	const rawNews = dataResult.data;

	if (dataResult.error) {
		console.error("Error fetching news:", dataResult.error);
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const allAuthorIds = [
		...new Set(
			(authorsResult.data || [])
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				.map((a: any) => a.author_id)
				.filter(Boolean)
		),
	] as string[];

	let profileMap = new Map<string, { id: string; username: string; full_name: string }>();
	if (allAuthorIds.length > 0) {
		const { data: profiles } = await client
			.from("profiles")
			.select("id, username, full_name")
			.in("id", allAuthorIds);
		profileMap = new Map(
			(profiles || []).map((p: { id: string; username: string; full_name: string }) => [p.id, p])
		);
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let news = rawNews as any[] | null;
	if (news && news.length > 0) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		news = news.map((n: any) => ({
			...n,
			author: profileMap.get(n.author_id) || null,
		}));
	}

	const authorsList = [...profileMap.values()]
		.map((p) => ({ id: p.id, name: p.full_name || p.username || "Sans nom" }))
		.toSorted((a, b) => a.name.localeCompare(b.name));

	const isListView = view === "list";
	const rangeStart = totalItems > 0 ? (currentPage - 1) * itemsPerPage + 1 : 0;
	const rangeEnd = Math.min(currentPage * itemsPerPage, totalItems);

	const statusLabel = statusFilter ? STATUS_LABELS[statusFilter] : null;
	const headerSubtitle = statusLabel
		? `${totalItems} article${totalItems !== 1 ? "s" : ""} (${statusLabel.plural})`
		: `${totalItems} article${totalItems !== 1 ? "s" : ""}`;
	const emptySubtitle = statusLabel
		? `Aucun article ${statusLabel.suffix} trouvé.`
		: "La liste des actualités est vide. Commencez par créer votre premier article ou importez un thread.";

	return (
		<div className="space-y-6 sm:space-y-8">
			<DashboardPageHeader
				breadcrumbs={[{ href: "/dashboard", label: "Tableau de bord" }, { label: "Actualités" }]}
				title="Actualités"
				subtitle={headerSubtitle}
				icon={<Icon name="newspaper" size={20} />}
				actions={
					<>
						<DriveImportButton />
						<Button
							asChild
							size="lg"
							className="rounded-full h-12 px-6 sm:px-8 bg-primary text-on-primary hover:bg-primary/90 font-medium shadow-md hover:shadow-lg transition-all"
						>
							<Link href="/dashboard/news/new">
								<Icon name="add" size={20} className="mr-2" />
								<span className="hidden sm:inline">Nouvel Article</span>
								<span className="sm:hidden">Nouveau</span>
							</Link>
						</Button>
					</>
				}
			/>

			<NewsFilters
				totalItems={totalItems}
				rangeStart={rangeStart}
				rangeEnd={rangeEnd}
				authors={authorsList}
			/>

			{news && (news as unknown[]).length > 0 ? (
				<NewsListClient items={news as unknown[]} isListView={isListView} />
			) : (
				<Empty className="col-span-full border-outline-variant/20 py-20 sm:py-28">
					<EmptyHeader>
						<EmptyMedia
							variant="icon"
							className="size-16 rounded-[24px] bg-surface-container-high shadow-inner sm:size-20 sm:rounded-[32px]"
						>
							<Icon name="description" size={36} className="text-on-surface-variant/50" />
						</EmptyMedia>
						<EmptyTitle className="text-on-surface text-xl sm:text-2xl">
							Aucun article pour le moment
						</EmptyTitle>
						<EmptyDescription className="max-w-md text-on-surface-variant">
							{emptySubtitle}
						</EmptyDescription>
					</EmptyHeader>
					<EmptyContent>
						<Button
							asChild
							className="h-12 rounded-full bg-primary px-6 text-on-primary hover:bg-primary/90 sm:px-8"
						>
							<Link href="/dashboard/news/new">
								<Icon name="add" size={18} />
								Créer un article
							</Link>
						</Button>
					</EmptyContent>
				</Empty>
			)}

			<WikiPagination
				totalItems={totalItems}
				itemsPerPage={itemsPerPage}
				currentPage={currentPage}
			/>
		</div>
	);
}
