import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
	alternates: { canonical: "/legal/mentions-legales" },
	description: "Mentions légales du site Azalée par l'association Rose Griffon.",
	title: "Mentions légales - Azalée",
};

export default function MentionsLegalesPage() {
	return (
		<div className="w-full">
			<h1 className="type-display-medium font-bold mb-4 text-primary">Mentions Légales</h1>
			<p className="type-body-small text-on-surface-variant mb-8">
				Dernière mise à jour : 24 novembre 2025
			</p>

			<div className="prose prose-base md:prose-lg dark:prose-invert max-w-none space-y-8 text-on-surface">
				<section>
					<h2 className="type-headline-small font-semibold mb-4 text-secondary">
						1. Éditeur du Site
					</h2>
					<p>
						Le site{" "}
						<a href="https://rosegriffon.fr" className="text-primary hover:underline">
							rosegriffon.fr
						</a>{" "}
						est édité par l&apos;association <strong>Rose Griffon</strong>.
					</p>
					<ul className="list-disc pl-6 space-y-2 mt-4">
						<li>
							<strong>Statut juridique</strong> : Association à but non lucratif régie par la loi du
							1er juillet 1901 et le décret du 16 août 1901
						</li>
						<li>
							<strong>Siège social</strong> : France (adresse disponible sur demande via notre{" "}
							<Link href="/contact" className="text-primary hover:underline">
								formulaire de contact
							</Link>
							)
						</li>
						<li>
							<strong>Contact</strong> : Via notre{" "}
							<Link href="/contact" className="text-primary hover:underline">
								formulaire de contact
							</Link>{" "}
							ou notre{" "}
							<a
								href="https://discord.gg/8X8eQfBMkt"
								target="_blank"
								rel="noopener noreferrer"
								className="text-primary hover:underline"
							>
								serveur Discord officiel
							</a>
						</li>
					</ul>

					<h3 className="type-title-medium font-semibold mb-3 mt-6">Directeur de la publication</h3>
					<p>
						Le directeur de la publication est le représentant légal de l&apos;association Rose
						Griffon.
					</p>
				</section>

				<section>
					<h2 className="type-headline-small font-semibold mb-4 text-secondary">
						2. Hébergement du Site
					</h2>
					<p>
						Le site <strong>rosegriffon.fr</strong> est hébergé par :
					</p>
					<div className="mt-4 p-4 bg-surface-container rounded-lg">
						<p>
							<strong>Auto-hébergement</strong>
						</p>
						<p>Serveur dédié en France/Europe</p>
						<p>Infrastructure gérée par l&apos;équipe technique de Rose Griffon</p>
					</div>
				</section>

				<section>
					<h2 className="type-headline-small font-semibold mb-4 text-secondary">
						3. Propriété Intellectuelle
					</h2>
					<h3 className="type-title-medium font-semibold mb-3">3.3. Licence Inazuma Eleven</h3>
					<div className="p-4 bg-tertiary-container rounded-lg border border-tertiary">
						<p className="font-semibold text-on-tertiary-container">Disclaimer Important</p>
						<p className="mt-2 text-on-tertiary-container">
							<strong>Inazuma Eleven</strong> est une marque déposée et une propriété de{" "}
							<strong>LEVEL-5 Inc.</strong> (Japon).
						</p>
						<p className="mt-2 text-on-tertiary-container">
							Rose Griffon est une association de fans indépendante et{" "}
							<strong>n&apos;est pas officiellement affiliée</strong> à LEVEL-5 Inc. Nous ne
							prétendons à aucun droit sur la propriété intellectuelle de LEVEL-5.
						</p>
					</div>
				</section>
			</div>
		</div>
	);
}
