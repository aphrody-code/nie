"use client";

import { $isLinkNode } from "@lexical/link";
import { $isListNode, ListNode } from "@lexical/list";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $isHeadingNode } from "@lexical/rich-text";
import { $getNearestNodeOfType, mergeRegister } from "@lexical/utils";
import {
	$getSelection,
	$isRangeSelection,
	COMMAND_PRIORITY_CRITICAL,
	SELECTION_CHANGE_COMMAND,
} from "lexical";
import { useCallback, useEffect, useState } from "react";

import { ToolbarContext } from "@/components/editor/context/toolbar-context";
import { useEditorModal } from "@/components/editor/editor-hooks/use-modal";
import { getSelectedNode } from "@/components/editor/utils/get-selected-node";

export function ToolbarPlugin({
	children,
}: {
	children: (props: { blockType: string }) => React.ReactNode;
}) {
	const [editor] = useLexicalComposerContext();

	const [activeEditor, setActiveEditor] = useState(editor);
	const [blockType, setBlockType] = useState<string>("paragraph");
	const [isBold, setIsBold] = useState(false);
	const [isItalic, setIsItalic] = useState(false);
	const [isUnderline, setIsUnderline] = useState(false);
	const [isStrikethrough, setIsStrikethrough] = useState(false);
	const [isCode, setIsCode] = useState(false);
	const [isLink, setIsLink] = useState(false);

	const [modal, showModal] = useEditorModal();

	const $updateToolbar = useCallback(() => {
		const selection = $getSelection();
		if ($isRangeSelection(selection)) {
			const anchorNode = selection.anchor.getNode();
			const element =
				anchorNode.getKey() === "root" ? anchorNode : anchorNode.getTopLevelElementOrThrow();
			const elementKey = element.getKey();
			const elementDOM = activeEditor.getElementByKey(elementKey);

			// Update text format
			setIsBold(selection.hasFormat("bold"));
			setIsItalic(selection.hasFormat("italic"));
			setIsUnderline(selection.hasFormat("underline"));
			setIsStrikethrough(selection.hasFormat("strikethrough"));
			setIsCode(selection.hasFormat("code"));

			// Update links
			const node = getSelectedNode(selection);
			const parent = node.getParent();
			if ($isLinkNode(parent) || $isLinkNode(node)) {
				setIsLink(true);
			} else {
				setIsLink(false);
			}

			if (elementDOM !== null) {
				if ($isListNode(element)) {
					const parentList = $getNearestNodeOfType<ListNode>(anchorNode, ListNode);
					const type = parentList ? parentList.getListType() : element.getListType();
					setBlockType(type);
				} else {
					const type = $isHeadingNode(element) ? element.getTag() : element.getType();
					setBlockType(type);
				}
			}
		}
	}, [activeEditor]);

	useEffect(
		() =>
			mergeRegister(
				editor.registerUpdateListener(({ editorState }) => {
					editorState.read(() => {
						$updateToolbar();
					});
				}),
				activeEditor.registerCommand(
					SELECTION_CHANGE_COMMAND,
					(_payload, newEditor) => {
						setActiveEditor(newEditor);
						$updateToolbar();
						return false;
					},
					COMMAND_PRIORITY_CRITICAL
				)
			),
		[activeEditor, editor, $updateToolbar]
	);

	return (
		<ToolbarContext
			activeEditor={activeEditor}
			$updateToolbar={$updateToolbar}
			blockType={blockType}
			setBlockType={setBlockType}
			showModal={showModal}
			isBold={isBold}
			isItalic={isItalic}
			isUnderline={isUnderline}
			isStrikethrough={isStrikethrough}
			isCode={isCode}
			isLink={isLink}
		>
			{modal}

			{children({ blockType })}
		</ToolbarContext>
	);
}
