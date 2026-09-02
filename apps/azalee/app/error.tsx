"use client";

import { AlertCircle, Home, RefreshCw } from "lucide-react";
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
		// Log the error to an error reporting service
		console.error(error);
	}, [error]);

	return (
		<div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center animate-in fade-in zoom-in-95 duration-500 space-y-8">
			<div className="relative">
				<div className="absolute inset-0 bg-error/20 blur-[60px] rounded-full" />
				<div className="relative rounded-full bg-error-container p-6 text-on-error-container shadow-elevation-3">
					<AlertCircle className="size-16" strokeWidth={1.5} />
				</div>
			</div>

			<div className="space-y-3 max-w-md z-10">
				<h2 className="text-3xl font-black font-sans tracking-tight text-on-surface">
					Une erreur critique est survenue
				</h2>
				<p className="text-on-surface-variant text-lg">
					Azalée a rencontré un problème inattendu. Nos équipes (enfin, le développeur) ont
					probablement été notifiées.
				</p>
				{process.env.NODE_ENV === "development" && (
					<p className="text-xs font-mono bg-surface-container-high p-2 rounded-md overflow-x-auto text-error">
						{error.message}
					</p>
				)}
			</div>

			<div className="flex flex-col sm:flex-row gap-4 z-10">
				<Button
					size="lg"
					onClick={() => reset()}
					className="rounded-full bg-primary text-on-primary hover:elevation-2 transition-all gap-2 min-w-[140px]"
				>
					<RefreshCw className="size-5" />
					Réessayer
				</Button>
				<Button
					size="lg"
					variant="secondary"
					onClick={() => (window.location.href = "/")}
					className="rounded-full bg-surface-container-high text-on-surface hover:bg-surface-container-highest transition-colors gap-2 min-w-[140px]"
				>
					<Home className="size-5" />
					Accueil
				</Button>
			</div>
		</div>
	);
}
