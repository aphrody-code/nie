import type { Metadata } from "next";
import { Card, CardContent, CardHeader, CardTitle } from "@rosegriffon/ui";

export const metadata: Metadata = {
	alternates: { canonical: "/charte" },
	description:
		"Les valeurs et engagements de Rose Griffon : crédit, transparence, inclusion et respect.",
	title: "Charte d'engagements - Azalée",
};

export default function CharteEngagementsPage() {
	return (
		<div className="w-full">
			<h1 className="type-display-medium font-bold mb-6 text-primary">Charte d&apos;engagements</h1>

			<div className="prose prose-base md:prose-lg dark:prose-invert max-w-none mb-12">
				<h2 className="type-headline-small font-bold mb-4 text-on-surface">
					Rose Griffon, Achilléa et Azalée s&apos;engagent à respecter et promouvoir les valeurs
					suivantes dans toutes leurs activités et productions.
				</h2>

				<div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
					{/* Crédit systématique */}
					<Card className="border-l-8 border-l-primary bg-surface-container-low shadow-sm">
						<CardHeader>
							<CardTitle className="flex items-center justify-between type-title-large">
								Crédit systématique des productions
							</CardTitle>
						</CardHeader>
						<CardContent>
							<p className="type-body-large text-on-surface-variant">
								Nous nous engageons à créditer toutes les personnes ayant contribué à nos projets :
								artistes, développeurs, compositeurs, organisateurs, etc. Chaque travail mérite
								d&apos;être reconnu.
							</p>
						</CardContent>
					</Card>

					{/* Transparence */}
					<Card className="border-l-8 border-l-tertiary bg-surface-container-low shadow-sm">
						<CardHeader>
							<CardTitle className="flex items-center justify-between type-title-large">
								Transparence sur nos actions
							</CardTitle>
						</CardHeader>
						<CardContent>
							<p className="type-body-large text-on-surface-variant">
								Chaque projet, chaque action menée est justifiée, expliquée et rendue publique. Nous
								nous engageons à toujours expliciter nos intentions et décisions de manière claire
								et accessible.
							</p>
						</CardContent>
					</Card>

					{/* Refus de l'IA */}
					<Card className="border-l-8 border-l-warning bg-surface-container-low shadow-sm">
						<CardHeader>
							<CardTitle className="flex items-center justify-between type-title-large">
								Refus de l&apos;IA générative comme substitut à la création humaine
							</CardTitle>
						</CardHeader>
						<CardContent>
							<p className="type-body-large text-on-surface-variant">
								Rose Griffon privilégie la création humaine. Nous nous engageons à limiter
								drastiquement l&apos;utilisation d&apos;IA générative (visuelle, sonore, textuelle)
								dans nos productions pour garantir l&apos;authenticité, la qualité et l&apos;éthique
								du travail fourni.
							</p>
						</CardContent>
					</Card>

					{/* Respect et tolérance */}
					<Card className="border-l-8 border-l-secondary bg-surface-container-low shadow-sm">
						<CardHeader>
							<CardTitle className="flex items-center justify-between type-title-large">
								Respect et tolérance inconditionnels
							</CardTitle>
						</CardHeader>
						<CardContent>
							<p className="type-body-large text-on-surface-variant">
								Rose Griffon est une structure inclusive. Nous défendons activement le respect de
								toutes les identités (LGBTQIA+, croyances religieuses, origines, genres) et nous
								nous engageons à intervenir fermement contre tout comportement discriminatoire.
							</p>
						</CardContent>
					</Card>

					{/* Finalité commune */}
					<Card className="border-l-8 border-l-error bg-surface-container-low shadow-sm">
						<CardHeader>
							<CardTitle className="flex items-center justify-between type-title-large">
								Une finalité commune : faire grandir la communauté Inazuma Eleven
							</CardTitle>
						</CardHeader>
						<CardContent>
							<p className="type-body-large text-on-surface-variant">
								Tous nos projets - qu&apos;ils soient bénévoles ou rémunérateurs - ont un seul but :
								soutenir, rassembler et faire prospérer la communauté Inazuma Eleven. Même nos
								revenus sont réinvestis pour développer la scène, financer des projets et faire
								émerger de nouveaux talents.
							</p>
						</CardContent>
					</Card>
				</div>
			</div>

			{/* Section Partenariats */}
			<div className="prose prose-base md:prose-lg dark:prose-invert max-w-none mb-12">
				<h2 className="type-headline-medium font-bold mb-6 text-primary">
					Partenariat avec l&apos;ensemble des projets Rose Griffon
				</h2>
				<p className="mb-4 type-body-large font-bold text-on-surface">
					(Rose Griffon, Achilléa, Azalée).
				</p>

				<Card className="border-l-8 border-l-error bg-surface-container-low shadow-sm">
					<CardHeader>
						<CardTitle className="type-title-large font-bold">
							Les partenariats ne seront pas acceptés avec des projets qui :
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="flex flex-col space-y-6">
							<div className="flex items-start gap-3">
								<div className="min-size-6 rounded-full bg-error flex items-center justify-center text-on-error font-bold text-sm">
									1
								</div>
								<p className="type-body-large text-on-surface-variant">
									Tolèrent un salon <span className="font-bold text-error">NSFW</span> ou
									équivalent.
								</p>
							</div>

							<div className="flex items-start gap-3">
								<div className="min-size-6 rounded-full bg-error flex items-center justify-center text-on-error font-bold text-sm">
									2
								</div>
								<p className="type-body-large text-on-surface-variant">
									Ont une <span className="font-bold text-error">modération laxiste</span> face aux{" "}
									<span className="font-bold text-error">discriminations</span>,{" "}
									<span className="font-bold text-error">agressions</span> ou autres cas d&apos;
									<span className="font-bold text-error">abus</span>.
								</p>
							</div>

							<div className="flex items-start gap-3">
								<div className="min-size-6 rounded-full bg-error flex items-center justify-center text-on-error font-bold text-sm">
									3
								</div>
								<p className="type-body-large text-on-surface-variant">
									Utilisent des outils liés à des personnes reconnues comme{" "}
									<span className="font-bold text-error">nuisibles</span> pour certaines{" "}
									<span className="font-bold text-error">communautés</span>.
								</p>
							</div>

							<div className="flex items-start gap-3">
								<div className="min-size-6 rounded-full bg-error flex items-center justify-center text-on-error font-bold text-sm">
									4
								</div>
								<p className="type-body-large text-on-surface-variant">
									Dépendent fortement d&apos;
									<span className="font-bold text-error">IA générative artistique</span>.
								</p>
							</div>
						</div>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
