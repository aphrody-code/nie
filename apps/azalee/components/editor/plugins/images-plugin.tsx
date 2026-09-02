"use client";

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $wrapNodeInElement, mergeRegister } from "@lexical/utils";
import {
	$createParagraphNode,
	$createRangeSelection,
	$getSelection,
	$insertNodes,
	$isNodeSelection,
	$isRootOrShadowRoot,
	$setSelection,
	COMMAND_PRIORITY_EDITOR,
	COMMAND_PRIORITY_HIGH,
	COMMAND_PRIORITY_LOW,
	createCommand,
	DRAGOVER_COMMAND,
	DRAGSTART_COMMAND,
	DROP_COMMAND,
	PASTE_COMMAND,
} from "lexical";
import type { LexicalCommand, LexicalEditor } from "lexical";
import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";

import { uploadImage } from "@/app/actions/image-upload";
import { $createImageNode, $isImageNode, ImageNode } from "@/components/editor/nodes/image-node";
import type { ImagePayload } from "@/components/editor/nodes/image-node";
import { CAN_USE_DOM } from "@/components/editor/shared/can-use-dom";
import {
	Button,
	DialogFooter,
	Input,
	Label,
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@rosegriffon/ui";

export type InsertImagePayload = Readonly<ImagePayload>;

const getDOMSelection = (targetWindow: Window | null): Selection | null =>
	CAN_USE_DOM ? (targetWindow || window).getSelection() : null;

export const INSERT_IMAGE_COMMAND: LexicalCommand<InsertImagePayload> =
	createCommand("INSERT_IMAGE_COMMAND");

export function InsertImageUriDialogBody({
	onClick,
}: {
	onClick: (payload: InsertImagePayload) => void;
}) {
	const [src, setSrc] = useState("");
	const [altText, setAltText] = useState("");

	const isDisabled = src === "";

	return (
		<div className="grid gap-4 py-4">
			<div className="grid gap-2">
				<Label htmlFor="image-url">URL de l&apos;image</Label>
				<Input
					id="image-url"
					placeholder="https://example.com/image.jpg"
					onChange={(e) => setSrc(e.target.value)}
					value={src}
					data-test-id="image-modal-url-input"
				/>
			</div>
			<div className="grid gap-2">
				<Label htmlFor="image-url-alt">Texte alternatif</Label>
				<Input
					id="image-url-alt"
					placeholder="Description de l'image"
					onChange={(e) => setAltText(e.target.value)}
					value={altText}
					data-test-id="image-modal-alt-text-input"
				/>
			</div>
			<DialogFooter>
				<Button
					type="submit"
					disabled={isDisabled}
					onClick={() => onClick({ altText, src })}
					data-test-id="image-modal-confirm-btn"
				>
					Confirmer
				</Button>
			</DialogFooter>
		</div>
	);
}

export function InsertImageUploadedDialogBody({
	onClick,
}: {
	onClick: (payload: InsertImagePayload) => void;
}) {
	const [src, setSrc] = useState("");
	const [altText, setAltText] = useState("");
	const [isUploading, setIsUploading] = useState(false);

	const isDisabled = src === "" || isUploading;

	const loadImage = async (files: FileList | null) => {
		if (!files || files.length === 0) {
			return;
		}

		setIsUploading(true);
		const formData = new FormData();
		formData.append("file", files[0]);

		try {
			const result = await uploadImage(formData);
			if ("error" in result) {
				alert(`Upload failed: ${result.error}`);
				return;
			}
			setSrc(result.url);
		} catch (error) {
			console.error(error);
			alert("Upload failed");
		} finally {
			setIsUploading(false);
		}
	};

	return (
		<div className="grid gap-4 py-4">
			<div className="grid gap-2">
				<Label htmlFor="image-upload">Téléverser une image</Label>
				<Input
					id="image-upload"
					type="file"
					onChange={(e) => loadImage(e.target.files)}
					accept="image/*"
					data-test-id="image-modal-file-upload"
					disabled={isUploading}
				/>
				{isUploading && (
					<p className="text-xs text-muted-foreground" role="status">
						Optimisation et téléversement en cours...
					</p>
				)}
			</div>
			<div className="grid gap-2">
				<Label htmlFor="image-upload-alt">Texte alternatif</Label>
				<Input
					id="image-upload-alt"
					placeholder="Description de l'image"
					onChange={(e) => setAltText(e.target.value)}
					value={altText}
					data-test-id="image-modal-alt-text-input"
				/>
			</div>
			<Button
				type="submit"
				disabled={isDisabled}
				onClick={() => onClick({ altText, src })}
				data-test-id="image-modal-file-upload-btn"
			>
				{isUploading ? "Téléversement..." : "Confirmer"}
			</Button>
		</div>
	);
}

export function InsertImageDialog({
	activeEditor,
	onClose,
}: {
	activeEditor: LexicalEditor;
	onClose: () => void;
}): JSX.Element {
	const hasModifier = useRef(false);

	useEffect(() => {
		hasModifier.current = false;
		const handler = (e: KeyboardEvent) => {
			hasModifier.current = e.altKey;
		};
		document.addEventListener("keydown", handler);
		return () => {
			document.removeEventListener("keydown", handler);
		};
	}, []);

	const onClick = (payload: InsertImagePayload) => {
		activeEditor.dispatchCommand(INSERT_IMAGE_COMMAND, payload);
		onClose();
	};

	return (
		<Tabs defaultValue="url">
			<TabsList className="w-full" aria-label="Source de l'image">
				<TabsTrigger value="url" className="w-full">
					URL
				</TabsTrigger>
				<TabsTrigger value="file" className="w-full">
					Fichier
				</TabsTrigger>
			</TabsList>
			<TabsContent value="url">
				<InsertImageUriDialogBody onClick={onClick} />
			</TabsContent>
			<TabsContent value="file">
				<InsertImageUploadedDialogBody onClick={onClick} />
			</TabsContent>
		</Tabs>
	);
}

export function ImagesPlugin({
	captionsEnabled: _captionsEnabled,
}: {
	captionsEnabled?: boolean;
}): JSX.Element | null {
	const [editor] = useLexicalComposerContext();

	useEffect(() => {
		if (!editor.hasNodes([ImageNode])) {
			throw new Error("ImagesPlugin: ImageNode not registered on editor");
		}

		return mergeRegister(
			editor.registerCommand<InsertImagePayload>(
				INSERT_IMAGE_COMMAND,
				(payload) => {
					const imageNode = $createImageNode(payload);
					$insertNodes([imageNode]);
					if ($isRootOrShadowRoot(imageNode.getParentOrThrow())) {
						$wrapNodeInElement(imageNode, $createParagraphNode).selectEnd();
					}

					return true;
				},
				COMMAND_PRIORITY_EDITOR
			),
			editor.registerCommand<DragEvent>(
				DRAGSTART_COMMAND,
				(event) => $onDragStart(event),
				COMMAND_PRIORITY_HIGH
			),
			editor.registerCommand<DragEvent>(
				DRAGOVER_COMMAND,
				(event) => $onDragover(event),
				COMMAND_PRIORITY_LOW
			),
			editor.registerCommand<DragEvent>(
				DROP_COMMAND,
				(event) => $onDrop(event, editor),
				COMMAND_PRIORITY_HIGH
			),
			editor.registerCommand<ClipboardEvent>(
				PASTE_COMMAND,
				(event) => $onPaste(event, editor),
				COMMAND_PRIORITY_HIGH
			)
		);
	}, [editor]);

	return null;
}

function $onDragStart(event: DragEvent): boolean {
	const node = $getImageNodeInSelection();
	if (!node) {
		return false;
	}
	const { dataTransfer } = event;
	if (!dataTransfer) {
		return false;
	}
	const TRANSPARENT_IMAGE =
		"data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
	const img = document.createElement("img");
	img.src = TRANSPARENT_IMAGE;
	dataTransfer.setData("text/plain", "_");
	dataTransfer.setDragImage(img, 0, 0);
	dataTransfer.setData(
		"application/x-lexical-drag",
		JSON.stringify({
			data: {
				altText: node.__altText,
				caption: node.__caption,
				height: node.__height,
				key: node.getKey(),
				maxWidth: node.__maxWidth,
				showCaption: node.__showCaption,
				src: node.__src,
				width: node.__width,
			},
			type: "image",
		})
	);

	return true;
}

function $onDragover(event: DragEvent): boolean {
	const node = $getImageNodeInSelection();
	if (!node) {
		return false;
	}
	if (!canDropImage(event)) {
		event.preventDefault();
	}
	return true;
}

function $onDrop(event: DragEvent, editor: LexicalEditor): boolean {
	const node = $getImageNodeInSelection();

	// 1. Handle Lexical internal node drag (already exists)
	const data = getDragImageData(event);
	if (data) {
		event.preventDefault();
		if (canDropImage(event)) {
			const range = getDragSelection(event);
			if (node) {
				node.remove();
			}
			const rangeSelection = $createRangeSelection();
			if (range !== null && range !== undefined) {
				rangeSelection.applyDOMRange(range);
			}
			$setSelection(rangeSelection);
			editor.dispatchCommand(INSERT_IMAGE_COMMAND, data);
		}
		return true;
	}

	// 2. Handle External Files (New)
	const files = event.dataTransfer?.files;
	if (files && files.length > 0) {
		const file = files[0];
		if (file.type.startsWith("image/")) {
			event.preventDefault();

			// Use the range selection to know where to insert
			const range = getDragSelection(event);
			const rangeSelection = $createRangeSelection();
			if (range) {
				rangeSelection.applyDOMRange(range);
			}
			$setSelection(rangeSelection);

			// Upload and optimize
			const formData = new FormData();
			formData.append("file", file);

			uploadImage(formData).then((result) => {
				if ("url" in result) {
					editor.dispatchCommand(INSERT_IMAGE_COMMAND, {
						altText: file.name,
						src: result.url,
					});
				}
			});
			return true;
		}
	}

	return false;
}

function $onPaste(event: ClipboardEvent, editor: LexicalEditor): boolean {
	const files = event.clipboardData?.files;
	if (files && files.length > 0) {
		const file = files[0];
		if (file.type.startsWith("image/")) {
			event.preventDefault();

			// Upload and optimize
			const formData = new FormData();
			formData.append("file", file);

			uploadImage(formData).then((result) => {
				if ("url" in result) {
					editor.dispatchCommand(INSERT_IMAGE_COMMAND, {
						altText: file.name,
						src: result.url,
					});
				}
			});
			return true;
		}
	}
	return false;
}

function $getImageNodeInSelection(): ImageNode | null {
	const selection = $getSelection();
	if (!$isNodeSelection(selection)) {
		return null;
	}
	const nodes = selection.getNodes();
	const node = nodes[0];
	return $isImageNode(node) ? node : null;
}

function getDragImageData(event: DragEvent): null | InsertImagePayload {
	const dragData = event.dataTransfer?.getData("application/x-lexical-drag");
	if (!dragData) {
		return null;
	}
	const { type, data } = JSON.parse(dragData);
	if (type !== "image") {
		return null;
	}

	return data;
}

declare global {
	interface DragEvent {
		rangeOffset?: number;
		rangeParent?: Node;
	}
}

function canDropImage(event: DragEvent): boolean {
	const { target } = event;
	return Boolean(
		target &&
		target instanceof HTMLElement &&
		!target.closest("code, span.editor-image") &&
		target.parentElement?.closest("div.ContentEditable__root")
	);
}

function getDragSelection(event: DragEvent): Range | null | undefined {
	let range;
	const target = event.target as null | Element | Document;
	const targetWindow =
		target == null
			? null
			: target.nodeType === 9
				? (target as Document).defaultView
				: (target as Element).ownerDocument.defaultView;
	const domSelection = getDOMSelection(targetWindow);
	if (document.caretRangeFromPoint) {
		range = document.caretRangeFromPoint(event.clientX, event.clientY);
	} else if (event.rangeParent && domSelection !== null) {
		domSelection.collapse(event.rangeParent, event.rangeOffset || 0);
		range = domSelection.getRangeAt(0);
	} else {
		throw new Error("Cannot get the selection when dragging");
	}

	return range;
}
