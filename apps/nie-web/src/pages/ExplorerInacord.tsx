import { useResourceNames, resourceLabel } from "../game/resource-names";
import type { ContenuDossier, EntreeVfs } from "@niers/asset-source";
import { useAssetSource, useRouter } from "@niers/inacord-ui";
import { NativeTexturePreview } from "../game/NativeTexturePreview";
import {
	ExplorerBreadcrumbs,
	ExplorerEntries,
	ExplorerFilters,
	ExplorerPageShell,
	ExplorerSidebar,
	ExplorerStatus,
	ExplorerSurface,
	ExplorerTabsBar,
	ExplorerToolbar,
	ExplorerToolbarButton,
} from "@niers/inacord-ui/explorer/explorer-surface";
import {
	activateTab,
	canGoBack,
	canGoForward,
	closeTab,
	cycleTab,
	goBack,
	goForward,
	makeTab,
	openTab,
	restoreExplorerTabs,
	updateTab,
	type ExplorerTab,
	type ExplorerTabsState,
} from "@niers/inacord-ui/explorer/explorer-tabs";
import { useEffect, useMemo, useRef, useState } from "react";
import { writeBrowserHistory } from "@niers/inacord-ui/lib/browser-navigation";
import { splitLanguagePrefix } from "../routing";

const STORAGE_KEY = "nie:explorer:tabs";
const PAGE_SIZE = 200;

const WEB_EXPLORER_STYLES = `
.nie-web-explorer { position: fixed; inset: 0; z-index: 100; font-family: Inter, system-ui, sans-serif; font-size: 14px; }
.nie-web-explorer .inacord-explorer-page__content { display:flex; min-height:0; flex-direction:column; }
.nie-web-explorer .inacord-explorer { min-height:0; flex:1; }
.nie-web-explorer-titlebar { display:flex; height:54px; flex:none; align-items:center; justify-content:space-between; border-bottom:1px solid #352d27; padding:0 16px; color:#b8afa8; }
.nie-web-explorer-titlebar button { display:flex; align-items:center; gap:7px; border:1px solid #352d27; border-radius:9px; padding:6px 10px; background:#1d1814; color:#8f8780; font:inherit; }
.nie-web-explorer-titlebar kbd { border:1px solid #352d27; border-radius:4px; padding:1px 5px; font-size:10px; }
.nie-web-explorer .material-symbols-rounded { font-size: 18px; line-height: 1; }
.nie-web-explorer .inacord-explorer-entry { display:flex; width:100%; min-width:0; align-items:center; gap:10px; border:0; padding:9px 14px; background:transparent; color:#e4ddd7; text-align:left; font:inherit; cursor:pointer; }
.nie-web-explorer .inacord-explorer-entry:hover { background:#2c2520; }
.nie-web-explorer .inacord-explorer-entry.is-selected { background:color-mix(in srgb,#249af3 22%,transparent); }
.nie-web-explorer .inacord-explorer-entry.is-active { background:#302921; }
.nie-web-explorer .inacord-explorer-entry > .material-symbols-rounded { flex:none; color:#249af3; }
.nie-web-explorer .inacord-explorer-entry > span:not(.material-symbols-rounded) { min-width:0; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.nie-web-explorer .inacord-explorer-entry small { flex:none; color:#b8afa8; font-size:12px; font-variant-numeric:tabular-nums; }
.nie-web-explorer .inacord-explorer-entries--grid .inacord-explorer-entry { min-height:112px; flex-direction:column; justify-content:center; border-radius:12px; text-align:center; }
.nie-web-explorer .inacord-explorer-entries--grid .inacord-explorer-entry small { margin-left:0; }
.nie-web-explorer .inacord-explorer-entry__thumb { width:64px; height:64px; object-fit:contain; border-radius:8px; background:#171310; }
.nie-web-explorer .inacord-explorer-inspector-tabs { display:flex; gap:18px; height:32px; align-items:center; }
.nie-web-explorer .inacord-explorer-inspector-tabs button { border:0; border-bottom:2px solid transparent; padding:7px 2px; background:transparent; color:#837b75; font:inherit; font-size:12px; font-weight:600; }
.nie-web-explorer .inacord-explorer-inspector-tabs button[aria-selected="true"] { border-color:#249af3; color:#e4ddd7; }
.nie-web-explorer .inacord-explorer-inspector-empty { display:grid; height:100%; margin:0; place-items:center; padding:20px; color:#b8afa8; text-align:center; }
.nie-web-explorer .inacord-explorer-preview { width:100%; height:100%; object-fit:contain; padding:14px; }
.nie-web-explorer .inacord-explorer-file-preview { display:flex; height:100%; flex-direction:column; align-items:center; justify-content:center; gap:10px; padding:20px; overflow-wrap:anywhere; text-align:center; }
.nie-web-explorer .inacord-explorer-file-preview .material-symbols-rounded { color:#249af3; font-size:48px; }
.nie-web-explorer .inacord-explorer-file-preview a { color:#60b5f4; }
.nie-web-explorer .inacord-explorer-properties { display:grid; grid-template-columns:auto minmax(0,1fr); gap:10px; margin:0; padding:14px; overflow-wrap:anywhere; }
.nie-web-explorer .inacord-explorer-properties dt { color:#837b75; }
.nie-web-explorer .inacord-explorer-properties dd { margin:0; }
.nie-web-explorer .inacord-explorer-selection { position:absolute; left:50%; bottom:34px; z-index:4; display:flex; align-items:center; gap:16px; transform:translateX(-50%); border:1px solid #352d27; border-radius:999px; padding:8px 12px; background:#211b17; box-shadow:0 8px 30px #0008; }
.nie-web-explorer .inacord-explorer-selection button { border:0; border-radius:999px; padding:5px 9px; background:#302921; color:#e4ddd7; }
.nie-web-explorer .inacord-explorer-empty { padding:16px; color:#b8afa8; }
.nie-web-explorer-view-options { position:relative; }
.nie-web-explorer-view-popover { position:absolute; top:36px; right:0; z-index:8; width:250px; border:1px solid #352d27; border-radius:12px; padding:16px; background:#29221d; box-shadow:0 10px 28px #0008; color:#b8afa8; }
.nie-web-explorer-view-popover > strong { display:block; margin-bottom:14px; font-size:12px; }
.nie-web-explorer-view-popover > div { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.nie-web-explorer-view-popover button { display:flex; align-items:center; justify-content:center; gap:7px; border:0; border-radius:999px; padding:7px; background:transparent; color:#b8afa8; }
.nie-web-explorer-view-popover button[aria-pressed="true"] { background:#171310; color:#e4ddd7; }
@media (max-width:720px) { .nie-web-explorer .inacord-explorer-page { grid-template-columns:56px minmax(0,1fr); } .nie-web-explorer .inacord-explorer-sidebar { width:56px; min-width:56px; } .nie-web-explorer .inacord-explorer-sidebar__item > span:last-child,.nie-web-explorer .inacord-explorer-sidebar__section h2 { display:none; } }
`;

function MaterialIcon({ name }: { name: string }) {
	return <span className="material-symbols-rounded" aria-hidden="true">{name}</span>;
}

export function formatBytes(value: number): string {
	if (value < 1024) return `${value} o`;
	if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10240 ? 1 : 0)} Ko`;
	return `${(value / (1024 * 1024)).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} Mo`;
}

export function childPath(prefix: string, child: string): string {
	if (child.startsWith(`${prefix}/`) || (!prefix && child.includes("/"))) return child;
	return prefix ? `${prefix}/${child}` : child;
}

function tabsFromLocation(): ExplorerTabsState {
	const params = new URLSearchParams(window.location.search);
	const prefix = params.get("d") ?? "data/common";
	const selected = params.get("a");
	try {
		let sequence = 0;
		const stored = restoreExplorerTabs(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"), () => `explorer-restored-${++sequence}`);
		if (stored) {
			// An explicit URL wins over the previous session's active folder and selection.
			if (params.has("d") || params.has("a")) return updateTab(stored, stored.activeId, { prefix, selected });
			return stored;
		}
	} catch {
		// Corrupt browser state is discarded in favor of the URL/default tab.
	}
	const tab = makeTab("explorer-1", prefix, selected);
	return { tabs: [tab], activeId: tab.id };
}

function writeLocation(tab: ExplorerTab) {
	const url = new URL(window.location.href);
	// An empty folder is the VFS root, distinct from an unspecified default folder.
	url.searchParams.set("d", tab.prefix);
	if (tab.selected) url.searchParams.set("a", tab.selected);
	else url.searchParams.delete("a");
	writeBrowserHistory(url, window.history.state);
}

function tabLabel(tab: { prefix: string }): string {
	return tab.prefix.split("/").filter(Boolean).at(-1) ?? "Racine";
}

export interface ExplorerInacordProps {
	onHome?: () => void;
}

/** Full-viewport web adapter over the same Explorer presentation and reducers as Inacord. */
export function ExplorerInacord({ onHome }: ExplorerInacordProps) {
	const source = useAssetSource();
	const router = useRouter();
	const routePath = useRef(window.location.pathname);
	const [tabsState, setTabsState] = useState(tabsFromLocation);
	const activeTab = tabsState.tabs.find((tab) => tab.id === tabsState.activeId) ?? tabsState.tabs[0]!;
	const [content, setContent] = useState<ContenuDossier | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(false);
	const [multiSelected, setMultiSelected] = useState<Set<string>>(new Set());
	const [cursor, setCursor] = useState<string | null>(null);
	const [inspectorTab, setInspectorTab] = useState<"preview" | "properties">("preview");
	const [viewOptions, setViewOptions] = useState(false);
	const anchor = useRef<string | null>(null);

	const patchActive = (patch: Parameters<typeof updateTab>[2]) =>
		setTabsState((state) => updateTab(state, state.activeId, patch));

	useEffect(() => {
		try { localStorage.setItem(STORAGE_KEY, JSON.stringify(tabsState)); } catch { /* Navigation remains available without storage. */ }
		if (window.location.pathname === routePath.current) writeLocation(activeTab);
	}, [tabsState, activeTab]);

	useEffect(() => {
		const restoreLocation = () => {
			if (window.location.pathname !== routePath.current) return;
			const params = new URLSearchParams(window.location.search);
			const prefix = params.get("d") ?? "data/common";
			const selected = params.get("a");
			setTabsState(state => {
				const tab = state.tabs.find(candidate => candidate.id === state.activeId);
				return tab?.prefix === prefix && tab.selected === selected ? state : updateTab(state, state.activeId, { prefix, selected });
			});
		};
		window.addEventListener("popstate", restoreLocation);
		return () => window.removeEventListener("popstate", restoreLocation);
	}, []);

	useEffect(() => {
		const controller = new AbortController();
		setLoading(true);
		setError(false);
		source
			.parcourir(activeTab.prefix, {
				q: activeTab.query?.trim() || undefined,
				ext: activeTab.ext?.trim().replace(/^\./, "") || undefined,
				tri: activeTab.sortKey === "size" ? "taille" : "nom",
				ordre: activeTab.sortKey === "size" ? "desc" : "asc",
				parPage: PAGE_SIZE,
				signal: controller.signal,
			})
			.then((next) => !controller.signal.aborted && setContent(next))
			.catch(() => !controller.signal.aborted && setError(true))
			.finally(() => !controller.signal.aborted && setLoading(false));
		return () => controller.abort();
	}, [source, activeTab.prefix, activeTab.query, activeTab.ext, activeTab.sortKey]);

	useEffect(() => {
		setMultiSelected(new Set());
		setCursor(null);
		anchor.current = null;
	}, [activeTab.prefix]);

	useEffect(() => {
		function onShortcut(event: KeyboardEvent) {
			if (event.defaultPrevented) return;
			if (event.key === "Escape") {
				if (!onHome || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
				const target = event.target;
				if (document.querySelector('dialog[open], [role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]')) return;
				if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]')) return;
				if (target instanceof Element && target.closest('[role="dialog"], [role="alertdialog"]') && !target.closest('.nie-web-explorer-view-popover')) return;
				event.preventDefault();
				if (viewOptions) { setViewOptions(false); return; }
				onHome();
				return;
			}
			if (!(event.ctrlKey || event.metaKey)) return;
			if (event.key.toLowerCase() === "t") {
				event.preventDefault();
				setTabsState((state) => openTab(state, `explorer-${Date.now()}`, activeTab.prefix));
			} else if (event.key.toLowerCase() === "w") {
				event.preventDefault();
				setTabsState((state) => closeTab(state, state.activeId));
			} else if (event.key === "Tab") {
				event.preventDefault();
				setTabsState((state) => cycleTab(state, event.shiftKey ? -1 : 1));
			}
		}
		window.addEventListener("keydown", onShortcut);
		return () => window.removeEventListener("keydown", onShortcut);
	}, [activeTab.prefix, onHome, viewOptions]);

	const folders = useMemo(
		() => (content?.dossiers ?? []).map((path) => ({ path: childPath(activeTab.prefix, path), name: path.split("/").at(-1) ?? path })),
		[content?.dossiers, activeTab.prefix],
	);
	const files = content?.fichiers ?? [];
	const entries = [...folders.map((folder) => ({ path: folder.path, folder: true })), ...files.map((file) => ({ path: file.chemin, folder: false }))];
	const resourceNames = useResourceNames(files.map(file => file.chemin));
	const selectedFile = files.find((file) => file.chemin === activeTab.selected);
	const selectedBytes = files.filter((file) => multiSelected.has(file.chemin)).reduce((sum, file) => sum + file.taille, 0);

	function navigate(prefix: string) {
		patchActive({ prefix, selected: null });
	}

	function navigateTool(route: string) {
		router.push(`${splitLanguagePrefix(window.location.pathname).prefix}/${route}`);
	}

	function select(path: string, event: React.MouseEvent) {
		const ordered = entries.map((entry) => entry.path);
		setCursor(path);
		setMultiSelected((current) => {
			if (event.shiftKey && anchor.current) {
				const start = ordered.indexOf(anchor.current);
				const end = ordered.indexOf(path);
				if (start >= 0 && end >= 0) return new Set(ordered.slice(Math.min(start, end), Math.max(start, end) + 1));
			}
			anchor.current = path;
			if (event.ctrlKey || event.metaKey) {
				const next = new Set(current);
				if (next.has(path)) next.delete(path);
				else next.add(path);
				return next;
			}
			return new Set([path]);
		});
	}

	function onEntriesKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
		const index = entries.findIndex((entry) => entry.path === (cursor ?? activeTab.selected));
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			const next = index < 0 ? 0 : event.key === "ArrowDown" ? Math.min(entries.length - 1, index + 1) : Math.max(0, index - 1);
			const entry = entries[next];
			if (!entry) return;
			setCursor(entry.path);
			if (!entry.folder) patchActive({ selected: entry.path });
			document.querySelector<HTMLElement>(`[data-explorer-path="${CSS.escape(entry.path)}"]`)?.scrollIntoView({ block: "nearest" });
		} else if (event.key === "Enter" && index >= 0) {
			const entry = entries[index];
			if (entry?.folder) navigate(entry.path);
			else if (entry) patchActive({ selected: entry.path });
		} else if (event.key === "Backspace") {
			navigate(activeTab.prefix.split("/").slice(0, -1).join("/"));
		} else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
			event.preventDefault();
			setMultiSelected(new Set(entries.map((entry) => entry.path)));
		}
	}

	const mainSections = [
		{ items: [{ id: "home", label: "Éditeur", icon: <MaterialIcon name="deployed_code" />, onClick: onHome }, { id: "explorer", label: "Explorateur", icon: <MaterialIcon name="folder_open" /> }, { id: "search", label: "Recherche", icon: <MaterialIcon name="search" />, onClick: () => document.querySelector<HTMLInputElement>('.inacord-explorer-filters__query')?.focus() }] },
		{ label: "DONNÉES", items: [{ id: "data", label: "Données", icon: <MaterialIcon name="database" />, onClick: () => navigate("data") }, { id: "packs", label: "CPK brut", icon: <MaterialIcon name="deployed_code" />, onClick: () => navigate("data/packs") }, { id: "saves", label: "Sauvegardes", icon: <MaterialIcon name="save" />, onClick: () => navigate("data") }] },
		{ label: "OUTILS", items: [{ id: "media", label: "Galerie", icon: <MaterialIcon name="gallery_thumbnail" />, onClick: () => navigateTool("medias") }, { id: "models", label: "Modèles", icon: <MaterialIcon name="view_in_ar" />, onClick: () => navigateTool("modeles") }, { id: "textures", label: "Textures", icon: <MaterialIcon name="image" />, onClick: () => navigateTool("textures") }] },
		{ label: "EMPLACEMENTS", items: [{ id: "root", label: "Racine", icon: <MaterialIcon name="hard_drive" />, onClick: () => navigate("") }, { id: "common", label: "Modèles/anim (common)", icon: <MaterialIcon name="view_in_ar" />, onClick: () => navigate("data/common") }] },
		{ label: "RÉCENTS", items: tabsState.tabs.slice().reverse().map((tab) => ({ id: `recent-${tab.id}`, label: tabLabel(tab), icon: <MaterialIcon name="schedule" />, onClick: () => setTabsState((state) => activateTab(state, tab.id)) })) },
	];

	const tabs = (
		<ExplorerTabsBar
			tabs={tabsState.tabs}
			activeId={tabsState.activeId}
			onActivate={(id) => setTabsState((state) => activateTab(state, id))}
			onClose={(id) => setTabsState((state) => closeTab(state, id))}
			onNew={() => setTabsState((state) => openTab(state, `explorer-${Date.now()}`, activeTab.prefix))}
			getLabel={tabLabel}
			newTabLabel="Nouvel onglet"
			closeTabLabel={(tab) => `Fermer l'onglet ${tabLabel(tab)}`}
		/>
	);

	return (
		<div className="nie-web-explorer">
		<style>{WEB_EXPLORER_STYLES}</style>
		<ExplorerPageShell
			sidebar={<ExplorerSidebar sections={mainSections} current="explorer" onSelect={() => {}} footer={<><MaterialIcon name="light_mode" /><MaterialIcon name="settings" /></>} />}
		>
			<div className="nie-web-explorer-titlebar"><strong>{activeTab.prefix || "Racine"}</strong><button type="button" onClick={() => document.querySelector<HTMLInputElement>('.inacord-explorer-filters__query')?.focus()}><MaterialIcon name="search" /> Rechercher… <kbd>Ctrl+K</kbd></button></div>
			<ExplorerSurface
				tabs={tabs}
				toolbar={
					<ExplorerToolbar
						leading={<><ExplorerToolbarButton label="Précédent" icon={<MaterialIcon name="arrow_back" />} disabled={!canGoBack(activeTab)} onClick={() => setTabsState((state) => goBack(state, state.activeId))} /><ExplorerToolbarButton label="Suivant" icon={<MaterialIcon name="arrow_forward" />} disabled={!canGoForward(activeTab)} onClick={() => setTabsState((state) => goForward(state, state.activeId))} /><ExplorerToolbarButton label="Racine" icon={<MaterialIcon name="home" />} onClick={() => navigate("")} /><ExplorerToolbarButton label="Dossier parent" icon={<MaterialIcon name="expand_less" />} disabled={!activeTab.prefix} onClick={() => navigate(activeTab.prefix.split("/").slice(0, -1).join("/"))} /></>}
						breadcrumbs={<ExplorerBreadcrumbs segments={activeTab.prefix.split("/").filter(Boolean)} rootLabel="Racine" onNavigate={(prefix) => navigate(prefix)} />}
						trailing={<><ExplorerToolbarButton label="Épingler" icon={<MaterialIcon name="star" />} /><ExplorerToolbarButton label={activeTab.sortKey === "size" ? "Trier par nom" : "Trier par taille"} icon={<MaterialIcon name="sort_by_alpha" />} onClick={() => patchActive({ sortKey: activeTab.sortKey === "size" ? "name" : "size" })} /><span className="nie-web-explorer-view-options"><ExplorerToolbarButton label="Options d'affichage" icon={<MaterialIcon name="tune" />} pressed={viewOptions} onClick={() => setViewOptions((open) => !open)} />{viewOptions ? <div className="nie-web-explorer-view-popover" role="dialog" aria-label="Options d'affichage"><strong>Affichage</strong><div><button type="button" aria-pressed={(activeTab.viewMode ?? "list") === "list"} onClick={() => patchActive({ viewMode: "list" })}><MaterialIcon name="view_list" /> Liste</button><button type="button" aria-pressed={activeTab.viewMode === "grid"} onClick={() => patchActive({ viewMode: "grid" })}><MaterialIcon name="grid_view" /> Grille</button></div></div> : null}</span></>}
					/>
				}
				filters={<ExplorerFilters query={activeTab.query ?? ""} extension={activeTab.ext ?? ""} queryPlaceholder="Rechercher (sous-chaîne)…" extensionPlaceholder="ext" onQueryChange={(query) => patchActive({ query })} onExtensionChange={(ext) => patchActive({ ext })} />}
				error={error ? "Les ressources de l’explorateur sont momentanément indisponibles." : undefined}
				status={<ExplorerStatus primary={loading ? "Chargement…" : `${folders.length.toLocaleString("fr-FR")} dossier(s), ${(content?.total ?? files.length).toLocaleString("fr-FR")} fichier(s)`} secondary={multiSelected.size ? `${multiSelected.size.toLocaleString("fr-FR")} sélectionné(s)${selectedBytes ? ` · ${formatBytes(selectedBytes)}` : ""}` : undefined} />}
				selectionBar={multiSelected.size ? <div className="inacord-explorer-selection" role="toolbar" aria-label="Actions de sélection"><span>{multiSelected.size} sélectionné(s)</span><button type="button" onClick={() => setMultiSelected(new Set())}>Effacer la sélection</button></div> : null}
				inspectorHeader={<div className="inacord-explorer-inspector-tabs" role="tablist" aria-label="Inspecteur"><button type="button" role="tab" aria-selected={inspectorTab === "preview"} onClick={() => setInspectorTab("preview")}>Aperçu</button><button type="button" role="tab" aria-selected={inspectorTab === "properties"} disabled={!selectedFile} onClick={() => setInspectorTab("properties")}>Propriétés</button></div>}
				inspector={selectedFile ? <FileInspector file={selectedFile} mode={inspectorTab} /> : <p className="inacord-explorer-inspector-empty">Sélectionnez un fichier pour l’aperçu.</p>}
			>
				<ExplorerEntries viewMode={activeTab.viewMode ?? "list"} gridSize={activeTab.gridSize ?? 96} onKeyDown={onEntriesKeyDown} ariaLabel="Fichiers et dossiers">
					{folders.map((folder) => <button type="button" role="listitem" key={folder.path} data-explorer-path={folder.path} className={`inacord-explorer-entry ${multiSelected.has(folder.path) ? "is-selected" : ""}`} onClick={(event) => { if (event.ctrlKey || event.metaKey || event.shiftKey) select(folder.path, event); else navigate(folder.path); }} onAuxClick={(event) => { if (event.button === 1) setTabsState((state) => openTab(state, `explorer-${Date.now()}`, folder.path)); }}><MaterialIcon name="folder" /><span>{folder.name}</span><small>{content?.folderCounts?.[folder.path]?.toLocaleString("fr-FR") ?? ""}</small></button>)}
					{files.map((file) => <button type="button" role="listitem" key={file.chemin} data-explorer-path={file.chemin} className={`inacord-explorer-entry ${activeTab.selected === file.chemin ? "is-active" : multiSelected.has(file.chemin) ? "is-selected" : ""}`} onClick={(event) => { select(file.chemin, event); patchActive({ selected: file.chemin }); }}><FileIcon file={file} source={source} grid={activeTab.viewMode === "grid"} /><span title={file.chemin}>{resourceLabel(file.chemin, resourceNames)}</span><small>{formatBytes(file.taille)}</small></button>)}
					{!loading && !error && folders.length === 0 && files.length === 0 ? <p className="inacord-explorer-empty">Ce dossier est vide.</p> : null}
				</ExplorerEntries>
			</ExplorerSurface>
		</ExplorerPageShell>
		</div>
	);
}

function FileIcon({ file, source, grid }: { file: EntreeVfs; source: ReturnType<typeof useAssetSource>; grid: boolean }) {
	const texture = /\.g4tx$/i.test(file.chemin);
	if (grid && texture && source.urlTexture) return <img className="inacord-explorer-entry__thumb" alt="" src={source.urlTexture(file.chemin)} loading="lazy" />;
	return <MaterialIcon name={texture ? "image" : "description"} />;
}

function FileInspector({ file, mode }: { file: EntreeVfs; mode: "preview" | "properties" }) {
	const source = useAssetSource();
	if (mode === "properties") return <dl className="inacord-explorer-properties"><dt>Chemin</dt><dd>{file.chemin}</dd><dt>Taille</dt><dd>{formatBytes(file.taille)}</dd><dt>Pack</dt><dd>{file.cpk ?? "—"}</dd></dl>;
	if (/\.g4tx$/i.test(file.chemin)) return <NativeTexturePreview source={source} path={file.chemin} className="inacord-explorer-preview" alt={file.chemin.split("/").at(-1)} />;
	return <div className="inacord-explorer-file-preview"><MaterialIcon name="description" /><strong>{file.chemin.split("/").at(-1)}</strong><span>{formatBytes(file.taille)}</span><a href={source.urlFichier(file.chemin)}>Ouvrir le fichier</a></div>;
}
