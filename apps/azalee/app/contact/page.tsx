import type { Metadata } from "next";

export const metadata: Metadata = {
	alternates: { canonical: "/contact" },
	description: "Contactez l'équipe Rose Griffon par email ou via notre serveur Discord.",
	title: "Contact - Azalée",
};

export const revalidate = 86_400;

export default function ContactPage() {
	return (
		<div className="w-full">
			<h1 className="type-display-medium font-bold mb-4 text-primary">Nous Contacter</h1>
			<p className="type-body-large text-on-surface-variant mb-8">
				Vous avez une question, une suggestion ou souhaitez collaborer avec nous ?
			</p>

			<div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-8">
				<div className="bg-surface-container rounded-xl p-5 md:p-8 shadow-sm">
					<h2 className="type-headline-small font-bold mb-4 text-secondary">Par Email</h2>
					<p className="mb-4 text-on-surface-variant">
						Pour les demandes formelles, partenariats ou questions spécifiques :
					</p>
					<a
						href="mailto:contact@rose-griffon.fr"
						className="text-primary font-bold text-xl hover:underline"
					>
						contact@rose-griffon.fr
					</a>
				</div>

				<div className="bg-surface-container rounded-xl p-5 md:p-8 shadow-sm">
					<h2 className="type-headline-small font-bold mb-4 text-tertiary">Sur Discord</h2>
					<p className="mb-4 text-on-surface-variant">
						Pour échanger avec la communauté, obtenir de l&apos;aide rapide ou contacter le staff :
					</p>
					<a
						href="https://discord.gg/8X8eQfBMkt"
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex items-center justify-center px-6 py-3 bg-[#5865F2] text-white rounded-full font-bold hover:brightness-110 transition-all"
					>
						Rejoindre le serveur
					</a>
				</div>
			</div>
		</div>
	);
}
