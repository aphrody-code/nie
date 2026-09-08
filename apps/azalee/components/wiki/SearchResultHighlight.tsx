/**
 * SearchResultHighlight - Highlight matching text in search results
 *
 * Material Design 3 component for highlighting matched portions of text
 */

import {
	SearchResultHighlight as SharedSearchResultHighlight,
	type SearchResultHighlightProps as SharedSearchResultHighlightProps,
} from "@niers/inacord-ui";
import { highlightMatches } from "@rosegriffon/azalee/search/fuzzy-match";

export type SearchResultHighlightProps = Omit<SharedSearchResultHighlightProps, "highlightMatches">;

/** Azalée adapter: it keeps the public wiki fuzzy-match policy. */
export function SearchResultHighlight(props: SearchResultHighlightProps) {
	return <SharedSearchResultHighlight {...props} highlightMatches={highlightMatches} />;
}
