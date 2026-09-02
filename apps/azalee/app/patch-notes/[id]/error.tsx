"use client";

import { AlertCircle, ArrowLeft, RefreshCw } from "lucide-react";
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
		<div className="flex flex-col items-center justify-center min-h-[50vh] p-6 text-center space-y-6">
			<div className="rounded-full bg-error-container p-5 text-on-error-container">
				<AlertCircle className="size-10" strokeWidth={1.5} />
			</div>
			<div className="space-y-2 max-w-md">
				<h2 className="text-2xl font-black font-sans text-on-surface">
					Impossible de charger ce patch note
				</h2>
				<p className="text-on-surface-variant">
					Une erreur est survenue lors du chargement des données.
				</p>
			</div>
			<div className="flex gap-3">
				<Button onClick={() => reset()} variant="outline" className="rounded-full gap-2">
					<RefreshCw className="size-4" />
					Réessayer
				</Button>
				<Button asChild className="rounded-full gap-2">
					<Link href="/patch-notes">
						<ArrowLeft className="size-4" />
						Retour aux patch notes
					</Link>
				</Button>
			</div>
		</div>
	);
}
