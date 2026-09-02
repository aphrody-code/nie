"use client";

import type { LexicalEditor } from "lexical";
import { createContext, useContext } from "react";
import type { JSX } from "react";

const Context = createContext<{
	activeEditor: LexicalEditor;
	$updateToolbar: () => void;
	blockType: string;
	setBlockType: (blockType: string) => void;
	showModal: (title: string, showModal: (onClose: () => void) => JSX.Element) => void;
	isBold: boolean;
	isItalic: boolean;
	isUnderline: boolean;
	isStrikethrough: boolean;
	isCode: boolean;
	isLink: boolean;
}>({
	$updateToolbar: () => {},
	activeEditor: {} as LexicalEditor,
	blockType: "paragraph",
	isBold: false,
	isCode: false,
	isItalic: false,
	isLink: false,
	isStrikethrough: false,
	isUnderline: false,
	setBlockType: () => {},
	showModal: () => {},
});

export function ToolbarContext({
	activeEditor,
	$updateToolbar,
	blockType,
	setBlockType,
	showModal,
	isBold,
	isItalic,
	isUnderline,
	isStrikethrough,
	isCode,
	isLink,
	children,
}: {
	activeEditor: LexicalEditor;
	$updateToolbar: () => void;
	blockType: string;
	setBlockType: (blockType: string) => void;
	showModal: (title: string, showModal: (onClose: () => void) => JSX.Element) => void;
	isBold: boolean;
	isItalic: boolean;
	isUnderline: boolean;
	isStrikethrough: boolean;
	isCode: boolean;
	isLink: boolean;
	children: React.ReactNode;
}) {
	return (
		<Context.Provider
			value={{
				$updateToolbar,
				activeEditor,
				blockType,
				isBold,
				isCode,
				isItalic,
				isLink,
				isStrikethrough,
				isUnderline,
				setBlockType,
				showModal,
			}}
		>
			{children}
		</Context.Provider>
	);
}

export function useToolbarContext() {
	return useContext(Context);
}
