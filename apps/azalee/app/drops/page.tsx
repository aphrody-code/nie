export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { DropsExplorer } from "@/app/drops/DropsExplorer";
import { getDropsData } from "@/lib/wiki/drops";

export const metadata: Metadata = {
	alternates: { canonical: "/drops" },
	description:
		"Taux de drop d'objets dans Inazuma Eleven: Victory Road : coffres de victoire, émissions, paliers de rareté des esprits et bonus de Fèves d'équipe. Probabilités réelles et liens vers les objets.",
	title: "Drops & Taux | Inazuma Eleven Victory Road - Azalée",
};

export default async function DropsPage() {
	const data = await getDropsData();
	const { counts } = data;

	return (
		<div className="space-y-6">
			<header className="space-y-2">
				<h1 className="text-fluid-headline-lg font-extrabold text-on-surface">Drops &amp; Taux</h1>
				<p className="text-on-surface-variant max-w-2xl">
					Où et avec quelle probabilité obtenir chaque objet : coffres de victoire, émissions
					d'objets, tables de rareté des esprits, et bonus passifs de Fèves d'équipe.
				</p>
			</header>

			<dl className="grid grid-cols-2 sm:grid-cols-4 gap-3">
				<Stat label="Drops d'objets" value={counts.concreteDrops} />
				<Stat label="Sources" value={counts.dropSources} />
				<Stat label="Tables d'esprit" value={counts.spiritGroups} />
				<Stat label="Fèves d'équipe" value={counts.beans} />
			</dl>

			<DropsExplorer data={data} />
		</div>
	);
}

function Stat({ label, value }: { label: string; value: number }) {
	return (
		<div className="rounded-2xl border border-outline-variant/30 bg-surface-container-low p-4">
			<dd className="text-2xl font-extrabold text-on-surface tabular-nums">
				{value.toLocaleString("fr-FR")}
			</dd>
			<dt className="text-xs font-medium text-on-surface-variant uppercase tracking-wider mt-1">
				{label}
			</dt>
		</div>
	);
}
