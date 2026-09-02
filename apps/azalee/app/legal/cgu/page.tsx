import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
	alternates: { canonical: "/legal/cgu" },
	description: "Conditions générales d'utilisation du site Azalée et des services Rose Griffon.",
	title: "Conditions générales d'utilisation - Azalée",
};

export default function TermsOfServicePage() {
	return (
		<div className="w-full">
			<h1 className="type-display-medium font-bold mb-4 text-primary">
				Conditions Générales d&apos;Utilisation
			</h1>
			<p className="type-body-small text-on-surface-variant mb-8">
				Dernière mise à jour : 24 novembre 2025
			</p>

			<div className="prose prose-base md:prose-lg dark:prose-invert max-w-none space-y-8 text-on-surface">
				<section>
					<h2 className="type-headline-small font-semibold mb-4 text-secondary">
						1. Objet et Champ d&apos;Application
					</h2>
					<p>
						Les présentes Conditions Générales d&apos;Utilisation (ci-après « CGU ») régissent
						l&apos;accès et l&apos;utilisation du site web{" "}
						<Link href="https://rosegriffon.fr" className="text-primary hover:underline">
							rosegriffon.fr
						</Link>{" "}
						et de l&apos;ensemble des services associés fournis par l&apos;association Rose Griffon,
						association loi 1901 à but non lucratif.
					</p>
					<p>Nos services incluent notamment :</p>
					<ul className="list-disc pl-6 space-y-2">
						<li>Le site web et ses outils interactifs (générateurs d&apos;images, galeries)</li>
						<li>Le bot Discord &quot;Capitaine Gaëlle&quot;</li>
						<li>L&apos;organisation d&apos;événements et de tournois e-sport</li>
						<li>Les plateformes Achilléa (e-sport) et Azalée (média)</li>
					</ul>
				</section>

				<section>
					<h2 className="type-headline-small font-semibold mb-4 text-secondary">
						2. Acceptation des Conditions
					</h2>
					<p>
						En accédant à notre site web et en utilisant nos services, vous acceptez sans réserve
						les présentes CGU ainsi que notre{" "}
						<Link href="/legal/confidentialite" className="text-primary hover:underline">
							Politique de Confidentialité
						</Link>{" "}
						et notre{" "}
						<Link href="/charte" className="text-primary hover:underline">
							Charte d&apos;Engagements
						</Link>
						.
					</p>
					<p>
						Si vous n&apos;acceptez pas ces conditions, vous devez cesser immédiatement
						d&apos;utiliser nos services.
					</p>
				</section>

				{/* ... Copie du reste du contenu en adaptant les classes ... */}

				<section>
					<h2 className="type-headline-small font-semibold mb-4 text-secondary">
						3. Code de Conduite et Valeurs de l&apos;Association
					</h2>
					<h3 className="type-title-medium font-semibold mb-3">3.1. Respect et Inclusion</h3>
					<p>
						Conformément à notre{" "}
						<Link href="/charte" className="text-primary hover:underline">
							charte d&apos;engagements
						</Link>
						, Rose Griffon est une structure inclusive. Nous défendons activement le respect de
						toutes les identités (LGBTQIA+, croyances religieuses, origines, genres) et nous nous
						engageons à intervenir fermement contre tout comportement discriminatoire.
					</p>
					<p className="font-semibold mt-4">
						Sont strictement interdits et entraîneront une exclusion immédiate :
					</p>
					<ul className="list-disc pl-6 space-y-2">
						<li>Tout comportement toxique, harcèlement ou intimidation</li>
						<li>
							Propos discriminatoires (racisme, sexisme, homophobie, transphobie, validisme, etc.)
						</li>
						<li>Incitation à la haine ou à la violence</li>
						<li>Partage de contenu NSFW (Not Safe For Work) ou inapproprié</li>
						<li>Triche lors des tournois et compétitions</li>
					</ul>
				</section>

				<section>
					<h2 className="type-headline-small font-semibold mb-4 text-secondary">
						4. Propriété Intellectuelle
					</h2>
					<h3 className="type-title-medium font-semibold mb-3">4.1. Propriété de Rose Griffon</h3>
					<p>
						Le nom « Rose Griffon », nos logos, mascottes (Roy, Gaëlle) et tous les contenus
						originaux créés par l&apos;association sont la propriété exclusive de l&apos;association
						Rose Griffon et sont protégés par les lois françaises et internationales relatives au
						droit d&apos;auteur et à la propriété intellectuelle (Code de la propriété
						intellectuelle).
					</p>

					<h3 className="type-title-medium font-semibold mb-3 mt-6">4.2. Licence Inazuma Eleven</h3>
					<p>
						Inazuma Eleven est une marque déposée et une propriété de LEVEL-5 Inc. Rose Griffon est
						une association de fans indépendante et n&apos;est pas officiellement affiliée à
						LEVEL-5. Tous les contenus relatifs à la licence Inazuma Eleven restent la propriété de
						leurs ayants droit respectifs.
					</p>
				</section>

				<section>
					<h2 className="type-headline-small font-semibold mb-4 text-secondary">11. Contact</h2>
					<p>Pour toute question relative à ces conditions, vous pouvez nous contacter :</p>
					<ul className="list-disc pl-6 space-y-2">
						<li>
							Via notre serveur Discord officiel :{" "}
							<a
								href="https://discord.gg/8X8eQfBMkt"
								target="_blank"
								rel="noopener noreferrer"
								className="text-primary hover:underline"
							>
								discord.gg/8X8eQfBMkt
							</a>
						</li>
						<li>
							Via notre{" "}
							<Link href="/contact" className="text-primary hover:underline">
								formulaire de contact
							</Link>
						</li>
					</ul>
				</section>
			</div>
		</div>
	);
}
