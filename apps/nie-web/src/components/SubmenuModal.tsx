/**
 * Authentic Inazuma Eleven Victory Road Submenu Modal.
 * Renders real sub-options, animated parallelogram design, and keyboard/gamepad navigation.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { playUiSound } from "../game/ui-sound";
import { GLYPHES, type NomGlyphe } from "@niers/inacord-ui";
import { WASM_MODE_LABELS, type WasmMode } from "../pages/WasmGameSurface";
import "../styles/ui-effects.css";

export interface SubmenuItem {
	id: string;
	title: string;
	description: string;
	tag?: string;
	primary?: boolean;
	action?: () => void;
}

export interface SubmenuDefinition {
	modeSlug: string;
	title: string;
	category: string;
	glyph: NomGlyphe;
	items: SubmenuItem[];
	defaultWasmMode?: WasmMode;
}

export const AUTHENTIC_SUBMENUS: Record<string, SubmenuDefinition> = {
	story_mode: {
		modeSlug: "story_mode",
		title: "Mode Histoire",
		category: "Scénario Principal",
		glyph: "ballon",
		defaultWasmMode: "story_mode",
		items: [
			{
				id: "story_ch1",
				title: "Chapitre 1 : Un vent nouveau souffle",
				description: "L'aventure de Destin Billows commence au collège Nagumohara. Premières passes et rivalités.",
				tag: "En cours",
				primary: true,
			},
			{
				id: "story_chapters",
				title: "Sélection des Chapitres",
				description: "Parcourez et rejouez les épisodes débloqués de l'aventure principale avec vos équipes entraînées.",
				tag: "Chapitres 1-7",
			},
			{
				id: "story_cinematics",
				title: "Cinématiques & Événements MAPPA",
				description: "Visionnez les séquences d'animation cinématiques et revivez les tournants dramatiques de l'intrigue.",
				tag: "Vidéos USM",
			},
			{
				id: "story_wasm_match",
				title: "Lancer le Match de Scénario (WASM 60 Hz)",
				description: "Exécution déterministe immédiate du match de football avec le moteur de jeu WebAssembly.",
				tag: "WASM Déterministe",
				primary: true,
			},
		],
	},
	chronicle_mode: {
		modeSlug: "chronicle_mode",
		title: "Mode Chronique",
		category: "Histoire Légendaire",
		glyph: "livre",
		defaultWasmMode: "chronicle_mode",
		items: [
			{
				id: "chronicle_route",
				title: "Route Chronologique des Sagas",
				description: "Parcourez 25 ans d'histoire : Raimon Original, Alius, FFI, Go, Chrono Stone et Galaxy.",
				tag: "6 Sagas",
				primary: true,
			},
			{
				id: "chronicle_constellation",
				title: "Tableau des Constellations des Joueurs",
				description: "Recrutez parmi plus de 4 500 joueurs du multivers Inazuma en débloquant les étoiles de lien.",
				tag: "4 500+ Joueurs",
			},
			{
				id: "chronicle_legend_matches",
				title: "Matchs de Légende & Duels Cultes",
				description: "Rejouez les affrontements mythiques : Raimon vs Zeus, Tempête des Gémeaux, Les Empereurs Noirs.",
				tag: "Historique",
			},
			{
				id: "chronicle_wasm_match",
				title: "Lancer le Match Chronique (WASM 60 Hz)",
				description: "Démarrer immédiatement le match légendaire avec les équipes d'époque dans le runtime WebAssembly.",
				tag: "WASM Déterministe",
				primary: true,
			},
		],
	},
	competition: {
		modeSlug: "competition",
		title: "Mode Compétition",
		category: "Tournois & Matchs",
		glyph: "ballon",
		defaultWasmMode: "competition",
		items: [
			{
				id: "comp_free_match",
				title: "Match Amical & Partie Rapide",
				description: "Affrontement direct avec sélection libre des équipes, tactiques, mi-temps et météo du stade.",
				tag: "Match Libre",
				primary: true,
			},
			{
				id: "comp_football_frontier",
				title: "Tournoi Football Frontier",
				description: "Le tournoi national des collèges. Élimination directe jusqu'à la consécration suprême.",
				tag: "Tournoi",
			},
			{
				id: "comp_ranked",
				title: "Parties Classées & Divisions",
				description: "Affrontez les meilleurs managers en ligne et grimpez les divisions du classement mondial.",
				tag: "En ligne",
			},
			{
				id: "comp_wasm_match",
				title: "Lancer le Match Compétition (WASM 60 Hz)",
				description: "Coup d'envoi immédiat de la simulation de match en haute fréquence 60 images/seconde.",
				tag: "WASM Déterministe",
				primary: true,
			},
		],
	},
	victory_road: {
		modeSlug: "victory_road",
		title: "Victory Road",
		category: "Championnat National",
		glyph: "ballon",
		defaultWasmMode: "victory_road",
		items: [
			{
				id: "vr_prelims",
				title: "Qualifications Régionales",
				description: "Passez les tours préliminaires régionaux avec votre effectif et vos compositions tactiques.",
				tag: "Régional",
				primary: true,
			},
			{
				id: "vr_national",
				title: "Phase Finale du Tournoi National",
				description: "La grande scène nationale pour décrocher le titre ultime de Victory Road.",
				tag: "Tournoi National",
			},
			{
				id: "vr_seasonal",
				title: "Défis Saisonniers & Récompenses",
				description: "Événements hebdomadaires à objectifs limités avec esprits rares et équipements légendaires.",
				tag: "Saison",
			},
			{
				id: "vr_wasm_match",
				title: "Lancer le Match Victory Road (WASM 60 Hz)",
				description: "Exécution déterministe immédiate du match sur la pelouse officielle de Victory Road.",
				tag: "WASM Déterministe",
				primary: true,
			},
		],
	},
	bb_stadium: {
		modeSlug: "bb_stadium",
		title: "Stade BB",
		category: "Entraînement & Tactique",
		glyph: "ballon",
		defaultWasmMode: "bb_stadium",
		items: [
			{
				id: "bb_training",
				title: "Entraînement Libre & Drills",
				description: "Perfectionnez vos passes, vos dribbles en duel de focus, et la précision de vos frappes aux cages.",
				tag: "Entraînement",
				primary: true,
			},
			{
				id: "bb_scrimmage",
				title: "Match Démonstration & Échauffement",
				description: "Opposition d'entraînement à haute intensité sur le terrain synthétique du Stade BB.",
				tag: "Démonstration",
			},
			{
				id: "bb_shootout",
				title: "Séance de Tirs au But & Duels de Gardien",
				description: "Simulations intenses de séances de penaltys et d'arrêts critiques au point de rupture.",
				tag: "Tirs au But",
			},
			{
				id: "bb_wasm_match",
				title: "Démarrer la Session Stade BB (WASM 60 Hz)",
				description: "Lancer la simulation de jeu en direct au Stade BB avec contrôle clavier ou manette.",
				tag: "WASM Déterministe",
				primary: true,
			},
		],
	},
	kizuna_town: {
		modeSlug: "kizuna_town",
		title: "Station Kizuna",
		category: "Ville & Communauté",
		glyph: "arbre",
		defaultWasmMode: "chronicle_mode",
		items: [
			{
				id: "kizuna_plaza",
				title: "Place Centrale de la Ville Kizuna",
				description: "Promenez-vous dans la ville, rencontrez les joueurs recrutés et renforcez les liens d'équipe.",
				tag: "Exploration",
				primary: true,
			},
			{
				id: "kizuna_bond_shop",
				title: "Boutique des Liens & Esprits",
				description: "Échangez vos fèves de kizuna et esprits contre des manuels de techniques spéciales et maillots.",
				tag: "Boutique",
			},
			{
				id: "kizuna_memories",
				title: "Allée des Souvenirs & Dialogues",
				description: "Consultez les anecdotes, citations cultes et saynètes exclusives entre vos coéquipiers.",
				tag: "Scénario",
			},
			{
				id: "kizuna_wasm_match",
				title: "Lancer un Match Amical Kizuna (WASM 60 Hz)",
				description: "Opposez vos équipes soudées par les liens dans une confrontation amicale en direct.",
				tag: "WASM Déterministe",
			},
		],
	},
	information: {
		modeSlug: "information",
		title: "Informations & Mises à Jour",
		category: "Actualités & Guides",
		glyph: "livre",
		items: [
			{
				id: "info_news",
				title: "Annonces Officielles & Notes de Version",
				description: "Consultez le journal des mises à jour, équilibrages de techniques et événements communautaires.",
				tag: "Actualités",
				primary: true,
			},
			{
				id: "info_rules",
				title: "Guide des Mécaniques de Jeu",
				description: "Règles détaillées : gestion de la jauge de tension, duels de focus, zones de tir direct et arrêts.",
				tag: "Manuel de Jeu",
			},
			{
				id: "info_controls",
				title: "Configuration des Touches & Manette",
				description: "Consultez la disposition officielle des touches clavier et sticks pour manettes Xbox / PlayStation.",
				tag: "Commandes",
			},
		],
	},
	"title-item-10": {
		modeSlug: "title-item-10",
		title: "Gestion des Sauvegardes",
		category: "Profil & Données",
		glyph: "livre",
		items: [
			{
				id: "save_profile",
				title: "Sauvegarder le Profil Actuel",
				description: "Enregistrez vos compositions d'équipes, réglages d'avatar et progression sur le stockage local.",
				tag: "Local / Cache",
				primary: true,
			},
			{
				id: "save_load",
				title: "Charger un Fichier de Sauvegarde (.bin)",
				description: "Importez un fichier de sauvegarde Steam ou d'export pour restaurer votre banc et tactiques.",
				tag: "Restauration",
			},
			{
				id: "save_data_inspect",
				title: "Explorer les Données Décodées du Jeu",
				description: "Inspectez les familles de données du jeu (personnages, techniques, boutiques) via le visualiseur VFS.",
				tag: "Données VFS",
			},
		],
	},
};

export interface SubmenuModalProps {
	modeSlug: string;
	onClose: () => void;
	onLaunchWasm?: (mode: WasmMode) => void;
	onExploreMode?: (slug: string) => void;
}

export function SubmenuModal({ modeSlug, onClose, onLaunchWasm, onExploreMode }: SubmenuModalProps) {
	const definition = AUTHENTIC_SUBMENUS[modeSlug] ?? {
		modeSlug,
		title: WASM_MODE_LABELS[modeSlug as WasmMode] ?? modeSlug,
		category: "Mode de Jeu",
		glyph: "ballon" as NomGlyphe,
		defaultWasmMode: modeSlug in WASM_MODE_LABELS ? (modeSlug as WasmMode) : undefined,
		items: [
			{
				id: "default_wasm",
				title: "Lancer le Match Déterministe (WASM 60 Hz)",
				description: "Exécution déterministe immédiate dans le runtime WebAssembly.",
				primary: true,
			},
			{
				id: "default_explore",
				title: "Explorer les Écrans et Calques du VFS",
				description: "Inspecter la composition, les scripts Lua et les textures du mode.",
			},
		],
	};

	const [selectedIndex, setSelectedIndex] = useState(0);
	const [activeMessage, setActiveMessage] = useState<string | null>(null);
	const dialogRef = useRef<HTMLDivElement | null>(null);

	// Play opening chime on mount
	useEffect(() => {
		playUiSound("open_submenu");
	}, []);

	const handleClose = useCallback(() => {
		playUiSound("cancel");
		onClose();
	}, [onClose]);

	const handleLaunchWasm = useCallback(() => {
		playUiSound("start_game");
		const wasmMode = definition.defaultWasmMode ?? "story_mode";
		onLaunchWasm?.(wasmMode);
	}, [definition.defaultWasmMode, onLaunchWasm]);

	const handleExplore = useCallback(() => {
		playUiSound("decide");
		onExploreMode?.(definition.modeSlug);
	}, [definition.modeSlug, onExploreMode]);

	const handleItemClick = useCallback((item: SubmenuItem, index: number) => {
		setSelectedIndex(index);
		playUiSound("decide");
		if (item.id.includes("wasm") && onLaunchWasm) {
			handleLaunchWasm();
		} else if (item.id.includes("explore") || item.id.includes("inspect")) {
			handleExplore();
		} else {
			setActiveMessage(`Sous-option sélectionnée : ${item.title}`);
			window.setTimeout(() => setActiveMessage(null), 3000);
		}
	}, [handleLaunchWasm, handleExplore, onLaunchWasm]);

	// Keyboard controls: Up/Down to select, Enter to activate, Escape to close
	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				handleClose();
				return;
			}
			if (event.key === "ArrowDown" || event.key === "s") {
				event.preventDefault();
				playUiSound("cursor");
				setSelectedIndex((prev) => (prev + 1) % definition.items.length);
			} else if (event.key === "ArrowUp" || event.key === "z" || event.key === "w") {
				event.preventDefault();
				playUiSound("cursor");
				setSelectedIndex((prev) => (prev - 1 + definition.items.length) % definition.items.length);
			} else if (event.key === "Enter" || event.key === " ") {
				event.preventDefault();
				const item = definition.items[selectedIndex];
				if (item) handleItemClick(item, selectedIndex);
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [definition.items, handleClose, handleItemClick, selectedIndex]);

	// `GLYPHES` porte des ÉLÉMENTS déjà rendus, pas des composants : chaque entrée est un
	// `<Glyphe>` construit sur place. L'écrire `<Glyphe … />` ne compile pas (TS2604/TS2786) et
	// ses props seraient de toute façon ignorées — la taille vient de `.inazuma-submenu-glyph`.
	const glyphe = GLYPHES[definition.glyph] ?? GLYPHES.ballon;

	return (
		<div
			className="inazuma-submenu-backdrop"
			onClick={(e) => {
				if (e.target === e.currentTarget) handleClose();
			}}
			role="dialog"
			aria-modal="true"
			aria-label={definition.title}
		>
			<div ref={dialogRef} className="inazuma-submenu-card">
				{/* En-tête Inazuma */}
				<header className="inazuma-submenu-header">
					<div className="inazuma-submenu-title-group">
						<div className="inazuma-submenu-glyph">
							{glyphe}
						</div>
						<div>
							<h2 className="inazuma-submenu-title">{definition.title}</h2>
							<span className="inazuma-submenu-badge">{definition.category}</span>
						</div>
					</div>
					<button
						type="button"
						className="inazuma-submenu-close"
						onClick={handleClose}
						aria-label="Fermer le sous-menu"
						data-sound="cancel"
					>
						✕
					</button>
				</header>

				{/* Message temporaire de sélection */}
				{activeMessage && (
					<div
						style={{
							padding: "0.5rem 1.5rem",
							background: "rgba(0, 157, 255, 0.25)",
							borderBottom: "1px solid var(--screen-check-cyan, #45fff8)",
							fontSize: "0.85rem",
							fontWeight: 700,
							color: "var(--screen-check-cyan, #45fff8)",
						}}
					>
						{activeMessage}
					</div>
				)}

				{/* Corps avec les sous-options authentiques */}
				<div className="inazuma-submenu-body">
					{definition.items.map((item, index) => {
						const isSelected = selectedIndex === index;
						return (
							<button
								key={item.id}
								type="button"
								className={`inazuma-suboption-item ${isSelected ? "inazuma-suboption-item--selected" : ""}`}
								style={{
									"--item-idx": index,
									borderColor: isSelected ? "var(--screen-check-cyan, #45fff8)" : undefined,
									background: isSelected
										? "linear-gradient(90deg, #0048b9 0%, #0350e6 100%)"
										: undefined,
								} as React.CSSProperties}
								onClick={() => handleItemClick(item, index)}
								onMouseEnter={() => {
									if (selectedIndex !== index) {
										setSelectedIndex(index);
										playUiSound("cursor");
									}
								}}
							>
								<span className="inazuma-suboption-number">0{index + 1}</span>
								<div className="inazuma-suboption-content">
									<h3 className="inazuma-suboption-title">{item.title}</h3>
									<p className="inazuma-suboption-desc">{item.description}</p>
								</div>
								{item.tag && (
									<span
										className={`inazuma-suboption-tag ${
											item.primary ? "inazuma-suboption-tag--primary" : ""
										}`}
									>
										{item.tag}
									</span>
								)}
							</button>
						);
					})}
				</div>

				{/* Pied du modal avec actions réelles */}
				<footer className="inazuma-submenu-footer">
					<button
						type="button"
						className="inazuma-btn inazuma-btn--secondary"
						onClick={handleClose}
						data-sound="cancel"
					>
						<span>Retour</span>
					</button>

					{onExploreMode && (
						<button
							type="button"
							className="inazuma-btn inazuma-btn--secondary"
							onClick={handleExplore}
						>
							<span>Explorer les Écrans VFS</span>
						</button>
					)}

					{onLaunchWasm && definition.defaultWasmMode && (
						<button
							type="button"
							className="inazuma-btn inazuma-btn--primary"
							onClick={handleLaunchWasm}
						>
							<span>⚽ Lancer le Match (WASM 60 Hz)</span>
						</button>
					)}
				</footer>
			</div>
		</div>
	);
}
