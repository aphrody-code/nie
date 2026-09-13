import { useResourceNames, resourceLabel } from "../game/resource-names";
import { WebGallery } from "./WebGallery";
import { TextCatalog } from "./TextCatalog";
/**
 * Les quatre catalogues du jeu — textures, modèles, sons, vidéos — portés du wiki vers nie.
 *
 * ## Une page pour quatre vues, et pourquoi
 *
 * Les quatre pages d'origine (`legacy/app/{textures,modeles,sons,videos}`, ~1 500 lignes à
 * elles quatre) faisaient la même chose : lister un filtre du VFS, paginer, afficher une
 * vignette. Elles divergeaient sur des détails d'affichage et sur rien d'autre — quatre copies
 * d'une même logique, qui dérivaient chacune de leur côté.
 *
 * Ici, la vue est un PARAMÈTRE. Ce qui diffère vraiment entre un son et une texture — la
 * présence d'un aperçu visuel — se lit dans les capacités de l'hôte, pas dans quatre fichiers.
 *
 * ## Ce qui change par rapport aux pages d'origine
 *
 * Elles parlaient au VFS par la couche `cpk/live` du wiki, adossée au disque du VPS. Celle-ci
 * ne connaît que le contrat : elle demande une page de catalogue à `AssetSource`, et l'hôte
 * décide d'où elle vient. nie la sert par `/api/v1/<vue>`, Inacord par sa recherche
 * native.
 *
 * ## La vue est un FILTRE, jamais un dossier
 *
 * `textures` ne désigne pas un répertoire du jeu : c'est un filtre enregistré sur l'espace VFS,
 * qui retient les extensions d'image (amendement A3). Le `chemin` de chaque élément est donc son
 * adresse complète et verbatim — c'est lui qu'on passe à `urlFichier()` ou `vignette()`, jamais
 * un chemin reconstruit à partir du nom.
 *
 * ## L'habillage suit celui de l'accueil
 *
 * Fond clair, titres en bandeau biseauté, cartes blanches cerclées de bleu : les mêmes formes
 * que le menu principal. La page était auparavant rendue sur fond noir, avec ses propres
 * bandeaux et ses propres pastilles — un second thème pour le même site.
 */
import type {
	EntreeVfs as VfsEntry,
	SourceCatalogPage,
	VueCatalogue as CatalogView,
} from "@niers/asset-source";
import {
	describeFilters,
	GameCountBadge,
	type GameFilterFamily,
	GameFilterPanel,
	type GameFilterValue,
	type GameHint,
	GameHintBar,
	GameHeaderBar,
	GameSearchBar,
	type GameTab,
	GameTabStrip,
	GLYPHES,
	useRouter,
	useAssetSource,
	useCapacites as useCapabilities,
} from "@niers/inacord-ui";
import { ExplorerEntries, ExplorerSurface } from "@niers/inacord-ui/explorer/explorer-surface";
import { PaginationControls } from "@niers/inacord-ui/components/ui/pagination-controls";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { browserLocationSnapshot, subscribeBrowserLocation, writeBrowserHistory } from "@niers/inacord-ui/lib/browser-navigation";
import { entryLabel, MEDIA } from "../entries";
import { pathForEntry, splitLanguagePrefix } from "../routing";
import { agree, Notice, readableSize, ViewTitle } from "./screen-parts";
import { Modeles3D as Models3D } from "./Models3D";
import { CatalogAudioBank, CatalogMoviePreview } from "./CatalogMedia";
import { GameText } from "@niers/inacord-ui";

/**
 * Tailles de page proposées. Le serveur borne à **200** (`config.rs:27`) : proposer davantage
 * ferait promettre au lecteur un réglage que le serveur ramènerait en silence.
 */
const PAGE_SIZES = [60, 100, 200] as const;

/** Taille de page par défaut : 60 tient dans une grille sans peser. */
const DEFAULT_PAGE_SIZE = 60;

/**
 * L'état de filtre de cette page, tel qu'il vit dans l'URL.
 *
 * Il y vit parce que sinon il ne se partage pas, ne survit pas au rechargement et n'est pas
 * indexable — et parce que la mesure du 2026-09-06 a montré que le serveur servait **41 filtres
 * sur 48** dont la page n'utilisait qu'un seul.
 */
export type FilterState = {
	q: string;
	glob: string;
	prefixe: string;
	ext: string;
	sort: "nom" | "taille";
	order: "asc" | "desc";
	cpk: string;
	tailleMin: number | undefined;
	tailleMax: number | undefined;
	pageSize: number;
	page: number;
};

type AppliedCatalogFilters = NonNullable<SourceCatalogPage<VfsEntry>["filtres"]>;

/** Describe what the server confirms it applied; the local query string is not evidence. */
function appliedFilterSummary(filters: AppliedCatalogFilters): string[] {
	const parts: string[] = [];
	if (filters.q) parts.push(`recherche « ${filters.q} »`);
	if (filters.glob) parts.push(`glob ${filters.glob}`);
	if (filters.prefixe) parts.push(`sous-arbre ${filters.prefixe}`);
	if (filters.ext) parts.push(`extension ${filters.ext}`);
	if (filters.cpk) parts.push(`CPK ${filters.cpk}`);
	if (filters.taille_min !== null && filters.taille_min !== undefined) parts.push(`taille ≥ ${filters.taille_min.toLocaleString("fr")} octets`);
	if (filters.taille_max !== null && filters.taille_max !== undefined) parts.push(`taille ≤ ${filters.taille_max.toLocaleString("fr")} octets`);
	parts.push(`tri ${filters.tri ?? "nom"} ${filters.ordre === "desc" ? "décroissant" : "croissant"}`);
	return parts;
}

function appliedFilterWarnings(filters: AppliedCatalogFilters): string[] {
	return [
		filters.ext_inconnue ? "L’extension demandée n’existe pas dans l’index." : null,
		filters.cpk_inconnu ? "L’archive CPK demandée n’existe pas dans l’index." : null,
		filters.glob_vide ? "Le motif glob ne retient aucun motif applicable." : null,
	].filter((message): message is string => message !== null);
}

/** An unsigned integer carried by a filter URL, or no bound when it is absent/invalid. */
function optionalSize(value: string | null): number | undefined {
	if (value === null || value.trim() === "") return undefined;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

/** Lit l'état depuis l'URL courante. Une valeur illisible retombe sur son défaut. */
export function filterStateFromUrl(search = window.location.search): FilterState {
	const params = new URLSearchParams(search);
	// `par_page` was the first UI spelling. The HTTP contract has always been `per_page`:
	// accept the former only as input so shared API URLs and browser URLs now agree.
	const pageSize = Number(params.has("per_page") ? params.get("per_page") : params.get("par_page"));
	const page = Number(params.get("page"));
	return {
		q: params.get("q") ?? "",
		glob: params.get("glob")?.trim() ?? "",
		prefixe: params.get("prefixe")?.trim() ?? "",
		ext: params.get("ext") ?? "",
		sort: params.get("tri") === "taille" ? "taille" : "nom",
		order: params.get("ordre") === "desc" ? "desc" : "asc",
		cpk: params.get("cpk")?.trim() ?? "",
		tailleMin: optionalSize(params.get("taille_min")),
		tailleMax: optionalSize(params.get("taille_max")),
		// `includes` sur la liste servie, jamais la valeur brute : un `per_page=100000` tapé
		// dans la barre d'adresse ne doit pas devenir une promesse que le serveur rabotera.
		pageSize: PAGE_SIZES.includes(pageSize as (typeof PAGE_SIZES)[number])
			? pageSize
			: DEFAULT_PAGE_SIZE,
		page: Number.isSafeInteger(page) && page >= 1 ? page : 1,
	};
}

/**
 * Écrit l'état dans l'URL, sans empiler d'entrée d'historique.
 *
 * `replaceState` : filtrer n'est pas naviguer. Le `pathname` n'est pas touché — c'est lui qui
 * porte la vue (`App.tsx:64-66`).
 */
function writeUrl(state: FilterState) {
	const url = new URL(window.location.href);
	const pairs: [string, string][] = [
		["q", state.q],
		["glob", state.glob],
		["prefixe", state.prefixe],
		["ext", state.ext],
		["tri", state.sort === "nom" ? "" : state.sort],
		["ordre", state.order === "asc" ? "" : state.order],
		["cpk", state.cpk],
		["taille_min", state.tailleMin === undefined ? "" : String(state.tailleMin)],
		["taille_max", state.tailleMax === undefined ? "" : String(state.tailleMax)],
		["per_page", state.pageSize === DEFAULT_PAGE_SIZE ? "" : String(state.pageSize)],
		["page", state.page === 1 ? "" : String(state.page)],
	];
	// Un défaut ne s'écrit pas dans l'URL : `?tri=nom&ordre=asc&page=1` est du bruit qui rend
	// deux adresses différentes pour le même écran, et casse le partage autant que l'absence.
	for (const [key, value] of pairs) {
		if (value) url.searchParams.set(key, value);
		else url.searchParams.delete(key);
	}
	if (url.href !== window.location.href) writeBrowserHistory(url, window.history.state, "replace");
}

/**
 * Canonical target for a media tab.
 *
 * The path owns the selected catalogue. Only filters meaningful to the destination survive;
 * type-specific filters and the page are dropped when the user changes catalogue.
 */
export function catalogHrefForView(
	location: string,
	nextView: CatalogView,
	options: { resetPage?: boolean } = {},
): string {
	const current = new URL(location, "http://localhost");
	const prefix = splitLanguagePrefix(current.pathname).prefix;
	const target = new URL(pathForEntry(prefix, nextView), current.origin);
	const source = current.searchParams;
	if (splitLanguagePrefix(current.pathname).route.replace(/^\//, "") === MEDIA) {
		// The HTTP boundary performs the same migration. Preserve every non-selector pair
		// verbatim so SSR and client-only hosts produce the identical Location, including repeated
		// parameters; the destination screen may later discard fields it does not understand.
		for (const [key, value] of source) if (key !== "vue") target.searchParams.append(key, value);
		return `${target.pathname}${target.search}`;
	}
	const filters = filterStateFromUrl(current.search);
	if (filters.q) target.searchParams.set("q", filters.q);
	if (nextView === "modeles") {
		const family = source.get("famille")?.trim();
		if (family) target.searchParams.set("famille", family);
		const rawPageSize = Number(source.has("per_page") ? source.get("per_page") : source.get("par_page"));
		if (Number.isSafeInteger(rawPageSize) && rawPageSize >= 1 && rawPageSize <= 200) {
			target.searchParams.set("per_page", String(rawPageSize));
		}
	} else {
		if (filters.glob) target.searchParams.set("glob", filters.glob);
		if (filters.prefixe) target.searchParams.set("prefixe", filters.prefixe);
		if (filters.sort !== "nom") target.searchParams.set("tri", filters.sort);
		if (filters.order !== "asc") target.searchParams.set("ordre", filters.order);
		if (filters.pageSize !== DEFAULT_PAGE_SIZE) target.searchParams.set("per_page", String(filters.pageSize));
		if (filters.cpk) target.searchParams.set("cpk", filters.cpk);
		if (filters.tailleMin !== undefined) target.searchParams.set("taille_min", String(filters.tailleMin));
		if (filters.tailleMax !== undefined) target.searchParams.set("taille_max", String(filters.tailleMax));
		const extension = filters.ext;
		if (extension && EXTENSIONS_BY_VIEW[nextView]?.includes(extension)) {
			target.searchParams.set("ext", extension);
		}
		if (nextView === "textures") {
			const display = source.get("display");
			if (display === "gallery" || display === "text") target.searchParams.set("display", display);
		}
	}
	if (options.resetPage === false && filters.page > 1) target.searchParams.set("page", String(filters.page));
	return `${target.pathname}${target.search}`;
}

/** Extensions accepted by the three VFS catalogues (`Vue::extensions` on the server). */
const EXTENSIONS_BY_VIEW: Record<string, readonly string[]> = {
	textures: ["g4tx", "dds", "png"],
	sons: ["acb", "awb", "hca", "adx", "wav"],
	videos: ["usm", "mp4", "webm"],
};

/** Les touches de la page : « F » ouvre les filtres, « X » donne le focus à la recherche. */
const FILTER_KEY = "f";
const SEARCH_KEY = "x";

type ExtraFilterState = Pick<FilterState, "glob" | "prefixe" | "cpk" | "tailleMin" | "tailleMax">;

/** A free-form server filter presented inside the game's filter-family frame. */
function filterField(
	label: string,
	value: string,
	onChange: (value: string) => void,
	options?: { type?: "text" | "number"; placeholder?: string },
) {
	return (
		<label style={{ display: "grid", gap: 6, fontWeight: 700 }}>
			<span>{label}</span>
			<input
				type={options?.type ?? "text"}
				min={options?.type === "number" ? 0 : undefined}
				step={options?.type === "number" ? 1 : undefined}
				value={value}
				onChange={(event) => onChange(event.currentTarget.value)}
				placeholder={options?.placeholder}
				aria-label={label}
				style={{
					width: "100%",
					border: "1px solid var(--jeu-tuile-bord)",
					borderRadius: "var(--jeu-rayon)",
					padding: "var(--jeu-espace-s) var(--jeu-espace-m)",
					background: "var(--jeu-surface-craie)",
					color: "var(--jeu-nuit-profonde)",
					font: "inherit",
				}}
			/>
		</label>
	);
}

/** Le dialogue FILTRES du jeu, sur tous les réglages que le catalogue sert. */
function catalogFamilies(
	view: CatalogView,
	extra: ExtraFilterState,
	onExtra: (next: ExtraFilterState) => void,
): GameFilterFamily[] {
	const sizeValue = (value: number | undefined) => value === undefined ? "" : String(value);
	const selectedOption = (value: string, label: string) => value ? [{ value, label }] : [];
	return [
		{
			id: "ext",
			label: "Extension",
			icon: GLYPHES.livre,
			options: (EXTENSIONS_BY_VIEW[view] ?? []).map((extension) => ({
				value: extension,
				label: extension,
			})),
		},
		{
			id: "glob",
			label: "Motif glob",
			icon: GLYPHES.arbre,
			options: selectedOption(extra.glob, extra.glob),
			extra: filterField("Motif glob du jeu", extra.glob, (glob) => onExtra({ ...extra, glob }), {
				placeholder: "data/dx11/**,!**/movie/**",
			}),
		},
		{
			id: "prefixe",
			label: "Sous-arbre VFS",
			icon: GLYPHES.arbre,
			options: selectedOption(extra.prefixe, extra.prefixe),
			extra: filterField("Préfixe VFS", extra.prefixe, (prefixe) => onExtra({ ...extra, prefixe }), {
				placeholder: "data/dx11/menu",
			}),
		},
		{
			id: "cpk",
			label: "Archive CPK",
			icon: GLYPHES.arbre,
			options: selectedOption(extra.cpk, extra.cpk),
			extra: filterField("Nom exact de l’archive CPK", extra.cpk, (cpk) => onExtra({ ...extra, cpk }), {
				placeholder: "data_1.cpk",
			}),
		},
		{
			id: "taille_min",
			label: "Taille minimale",
			icon: GLYPHES.cube,
			options: selectedOption(sizeValue(extra.tailleMin), extra.tailleMin === undefined ? "" : `≥ ${extra.tailleMin.toLocaleString("fr")} octets`),
			extra: filterField("Minimum en octets", sizeValue(extra.tailleMin), (value) => onExtra({ ...extra, tailleMin: optionalSize(value) }), {
				type: "number",
				placeholder: "0",
			}),
		},
		{
			id: "taille_max",
			label: "Taille maximale",
			icon: GLYPHES.cube,
			options: selectedOption(sizeValue(extra.tailleMax), extra.tailleMax === undefined ? "" : `≤ ${extra.tailleMax.toLocaleString("fr")} octets`),
			extra: filterField("Maximum en octets", sizeValue(extra.tailleMax), (value) => onExtra({ ...extra, tailleMax: optionalSize(value) }), {
				type: "number",
				placeholder: "1048576",
			}),
		},
		{
			id: "tri",
			label: "Tri",
			icon: GLYPHES.engrenage,
			options: [
				{ value: "nom-desc", label: "Nom (Z→A)" },
				{ value: "taille-asc", label: "Taille (petits d'abord)" },
				{ value: "taille-desc", label: "Taille (gros d'abord)" },
			],
		},
		{
			id: "per_page",
			label: "Par page",
			icon: GLYPHES.image,
			options: PAGE_SIZES.filter((size) => size !== DEFAULT_PAGE_SIZE).map((size) => ({
				value: String(size),
				label: `${size} par page`,
			})),
		},
	];
}

function panelValue(state: FilterState): GameFilterValue {
	return {
		ext: state.ext ? [state.ext] : [],
		glob: state.glob ? [state.glob] : [],
		prefixe: state.prefixe ? [state.prefixe] : [],
		cpk: state.cpk ? [state.cpk] : [],
		taille_min: state.tailleMin === undefined ? [] : [String(state.tailleMin)],
		taille_max: state.tailleMax === undefined ? [] : [String(state.tailleMax)],
		tri:
			state.sort === "nom" && state.order === "asc" ? [] : [`${state.sort}-${state.order}`],
		per_page: state.pageSize === DEFAULT_PAGE_SIZE ? [] : [String(state.pageSize)],
	};
}

function stateFromPanel(value: GameFilterValue): Partial<FilterState> {
	const [sort, order] = (value.tri?.[0] ?? "nom-asc").split("-");
	const pageSize = Number(value.per_page?.[0] ?? DEFAULT_PAGE_SIZE);
	return {
		ext: value.ext?.[0] ?? "",
		glob: value.glob?.[0]?.trim() ?? "",
		prefixe: value.prefixe?.[0]?.trim() ?? "",
		cpk: value.cpk?.[0]?.trim() ?? "",
		tailleMin: optionalSize(value.taille_min?.[0] ?? null),
		tailleMax: optionalSize(value.taille_max?.[0] ?? null),
		sort: sort === "taille" ? "taille" : "nom",
		order: order === "desc" ? "desc" : "asc",
		pageSize: PAGE_SIZES.includes(pageSize as (typeof PAGE_SIZES)[number])
			? pageSize
			: DEFAULT_PAGE_SIZE,
		page: 1,
	};
}

/** Les trois lectures des textures, telles que `?display=` les nomme. */
const TEXTURE_DISPLAYS: readonly GameTab[] = [
	{ id: "files", label: "Fichiers", icon: GLYPHES.arbre },
	{ id: "gallery", label: "Galerie", icon: GLYPHES.image },
	{ id: "text", label: "Textes", icon: GLYPHES.livre },
];

/** Le pictogramme du bandeau de tête, par vue. */
const VIEW_ICONS: Record<string, React.ReactNode> = {
	textures: GLYPHES.image,
	modeles: GLYPHES.cube,
	sons: GLYPHES.onde,
	videos: GLYPHES.film,
};

/** Les quatre routes, dans l'ordre où la barre d'onglets du jeu les affiche. */
const VIEWS: readonly (GameTab & { id: CatalogView })[] = [
	{ id: "textures", label: "Textures", icon: VIEW_ICONS.textures },
	{ id: "modeles", label: "Modèles", icon: VIEW_ICONS.modeles },
	{ id: "sons", label: "Sons", icon: VIEW_ICONS.sons },
	{ id: "videos", label: "Vidéos", icon: VIEW_ICONS.videos },
];

/**
 * Les médias — **une seule page**, décidé par l'utilisateur le 2026-09-06.
 *
 * Quatre entrées de menu pour quatre filtres du même index faisaient quatre destinations là où
 * il n'y a qu'une question : *montre-moi ce que le jeu contient, de ce type-là*. Elles restent
 * groupées dans une barre, mais leur identité vit dans le CHEMIN : le serveur, l'historique et le
 * composant lisent ainsi tous la même source de vérité.
 *
 * Les quatre URL (`/textures`, `/modeles`, `/sons`, `/videos`) continuent de mener ici, sur
 * leur vue : casser une adresse publiée pour changer un menu, ce serait payer une décision
 * d'affichage avec les liens des autres.
 *
 * ## Ce que l'aiguillage protège, et pourquoi il reste un composant
 *
 * `modeles` n'est pas un filtre d'extensions comme les trois autres : `.g4mg`/`.g4sk`/`.g4mt`
 * listent des **pièces**, pas des modèles — un `.g4mg` seul est un tampon de géométrie, sans
 * texture, sans squelette et sans recette, et la grille n'en montrait qu'un nom et une taille.
 * `Modeles3D` liste les 6 191 **codes assemblables** de `/api/v1/3d`, avec le rendu réel.
 *
 * L'aiguillage reste donc un composant sans le moindre hook, et ce n'est pas un détail : un
 * `if` posé au milieu de `VfsCatalog` changerait le nombre de hooks appelés d'un rendu à
 * l'autre en passant de `textures` à `modeles`, ce que React refuse. Ici, changer de vue
 * démonte un composant et en monte un autre — aucun état ne fuit d'une vue vers la suivante.
 */
export function Catalog({ view: route }: { view: CatalogView }) {
	const location = useSyncExternalStore(subscribeBrowserLocation, browserLocationSnapshot, browserLocationSnapshot);
	const currentUrl = new URL(location, "http://localhost");
	const params = currentUrl.searchParams;
	const hasLegacyView = params.has("vue");
	const hasLegacyPageSize = params.has("par_page");
	const currentRoute = splitLanguagePrefix(currentUrl.pathname).route.replace(/^\//, "");
	const legacyView = currentRoute === MEDIA
		? params.getAll("vue").reduce<CatalogView | undefined>(
			(selected, candidate) => VIEWS.some((item) => item.id === candidate) ? candidate as CatalogView : selected,
			undefined,
		)
		: undefined;
	const router = useRouter();
	const gallery = params.get("display") === "gallery";
	const text = params.get("display") === "text";
	const view = legacyView ?? route;

	// `/medias` is the historical entry to the group, not a fifth catalogue. Its former `?vue=`
	// value is read exactly once as compatibility input; on canonical paths the path always wins.
	useEffect(() => {
		if (currentRoute !== MEDIA && !hasLegacyView && !hasLegacyPageSize) return;
		const href = catalogHrefForView(location, view, { resetPage: false });
		if (`${currentUrl.pathname}${currentUrl.search}` !== href) router.replace(href, { scroll: false });
	}, [currentRoute, currentUrl.pathname, currentUrl.search, hasLegacyPageSize, hasLegacyView, location, router, view]);

	/**
	 * Change de route en conservant seulement les filtres qui gardent le même sens.
	 *
	 * `q`, le tri, le CPK et les bornes de taille restent utiles entre catalogues VFS. `ext`,
	 * `display`, `famille` et `page` sont propres à un type et ne fuient pas vers un autre.
	 */
	const setView = (nextView: CatalogView) => {
		if (nextView === view) return;
		router.push(catalogHrefForView(location, nextView));
	};

	return (
		<>
			{/* One shared game tab strip: keyboard focus, selected state and the visual material
			    remain identical to the texture sub-view and the other reconstructed screens. */}
			<GameTabStrip
				tabs={VIEWS}
				value={view}
				onChange={(value) => setView(value as CatalogView)}
				previousKey={null}
				nextKey={null}
				ariaLabel="Type de média"
				className="mb-4"
			/>

			{/*
			  * The three ways of reading the textures — files, gallery, native texts — are the
			  * game's own tab strip, not three ad-hoc pills. `W`/`C` are removed because this
			  * host binds no key to them; drawing a cap without a handler is forbidden here.
			  */}
			{view === "textures" ? (
				<GameTabStrip
					tabs={TEXTURE_DISPLAYS}
					value={text ? "text" : gallery ? "gallery" : "files"}
					onChange={(next) => {
						const url = new URL(window.location.href);
						if (next === "files") url.searchParams.delete("display");
						else url.searchParams.set("display", next);
						if (url.href !== window.location.href) writeBrowserHistory(url, window.history.state, "push");
					}}
					previousKey={null}
					nextKey={null}
					ariaLabel="Affichage des textures"
					className="mb-3"
				/>
			) : null}
			{view === "textures" && text ? <TextCatalog /> : view === "textures" && gallery ? <WebGallery /> : view === "modeles" ? <Models3D /> : <VfsCatalog key={view} view={view} />}
		</>
	);
}

function VfsCatalog({ view }: { view: CatalogView }) {
	const source = useAssetSource();
	const capabilities = useCapabilities();
	const location = useSyncExternalStore(subscribeBrowserLocation, browserLocationSnapshot, browserLocationSnapshot);
	const state = useMemo(() => filterStateFromUrl(new URL(location, "http://localhost").search), [location]);
	// The URL owns submitted filters. Reading notifications never writes back an older render.
	const setState = (update: (current: FilterState) => FilterState) => writeUrl(update(filterStateFromUrl()));
	const { page, q: filter, glob, prefixe, ext, sort, order, cpk, tailleMin, tailleMax, pageSize } = state;
	// Changer de vue remet TOUT à zéro — page comprise : garder la page 900 en passant d'un
	// catalogue de 904 pages à un catalogue de 4 afficherait un vide que rien n'expliquerait,
	// et `ext=dds` n'a aucun sens sur les sons.
	//
	// C'est la `key={vue}` posée par l'aiguillage qui s'en charge, pas un effet : React démonte
	// ce composant et en monte un neuf. Un effet de remise à zéro devait, lui, se garder de son
	// PREMIER passage (`useRef`) pour ne pas effacer l'état lu dans l'URL — un `useRef` dont
	// l'oubli ne se voit qu'en partageant un lien.
	const [entries, setEntries] = useState<VfsEntry[]>([]);
	const resourceNames = useResourceNames(entries.map(entry => entry.chemin));
	const [total, setTotal] = useState(0);
	const [pages, setPages] = useState(0);
	const [error, setError] = useState(false);
	const [loaded, setLoaded] = useState(false);
	const [appliedFilters, setAppliedFilters] = useState<AppliedCatalogFilters | null>(null);
	const [requestAttempt, setRequestAttempt] = useState(0);
	// `saisie` suit le champ, `etat.q` ce qui a ete envoye : sans ce decalage, chaque frappe
	// declencherait une requete sur 143 246 chemins.
	const [input, setInput] = useState(state.q);
	useEffect(() => { setInput(state.q); }, [state.q]);
	const [panelOpen, setPanelOpen] = useState(false);
	const [panelExtra, setPanelExtra] = useState<ExtraFilterState>(() => ({
		glob: state.glob,
		prefixe: state.prefixe,
		cpk: state.cpk,
		tailleMin: state.tailleMin,
		tailleMax: state.tailleMax,
	}));
	const [bankPath, setBankPath] = useState<string | null>(null);
	const openPanel = useCallback(() => {
		setPanelExtra({
			glob: state.glob,
			prefixe: state.prefixe,
			cpk: state.cpk,
			tailleMin: state.tailleMin,
			tailleMax: state.tailleMax,
		});
		setPanelOpen(true);
	}, [state.cpk, state.glob, state.prefixe, state.tailleMax, state.tailleMin]);
	const panelFamilies = useMemo(
		() => catalogFamilies(view, panelExtra, setPanelExtra),
		[panelExtra, view],
	);
	const filterValue = useMemo(
		() => panelValue(panelOpen ? { ...state, ...panelExtra } : state),
		[panelExtra, panelOpen, state],
	);
	const hints = useMemo<GameHint[]>(
		() => [{ key: FILTER_KEY, label: "Filtres", onActivate: openPanel }],
		[openPanel],
	);

	useEffect(() => {
		// `catalogue` est OPTIONNEL dans le contrat : un hôte qui ne sait pas paginer sur un jeu
		// d'extensions ne l'expose pas. On teste sa présence plutôt que de supposer.
		if (!capabilities?.vfs || !source.catalogue) return;
		const ac = new AbortController();
		setLoaded(false);
		setError(false);
		setAppliedFilters(null);
		source
			.catalogue(view, {
				page,
				parPage: pageSize,
				q: filter,
				glob,
				prefixe,
				ext,
				cpk,
				tailleMin,
				tailleMax,
				tri: sort,
				ordre: order,
				signal: ac.signal,
			})
			.then((response) => {
				if (ac.signal.aborted) return;
				if (response.pages > 0 && page > response.pages) {
					setState((current) => ({ ...current, page: response.pages }));
					return;
				}
				setEntries(response.elements);
				setTotal(response.total);
				setPages(response.pages);
				setAppliedFilters(response.filtres ?? null);
				setLoaded(true);
				return undefined;
			})
			.catch(() => {
				// Le message d'erreur du transport ne s'affiche pas : « Failed to fetch » ou un
				// code HTTP ne dit rien à qui consulte la page, et le seul geste utile ne dépend
				// pas de lui.
				if (!ac.signal.aborted) setError(true);
			});
		return () => ac.abort();
	}, [source, capabilities?.vfs, view, page, filter, glob, prefixe, ext, cpk, tailleMin, tailleMax, sort, order, pageSize, requestAttempt]);

	const title = entryLabel(view);

	if (!capabilities) return <Notice>Chargement…</Notice>;
	if (!capabilities.vfs || !source.catalogue) {
		return <Notice>Le catalogue est en cours de préparation. Il s'affichera dès qu'il sera prêt.</Notice>;
	}

	return (
		<section>
			{/*
			  * « Médias » et non le nom de la vue : l'onglet actif dit déjà « Textures », et le
			  * répéter en bandeau juste dessous donne deux fois la même information à deux
			  * tailles. Le titre nomme LA PAGE, l'onglet nomme la vue, et le compte reste ici
			  * parce qu'il porte sur ce que la page montre.
			  */}
			<ViewTitle detail={total ? agree(total, "élément") : undefined}>Médias</ViewTitle>

			{/* Le bandeau de tête du jeu nomme la VUE courante et porte son compte vivant : le
			    titre nomme la page, l'onglet nomme la vue, le compte suit les filtres. */}
			<GameHeaderBar icon={VIEW_ICONS[view]} title={title}>
				{loaded && !error ? <GameCountBadge count={total} icon={GLYPHES.image} unit="élément" /> : null}
			</GameHeaderBar>

			{/* ── La barre du jeu : recherche avec sa touche, bouton FILTRES, effacement ───────
			    Reprise de `data/menu/bank_character_detail.png` (« X Chercher par nom de joueur »).
			    Les filtres VFS, les bornes, le tri et la taille de page vivent dans le dialogue
			    FILTRES, comme dans la Banque du jeu ; la taille de page reste plafonnée à 200. */}
			<ExplorerSurface
				error={error ? <>Ce catalogue n’a pas pu être chargé. <button type="button"
					onClick={() => setRequestAttempt(value => value + 1)}><GameText>Réessayer</GameText></button></> : undefined}
				status={<PaginationControls currentPage={page} totalPages={pages}
					baseUrl={window.location.pathname} disabled={!loaded || error}
					onPageChange={nextPage => setState(current => ({ ...current, page: nextPage }))}
					pageLabel={(current, totalPages) => `Page ${current} sur ${totalPages.toLocaleString("fr")}`} />}
				toolbar={<div
				className="game-description-bar"
				style={{
					display: "flex",
					flexWrap: "wrap",
					width: "100%",
					alignItems: "center",
					gap: "var(--jeu-espace-m)",
					margin: "var(--jeu-espace-m) 0",
				}}
			>
				<div style={{ flex: "1 1 18rem" }}>
					<GameSearchBar
						value={input}
						onChange={setInput}
						onSubmit={(q) => setState((current) => ({ ...current, q, page: 1 }))}
						placeholder={`Chercher dans les ${title.toLowerCase()}…`}
						label={`Chercher dans les ${title.toLowerCase()}`}
						hotkey={SEARCH_KEY}
					/>
				</div>
					<GameHintBar hints={hints} enabled={!panelOpen} />
				{filter || glob || prefixe || ext || cpk || tailleMin !== undefined || tailleMax !== undefined || sort !== "nom" || order !== "asc" || pageSize !== DEFAULT_PAGE_SIZE ? (
					<button
						type="button"
						onClick={() => {
							setInput("");
							setState((current) => ({
								...current,
								q: "",
								glob: "",
								prefixe: "",
								ext: "",
								cpk: "",
								tailleMin: undefined,
								tailleMax: undefined,
								sort: "nom",
								order: "asc",
								pageSize: DEFAULT_PAGE_SIZE,
								page: 1,
							}));
						}}
						className="game-button-secondary"
						style={BUTTON_STYLE}
					>
						Effacer
					</button>
				) : null}
			</div>}>

			{describeFilters(panelFamilies, filterValue).length > 0 ? (
				<p style={{ margin: "0 0 var(--jeu-espace-s)", fontSize: "0.9rem", fontWeight: 700 }}>
					Demandé : {describeFilters(panelFamilies, filterValue).join(" · ")}
				</p>
			) : null}

			{appliedFilters ? (
				<div
					data-catalog-applied-filters
					aria-live="polite"
					style={{ margin: "0 0 var(--jeu-espace-s)", fontSize: "0.82rem" }}
				>
					<p style={{ margin: 0 }}>
						Appliqué par l’index : {appliedFilterSummary(appliedFilters).join(" · ")}
					</p>
					{appliedFilterWarnings(appliedFilters).map((warning) => (
						<p key={warning} data-catalog-filter-warning style={{ margin: "var(--jeu-espace-s) 0 0", fontWeight: 800 }}>
							{warning}
						</p>
					))}
				</div>
			) : null}

			{panelOpen ? (
				<div
					style={{
						position: "fixed",
						inset: 0,
						zIndex: 100,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						padding: "var(--jeu-espace-l)",
						backdropFilter: "blur(3px)",
					}}
					onClick={(event) => {
						if (event.target === event.currentTarget) setPanelOpen(false);
					}}
				>
					<GameFilterPanel
						families={panelFamilies}
						value={filterValue}
						onReset={() => setPanelExtra({
							glob: "",
							prefixe: "",
							cpk: "",
							tailleMin: undefined,
							tailleMax: undefined,
						})}
						onConfirm={(value) => {
							setState((current) => ({ ...current, ...stateFromPanel(value) }));
							setPanelOpen(false);
						}}
						onClose={() => setPanelOpen(false)}
						count={total}
						countUnit="élément"
						countIcon={GLYPHES.image}
						style={{ width: "min(960px, 100%)", maxHeight: "90vh" }}
					/>
				</div>
			) : null}

			{error ? null : !loaded ? (
				<Notice>Chargement…</Notice>
			) : entries.length === 0 ? (
				<Notice>Aucun élément ne correspond à cette recherche.</Notice>
			) : (
				<ExplorerEntries viewMode="grid" gridSize={160} ariaLabel={title}>
					{entries.map((entry) => (
						<div role="listitem" key={entry.chemin}>
							<div
								style={{
									display: "block",
									background: "#fff",
									border: "2px solid var(--jeu-tuile-bord)",
									borderRadius: "var(--jeu-rayon)",
									color: "var(--jeu-nuit-profonde)",
									textDecoration: "none",
									overflow: "hidden",
									boxShadow: "var(--jeu-ombre-tuile)",
								}}
							>
								{view === "videos" ? (
									<CatalogMoviePreview key={entry.chemin} path={entry.chemin} />
								) : view === "sons" ? (
									<button type="button" onClick={() => setBankPath(entry.chemin)}>Choisir une cue</button>
								) : view === "textures" && source.urlTexture ? (
									<img
										src={source.urlTexture(entry.chemin)}
										alt=""
										loading="lazy"
										decoding="async"
										style={{
											width: "100%",
											aspectRatio: "1",
											objectFit: "contain",
											background: "var(--jeu-ciel-clair)",
											imageRendering: "pixelated",
										}}
									/>
								) : null}
								<div style={{ padding: "var(--jeu-espace-s)" }}>
									{/* Le NOM, pas le chemin : celui-ci fait souvent plus de 80 caractères. */}
									<div
										style={{
											fontSize: "0.8rem",
											fontWeight: 700,
											overflow: "hidden",
											textOverflow: "ellipsis",
											whiteSpace: "nowrap",
										}}
										title={entry.chemin}
									>
										{resourceLabel(entry.chemin, resourceNames)}
									</div>
									<div style={{ fontSize: "0.7rem", color: "var(--jeu-tuile-bas)" }}>
										{readableSize(entry.taille)}
									</div>
								</div>
								<a href={source.urlFichier(entry.chemin)}>Ouvrir le fichier original</a>
							</div>
						</div>
					))}
				</ExplorerEntries>
			)}

			{view === "sons" && bankPath ? (
				<CatalogAudioBank key={bankPath} path={bankPath} onClose={() => setBankPath(null)} />
			) : null}

			</ExplorerSurface>
		</section>
	);
}

/** Les boutons de la page, dans la teinte des tuiles du menu. */
const BUTTON_STYLE: React.CSSProperties = {
	padding: "var(--jeu-espace-s) var(--jeu-espace-l)",
	border: 0,
	borderRadius: "var(--jeu-rayon)",
	background: "linear-gradient(180deg, var(--jeu-tuile-haut), var(--jeu-tuile-bas))",
	color: "var(--jeu-texte-vif)",
	font: "inherit",
	fontWeight: 800,
	cursor: "pointer",
};
