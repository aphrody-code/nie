import { cn } from "../../../lib/utils";

export interface SearchHighlightPart {
	text: string;
	highlight: boolean;
}

export interface SearchResultHighlightProps {
	text: string;
	query: string;
	className?: string;
	/** The host supplies its existing search policy; this surface only renders it. */
	highlightMatches: (text: string, query: string) => SearchHighlightPart[];
}

/** Shared presentation for matched search text across the wiki hosts. */
export function SearchResultHighlight({ text, query, className, highlightMatches }: SearchResultHighlightProps) {
	const parts = highlightMatches(text, query);

	return (
		<span className={cn("inline", className)}>
			{parts.map((part, index) =>
				part.highlight ? (
					<mark
						key={index}
						className="bg-[var(--md-sys-color-tertiary-container)] text-[var(--md-sys-color-on-tertiary-container)] rounded-sm px-0.5 font-semibold"
					>
						{part.text}
					</mark>
				) : (
					<span key={index}>{part.text}</span>
				)
			)}
		</span>
	);
}
