/**
 * La Galerie des succès — l'écran `gallery_menu` du jeu, dans le navigateur.
 *
 * ## Ce qui vient du jeu, et ce qui vient de l'hôte
 *
 * - Le **fond, le bandeau et le cadre de la grille** sont le layout du jeu :
 *   `GET /api/v1/menu/layout/gallery_menu` rend **7 objets** et **7 sprites résolus**, dessinés
 *   par `LayoutRender` sans qu'une position soit corrigée ici (`layersMissing: []`).
 * - Les **calques** viennent du Lua : `POST /api/v1/menu/runtime/gallery_menu` reçoit
 *   `itemCounts` pour la liste (`gallery01_01_list_base`) et `OnEnter(layer, index)` à chaque
 *   déplacement du curseur.
 * - Les **entrées** viennent de `GET /api/v1/profile/complete` (`{total, unlocked}` par famille)
 *   et de `GET /api/v1/game-data/{trophies,gallery,movies,musics}` — 347, 360, 219 et 108 lignes
 *   mesurées le 2026-09-12.
 * - Les **libellés, les vignettes et la grille** sont dessinés par l'hôte : le layout de cet
 *   écran ne porte **aucun objet texte**. Ce n'est pas une reproduction pixel à pixel, et rien
 *   ici ne le prétend (mémoire `pixel-perfect`).
 *
 * ## Les touches
 *
 * Relevées sur `data/menu/trophy_gallery.png` : le pied montre `Esc ↩` et « Confirmer ». La
 * barre y ajoute les deux gestes que la grille demande — `Tab` pour changer de famille et `X`
 * pour chercher, comme sur les autres listes du jeu. Aucun guide n'est dessiné sans son
 * gestionnaire.
 *
 * ## Ce qui n'est PAS branché
 *
 * Les **musiques ne se jouent pas** : la donnée ne porte ni titre ni chemin VFS (seulement
 * `entry_id` / `music_id` / `track_no`), donc aucune URL audio ne peut être construite sans
 * l'inventer. Les **images de la galerie** ne portent que des noms logiques, pas des chemins
 * résolus : aucune vignette n'est fabriquée. Les **films**, eux, ont un vrai chemin et se
 * jouent par `NativeMoviePlayer`.
 */
import { GameCanvas, GameHintBar, GameSearchBar, LayoutRender } from "@niers/inacord-ui";
import { lireLayout, type LayoutJeu } from "@niers/inacord-ui/shell/game-layout";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	filterGallery,
	galleryCollections,
	galleryTotals,
	GALLERY_TITLE,
	type GalleryCollection,
	type GalleryData,
	type GalleryItem,
	type GalleryProfile,
} from "../game/gallery";
import { listPage, stepCursor } from "../game/list-page";
import { createMenuRuntime, type MenuRuntimeResult } from "../game/menu-runtime";
import { NativeMoviePlayer } from "../game/NativeMoviePlayer";
import { NativeText } from "../pages/NativeText";
import "./trophy-gallery.css";

/** L'écran du jeu dont cette page est la reproduction. */
const SCREEN = "gallery_menu";

/** La grille : 5 colonnes sur 4 rangées, mesurées sur `data/menu/trophy_gallery.png`. */
const COLUMNS = 5;
const ROWS = 4;
const PAGE_SIZE = COLUMNS * ROWS;

/** CRC-32 d'un nom de calque : `layer_id == crc32(nom)` dans les scènes du menu. */
function crc32(value: string): number {
	let crc = 0xffffffff;
	for (const byte of new TextEncoder().encode(value)) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
	}
	return (crc ^ 0xffffffff) >>> 0;
}

/** Le calque de la liste de la galerie, tel que le layout le nomme (présent dans la scène Lua). */
const LIST_LAYER = crc32("gallery01_01_list_base");

/** Le layout de l'écran, validé par `lireLayout` — un JSON mal formé échoue bruyamment. */
async function loadLayout(signal: AbortSignal): Promise<LayoutJeu> {
	const response = await fetch(`/api/v1/menu/layout/${SCREEN}`, { signal, headers: { accept: "application/json" } });
	if (!response.ok) throw new Error("Layout unavailable");
	return lireLayout(await response.json());
}

/** Une réponse `game-data` : un tableau, ou l'échec. */
async function loadFamily(family: string, signal: AbortSignal): Promise<unknown[]> {
	const response = await fetch(`/api/v1/game-data/${family}`, { signal, headers: { accept: "application/json" } });
	if (!response.ok) throw new Error(`${family} unavailable`);
	const body: unknown = await response.json();
	if (!Array.isArray(body)) throw new Error(`${family}: not an array`);
	return body;
}

/** Les compteurs du profil complet, quand la route répond — `null` sinon (repli typé). */
async function loadProfile(signal: AbortSignal): Promise<GalleryProfile | null> {
	const response = await fetch("/api/v1/profile/complete", { signal, headers: { accept: "application/json" } })
		.catch(() => null);
	if (!response?.ok) return null;
	const body = await response.json() as Record<string, unknown>;
	const counters: GalleryProfile = {};
	for (const family of ["trophies", "gallery", "movies", "musics"] as const) {
		const value = body?.[family];
		if (value && typeof value === "object" && !Array.isArray(value)) {
			const { total, unlocked } = value as { total?: unknown; unlocked?: unknown };
			if (typeof total === "number" && typeof unlocked === "number") counters[family] = { total, unlocked };
		}
	}
	return Object.keys(counters).length > 0 ? counters : null;
}

export interface TrophyGalleryProps {
	/** `Échap` et le bouton de retour : le menu principal. */
	onBack: () => void;
}

export function TrophyGallery({ onBack }: TrophyGalleryProps) {
	const [layout, setLayout] = useState<LayoutJeu | null>(null);
	const [layoutFailed, setLayoutFailed] = useState(false);
	const [data, setData] = useState<GalleryData | null>(null);
	const [dataFailed, setDataFailed] = useState(false);
	const [profile, setProfile] = useState<GalleryProfile | null>(null);
	const [family, setFamily] = useState(0);
	const [cursor, setCursor] = useState(0);
	const [search, setSearch] = useState("");
	const [searchOpen, setSearchOpen] = useState(false);
	const [playing, setPlaying] = useState<string | null>(null);
	const [runtimeState, setRuntimeState] = useState<"loading" | "observed" | "partial" | "unavailable">("loading");
	const [runtime, setRuntime] = useState<MenuRuntimeResult | null>(null);
	const [textures, setTextures] = useState({ loaded: 0, total: 0 });
	const seen = useRef(new Set<string>());

	useEffect(() => {
		const controller = new AbortController();
		loadLayout(controller.signal).then(setLayout, () => { if (!controller.signal.aborted) setLayoutFailed(true); });
		Promise.all([
			loadFamily("trophies", controller.signal),
			loadFamily("gallery", controller.signal),
			loadFamily("movies", controller.signal),
			loadFamily("musics", controller.signal),
		]).then(([trophies, gallery, movies, musics]) => setData({
			trophies: trophies as GalleryData["trophies"],
			gallery: gallery as GalleryData["gallery"],
			movies: movies as GalleryData["movies"],
			musics: musics as GalleryData["musics"],
		}), () => { if (!controller.signal.aborted) setDataFailed(true); });
		loadProfile(controller.signal).then(setProfile, () => { /* le repli typé couvre l'absence */ });
		return () => controller.abort();
	}, []);

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

	const collections = useMemo<GalleryCollection[]>(
		() => data ? galleryCollections(data, profile) : [],
		[data, profile],
	);
	const current = collections[family] ?? null;
	const retained = useMemo(() => filterGallery(current?.items ?? [], search), [current, search]);
	const page = useMemo(() => listPage<GalleryItem>(retained, cursor, PAGE_SIZE), [retained, cursor]);
	const focused = page.cursor >= 0 ? retained[page.cursor] ?? null : null;
	const totals = useMemo(() => galleryTotals(collections), [collections]);

	// Le Lua reçoit chaque changement de curseur : c'est lui qui décide de l'état de la liste.
	useEffect(() => {
		if (page.cursorInPage < 0 || !session.snapshot?.callbacks.includes("OnEnter")) return;
		session.dispatch({ callback: "OnEnter", args: [LIST_LAYER, page.cursorInPage] })
			.then(receive, () => { /* une frappe superseded n'est pas une panne */ });
	}, [session, receive, page.cursorInPage]);

	const move = useCallback((step: "item" | "row" | "page", direction: 1 | -1) => {
		setCursor((value) => stepCursor(value, retained.length, step, direction, COLUMNS, PAGE_SIZE));
	}, [retained.length]);

	const changeFamily = useCallback((direction: 1 | -1) => {
		setFamily((value) => (value + direction + collections.length || collections.length) % (collections.length || 1));
		setCursor(0);
		setPlaying(null);
	}, [collections.length]);

	/** `Confirmer` : une cinématique se joue, tout le reste n'a rien d'autre à ouvrir. */
	const confirm = useCallback(() => {
		if (!focused) return;
		setPlaying((value) => focused.moviePath && value !== focused.moviePath ? focused.moviePath : null);
	}, [focused]);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
			const target = event.target;
			const editing = target instanceof HTMLElement && (target.tagName === "INPUT" || target.isContentEditable);
			if (event.key === "Escape") {
				event.preventDefault();
				if (playing) { setPlaying(null); return; }
				if (searchOpen) { setSearchOpen(false); setSearch(""); return; }
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
	}, [move, onBack, searchOpen, playing]);

	const onTexture = useCallback((name: string, loaded: boolean) => {
		if (seen.current.has(name)) return;
		seen.current.add(name);
		setTextures((value) => ({ loaded: value.loaded + (loaded ? 1 : 0), total: value.total + 1 }));
	}, []);

	const hints = useMemo(() => [
		{ key: "Enter", keyLabel: "Entrée", label: "Confirmer", onActivate: confirm },
		{ key: "Tab", keyLabel: "Tab", label: current ? `Famille : ${current.label}` : "Famille", onActivate: () => changeFamily(1) },
		{ key: "x", keyLabel: "X", label: "Chercher", onActivate: () => setSearchOpen(true) },
		{ key: "Escape", keyLabel: "Esc", label: "Retour", onActivate: onBack, fromInputs: true },
	], [confirm, changeFamily, current, onBack]);

	return (
		<section
			className="trophy-gallery"
			aria-label={GALLERY_TITLE}
			data-screen={SCREEN}
			data-render-source="vfs-layout"
			data-lua-observation={runtimeState}
			data-runtime-layers={runtime ? Object.keys(runtime.scene.layers).length : 0}
			data-layout-objects={layout?.objects.length ?? 0}
			data-textures={`${textures.loaded}/${textures.total}`}
			data-family={current?.id ?? "none"}
			data-entries={current?.items.length ?? 0}
			data-retained={retained.length}
			data-origin={current?.origin ?? "none"}
		>
			<GameCanvas canvas={layout?.canvas ?? { w: 1280, h: 720 }}>
				{layout ? <LayoutRender layout={layout} visiblesSeules={false} onTexture={onTexture} /> : null}

				<header className="trophy-gallery__title">
					<NativeText text={GALLERY_TITLE} height={28} />
				</header>

				<div className="trophy-gallery__counters">
					{current ? <span>{current.label} : {current.progress.unlocked} / {current.progress.total}</span> : null}
					<span>Total : {totals.unlocked} / {totals.total}</span>
				</div>

				<nav className="trophy-gallery__tabs" aria-label="Familles">
					{collections.map((collection, index) => (
						<button
							key={collection.id}
							type="button"
							aria-pressed={index === family}
							data-state={index === family ? "focused" : "idle"}
							onClick={() => { setFamily(index); setCursor(0); setPlaying(null); }}
						>
							{collection.label} ({collection.progress.unlocked}/{collection.progress.total})
						</button>
					))}
				</nav>

				<div
					className="trophy-gallery__grid"
					role="listbox"
					aria-label={current?.label ?? "Galerie"}
					aria-activedescendant={focused ? `gallery-item-${focused.id}` : undefined}
				>
					{page.items.map((item, index) => {
						const active = index === page.cursorInPage;
						return (
							<button
								key={`${item.id}-${index}`}
								id={`gallery-item-${item.id}`}
								type="button"
								role="option"
								aria-selected={active}
								data-state={active ? "focused" : "idle"}
								data-unlocked={item.unlocked}
								className="trophy-gallery__cell"
								onClick={() => setCursor(page.index * PAGE_SIZE + index)}
								onDoubleClick={confirm}
							>
								<span className="trophy-gallery__cell-label">{item.unlocked ? item.label : "?"}</span>
							</button>
						);
					})}
					{page.items.length === 0 ? (
						<p className="trophy-gallery__empty">
							{dataFailed ? "La galerie est indisponible." : data ? "Aucune entrée retenue." : "Chargement…"}
						</p>
					) : null}
				</div>

				<footer className="trophy-gallery__counts">
					<span>Retenues : {retained.length}</span>
					<span>Page {page.index + 1} / {page.count}</span>
					{layoutFailed ? <span role="alert">Le layout du jeu est indisponible.</span> : null}
				</footer>

				<aside className="trophy-gallery__detail" aria-label="Détail">
					{focused ? (
						<>
							<h2 className="trophy-gallery__detail-name">{focused.unlocked ? focused.label : "Verrouillé"}</h2>
							{focused.unlocked && focused.detail ? <p className="trophy-gallery__detail-text">{focused.detail}</p> : null}
							<p className="trophy-gallery__detail-id">{focused.id}</p>
							{focused.moviePath ? (
								<p className="trophy-gallery__detail-play">
									{playing === focused.moviePath ? "Lecture en cours" : "Entrée : lire la cinématique"}
								</p>
							) : null}
						</>
					) : null}
				</aside>

				{playing ? (
					<div className="trophy-gallery__movie" role="dialog" aria-label="Cinématique">
						<NativeMoviePlayer path={playing} presentation="preview" onEnded={() => setPlaying(null)} />
					</div>
				) : null}

				{searchOpen ? (
					<div className="trophy-gallery__search">
						<GameSearchBar value={search} onChange={(value) => { setSearch(value); setCursor(0); }} placeholder="Chercher" autoFocus />
					</div>
				) : null}
			</GameCanvas>

			<GameHintBar className="trophy-gallery__hints" hints={hints} />
		</section>
	);
}
