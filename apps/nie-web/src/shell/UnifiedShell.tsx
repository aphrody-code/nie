/**
 * The one shell of the product — sidebar, top bar, command palette, notifications.
 *
 * ## Why this file exists
 *
 * There used to be two shells for one product. `pages/SecondaryScreen.tsx` framed the site pages
 * with a game-styled tile strip; `desktop/App.tsx` drew the workspace's own sidebar, top bar,
 * palette and toaster, and existed only behind `/inacord`. A game screen could not reach a tool,
 * a tool could only reach a game screen by reloading the page, and `Ctrl+K` searched nothing
 * outside the workspace.
 *
 * Here there is one sidebar, and it is the workspace's own component
 * (`desktop/components/Sidebar.tsx`) — data-driven by `SidebarSection[]`, so this file builds the
 * data and never re-implements the rendering, the collapse button, the theme switch, the job
 * manager or the download button. Its first section, `JEU`, lists the game screens declared by
 * `entries.ts`; then come the workspace views declared by `desktop/lib/vues.ts`, each routed to
 * `/inacord/<viewId>`; then the places, the pins and the recents of the Explorer.
 *
 * ## What is NOT framed
 *
 * The game itself, at `/`. It owns the whole viewport (see `App.tsx`) — a sidebar over the title
 * screen would be the site talking over the thing the site exists for.
 */
import { CommandPalette } from "@/components/CommandPalette";
import { Sidebar, type SidebarSection } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";
import { WindowResizeHandles } from "@/components/ui/window-resize-handles";
import { showPlaceContextMenu } from "@/lib/contextMenu";
import { useExplorerTabs } from "@/lib/explorerTabs";
import { useExternalPath } from "@/lib/externalPath";
import { useT } from "@/lib/i18n";
import { PINNED_PLACES, usePinnedPlaces, useRecentPlaces } from "@/lib/places";
import { LIBELLE_GROUPE, vue as viewById, vuesDuGroupe, type GroupeVue } from "@/lib/vues";
import { Icon } from "@niers/inacord-ui/components/ui/Icon";
import { Toaster } from "@niers/inacord-ui/components/ui/sonner";
import { TooltipProvider } from "@niers/inacord-ui/components/ui/tooltip";
import { useSettings } from "@niers/inacord-ui/lib/settings";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ALIAS, EXPLORER, INACORD, SETTINGS, entryLabel, menuEntries } from "../entries";
import type { NomGlyphe as GlyphName } from "@niers/inacord-ui";
import { GAME_REACHABLE, NATIVE_WINDOW } from "../host";
import { HOME } from "../routing";
import { createWorkspaceActions, workspaceRoute } from "./workspace-actions";

/** Sidebar width, read by `TopBar` so it starts where the sidebar ends. */
const SIDEBAR_WIDTH = 200;

/** Collapse persistence key — the same one the workspace used, so the state follows the user. */
const COLLAPSED_KEY = "nie-explorer:sidebar:repliee";

/**
 * Icon for a game entry.
 *
 * `entries.ts` names its tiles with the game glyph set (`GLYPHES`), while the sidebar draws the
 * Material→lucide set of `ui/Icon`. The table below is the only place the two meet; an unknown
 * glyph falls back to a neutral folder rather than rendering nothing (`Icon` returns `null` on
 * an unknown name, which silently produced blank rows in the workspace sidebar before).
 */
const GLYPH_ICON: Record<GlyphName, string> = {
	image: "image",
	cube: "deployed_code",
	onde: "music_note",
	film: "movie",
	arbre: "folder_open",
	engrenage: "settings",
	ballon: "person",
	livre: "menu_book",
} as Record<GlyphName, string>;

/** The route prefix of the Inacord workspace views: `/inacord/<viewId>`. */
export const INACORD_VIEW_PREFIX = `${INACORD}/`;

/** The view id carried by an `inacord/<id>` route, or `null` for anything else. */
export function inacordViewOf(route: string): string | null {
	if (route === INACORD) return "explorer";
	return route.startsWith(INACORD_VIEW_PREFIX) ? route.slice(INACORD_VIEW_PREFIX.length) : null;
}

/**
 * The workspace view a route opens, whatever the route is called.
 *
 * `/explorateur` and the two addresses inherited from the screens it absorbed (`/recherche`,
 * `/donnees`) open the Explorer, the same one `/inacord/explorer` opens. One function answers for
 * all of them, so the router and the top bar cannot disagree — they did: the title bar showed the
 * raw segment, « recherche », on a screen that is the Explorer.
 */
export function workspaceViewOf(route: string): string | null {
	if (route === EXPLORER || (ALIAS as readonly string[]).includes(route)) return "explorer";
	return inacordViewOf(route);
}

/**
 * The game section of the sidebar.
 *
 * Exported for the tests: it is the contract that the game screens and the tools share ONE
 * navigation, and it is the first thing that breaks if a route stops being declared.
 */
export function gameSection(current: string): SidebarSection {
	return {
		label: "JEU",
		items: [
			// The way back to the game itself. Without it the shell could reach every screen but
			// the one the site exists for, and `/` was only addressable by editing the URL.
			{
				id: HOME,
				label: "Jeu",
				icon: "sports_soccer",
				title: "Jeu",
				active: current === HOME,
			},
			...menuEntries(null)
			// Three entries are NOT drawn here. Inacord, because its views ARE the sections below.
			// Settings, because it has its own footer button, like in the workspace. And Explorer,
			// because the workspace section already lists the one Explorer the product has — two
			// rows leading to the same screen is exactly the duplication this shell removed.
			.filter((entry) => entry.route !== INACORD && entry.route !== SETTINGS && entry.route !== EXPLORER)
			.map((entry) => ({
				id: entry.route,
				label: entry.label,
				icon: GLYPH_ICON[entry.glyph] ?? "folder_open",
				active: entry.route === current,
			})),
		],
	};
}

/** The Inacord view sections, honouring the « Outils avancés » setting. */
export function workspaceSections(current: string, advanced: boolean, t: (key: string) => string): SidebarSection[] {
	const view = inacordViewOf(current);
	return (["principal", "donnees", "outils"] as const).map((groupe: GroupeVue) => ({
		label: LIBELLE_GROUPE[groupe],
		items: vuesDuGroupe(groupe)
			.filter((v) => advanced || !v.avancee)
			.map((v) => ({
				id: workspaceRoute(v.id),
				label: t(v.cle),
				icon: v.icone,
				title: `${t(v.cle)} — ${v.description}`,
				active: view === v.id,
			})),
	}));
}

/**
 * The shell: sidebar on the left, top bar above, the current screen in the middle.
 *
 * `Escape` returns to the game, which is what `SecondaryScreen` did — losing it would strand a
 * keyboard user on a catalogue page with no way back to `/`.
 */
export function UnifiedShell({
	current,
	onSelect,
	children,
}: {
	current: string;
	onSelect: (view: string) => void;
	children: ReactNode;
}) {
	const t = useT();
	const settings = useSettings();
	const actions = useMemo(() => createWorkspaceActions(onSelect), [onSelect]);
	const tabs = useExplorerTabs();
	const explorer = tabs.tabs.find((x) => x.id === tabs.activeId) ?? tabs.tabs[0];
	const externalPath = useExternalPath();
	const pins = usePinnedPlaces();
	const recents = useRecentPlaces();
	const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSED_KEY) === "1");
	useEffect(() => {
		localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
	}, [collapsed]);
	// Ctrl+B — the same toggle as the button, already the workspace's shortcut.
	useEffect(() => {
		const onKey = (ev: KeyboardEvent) => {
			if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "b") {
				ev.preventDefault();
				setCollapsed((c) => !c);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);
	// Escape returns to the game, unless a field or a dialog is holding the key. Inside the native
	// window there is no game to return to: the shortcut would empty the screen.
	useEffect(() => {
		if (!GAME_REACHABLE) return;
		const cancel = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
			const target = event.target;
			if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="alertdialog"]')) return;
			if (document.querySelector('dialog[open], [role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]')) return;
			event.preventDefault();
			onSelect(HOME);
		};
		window.addEventListener("keydown", cancel);
		return () => window.removeEventListener("keydown", cancel);
	}, [onSelect]);

	const advanced = settings.outilsAvances !== false;
	const inExplorer = workspaceViewOf(current) === "explorer" && !externalPath;
	const sections = useMemo<SidebarSection[]>(() => {
		/** One place row, with its three gestures: click, middle click, context menu. */
		const place = (id: string, prefix: string, label: string, icon: string, kind: "builtin" | "pinned" | "recent", iconClassName?: string) => ({
			id,
			label,
			icon,
			iconClassName,
			title: prefix || "/",
			active: inExplorer && explorer.prefix === prefix,
			onClick: () => actions.gotoPlace(prefix),
			onAuxClick: (e: React.MouseEvent) => {
				if (e.button !== 1) return;
				e.preventDefault();
				actions.gotoPlaceInNewTab(prefix);
			},
			onContextMenu: (e: React.MouseEvent) => {
				e.preventDefault();
				showPlaceContextMenu({
					prefix,
					kind,
					onOpen: () => actions.gotoPlace(prefix),
					onOpenInNewTab: () => actions.gotoPlaceInNewTab(prefix),
				});
			},
		});
		return [
			// The game screens come FIRST — one product, one navigation. Inside the native window
			// there is no game to reach, so the section is not drawn at all.
			...(GAME_REACHABLE ? [gameSection(current)] : []),
			...workspaceSections(current, advanced, t),
			{
				label: t("explorer.places"),
				items: PINNED_PLACES.map((p) => place(`place:${p.prefix}`, p.prefix, p.label, p.icon, "builtin")),
			},
			...(pins.length > 0
				? [{
					label: "★ Épinglés",
					items: pins.map((prefix) => place(`pin:${prefix}`, prefix, prefix.split("/").pop() || prefix, "stars", "pinned", "text-accent")),
				}]
				: []),
			...(recents.length > 0
				? [{
					label: t("explorer.recents"),
					items: recents.map((r) => place(`recent:${r.prefix}`, r.prefix, r.prefix.split("/").pop() || r.prefix, "schedule", "recent")),
				}]
				: []),
		];
	}, [actions, advanced, current, explorer.prefix, inExplorer, pins, recents, t]);

	/** Le titre de la barre supérieure — chemin courant dans l'Explorateur (comme l'explorateur
	 * de fichiers du système), nom de l'écran partout ailleurs. */
	const title = useMemo(() => {
		if (externalPath) return externalPath;
		const view = workspaceViewOf(current);
		if (view === "explorer") return explorer.selected ?? explorer.prefix ?? "data";
		if (view) {
			const declared = viewById(view);
			return declared ? t(declared.cle) : view;
		}
		if (current === HOME) return "Jeu";
		return entryLabel(current);
	}, [current, explorer.prefix, explorer.selected, externalPath, t]);

	// Titre de fenêtre = même valeur que la barre supérieure (chemin courant comme l'explorateur
	// de fichiers du système, jamais un nom de produit). Hors fenêtre native il n'y a pas de titre
	// à poser : `getCurrentWindow()` jette de façon SYNCHRONE, donc un `.catch()` ne l'attraperait
	// pas et l'exception casserait l'effet de rendu.
	useEffect(() => {
		if (!NATIVE_WINDOW) return;
		try {
			getCurrentWindow().setTitle(title).catch(() => {});
		} catch {
			/* pas de fenêtre Tauri */
		}
	}, [title]);

	return (
		<TooltipProvider>
			{/* Shell — portage de `ShellLayout.tsx` (spacedrive) : fond `bg-app`, coins arrondis
			    `radius-window` (10 px, cf. `apply_rounded_corners` côté Rust pour que Windows
			    arrondisse AUSSI la fenêtre elle-même), barre supérieure en absolu au-dessus d'un
			    contenu décalé de `pt-12`. */}
			<div className="relative flex h-screen w-screen select-none flex-col overflow-hidden rounded-window bg-app text-ink">
				<TopBar
					sidebarWidth={collapsed ? 0 : SIDEBAR_WIDTH}
					title={title}
					onOpenPalette={() =>
						window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }))
					}
				/>
				<div className="flex flex-1 overflow-hidden">
					{/* La barre latérale se replie : sur la vue Cinéma, ses 200 px prennent la place
					    d'une carte entière par rangée. Le bouton de dépli reste visible une fois
					    repliée — sinon le repli serait un aller sans retour. */}
					{collapsed ? (
						<button
							type="button"
							onClick={() => setCollapsed(false)}
							title="Afficher la barre latérale (Ctrl+B)"
							aria-label="Afficher la barre latérale"
							className="z-[51] mt-11 h-9 w-6 shrink-0 rounded-r-md border border-l-0 border-app-line bg-app-box text-ink-faint hover:text-ink"
						>
							<Icon name="chevron_right" size={14} />
						</button>
					) : (
						<Sidebar
							sections={sections}
							current={current}
							onSelect={onSelect}
							onOpenSettings={() => onSelect(SETTINGS)}
							onBasculerRepli={() => setCollapsed(true)}
						/>
					)}
					<main className="relative z-[38] flex min-w-0 flex-1 flex-col overflow-auto pt-12">{children}</main>
				</div>
			</div>
			<WindowResizeHandles />
			<CommandPalette
				onGoto={actions.gotoPlace}
				onSearch={actions.openSearch}
				onSelectTab={actions.openView}
			/>
			<Toaster position="bottom-right" />
		</TooltipProvider>
	);
}
