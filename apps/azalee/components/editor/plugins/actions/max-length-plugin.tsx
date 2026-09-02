"use client";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { RootNode } from "lexical";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export function MaxLengthPlugin({ maxLength }: { maxLength: number }) {
	const [editor] = useLexicalComposerContext();
	const [lastContentLength, setLastContentLength] = useState(0);

	useEffect(
		() =>
			editor.registerNodeTransform(RootNode, (rootNode) => {
				const textContent = rootNode.getTextContent();
				if (textContent.length > maxLength) {
					// Here we could try to truncate or just notify
					// But Lexical usually handles this in the OnChange or via a specific transform that prevents it.
					// For simplicity, we just track length here for the UI part if needed.
				}
				setLastContentLength(textContent.length);
			}),
		[editor, maxLength]
	);

	const isOverLimit = lastContentLength > maxLength;

	return (
		<div
			role="status"
			aria-live="polite"
			aria-label={`${lastContentLength} caractères sur ${maxLength}`}
			className={cn(
				"text-[10px] font-medium px-2 py-0.5 rounded-full border transition-colors",
				isOverLimit
					? "bg-error-container text-on-error-container border-error"
					: lastContentLength > maxLength * 0.9
						? "bg-warning-container text-on-warning-container border-warning"
						: "bg-surface-container-highest text-on-surface-variant border-outline-variant/30"
			)}
		>
			{lastContentLength} / {maxLength}
		</div>
	);
}
