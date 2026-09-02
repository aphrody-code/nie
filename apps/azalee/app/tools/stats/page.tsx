import type { Metadata } from "next";
import { StatCalculator } from "@/components/wiki/StatCalculator";

export const metadata: Metadata = {
	alternates: { canonical: "/tools/stats" },
	description:
		"Calculateur de statistiques Inazuma Eleven: Victory Road (Lv1→99) — tables de croissance réelles du jeu (moteur niers, byte-exact). Choisissez position, rareté et pattern de croissance.",
	openGraph: {
		description:
			"Simulez les statistiques d'un joueur du niveau 1 à 99 avec les vraies tables de croissance d'Inazuma Eleven: Victory Road.",
		locale: "fr_FR",
		siteName: "Azalée - Inazuma Eleven Victory Road",
		title: "Calculateur de statistiques | Azalée",
		type: "website",
		url: "/tools/stats",
	},
	title: "Calculateur de statistiques (Lv1→99) - Azalée",
};

export default function StatsToolPage() {
	return (
		<div className="w-full space-y-6">
			<header className="space-y-1">
				<h1 className="text-fluid-headline-md font-extrabold text-on-surface">
					Calculateur de statistiques
				</h1>
				<p className="text-sm text-on-surface-variant max-w-2xl">
					Simulez les 7 statistiques d'un joueur du niveau 1 à 99 avec les vraies tables de
					croissance d'Inazuma Eleven: Victory Road, calculées par le moteur niers (byte-exact,
					ancré sur le jeu) directement dans le navigateur.
				</p>
			</header>
			<StatCalculator />
		</div>
	);
}
