/**
 * Authentic Inazuma Eleven Victory Road My Team & Soccer Formation Screen.
 * Guided strictly by data/menu/formation_select.png, formation_presets.png, and player_roster.png.
 */
import { useState, useMemo } from "react";
import { GameHeaderBar, GameText, GLYPHES } from "@niers/inacord-ui";
import { playUiSound } from "../game/ui-sound";
import {
	LEGACY_FORMATIONS,
	ROLE_COLORS,
	ROLE_LABELS,
	type Formation,
} from "@niers/game/game/formations";
import "../styles/ui-effects.css";

export interface PitchPlayer {
	slotIndex: number;
	id: string;
	name: string;
	role: "FW" | "MF" | "DF" | "GK";
	element: "wind" | "wood" | "fire" | "earth" | "void";
	level: number;
	number: number;
	kick: number;
	control: number;
	technique: number;
	pressure: number;
	physical: number;
	agility: number;
	intelligence: number;
}

const DEFAULT_LINEUP: PitchPlayer[] = [
	{ slotIndex: 0, id: "c01000010", name: "Axel Blaze", role: "FW", element: "fire", level: 50, number: 10, kick: 145, control: 110, technique: 125, pressure: 95, physical: 115, agility: 130, intelligence: 105 },
	{ slotIndex: 1, id: "c01000020", name: "Kevin Dragonfly", role: "FW", element: "wood", level: 48, number: 11, kick: 135, control: 95, technique: 105, pressure: 100, physical: 125, agility: 100, intelligence: 90 },
	{ slotIndex: 2, id: "c01000030", name: "Jude Sharp", role: "MF", element: "wind", level: 50, number: 14, kick: 115, control: 140, technique: 150, pressure: 110, physical: 105, agility: 120, intelligence: 155 },
	{ slotIndex: 3, id: "c01000040", name: "Nathan Swift", role: "MF", element: "wind", level: 48, number: 2, kick: 105, control: 120, technique: 125, pressure: 115, physical: 100, agility: 160, intelligence: 115 },
	{ slotIndex: 4, id: "c01000050", name: "Erik Eagle", role: "MF", element: "wood", level: 49, number: 16, kick: 120, control: 135, technique: 145, pressure: 105, physical: 110, agility: 135, intelligence: 130 },
	{ slotIndex: 5, id: "c01000060", name: "Bobby Shearer", role: "MF", element: "wood", level: 47, number: 13, kick: 90, control: 115, technique: 110, pressure: 130, physical: 135, agility: 115, intelligence: 110 },
	{ slotIndex: 6, id: "c01000070", name: "Jack Wallside", role: "DF", element: "earth", level: 49, number: 3, kick: 80, control: 90, technique: 95, pressure: 140, physical: 165, agility: 85, intelligence: 100 },
	{ slotIndex: 7, id: "c01000080", name: "Tod Ironside", role: "DF", element: "fire", level: 46, number: 5, kick: 85, control: 105, technique: 110, pressure: 125, physical: 120, agility: 125, intelligence: 105 },
	{ slotIndex: 8, id: "c01000090", name: "Jim Wraith", role: "DF", element: "wood", level: 45, number: 4, kick: 75, control: 100, technique: 115, pressure: 120, physical: 115, agility: 110, intelligence: 115 },
	{ slotIndex: 9, id: "c01000100", name: "Hurley Kane", role: "DF", element: "wind", level: 49, number: 24, kick: 130, control: 110, technique: 115, pressure: 125, physical: 140, agility: 125, intelligence: 100 },
	{ slotIndex: 10, id: "c01000001", name: "Mark Evans", role: "GK", element: "earth", level: 50, number: 1, kick: 95, control: 115, technique: 140, pressure: 150, physical: 155, agility: 120, intelligence: 145 },
];

const BENCH_PLAYERS: PitchPlayer[] = [
	{ slotIndex: 11, id: "c01000110", name: "Shawn Froste", role: "FW", element: "wind", level: 50, number: 9, kick: 145, control: 130, technique: 135, pressure: 120, physical: 120, agility: 150, intelligence: 130 },
	{ slotIndex: 12, id: "c01000120", name: "Darren LaChance", role: "GK", element: "wood", level: 47, number: 20, kick: 85, control: 105, technique: 130, pressure: 135, physical: 130, agility: 115, intelligence: 125 },
	{ slotIndex: 13, id: "c01000130", name: "David Samford", role: "FW", element: "wood", level: 48, number: 18, kick: 130, control: 115, technique: 125, pressure: 110, physical: 115, agility: 125, intelligence: 120 },
	{ slotIndex: 14, id: "c01000140", name: "Caleb Stonewall", role: "MF", element: "fire", level: 49, number: 8, kick: 120, control: 135, technique: 140, pressure: 130, physical: 120, agility: 130, intelligence: 140 },
	{ slotIndex: 15, id: "c01000150", name: "Scotty Banyan", role: "DF", element: "wood", level: 46, number: 6, kick: 80, control: 110, technique: 115, pressure: 135, physical: 110, agility: 145, intelligence: 110 },
];

export interface MyTeamScreenProps {
	onBack: () => void;
	onLaunchMatch?: (mode: string) => void;
}

export function MyTeamScreen({ onBack, onLaunchMatch }: MyTeamScreenProps) {
	const [activeTab, setActiveTab] = useState<"formation" | "presets" | "roster">("formation");
	const [selectedFormation, setSelectedFormation] = useState<Formation>(LEGACY_FORMATIONS[0]!);
	const [players, setPlayers] = useState<PitchPlayer[]>(DEFAULT_LINEUP);
	const [bench] = useState<PitchPlayer[]>(BENCH_PLAYERS);
	const [selectedPlayer, setSelectedPlayer] = useState<PitchPlayer>(DEFAULT_LINEUP[0]!);
	const [tactic, setTactic] = useState<"equilibre" | "offensif" | "defensif" | "contre">("equilibre");

	// Aggregated team rating
	const teamPower = useMemo(() => {
		const total = players.reduce((sum, p) => sum + p.kick + p.control + p.technique + p.pressure + p.physical + p.agility + p.intelligence, 0);
		return Math.round(total / 7);
	}, [players]);

	const handlePlayerClick = (p: PitchPlayer) => {
		playUiSound("cursor");
		setSelectedPlayer(p);
	};

	const handleSelectFormation = (f: Formation) => {
		playUiSound("decide");
		setSelectedFormation(f);
		setActiveTab("formation");
	};

	return (
		<div className="flex h-full w-full flex-col overflow-auto bg-screen-panel-bg text-screen-row-white p-4 font-sans">
			{/* En-tête officiel My Team */}
			<GameHeaderBar icon={GLYPHES.ballon} title={<GameText>Votre Équipe — Formation & Tactique</GameText>}>
				<div className="flex items-center gap-3">
					<div className="hidden sm:flex items-center gap-2 rounded border border-screen-check-cyan/40 bg-screen-panel-top px-3 py-1 text-xs">
						<span className="text-screen-row-sub">Puissance :</span>
						<strong className="text-screen-check-cyan font-bold text-sm">{teamPower.toLocaleString("fr")}</strong>
					</div>
					{onLaunchMatch && (
						<button
							type="button"
							className="state-layer rounded-full bg-gradient-to-r from-screen-check-cyan to-screen-header-blue-cyan px-4 py-1 text-xs font-bold text-screen-panel-bg hover:brightness-110 shadow"
							onClick={() => {
								playUiSound("start_game");
								onLaunchMatch("competition");
							}}
						>
							⚽ Lancer le Match (WASM 60 Hz)
						</button>
					)}
					<button
						type="button"
						className="state-layer rounded px-3 py-1 text-xs font-semibold bg-screen-header-blue-deep text-screen-row-white hover:brightness-110"
						onClick={() => {
							playUiSound("cancel");
							onBack();
						}}
					>
						Retour
					</button>
				</div>
			</GameHeaderBar>

			{/* Onglets authentiques */}
			<div className="flex items-center gap-2 border-b border-screen-row-border my-2.5 pb-1">
				{[
					{ id: "formation", label: "01 Formation & Terrain" },
					{ id: "presets", label: "02 Préréglages de Formation" },
					{ id: "roster", label: "03 Effectif & Statistiques" },
				].map((tab) => {
					const active = activeTab === tab.id;
					return (
						<button
							key={tab.id}
							type="button"
							className={`rounded-t-lg px-4 py-1.5 text-xs font-bold transition-all ${
								active
									? "bg-screen-header-blue-deep text-screen-check-cyan border-b-2 border-screen-check-cyan"
									: "text-screen-row-sub hover:text-screen-row-white"
							}`}
							onClick={() => {
								playUiSound("cursor");
								setActiveTab(tab.id as typeof activeTab);
							}}
						>
							{tab.label}
						</button>
					);
				})}
			</div>

			{/* Onglet 1 : Terrain et Formation (formation_select.png) */}
			{activeTab === "formation" && (
				<div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-12 min-h-0">
					{/* Terrain de Football interactif */}
					<div className="relative flex flex-col items-center rounded-xl border border-screen-row-border bg-gradient-to-b from-[#0e3a1f] to-[#072412] p-4 lg:col-span-8 shadow-inner overflow-hidden min-h-[500px]">
						{/* Lignes du terrain de football */}
						<div className="pointer-events-none absolute inset-4 rounded border-2 border-white/20">
							{/* Ligne médiane */}
							<div className="absolute top-1/2 left-0 right-0 h-0.5 bg-white/20 -translate-y-1/2" />
							{/* Cercle central */}
							<div className="absolute top-1/2 left-1/2 h-32 w-32 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/20" />
							{/* Surface de réparation bas (GK) */}
							<div className="absolute bottom-0 left-1/2 h-24 w-64 -translate-x-1/2 border-t-2 border-l-2 border-r-2 border-white/20" />
							{/* Surface de réparation haut */}
							<div className="absolute top-0 left-1/2 h-24 w-64 -translate-x-1/2 border-b-2 border-l-2 border-r-2 border-white/20" />
						</div>

						{/* Nom de la formation active */}
						<div className="z-10 self-start mb-2 flex items-center gap-3">
							<span className="rounded bg-screen-panel-top/80 px-2.5 py-1 text-xs font-bold text-screen-check-cyan border border-screen-check-cyan/30">
								Formation active : {selectedFormation.name}
							</span>
							<div className="flex gap-1 text-xs">
								{(["equilibre", "offensif", "defensif", "contre"] as const).map((t) => (
									<button
										key={t}
										type="button"
										className={`rounded px-2 py-0.5 font-semibold capitalize ${
											tactic === t
												? "bg-screen-check-cyan text-screen-panel-bg"
												: "bg-screen-panel-top text-screen-row-sub hover:text-screen-row-white"
										}`}
										onClick={() => {
											playUiSound("cursor");
											setTactic(t);
										}}
									>
										{t}
									</button>
								))}
							</div>
						</div>

						{/* Joueurs disposés sur le terrain selon la formation */}
						<div className="relative flex-1 w-full max-w-2xl">
							{selectedFormation.positions.map((pos) => {
								const player = players.find((p) => p.slotIndex === pos.index) ?? players[pos.index];
								if (!player) return null;
								const isSelected = selectedPlayer.id === player.id;
								return (
									<div
										key={pos.index}
										onClick={() => handlePlayerClick(player)}
										style={{
											position: "absolute",
											top: `${pos.top * 1.8 + 8}%`,
											left: `${pos.left}%`,
											transform: "translate(-50%, -50%)",
										}}
										className={`group flex cursor-pointer flex-col items-center gap-1 transition-transform ${
											isSelected ? "scale-110 z-20" : "hover:scale-105 z-10"
										}`}
									>
										{/* Carte de joueur sur le terrain */}
										<div
											className={`relative flex h-14 w-14 items-center justify-center rounded-xl border-2 bg-screen-panel-top shadow-md ${
												isSelected
													? "border-screen-check-cyan ring-4 ring-screen-check-cyan/30 bg-screen-header-blue-deep"
													: "border-white/40 group-hover:border-screen-check-cyan"
											}`}
										>
											<img
												src={`/spirit_type/${player.element}.webp`}
												alt={player.element}
												className="absolute top-1 left-1 h-3.5 w-3.5 opacity-90"
												onError={(e) => { (e.target as HTMLElement).style.display = "none"; }}
											/>
											<span className="text-lg font-black text-screen-row-white">
												{player.number}
											</span>
											<span
												style={{ backgroundColor: ROLE_COLORS[player.role] }}
												className="absolute -bottom-1.5 -right-1.5 rounded px-1 text-[9px] font-bold text-white shadow"
											>
												{ROLE_LABELS[player.role]}
											</span>
										</div>
										<span className="rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-bold text-white backdrop-blur-sm max-w-[80px] truncate">
											{player.name}
										</span>
									</div>
								);
							})}
						</div>

						{/* Remplaçants (Banc de touche) */}
						<div className="z-10 w-full mt-auto pt-3 border-t border-white/10 flex items-center justify-between">
							<span className="text-xs font-bold text-screen-row-sub">Banc ({bench.length}) :</span>
							<div className="flex gap-2">
								{bench.map((b, i) => (
									<div
										key={b.id}
										onClick={() => handlePlayerClick(b)}
										className={`cursor-pointer flex items-center gap-1 rounded border px-2 py-1 bg-screen-panel-top/80 text-xs ${
											selectedPlayer.id === b.id ? "border-screen-check-cyan text-screen-check-cyan" : "border-white/20 text-white"
										}`}
									>
										<span className="font-bold">R{i + 1}</span>
										<span className="truncate max-w-[70px]">{b.name}</span>
									</div>
								))}
							</div>
						</div>
					</div>

					{/* Panneau latéral : Fiche détaillée du joueur sélectionné */}
					<div className="flex flex-col gap-3 rounded-xl border border-screen-row-border bg-screen-panel-body p-4 lg:col-span-4">
						<h3 className="text-xs font-semibold uppercase tracking-wider text-screen-check-cyan">
							Fiche Joueur · Titulaire n°{selectedPlayer.number}
						</h3>

						<div className="flex items-center gap-3 rounded-lg border border-screen-row-border bg-screen-panel-top p-3">
							<div className="flex h-14 w-14 items-center justify-center rounded-xl bg-screen-header-blue-deep border border-screen-check-cyan/40">
								<span className="text-2xl font-black text-screen-check-cyan">{selectedPlayer.number}</span>
							</div>
							<div className="min-w-0 flex-1">
								<h4 className="font-bold text-base text-screen-row-white truncate">{selectedPlayer.name}</h4>
								<div className="flex items-center gap-2 mt-0.5 text-xs text-screen-row-sub">
									<span style={{ color: ROLE_COLORS[selectedPlayer.role] }} className="font-bold">
										{ROLE_LABELS[selectedPlayer.role]}
									</span>
									<span>·</span>
									<span className="capitalize">Élément {selectedPlayer.element}</span>
									<span>·</span>
									<span className="font-semibold text-screen-check-cyan">Niv. {selectedPlayer.level}</span>
								</div>
							</div>
						</div>

						{/* Statistiques détaillées */}
						<div className="space-y-2 text-xs">
							<span className="text-screen-row-sub font-semibold">Statistiques de Match :</span>
							{[
								{ label: "Frappe (Kick)", val: selectedPlayer.kick },
								{ label: "Contrôle (Control)", val: selectedPlayer.control },
								{ label: "Technique", val: selectedPlayer.technique },
								{ label: "Pression (Defense)", val: selectedPlayer.pressure },
								{ label: "Physique (Stamina)", val: selectedPlayer.physical },
								{ label: "Agilité (Speed)", val: selectedPlayer.agility },
								{ label: "Intelligence", val: selectedPlayer.intelligence },
							].map((stat) => (
								<div key={stat.label} className="flex items-center justify-between gap-2">
									<span className="text-screen-row-sub">{stat.label}</span>
									<div className="flex items-center gap-2">
										<div className="w-24 h-1.5 rounded-full bg-screen-panel-top overflow-hidden">
											<div
												className="h-full bg-screen-check-cyan rounded-full"
												style={{ width: `${Math.min(100, (stat.val / 165) * 100)}%` }}
											/>
										</div>
										<strong className="font-mono text-screen-row-white w-7 text-right">{stat.val}</strong>
									</div>
								</div>
							))}
						</div>

						{/* Techniques spéciales équipées */}
						<div className="mt-auto pt-3 border-t border-screen-row-border/60">
							<span className="text-xs text-screen-row-sub font-semibold block mb-1.5">Techniques Spéciales :</span>
							<div className="grid grid-cols-2 gap-1.5 text-[11px]">
								<div className="rounded border border-screen-row-border bg-screen-panel-top px-2 py-1 text-screen-row-white truncate">
									⚡ Tourbillon de Feu
								</div>
								<div className="rounded border border-screen-row-border bg-screen-panel-top px-2 py-1 text-screen-row-white truncate">
									🌪️ Tempête de Feu
								</div>
								<div className="rounded border border-screen-row-border bg-screen-panel-top px-2 py-1 text-screen-row-white truncate">
									🔥 Épée de Feu
								</div>
								<div className="rounded border border-screen-row-border bg-screen-panel-top px-2 py-1 text-screen-row-white truncate">
									⭐ Feu Tout-Puissant
								</div>
							</div>
						</div>
					</div>
				</div>
			)}

			{/* Onglet 2 : Préréglages de formation (formation_presets.png) */}
			{activeTab === "presets" && (
				<div className="flex-1 space-y-4">
					<h3 className="text-xs font-semibold uppercase tracking-wider text-screen-check-cyan">
						Sélectionnez une disposition tactique parmi les formations officielles :
					</h3>
					<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
						{LEGACY_FORMATIONS.map((f) => {
							const isCurrent = selectedFormation.id === f.id;
							return (
								<div
									key={f.id}
									onClick={() => handleSelectFormation(f)}
									className={`cursor-pointer rounded-xl border p-4 transition-all flex flex-col justify-between ${
										isCurrent
											? "border-screen-check-cyan bg-screen-header-blue-deep shadow-lg ring-2 ring-screen-check-cyan/40"
											: "border-screen-row-border bg-screen-panel-body hover:border-screen-check-cyan/60 hover:bg-screen-panel-top"
									}`}
								>
									<div className="flex items-center justify-between">
										<span className="rounded bg-screen-check-cyan/20 px-2 py-0.5 text-xs font-bold text-screen-check-cyan border border-screen-check-cyan/40">
											{f.label}
										</span>
										<span className="text-xs text-screen-row-sub font-mono">11 joueurs</span>
									</div>
									<h4 className="mt-2 text-base font-bold text-screen-row-white">{f.name}</h4>
									<p className="mt-1 text-xs text-screen-row-sub">
										Disposition équilibrée avec {f.positions.filter((p) => p.role === "DF").length} défenseurs,{" "}
										{f.positions.filter((p) => p.role === "MF").length} milieux et{" "}
										{f.positions.filter((p) => p.role === "FW").length} attaquants.
									</p>
									<button
										type="button"
										className="mt-3 w-full rounded bg-screen-panel-top py-1.5 text-xs font-semibold text-screen-check-cyan border border-screen-check-cyan/30 hover:bg-screen-check-cyan hover:text-screen-panel-bg"
									>
										{isCurrent ? "✓ Formation Actuelle" : "Adopter cette formation"}
									</button>
								</div>
							);
						})}
					</div>
				</div>
			)}

			{/* Onglet 3 : Effectif & Joueurs (player_roster.png) */}
			{activeTab === "roster" && (
				<div className="flex-1 space-y-3">
					<h3 className="text-xs font-semibold uppercase tracking-wider text-screen-check-cyan">
						Tous les Joueurs de l'Équipe ({players.length + bench.length}) :
					</h3>
					<div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5">
						{[...players, ...bench].map((p) => (
							<div
								key={p.id}
								onClick={() => {
									handlePlayerClick(p);
									setActiveTab("formation");
								}}
								className="cursor-pointer flex items-center justify-between rounded-lg border border-screen-row-border bg-screen-panel-body p-3 hover:border-screen-check-cyan hover:bg-screen-panel-top"
							>
								<div className="flex items-center gap-2.5">
									<span
										style={{ backgroundColor: ROLE_COLORS[p.role] }}
										className="rounded px-1.5 py-0.5 text-[10px] font-bold text-white"
									>
										{ROLE_LABELS[p.role]}
									</span>
									<div>
										<h5 className="font-bold text-xs text-screen-row-white">{p.name}</h5>
										<span className="text-[10px] text-screen-row-sub">Niv. {p.level} · n°{p.number}</span>
									</div>
								</div>
								<span className="text-xs font-mono text-screen-check-cyan font-bold">{p.kick} FR</span>
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
