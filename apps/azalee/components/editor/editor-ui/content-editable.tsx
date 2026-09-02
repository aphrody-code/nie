"use client";

import { ContentEditable as LexicalContentEditable } from "@lexical/react/LexicalContentEditable";
import type { JSX } from "react";

interface Props {
	placeholder: React.ReactNode;
	className?: string;
	placeholderClassName?: string;
}

export function ContentEditable({
	placeholder,
	className,
	placeholderClassName,
}: Props): JSX.Element {
	return (
		<LexicalContentEditable
			className={
				className ??
				"ContentEditable__root relative block min-h-72 min-h-full overflow-auto px-8 py-4 focus:outline-hidden"
			}
			aria-label="Contenu de l'article"
			aria-placeholder={typeof placeholder === "string" ? placeholder : "Éditeur de texte"}
			aria-multiline="true"
			placeholder={
				<div
					className={
						placeholderClassName ??
						"text-muted-foreground pointer-events-none absolute top-0 left-0 overflow-hidden px-8 py-[18px] text-ellipsis select-none"
					}
				>
					{placeholder}
				</div>
			}
		/>
	);
}
