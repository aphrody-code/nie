"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@rosegriffon/ui";

export default function Error({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	useEffect(() => {
		console.error(error);
	}, [error]);

	return (
		<div className="min-h-screen flex items-center justify-center p-4 text-center">
			<div className="space-y-4">
				<h1 className="text-2xl font-bold">Une erreur est survenue</h1>
				<p className="text-on-surface-variant">
					Impossible de charger l&apos;article. Veuillez réessayer.
				</p>
				<div className="flex gap-4 justify-center">
					<Button onClick={() => reset()} variant="outline">
						Réessayer
					</Button>
					<Link href="/dashboard/news">
						<Button>Retour aux news</Button>
					</Link>
				</div>
			</div>
		</div>
	);
}
