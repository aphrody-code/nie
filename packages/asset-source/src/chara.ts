/** Typed HTTP adapter for the measured `/api/v1/chara` character catalogue. */

export type CharaFacet = "element" | "position" | "rarity" | "series";
export type CharaSort = "zukan" | "code" | "nom_fr" | "nom_en" | "nom_ja" | "rarete";

export interface CharaCatalogEntry {
	internal_code: string | null;
	chara_id: string | null;
	base_slug: string | null;
	name_fr: string | null;
	name_en: string | null;
	name_ja: string | null;
	element: string | null;
	position: string | null;
	rarity: string | null;
	series: string | null;
	model_id: string | null;
	zukan_order: number | null;
}

export interface CharaCatalogOptions {
	page?: number;
	perPage?: number;
	q?: string;
	element?: string;
	position?: string;
	rarity?: string;
	series?: string;
	elements?: readonly string[];
	positions?: readonly string[];
	rarities?: readonly string[];
	seriesList?: readonly string[];
	sort?: CharaSort;
	order?: "asc" | "desc";
	signal?: AbortSignal;
}

export interface AppliedCharaFilters {
	q: string | null;
	element: string | null;
	position: string | null;
	rarity: string | null;
	series: string | null;
	tri: CharaSort;
	ordre: "asc" | "desc";
	listes: Partial<Record<`${CharaFacet}__in`, string[]>>;
}

export interface CharaFacetCount {
	valeur: string;
	total: number;
}

export interface CharaCatalogPage {
	elements: CharaCatalogEntry[];
	page: number;
	per_page: number;
	total: number;
	pages: number;
	filtres: AppliedCharaFilters;
	facettes: Partial<Record<CharaFacet, CharaFacetCount[]>>;
}

const DEFAULT_PER_PAGE = 24;

function positive(value: number | undefined, fallback: number, max: number): number {
	if (!Number.isFinite(value)) return fallback;
	return Math.min(max, Math.max(1, Math.trunc(value as number)));
}

function setExactOrList(
	params: URLSearchParams,
	key: CharaFacet,
	exact: string | undefined,
	values: readonly string[] | undefined,
): void {
	const clean = [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
	if (clean.length > 1) params.set(`${key}__in`, clean.join(","));
	else {
		const value = clean[0] ?? exact?.trim();
		if (value) params.set(key, value);
	}
}

export function charaCatalogUrl(options: CharaCatalogOptions = {}): string {
	const params = new URLSearchParams({
		page: String(positive(options.page, 1, 0xffff_ffff)),
		per_page: String(positive(options.perPage, DEFAULT_PER_PAGE, 200)),
	});
	if (options.q?.trim()) params.set("q", options.q.trim());
	setExactOrList(params, "element", options.element, options.elements);
	setExactOrList(params, "position", options.position, options.positions);
	setExactOrList(params, "rarity", options.rarity, options.rarities);
	setExactOrList(params, "series", options.series, options.seriesList);
	if (options.sort && options.sort !== "zukan") params.set("tri", options.sort);
	if (options.order === "desc") params.set("ordre", "desc");
	return `/api/v1/chara?${params}`;
}

import { fetchJson } from "./http-client";

/**
 * Temporary host adapter: the generic `AssetSource` intentionally does not own entity-specific
 * HTTP. `PlayerBank` calls this only for the measured web source; native remains local/IPC.
 */
export async function fetchCharaCatalog(options: CharaCatalogOptions = {}): Promise<CharaCatalogPage> {
	const url = charaCatalogUrl(options);
	return fetchJson<CharaCatalogPage>(url, { signal: options.signal });
}
