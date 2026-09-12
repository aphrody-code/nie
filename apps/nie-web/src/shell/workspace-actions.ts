/**
 * The gestures that open something IN the workspace, from anywhere in the merged interface.
 *
 * ## Why they left the workspace body
 *
 * « Open this folder », « reveal this file », « search for this » used to be closures inside the
 * workspace component, because the sidebar that triggered them was drawn by that same component.
 * The merged interface draws ONE sidebar, above every screen — the game ones included — so the
 * places, the pins and the recents now live outside the body they act on.
 *
 * They still act on the same two owners: the tab state (`lib/explorerTabs`, a module store, which
 * is why none of this needs a React context) and the route, which the caller supplies. Nothing
 * here re-implements navigation: `navigate` is the host's own `navigate`, the one that writes the
 * address bar.
 */
import { explorerTabs, getExplorerTabs } from "@/lib/explorerTabs";
import { setExternalPath } from "@/lib/externalPath";
import { recordVisit } from "@/lib/places";
import { INACORD } from "../entries";

/** The route of a workspace view: `/inacord/<viewId>`. */
export function workspaceRoute(viewId: string): string {
	return `${INACORD}/${viewId}`;
}

/** The route of the Explorer — where every place, reveal and search gesture lands. */
export const EXPLORER_ROUTE = workspaceRoute("explorer");

/** The gestures, bound to one navigation function. */
export interface WorkspaceActions {
	/** Opens a VFS prefix in the ACTIVE tab and shows the Explorer. */
	gotoPlace(prefix: string): void;
	/** Opens a VFS prefix in a NEW tab — middle click, « open in a new tab ». */
	gotoPlaceInNewTab(prefix: string): void;
	/** Opens the Explorer ON a file: its folder, with the file selected inside it. */
	revealInExplorer(path: string): void;
	/** Runs a query in the active tab and shows the Explorer. */
	openSearch(query: string): void;
	/** Opens a workspace view by its registry id (`lib/vues.ts`). */
	openView(viewId: string): void;
}

export function createWorkspaceActions(navigate: (route: string) => void): WorkspaceActions {
	const active = () => getExplorerTabs().activeId;
	return {
		gotoPlace(prefix) {
			recordVisit(prefix);
			setExternalPath(null);
			explorerTabs.update(active(), { prefix, selected: null });
			navigate(EXPLORER_ROUTE);
		},
		gotoPlaceInNewTab(prefix) {
			recordVisit(prefix);
			setExternalPath(null);
			explorerTabs.open(prefix);
			navigate(EXPLORER_ROUTE);
		},
		revealInExplorer(path) {
			// The prefix is the parent folder; a path without `/` designates the VFS root, which is
			// the empty string. Setting only `selected` revealed nothing — the tab stayed on its
			// current folder, where the named file is not listed.
			const cut = path.lastIndexOf("/");
			const folder = cut === -1 ? "" : path.slice(0, cut);
			recordVisit(folder);
			setExternalPath(null);
			explorerTabs.update(active(), { prefix: folder, selected: path });
			navigate(EXPLORER_ROUTE);
		},
		openSearch(query) {
			setExternalPath(null);
			explorerTabs.update(active(), { query });
			navigate(EXPLORER_ROUTE);
		},
		openView(viewId) {
			setExternalPath(null);
			navigate(workspaceRoute(viewId));
		},
	};
}
