/**
 * Le Marché — l'écran `shop_menu` du jeu, dans le navigateur.
 *
 * ## Ce qui vient du jeu, et ce qui vient de l'hôte
 *
 * - Le **fond, les plaques et les cadres** sont le layout du jeu :
 *   `GET /api/v1/menu/layout/shop_menu` rend **62 objets** (212 en comptant les 150 instances
 *   d'attache) et **62 sprites résolus**, dessinés par le compositeur wasm (`LayoutCanvas`) sans qu'une position soit
 *   corrigée ici. Le layout déclare **74 calques et il en manque 12** dans le VFS résolu
 *   (`shop01_01_list_base_spirit`, `shopmenu01_07_button_guide`, `cmn01_06_consume_item_icon`…) :
 *   c'est constaté, pas contourné — les objets qui en dépendent ne sont simplement pas dessinés.
 * - Le **runtime Lua n'est pas servi** pour cet écran : `/api/v1/menu/runtime/shop_menu` répond
 *   `404 {"genre":"introuvable","message":"Menu script unavailable"}`. L'état est déclaré
 *   (`data-lua-observation="unavailable"`) au lieu d'être simulé.
 * - Les **boutiques et leur stock** viennent de `GET /api/v1/game-data/shops` (16 boutiques) et
 *   `GET /api/v1/game-data/items` (1 820 articles) ; `GET /api/v1/profile/complete` fournit
 *   `shops[].items[].in_stock` — le profil complet a tout en stock.
 * - Les **lignes de liste, les prix et les descriptions** sont dessinés par l'hôte : les seuls
 *   objets texte du layout sont des libellés de fiche (« Compétence passive », « Effet global »…),
 *   pas des lignes de boutique. Ce n'est pas une reproduction pixel à pixel.
 *
 * ## Les touches
 *
 * Relevées sur `data/menu/shop.png` (`Esc ↩`, « Confirmer », `X` « Afficher les objets »,
 * `B` « Échange de fèves ») et `data/menu/chronicle_shop.png` (`W`/`C` sur les onglets de
 * catégorie). `X` ouvre ici la recherche dans les objets de la boutique, et `B` bascule sur la
 * boutique d'échange nommée par la donnée (« Marché aux esprits ») — aucun guide n'est dessiné
 * sans son gestionnaire.
 */
import { LayoutCanvas } from "../game/LayoutCanvas";
import { GameCanvas, GameHintBar, GameSearchBar } from "@niers/inacord-ui";
import { lireLayout, type LayoutJeu } from "@niers/inacord-ui/shell/game-layout";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listPage, stepCursor } from "../game/list-page";
import { createMenuRuntime, type MenuRuntimeResult } from "../game/menu-runtime";
import {
	filterStock,
	shopStock,
	stockCategories,
	stockPrice,
	stockTotal,
	SHOP_TITLE,
	type ItemRow,
	type ProfileShop,
	type ShopRow,
	type ShopStock,
	type StockItem,
} from "../game/shop";
import { NativeText } from "../pages/NativeText";
import "./shop.css";

/** L'écran du jeu dont cette page est la reproduction. */
const SCREEN = "shop_menu";

/** La liste du stock : une colonne de 12 lignes, calée sur `data/menu/chronicle_shop.png`. */
const COLUMNS = 1;
const PAGE_SIZE = 12;

/** CRC-32 d'un nom de calque : `layer_id == crc32(nom)` dans les scènes du menu. */
function crc32(value: string): number {
	let crc = 0xffffffff;
	for (const byte of new TextEncoder().encode(value)) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
	}
	return (crc ^ 0xffffffff) >>> 0;
}

/** Le calque de la liste du stock, tel que le layout le nomme. */
const LIST_LAYER = crc32("shop01_01_list_base");

/** La boutique d'échange que la donnée nomme — la cible du guide `B` du jeu. */
const EXCHANGE_SHOP = "Marché aux esprits";

async function loadLayout(signal: AbortSignal): Promise<LayoutJeu> {
	const response = await fetch(`/api/v1/menu/layout/${SCREEN}`, { signal, headers: { accept: "application/json" } });
	if (!response.ok) throw new Error("Layout unavailable");
	return lireLayout(await response.json());
}

async function loadFamily(family: string, signal: AbortSignal): Promise<unknown[]> {
	const response = await fetch(`/api/v1/game-data/${family}`, { signal, headers: { accept: "application/json" } });
	if (!response.ok) throw new Error(`${family} unavailable`);
	const body: unknown = await response.json();
	if (!Array.isArray(body)) throw new Error(`${family}: not an array`);
	return body;
}

/** Le stock du profil complet, quand la route répond — `null` sinon (repli typé). */
async function loadProfileShops(signal: AbortSignal): Promise<ProfileShop[] | null> {
	const response = await fetch("/api/v1/profile/complete", { signal, headers: { accept: "application/json" } })
		.catch(() => null);
	if (!response?.ok) return null;
	const body = await response.json() as { shops?: unknown };
	return Array.isArray(body?.shops) ? body.shops as ProfileShop[] : null;
}

export interface ShopProps {
	/** `Échap` et le bouton de retour : le menu principal. */
	onBack: () => void;
}

export function Shop({ onBack }: ShopProps) {
	const [layout, setLayout] = useState<LayoutJeu | null>(null);
	const [layoutFailed, setLayoutFailed] = useState(false);
	const [shops, setShops] = useState<ShopRow[] | null>(null);
	const [items, setItems] = useState<ItemRow[] | null>(null);
	const [profile, setProfile] = useState<ProfileShop[] | null>(null);
	const [dataFailed, setDataFailed] = useState(false);
	const [shopIndex, setShopIndex] = useState(0);
	const [category, setCategory] = useState<string | null>(null);
	const [cursor, setCursor] = useState(0);
	const [search, setSearch] = useState("");
	const [searchOpen, setSearchOpen] = useState(false);
	const [selected, setSelected] = useState<StockItem | null>(null);
	const [runtimeState, setRuntimeState] = useState<"loading" | "observed" | "partial" | "unavailable">("loading");
	const [runtime, setRuntime] = useState<MenuRuntimeResult | null>(null);
	const [compose, setCompose] = useState({ drawn: 0, skipped: 0 });
	const seen = useRef(new Set<string>());

	useEffect(() => {
		const controller = new AbortController();
		loadLayout(controller.signal).then(setLayout, () => { if (!controller.signal.aborted) setLayoutFailed(true); });
		Promise.all([loadFamily("shops", controller.signal), loadFamily("items", controller.signal)])
			.then(([shopRows, itemRows]) => { setShops(shopRows as ShopRow[]); setItems(itemRows as ItemRow[]); },
				() => { if (!controller.signal.aborted) setDataFailed(true); });
		loadProfileShops(controller.signal).then(setProfile, () => { /* le repli typé couvre l'absence */ });
		return () => controller.abort();
	}, []);

	// Le script Lua de cet écran n'est pas publié (404) : la session est ouverte quand même, et
	// son indisponibilité est déclarée telle quelle plutôt que masquée.
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

	const stock = useMemo<ShopStock[]>(
		() => shops && items ? shopStock(shops, items, profile) : [],
		[shops, items, profile],
	);
	const current = stock[shopIndex] ?? null;
	const categories = useMemo(() => stockCategories(current?.items ?? []), [current]);
	const retained = useMemo(
		() => filterStock(current?.items ?? [], category, search),
		[current, category, search],
	);
	const page = useMemo(() => listPage<StockItem>(retained, cursor, PAGE_SIZE), [retained, cursor]);
	const focused = page.cursor >= 0 ? retained[page.cursor] ?? null : null;
	// La fiche suit le curseur, sauf quand « Confirmer » l'a figée sur un objet.
	const sheet = selected ?? focused;

	useEffect(() => {
		if (page.cursorInPage < 0 || !session.snapshot?.callbacks.includes("OnEnter")) return;
		session.dispatch({ callback: "OnEnter", args: [LIST_LAYER, page.cursorInPage] })
			.then(receive, () => { /* une frappe superseded n'est pas une panne */ });
	}, [session, receive, page.cursorInPage]);

	const move = useCallback((step: "item" | "row" | "page", direction: 1 | -1) => {
		setCursor((value) => stepCursor(value, retained.length, step, direction, COLUMNS, PAGE_SIZE));
	}, [retained.length]);

	const selectShop = useCallback((index: number) => {
		setShopIndex(index);
		setCategory(null);
		setCursor(0);
		setSelected(null);
	}, []);

	/** `W`/`C` : les onglets de catégorie de la boutique, comme sur `chronicle_shop.png`. */
	const changeCategory = useCallback((direction: 1 | -1) => {
		setCategory((value) => {
			const values = categories.map((entry) => entry.value);
			if (values.length === 0) return null;
			const index = value === null ? -1 : values.indexOf(value);
			const next = index + direction;
			return next < 0 || next >= values.length ? null : values[next] ?? null;
		});
		setCursor(0);
	}, [categories]);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
			const target = event.target;
			const editing = target instanceof HTMLElement && (target.tagName === "INPUT" || target.isContentEditable);
			if (event.key === "Escape") {
				event.preventDefault();
				if (searchOpen) { setSearchOpen(false); setSearch(""); return; }
				onBack();
				return;
			}
			if (editing) return;
			if (event.key === "w" || event.key === "c") {
				event.preventDefault();
				changeCategory(event.key === "c" ? 1 : -1);
				return;
			}
			const moves: Record<string, [("item" | "row" | "page"), 1 | -1] | undefined> = {
				ArrowDown: ["item", 1], ArrowUp: ["item", -1],
				ArrowRight: ["page", 1], ArrowLeft: ["page", -1],
				PageUp: ["page", -1], PageDown: ["page", 1],
			};
			const step = moves[event.key];
			if (step) { event.preventDefault(); move(step[0], step[1]); }
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [move, changeCategory, onBack, searchOpen]);

	// Ce que la composition a RÉELLEMENT dessiné, publié sur la section : `drawn` et `skipped`
	// viennent du compositeur lui-même, au lieu d'un décompte de balises `<img>` chargées.
	const onCompose = useCallback(
		(report: { drawn: number; skipped: number }) =>
			setCompose({ drawn: report.drawn, skipped: report.skipped }),
		[],
	);

	const hints = useMemo(() => [
		{
			key: "Enter", keyLabel: "Entrée", label: selected ? "Relâcher" : "Confirmer",
			// « Confirmer » fige la fiche sur l'objet choisi ; la touche le relâche ensuite.
			onActivate: () => setSelected((value) => value ? null : focused),
		},
		{ key: "x", keyLabel: "X", label: "Afficher les objets", onActivate: () => setSearchOpen(true) },
		{
			key: "b", keyLabel: "B", label: "Échange de fèves",
			onActivate: () => {
				const index = stock.findIndex((shop) => shop.label === EXCHANGE_SHOP);
				if (index >= 0) selectShop(index);
			},
		},
		{ key: "Escape", keyLabel: "Esc", label: "Retour", onActivate: onBack, fromInputs: true },
	], [stock, selectShop, onBack, selected, focused]);

	return (
		<section
			className="shop"
			aria-label={SHOP_TITLE}
			data-screen={SCREEN}
			data-render-source="vfs-layout"
			data-lua-observation={runtimeState}
			data-runtime-layers={runtime ? Object.keys(runtime.scene.layers).length : 0}
			data-layout-objects={layout?.objects.length ?? 0}
			data-compose={`${compose.drawn}/${compose.drawn + compose.skipped}`}
			data-shops={stock.length}
			data-stock={current?.items.length ?? 0}
			data-retained={retained.length}
			data-origin={current?.origin ?? "none"}
		>
			<GameCanvas canvas={layout?.canvas ?? { w: 1280, h: 720 }}>
				{layout ? <LayoutCanvas layout={layout} assumeUnknownVisible={false} onReport={onCompose} /> : null}

				<header className="shop__title">
					<NativeText text={current ? current.label : SHOP_TITLE} height={28} />
				</header>

				<nav className="shop__shops" aria-label="Boutiques">
					{stock.map((shop, index) => (
						<button
							key={shop.id}
							type="button"
							aria-pressed={index === shopIndex}
							data-state={index === shopIndex ? "focused" : "idle"}
							data-unnamed={shop.unnamed}
							onClick={() => selectShop(index)}
						>
							<span className="shop__shop-name">{shop.label}</span>
							<span className="shop__shop-count">{shop.declared}</span>
						</button>
					))}
					{stock.length === 0 ? <p className="shop__empty">{dataFailed ? "Le marché est indisponible." : "Chargement…"}</p> : null}
				</nav>

				<div className="shop__tabs" role="tablist" aria-label="Catégories">
					<button type="button" role="tab" aria-selected={category === null} data-state={category === null ? "focused" : "idle"} onClick={() => { setCategory(null); setCursor(0); }}>
						Tout ({current?.items.length ?? 0})
					</button>
					{categories.map((entry) => (
						<button
							key={entry.value}
							type="button"
							role="tab"
							aria-selected={category === entry.value}
							data-state={category === entry.value ? "focused" : "idle"}
							onClick={() => { setCategory(entry.value); setCursor(0); }}
						>
							{entry.value} ({entry.count})
						</button>
					))}
				</div>

				<ul
					className="shop__list"
					role="listbox"
					aria-label="Stock"
					aria-activedescendant={focused ? `shop-item-${focused.name}` : undefined}
				>
					{page.items.map((entry, index) => {
						const active = index === page.cursorInPage;
						const price = stockPrice(entry);
						return (
							<li key={`${entry.name}-${index}`}>
								<button
									id={`shop-item-${entry.name}`}
									type="button"
									role="option"
									aria-selected={active}
									data-state={active ? "focused" : "idle"}
									data-resolved={entry.resolved}
									className="shop__row"
									onClick={() => setCursor(page.index * PAGE_SIZE + index)}
								>
									<span className="shop__row-name">{entry.name}</span>
									<span className="shop__row-category">{entry.item?.category ?? ""}</span>
									<span className="shop__row-price">{price === null ? "" : price}</span>
									<span className="shop__row-stock">{entry.inStock ? "En stock" : "Épuisé"}</span>
								</button>
							</li>
						);
					})}
					{page.items.length === 0 && stock.length > 0 ? (
						<li className="shop__empty">Aucun objet retenu.</li>
					) : null}
				</ul>

				<footer className="shop__counts">
					<span>Retenus : {retained.length} / {current?.items.length ?? 0}</span>
					<span>Page {page.index + 1} / {page.count}</span>
					<span>Stock total : {stockTotal(stock)}</span>
					{layoutFailed ? <span role="alert">Le layout du jeu est indisponible.</span> : null}
				</footer>

				<aside className="shop__detail" aria-label="Fiche de l'objet" data-pinned={selected !== null}>
					{sheet ? (
						<>
							<h2 className="shop__detail-name">{sheet.name}</h2>
							{sheet.item ? (
								<>
									<p className="shop__detail-tags">
										{sheet.item.category ?? ""}
										{sheet.item.internal_code ? ` · ${sheet.item.internal_code}` : ""}
									</p>
									{sheet.item.description ? <p className="shop__detail-desc">{sheet.item.description}</p> : null}
									<p className="shop__detail-price">
										{stockPrice(sheet) === null ? "Prix non porté par la donnée" : `Prix : ${stockPrice(sheet)}`}
									</p>
								</>
							) : (
								// La boutique liste un libellé que la table des articles ne nomme pas.
								<p className="shop__detail-desc">Cet article n'a pas de fiche dans la table des objets.</p>
							)}
						</>
					) : null}
				</aside>

				{searchOpen ? (
					<div className="shop__search">
						<GameSearchBar value={search} onChange={(value) => { setSearch(value); setCursor(0); }} placeholder="Nom d'objet" autoFocus />
					</div>
				) : null}
			</GameCanvas>

			<GameHintBar className="shop__hints" hints={hints} />
		</section>
	);
}
