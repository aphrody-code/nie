import { Lightbulb, SearchX } from "lucide-react";
import * as React from "react";
import {
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "../../ui/command";
import { Skeleton } from "../../ui/skeleton";

/** Minimum data required for a result in the shared command-palette surface. */
export interface GlobalSearchDialogResult {
	id: string | number;
	type: string;
	title: string;
	subtitle?: string;
}

export interface GlobalSearchDialogProps<Result extends GlobalSearchDialogResult> {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	query: string;
	onQueryChange: (query: string) => void;
	results: readonly Result[];
	isSearching: boolean;
	onSelectResult: (result: Result) => void;
	renderResult: (result: Result) => React.ReactNode;
	groupLabel: (type: string) => string;
	minQueryLength?: number;
	placeholder?: string;
	noResultsLabel?: (query: string) => React.ReactNode;
	suggestionLabel?: React.ReactNode;
	title?: string;
	description?: string;
}

function groupResultsByType<Result extends GlobalSearchDialogResult>(results: readonly Result[]) {
	const groups = new Map<string, Result[]>();
	for (const result of results) {
		const group = groups.get(result.type);
		if (group) {
			group.push(result);
		} else {
			groups.set(result.type, [result]);
		}
	}
	return groups;
}

/**
 * Controlled presentation for a remote or local global search command palette.
 *
 * The host owns the query, cancellation, result lookup, localization, and navigation. This
 * component only renders the accessible dialog states and dispatches user selections.
 */
export function GlobalSearchDialog<Result extends GlobalSearchDialogResult>({
	open,
	onOpenChange,
	query,
	onQueryChange,
	results,
	isSearching,
	onSelectResult,
	renderResult,
	groupLabel,
	minQueryLength = 2,
	placeholder = "Search…",
	noResultsLabel = (searchQuery) => <>No results for “{searchQuery}”</>,
	suggestionLabel = "Did you mean…",
	title = "Search",
	description = "Search the available records.",
}: GlobalSearchDialogProps<Result>) {
	const groups = React.useMemo(() => groupResultsByType(results), [results]);
	const suggestion = results.length === 1 ? results.at(0) : undefined;
	const hasSuggestion = suggestion?.type === "suggestion";
	const canReportEmpty = query.length >= minQueryLength && !isSearching && results.length === 0;

	return (
		<CommandDialog
			open={open}
			onOpenChange={onOpenChange}
			title={title}
			description={description}
			commandProps={{ shouldFilter: false }}
		>
			<CommandInput placeholder={placeholder} value={query} onValueChange={onQueryChange} />
			<CommandList>
				{canReportEmpty && (
					<CommandEmpty>
						<div className="py-6 text-center">
							<SearchX size={36} aria-hidden="true" className="mb-2 text-muted-foreground" />
							<p className="text-sm text-muted-foreground">{noResultsLabel(query)}</p>
						</div>
					</CommandEmpty>
				)}

				{isSearching && (
					<div className="space-y-2 px-2 py-3" aria-live="polite" aria-label="Searching">
						{Array.from({ length: 3 }, (_, index) => (
							<div key={index} className="flex items-center gap-3 p-2">
								<Skeleton className="size-5 rounded-md" />
								<div className="flex-1 space-y-2">
									<Skeleton className="h-4 w-3/4" />
									<Skeleton className="h-3 w-1/2" />
								</div>
							</div>
						))}
					</div>
				)}

				{suggestion && hasSuggestion && (
					<div className="px-4 py-6 text-center">
						<Lightbulb size={30} aria-hidden="true" className="mb-2 text-primary" />
						<p className="mb-2 text-sm text-muted-foreground">{suggestionLabel}</p>
						<button
							type="button"
							onClick={() => onQueryChange(suggestion.title)}
							className="rounded-full border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted"
						>
							{suggestion.title}
						</button>
					</div>
				)}

				{!hasSuggestion &&
					Array.from(groups, ([type, items]) => (
						<CommandGroup
							key={type}
							heading={groupLabel(type)}
							className="[&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:text-primary"
						>
							{items.map((result) => (
								<CommandItem
									key={`${result.type}-${result.id}`}
									value={`${result.title} ${result.subtitle ?? ""}`}
									onSelect={() => onSelectResult(result)}
									className="rounded-xl !p-0 transition-all duration-150 data-[selected=true]:bg-secondary/20"
								>
									{renderResult(result)}
								</CommandItem>
							))}
						</CommandGroup>
					))}
			</CommandList>
		</CommandDialog>
	);
}
