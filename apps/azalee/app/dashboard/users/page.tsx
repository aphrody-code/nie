import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { Calendar, Mail, MessageSquare, Shield, UserX } from "lucide-react";
import {
	AdminPageHeader as DashboardPageHeader,
	Avatar,
	AvatarFallback,
	AvatarImage,
	Badge,
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@rosegriffon/ui";
import { Icon } from "@/components/ui/Icon";
import { WikiPagination } from "@/components/wiki/WikiPagination";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseSearchParams } from "@/lib/validations";
import { UserActions } from "./UserActions";
import { UsersFilters } from "./UsersFilters";

const ITEMS_PER_PAGE = 20;
const ROLE_LABELS: Record<string, string> = {
	admin: "Admin",
	editor: "Éditeur",
	member: "Membre",
	moderator: "Modérateur",
	superadmin: "Super Admin",
};

export default async function UsersPage({
	searchParams,
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const params = await searchParams;
	const { page: currentPage, q } = parseSearchParams(params);
	const role = typeof params.role === "string" ? params.role : "";
	// Filtres et colonnes personnelles (email, full_name) : service-role, après le garde admin.
	const supabase = createAdminClient();

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const client = supabase as any;

	// Count
	let countQuery = client.from("profiles").select("id", { count: "exact", head: true });
	if (q) {
		countQuery = countQuery.or(`username.ilike.%${q}%,email.ilike.%${q}%,full_name.ilike.%${q}%`);
	}
	if (role) {
		countQuery = countQuery.eq("role", role);
	}
	const { count } = await countQuery;
	const totalItems = count || 0;

	// Data
	let query = client
		.from("profiles")
		.select("*")
		.order("updated_at", { ascending: false })
		.range((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE - 1);

	if (q) {
		query = query.or(`username.ilike.%${q}%,email.ilike.%${q}%,full_name.ilike.%${q}%`);
	}
	if (role) {
		query = query.eq("role", role);
	}

	// Article counts per author (all azalee articles)
	const [{ data: profiles, error }, { data: articleCounts }] = await Promise.all([
		query,
		client.from("articles").select("author_id").eq("app", "azalee"),
	]);

	if (error) {
		console.error("Error fetching profiles:", error);
	}

	// Build article count map
	const articleCountMap = new Map<string, number>();
	if (articleCounts) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		for (const a of articleCounts as any[]) {
			if (a.author_id) {
				articleCountMap.set(a.author_id, (articleCountMap.get(a.author_id) || 0) + 1);
			}
		}
	}

	return (
		<div className="space-y-6 sm:space-y-8">
			<DashboardPageHeader
				breadcrumbs={[{ href: "/dashboard", label: "Tableau de bord" }, { label: "Utilisateurs" }]}
				title="Communauté"
				subtitle={`${totalItems} membre${totalItems !== 1 ? "s" : ""}`}
				icon={<Icon name="group" size={20} />}
			/>

			{/* Search & role filters */}
			<UsersFilters totalItems={totalItems} currentRole={role} />

			<div className="rounded-[24px] sm:rounded-[32px] border border-outline-variant/30 overflow-hidden bg-surface-container-lowest shadow-sm">
				<div className="overflow-x-auto">
					<Table>
						<TableHeader className="bg-surface-container-low/50">
							<TableRow className="border-outline-variant/10 hover:bg-transparent">
								<TableHead className="min-w-[250px] px-4 sm:px-8 h-12 sm:h-14 text-[10px] font-black uppercase tracking-widest text-on-surface-variant whitespace-nowrap">
									Utilisateur
								</TableHead>
								<TableHead className="min-w-[100px] h-12 sm:h-14 text-[10px] font-black uppercase tracking-widest text-on-surface-variant whitespace-nowrap">
									Rôle
								</TableHead>
								<TableHead className="min-w-[80px] h-12 sm:h-14 text-[10px] font-black uppercase tracking-widest text-on-surface-variant whitespace-nowrap hidden sm:table-cell">
									Articles
								</TableHead>
								<TableHead className="min-w-[150px] h-12 sm:h-14 text-[10px] font-black uppercase tracking-widest text-on-surface-variant whitespace-nowrap hidden md:table-cell">
									Discord
								</TableHead>
								<TableHead className="min-w-[120px] h-12 sm:h-14 text-[10px] font-black uppercase tracking-widest text-on-surface-variant whitespace-nowrap hidden lg:table-cell">
									Mise à jour
								</TableHead>
								<TableHead className="text-right px-4 sm:px-8 h-12 sm:h-14 text-[10px] font-black uppercase tracking-widest text-on-surface-variant whitespace-nowrap">
									Actions
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{profiles && (profiles as any[]).length > 0 ? (
								// eslint-disable-next-line @typescript-eslint/no-explicit-any
								(profiles as any[]).map((profile: any) => {
									const userArticleCount = articleCountMap.get(profile.id) || 0;
									return (
										<TableRow
											key={profile.id}
											className="border-outline-variant/5 hover:bg-surface-container-low/50 transition-all duration-300"
										>
											<TableCell className="px-4 sm:px-8 py-4 sm:py-5">
												<div className="flex items-center gap-2 sm:gap-4">
													<Avatar className="size-10 sm:size-12 rounded-2xl border-2 border-background ring-1 ring-outline-variant/20 shadow-sm shrink-0">
														<AvatarImage
															src={profile.avatar_url || undefined}
															className="object-cover"
														/>
														<AvatarFallback className="bg-secondary-container text-secondary font-black text-base sm:text-lg">
															{profile.username?.charAt(0).toUpperCase() || "?"}
														</AvatarFallback>
													</Avatar>
													<div className="flex flex-col min-w-0">
														<span className="font-black font-sans text-on-surface text-sm sm:text-base tracking-tight leading-tight truncate">
															{profile.full_name || profile.username}
														</span>
														<span className="text-xs text-on-surface-variant font-medium flex items-center gap-1.5 mt-0.5 opacity-70 truncate">
															<Mail size={12} aria-hidden="true" />{" "}
															<span className="truncate">{profile.email || "—"}</span>
														</span>
													</div>
												</div>
											</TableCell>
											<TableCell>
												<Badge
													className={`
                        rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest border-none shadow-sm
                        ${
													profile.role === "admin" || profile.role === "superadmin"
														? "bg-primary text-on-primary"
														: profile.role === "moderator"
															? "bg-tertiary text-on-tertiary"
															: profile.role === "editor"
																? "bg-secondary-container text-on-secondary-container"
																: "bg-surface-container-highest text-on-surface-variant"
												}
                      `}
												>
													{(profile.role === "admin" || profile.role === "superadmin") && (
														<Shield size={12} className="mr-1.5" aria-hidden="true" />
													)}
													{ROLE_LABELS[profile.role] || profile.role}
												</Badge>
											</TableCell>
											<TableCell className="hidden sm:table-cell">
												{userArticleCount > 0 ? (
													<span className="inline-flex items-center gap-1.5 text-sm font-bold text-on-surface">
														<Icon name="article" size={16} className="opacity-60" />
														{userArticleCount}
													</span>
												) : (
													<span className="text-[10px] font-black text-on-surface-variant/30 uppercase tracking-widest italic">
														—
													</span>
												)}
											</TableCell>
											<TableCell className="hidden md:table-cell">
												{profile.discord_id ? (
													<div className="flex items-center gap-2 text-[#5865F2] font-bold text-xs sm:text-sm bg-[#5865F2]/5 px-2 sm:px-3 py-1 rounded-full w-fit">
														<MessageSquare size={16} fill="currentColor" aria-hidden="true" />
														<span className="hidden lg:inline">{profile.username}</span>
													</div>
												) : (
													<span className="text-[10px] font-black text-on-surface-variant/30 uppercase tracking-widest italic ml-2">
														—
													</span>
												)}
											</TableCell>
											<TableCell className="hidden lg:table-cell">
												<div className="flex items-center gap-2 text-xs font-bold text-on-surface-variant opacity-60">
													<Calendar size={14} aria-hidden="true" />
													<span className="whitespace-nowrap">
														{profile.updated_at
															? format(new Date(profile.updated_at), "d MMM yyyy", { locale: fr })
															: "—"}
													</span>
												</div>
											</TableCell>
											<TableCell className="text-right px-4 sm:px-8">
												<UserActions profile={profile} />
											</TableCell>
										</TableRow>
									);
								})
							) : (
								<TableRow>
									<TableCell
										colSpan={6}
										className="py-24 sm:py-32 text-center bg-surface-container-lowest"
									>
										<div className="flex flex-col items-center gap-3 px-4 text-on-surface-variant sm:gap-4">
											<UserX size={48} className="text-on-surface-variant/40" aria-hidden="true" />
											<p className="font-black font-sans uppercase tracking-tighter text-base sm:text-lg">
												Aucun utilisateur
											</p>
											<p className="text-xs sm:text-sm font-medium">
												Aucun membre n&apos;a été trouvé pour cette requête.
											</p>
										</div>
									</TableCell>
								</TableRow>
							)}
						</TableBody>
					</Table>
				</div>
			</div>

			<WikiPagination
				totalItems={totalItems}
				itemsPerPage={ITEMS_PER_PAGE}
				currentPage={currentPage}
			/>
		</div>
	);
}
