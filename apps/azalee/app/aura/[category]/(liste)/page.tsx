import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AURAS_PAR_PAGE, AuraList } from "@/components/wiki/AuraList";
import { buildCanonical, LIST_CANONICAL_KEYS } from "@/lib/seo";
import { parseSearchParams } from "@/lib/validations";
import { wikiService } from "@/lib/wiki-service";

export const dynamic = "force-dynamic";

const CATEGORIES = {
	"changement-mode": { title: "Changement de Mode", type: "ModeChange" },
	"esprits-guerriers": { title: "Esprits Guerriers", type: "Keshin" },
	eveil: { title: "Éveil", type: "Awakening" },
	miximax: { title: "Miximax", type: "Miximax" },
	totems: { title: "Totems", type: "Soul" },
} as const;

type CategoryKey = keyof typeof CATEGORIES;

/**
 * Numéro de page issu de l'URL. `?page=abc` remonte en NaN du schéma zod
 * (`Math.max(1, NaN)` vaut NaN) : sans ce garde-fou, le NaN partait jusqu'au
 * `OFFSET` de la requête et jusqu'au titre de la page.
 */
function numeroDePage(valeur: unknown): number {
	const n = Number(valeur);
	return Number.isFinite(n) ? Math.max(1, Math.trunc(n)) : 1;
}

export async function generateMetadata({
	params,
	searchParams,
}: {
	params: Promise<{ category: string }>;
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
	const { category } = await params;
	const rawParams = await searchParams;
	const { q, page, element } = parseSearchParams(rawParams);

	const config = CATEGORIES[category as CategoryKey];
	if (!config) {
		return { title: "Non trouvé" };
	}

	let { title } = config;
	const filters: string[] = [];

	if (q) {
		filters.push(`"${q}"`);
	}
	if (element) {
		filters.push(`Élément ${element}`);
	}

	if (filters.length > 0) {
		title += ` : ${filters.join(" ")}`;
	}

	const pageNum = numeroDePage(page);
	if (pageNum > 1) {
		title += ` (Page ${pageNum})`;
	}

	return {
		alternates: {
			canonical: buildCanonical(`/aura/${category}`, rawParams, LIST_CANONICAL_KEYS),
		},
		description: `Liste complète des ${config.title.toLowerCase()}${filters.length > 0 ? ` filtrée par ${filters.join(", ")}` : ""}.`,
		title: `${title} | Inazuma Eleven Victory Road - Azalée`,
	};
}

export async function generateStaticParams() {
	return Object.keys(CATEGORIES).map((category) => ({ category }));
}

export default async function AuraCategoryPage({
	params,
	searchParams,
}: {
	params: Promise<{ category: string }>;
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const { category } = await params;
	const config = CATEGORIES[category as CategoryKey];

	if (!config) {
		notFound();
	}

	const rawParams = await searchParams;
	const search = parseSearchParams(rawParams);
	const { q, page, element } = search;
	const pageNumber = page ? Number.parseInt(page.toString(), 10) : 1;

	// Data First: Fetch paginated from DB
	const { data: auras, total } = await wikiService.getAurasList({
		element: element?.toString(),
		limit: 48, // Match AuraList grid
		page: pageNumber,
		q: q?.toString(),
		typeSlug: category,
	});

	return (
		<div className="w-full space-y-8">
			<div className="flex flex-col gap-2">
				<h1 className="text-2xl sm:text-3xl font-bold font-grade-high">{config.title}</h1>
				<p className="text-on-surface-variant">{total} résultats trouvés</p>
			</div>

			<AuraList auras={auras} category={category} total={total} page={pageNumber} />
		</div>
	);
}
