import { AchilleaBanner } from "@/components/home/AchilleaBanner";
import { RgtvBanner } from "@/components/home/RgtvBanner";

/**
 * Section « réseau Rose Griffon » de la home Azalée.
 *
 * Azalée est le wiki du réseau Rose Griffon : cette section présente l'association
 * (site principal) et le pôle compétitif Achilléa, pour qu'un visiteur du wiki
 * découvre l'écosystème. Aligné sur le pattern de la home website (bannières
 * Rose Griffon / Azalée / Achilléa) et sur les en-têtes de section de la home
 * (barre colorée + titre `font-expressive-title`).
 */
export function NetworkSection() {
	return (
		<section className="w-full md:px-8 lg:px-12" aria-labelledby="network-heading">
			<div className="mb-5 md:mb-6">
				<h2
					id="network-heading"
					className="text-xl md:text-3xl font-black text-on-surface font-expressive-title flex items-center gap-3"
				>
					<span className="w-2 h-8 rounded-full bg-primary" />
					Le réseau Rose Griffon
				</h2>
				<p className="mt-2 text-sm md:text-base text-on-surface-variant max-w-2xl">
					Azalée fait partie de Rose Griffon, l'association de la communauté Inazuma Eleven en
					France. Découvrez le site de l'association et Achilléa, son pôle compétitif (clans,
					tournois et matchs classés).
				</p>
			</div>

			<div className="space-y-6 md:space-y-8">
				<RgtvBanner />
				<AchilleaBanner />
			</div>
		</section>
	);
}
