"use client";

import { TOGGLE_LINK_COMMAND } from "@lexical/link";
import {
	INSERT_CHECK_LIST_COMMAND,
	INSERT_ORDERED_LIST_COMMAND,
	INSERT_UNORDERED_LIST_COMMAND,
} from "@lexical/list";
import { FORMAT_ELEMENT_COMMAND, FORMAT_TEXT_COMMAND } from "lexical";
import {
	AlignCenter,
	AlignLeft,
	AlignRight,
	Bold,
	Code,
	ImageIcon,
	Italic,
	Link as LinkIcon,
	List,
	ListOrdered,
	ListTodo,
	Strikethrough,
	Underline,
} from "lucide-react";
import { useCallback, useState } from "react";
import { useToolbarContext } from "@/components/editor/context/toolbar-context";
import { InsertImageDialog } from "@/components/editor/plugins/images-plugin";
import {
	Button,
	Input,
	Label,
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@rosegriffon/ui";

export function Toolbar() {
	const {
		activeEditor,
		showModal,
		isBold,
		isItalic,
		isUnderline,
		isStrikethrough,
		isCode,
		isLink,
	} = useToolbarContext();

	const [linkDialogOpen, setLinkDialogOpen] = useState(false);
	const [linkUrl, setLinkUrl] = useState("https://");

	const onClick = (command: string) => {
		switch (command) {
			case "bold": {
				activeEditor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold");
				break;
			}
			case "italic": {
				activeEditor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic");
				break;
			}
			case "underline": {
				activeEditor.dispatchCommand(FORMAT_TEXT_COMMAND, "underline");
				break;
			}
			case "strikethrough": {
				activeEditor.dispatchCommand(FORMAT_TEXT_COMMAND, "strikethrough");
				break;
			}
			case "code": {
				activeEditor.dispatchCommand(FORMAT_TEXT_COMMAND, "code");
				break;
			}
			case "left": {
				activeEditor.dispatchCommand(FORMAT_ELEMENT_COMMAND, "left");
				break;
			}
			case "center": {
				activeEditor.dispatchCommand(FORMAT_ELEMENT_COMMAND, "center");
				break;
			}
			case "right": {
				activeEditor.dispatchCommand(FORMAT_ELEMENT_COMMAND, "right");
				break;
			}
			case "ul": {
				activeEditor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
				break;
			}
			case "ol": {
				activeEditor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
				break;
			}
			case "checklist": {
				activeEditor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined);
				break;
			}
			case "link": {
				if (!isLink) {
					setLinkUrl("https://");
					setLinkDialogOpen(true);
				} else {
					activeEditor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
				}
				break;
			}
		}
	};

	const handleLinkSubmit = () => {
		if (linkUrl && linkUrl !== "https://") {
			activeEditor.dispatchCommand(TOGGLE_LINK_COMMAND, linkUrl);
		}
		setLinkDialogOpen(false);
		setLinkUrl("https://");
	};

	const insertImage = useCallback(() => {
		showModal("Insérer une image", (onClose) => (
			<InsertImageDialog activeEditor={activeEditor} onClose={onClose} />
		));
	}, [activeEditor, showModal]);

	return (
		<>
			<div
				className="flex items-center gap-1 flex-wrap"
				role="toolbar"
				aria-label="Mise en forme du texte"
			>
				<Button
					variant={isBold ? "secondary" : "ghost"}
					size="sm"
					className="size-8 p-0"
					onClick={() => onClick("bold")}
					aria-label="Gras"
					aria-pressed={isBold}
				>
					<Bold className="size-4" />
				</Button>
				<Button
					variant={isItalic ? "secondary" : "ghost"}
					size="sm"
					className="size-8 p-0"
					onClick={() => onClick("italic")}
					aria-label="Italique"
					aria-pressed={isItalic}
				>
					<Italic className="size-4" />
				</Button>
				<Button
					variant={isUnderline ? "secondary" : "ghost"}
					size="sm"
					className="size-8 p-0"
					onClick={() => onClick("underline")}
					aria-label="Souligné"
					aria-pressed={isUnderline}
				>
					<Underline className="size-4" />
				</Button>
				<Button
					variant={isStrikethrough ? "secondary" : "ghost"}
					size="sm"
					className="size-8 p-0"
					onClick={() => onClick("strikethrough")}
					aria-label="Barré"
					aria-pressed={isStrikethrough}
				>
					<Strikethrough className="size-4" />
				</Button>
				<Button
					variant={isCode ? "secondary" : "ghost"}
					size="sm"
					className="size-8 p-0"
					onClick={() => onClick("code")}
					aria-label="Code en ligne"
					aria-pressed={isCode}
				>
					<Code className="size-4" />
				</Button>

				<div
					className="w-px h-6 bg-outline-variant/30 mx-1"
					role="separator"
					aria-orientation="vertical"
				/>

				<Button
					variant="ghost"
					size="sm"
					className="size-8 p-0"
					onClick={() => onClick("left")}
					aria-label="Aligner à gauche"
				>
					<AlignLeft className="size-4" />
				</Button>
				<Button
					variant="ghost"
					size="sm"
					className="size-8 p-0"
					onClick={() => onClick("center")}
					aria-label="Centrer"
				>
					<AlignCenter className="size-4" />
				</Button>
				<Button
					variant="ghost"
					size="sm"
					className="size-8 p-0"
					onClick={() => onClick("right")}
					aria-label="Aligner à droite"
				>
					<AlignRight className="size-4" />
				</Button>

				<div
					className="w-px h-6 bg-outline-variant/30 mx-1"
					role="separator"
					aria-orientation="vertical"
				/>

				<Button
					variant="ghost"
					size="sm"
					className="size-8 p-0"
					onClick={() => onClick("ul")}
					aria-label="Liste à puces"
				>
					<List className="size-4" />
				</Button>
				<Button
					variant="ghost"
					size="sm"
					className="size-8 p-0"
					onClick={() => onClick("ol")}
					aria-label="Liste numérotée"
				>
					<ListOrdered className="size-4" />
				</Button>
				<Button
					variant="ghost"
					size="sm"
					className="size-8 p-0"
					onClick={() => onClick("checklist")}
					aria-label="Liste de tâches"
				>
					<ListTodo className="size-4" />
				</Button>

				<div
					className="w-px h-6 bg-outline-variant/30 mx-1"
					role="separator"
					aria-orientation="vertical"
				/>

				<Button
					variant={isLink ? "secondary" : "ghost"}
					size="sm"
					className="size-8 p-0"
					onClick={() => onClick("link")}
					aria-label={isLink ? "Supprimer le lien" : "Insérer un lien"}
					aria-pressed={isLink}
				>
					<LinkIcon className="size-4" />
				</Button>
				<Button
					variant="ghost"
					size="sm"
					className="size-8 p-0"
					onClick={insertImage}
					aria-label="Insérer une image"
				>
					<ImageIcon className="size-4" />
				</Button>
			</div>

			{/* Link insertion dialog (replaces prompt()) */}
			<Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
				<DialogContent className="sm:max-w-[420px] bg-background">
					<DialogHeader>
						<DialogTitle>Insérer un lien</DialogTitle>
					</DialogHeader>
					<div className="grid gap-4 py-4">
						<div className="grid gap-2">
							<Label htmlFor="link-url">URL</Label>
							<Input
								id="link-url"
								value={linkUrl}
								onChange={(e) => setLinkUrl(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") {
										e.preventDefault();
										handleLinkSubmit();
									}
								}}
								placeholder="https://example.com"
								autoFocus
							/>
						</div>
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => setLinkDialogOpen(false)}>
							Annuler
						</Button>
						<Button onClick={handleLinkSubmit} disabled={!linkUrl || linkUrl === "https://"}>
							Insérer
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
