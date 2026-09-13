import type {
	AppliedEntityFilters,
	EntityCatalog,
	EntityColumn,
	EntityRowsOptions,
	EntityRowsPage,
	EntityTable,
} from "@niers/asset-source";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { browserLocationSnapshot, subscribeBrowserLocation, writeBrowserHistory } from "../lib/browser-navigation";
import { useAssetSource } from "../source";
import { GameCountBadge } from "../components/game/GameCountBadge";
import { GameHeaderBar } from "../components/game/GameHeaderBar";
import { GameSearchBar } from "../components/game/GameSearchBar";
import { GLYPHES } from "../shell/menu-screen";
import { Button } from "../components/ui/button";
import { PaginationControls } from "../components/ui/pagination-controls";

const DECODED_PARAMS = ["decoded_family", "decoded_q", "decoded_tri", "decoded_order", "decoded_view"] as const;
const RESERVED = new Set(["surface", ...DECODED_PARAMS, "table", "catalog_page", "table_q", "page", "per_page", "q", "tri", "ordre", "facets"]);
const PAGE_SIZES = [25, 50, 100, 200] as const;
type Operator = "equal" | "in" | "min" | "max" | "present" | "absent";

interface UrlState {
	table: string;
	catalogPage: number;
	tableQuery: string;
	page: number;
	perPage: number;
	q: string;
	sort: string;
	order: "asc" | "desc";
	facets: string[];
	filters: Record<string, string>;
}

const positive = (raw: string | null, fallback: number) => {
	const value = Number(raw);
	return Number.isSafeInteger(value) && value > 0 ? value : fallback;
};

export function entityStateFromUrl(search: string): UrlState {
	const params = new URLSearchParams(search);
	const filters: Record<string, string> = {};
	for (const [key, value] of params) if (!RESERVED.has(key) && value) filters[key] = value;
	const requestedSize = positive(params.get("per_page"), 50);
	return {
		table: params.get("table")?.trim() ?? "",
		catalogPage: positive(params.get("catalog_page"), 1),
		tableQuery: params.get("table_q")?.trim() ?? "",
		page: positive(params.get("page"), 1),
		perPage: PAGE_SIZES.includes(requestedSize as (typeof PAGE_SIZES)[number]) ? requestedSize : 50,
		q: params.get("q") ?? "",
		sort: params.get("tri")?.trim() ?? "",
		order: params.get("ordre") === "desc" ? "desc" : "asc",
		facets: (params.get("facets") ?? "").split(",").map((value) => value.trim()).filter(Boolean).slice(0, 12),
		filters,
	};
}

function writeState(next: UrlState) {
	const url = new URL(window.location.href);
	const surface = url.searchParams.get("surface");
	const decoded = DECODED_PARAMS.map((key) => [key, url.searchParams.get(key)] as const);
	url.search = "";
	if (surface) url.searchParams.set("surface", surface);
	for (const [key, value] of decoded) if (value) url.searchParams.set(key, value);
	const values: Array<[string, string | number]> = [
		["table", next.table], ["catalog_page", next.catalogPage === 1 ? "" : next.catalogPage],
		["table_q", next.tableQuery], ["page", next.page === 1 ? "" : next.page],
		["per_page", next.perPage === 50 ? "" : next.perPage], ["q", next.q],
		["tri", next.sort], ["ordre", next.order === "asc" ? "" : next.order],
		["facets", next.facets.join(",")],
	];
	for (const [key, value] of values) if (value !== "") url.searchParams.set(key, String(value));
	for (const [key, value] of Object.entries(next.filters).sort(([a], [b]) => a.localeCompare(b))) {
		if (value) url.searchParams.set(key, value);
	}
	writeBrowserHistory(url, window.history.state, "replace");
}

function rowsOptions(state: UrlState): EntityRowsOptions {
	return {
		page: state.page,
		perPage: state.perPage,
		q: state.q,
		sort: state.sort,
		order: state.order,
		facets: state.facets,
		filters: state.filters,
	};
}

function appliedSummary(filters: AppliedEntityFilters): string[] {
	const out = [`tri ${filters.tri} ${filters.ordre}`];
	if (filters.q) out.unshift(`recherche « ${filters.q} »`);
	for (const [key, value] of Object.entries(filters.egalites)) out.push(`${key} = ${value}`);
	for (const [key, value] of Object.entries(filters.listes)) out.push(`${key} ∈ ${value.join(", ")}`);
	for (const [key, value] of Object.entries(filters.bornes)) out.push(`${key} = ${value}`);
	for (const [key, value] of Object.entries(filters.presences)) out.push(`${key} ${value}`);
	return out;
}

function filterKey(column: string, operator: Operator): string {
	if (operator === "in") return `${column}__in`;
	if (operator === "min" || operator === "max") return `${column}__${operator}`;
	return column;
}

function scalar(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (typeof value === "object") return JSON.stringify(value);
	return String(value);
}

/**
 * Generic database surface. The server-published schema owns columns, legal sort keys and
 * facets; this component owns only interaction and URL state.
 */
export function EntityExplorer() {
	const source = useAssetSource();
	const location = useSyncExternalStore(subscribeBrowserLocation, browserLocationSnapshot, browserLocationSnapshot);
	const state = useMemo(() => entityStateFromUrl(new URL(location, "http://localhost").search), [location]);
	const setState = (patch: Partial<UrlState>) => writeState({ ...entityStateFromUrl(window.location.search), ...patch });
	const [catalog, setCatalog] = useState<EntityCatalog | null>(null);
	const [schema, setSchema] = useState<EntityTable | null>(null);
	const [rows, setRows] = useState<EntityRowsPage | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [queryInput, setQueryInput] = useState(state.q);
	const [tableInput, setTableInput] = useState(state.tableQuery);
	const [column, setColumn] = useState("");
	const [operator, setOperator] = useState<Operator>("equal");
	const [filterValue, setFilterValue] = useState("");

	useEffect(() => setQueryInput(state.q), [state.q]);
	useEffect(() => setTableInput(state.tableQuery), [state.tableQuery]);

	useEffect(() => {
		if (!source.entityCatalog) return;
		const ac = new AbortController();
		setError(null);
		source.entityCatalog({ page: state.catalogPage, perPage: 50, q: state.tableQuery, signal: ac.signal })
			.then((value) => {
				if (ac.signal.aborted) return;
				setCatalog(value);
				if (!state.table && value.elements[0]) setState({ table: value.elements[0].nom, page: 1 });
			})
			.catch((reason) => { if (!ac.signal.aborted) setError(String(reason)); });
		return () => ac.abort();
	}, [source, state.catalogPage, state.tableQuery]);

	useEffect(() => {
		if (!source.entityCatalog || !state.table) { setSchema(null); return; }
		const inPage = catalog?.elements.find((table) => table.nom === state.table);
		if (inPage) { setSchema(inPage); return; }
		const ac = new AbortController();
		source.entityCatalog({ page: 1, perPage: 200, q: state.table, signal: ac.signal })
			.then((value) => { if (!ac.signal.aborted) setSchema(value.elements.find((table) => table.nom === state.table) ?? null); })
			.catch(() => { if (!ac.signal.aborted) setSchema(null); });
		return () => ac.abort();
	}, [catalog, source, state.table]);

	useEffect(() => {
		if (!source.entityRows || !state.table) { setRows(null); return; }
		const ac = new AbortController();
		setRows(null);
		setError(null);
		source.entityRows(state.table, { ...rowsOptions(state), signal: ac.signal })
			.then((value) => { if (!ac.signal.aborted) setRows(value); })
			.catch((reason) => { if (!ac.signal.aborted) setError(String(reason)); });
		return () => ac.abort();
	}, [source, state.table, state.page, state.perPage, state.q, state.sort, state.order, state.facets.join(","), JSON.stringify(state.filters)]);

	if (!source.entityCatalog || !source.entityRows) {
		return <p>Ce moteur de base de données n’est pas disponible dans cet hôte.</p>;
	}

	const columns: EntityColumn[] = schema?.colonnes ?? [];
	const addFilter = () => {
		if (!column) return;
		const key = filterKey(column, operator);
		const value = operator === "present" ? "__present__" : operator === "absent" ? "__absent__" : filterValue.trim();
		if (!value) return;
		setState({ filters: { ...state.filters, [key]: value }, page: 1 });
		setFilterValue("");
	};
	const chooseTable = (table: EntityTable) => writeState({
		...entityStateFromUrl(""), table: table.nom, sort: table.cle,
	});

	return <section className="flex h-full min-h-0 flex-col gap-3 p-3" data-entity-explorer>
		<GameHeaderBar icon={GLYPHES.livre} title="Base de données">
			{rows ? <GameCountBadge count={rows.total} unit="ligne" /> : null}
		</GameHeaderBar>
		<div className="grid min-h-0 flex-1 gap-3 md:grid-cols-[16rem_minmax(0,1fr)]">
			<aside className="flex min-h-0 flex-col gap-2 rounded-md border border-app-line bg-app-box p-2">
				<GameSearchBar value={tableInput} onChange={setTableInput}
					onSubmit={(q) => setState({ tableQuery: q.trim(), catalogPage: 1 })}
					label="Chercher une table" placeholder="Table SQLite…" />
				<div className="min-h-0 flex-1 overflow-auto" role="list" aria-label="Tables de données">
					{catalog?.elements.map((table) => <button key={`${table.gisement}:${table.nom}`} type="button"
						className={`mb-1 block w-full rounded px-2 py-1 text-left ${state.table === table.nom ? "bg-accent text-white" : "hover:bg-app-hover"}`}
						onClick={() => chooseTable(table)}>
						<strong className="block truncate">{table.nom}</strong>
						<small>{table.lignes.toLocaleString("fr")} lignes · {table.colonnes.length} colonnes</small>
					</button>)}
				</div>
				<PaginationControls currentPage={catalog?.page ?? 1} totalPages={catalog?.pages ?? 1}
					baseUrl={window.location.pathname} onPageChange={(catalogPage) => setState({ catalogPage })} />
			</aside>

			<div className="flex min-h-0 flex-col gap-2 overflow-hidden">
				<div className="flex flex-wrap items-end gap-2">
					<div className="min-w-56 flex-1"><GameSearchBar value={queryInput} onChange={setQueryInput}
						onSubmit={(q) => setState({ q: q.trim(), page: 1 })}
						label="Chercher dans la table" placeholder="Toutes les colonnes texte…" hotkey="x" /></div>
					<label>Tri<select value={state.sort} onChange={(event) => setState({ sort: event.target.value, page: 1 })}>
						<option value="">Clé par défaut</option>{columns.map((item) => <option key={item.nom}>{item.nom}</option>)}
					</select></label>
					<label>Ordre<select value={state.order} onChange={(event) => setState({ order: event.target.value as "asc" | "desc", page: 1 })}>
						<option value="asc">Croissant</option><option value="desc">Décroissant</option>
					</select></label>
					<label>Par page<select value={state.perPage} onChange={(event) => setState({ perPage: Number(event.target.value), page: 1 })}>
						{PAGE_SIZES.map((size) => <option key={size}>{size}</option>)}
					</select></label>
					{source.entityExportUrl && state.table ? <a className="game-button-secondary px-3 py-2" href={source.entityExportUrl(state.table, rowsOptions(state))}>CSV</a> : null}
				</div>

				<details className="game-panel">
					<summary className="cursor-pointer font-bold">Filtres de colonnes et facettes</summary>
					<div className="mt-3 grid gap-3 md:grid-cols-2">
						<div className="grid gap-2">
							<label>Colonne<select value={column} onChange={(event) => setColumn(event.target.value)}>
								<option value="">Choisir…</option>{columns.map((item) => <option key={item.nom} value={item.nom}>{item.nom} · {item.type_sql || "BLOB"}</option>)}
							</select></label>
							<label>Opérateur<select value={operator} onChange={(event) => setOperator(event.target.value as Operator)}>
								<option value="equal">Égal à</option><option value="in">Dans la liste</option>
								<option value="min">Minimum</option><option value="max">Maximum</option>
								<option value="present">Présent</option><option value="absent">Absent</option>
							</select></label>
							{operator !== "present" && operator !== "absent" ? <label>Valeur<input value={filterValue}
								onChange={(event) => setFilterValue(event.target.value)} placeholder={operator === "in" ? "valeur1,valeur2" : "Valeur exacte"} /></label> : null}
							<Button type="button" onClick={addFilter}>Ajouter le filtre</Button>
						</div>
						<fieldset><legend>Facettes (12 maximum)</legend><div className="grid max-h-44 grid-cols-2 overflow-auto">
							{columns.map((item) => <label key={item.nom}><input type="checkbox" checked={state.facets.includes(item.nom)}
								disabled={!state.facets.includes(item.nom) && state.facets.length >= 12}
								onChange={(event) => setState({ facets: event.target.checked ? [...state.facets, item.nom] : state.facets.filter((value) => value !== item.nom), page: 1 })} /> {item.nom}</label>)}
						</div></fieldset>
					</div>
					<div className="mt-3 flex flex-wrap gap-2">{Object.entries(state.filters).map(([key, value]) => <button key={key} type="button"
						onClick={() => { const next = { ...state.filters }; delete next[key]; setState({ filters: next, page: 1 }); }}
						className="game-button-secondary px-2 py-1" title="Retirer ce filtre">{key}: {value} ×</button>)}</div>
				</details>

				{error ? <p role="alert">{error}</p> : null}
				{rows ? <p className="text-sm" data-applied-entity-filters>Appliqué par SQLite : {appliedSummary(rows.filtres).join(" · ")}</p> : null}
				{rows?.facets?.map((facet) => <div key={facet.column} className="flex flex-wrap gap-1 text-sm">
					<strong>{facet.column}{facet.truncated ? ` (${facet.distinct} valeurs)` : ""} :</strong>
					{facet.values.map((item) => <button key={item.value ?? "__empty"} type="button" className="game-button-secondary px-2"
						onClick={() => setState({ filters: { ...state.filters, [facet.column]: item.value ?? "__absent__" }, page: 1 })}>
						{item.value || "Absent"} ({item.count})
					</button>)}
				</div>)}
				<div className="min-h-0 flex-1 overflow-auto rounded border border-app-line bg-app-box">
					<table className="w-full border-collapse text-sm"><thead className="sticky top-0 bg-app-box"><tr>
						{columns.map((item) => <th key={item.nom} className="border-b border-app-line p-2 text-left">{item.nom}</th>)}
					</tr></thead><tbody>{rows?.elements.map((row, index) => <tr key={`${scalar(row[rows.cle])}:${index}`}>
						{columns.map((item) => <td key={item.nom} className="max-w-80 border-b border-app-line p-2"><span className="line-clamp-3">{scalar(row[item.nom])}</span></td>)}
					</tr>)}</tbody></table>
				</div>
				<PaginationControls currentPage={rows?.page ?? state.page} totalPages={rows?.pages ?? 1}
					baseUrl={window.location.pathname} disabled={!rows} onPageChange={(page) => setState({ page })} />
			</div>
		</div>
	</section>;
}
