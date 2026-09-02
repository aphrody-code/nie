"use client";

import { TRANSFORMERS } from "@lexical/markdown";
import { AutoFocusPlugin } from "@lexical/react/LexicalAutoFocusPlugin";
import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin";
import { ClearEditorPlugin } from "@lexical/react/LexicalClearEditorPlugin";
import { ClickableLinkPlugin } from "@lexical/react/LexicalClickableLinkPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { HorizontalRulePlugin } from "@lexical/react/LexicalHorizontalRulePlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { TabIndentationPlugin } from "@lexical/react/LexicalTabIndentationPlugin";
import { TablePlugin } from "@lexical/react/LexicalTablePlugin";
import { useState } from "react";

import { ContentEditable } from "@/components/editor/editor-ui/content-editable";
import { Toolbar } from "@/components/editor/editor-ui/toolbar";
import { ActionsWrapper } from "@/components/editor/plugins/actions/actions-wrapper";
import { ImportExportPlugin } from "@/components/editor/plugins/actions/import-export-plugin";
import { MaxLengthPlugin } from "@/components/editor/plugins/actions/max-length-plugin";
import { AutoLinkPlugin } from "@/components/editor/plugins/auto-link-plugin";
import { FloatingLinkEditorPlugin } from "@/components/editor/plugins/floating-link-editor-plugin";
import { ImagesPlugin } from "@/components/editor/plugins/images-plugin";
import { LinkPlugin } from "@/components/editor/plugins/link-plugin";
import { ToolbarPlugin } from "@/components/editor/plugins/toolbar/toolbar-plugin";
import { IMAGE } from "@/components/editor/transformers/markdown-image-transformer";

export function Plugins({ id }: { id?: string }) {
	const [floatingAnchorElem, setFloatingAnchorElem] = useState<HTMLDivElement | null>(null);
	const [isLinkEditMode, setIsLinkEditMode] = useState<boolean>(false);

	const onRef = (_floatingAnchorElem: HTMLDivElement) => {
		if (_floatingAnchorElem !== null) {
			setFloatingAnchorElem(_floatingAnchorElem);
		}
	};

	return (
		<ToolbarPlugin>
			{() => (
				<div className="relative flex flex-col h-full bg-background rounded-none border-none">
					{/* Toolbar plugins */}
					<div className="border-b px-2 py-1 z-10 sticky top-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
						<Toolbar />
					</div>

					<div className="relative flex-1 overflow-y-auto" id={id}>
						<RichTextPlugin
							contentEditable={
								<div className="h-full min-h-[50vh] px-4 md:px-8 py-4" ref={onRef}>
									<ContentEditable
										className="outline-hidden min-h-full relative"
										placeholder="Commencez à écrire..."
										placeholderClassName="text-muted-foreground absolute top-0 left-0 pointer-events-none select-none"
									/>
								</div>
							}
							ErrorBoundary={LexicalErrorBoundary}
						/>

						{/* Core editor plugins */}
						<HistoryPlugin />
						<AutoFocusPlugin />
						<ListPlugin />
						<AutoLinkPlugin />
						<LinkPlugin />
						<ClickableLinkPlugin />
						<ImagesPlugin />
						<MarkdownShortcutPlugin transformers={[IMAGE, ...TRANSFORMERS]} />
						<TablePlugin />
						<CheckListPlugin />
						<ClearEditorPlugin />
						<HorizontalRulePlugin />
						<TabIndentationPlugin />

						{/* Floating plugins */}
						{floatingAnchorElem && (
							<FloatingLinkEditorPlugin
								anchorElem={floatingAnchorElem}
								isLinkEditMode={isLinkEditMode}
								setIsLinkEditMode={setIsLinkEditMode}
							/>
						)}
					</div>

					{/* Footer Actions */}
					<div className="mt-auto z-10 relative">
						<ActionsWrapper>
							<ImportExportPlugin />
							<MaxLengthPlugin maxLength={30_000} />
						</ActionsWrapper>
					</div>
				</div>
			)}
		</ToolbarPlugin>
	);
}
