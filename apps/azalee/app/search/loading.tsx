import { Skeleton } from "@rosegriffon/ui";

export default function Loading() {
	return (
		<div className="space-y-6">
			{/* Search bar skeleton */}
			<Skeleton className="h-12 w-full rounded-full bg-surface-container-highest" />

			{/* Quick links skeleton */}
			<div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
				{Array.from({ length: 6 }).map((_, i) => (
					<Skeleton key={i} className="h-12 rounded-xl bg-surface-container-highest" />
				))}
			</div>
		</div>
	);
}
