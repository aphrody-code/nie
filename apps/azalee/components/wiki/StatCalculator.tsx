"use client";

/**
 * Calculateur de statistiques (Lv1→99) — câble le **moteur de croissance niers** (`nie-core`)
 * exposé en wasm (`lib/nie-engine.ts::calculateStats/statCurve`), tables byte-exact ancrées sur
 * nie.exe. L'utilisateur choisit position / rareté / pattern de croissance ; on affiche les 7 stats
 * au niveau choisi + la courbe du total sur 1→99 (breakpoints Lv30/50/99). Intégration « niers → azalee ».
 *
 * Pourquoi un calculateur (et pas l'auto-calcul par perso) : la donnée `growth_pattern` par
 * personnage n'est pas (encore) exportée dans azalee — voir le gap data niers. En attendant, le
 * calculateur expose le moteur tel quel.
 */
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { calculateStats, statCurve, type GrowthParams, type StatBlock } from "@/lib/nie-engine";

/** Ordre + libellés FR des 7 stats (clés wasm kc/cr/tc/pr/ps/ag/it). */
const STATS: ReadonlyArray<{ k: keyof StatBlock; fr: string }> = [
	{ fr: "Frappe", k: "kc" },
	{ fr: "Contrôle", k: "cr" },
	{ fr: "Technique", k: "tc" },
	{ fr: "Pression", k: "pr" },
	{ fr: "Physique", k: "ps" },
	{ fr: "Agilité", k: "ag" },
	{ fr: "Intelligence", k: "it" },
];

const POSITIONS = [
	{ code: 1, label: "Gardien (GK)" },
	{ code: 2, label: "Défenseur (DF)" },
	{ code: 3, label: "Milieu (MF)" },
	{ code: 4, label: "Attaquant (FW)" },
];

const RARITIES = [
	{ code: 0, label: "N" },
	{ code: 2, label: "R" },
	{ code: 3, label: "SR" },
	{ code: 4, label: "SSR" },
	{ code: 5, label: "UR" },
	{ code: 6, label: "LR" },
	{ code: 7, label: "Légende" },
	{ code: 20, label: "BASARA" },
];

const GROWTH_PATTERNS = [0, 1, 2, 3];

/** Sélecteur pilule (segmented) générique. */
function Seg<T extends number>({
	value,
	options,
	onChange,
}: {
	value: T;
	options: ReadonlyArray<{ code: T; label: string }>;
	onChange: (v: T) => void;
}) {
	return (
		<div className="flex flex-wrap gap-1.5">
			{options.map((o) => (
				<button
					key={o.code}
					type="button"
					onClick={() => onChange(o.code)}
					className={`h-9 px-3 rounded-full text-sm transition-colors ${
						value === o.code
							? "bg-primary text-on-primary"
							: "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
					}`}
				>
					{o.label}
				</button>
			))}
		</div>
	);
}

export function StatCalculator() {
	const [mainPosition, setMainPosition] = useState(4);
	const [charaRank, setCharaRank] = useState(7);
	const [growthPattern, setGrowthPattern] = useState(0);
	const [level, setLevel] = useState(99);
	const [block, setBlock] = useState<StatBlock | null>(null);
	const [total, setTotal] = useState(0);
	const [curve, setCurve] = useState<number[]>([]);
	const [error, setError] = useState(false);

	const params = useMemo<GrowthParams>(
		() => ({ charaRank, growthPattern, mainPosition, playStyle: 0, subPosition: 0 }),
		[charaRank, growthPattern, mainPosition],
	);

	// Stats au niveau courant.
	useEffect(() => {
		let on = true;
		setError(false);
		calculateStats(params, level)
			.then((r) => {
				if (!on) return;
				setBlock(r.stats);
				setTotal(r.total);
			})
			.catch(() => on && setError(true));
		return () => {
			on = false;
		};
	}, [params, level]);

	// Courbe du total sur 1→99 (recalculée quand les paramètres changent, pas le niveau).
	useEffect(() => {
		let on = true;
		statCurve(params, 1, 99)
			.then((rows) => on && setCurve(rows.map((r) => r.total)))
			.catch(() => on && setCurve([]));
		return () => {
			on = false;
		};
	}, [params]);

	const maxStat = 350; // échelle d'affichage des barres (les stats UR/LR plafonnent ~250-300)

	return (
		<div className="space-y-6">
			{/* Paramètres */}
			<div className="rounded-2xl border border-outline-variant/20 bg-surface-container-low/40 p-4 sm:p-5 space-y-4">
				<div className="space-y-1.5">
					<p className="text-xs font-medium text-on-surface-variant uppercase tracking-wider">Position</p>
					<Seg value={mainPosition} options={POSITIONS} onChange={setMainPosition} />
				</div>
				<div className="space-y-1.5">
					<p className="text-xs font-medium text-on-surface-variant uppercase tracking-wider">Rareté</p>
					<Seg value={charaRank} options={RARITIES} onChange={setCharaRank} />
				</div>
				<div className="space-y-1.5">
					<p className="text-xs font-medium text-on-surface-variant uppercase tracking-wider">
						Pattern de croissance
					</p>
					<Seg
						value={growthPattern}
						options={GROWTH_PATTERNS.map((p) => ({ code: p, label: `Type ${p}` }))}
						onChange={setGrowthPattern}
					/>
				</div>
				<div className="space-y-1.5">
					<div className="flex items-center justify-between">
						<p className="text-xs font-medium text-on-surface-variant uppercase tracking-wider">
							Niveau
						</p>
						<span className="text-sm font-bold text-primary tabular-nums">Lv {level}</span>
					</div>
					<input
						type="range"
						min={1}
						max={99}
						value={level}
						onChange={(e) => setLevel(Number(e.target.value))}
						className="w-full accent-primary"
					/>
				</div>
			</div>

			{error ? (
				<p className="p-6 text-center text-sm text-on-surface-variant">
					Moteur de stats indisponible (wasm).
				</p>
			) : (
				<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
					{/* 7 stats au niveau choisi */}
					<div className="rounded-2xl border border-outline-variant/20 bg-surface-container p-4 sm:p-5">
						<div className="flex items-center justify-between mb-3">
							<h2 className="text-sm font-bold text-on-surface">Statistiques · Lv {level}</h2>
							<span className="text-sm text-on-surface-variant">
								Total <span className="font-bold text-primary tabular-nums">{total}</span>
							</span>
						</div>
						<div className="space-y-2">
							{STATS.map((s) => {
								const v = block?.[s.k] ?? 0;
								return (
									<div key={s.k} className="flex items-center gap-3">
										<span className="w-24 shrink-0 text-xs text-on-surface-variant">{s.fr}</span>
										<div className="flex-1 h-2.5 rounded-full bg-surface-container-highest overflow-hidden">
											<div
												className="h-full rounded-full bg-primary transition-all"
												style={{ width: `${Math.min(100, (v / maxStat) * 100)}%` }}
											/>
										</div>
										<span className="w-10 shrink-0 text-right text-sm font-medium text-on-surface tabular-nums">
											{v}
										</span>
									</div>
								);
							})}
						</div>
					</div>

					{/* Courbe du total Lv1→99 */}
					<div className="rounded-2xl border border-outline-variant/20 bg-surface-container p-4 sm:p-5">
						<h2 className="text-sm font-bold text-on-surface mb-3">Courbe du total (Lv1→99)</h2>
						<TotalCurve curve={curve} level={level} />
						<p className="mt-2 text-[11px] text-on-surface-variant/70 flex items-center gap-1">
							<Icon name="bolt" size={12} className="text-primary" /> Tables de croissance réelles du
							jeu (moteur niers, byte-exact).
						</p>
					</div>
				</div>
			)}
		</div>
	);
}

/** Petit graphe SVG de la courbe du total + marqueur du niveau courant. */
function TotalCurve({ curve, level }: { curve: number[]; level: number }) {
	if (curve.length < 2) {
		return <div className="h-40 flex items-center justify-center text-xs text-on-surface-variant/60">…</div>;
	}
	const W = 320;
	const H = 140;
	const min = Math.min(...curve);
	const max = Math.max(...curve);
	const span = Math.max(1, max - min);
	const pts = curve
		.map((v, i) => {
			const x = (i / (curve.length - 1)) * W;
			const y = H - ((v - min) / span) * H;
			return `${x.toFixed(1)},${y.toFixed(1)}`;
		})
		.join(" ");
	const cx = ((level - 1) / (curve.length - 1)) * W;
	const cv = curve[level - 1] ?? max;
	const cy = H - ((cv - min) / span) * H;
	return (
		<svg viewBox={`0 0 ${W} ${H}`} className="w-full h-40" preserveAspectRatio="none" role="img" aria-label="Courbe du total des stats">
			<polyline points={pts} fill="none" stroke="currentColor" strokeWidth={2} className="text-primary" />
			<line x1={cx} y1={0} x2={cx} y2={H} stroke="currentColor" strokeWidth={1} className="text-on-surface-variant/30" />
			<circle cx={cx} cy={cy} r={3.5} className="fill-primary" />
		</svg>
	);
}
