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
	useSettings,
	useGameTextResolver,
	type GameLocale,
} from "@niers/inacord-ui";
import {
	fetchCharaCatalog,
	type CharaCatalogPage,
	type CharaFacet,
	type CharaSort,
} from "@niers/asset-source/chara";
import { fetchJson } from "@niers/asset-source";
import { StatHeptagon } from "@niers/inacord-ui/components/wiki/wiki/StatHeptagon";
import { getCharacterFaceUrl } from "@niers/inacord-ui/lib/wikiImages";
import { lireLayout, type LayoutJeu } from "@niers/inacord-ui/shell/game-layout";
import { listPage, stepCursor } from "../game/list-page";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
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

/**
 * Le layout de l'écran, validé par `lireLayout` — un JSON mal formé échoue bruyamment — et dans
 * la langue de JEU choisie.
 *
 * Elle était figée à `"fr"` ici et dans `createMenuRuntime` plus bas, alors que l'écran frère
 * `TrophyGallery` lit déjà `gameLocale` depuis `useSettings`. Le réglage restait donc sans effet
 * sur la Banque.
 */
async function loadLayout(locale: GameLocale, signal: AbortSignal): Promise<LayoutJeu> {
	return lireLayout(await loadMenuLayout(SCREEN, locale, signal));
}

/**
 * Les sept statistiques, sous les noms qu'attend le composant partagé.
 *
 * `RosterStats` les abrège (`kc`, `cr`, `tc`…) parce que c'est ainsi que la donnée de jeu les
 * nomme ; `StatHeptagon` les épelle. La traduction vit ici, à la frontière, plutôt que d'imposer
 * l'un des deux vocabulaires à l'autre.
 */
function heptagone(stats: RosterEntry["stats"]) {
	return {
		kick: stats.kc,
		control: stats.cr,
		technique: stats.tc,
		pressure: stats.pr,
		physical: stats.ps,
		agility: stats.ag,
		intelligence: stats.it,
	};
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

/** Un personnage du profil complet : niveau atteint et statistiques à ce niveau. */
interface ProfileChara {
	id: string;
	level: number;
	stats: RosterEntry["stats"];
	skills?: string[];
	board_complete?: boolean;
}

/**
 * Le vivier : les DEUX sources, jointes — jamais l'une au lieu de l'autre.
 *
 * ── POURQUOI LE PROFIL N'ARRIVAIT JAMAIS ───────────────────────────────────
 * Cette fonction lisait `/api/v1/profile/complete`, puis passait ses personnages à
 * `readCharas`, qui exige un `chara_param_id`. Or une entrée de profil porte `id`, `level`,
 * `name`, `skills`, `stats` et `board_complete` — pas de `chara_param_id`. Le filtre les
 * rejetait donc TOUS, `charas.length` valait 0, et l'écran retombait sur `game-data/charas`
 * sans que rien ne le signale. Le profil complet n'a jamais été affiché.
 *
 * ── ET POURQUOI LES DEUX, PLUTÔT QUE L'UN ──────────────────────────────────
 * Les deux réponses décrivent les mêmes 6 101 personnages, et se complètent exactement :
 * `game-data` porte l'identité — élément, poste, série, équipe, `internal_code` d'où vient le
 * portrait — et le profil porte le niveau atteint, les statistiques À ce niveau et
 * `board_complete`. Prendre le profil seul afficherait des cartes sans élément ni poste ;
 * prendre `game-data` seul perdrait le niveau. La jointure se fait sur
 * `profil.id == game-data.chara_param_id`, vérifiée le 2026-09-19 : 6 101 sur 6 101, sans
 * reste d'aucun côté.
 */
async function loadRoster(signal: AbortSignal): Promise<RosterEntry[]> {
	const [profileBody, charasData] = await Promise.all([
		fetchJson<{ charas?: unknown }>("/api/v1/profile/complete", { signal, timeoutMs: 10_000, retries: 1 }).catch(() => null),
		fetchJson<unknown>("/api/v1/game-data/charas", { signal, timeoutMs: 15_000, retries: 2 }),
	]);
	const charas = readCharas(charasData);

	// Le profil est facultatif : absent, l'écran montre le même vivier au niveau de référence,
	// et chaque entrée dit d'où elle vient par `origin`.
	let progression: Map<string, ProfileChara> | null = null;
	if (profileBody) {
		const rows = Array.isArray(profileBody.charas) ? (profileBody.charas as ProfileChara[]) : [];
		const valides = rows.filter((row) => row && typeof row.id === "string" && Boolean(row.stats));
		if (valides.length > 0) progression = new Map(valides.map((row) => [row.id, row]));
	}
	if (!progression) return rosterFromCharas(charas);

	return charas.map((chara) => {
		const atteint = progression.get(chara.chara_param_id);
		if (!atteint) return { chara, level: PROFILE_LEVEL, stats: chara.stats, skills: chara.skills, origin: "game-data" as const };
		return {
			chara,
			level: atteint.level,
			stats: atteint.stats,
			// Le profil rend une liste de techniques vide pour un personnage dont le plateau n'a
			// rien débloqué : celle de `game-data` reste alors la seule mesure disponible.
			skills: atteint.skills?.length ? atteint.skills : chara.skills,
			origin: "profile" as const,
		};
	});
}

export interface PlayerBankUrlState {
	q: string;
	element: string[];
	position: string[];
	rarity: string[];
	series: string[];
	team: string[];
	gender: string[];
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
	gender: [],
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

function values(params: URLSearchParams, key: CharaFacet | "team" | "gender"): string[] {
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
		gender: values(params, "gender"),
		sort: requestedSort && BANK_SORTS.has(requestedSort) ? requestedSort : "zukan",
		order: params.get("ordre") === "desc" ? "desc" : "asc",
		page: positive(params.get("page"), 1, 0xffff_ffff),
		perPage: positive(params.get("per_page"), PAGE_SIZE, PAGE_SIZE),
	};
}

function writeValues(params: URLSearchParams, key: CharaFacet | "team" | "gender", selected: readonly string[]): void {
	if (selected.length === 1) params.set(key, selected[0] ?? "");
	else if (selected.length > 1) params.set(`${key}__in`, selected.join(","));
}

export function playerBankHref(location: string, state: PlayerBankUrlState): string {
	const url = new URL(location, "http://localhost");
	const managed = [
		"q", "element", "element__in", "position", "position__in", "rarity", "rarity__in",
		"series", "series__in", "team", "team__in", "gender", "gender__in", "tri", "ordre", "page", "per_page",
	];
	for (const key of managed) url.searchParams.delete(key);
	if (state.q) url.searchParams.set("q", state.q);
	writeValues(url.searchParams, "element", state.element);
	writeValues(url.searchParams, "position", state.position);
	writeValues(url.searchParams, "rarity", state.rarity);
	writeValues(url.searchParams, "series", state.series);
	writeValues(url.searchParams, "team", state.team);
	writeValues(url.searchParams, "gender", state.gender ?? []);
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

	const { settings: { gameLocale } } = useSettings();
	// Les mots du JEU, quand il les écrit. Un libellé absent de la carte mesurée reste celui
	// du code : la carte refuse de deviner, et cet écran ne devine pas non plus.
	const motJeu = useGameTextResolver();

	useEffect(() => {
		const controller = new AbortController();
		loadLayout(gameLocale, controller.signal).then(setLayout, () => { if (!controller.signal.aborted) setLayoutFailed(true); });
		loadRoster(controller.signal).then(setEntries, () => { if (!controller.signal.aborted) setRosterFailed(true); });
		return () => controller.abort();
	}, [gameLocale]);

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
		() => createMenuRuntime(SCREEN, { locale: gameLocale, itemCounts: { [LIST_LAYER]: PAGE_SIZE } }),
		[gameLocale],
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
		gender: urlState.gender,
	}), [urlState.element, urlState.position, urlState.series, urlState.team, urlState.gender]);
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

const ELEMENT_DETAILS: Record<string, { iconUrl?: string; desc: string }> = {
	Vent: { iconUrl: "/spirit_type/wind.webp", desc: "Agilité et rapidité" },
	Feu: { iconUrl: "/spirit_type/fire.webp", desc: "Puissance et frappe" },
	Bois: { iconUrl: "/spirit_type/forest.webp", desc: "Technique et contrôle" },
	Forêt: { iconUrl: "/spirit_type/forest.webp", desc: "Technique et contrôle" },
	Terre: { iconUrl: "/spirit_type/mountain.webp", desc: "Force et défense" },
	Montagne: { iconUrl: "/spirit_type/mountain.webp", desc: "Force et défense" },
};

const POSITION_DETAILS: Record<string, { label: string; desc: string }> = {
	FW: { label: "Attaquant (FW)", desc: "Avant-centre, ailier" },
	MF: { label: "Milieu (MF)", desc: "Milieu de terrain, relayeur" },
	DF: { label: "Défenseur (DF)", desc: "Défenseur central, latéral" },
	GK: { label: "Gardien (GK)", desc: "Gardien de but" },
};

const GENDER_DETAILS: Record<string, { label: string; desc: string }> = {
	Garçon: { label: "Garçon", desc: "Joueur masculin" },
	Fille: { label: "Fille", desc: "Joueuse féminine" },
	Autre: { label: "Autre", desc: "Autre morphologie" },
};

const RARITY_DETAILS: Record<string, { desc: string }> = {
	N: { desc: "Normale" },
	R: { desc: "Rare" },
	SR: { desc: "Super Rare" },
	UR: { desc: "Ultra Rare" },
	LEGEND: { desc: "Légendaire" },
};

function enrichFilterOption(familyId: string, value: string, count?: number) {
	let label = value;
	let description: ReactNode | undefined;
	let icon: ReactNode | undefined;
	if (familyId === "element") {
		const el = ELEMENT_DETAILS[value];
		if (el) {
			description = el.desc;
			if (el.iconUrl) {
				icon = (
					<img
						src={el.iconUrl}
						alt={value}
						width={20}
						height={20}
						style={{ objectFit: "contain", verticalAlign: "middle", display: "inline-block" }}
					/>
				);
			}
		}
	} else if (familyId === "position") {
		const pos = POSITION_DETAILS[value];
		if (pos) {
			label = pos.label;
			description = pos.desc;
		}
	} else if (familyId === "gender") {
		const g = GENDER_DETAILS[value];
		if (g) {
			label = g.label;
			description = g.desc;
		}
	} else if (familyId === "rarity") {
		const r = RARITY_DETAILS[value];
		if (r) {
			description = r.desc;
		}
	}
	return { value, label, description, icon, count };
}

	const localFamilies = useMemo<readonly GameFilterFamily[]>(
		() => rosterFamilies(entries ?? []).map((family) => ({
			id: family.id,
			label: family.label,
			icon: family.label.slice(0, 1),
			mode: "multi" as const,
			options: family.options.map((option) => enrichFilterOption(family.id, option.value, option.count)),
		})),
		[entries],
	);
	const families = useMemo<readonly GameFilterFamily[]>(() => {
		if (!webCatalogue) return localFamilies;
		const labels: Record<CharaFacet, string> = {
			// Les quatre familles portent les mots du JEU quand il les écrit. « Poste » n'est pas
			// dans la carte mesurée : il reste donc tel quel, comme la carte le prescrit.
			element: motJeu("Élément"), position: "Poste", rarity: motJeu("Rareté"), series: motJeu("Série"),
		};
		const serverFamilies = (Object.keys(labels) as CharaFacet[]).map((id) => ({
			id,
			label: labels[id],
			icon: labels[id].slice(0, 1),
			mode: "multi" as const,
			options: (catalogue?.facettes[id] ?? []).map((option) =>
				enrichFilterOption(id, option.valeur, option.total)),
		}));
		const team = localFamilies.find((family) => family.id === "team");
		const gender = localFamilies.find((family) => family.id === "gender");
		return [
			...serverFamilies,
			...(gender ? [gender] : []),
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
		gender: urlState.gender,
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
			|| urlState.series.length || urlState.team.length || urlState.gender.length || urlState.sort !== "zukan"
			|| urlState.order !== "asc" || urlState.page !== 1 || urlState.perPage !== PAGE_SIZE)
		: Object.values(filter).some((value) => value.length > 0);
	const hints = useMemo(() => [
		{ key: "Tab", keyLabel: "Tab", label: sortByName ? motJeu("Par nom") : motJeu("Par acquisition"), onActivate: toggleNameSort },
		{ key: "v", keyLabel: "V", label: hideStats ? "Afficher les stats" : "Cacher les stats", onActivate: () => setHideStats((v) => !v) },
		{ key: "x", keyLabel: "X", label: "Chercher par nom de joueur", onActivate: () => setSearchOpen(true) },
		{ key: "Alt", keyLabel: "Alt", label: `Filtre : ${filtersActive ? "ON" : "OFF"}`, onActivate: () => setFilterOpen(true) },
		...(page.index > 0 ? [{ key: "w", keyLabel: "W", label: "Page précédente", onActivate: () => move("page", -1) }] : []),
		...(page.index + 1 < page.count ? [{ key: "c", keyLabel: "C", label: "Page suivante", onActivate: () => move("page", 1) }] : []),
		{ key: "Escape", keyLabel: "Esc", label: motJeu("Retour"), onActivate: onBack, fromInputs: true },
	], [sortByName, toggleNameSort, hideStats, filtersActive, page.index, page.count, move, onBack]);

	return (
		<section
			className="player-bank"
			aria-label={motJeu("Banque")}
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
					<NativeText text={motJeu("Banque")} height={28} />
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
										/*
										 * Le chemin vient du module partagé, il n'est pas reconstruit ici.
										 *
										 * Cette ligne composait `data/dx11/chara/face/<code>.g4tx`, qui N'EXISTE PAS :
										 * `niers vfs find c01001230` ne rend rien sous ce préfixe, et la requête
										 * correspondante répondait 404 quand la bonne rend 31 788 octets. Toutes les
										 * vignettes de la Banque étaient donc muettes, et le `onError` juste en dessous
										 * masquait l'image — un défaut qu'aucun écran ne signalait. Le dépôt portait ce
										 * chemin dans UN seul fichier, celui-ci, contre huit pour le bon.
										 *
										 * `getCharacterFaceUrl` sait en plus qu'une variante de tenue (`_5000`) n'a pas
										 * de visage propre et retombe sur le code de base.
										 */
										src={face(getCharacterFaceUrl(entry.chara.internal_code))}
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
								<div className="player-bank__stats">
									{/*
									  * ATTRIBUTS — le radar du jeu, pas une liste.
									  *
									  * `bank_character_detail.png` dessine les sept statistiques sur un heptagone, chacune
									  * étiquetée des postes où elle compte. `StatHeptagon` fait déjà exactement cela : il a
									  * été écrit pour le wiki Azalée, et ses étiquettes (`kick → ATT`,
									  * `control → ATT/MIL`, `pressure → GAR/DÉF`, `agility → GAR`, `intelligence → DÉF/MIL`)
									  * coïncident avec celles relevées sur la capture. Le `<dl>` qui était ici perdait
									  * l'information de poste, que le jeu montre.
									  */}
									<StatHeptagon stats={heptagone(focused.stats)} />
									<p className="player-bank__stats-total">Total {focused.stats.total}</p>
								</div>
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
									gender: [...(value.gender ?? [])],
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
