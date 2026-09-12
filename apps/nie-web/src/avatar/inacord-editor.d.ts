/**
 * The site project deliberately excludes `src/desktop` from type-checking (`tsconfig.json`), yet
 * `/avatar` mounts the desktop editor through the `@/` alias that Vite resolves in every mode.
 * Declaring the surface we consume keeps `tsc -p tsconfig.json` honest without dragging the whole
 * desktop tree into the site programme, which since 2026-09-12 is the SAME programme.
 */
declare module "@/components/editor/EditorView" {
	import type { ComponentType } from "react";
	export interface EditorViewState {
		prefix: string;
		selected: string | null;
	}
	export const EditorView: ComponentType<{
		state: EditorViewState;
		onStateChange: (state: EditorViewState) => void;
		onOpenInExplorer?: (path: string) => void;
	}>;
}
