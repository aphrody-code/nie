/**
 * `/donnees` — les 224 tables des deux gisements, avec les filtres que le serveur sert déjà.
 *
 * ## Pourquoi cette page existe
 *
 * `scripts/validation/mesurer-matrice-filtres.sh` a mesuré le 2026-09-06 que
 * `/api/v1/entites/{table}` servait la recherche, le tri, l'égalité sur **toute colonne**, les
 * intervalles, les tests de présence et l'export CSV — sur **224 tables**, et que **rien** dans
 * l'interface n'y menait. Le retard n'était pas dans le serveur ; il était ici.
 *
 * ## Ce que la page ne fait pas
 *
 * - **Elle n'invente aucune colonne, aucun libellé, aucune facette.** Le schéma vient de
 *   `/api/v1/entites`, qui le mesure sur `sqlite_master` et `PRAGMA table_info`. Une colonne
 *   affichée est une colonne de la base — c'est la règle anti-hallucination du dépôt, tenue par
 *   construction plutôt que par vigilance.
 * - **Elle ne joint pas les deux gisements.** Le jeu et la série n'ont aucune clé commune ; la
 *   page affiche donc le gisement de chaque table et s'arrête là.
 * - **Elle ne devine pas un type.** Les bornes numériques ne sont proposées que sur les
 *   colonnes que le serveur déclare non textuelles — parce que lui refuse une fourchette sur du
 *   texte, et qu'une commande à l'écran qui mène à un `400` est pire qu'une commande absente.
 */
import { useEffect, useMemo, useState } from "react";
import { agree, Notice } from "./SecondaryScreen";

/** Une colonne, telle que `/api/v1/entites` la mesure. */
interface ColumnDto {
	nom: string;
	type_sql: string;
	texte: boolean;
}

/** Une table servable, avec son schéma et son compte de lignes. */
interface ServedTable {
	gisement: string;
	nom: string;
	cle: string;
	colonnes: ColumnDto[];
	lignes: number;
}

/** Une valeur d'une facette, telle que `?facets=` la rend. `value: null` = vide ou nul. */
interface FacetValue {
	value: string | null;
	count: number;
}

/** Les valeurs d'une colonne et leur compte, sous les filtres en cours. */
interface Facet {
	column: string;
	distinct: number;
	truncated: boolean;
	values: FacetValue[];
}

/** Une page de lignes, telle que `/api/v1/entites/{table}` la rend. */
interface RowPage {
	elements: Record<string, unknown>[];
	total: number;
	page: number;
	pages: number;
	gisement: string;
	table: string;
	cle: string;
	/** Absent quand `?facets` l'est — le serveur ne publie pas une clé toujours vide. */
	facets?: Facet[];
}

/** Les tailles de page proposées — le serveur plafonne à 200. */
const PAGE_SIZES = [25, 50, 100, 200] as const;

/** Le jeton qui demande les lignes où une colonne est renseignée. */
const PRESENT_TOKEN = "__present__";

/** Le jeton qui demande les lignes où une colonne est vide ou nulle. */
const ABSENT_TOKEN = "__absent__";

/**
 * Le suffixe du choix multiple — `?element__in=Feu,Vent`.
 *
 * Les pastilles d'une facette écrivent ici, et non dans l'égalité simple : c'est ce qui rend
 * le geste que la facette dessine réellement possible. Une valeur qui contient une virgule
 * reste adressable par le champ « égal à… », qui ne découpe rien.
 */
const IN_SUFFIX = "__in";

/**
 * Combien de colonnes on peut faceter d'un coup — la borne du serveur, recopiée ici.
 *
 * Elle est recopiée plutôt que devinée : au-delà, le serveur rend un `400` qui nomme la limite.
 * Une interface qui laisserait cocher une treizième colonne ferait échouer la requête entière,
 * donc disparaître la liste — un clic qui casse l'écran est pire qu'un bouton désactivé.
 */
const MAX_FACETS = 12;

/**
 * L'état de la page, tel qu'il vit dans l'URL.
 *
 * `filtres` porte les paires colonne→valeur brutes, exactement comme elles partiront en query :
 * les traduire en un modèle plus riche obligerait à les retraduire pour l'URL, et c'est là que
 * les deux formes divergent.
 */
type PanelState = {
	table: string;
	q: string;
	sort: string;
	order: "asc" | "desc";
	pageSize: number;
	page: number;
	filters: [string, string][];
	/**
	 * Les colonnes dont on veut les valeurs comptées.
	 *
	 * **Demandées, jamais devinées.** Le serveur seul sait ce que porte une colonne ; choisir
	 * ici « les colonnes qui ont l'air d'être des catégories » reviendrait à inventer un schéma
	 * — et une table de 40 colonnes rendrait 40 `GROUP BY` pour trois utiles. C'est donc un
	 * geste : on ouvre une colonne, et elle se compte.
	 */
	facets: string[];
};

/** L'état d'une table fraîchement choisie : tout est remis à zéro sauf le nom. */
function freshState(table: string): PanelState {
	return { table, q: "", sort: "", order: "asc", pageSize: 50, page: 1, filters: [], facets: [] };
}

/** Les clés que la page se réserve : tout le reste de l'URL est un filtre de colonne. */
const RESERVED_KEYS = new Set(["vue", "table", "q", "tri", "ordre", "par_page", "page"]);

function stateFromUrl(): PanelState {
	const params = new URLSearchParams(window.location.search);
	const pageSize = Number(params.get("par_page"));
	const page = Number(params.get("page"));
	return {
		table: params.get("table") ?? "",
		q: params.get("q") ?? "",
		sort: params.get("tri") ?? "",
		order: params.get("ordre") === "desc" ? "desc" : "asc",
		pageSize: PAGE_SIZES.includes(pageSize as (typeof PAGE_SIZES)[number]) ? pageSize : 50,
		page: Number.isFinite(page) && page >= 1 ? page : 1,
		filters: [...params.entries()].filter(([column]) => !RESERVED_KEYS.has(column)),
		// Les colonnes déjà filtrées s'ouvrent d'office : une adresse partagée montre alors
		// POURQUOI la liste est réduite, et quelles autres valeurs existaient.
		facets: [...params.entries()]
			.map(([column]) =>
				column.endsWith(IN_SUFFIX) ? column.slice(0, -IN_SUFFIX.length) : column
			)
			.filter(
				(column) =>
					!RESERVED_KEYS.has(column) &&
					!column.endsWith("__min") &&
					!column.endsWith("__max")
			)
			.filter((column, index, all) => all.indexOf(column) === index)
			.slice(0, MAX_FACETS),
	};
}

/** Construit la query d'une requête — et, aux réserves près, celle de l'URL. */
function query(state: PanelState, forUrl: boolean): URLSearchParams {
	const params = new URLSearchParams();
	if (forUrl && state.table) params.set("table", state.table);
	if (state.q.trim()) params.set("q", state.q.trim());
	if (state.sort.trim()) params.set("tri", state.sort.trim());
	if (state.order === "desc") params.set("ordre", "desc");
	// Un défaut ne s'écrit pas dans l'URL : deux adresses pour le même écran cassent le partage.
	if (!forUrl || state.pageSize !== 50) params.set("par_page", String(state.pageSize));
	if (state.page !== 1) params.set("page", String(state.page));
	for (const [column, value] of state.filters) {
		if (value.trim()) params.set(column, value.trim());
	}
	// Jamais dans l'URL : `facets` ne change pas ce qui est affiché dans la liste, seulement ce
	// que le serveur compte à côté. L'écrire ferait deux adresses pour le même écran.
	if (!forUrl && state.facets.length > 0) params.set("facets", state.facets.join(","));
	return params;
}

/**
 * Écrit la seule clé que ce panneau revendique dans l'URL : la table lue.
 *
 * Depuis la fusion, l'adresse est celle de l'explorateur — elle porte déjà `d`, `q`, `ext`,
 * `tri`… Y écrire aussi les filtres du panneau ferait deux `q` pour deux corpus différents, et
 * le premier des deux écraserait l'autre en silence. La table, elle, ne collisionne avec rien
 * et suffit à retrouver l'écran.
 */
function writeUrl(state: PanelState) {
	const url = new URL(window.location.href);
	if (state.table) url.searchParams.set("table", state.table);
	else url.searchParams.delete("table");
	window.history.replaceState(window.history.state, "", url);
}

/** Lit une route de l'API, en propageant l'annulation. */
async function readJson<T>(path: string, signal: AbortSignal): Promise<T> {
	const response = await fetch(path, { signal, headers: { accept: "application/json" } });
	if (!response.ok) throw new Error(String(response.status));
	return (await response.json()) as T;
}

/** Rend une valeur JSON en une cellText lisible, sans jamais l'inventer. */
function cellText(value: unknown): string {
	if (value === null || value === undefined) return "—";
	if (typeof value === "string") return value;
	// `JSON.stringify` plutôt que `String` : `String({})` rend « [object Object] », qui n'est
	// pas une donnée mais un artefact de langage.
	return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/**
 * Le bloc « Données » de l'explorateur.
 *
 * Ce n'est plus une page depuis la fusion du 2026-09-06 : c'est le second volet du panneau de
 * droite, monté à côté du context du dossier et de l'asset. Les **routes API n'ont pas
 * bougé** — `/api/v1/entites` et `/api/v1/entites/{table}`, avec leurs filtres, leur tri et
 * leur export.
 *
 * `context` est le nom de l'asset sélectionné, sans extension : il pré-remplit la recherche.
 * Un fichier du jeu et la ligne qui le décrit portent souvent le même code, et c'est
 * exactement le rapprochement qu'on venait chercher en ouvrant les deux écrans côte à côte.
 */
export function DataPanel({ context }: { context?: string }) {
	const initial = useMemo(stateFromUrl, []);
	const [state, setState] = useState<PanelState>(initial);
	const [tables, setTables] = useState<ServedTable[] | null>(null);
	const [page, setPage] = useState<RowPage | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [input, setInput] = useState(initial.q);

	// Le catalogue, une fois. `par_page=200` est le plafond du serveur : les 224 tables tiennent
	// en deux appels, et le second n'est fait que s'il y a une suite.
	useEffect(() => {
		const ac = new AbortController();
		(async () => {
			try {
				const firstPage = await readJson<{ elements: ServedTable[]; pages: number }>(
					"/api/v1/entites?per_page=200",
					ac.signal
				);
				// Le nombre de pages est connu dès la première réponse : les suivantes partent
				// ensemble. Les enchaîner ferait attendre un aller-retour par page pour une
				// dépendance qui n'existe pas.
				const followingPages = await Promise.all(
					Array.from({ length: Math.max(0, firstPage.pages - 1) }, (_, index) =>
						readJson<{ elements: ServedTable[] }>(
							`/api/v1/entites?per_page=200&page=${index + 2}`,
							ac.signal
						)
					)
				);
				const allTables = [
					...firstPage.elements,
					...followingPages.flatMap((response) => response.elements),
				];
				if (!ac.signal.aborted) setTables(allTables);
			} catch {
				if (!ac.signal.aborted) setError("Le catalogue des données n'est pas disponible.");
			}
		})();
		return () => ac.abort();
	}, []);

	const table = tables?.find((candidate) => candidate.nom === state.table) ?? null;

	useEffect(() => {
		writeUrl(state);
		if (!state.table) {
			setPage(null);
			return;
		}
		const ac = new AbortController();
		setError(null);
		readJson<RowPage>(`/api/v1/entites/${state.table}?${query(state, false)}`, ac.signal)
			.then((response) => {
				if (!ac.signal.aborted) setPage(response);
			})
			.catch((e: Error) => {
				if (ac.signal.aborted) return;
				setPage(null);
				// Un 400 vient d'un filtre que la table ne comprend pas ; le dire évite de
				// laisser croire à une panne.
				setError(
					e.message === "400"
						? "Un des filtres ne s'applique pas à cette table."
						: "Ces lignes n'ont pas pu être chargées."
				);
			});
		return () => ac.abort();
	}, [state]);

	/** Pose ou retire un filtre de colonne, et revient à la première page. */
	const setColumnFilter = (column: string, value: string) => {
		setState((current) => ({
			...current,
			page: 1,
			filters: [
				...current.filters.filter(([key]) => key !== column),
				...(value ? ([[column, value]] as [string, string][]) : []),
			],
		}));
	};
	const valueFor = (column: string) => state.filters.find(([key]) => key === column)?.[1] ?? "";

	/** Les valeurs cochées d'une colonne, lues dans son `__in`. */
	const selectedValues = (column: string): string[] => {
		const raw = state.filters.find(([key]) => key === `${column}${IN_SUFFIX}`)?.[1] ?? "";
		return raw.split(",").filter((value) => value !== "");
	};

	/**
	 * Coche ou décoche une valeur de facette.
	 *
	 * Le filtre part dans `colonne__in`, jamais dans l'égalité simple : la facette montre
	 * plusieurs valeurs et compte sans son propre filtre pour qu'on puisse en prendre
	 * plusieurs — écrire une égalité ferait qu'un second clic écraserait le premier, et le
	 * geste dessiné n'existerait pas.
	 */
	const toggleValue = (column: string, value: string) => {
		const current = selectedValues(column);
		const next = current.includes(value)
			? current.filter((candidate) => candidate !== value)
			: [...current, value];
		setColumnFilter(`${column}${IN_SUFFIX}`, next.join(","));
	};

	/** Ouvre ou referme le comptage des valeurs d'une colonne. */
	const toggleFacet = (column: string) => {
		setState((current) => ({
			...current,
			facets: current.facets.includes(column)
				? current.facets.filter((candidate) => candidate !== column)
				: [...current.facets, column].slice(0, MAX_FACETS),
		}));
	};

	// L'asset sélectionné dans la liste devient la recherche du panneau. Le geste qu'on faisait
	// à la main entre deux onglets — copier un code de fichier, le coller dans une table — est
	// désormais le comportement par défaut.
	useEffect(() => {
		if (!context) return;
		setInput(context);
		setState((current) => ({ ...current, q: context, page: 1 }));
	}, [context]);

	if (error && !tables) return <Notice tone="alerte">{error}</Notice>;
	if (!tables) return <Notice>Chargement…</Notice>;

	return (
		<section>
			<h3 style={{ margin: "0 0 var(--jeu-espace-s)", fontSize: "1rem", fontWeight: 800 }}>
				Données · {agree(tables.length, "table")}
			</h3>

			<div
				style={{
					display: "flex",
					flexWrap: "wrap",
					gap: "var(--jeu-espace-m)",
					margin: "var(--jeu-espace-m) 0",
				}}
			>
				<label style={LABEL_STYLE}>
					Table
					<select
						value={state.table}
						onChange={(e) => setState(freshState(e.target.value))}
						style={{ ...FIELD_STYLE, maxWidth: "22rem" }}
					>
						<option value="">Choisir…</option>
						{tables.map((tableInfo) => (
							<option key={tableInfo.nom} value={tableInfo.nom}>
								{tableInfo.nom} · {tableInfo.lignes.toLocaleString("fr")}
							</option>
						))}
					</select>
				</label>
				{table ? (
					<>
						<label style={LABEL_STYLE}>
							Par page
							<select
								value={String(state.pageSize)}
								onChange={(e) =>
									setState((v) => ({ ...v, pageSize: Number(e.target.value), page: 1 }))
								}
								style={FIELD_STYLE}
							>
								{PAGE_SIZES.map((n) => (
									<option key={n} value={n}>
										{n}
									</option>
								))}
							</select>
						</label>
						<a
							href={`/api/v1/entites/${state.table}?${query({ ...state, pageSize: 200, facets: [] }, false)}&format=csv`}
							style={{ ...LABEL_STYLE, textDecoration: "underline" }}
						>
							Exporter cette page en CSV
						</a>
					</>
				) : null}
			</div>

			{!table ? (
				<Notice>
					Choisissez une table. Chacune porte son gisement — les données du jeu, ou le catalogue de
					la série.
				</Notice>
			) : (
				<>
					<form
						onSubmit={(e) => {
							e.preventDefault();
							setState((v) => ({ ...v, q: input.trim(), page: 1 }));
						}}
						style={{
							display: "flex",
							gap: "var(--jeu-espace-s)",
							margin: "0 0 var(--jeu-espace-m)",
						}}
					>
						<input
							type="search"
							value={input}
							onChange={(e) => setInput(e.target.value)}
							placeholder={`Chercher dans ${table.nom}`}
							aria-label={`Chercher dans ${table.nom}`}
							style={{ ...FIELD_STYLE, flex: 1 }}
						/>
						<button type="submit" style={FIELD_STYLE}>
							Chercher
						</button>
					</form>

					{/*
					 * Les valeurs d'une colonne, comptées par le serveur sous les filtres en
					 * cours. C'est la différence entre un filtre qu'on devine et un filtre
					 * qu'on lit : sans les comptes, il faut connaître l'orthographe exacte de
					 * « Forêt » pour l'écrire dans un champ libre.
					 *
					 * Le compte d'une facette exclut le filtre de SA propre colonne : c'est ce
					 * qui permet d'en choisir une seconde. Sous `element=Feu`, la facette
					 * `element` continue d'afficher `Forêt 1 600`, pendant que `position` est
					 * bien recalculée sous `Feu`.
					 */}
					{(page?.facets?.length ?? 0) > 0 ? (
						<div
							style={{
								margin: "0 0 var(--jeu-espace-m)",
								display: "grid",
								gap: "var(--jeu-espace-s)",
							}}
						>
							{page?.facets?.map((facet) => (
								<div key={facet.column}>
									<div
										style={{
											display: "flex",
											alignItems: "baseline",
											gap: "var(--jeu-espace-xs)",
											flexWrap: "wrap",
										}}
									>
										<strong style={{ fontSize: "0.85rem" }}>{facet.column}</strong>
										<span style={{ fontSize: "0.78rem", opacity: 0.7 }}>
											{facet.truncated
												? `${facet.values.length} des ${facet.distinct.toLocaleString("fr")} valeurs, les plus fournies`
												: agree(facet.distinct, "valeur")}
										</span>
										<button
											type="button"
											onClick={() => toggleFacet(facet.column)}
											style={{
												...FIELD_STYLE,
												cursor: "pointer",
												padding: "0 var(--jeu-espace-xs)",
												fontSize: "0.78rem",
											}}
											aria-label={`Masquer les valeurs de ${facet.column}`}
										>
											masquer
										</button>
									</div>
									<div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
									{facet.values.map((facetValue) => {
											// Une valeur nulle ne passe pas par le choix multiple : `IN` ne peut
											// pas exprimer « vide ou nul ». Elle passe par le jeton de présence,
											// qui est une ÉGALITÉ — donc exclusive, ce qui est correct : « vide »
											// et « une valeur » ne se cumulent pas.
										const isNull = facetValue.value === null;
										const token = facetValue.value ?? ABSENT_TOKEN;
										const active = isNull
											? valueFor(facet.column) === ABSENT_TOKEN
											: selectedValues(facet.column).includes(token);
											return (
												<button
													key={token}
													type="button"
													aria-pressed={active}
													onClick={() =>
														isNull
															? setColumnFilter(facet.column, active ? "" : ABSENT_TOKEN)
															: toggleValue(facet.column, token)
													}
													style={{
														...FIELD_STYLE,
														cursor: "pointer",
														fontSize: "0.8rem",
														padding: "2px var(--jeu-espace-xs)",
														background: active ? "var(--jeu-surface-glace)" : "#fff",
														borderColor: active
															? "var(--jeu-nuit-profonde)"
															: "var(--jeu-tuile-bord)",
														fontWeight: active ? 800 : 400,
													}}
												>
													{facetValue.value ?? "vide"}{" "}
													<span style={{ opacity: 0.65 }}>{facetValue.count.toLocaleString("fr")}</span>
												</button>
											);
										})}
									</div>
								</div>
							))}
						</div>
					) : null}

					{/*
					 * Une commande par colonne MESURÉE, jamais par facette devinée. Les bornes
					 * ne sont proposées que sur les colonnes non textuelles : le serveur refuse
					 * une fourchette sur du texte, et une commande qui mène à un 400 est pire
					 * qu'une commande absente.
					 */}
					<details style={{ margin: "0 0 var(--jeu-espace-m)" }}>
						<summary style={{ cursor: "pointer", fontWeight: 700 }}>
							Filtrer par colonne ({table.colonnes.length})
						</summary>
						<div
							style={{
								display: "grid",
								gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
								gap: "var(--jeu-espace-s)",
								margin: "var(--jeu-espace-s) 0",
							}}
						>
							{table.colonnes.map((c) => (
								<label
									key={c.nom}
									style={{ ...LABEL_STYLE, alignItems: "stretch", flexDirection: "column", gap: 2 }}
								>
									<span
										style={{
											display: "flex",
											alignItems: "baseline",
											gap: 4,
											fontSize: "0.8rem",
											opacity: 0.75,
										}}
									>
										<span style={{ flex: 1, minWidth: 0 }}>
											{c.nom} · {c.type_sql || "?"}
										</span>
										{/*
										 * « Valeurs » demande au serveur de compter cette colonne. Le
										 * bouton se désactive à la douzième — au-delà le serveur rend un
										 * 400 qui ferait disparaître la liste entière, et un clic qui
										 * casse l'écran est pire qu'un bouton éteint.
										 */}
										<button
											type="button"
											onClick={() => toggleFacet(c.nom)}
											disabled={
												!state.facets.includes(c.nom) && state.facets.length >= MAX_FACETS
											}
											aria-pressed={state.facets.includes(c.nom)}
											title={
												state.facets.includes(c.nom)
													? "Masquer les valeurs"
													: state.facets.length >= MAX_FACETS
														? `${MAX_FACETS} colonnes comptées au maximum`
														: "Compter les valeurs de cette colonne"
											}
											style={{
												border: "none",
												background: "none",
												padding: 0,
												font: "inherit",
												cursor: "pointer",
												textDecoration: "underline",
												opacity:
													!state.facets.includes(c.nom) && state.facets.length >= MAX_FACETS
														? 0.4
														: 1,
											}}
										>
											{state.facets.includes(c.nom) ? "valeurs ✓" : "valeurs"}
										</button>
									</span>
									<input
										type="text"
										value={valueFor(c.nom)}
										onChange={(e) => setColumnFilter(c.nom, e.target.value)}
										placeholder={c.texte ? "égal à…" : "égal à…"}
										style={FIELD_STYLE}
									/>
									{c.texte ? (
										<button
											type="button"
											onClick={() => setColumnFilter(c.nom, valueFor(c.nom) === PRESENT_TOKEN ? "" : PRESENT_TOKEN)}
											style={{ ...FIELD_STYLE, cursor: "pointer" }}
										>
											{valueFor(c.nom) === PRESENT_TOKEN ? "renseignée ✓" : "renseignée"}
										</button>
									) : (
										<span style={{ display: "flex", gap: 2 }}>
											<input
												type="text"
												inputMode="numeric"
												value={valueFor(`${c.nom}__min`)}
												onChange={(e) => setColumnFilter(`${c.nom}__min`, e.target.value)}
												placeholder="min"
												aria-label={`${c.nom} minimum`}
												style={{ ...FIELD_STYLE, width: "50%" }}
											/>
											<input
												type="text"
												inputMode="numeric"
												value={valueFor(`${c.nom}__max`)}
												onChange={(e) => setColumnFilter(`${c.nom}__max`, e.target.value)}
												placeholder="max"
												aria-label={`${c.nom} maximum`}
												style={{ ...FIELD_STYLE, width: "50%" }}
											/>
										</span>
									)}
								</label>
							))}
						</div>
					</details>

					{error ? <Notice tone="alerte">{error}</Notice> : null}

					{page ? (
						<>
							<p style={{ margin: "0 0 var(--jeu-espace-s)", fontSize: "0.9rem", opacity: 0.8 }}>
								{agree(page.total, "ligne")} · gisement {page.gisement} · clé {page.cle}
							</p>
							<div style={{ overflowX: "auto" }}>
								<table style={{ borderCollapse: "collapse", fontSize: "0.85rem", width: "100%" }}>
									<thead>
										<tr>
											{table.colonnes.map((c) => (
												<th key={c.nom} style={HEADER_CELL_STYLE}>
													<button
														type="button"
														onClick={() =>
															setState((v) => ({
																...v,
																sort: c.nom,
																order: v.sort === c.nom && v.order === "asc" ? "desc" : "asc",
																page: 1,
															}))
														}
														style={{
															background: "none",
															border: "none",
															font: "inherit",
															fontWeight: 700,
															cursor: "pointer",
															padding: 0,
														}}
													>
														{c.nom}
														{state.sort === c.nom ? (state.order === "asc" ? " ▲" : " ▼") : ""}
													</button>
												</th>
											))}
										</tr>
									</thead>
									<tbody>
						{page.elements.map((row) => (
							<tr key={String(row[page.cle] ?? JSON.stringify(row))}>
												{table.colonnes.map((c) => (
													<td key={c.nom} style={CELL_STYLE}>
									{cellText(row[c.nom])}
													</td>
												))}
											</tr>
										))}
									</tbody>
								</table>
							</div>
							{page.pages > 1 ? (
								<nav
									aria-label="Pagination"
									style={{
										display: "flex",
										alignItems: "center",
										gap: "var(--jeu-espace-m)",
										marginTop: "var(--jeu-espace-m)",
									}}
								>
									<button
										type="button"
										disabled={page.page <= 1}
										onClick={() => setState((v) => ({ ...v, page: v.page - 1 }))}
										style={FIELD_STYLE}
									>
										Précédent
									</button>
									<span aria-live="polite" style={{ fontWeight: 700 }}>
										Page {page.page} sur {page.pages.toLocaleString("fr")}
									</span>
									<button
										type="button"
										disabled={page.page >= page.pages}
										onClick={() => setState((v) => ({ ...v, page: v.page + 1 }))}
										style={FIELD_STYLE}
									>
										Suivant
									</button>
								</nav>
							) : null}
						</>
					) : error ? null : (
						<Notice>Chargement…</Notice>
					)}
				</>
			)}
		</section>
	);
}

const FIELD_STYLE: React.CSSProperties = {
	padding: "var(--jeu-espace-xs) var(--jeu-espace-s)",
	background: "#fff",
	border: "2px solid var(--jeu-tuile-bord)",
	borderRadius: "var(--jeu-rayon)",
	color: "var(--jeu-nuit-profonde)",
	font: "inherit",
	minWidth: 0,
};

const LABEL_STYLE: React.CSSProperties = {
	display: "inline-flex",
	alignItems: "center",
	gap: "var(--jeu-espace-xs)",
	fontWeight: 700,
};

const HEADER_CELL_STYLE: React.CSSProperties = {
	textAlign: "left",
	padding: "var(--jeu-espace-xs) var(--jeu-espace-s)",
	borderBottom: "2px solid var(--jeu-tuile-bord)",
	whiteSpace: "nowrap",
};

const CELL_STYLE: React.CSSProperties = {
	padding: "var(--jeu-espace-xs) var(--jeu-espace-s)",
	borderBottom: "1px solid var(--jeu-tuile-bord)",
	maxWidth: "28rem",
	overflow: "hidden",
	textOverflow: "ellipsis",
	whiteSpace: "nowrap",
};
