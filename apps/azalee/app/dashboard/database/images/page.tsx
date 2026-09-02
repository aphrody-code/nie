import { ChevronLeft, ChevronRight, ImageOff, List, Star, Users } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type React from "react";
import { AdminPageHeader as DashboardPageHeader, Badge } from "@rosegriffon/ui";
import { createClient } from "@/lib/supabase/server";
import { Icon } from "@/components/ui/Icon";

export const dynamic = "force-dynamic";

interface CharRow {
	id: string;
	name_fr: string | null;
	name_en: string | null;
	chara_id: string | null;
	internal_code: string | null;
	rarity_label: string | null;
	rarity: number;
	position: string | null;
	element: string | null;
	zukan_hash: string | null;
	image_url: string | null;
	slug: string | null;
	constellation: string | null;
}

const SELECT_COLS =
	"id, name_fr, name_en, chara_id, internal_code, rarity_label, rarity, position, element, zukan_hash, image_url, slug, constellation";

function getImageUrl(row: CharRow): string {
	if (row.zukan_hash) {
		return `https://dxi4wb638ujep.cloudfront.net/1/${row.zukan_hash}.png`;
	}
	if (row.image_url) {
		return row.image_url.startsWith("http")
			? row.image_url
			: `https://azalee.rosegriffon.fr/storage/v1/object/public/menu/${row.image_url}`;
	}
	return "";
}

export default async function ImageValidationPage({
	searchParams,
}: {
	searchParams: Promise<{ filter?: string; page?: string }>;
}) {
	const { filter = "multi_versions", page: pageStr = "1" } = await searchParams;
	const page = Math.max(1, Number.parseInt(pageStr, 10) || 1);
	const perPage = 50;

	const supabase = await createClient();
	const db = supabase as any;

	let characters: CharRow[] = [];
	let totalCount: number;
	let title: string;
	let subtitle: string;

	if (filter === "multi_versions") {
		// Get chara_ids that have at least one BASARA version
		const { data: basaraRows } = await db
			.from("inagle_characters")
			.select("chara_id")
			.eq("rarity", 20);

		const charaIds = [
			...new Set((basaraRows || []).map((r: any) => r.chara_id).filter(Boolean)),
		] as string[];
		totalCount = charaIds.length;

		const pagedIds = charaIds.slice((page - 1) * perPage, page * perPage);

		if (pagedIds.length > 0) {
			const { data } = await db
				.from("inagle_characters")
				.select(SELECT_COLS)
				.in("chara_id", pagedIds)
				.order("chara_id")
				.order("rarity", { ascending: false });
			characters = (data || []) as CharRow[];
		}
		title = "Personnages multi-versions";
		subtitle = `${totalCount} groupes de personnages avec BASARA`;
	} else if (filter === "no_image") {
		const { data, count } = await db
			.from("inagle_characters")
			.select(SELECT_COLS, { count: "exact" })
			.is("zukan_hash", null)
			.order("name_fr")
			.range((page - 1) * perPage, page * perPage - 1);
		characters = (data || []) as CharRow[];
		totalCount = count || 0;
		title = "Sans image Zukan";
		subtitle = `${totalCount} personnages sans hash Zukan`;
	} else if (filter === "no_constellation") {
		const { data, count } = await db
			.from("inagle_characters")
			.select(SELECT_COLS, { count: "exact" })
			.is("constellation", null)
			.order("rarity", { ascending: false })
			.order("name_fr")
			.range((page - 1) * perPage, page * perPage - 1);
		characters = (data || []) as CharRow[];
		totalCount = count || 0;
		title = "Sans constellation";
		subtitle = `${totalCount} personnages sans constellation`;
	} else {
		const { data, count } = await db
			.from("inagle_characters")
			.select(SELECT_COLS, { count: "exact" })
			.order("rarity", { ascending: false })
			.order("name_fr")
			.range((page - 1) * perPage, page * perPage - 1);
		characters = (data || []) as CharRow[];
		totalCount = count || 0;
		title = "Toutes les images";
		subtitle = `${totalCount} personnages au total`;
	}

	// Group by chara_id for multi-version display
	const grouped = new Map<string, CharRow[]>();
	for (const c of characters) {
		const key = c.chara_id || c.id;
		if (!grouped.has(key)) {
			grouped.set(key, []);
		}
		grouped.get(key)!.push(c);
	}

	const totalPages = Math.ceil(totalCount / perPage);

	const filterOptions: Array<{
		value: string;
		label: string;
		icon: React.ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean }>;
	}> = [
		{ icon: Users, label: "Multi-versions", value: "multi_versions" },
		{ icon: ImageOff, label: "Sans image", value: "no_image" },
		{ icon: Star, label: "Sans constellation", value: "no_constellation" },
		{ icon: List, label: "Tout", value: "all" },
	];

	return (
		<div className="space-y-6 sm:space-y-8">
			<DashboardPageHeader
				breadcrumbs={[
					{ href: "/dashboard", label: "Tableau de bord" },
					{ href: "/dashboard/database", label: "Base de données" },
					{ label: "Validation images" },
				]}
				title={title}
				subtitle={subtitle}
				icon={<Icon name="image_search" size={20} />}
			/>

			{/* Filters */}
			<div className="flex flex-wrap gap-2">
				{filterOptions.map((f) => (
					<Link
						key={f.value}
						href={`/dashboard/database/images?filter=${f.value}`}
						className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-bold transition-all ${
							filter === f.value
								? "bg-primary text-on-primary shadow-md"
								: "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest"
						}`}
					>
						<f.icon size={16} aria-hidden />
						{f.label}
					</Link>
				))}
			</div>

			{/* Character Grid */}
			<div className="space-y-6">
				{[...grouped.entries()].map(([charaId, rows]) => {
					const hasBasara = rows.some((r) => r.rarity >= 20);
					const zukanHashes = new Set(rows.map((r) => r.zukan_hash).filter(Boolean));
					const allSameImage = zukanHashes.size <= 1;
					const missingImages = rows.filter((r) => !r.zukan_hash);

					return (
						<div
							key={charaId}
							className={`rounded-[20px] border p-4 sm:p-6 space-y-3 ${
								hasBasara
									? "border-purple-400/40 bg-purple-500/5"
									: missingImages.length > 0
										? "border-amber-400/40 bg-amber-500/5"
										: "border-outline-variant/30 bg-surface-container-lowest"
							}`}
						>
							{/* Group Header */}
							<div className="flex items-center gap-2 flex-wrap">
								<span className="font-black text-on-surface">
									{rows[0].name_fr || rows[0].name_en || "???"}
								</span>
								<span className="text-xs font-mono text-on-surface-variant">{charaId}</span>
								{hasBasara && (
									<Badge className="bg-linear-to-r from-[#4facfe] via-[#7367f0] to-[#9733ee] text-white border-none text-[10px] font-black">
										BASARA
									</Badge>
								)}
								{missingImages.length > 0 && (
									<Badge
										variant="outline"
										className="text-amber-600 border-amber-400 text-[10px] font-bold"
									>
										{missingImages.length} sans image
									</Badge>
								)}
								{!allSameImage && rows.length > 1 && (
									<Badge
										variant="outline"
										className="text-red-600 border-red-400 text-[10px] font-bold"
									>
										Images différentes
									</Badge>
								)}
							</div>

							{/* Variants Grid */}
							<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
								{rows.map((row) => {
									const imgUrl = getImageUrl(row);
									return (
										<div
											key={row.id}
											className="flex flex-col items-center gap-2 p-2 rounded-xl bg-surface-container-low/50"
										>
											<div className="relative size-16 rounded-xl overflow-hidden bg-surface-container-highest">
												{imgUrl ? (
													<Image
														src={imgUrl}
														alt={row.name_fr || ""}
														fill
														className="object-cover object-top"
														sizes="64px"
														unoptimized
													/>
												) : (
													<div className="w-full h-full flex items-center justify-center">
														<ImageOff
															size={20}
															className="text-on-surface-variant"
															aria-hidden="true"
														/>
													</div>
												)}
											</div>
											<div className="text-center space-y-0.5">
												<div className="flex items-center gap-1 justify-center">
													<Badge
														variant="outline"
														className={`text-[9px] font-bold ${
															row.rarity >= 20
																? "bg-purple-500/20 text-purple-400 border-purple-400/30"
																: row.rarity >= 10
																	? "bg-amber-500/20 text-amber-600 border-amber-400/30"
																	: "bg-slate-500/10 text-on-surface-variant border-outline-variant/30"
														}`}
													>
														{row.rarity_label || "N"}
													</Badge>
													{row.position && (
														<span className="text-[9px] font-bold text-on-surface-variant">
															{row.position}
														</span>
													)}
													{row.element && (
														<span className="text-[9px] text-on-surface-variant">
															{row.element}
														</span>
													)}
												</div>
												<div
													className="text-[9px] font-mono text-on-surface-variant truncate max-w-[100px]"
													title={row.id}
												>
													{row.id}
												</div>
												{row.constellation && (
													<div
														className="text-[9px] text-purple-500 truncate max-w-[100px]"
														title={row.constellation}
													>
														{row.constellation}
													</div>
												)}
												{!row.zukan_hash && (
													<span className="text-[9px] text-amber-500 font-bold">Pas de zukan</span>
												)}
											</div>
											<Link
												href={`/chara/${row.slug || row.id}`}
												className="text-[10px] text-primary hover:underline font-bold"
												target="_blank"
											>
												Voir
											</Link>
										</div>
									);
								})}
							</div>
						</div>
					);
				})}
			</div>

			{/* Pagination */}
			{totalPages > 1 && (
				<div className="flex items-center justify-center gap-2">
					{page > 1 && (
						<Link
							href={`/dashboard/database/images?filter=${filter}&page=${page - 1}`}
							className="inline-flex items-center gap-1 px-4 py-2 rounded-full bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest text-sm font-bold transition-all"
						>
							<ChevronLeft size={16} aria-hidden="true" />
							Précédent
						</Link>
					)}
					<span className="text-sm text-on-surface-variant font-bold">
						Page {page} / {totalPages}
					</span>
					{page < totalPages && (
						<Link
							href={`/dashboard/database/images?filter=${filter}&page=${page + 1}`}
							className="inline-flex items-center gap-1 px-4 py-2 rounded-full bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest text-sm font-bold transition-all"
						>
							Suivant
							<ChevronRight size={16} aria-hidden="true" />
						</Link>
					)}
				</div>
			)}
		</div>
	);
}
