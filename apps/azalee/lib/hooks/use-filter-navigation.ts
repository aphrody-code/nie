"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, useTransition } from "react";

// ── Shared pending context ────────────────────────────────

interface FilterPendingCtx {
	isPending: boolean;
	startTransition: (cb: () => void) => void;
}

export const FilterTransitionContext = createContext<FilterPendingCtx | null>(null);

/**
 * Call once in the page-level client component (e.g. PlayersClient)
 * to create the shared transition state and expose it via context.
 */
export function useFilterTransition() {
	const [isPending, startTransition] = useTransition();
	const value = useMemo<FilterPendingCtx>(() => ({ isPending, startTransition }), [isPending]);
	return value;
}

// ── Hook consumed by every filter chip ────────────────────

/**
 * Hook for filter-based navigation with transition support.
 * Uses the shared context when available (page provides it),
 * falls back to a local useTransition otherwise.
 */
export function useFilterNavigation() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const shared = useContext(FilterTransitionContext);
	const [localPending, localStartTransition] = useTransition();

	const isPending = shared ? shared.isPending : localPending;
	const startTransition = shared ? shared.startTransition : localStartTransition;

	const navigate = useCallback(
		(updater: (params: URLSearchParams) => void) => {
			const params = new URLSearchParams(searchParams.toString());
			updater(params);
			params.delete("page");
			startTransition(() => {
				router.replace(`?${params.toString()}`, { scroll: false });
			});
		},
		[searchParams, router, startTransition]
	);

	const navigateWithPage = useCallback(
		(updater: (params: URLSearchParams) => void) => {
			const params = new URLSearchParams(searchParams.toString());
			updater(params);
			startTransition(() => {
				router.push(`?${params.toString()}`, { scroll: false });
			});
		},
		[searchParams, router, startTransition]
	);

	return { isPending, navigate, navigateWithPage, searchParams };
}
