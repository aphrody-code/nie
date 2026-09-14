/**
 * La Banque — l'écran `chara_bank_menu` du jeu, dans le navigateur.
 *
 * ## Ce qui vient du jeu, et ce qui vient de l'hôte
 *
 * - Le **fond, les cadres et les guides** sont le layout du jeu : `GET /api/v1/menu/layout/chara_bank_menu`
 *   rend 25 objets avec leurs 25 sprites résolus, dessinés par le compositeur wasm (`LayoutCanvas`) sans qu'une
 *   position soit corrigée ici.
 * - Les **calques et leurs états** viennent du Lua : `POST /api/v1/menu/runtime/chara_bank_menu`
 *   reçoit `itemCounts` pour la liste et `OnEnter(layer, index)` à chaque déplacement du curseur.
 * - Les **personnages** viennent de `GET /api/v1/profile/complete` — et, tant que cette route
 *   n'est pas servie, du repli typé sur `GET /api/v1/game-data/charas`, dont les stats sont
 *   déjà celles du niveau 99 (cf. `game/roster.ts`).
 * - Les **libellés et les vignettes** de la liste, de la fiche et des guides sont dessinés par
 *   l'hôte : le layout ne porte ni portrait de personnage, ni ligne de liste. Ce n'est pas une
 *   reproduction pixel à pixel, et rien ici ne le prétend (mémoire `pixel-perfect`).
 *
 * ## Les touches
 *
 * Relevées sur `data/menu/bank_character_detail.png` : `Alt` ouvre le filtre, `X` cherche par
 * nom de joueur, `V` cache les stats, `Tab` change le tri, `Échap` revient. Aucun guide n'est
 * dessiné sans son gestionnaire — `GameHintBar` les branche tous les cinq.
 */
import {
	GameFilterPanel,
	GameHintBar,
	GameSearchBar,
	type GameFilterFamily,
	type GameFilterValue,
	GameCanvas,
	useCapacites as useCapabilities,
	useAssetSource,
} from "@niers/inacord-ui";
import {
	fetchCharaCatalog,
	type CharaCatalogPage,
	type CharaFacet,
	type CharaSort,
} from "@niers/asset-source/chara";
import { lireLayout, type LayoutJeu } from "@niers/inacord-ui/shell/game-layout";
import { listPage, stepCursor } from "../game/list-page";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { LayoutCanvas } from "../game/LayoutCanvas";
import { createMenuRuntime, type MenuRuntimeResult } from "../game/menu-runtime";
import {
	filterRoster,
	PROFILE_LEVEL,
	ROSTER_STATS,
	rosterFamilies,
	rosterFromCharas,
	type RosterChara,
	type RosterEntry,
	type RosterFilter,
} from "../game/roster";
import { NativeText } from "../pages/NativeText";
import { ScreenStatus } from "../pages/screen-parts";
import "./player-bank.css";
import { loadMenuLayout } from "../game/menu-layout";
import {
	browserLocationSnapshot,
	subscribeBrowserLocation,
	writeBrowserHistory,
} from "@niers/inacord-ui/lib/browser-navigation";

/** L'écran du jeu dont cette page est la reproduction. */
const SCREEN = "chara_bank_menu";

/**
 * La grille : 6 colonnes sur 4 rangées, mesurées sur `data/menu/bank_character_detail.png`.
 *
 * C'est aussi le `itemCounts` envoyé au Lua : la liste native ne connaît que les éléments de sa
 * page, et lui en annoncer 6 101 décrirait un état que le jeu n'a jamais.
 */
const COLUMNS = 6;
const ROWS = 4;
const PAGE_SIZE = COLUMNS * ROWS;

/**
 * L'identifiant du calque de la liste : `layer_id == crc32(nom)` dans les scènes du menu.
 *
 * La valeur est FIGÉE ici plutôt que calculée au chargement, parce que le CRC-32 vit maintenant
 * dans le module WebAssembly (`nie_formats::cfgbin::crc32`) et qu'un module n'est pas chargé au
 * moment où un module TypeScript s'évalue. `layerIdEstCelleDuJeu` la revérifie contre la vraie
 * fonction, donc une constante fausse échoue au test et non à l'écran.
 */
const LIST_LAYER = 0x1ac99083;

/** Le layout de l'écran, validé par `lireLayout` — un JSON mal formé échoue bruyamment. */
async function loadLayout(signal: AbortSignal): Promise<LayoutJeu> {
	return lireLayout(await loadMenuLayout(SCREEN, "fr", signal));
}

/** Une réponse de `/api/v1/game-data/charas`, vérifiée avant d'être liée à la liste. */
function readCharas(value: unknown): RosterChara[] {
	if (!Array.isArray(value)) throw new Error("charas: not an array");
	return value.filter((row): row is RosterChara =>
		Boolean(row) && typeof row === "object"
		&& typeof (row as RosterChara).chara_param_id === "string"
		&& typeof (row as RosterChara).name === "string"
		&& Boolean((row as RosterChara).stats));
}

/**
 * Le vivier : le profil complet s'il est servi, le repli typé sinon.
 *
 * `/api/v1/profile/complete` répond `404` tant que la route n'est pas déployée. Ce n'est pas
 * une panne à afficher : la même mesure existe sur `game-data/charas`, et l'origine retenue est
 * portée par chaque entrée (`origin`) plutôt que devinée par l'écran.
 */
async function loadRoster(signal: AbortSignal): Promise<RosterEntry[]> {
	const profile = await fetch("/api/v1/profile/complete", { signal, headers: { accept: "application/json" } })
		.catch(() => null);
	if (profile?.ok) {
		const body = await profile.json() as { charas?: unknown };
		const charas = Array.isArray(body?.charas) ? readCharas(body.charas) : [];
		if (charas.length > 0) {
			return charas.map((chara) => ({
				chara, level: PROFILE_LEVEL, stats: chara.stats, skills: chara.skills, origin: "profile" as const,
			}));
		}
	}
	const response = await fetch("/api/v1/game-data/charas", { signal, headers: { accept: "application/json" } });
	if (!response.ok) throw new Error("Roster unavailable");
	return rosterFromCharas(readCharas(await response.json()));
}

export interface PlayerBankUrlState {
	q: string;
	element: string[];
	position: string[];
	rarity: string[];
	series: string[];
	team: string[];
	sort: CharaSort;
	order: "asc" | "desc";
	page: number;
	perPage: number;
}

const BANK_DEFAULTS: PlayerBankUrlState = {
	q: "",
	element: [],
	position: [],
	rarity: [],
	series: [],
	team: [],
	sort: "zukan",
	order: "asc",
	page: 1,
	perPage: PAGE_SIZE,
};

const BANK_SORTS = new Set<CharaSort>(["zukan", "code", "nom_fr", "nom_en", "nom_ja", "rarete"]);

function positive(raw: string | null, fallback: number, max: number): number {
	const value = Number(raw);
	return Number.isSafeInteger(value) && value >= 1 ? Math.min(value, max) : fallback;
}

function values(params: URLSearchParams, key: CharaFacet | "team"): string[] {
	const multiple = params.get(`${key}__in`);
	const raw = multiple ?? params.get(key) ?? "";
	return [...new Set(raw.split(",").map((value) => value.trim()).filter(Boolean))];
}

/** Complete browser state; a reload or popstate reconstructs the same bank query. */
export function playerBankStateFromUrl(search: string): PlayerBankUrlState {
	const params = new URLSearchParams(search);
	const requestedSort = params.get("tri") as CharaSort | null;
	return {
		q: params.get("q") ?? "",
		element: values(params, "element"),
		position: values(params, "position"),
		rarity: values(params, "rarity"),
		series: values(params, "series"),
		team: values(params, "team"),
		sort: requestedSort && BANK_SORTS.has(requestedSort) ? requestedSort : "zukan",
		order: params.get("ordre") === "desc" ? "desc" : "asc",
		page: positive(params.get("page"), 1, 0xffff_ffff),
		perPage: positive(params.get("per_page"), PAGE_SIZE, PAGE_SIZE),
	};
}

function writeValues(params: URLSearchParams, key: CharaFacet | "team", selected: readonly string[]): void {
	if (selected.length === 1) params.set(key, selected[0] ?? "");
	else if (selected.length > 1) params.set(`${key}__in`, selected.join(","));
}

export function playerBankHref(location: string, state: PlayerBankUrlState): string {
	const url = new URL(location, "http://localhost");
	const managed = [
		"q", "element", "element__in", "position", "position__in", "rarity", "rarity__in",
		"series", "series__in", "team", "team__in", "tri", "ordre", "page", "per_page",
	];
	for (const key of managed) url.searchParams.delete(key);
	if (state.q) url.searchParams.set("q", state.q);
	writeValues(url.searchParams, "element", state.element);
	writeValues(url.searchParams, "position", state.position);
	writeValues(url.searchParams, "rarity", state.rarity);
	writeValues(url.searchParams, "series", state.series);
	writeValues(url.searchParams, "team", state.team);
	if (state.sort !== "zukan") url.searchParams.set("tri", state.sort);
	if (state.order !== "asc") url.searchParams.set("ordre", state.order);
	if (state.page !== 1) url.searchParams.set("page", String(state.page));
	if (state.perPage !== PAGE_SIZE) url.searchParams.set("per_page", String(state.perPage));
	return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Team membership only exists in the complete local/profile roster. Keep every filter that this
 * roster can genuinely evaluate and drop only the two server-only concepts: rarity and translated
 * names. Pagination and the supported code/French-name order remain shareable URL state.
 */
export function normalizeTeamFallback(state: PlayerBankUrlState): PlayerBankUrlState {
	if (state.team.length === 0) return state;
	const sort = state.sort === "code" || state.sort === "nom_fr" ? state.sort : "zukan";
	return { ...state, rarity: [], sort };
}

function appliedCharaSummary(page: CharaCatalogPage): string {
	const filters = page.filtres;
	const parts = [
		filters.q ? `recherche « ${filters.q} »` : null,
		filters.element ? `élément ${filters.element}` : null,
		filters.position ? `poste ${filters.position}` : null,
		filters.rarity ? `rareté ${filters.rarity}` : null,
		filters.series ? `série ${filters.series}` : null,
		...Object.entries(filters.listes).map(([key, selected]) =>
			selected?.length ? `${key.replace("__in", "")} ${selected.join(", ")}` : null),
		`tri ${filters.tri} ${filters.ordre}`,
	];
	return parts.filter((part): part is string => Boolean(part)).join(" · ");
}

export interface PlayerBankProps {
	/** `Échap` et le bouton de retour : le menu principal. */
	onBack: () => void;
}

export function PlayerBank({ onBack }: PlayerBankProps) {
	// Le portrait n'est pas dans le layout : la source de l'hôte le résout, ou rien ne s'affiche.
	const source = useAssetSource();
	const capabilities = useCapabilities();
	const face = source.urlTexture;
	const location = useSyncExternalStore(
		subscribeBrowserLocation,
		browserLocationSnapshot,
		browserLocationSnapshot,
	);
	const urlState = useMemo(
		() => playerBankStateFromUrl(new URL(location, "http://localhost").search),
		[location],
	);
	// Temporary entity adapter: only the measured HTTP host owns `/api/v1/chara`. Inacord keeps
	// its complete local/profile roster, including the team field absent from the server index.
	const webCatalogue = source.hote !== "inacord" && Boolean(capabilities?.wiki);
	const [layout, setLayout] = useState<LayoutJeu | null>(null);
	const [layoutFailed, setLayoutFailed] = useState(false);
	const [entries, setEntries] = useState<readonly RosterEntry[] | null>(null);
	const [rosterFailed, setRosterFailed] = useState(false);
	const [filter, setFilter] = useState<RosterFilter>({});
	const [search, setSearch] = useState(urlState.q);
	const [searchOpen, setSearchOpen] = useState(false);
	const [filterOpen, setFilterOpen] = useState(false);
	const [hideStats, setHideStats] = useState(false);
	const [byName, setByName] = useState(false);
	const [cursor, setCursor] = useState(0);
	const [runtimeState, setRuntimeState] = useState<"loading" | "observed" | "partial" | "unavailable">("loading");
	const [runtime, setRuntime] = useState<MenuRuntimeResult | null>(null);
	const [compose, setCompose] = useState({ drawn: 0, skipped: 0 });
	const [catalogue, setCatalogue] = useState<CharaCatalogPage | null>(null);
	const [catalogueFailed, setCatalogueFailed] = useState(false);
	const seen = useRef(new Set<string>());

	const writeWebState = useCallback((next: PlayerBankUrlState) => {
		const href = playerBankHref(window.location.href, next);
		if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== href) {
			writeBrowserHistory(href, window.history.state, "replace");
		}
	}, []);

	useEffect(() => {
		if (webCatalogue) setSearch(urlState.q);
	}, [urlState.q, webCatalogue]);
	useEffect(() => {
		if (!webCatalogue || urlState.team.length === 0) return;
		const normalized = normalizeTeamFallback(urlState);
		if (normalized.rarity.length !== urlState.rarity.length || normalized.sort !== urlState.sort) {
			writeWebState(normalized);
		}
	}, [webCatalogue, urlState, writeWebState]);

	useEffect(() => {
		const controller = new AbortController();
		loadLayout(controller.signal).then(setLayout, () => { if (!controller.signal.aborted) setLayoutFailed(true); });
		loadRoster(controller.signal).then(setEntries, () => { if (!controller.signal.aborted) setRosterFailed(true); });
		return () => controller.abort();
	}, []);

	useEffect(() => {
		if (!webCatalogue || urlState.team.length > 0) {
			setCatalogue(null);
			setCatalogueFailed(false);
			return;
		}
		const controller = new AbortController();
		setCatalogueFailed(false);
		fetchCharaCatalog({
			q: urlState.q,
			elements: urlState.element,
			positions: urlState.position,
			rarities: urlState.rarity,
			seriesList: urlState.series,
			sort: urlState.sort,
			order: urlState.order,
			page: urlState.page,
			perPage: urlState.perPage,
			signal: controller.signal,
		}).then(setCatalogue, () => {
			if (!controller.signal.aborted) setCatalogueFailed(true);
		});
		return () => controller.abort();
	}, [
		webCatalogue,
		urlState.q,
		urlState.element,
		urlState.position,
		urlState.rarity,
		urlState.series,
		urlState.team,
		urlState.sort,
		urlState.order,
		urlState.page,
		urlState.perPage,
	]);

	const session = useMemo(
		() => createMenuRuntime(SCREEN, { locale: "fr", itemCounts: { [LIST_LAYER]: PAGE_SIZE } }),
		[],
	);
	const receive = useCallback((result: MenuRuntimeResult) => {
		setRuntime(result);
		setRuntimeState(result.complete ? "observed" : "partial");
	}, []);
	useEffect(() => {
		session.replay([]).then(receive, () => setRuntimeState("unavailable"));
		return () => session.abort();
	}, [session, receive]);

	const webFilter = useMemo<RosterFilter>(() => ({
		element: urlState.element,
		position: urlState.position,
		series: urlState.series,
		team: urlState.team,
	}), [urlState.element, urlState.position, urlState.series, urlState.team]);
	const activeFilter = webCatalogue ? webFilter : filter;
	const activeSearch = webCatalogue ? urlState.q : search;
	const teamFallback = webCatalogue && urlState.team.length > 0;
	const usingServerPage = webCatalogue && !teamFallback;
	const rosterByCode = useMemo(() => new Map(
		(entries ?? []).flatMap((entry) => [
			[entry.chara.internal_code, entry] as const,
			[entry.chara.chara_param_id, entry] as const,
		]),
	), [entries]);
	const serverEntries = useMemo(() => (catalogue?.elements ?? []).flatMap((chara) => {
		const entry = (chara.internal_code && rosterByCode.get(chara.internal_code))
			|| (chara.chara_id && rosterByCode.get(chara.chara_id));
		return entry ? [entry] : [];
	}), [catalogue, rosterByCode]);
	const retained = useMemo(() => {
		if (usingServerPage) return serverEntries;
		const list = filterRoster(entries ?? [], activeFilter, activeSearch);
		const sort = webCatalogue ? urlState.sort : byName ? "nom_fr" : "zukan";
		if (sort === "zukan") return list;
		const direction = webCatalogue && urlState.order === "desc" ? -1 : 1;
		return [...list].sort((a, b) => direction * (sort === "code"
			? a.chara.internal_code.localeCompare(b.chara.internal_code)
			: a.chara.name.localeCompare(b.chara.name, "fr")));
	}, [usingServerPage, serverEntries, entries, activeFilter, activeSearch, byName, webCatalogue, urlState.sort, urlState.order]);
	const page = useMemo(() => {
		if (teamFallback) {
			const count = Math.max(1, Math.ceil(retained.length / urlState.perPage));
			const index = Math.min(Math.max(urlState.page - 1, 0), count - 1);
			const items = retained.slice(index * urlState.perPage, (index + 1) * urlState.perPage);
			const clamped = items.length === 0 ? -1 : Math.min(Math.max(cursor, 0), items.length - 1);
			return { index, count, cursor: clamped, cursorInPage: clamped, items };
		}
		if (!usingServerPage) return listPage(retained, cursor, PAGE_SIZE);
		const clamped = retained.length === 0 ? -1 : Math.min(Math.max(cursor, 0), retained.length - 1);
		return {
			index: Math.max(0, (catalogue?.page ?? urlState.page) - 1),
			count: Math.max(1, catalogue?.pages ?? 1),
			cursor: clamped,
			cursorInPage: clamped,
			items: retained,
		};
	}, [teamFallback, usingServerPage, retained, cursor, catalogue, urlState.page, urlState.perPage]);
	const focused = page.cursorInPage >= 0 ? page.items[page.cursorInPage] ?? null : null;

	// Le Lua reçoit chaque changement de curseur : c'est lui qui décide de l'état de la liste.
	useEffect(() => {
		if (page.cursorInPage < 0 || !session.snapshot?.callbacks.includes("OnEnter")) return;
		session.dispatch({ callback: "OnEnter", args: [LIST_LAYER, page.cursorInPage] })
			.then(receive, () => { /* une frappe superseded n'est pas une panne */ });
	}, [session, receive, page.cursorInPage]);

	const move = useCallback((step: "item" | "row" | "page", direction: 1 | -1) => {
		if (webCatalogue && step === "page") {
			writeWebState({
				...urlState,
				page: Math.min(Math.max(urlState.page + direction, 1), Math.max(1, catalogue?.pages ?? 1)),
			});
			setCursor(0);
			return;
		}
		setCursor((current) => stepCursor(current, retained.length, step, direction, COLUMNS, PAGE_SIZE));
	}, [webCatalogue, writeWebState, urlState, catalogue?.pages, retained.length]);

	// Les flèches et Échap : la navigation de la grille, hors des dialogues.
	useEffect(() => {
		if (filterOpen) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
			const target = event.target;
			const editing = target instanceof HTMLElement && (target.tagName === "INPUT" || target.isContentEditable);
			if (event.key === "Escape") {
				event.preventDefault();
				if (searchOpen) {
					setSearchOpen(false);
					setSearch("");
					if (webCatalogue) writeWebState({ ...urlState, q: "", page: 1 });
					return;
				}
				onBack();
				return;
			}
			if (editing) return;
			const moves: Record<string, [("item" | "row" | "page"), 1 | -1] | undefined> = {
				ArrowRight: ["item", 1], ArrowLeft: ["item", -1],
				ArrowDown: ["row", 1], ArrowUp: ["row", -1],
				w: ["page", -1], c: ["page", 1], PageUp: ["page", -1], PageDown: ["page", 1],
			};
			const step = moves[event.key];
			if (step) { event.preventDefault(); move(step[0], step[1]); }
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [move, onBack, filterOpen, searchOpen, webCatalogue, writeWebState, urlState]);

	const localFamilies = useMemo<readonly GameFilterFamily[]>(
		() => rosterFamilies(entries ?? []).map((family) => ({
			id: family.id,
			label: family.label,
			icon: family.label.slice(0, 1),
			mode: "multi" as const,
			options: family.options.map((option) => ({ value: option.value, label: option.value, count: option.count })),
		})),
		[entries],
	);
	const families = useMemo<readonly GameFilterFamily[]>(() => {
		if (!webCatalogue) return localFamilies;
		const labels: Record<CharaFacet, string> = {
			element: "Élément", position: "Poste", rarity: "Rareté", series: "Série",
		};
		const serverFamilies = (Object.keys(labels) as CharaFacet[]).map((id) => ({
			id,
			label: labels[id],
			icon: labels[id].slice(0, 1),
			mode: "multi" as const,
			options: (catalogue?.facettes[id] ?? []).map((option) => ({
				value: option.valeur, label: option.valeur, count: option.total,
			})),
		}));
		const team = localFamilies.find((family) => family.id === "team");
		return [
			...serverFamilies,
			...(team ? [{ ...team, label: "Équipe (profil local)" }] : []),
			{
				id: "sort",
				label: "Tri",
				icon: "T",
				options: ["zukan", "code", "nom_fr", "nom_en", "nom_ja", "rarete"].flatMap((sort) => [
					{ value: `${sort}:asc`, label: `${sort} ↑` },
					{ value: `${sort}:desc`, label: `${sort} ↓` },
				]),
			},
			{
				id: "per_page",
				label: "Par page",
				icon: "P",
				options: [
					{ value: "12", label: "12 personnages" },
					{ value: "24", label: "24 personnages" },
				],
			},
		];
	}, [webCatalogue, localFamilies, catalogue]);
	const filterValue = useMemo<GameFilterValue>(() => webCatalogue ? {
		element: urlState.element,
		position: urlState.position,
		rarity: urlState.rarity,
		series: urlState.series,
		team: urlState.team,
		sort: [`${urlState.sort}:${urlState.order}`],
		per_page: [String(urlState.perPage)],
	} : filter, [webCatalogue, urlState, filter]);

	// Ce que la composition a RÉELLEMENT dessiné, publié sur la section : `drawn` et `skipped`
	// viennent du compositeur lui-même, au lieu d'un décompte de balises `<img>` chargées.
	const onCompose = useCallback(
		(report: { drawn: number; skipped: number }) =>
			setCompose({ drawn: report.drawn, skipped: report.skipped }),
		[],
	);

	const sortByName = webCatalogue ? urlState.sort === "nom_fr" : byName;
	const toggleNameSort = useCallback(() => {
		if (webCatalogue) {
			writeWebState({ ...urlState, sort: urlState.sort === "nom_fr" ? "zukan" : "nom_fr", order: "asc", page: 1 });
		} else setByName((value) => !value);
	}, [webCatalogue, writeWebState, urlState]);
	const filtersActive = webCatalogue
		? Boolean(urlState.q || urlState.element.length || urlState.position.length || urlState.rarity.length
			|| urlState.series.length || urlState.team.length || urlState.sort !== "zukan"
			|| urlState.order !== "asc" || urlState.page !== 1 || urlState.perPage !== PAGE_SIZE)
		: Object.values(filter).some((value) => value.length > 0);
	const hints = useMemo(() => [
		{ key: "Tab", keyLabel: "Tab", label: sortByName ? "Par nom" : "Par acquisition", onActivate: toggleNameSort },
		{ key: "v", keyLabel: "V", label: hideStats ? "Afficher les stats" : "Cacher les stats", onActivate: () => setHideStats((v) => !v) },
		{ key: "x", keyLabel: "X", label: "Chercher par nom de joueur", onActivate: () => setSearchOpen(true) },
		{ key: "Alt", keyLabel: "Alt", label: `Filtre : ${filtersActive ? "ON" : "OFF"}`, onActivate: () => setFilterOpen(true) },
		...(page.index > 0 ? [{ key: "w", keyLabel: "W", label: "Page précédente", onActivate: () => move("page", -1) }] : []),
		...(page.index + 1 < page.count ? [{ key: "c", keyLabel: "C", label: "Page suivante", onActivate: () => move("page", 1) }] : []),
		{ key: "Escape", keyLabel: "Esc", label: "Retour", onActivate: onBack, fromInputs: true },
	], [sortByName, toggleNameSort, hideStats, filtersActive, page.index, page.count, move, onBack]);

	return (
		<section
			className="player-bank"
			aria-label="Banque"
			data-screen={SCREEN}
			data-render-source="vfs-layout"
			data-lua-observation={runtimeState}
			data-runtime-layers={runtime ? Object.keys(runtime.scene.layers).length : 0}
			data-layout-objects={layout?.objects.length ?? 0}
			data-compose={`${compose.drawn}/${compose.drawn + compose.skipped}`}
			data-roster={entries?.length ?? 0}
			data-retained={retained.length}
			data-origin={entries?.[0]?.origin ?? "none"}
		>
			<GameCanvas canvas={layout?.canvas ?? { w: 1280, h: 720 }}>
				{layout ? (
					<LayoutCanvas layout={layout} screen={SCREEN} assumeUnknownVisible={false} onReport={onCompose} />
				) : null}

				<header className="player-bank__title">
					<NativeText text="Banque" height={28} />
				</header>

				<div className="player-bank__grid" role="listbox" aria-label="Personnages de la banque" aria-activedescendant={focused ? `bank-item-${focused.chara.chara_param_id}` : undefined}>
					{page.items.map((entry, index) => {
						const active = index === page.cursorInPage;
						const catalogueEntry = catalogue?.elements.find((candidate) =>
							candidate.internal_code === entry.chara.internal_code
							|| candidate.chara_id === entry.chara.chara_param_id);
						return (
							<button
								key={entry.chara.chara_param_id}
								id={`bank-item-${entry.chara.chara_param_id}`}
								type="button"
								role="option"
								aria-selected={active}
								data-state={active ? "focused" : "idle"}
								className="player-bank__card"
								onClick={() => setCursor(usingServerPage ? index : page.index * PAGE_SIZE + index)}
							>
								{face ? (
									<img
										className="player-bank__face"
										alt=""
										loading="lazy"
										src={face(`data/dx11/chara/face/${entry.chara.internal_code}.g4tx`)}
										onError={(event) => { event.currentTarget.style.visibility = "hidden"; }}
									/>
								) : null}
								<span className="player-bank__level">Nv. {entry.level}</span>
								<span className="player-bank__name">{entry.chara.name}</span>
								<span className="player-bank__tags">
									{entry.chara.element} · {entry.chara.main_position}
									{catalogueEntry?.rarity ? ` · ${catalogueEntry.rarity}` : ""}
								</span>
							</button>
						);
					})}
					{page.items.length === 0 ? (
						rosterFailed || catalogueFailed ? <ScreenStatus state="unavailable" className="player-bank__empty" /> :
						entries && (!usingServerPage || catalogue) ? <p className="player-bank__empty">Aucun personnage retenu.</p> :
						<ScreenStatus state="loading" className="player-bank__empty" />
					) : null}
				</div>

				<footer className="player-bank__counts">
					<span>Disponibles : {usingServerPage ? catalogue?.total ?? 0 : retained.length}</span>
					<span>Page {page.index + 1} / {page.count}</span>
					{usingServerPage && catalogue ? (
						<span data-bank-applied-filters>
							Index : {appliedCharaSummary(catalogue)}
						</span>
					) : null}
						{teamFallback ? <span>Équipe : profil local · rareté et noms EN/JA indisponibles</span> : null}
					{layoutFailed ? <span className="screen-status__a11y" role="alert">Le décor de cet écran ne peut pas être affiché pour le moment.</span> : null}
				</footer>

				<aside className="player-bank__detail" aria-label="Fiche du personnage">
					{focused ? (
						<>
							<h2 className="player-bank__detail-name">{focused.chara.name}</h2>
							<p className="player-bank__detail-tags">
								{focused.chara.element} · {focused.chara.main_position}
								{focused.chara.sub_position && focused.chara.sub_position !== focused.chara.main_position ? ` / ${focused.chara.sub_position}` : ""}
								{focused.chara.team ? ` · ${focused.chara.team}` : ""}
							</p>
							<p className="player-bank__detail-level">Niv. {focused.level}</p>
							{focused.chara.description ? <p className="player-bank__detail-desc">{focused.chara.description}</p> : null}
							{hideStats ? null : (
								<dl className="player-bank__stats">
									{ROSTER_STATS.map((stat) => (
										<div key={stat.key}>
											<dt>{stat.label}</dt>
											<dd>{focused.stats[stat.key]}</dd>
										</div>
									))}
									<div><dt>Total</dt><dd>{focused.stats.total}</dd></div>
								</dl>
							)}
							<ul className="player-bank__skills">
								{focused.skills.map((skill) => <li key={skill}>{skill}</li>)}
							</ul>
						</>
					) : null}
				</aside>

				{searchOpen ? (
					<div className="player-bank__search">
						<GameSearchBar
							value={search}
							onChange={setSearch}
							onSubmit={(q) => {
								if (webCatalogue) writeWebState({ ...urlState, q, page: 1 });
								setCursor(0);
							}}
							placeholder="Nom de joueur"
							autoFocus
						/>
					</div>
				) : null}

				{filterOpen ? (
					<GameFilterPanel
						className="player-bank__filters"
						families={families}
						value={filterValue}
						count={usingServerPage ? catalogue?.total ?? 0 : retained.length}
						total={usingServerPage ? undefined : entries?.length ?? 0}
						countUnit="personnages"
						onConfirm={(value: GameFilterValue) => {
							if (webCatalogue) {
								const [sort, order] = (value.sort?.[0] ?? "zukan:asc").split(":");
								const team = [...(value.team ?? [])];
								const next: PlayerBankUrlState = {
									...urlState,
									element: [...(value.element ?? [])],
									position: [...(value.position ?? [])],
									rarity: [...(value.rarity ?? [])],
									series: [...(value.series ?? [])],
									team,
									sort: BANK_SORTS.has(sort as CharaSort) ? sort as CharaSort : "zukan",
									order: order === "desc" ? "desc" : "asc",
									perPage: positive(value.per_page?.[0] ?? null, PAGE_SIZE, PAGE_SIZE),
									page: 1,
								};
								writeWebState(normalizeTeamFallback(next));
							} else setFilter(value);
							setCursor(0);
							setFilterOpen(false);
						}}
						onClose={() => setFilterOpen(false)}
					/>
				) : null}
			</GameCanvas>

			<GameHintBar className="player-bank__hints" hints={hints} enabled={!filterOpen} />
		</section>
	);
}
