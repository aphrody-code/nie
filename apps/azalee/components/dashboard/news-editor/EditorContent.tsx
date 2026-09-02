"use client";

import type { SerializedEditorState } from "lexical";
import { Editor } from "@/components/blocks/editor-00/editor";

interface EditorContentProps {
	content: SerializedEditorState;
	onContentChange: (content: SerializedEditorState) => void;
}

export function EditorContent({ content, onContentChange }: EditorContentProps) {
	return (
		<Editor
			id="news-content-editor"
			editorSerializedState={content}
			onSerializedChange={onContentChange}
			className="h-full border-none shadow-none bg-transparent rounded-none"
		/>
	);
}
