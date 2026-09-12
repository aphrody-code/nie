/**
 * The Inacord 3D editing layer, mounted as an `/avatar` tab.
 *
 * It IMPORTS `EditorView` — the desktop editor — rather than restating it: the three workspaces
 * (`Avatar 3D` under `data/common/chr/_face/20_EDIT`, `Avatar UI`, `Menus`) already live there
 * with their content browser, their viewport and their pipeline panels. In the browser its
 * `@/lib/api` calls resolve to the HTTP shim (`src/inacord-web/shims/core.ts`), which serves the
 * VFS, texture and model commands from `nie-site`.
 *
 * Lazy by construction: the game's avatar editor must not pay for three.js on load.
 */
import { lazy, Suspense, useState } from "react";
import { TooltipProvider } from "@niers/inacord-ui/components/ui/tooltip";
import type { EditorViewState } from "@/components/editor/EditorView";

const EditorView = lazy(() => import("@/components/editor/EditorView").then(({ EditorView }) => ({ default: EditorView })));

/** The workspace prefixes are `EditorView`'s own; this only picks the starting folder. */
export const WORKSPACE_PREFIX = {
	"avatar-modeles": "data/common/chr/_face/20_EDIT",
	"avatar-ui": "data/dx11/menu/200_icon/21_icon_avatar",
	menus: "data/common/menu",
} as const;

export type WorkspaceId = keyof typeof WORKSPACE_PREFIX;

export function InacordWorkspace({ workspace }: { workspace: WorkspaceId }) {
	const [state, setState] = useState<EditorViewState>({ prefix: WORKSPACE_PREFIX[workspace], selected: null });
	return (
		<TooltipProvider>
			<Suspense fallback={<p role="status" className="avatar-workspace__state">Chargement de l’éditeur…</p>}>
				<EditorView state={state} onStateChange={setState} />
			</Suspense>
		</TooltipProvider>
	);
}
