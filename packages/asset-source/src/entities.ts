/** Typed transport for the generic read-only SQLite entity catalogue. */

export type EntityScalar = string | number | boolean | null;
export type EntityRow = Record<string, EntityScalar>;

export interface EntityColumn {
	nom: string;
	type_sql: string;
	texte: boolean;
}

export interface EntityTable {
	gisement: string;
	nom: string;
	cle: string;
	cle_implicite: boolean;
	colonnes: EntityColumn[];
	lignes: number;
}

export interface EntityPage<T> {
	elements: T[];
	page: number;
	per_page: number;
	total: number;
	pages: number;
	q?: string;
}

export interface EntityCatalog extends EntityPage<EntityTable> {
	lignes_totales: number;
	route_lignes: string;
	route_ligne: string;
}

export interface EntityFacetValue {
	value: string | null;
	count: number;
}

export interface EntityFacet {
	column: string;
	distinct: number;
	truncated: boolean;
	values: EntityFacetValue[];
}

export interface AppliedEntityFilters {
	q: string | null;
	tri: string;
	ordre: "asc" | "desc";
	egalites: Record<string, string>;
	listes: Record<string, string[]>;
	bornes: Record<string, number>;
	presences: Record<string, "present" | "absent">;
}

export interface EntityRowsPage extends EntityPage<EntityRow> {
	gisement: string;
	table: string;
	cle: string;
	filtres: AppliedEntityFilters;
	facets?: EntityFacet[];
}

/**
 * Validated by the server against the selected table schema. `filters` uses the public names
 * it publishes: `column`, `column__in`, `column__min`, `column__max`, and the presence tokens.
 */
export interface EntityRowsOptions {
	page?: number;
	perPage?: number;
	q?: string;
	sort?: string;
	order?: "asc" | "desc";
	facets?: string[];
	filters?: Readonly<Record<string, string | readonly string[] | undefined>>;
	signal?: AbortSignal;
}

const boundedPositive = (value: number | undefined, fallback: number) =>
	Number.isSafeInteger(value) && value! > 0 ? Math.min(value!, 0xffff_ffff) : fallback;

/** Canonical URL for the table catalogue. */
export function entityCatalogUrl(options: Pick<EntityRowsOptions, "page" | "perPage" | "q"> = {}): string {
	const params = new URLSearchParams();
	params.set("page", String(boundedPositive(options.page, 1)));
	params.set("per_page", String(Math.min(boundedPositive(options.perPage, 50), 200)));
	const q = options.q?.trim();
	if (q) params.set("q", q);
	return `/api/v1/entites?${params}`;
}

/** Canonical URL for a schema-backed entity query or its CSV representation. */
export function entityRowsUrl(table: string, options: EntityRowsOptions = {}, format: "json" | "csv" = "json"): string {
	const params = new URLSearchParams();
	params.set("page", String(boundedPositive(options.page, 1)));
	params.set("per_page", String(Math.min(boundedPositive(options.perPage, 50), 200)));
	const q = options.q?.trim();
	if (q) params.set("q", q);
	const sort = options.sort?.trim();
	if (sort) params.set("tri", sort);
	if (options.order === "desc") params.set("ordre", "desc");
	const facets = options.facets?.map((value) => value.trim()).filter(Boolean).slice(0, 12);
	if (facets?.length) params.set("facets", facets.join(","));
	for (const [key, raw] of Object.entries(options.filters ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
		if (!key || raw === undefined) continue;
		const value = Array.isArray(raw) ? raw.map(String).filter(Boolean).join(",") : String(raw).trim();
		if (value) params.set(key, value);
	}
	if (format === "csv") params.set("format", "csv");
	return `/api/v1/entites/${encodeURIComponent(table)}?${params}`;
}
