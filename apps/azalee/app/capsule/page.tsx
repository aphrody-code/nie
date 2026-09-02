export const dynamic = "force-dynamic";

import { Gift, Info, SearchX, Shirt } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { FadeInItem, FadeInStagger } from "@/components/ui/fade-in";
import { CapsuleCard, CostumeCard } from "@/components/wiki/GachaCard";
import { WikiPagination } from "@/components/wiki/WikiPagination";
import { WikiSearchToolbar } from "@/components/wiki/WikiSearchToolbar";
import { getCapsuleList, getCostumeList, getGachaCounts } from "@/lib/wiki/gacha";
import { cn } from "@/lib/utils";
import { parseSearchParams } from "@/lib/validations";

export const metadata: Metadata = {
	alternates: { canonical: "/capsule" },
	description:
		"Lots de capsules (gacha) et costumes d'Inazuma Eleven: Victory Road. Contenu des tirages, pools et modèles de costumes extraits directement des données du jeu.",
	title: "Capsules & Costumes | Inazuma Eleven Victory Road - Azalée",
};

const ITEMS_PER_PAGE = 48;

type Tab = "capsules" | "costumes";

function readTab(value: string | string[] | undefined): Tab {
	return value === "costumes" ? "costumes" : "capsules";
}

export default async function CapsulePage({
	searchParams,
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const rawParams = await searchParams;
	const params = parseSearchParams(rawParams);
	const page = typeof params.page === "number" ? params.page : 1;
	const q = params.q || "";
	const tab = readTab(rawParams.onglet);

	const counts = await getGachaCounts();

	const poolFilter = typeof rawParams.pool === "string" ? rawParams.pool : "";
	const rawType = typeof rawParams.type === "string" ? Number.parseInt(rawParams.type, 10) : NaN;
	const typeFilter = Number.isFinite(rawType) ? rawType : undefined;

	const capsules =
		tab === "capsules"
			? await getCapsuleList({ limit: ITEMS_PER_PAGE, page, pool: poolFilter, q })
			: null;
	const costumes =
		tab === "costumes"
			? await getCostumeList({ limit: ITEMS_PER_PAGE, page, q, type: typeFilter })
			: null;

	const total = tab === "capsules" ? (capsules?.total ?? 0) : (costumes?.total ?? 0);

	const tabHref = (next: Tab, extra?: Record<string, string>) => {
		const sp = new URLSearchParams();
		sp.set("onglet", next);
		if (extra) for (const [k, v] of Object.entries(extra)) sp.set(k, v);
		return `/capsule?${sp.toString()}`;
	};

	const collectionJsonLd = {
		"@context": "https://schema.org",
		"@type": "CollectionPage",
		description: `Lots de capsules (gacha) et costumes d'Inazuma Eleven: Victory Road. pools et modèles de costumes extraits directement des données du jeu.`,
		isPartOf: { "@type": "WebSite", name: "Azalée", url: "https://azalee.rosegriffon.fr" },
		mainEntity: {
			"@type": "ItemList",
			itemListElement: (tab === "capsules" ? capsules?.data : costumes?.data)?.slice(0, 10).map((x: any, i: number) => ({
				"@type": "ListItem",
				position: (page - 1) * ITEMS_PER_PAGE + i + 1,
				url: `https://azalee.rosegriffon.fr/capsule/${x.id}`,
				name: x.name || x.id,
			})),
			numberOfItems: total,
		},
		name: "Capsules & Costumes - Inazuma Eleven: Victory Road",
		numberOfItems: total,
		url: "https://azalee.rosegriffon.fr/capsule",
	};

	return (
		<div className="space-y-6">
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionJsonLd) }}
			/>

			{/* En-tête */}
			<div className="space-y-1">
				<h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-on-surface font-display">
					Capsules &amp; Costumes
				</h1>
				<p className="text-sm text-on-surface-variant">
					Liste complète des capsules (gacha) et costumes d&apos;Inazuma Eleven: Victory Road.
				</p>
			</div>

			{/* Onglets */}
			<div className="flex gap-2">
				<Link
					href={tabHref("capsules")}
					className={cn(
						"inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold transition-colors",
						tab === "capsules"
							? "bg-primary text-on-primary"
							: "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest"
					)}
				>
					<Gift size={16} aria-hidden="true" />
					Capsules
					<span className="text-xs opacity-70">{counts.capsules}</span>
				</Link>
				<Link
					href={tabHref("costumes")}
					className={cn(
						"inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold transition-colors",
						tab === "costumes"
							? "bg-primary text-on-primary"
							: "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest"
					)}
				>
					<Shirt size={16} aria-hidden="true" />
					Costumes
					<span className="text-xs opacity-70">{counts.costumes}</span>
				</Link>
			</div>
			{/* Recherche */}
			<WikiSearchToolbar
				placeholder={
					tab === "capsules" ? "Rechercher un lot (hash)..." : "Rechercher un costume (index/hash)..."
				}
				showFilters={false}
			/>

			<div className="flex items-center justify-between text-xs font-medium text-on-surface-variant px-1 uppercase tracking-wider">
				<span>
					{total} {tab === "capsules" ? "lots de capsules" : "costumes"}
				</span>
				<span>
					Page {page} sur {Math.max(1, Math.ceil(total / ITEMS_PER_PAGE))}
				</span>
			</div>

			{/* CAPSULES */}
			{tab === "capsules" && capsules && (
				<>
					{/* Filtre par pool de tirage */}
					{capsules.pools.length > 1 && (
						<div className="flex flex-wrap gap-1.5">
							<Link
								href={tabHref("capsules")}
								className={cn(
									"inline-flex items-center rounded-full px-3 py-1 text-xs font-bold transition-colors",
									!poolFilter
										? "bg-secondary-container text-on-secondary-container"
										: "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest"
								)}
							>
								Tous les pools
							</Link>
							{capsules.pools.map((p) => (
								<Link
									key={p.ref}
									href={tabHref("capsules", { pool: p.ref })}
									className={cn(
										"inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-xs font-bold transition-colors",
										poolFilter === p.ref
											? "bg-secondary-container text-on-secondary-container"
											: "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest"
									)}
								>
									{p.ref}
									<span className="opacity-60">{p.count}</span>
								</Link>
							))}
						</div>
					)}

					{capsules.data.length > 0 ? (
						<FadeInStagger className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
							{capsules.data.map((prize) => (
								<FadeInItem key={prize.id}>
									<CapsuleCard prize={prize} />
								</FadeInItem>
							))}
						</FadeInStagger>
					) : (
						<EmptyState label="Aucun lot trouvé." />
					)}
				</>
			)}

			{/* COSTUMES */}
			{tab === "costumes" && costumes && (
				<>
					{/* Filtre par type */}
					{costumes.types.length > 1 && (
						<div className="flex flex-wrap gap-1.5">
							<Link
								href={tabHref("costumes")}
								className={cn(
									"inline-flex items-center rounded-full px-3 py-1 text-xs font-bold transition-colors",
									typeFilter === undefined
										? "bg-secondary-container text-on-secondary-container"
										: "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest"
								)}
							>
								Tous les types
							</Link>
							{costumes.types.map((t) => (
								<Link
									key={t.type}
									href={tabHref("costumes", { type: String(t.type) })}
									className={cn(
										"inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold transition-colors",
										typeFilter === t.type
											? "bg-secondary-container text-on-secondary-container"
											: "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest"
									)}
								>
									{t.label}
									<span className="opacity-60">{t.count}</span>
								</Link>
							))}
						</div>
					)}

					{costumes.data.length > 0 ? (
						<FadeInStagger className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
							{costumes.data.map((costume) => (
								<FadeInItem key={costume.id}>
									<CostumeCard costume={costume} />
								</FadeInItem>
							))}
						</FadeInStagger>
					) : (
						<EmptyState label="Aucun costume trouvé." />
					)}
				</>
			)}

			{/* Note data (transparence anti-hallucination) */}
			<div className="flex items-start gap-2 rounded-xl border border-outline-variant/30 bg-surface-container-low p-3 text-xs text-on-surface-variant">
				<Info size={14} className="mt-0.5 shrink-0 opacity-60" aria-hidden="true" />
				<p>
					Données extraites directement du jeu (config gacha & modèles de costumes). Les contenus de
					lots et les modèles sont référencés par identifiants internes (hash) ; ils sont affichés
					tels quels, sans interprétation inventée.
				</p>
			</div>

			{/* Pagination */}
			{total > ITEMS_PER_PAGE && (
				<WikiPagination currentPage={page} totalItems={total} itemsPerPage={ITEMS_PER_PAGE} />
			)}
		</div>
	);
}

function EmptyState({ label }: { label: string }) {
	return (
		<div className="text-center py-16">
			<SearchX size={48} className="text-on-surface-variant/30 mb-4 block mx-auto" aria-hidden="true" />
			<p className="text-on-surface-variant">{label}</p>
		</div>
	);
}
