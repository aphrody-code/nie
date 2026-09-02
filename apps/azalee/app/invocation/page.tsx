export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getInvocationRates } from "@/lib/wiki/invocation";

export const metadata: Metadata = {
	alternates: { canonical: "/invocation" },
	description:
		"Taux d'invocation réels de l'Univers des Joueurs (Players Universe) d'Inazuma Eleven: Victory Road — probabilités par palier de rareté et par personnage pour chaque constellation, décodées depuis les données du jeu.",
	title: "Taux d'invocation — Univers des Joueurs | Azalée",
};

const TIER_COLORS: Record<number, string> = {
	2: "text-amber-500",
	1: "text-violet-400",
	0: "text-on-surface-variant",
};

function pct(n: number): string {
	if (n <= 0) return "0 %";
	if (n < 0.01) return `${n.toFixed(4)} %`;
	if (n < 1) return `${n.toFixed(2)} %`;
	return `${n.toFixed(1)} %`;
}

export default async function InvocationPage() {
	const signs = await getInvocationRates();

	return (
		<div className="w-full space-y-6">
			<div>
				<h1 className="type-headline-small text-on-surface">Taux d'invocation — Univers des Joueurs</h1>
				<p className="type-body-medium text-on-surface-variant mt-1 max-w-3xl">
					Probabilités réelles de tirage par constellation, décodées en direct depuis la
					gamedata du jeu (<code className="font-mono text-xs">players_universe_config</code>).
					Chaque tirage donne un palier de rareté ; au sein d'un palier, chaque personnage est
					équiprobable.
				</p>
			</div>

			{signs.length === 0 ? (
				<p className="type-body-medium text-on-surface-variant py-8 text-center">
					Taux indisponibles pour le moment (décodage des données du jeu).
				</p>
			) : (
				<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
					{signs.map((s) => (
						<div
							key={s.signNo}
							className="rounded-2xl border border-outline-variant/20 bg-surface-container p-4 space-y-3"
						>
							<div className="flex items-baseline justify-between gap-2">
								<h2 className="type-title-medium text-on-surface truncate">{s.name}</h2>
								<span className="type-label-small text-on-surface-variant/60 font-mono shrink-0">
									#{s.signNo} · {s.totalChars} persos
								</span>
							</div>
							<ul className="space-y-2">
								{s.tiers.map((t) => (
									<li
										key={t.rarityType}
										className="flex items-center justify-between gap-3 rounded-xl bg-surface-container-low px-3 py-2"
									>
										<div className="min-w-0">
											<p className={`type-label-large font-bold ${TIER_COLORS[t.rarityType] ?? ""}`}>
												{t.label}
											</p>
											<p className="type-body-small text-on-surface-variant/70">
												{t.count} {t.count > 1 ? "personnages" : "personnage"} · {pct(t.perCharPct)}{" "}
												chacun
											</p>
										</div>
										<span className="type-title-small text-on-surface font-mono shrink-0">
											{pct(t.ratePct)}
										</span>
									</li>
								))}
							</ul>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
