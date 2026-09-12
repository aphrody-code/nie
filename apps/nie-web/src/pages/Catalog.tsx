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
import type { EntreeVfs as VfsEntry, VueCatalogue as CatalogView } from "@niers/asset-source";
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
	useAssetSource,
	useCapacites as useCapabilities,
} from "@niers/inacord-ui";
import { Tabs, TabsList, TabsTrigger } from "@niers/inacord-ui/components/ui/tabs";
import { ExplorerEntries, ExplorerSurface } from "@niers/inacord-ui/explorer/explorer-surface";
import { PaginationControls } from "@niers/inacord-ui/components/ui/pagination-controls";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { browserLocationSnapshot, subscribeBrowserLocation, writeBrowserHistory } from "@niers/inacord-ui/lib/browser-navigation";
import { entryLabel } from "../entries";
import { agree, Notice, readableSize, ViewTitle } from "./SecondaryScreen";
import { Modeles3D as Models3D } from "./Models3D";
import { CatalogAudioBank, CatalogMoviePreview } from "./CatalogMedia";

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
type FilterState = {
	q: string;
	ext: string;
	sort: "nom" | "taille";
	order: "asc" | "desc";
	pageSize: number;
	page: number;
};

/** Lit l'état depuis l'URL courante. Une valeur illisible retombe sur son défaut. */
function filterStateFromUrl(search = window.location.search): FilterState {
	const params = new URLSearchParams(search);
	const pageSize = Number(params.get("par_page"));
	const page = Number(params.get("page"));
	return {
		q: params.get("q") ?? "",
		ext: params.get("ext") ?? "",
		sort: params.get("tri") === "taille" ? "taille" : "nom",
		order: params.get("ordre") === "desc" ? "desc" : "asc",
		// `includes` sur la liste servie, jamais la valeur brute : un `par_page=100000` tapé
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
		["ext", state.ext],
		["tri", state.sort === "nom" ? "" : state.sort],
		["ordre", state.order === "asc" ? "" : state.order],
		["par_page", state.pageSize === DEFAULT_PAGE_SIZE ? "" : String(state.pageSize)],
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
 * Les extensions que chaque vue retient — MESURÉES sur le service le 2026-09-07, en lisant les
 * 200 premiers éléments de chaque vue triés dans les deux sens (`textures` → `g4tx`, `sons` →
 * `acb`, `videos` → `usm`). Le catalogue ne publie pas de facettes ; sans cette liste le
 * panneau proposerait les 40 extensions du VFS, dont 37 que la vue refuse (`ext_inconnue`).
 */
const EXTENSIONS_BY_VIEW: Record<string, readonly string[]> = {
	textures: ["g4tx"],
	// Un AWB est le payload d'une banque, pas une piste. Les cues nommés viennent de l'ACB.
	sons: ["acb"],
	videos: ["usm"],
};

/** Les touches de la page : « F » ouvre les filtres, « X » donne le focus à la recherche. */
const FILTER_KEY = "f";
const SEARCH_KEY = "x";

/** Le dialogue FILTRES du jeu, sur les trois réglages que le catalogue sert. */
function catalogFamilies(view: CatalogView): GameFilterFamily[] {
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
			id: "par_page",
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
		tri:
			state.sort === "nom" && state.order === "asc" ? [] : [`${state.sort}-${state.order}`],
		par_page: state.pageSize === DEFAULT_PAGE_SIZE ? [] : [String(state.pageSize)],
	};
}

function stateFromPanel(value: GameFilterValue): Partial<FilterState> {
	const [sort, order] = (value.tri?.[0] ?? "nom-asc").split("-");
	const pageSize = Number(value.par_page?.[0] ?? DEFAULT_PAGE_SIZE);
	return {
		ext: value.ext?.[0] ?? "",
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

/** Les quatre vues, dans l'ordre où elles s'affichent, avec leur libellé. */
const VIEWS: { view: CatalogView; label: string }[] = [
	{ view: "textures", label: "Textures" },
	{ view: "modeles", label: "Modèles" },
	{ view: "sons", label: "Sons" },
	{ view: "videos", label: "Vidéos" },
];

/**
 * Les médias — **une seule page**, décidé par l'utilisateur le 2026-09-06.
 *
 * Quatre entrées de menu pour quatre filtres du même index faisaient quatre destinations là où
 * il n'y a qu'une question : *montre-moi ce que le jeu contient, de ce type-là*. Passer des
 * textures aux sons obligeait à repasser par l'accueil, et le filtre en cours était perdu en
 * chemin. La vue est donc un **réglage de la page**, au même titre que le tri.
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
	const params = new URL(location, "http://localhost").searchParams;
	const requested = params.get("vue");
	const gallery = params.get("display") === "gallery";
	const text = params.get("display") === "text";
	const view = VIEWS.some(item => item.view === requested) ? requested as CatalogView : route;

	/**
	 * Change de vue, et n'emporte AUCUN filtre.
	 *
	 * `ext=dds` n'a aucun sens sur les sons, et `tri=taille` sur des modèles trie des codes.
	 * Transporter les filtres donnerait des réglages qui semblent suivre et qui, en réalité,
	 * changent de sens en chemin.
	 */
	const setView = (nextView: CatalogView) => {
		const url = new URL(window.location.href);
		url.search = `vue=${nextView}`;
		if (url.href !== window.location.href) writeBrowserHistory(url, window.history.state, "replace");
	};

	return (
		<>
			{/*
			  * La primitive PARTAGÉE, pas un `role="tablist"` réécrit à la main.
			  *
			  * `packages/inacord-ui` en expose 37, éprouvées par Inacord, et cet hôte n'en
			  * utilisait aucune : il redessinait ses contrôles en style inline, écran par écran.
			  * Ce qu'elle apporte ici et qu'un `<div role>` n'a pas : le déplacement au clavier
			  * entre onglets, le `aria-controls` posé sur le bon panneau, et l'anneau de focus.
			  *
			  * Elle ne s'affiche correctement que parce que Tailwind est désormais branché sur
			  * cet hôte ET que la palette du jeu est mappée sur les variables de shadcn
			  * (`base.css`) : sans ce pont, la primitive se rendrait transparente sur
			  * transparent — visible dans le DOM, invisible à l'écran.
			  */}
			<Tabs value={view} onValueChange={(value) => setView(value as CatalogView)}>
				{/*
				  * La taille par défaut de la primitive est celle d'Inacord — une application
				  * dense, aux onglets discrets. Ici c'est le SEUL sélecteur de la page, et le
				  * bandeau de titre qui le suit fait trois fois sa hauteur : à taille égale, il
				  * se lisait comme une note de bas de page. La primitive est reprise telle
				  * quelle, seule son échelle est réglée.
				  */}
				<TabsList aria-label="Type de média" className="mb-4 h-auto gap-1 p-1 text-base">
					{VIEWS.map((item) => (
						<TabsTrigger
							key={item.view}
							value={item.view}
							className="px-4 py-2 font-bold data-[selected]:font-extrabold"
						>
							{item.label}
						</TabsTrigger>
					))}
				</TabsList>
			</Tabs>

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
	const { page, q: filter, ext, sort, order, pageSize } = state;
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
	const [requestAttempt, setRequestAttempt] = useState(0);
	// `saisie` suit le champ, `etat.q` ce qui a ete envoye : sans ce decalage, chaque frappe
	// declencherait une requete sur 143 246 chemins.
	const [input, setInput] = useState(state.q);
	useEffect(() => { setInput(state.q); }, [state.q]);
	const [panelOpen, setPanelOpen] = useState(false);
	const [bankPath, setBankPath] = useState<string | null>(null);
	const panelFamilies = useMemo(() => catalogFamilies(view), [view]);
	const filterValue = useMemo(() => panelValue(state), [state]);
	const hints = useMemo<GameHint[]>(
		() => [{ key: FILTER_KEY, label: "Filtres", onActivate: () => setPanelOpen(true) }],
		[],
	);

	useEffect(() => {
		// `catalogue` est OPTIONNEL dans le contrat : un hôte qui ne sait pas paginer sur un jeu
		// d'extensions ne l'expose pas. On teste sa présence plutôt que de supposer.
		if (!capabilities?.vfs || !source.catalogue) return;
		const ac = new AbortController();
		setLoaded(false);
		setError(false);
		source
			.catalogue(view, {
				page,
				parPage: pageSize,
				q: filter,
				ext,
				tri: sort,
				ordre: order,
				signal: ac.signal,
			})
			.then((response) => {
				if (ac.signal.aborted) return;
				setEntries(response.elements);
				setTotal(response.total);
				setPages(response.pages);
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
	}, [source, capabilities?.vfs, view, state, page, filter, ext, sort, order, pageSize, requestAttempt]);

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
			    L'extension, le tri et la taille de page — les trois réglages que le serveur sert,
			    plafonnés à 200 — vivent dans le dialogue FILTRES, comme dans la Banque du jeu. */}
			<ExplorerSurface
				error={error ? <>Ce catalogue n’a pas pu être chargé. <button type="button"
					onClick={() => setRequestAttempt(value => value + 1)}>Réessayer</button></> : undefined}
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
				{filter || ext || sort !== "nom" || order !== "asc" || pageSize !== DEFAULT_PAGE_SIZE ? (
					<button
						type="button"
						onClick={() => {
							setInput("");
							setState((current) => ({
								...current,
								q: "",
								ext: "",
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
					{describeFilters(panelFamilies, filterValue).join(" · ")}
				</p>
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
