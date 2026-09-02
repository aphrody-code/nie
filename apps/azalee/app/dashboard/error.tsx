"use client";

import { AlertCircle } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@rosegriffon/ui";

export default function DashboardError({
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
		<div className="flex h-[50vh] flex-col items-center justify-center gap-4 text-center p-6">
			<div className="p-4 rounded-full bg-error/10 text-error mb-2">
				<AlertCircle className="size-8" />
			</div>
			<h2 className="text-2xl font-black font-sans uppercase tracking-tighter">
				Une erreur est survenue
			</h2>
			<p className="text-on-surface-variant max-w-md">
				Impossible de charger le tableau de bord. Veuillez réessayer ou contacter le support
				technique.
			</p>
			<Button
				onClick={() => reset()}
				className="mt-4 rounded-full px-8 bg-error text-on-error font-bold hover:bg-error/90"
			>
				Réessayer
			</Button>
		</div>
	);
}
