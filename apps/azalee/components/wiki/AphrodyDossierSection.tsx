"use client";

/**
 * Complete **Aphrody** dossier (Byron Love / 亜風炉 照美 アフロディ).
 * The dossier is served by the embedded Rust `nie-aphrody` owner through the
 * local `/api/nie/aphrody` transport route.
 *
 * The Rust dossier joins native character, skill and aura resources across the
 * three Aphrody series, including golden stats, cut-ins, and aura records.
 */
import { useEffect, useState } from "react";
import { cpkAssetUrl } from "@rosegriffon/azalee/cpk/shared";
import { Icon } from "@/components/ui/Icon";

const ELEMENT: Record<number, string> = {
	0: "Neutre",
	1: "Feu",
	2: "Forêt",
	3: "Foudre",
	4: "Montagne",
	5: "Air",
};
const POSITION: Record<number, string> = { 1: "GK", 2: "DF", 3: "MF", 4: "FW" };

type Dossier = {
	identity: {
		name_ja: string;
		nickname_en: string;
		constellation_fr: string;
		constellation_en: string;
		element_id: number;
		main_position: number;
		sub_position: number;
		team_name_en: string;
		zukan_order: number;
	};
	profile: { epithet_ja: string; epithet_en: string };
	series: Array<{ code: string; label: string }>;
	assets: Array<{ code: string; icon_g4tx: string }>;
	stats: Record<"lv1" | "lv50" | "lv99", Record<string, number>>;
	variants: Array<{
		techniques: Array<{
			learn_level: number;
			info: { skill_id_str: string; power_min: number; power_max: number; consume_tp: number };
			cutin?: { telop_by_lang: Array<[string, string]> };
		}>;
		auras: Array<{ cmd: { asset_code: string; sub_type: string; config: { rank: number } }; learn_level: number }>;
	}>;
	references: Array<{ title: string; detail: string }>;
	dialogues: Array<{
		event_id: string;
		line_count: number;
		aphrody_mentions: number;
		lines: Array<{ id: string; ja: string; fr?: string; en?: string; mentions: boolean }>;
	}>;
};

export function AphrodyDossierSection({ internalCode }: { internalCode?: string }) {
	const [dossier, setDossier] = useState<Dossier | null>(null);

	useEffect(() => {
		let cancelled = false;
		void fetch("/api/nie/aphrody")
			.then((response) => (response.ok ? response.json() : null))
			.then((value: Dossier | null) => {
				if (!cancelled) setDossier(value);
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, []);

	if (!internalCode || !dossier) return null;
	const seriesCodes = new Set(dossier.series.map((s) => s.code.toLowerCase()));
	if (!seriesCodes.has(internalCode.toLowerCase())) return null;

	const id = dossier.identity;
	// Prefer the primary seven-skill/two-aura variant when present.
	const primary =
		dossier.variants.find((v) => v.techniques.length === 7 && v.auras.length === 2) ??
		dossier.variants[0];

	return (
		<section className="rounded-3xl border border-primary/30 bg-primary-container/10 p-5 space-y-5">
			<header className="space-y-1">
				<h2 className="flex items-center gap-2 text-fluid-title-md font-bold text-on-surface">
					<Icon name="auto_awesome" size={20} className="text-primary" />
					Dossier Aphrody
				</h2>
				<p className="text-sm text-on-surface-variant">
					{id.name_ja} — « {id.nickname_en} » · {dossier.profile.epithet_ja} (
					{dossier.profile.epithet_en}) · Constellation {id.constellation_fr} (
					{id.constellation_en}) · Équipe {id.team_name_en} · Élément{" "}
					{ELEMENT[id.element_id] ?? id.element_id} · Poste {POSITION[id.main_position]}/
					{POSITION[id.sub_position]} · Zukan #{id.zukan_order}
				</p>
			</header>

			{/* Three source series. */}
			<div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
				{dossier.series.map((s) => {
					const asset = dossier.assets.find((a) => a.code === s.code);
					const icon = asset ? cpkAssetUrl(asset.icon_g4tx) : null;
					return (
						<div
							key={s.code}
							className="flex items-center gap-3 rounded-2xl border border-outline-variant/20 bg-surface-container-low/40 p-3"
						>
							{icon && (
								// eslint-disable-next-line @next/next/no-img-element
								<img
									src={icon}
									alt={s.code}
									width={48}
									height={48}
									className="rounded-lg bg-surface-container"
								/>
							)}
							<div className="min-w-0">
								<p className="text-sm font-semibold text-on-surface truncate">{s.label}</p>
							</div>
						</div>
					);
				})}
			</div>

			{/* Golden stats. */}
			<div className="overflow-x-auto">
				<table className="w-full text-sm border-collapse">
					<thead>
						<tr className="text-on-surface-variant text-xs">
							<th className="text-left py-1 pr-2">Niveau</th>
							{(["kick", "control", "technique", "intelligence", "pressure", "agility", "physical"] as const).map(
								(k) => (
									<th key={k} className="text-right py-1 px-2 capitalize">
										{k}
									</th>
								)
							)}
						</tr>
					</thead>
					<tbody>
						{(["lv1", "lv50", "lv99"] as const).map((lv) => {
							const row = dossier.stats[lv];
							return (
								<tr key={lv} className="border-t border-outline-variant/10">
									<td className="py-1 pr-2 font-mono text-on-surface-variant uppercase">{lv}</td>
									{(["kick", "control", "technique", "intelligence", "pressure", "agility", "physical"] as const).map(
										(k) => (
											<td key={k} className="text-right py-1 px-2 tabular-nums text-on-surface">
												{row[k]}
											</td>
										)
									)}
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>

			{/* Primary variant techniques. */}
			<div className="space-y-2">
				<h3 className="text-fluid-title-sm font-semibold text-on-surface">
					Techniques ({primary.techniques.length})
				</h3>
				<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
					{primary.techniques.map((t) => {
						const code = t.info.skill_id_str;
							const telopPath =
							t.cutin?.telop_by_lang.find(([l]) => l === "fr")?.[1] ??
							t.cutin?.telop_by_lang.find(([l]) => l === "en")?.[1] ??
							t.cutin?.telop_by_lang[0]?.[1];
						const telopUrl = telopPath ? cpkAssetUrl(telopPath) : null;
						return (
							<div
								key={code}
								className="rounded-2xl border border-outline-variant/20 bg-surface-container-low/40 p-3 space-y-2"
							>
								{telopUrl ? (
									// eslint-disable-next-line @next/next/no-img-element
									<img
										src={telopUrl}
										alt={code}
										className="max-h-10 w-auto object-contain"
									/>
								) : (
									<p className="font-mono text-sm text-on-surface">{code}</p>
								)}
								<div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-on-surface-variant">
									<span>Lv {t.learn_level}</span>
									<span>Puiss. {t.info.power_min}–{t.info.power_max}</span>
									<span>TP {t.info.consume_tp}</span>
								</div>
							</div>
						);
					})}
				</div>
			</div>

			{/* Auras. */}
			{primary.auras.length > 0 && (
				<div className="space-y-2">
					<h3 className="text-fluid-title-sm font-semibold text-on-surface">
						Auras ({primary.auras.length})
					</h3>
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
						{primary.auras.map((a) => (
							<div
								key={a.cmd.asset_code}
								className="rounded-2xl border border-outline-variant/20 bg-surface-container-low/40 p-3 flex items-center justify-between gap-2"
							>
								<span className="font-mono text-sm text-on-surface">{a.cmd.asset_code}</span>
								<span className="text-xs text-on-surface-variant">
									{a.cmd.sub_type} · rang {a.cmd.config.rank} · Lv {a.learn_level}
								</span>
							</div>
						))}
					</div>
				</div>
			)}

			{/* References and easter eggs. */}
			{dossier.references.length > 0 && (
				<div className="space-y-2">
					<h3 className="text-fluid-title-sm font-semibold text-on-surface">
						Références &amp; easter eggs
					</h3>
					<ul className="space-y-1.5">
						{dossier.references.map((r) => (
							<li key={r.title} className="text-sm">
								<span className="font-semibold text-on-surface">{r.title}</span>
								<span className="text-on-surface-variant"> — {r.detail}</span>
							</li>
						))}
					</ul>
				</div>
			)}

			{/* Trilingual story dialogues. */}
			{dossier.dialogues.length > 0 && (
				<div className="space-y-2">
					<h3 className="text-fluid-title-sm font-semibold text-on-surface">
						Dialogues — {dossier.dialogues.length} scènes,{" "}
						{dossier.dialogues.reduce((n, d) => n + d.line_count, 0)} répliques
					</h3>
					<div className="space-y-2">
						{dossier.dialogues.map((scene) => (
							<details
								key={scene.event_id}
								className="rounded-2xl border border-outline-variant/20 bg-surface-container-low/40 p-3"
							>
								<summary className="cursor-pointer text-sm font-mono text-on-surface flex items-center gap-2">
									<Icon name="forum" size={16} className="text-primary" />
									{scene.event_id}
									<span className="text-xs text-on-surface-variant">
										({scene.line_count} répliques · {scene.aphrody_mentions} mentions)
									</span>
								</summary>
								<ol className="mt-2 space-y-2">
									{scene.lines.map((l, i) => (
										<li
											key={`${scene.event_id}-${l.id}-${i}`}
											className={`text-sm border-l-2 pl-3 ${
												l.mentions ? "border-primary" : "border-outline-variant/30"
											}`}
										>
											<p className="text-on-surface">{l.ja}</p>
											{l.fr && <p className="text-on-surface-variant italic">{l.fr}</p>}
											{l.en && <p className="text-on-surface-variant/70 text-xs">{l.en}</p>}
										</li>
									))}
								</ol>
							</details>
						))}
					</div>
				</div>
			)}
		</section>
	);
}
