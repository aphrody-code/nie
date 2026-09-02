"use client";

import { ArrowLeft, Frown, Home } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@rosegriffon/ui";

export default function NotFound() {
	const router = useRouter();

	return (
		<div className="flex flex-col items-center justify-center min-h-[80vh] px-6 text-center space-y-8 animate-in fade-in zoom-in-95 duration-500">
			<div className="relative">
				<div className="absolute inset-0 bg-primary/20 blur-[100px] rounded-full animate-pulse" />
				<Frown className="relative text-primary/80 drop-shadow-lg" size={120} aria-hidden="true" />
			</div>

			<div className="space-y-4 max-w-lg z-10">
				<h1 className="text-4xl sm:text-6xl font-black font-sans tracking-tight text-on-surface">
					404
				</h1>
				<h2 className="text-xl sm:text-2xl font-bold text-on-surface-variant">Page introuvable</h2>
				<p className="text-on-surface-variant/80 text-lg leading-relaxed">
					Oups ! Il semblerait que vous ayez dribblé un peu trop loin. Cette page n&apos;existe pas
					ou a été déplacée.
				</p>
			</div>

			<div className="flex flex-col sm:flex-row gap-4 z-10">
				<Button
					variant="outline"
					size="lg"
					onClick={() => router.back()}
					className="rounded-full border-outline-variant hover:bg-surface-container-high transition-all gap-2"
				>
					<ArrowLeft className="size-5" />
					Retour
				</Button>

				<Button
					asChild
					size="lg"
					className="rounded-full bg-primary text-on-primary hover:elevation-2 transition-all gap-2"
				>
					<Link href="/">
						<Home className="size-5" />
						Accueil
					</Link>
				</Button>
			</div>
		</div>
	);
}
