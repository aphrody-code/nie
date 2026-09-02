export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { NiveauExplorer } from "@/app/niveau/NiveauExplorer";
import { formatExp } from "@/lib/wiki/exp-table-shared";
import { getExpTable } from "@/lib/wiki/exp-table";

/**
 * Image de partage de convention (`app/opengraph-image.png`, 1200×630).
 * Déclarer un bloc `openGraph` sans `images` n'hérite PAS de celle du layout :
 * Next fusionne les métadonnées de façon superficielle, l'objet enfant remplace
 * le parent en entier. Sans cette entrée, la page ne livrait aucune `og:image`.
 */
const OG_PAR_DEFAUT = {
	url: "/opengraph-image.png",
	width: 1200,
	height: 630,
	alt: "Azalée — wiki Inazuma Eleven: Victory Road",
};

export const metadata: Metadata = {
	alternates: { canonical: "/niveau" },
	description:
		"Table d'expérience d'Inazuma Eleven: Victory Road : courbe d'EXP, coût de chaque palier de niveau, calculateur « du niveau X au niveau Y » et recherche inverse « j'ai tant d'EXP, je suis niveau ? ». Valeurs brutes extraites du jeu.",
	openGraph: {
		description:
			"Courbe d'expérience, coût de chaque palier et calculateurs de niveau pour Inazuma Eleven: Victory Road.",
		images: [OG_PAR_DEFAUT],
		locale: "fr_FR",
		siteName: "Azalée - Inazuma Eleven Victory Road",
		title: "Niveaux & Expérience | Azalée",
		type: "website",
		url: "/niveau",
	},
	title: "Niveaux & Expérience | Inazuma Eleven Victory Road - Azalée",
	// `site`/`creator` sont recopiés : un bloc `twitter` local efface celui du layout.
	twitter: {
		card: "summary_large_image",
		creator: "@Azalee_IE",
		description:
			"Courbe d'expérience, coût de chaque palier et calculateurs de niveau pour Inazuma Eleven: Victory Road.",
		images: [OG_PAR_DEFAUT.url],
		site: "@Azalee_IE",
		title: "Niveaux & Expérience | Azalée",
	},
};

export default async function NiveauPage() {
	const data = await getExpTable();

	return (
		<div className="w-full space-y-6">
			<header className="space-y-2">
				<h1 className="text-fluid-headline-lg font-extrabold text-on-surface">
					Niveaux &amp; Expérience
				</h1>
				<p className="max-w-2xl text-on-surface-variant">
					Combien d'expérience faut-il pour monter un joueur d'un niveau à l'autre ? Cette page
					expose la table d'expérience du jeu telle qu'elle est extraite, sans lissage ni
					formule reconstituée.
				</p>
			</header>

			{data.entries.length > 0 && (
				<dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
					<Chiffre label="Paliers en base" valeur={String(data.entries.length)} />
					<Chiffre label="Niveau maximum" valeur={String(data.maxLevel)} />
					<Chiffre
						label={`EXP totale Lv${data.minLevel} → Lv${data.maxLevel}`}
						valeur={formatExp(data.totalExp)}
					/>
					<Chiffre
						label="Palier le plus cher"
						valeur={formatExp(Math.max(...data.entries.map((e) => e.needExp)))}
					/>
				</dl>
			)}

			<NiveauExplorer data={data} />

			<section className="rounded-2xl border border-outline-variant/20 bg-surface-container-low p-4 text-sm text-on-surface-variant sm:p-5">
				<h2 className="mb-2 text-sm font-bold text-on-surface">D'où viennent ces chiffres</h2>
				<p>
					Source : la table <code className="text-on-surface">inagle_exp_table</code>, extraite du
					fichier de configuration <code className="text-on-surface">chara_exp_table_config</code>{" "}
					du jeu. Chaque ligne donne l'expérience nécessaire pour passer d'un niveau au niveau
					suivant ; les cumuls affichés ici sont la somme des paliers précédents, exactement comme
					le calcule le moteur de données du projet.
				</p>
				{data.entries.length > 0 && (
					<p className="mt-2">
						La ligne du niveau {data.maxLevel} porte bien une valeur en base
						{" "}({formatExp(data.entries[data.entries.length - 1]?.needExp ?? 0)} EXP), mais comme
						il n'existe pas de niveau {data.maxLevel + 1} elle ne finance aucun passage : elle est
						affichée telle quelle dans le tableau et exclue de tous les cumuls.
					</p>
				)}
				<p className="mt-2">
					La table ne contient que le niveau et son coût : aucun bonus de rareté, aucune courbe
					alternative n'y figure. Rien de tel n'est donc affiché ici.
				</p>
			</section>
		</div>
	);
}

/** Chiffre-clé de l'en-tête (même habillage que les compteurs de `/drops`). */
function Chiffre({ label, valeur }: { label: string; valeur: string }) {
	return (
		<div className="rounded-2xl border border-outline-variant/20 bg-surface-container p-3">
			<dt className="text-xs text-on-surface-variant">{label}</dt>
			<dd className="text-lg font-bold tabular-nums text-on-surface">{valeur}</dd>
		</div>
	);
}
