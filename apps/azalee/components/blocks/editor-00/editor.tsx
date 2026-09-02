"use client";

import { LexicalComposer } from "@lexical/react/LexicalComposer";
import type { InitialConfigType } from "@lexical/react/LexicalComposer";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import type { EditorState, SerializedEditorState } from "lexical";

import { editorTheme } from "@/components/editor/themes/editor-theme";
import { TooltipProvider } from "@rosegriffon/ui";
import { cn } from "@/lib/utils";
import { nodes } from "./nodes";
import { Plugins } from "./plugins";

const editorConfig: InitialConfigType = {
	namespace: "Editor",
	nodes,
	onError: (error: Error) => {
		console.error(error);
	},
	theme: editorTheme,
};

export function Editor({
	id,
	editorState,
	editorSerializedState,
	onChange,
	onSerializedChange,
	className,
}: {
	id?: string;
	editorState?: EditorState;
	editorSerializedState?: SerializedEditorState;
	onChange?: (editorState: EditorState) => void;
	onSerializedChange?: (editorSerializedState: SerializedEditorState) => void;
	className?: string;
}) {
	return (
		<div className={cn("bg-background overflow-hidden rounded-lg border shadow h-full", className)}>
			<LexicalComposer
				initialConfig={{
					...editorConfig,
					...(editorState ? { editorState } : {}),
					...(editorSerializedState ? { editorState: JSON.stringify(editorSerializedState) } : {}),
				}}
			>
				<TooltipProvider>
					<Plugins id={id} />

					<OnChangePlugin
						ignoreSelectionChange
						onChange={(editorState) => {
							onChange?.(editorState);
							onSerializedChange?.(editorState.toJSON());
						}}
					/>
				</TooltipProvider>
			</LexicalComposer>
		</div>
	);
}
