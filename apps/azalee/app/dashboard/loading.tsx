import { Skeleton } from "@rosegriffon/ui";

export default function DashboardLoading() {
	return (
		<div className="space-y-6 sm:space-y-8">
			{/* Header skeleton */}
			<div className="space-y-3">
				<div className="flex items-center gap-4">
					<Skeleton className="size-10 sm:size-12 rounded-[16px] bg-surface-container-highest" />
					<div className="space-y-2">
						<Skeleton className="h-7 w-40 rounded-lg bg-surface-container-highest" />
						<Skeleton className="h-4 w-28 rounded-md bg-surface-container-highest" />
					</div>
				</div>
			</div>

			{/* Metrics row skeleton */}
			<div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-4">
				{[1, 2, 3, 4].map((i) => (
					<div
						key={i}
						className="flex items-center gap-4 p-4 sm:p-5 rounded-[24px] bg-surface-container-low border border-outline-variant/20"
					>
						<Skeleton className="size-12 sm:size-14 rounded-[16px] bg-surface-container-highest shrink-0" />
						<div className="space-y-2 flex-1">
							<Skeleton className="h-3 w-16 rounded bg-surface-container-highest" />
							<Skeleton className="h-7 w-12 rounded bg-surface-container-highest" />
						</div>
					</div>
				))}
			</div>

			{/* Recent activity skeleton */}
			<div className="space-y-4">
				<Skeleton className="h-5 w-32 rounded bg-surface-container-highest" />
				<div className="rounded-[24px] bg-surface-container-low border border-outline-variant/20 overflow-hidden divide-y divide-outline-variant/10">
					{[1, 2, 3, 4, 5].map((i) => (
						<div key={i} className="flex items-center gap-4 p-4">
							<Skeleton className="size-10 rounded-xl bg-surface-container-highest shrink-0" />
							<div className="space-y-2 flex-1">
								<Skeleton className="h-4 w-48 rounded bg-surface-container-highest" />
								<Skeleton className="h-3 w-32 rounded bg-surface-container-highest" />
							</div>
						</div>
					))}
				</div>
			</div>

			{/* Quick links skeleton */}
			<div className="space-y-4">
				<Skeleton className="h-5 w-28 rounded bg-surface-container-highest" />
				<div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
					{[1, 2, 3, 4, 5, 6].map((i) => (
						<div
							key={i}
							className="flex items-center gap-4 p-4 sm:p-5 rounded-[24px] bg-surface-container-low border border-outline-variant/20"
						>
							<Skeleton className="size-12 rounded-[16px] bg-surface-container-highest shrink-0" />
							<div className="space-y-2 flex-1">
								<Skeleton className="h-4 w-24 rounded bg-surface-container-highest" />
								<Skeleton className="h-3 w-36 rounded bg-surface-container-highest" />
							</div>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
