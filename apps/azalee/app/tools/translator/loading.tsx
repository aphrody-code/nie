import { Skeleton } from "@rosegriffon/ui";

export default function TranslatorLoading() {
	return (
		<div className="w-full space-y-5 sm:space-y-6">
			<div>
				<Skeleton className="h-9 w-48" />
				<Skeleton className="h-4 w-80 mt-2" />
			</div>
			<Skeleton className="h-12 w-full max-w-2xl rounded-2xl" />
			<div className="flex gap-2">
				{[...Array(6)].map((_, i) => (
					<Skeleton key={i} className="h-8 w-20 rounded-full" />
				))}
			</div>
			<div className="space-y-2">
				{[...Array(5)].map((_, i) => (
					<Skeleton key={i} className="h-24 w-full rounded-2xl" />
				))}
			</div>
		</div>
	);
}
