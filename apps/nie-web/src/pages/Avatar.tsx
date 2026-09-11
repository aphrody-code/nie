/**
 * Native avatar host & Chara Edit Sovereign Suite:
 * - Pixel-perfect native game Chara Edit reproduction
 * - Realtime 3D Engine & Inspector with GLB 2.0 export
 * - Animation & Cinematic Event Creator (G4MT / G4MA / T2B cutscenes)
 * - Inazuma Eleven Dialogue Visualiser & Interactive Scenario Creator
 * - Studio Audio: BGM Player, Voice Bank & Native Live Voice Recorder
 * - Texture Editor & 2D Face Paint Studio with decalcomanias
 * - Auras & Keshin / Mixi-Max Engine (Morpheus, Master Dragon, Shawn Froste)
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { NativeAvatarEditor, type AvatarNameFields } from "@niers/inacord-ui/avatar/NativeAvatarEditor";
import { INITIAL_AVATAR_STATE, type AvatarCatalog, type AvatarComposition, type AvatarState } from "@niers/inacord-ui/avatar/contract";
import type { NativeMenuScene } from "@niers/inacord-ui/shell/native-title-menu";
import type { createStandardGamepadMenuSampler } from "@niers/inacord-ui/shell/menu-interaction";
import { RustModelViewport } from "@niers/inacord-ui/shell/rust-model-viewport";
import { avatarModelUrl, resolveAvatar } from "../game/avatar-runtime";
import { loadMenuPresentation } from "../game/bridge";
import { createNativeViewer } from "../game/native-viewer";
import { NativeText } from "./NativeText";
import "./avatar-studio.css";

const STAGES = ["style", "body", "hair", "clothes", "stats", "name"] as const;
type Stage = typeof STAGES[number];
const SCENES = { style: "avatar-top", body: "avatar-style", hair: "avatar-hair", clothes: "avatar-clothes", stats: "avatar-stats", name: "avatar-name" } as const;
const DRAFT_KEY = "nie.avatar.draft.v1";
const EMPTY_NAMES: AvatarNameFields = { name: "", nickname: "", uniformName: "", shirtNumber: "0" };

type StudioMode = "chara-edit" | "engine3d" | "anim-event" | "dialogue" | "audio-voice" | "paint-studio" | "auras-skills";
type PresetKey = "custom" | "astro-lor" | "aphrodi" | "shawn" | "mark" | "axel";

export interface PlayerStats {
	frappe: number;
	puissance: number;
	precision: number;
	vitesse: number;
	defense: number;
	gardien: number;
}

export interface PlayerPreset {
	id: PresetKey;
	name: string;
	nickname: string;
	uniformName: string;
	shirtNumber: string;
	title: string;
	element: "foret" | "feu" | "vent" | "terre";
	elementLabel: string;
	elementEmoji: string;
	position: "GK" | "FW" | "DF" | "MF";
	quote: string;
	gender: number;
	height: number;
	selections: Record<number, string>;
	baseStats: PlayerStats;
	keshin: {
		name: string;
		code: string;
		desc: string;
		auraColor: string;
		boost: Partial<PlayerStats>;
		techName: string;
		techPower: number;
	};
	techniques: Array<{
		id: string;
		name: string;
		type: "Tir" | "Arrêt" | "Dribble" | "Défense" | "Keshin";
		element: "foret" | "feu" | "vent" | "terre";
		tp: number;
		power: number;
		videoUrl?: string;
		motionId?: string;
		desc: string;
	}>;
}

export interface MixiMaxOption {
	id: string;
	name: string;
	code: string;
	desc: string;
	auraColor: string;
	boost: PlayerStats;
}

const MIXI_MAX_OPTIONS: MixiMaxOption[] = [
	{
		id: "master-dragon",
		name: "Master Dragon",
		code: "0xA5C69DB2",
		desc: "Fusion légendaire Chrono Stone via Heka (Puissance Draconique)",
		auraColor: "#f59e0b",
		boost: { frappe: 20, puissance: 50, precision: 25, vitesse: 20, defense: 30, gardien: 45 },
	},
	{
		id: "shawn-froste",
		name: "Shawn Froste",
		code: "0x056F6CFC",
		desc: "Vitesse et rigueur glaciale du nord (Blizzard & Loup Arctique)",
		auraColor: "#38bdf8",
		boost: { frappe: 40, puissance: 25, precision: 30, vitesse: 45, defense: 35, gardien: 10 },
	},
	{
		id: "celia-hills",
		name: "Celia Hills",
		code: "0xFFCE6BFF",
		desc: "Vision stratégique et analyse de jeu (Anticipation Divine)",
		auraColor: "#10b981",
		boost: { frappe: 15, puissance: 20, precision: 50, vitesse: 30, defense: 35, gardien: 25 },
	},
	{
		id: "asta-lor",
		name: "Asta Lor",
		code: "0x8DC4DA83",
		desc: "Résonance de l'âme jumelle d'Astro (Harmonie Totale)",
		auraColor: "#a855f7",
		boost: { frappe: 35, puissance: 35, precision: 35, vitesse: 35, defense: 35, gardien: 35 },
	},
];

const PLAYER_PRESETS: Record<Exclude<PresetKey, "custom">, PlayerPreset> = {
	"astro-lor": {
		id: "astro-lor",
		name: "Astro Lor",
		nickname: "Astro",
		uniformName: "Astro",
		shirtNumber: "1",
		title: "Gardien Forêt Céleste (OC)",
		element: "foret",
		elementLabel: "Bois / Forêt",
		elementEmoji: "🌲",
		position: "GK",
		quote: "Morphée me prête sa force. Le football transcende le temps et les dimensions !",
		gender: 0,
		height: 7,
		selections: {
			1: "edit_face_01",
			3: "edit_body_male_01",
			4: "edit_hair_09",
			6: "edit_eye_04",
			17: "body-male",
			19: "uniform_01",
			20: "shoes_01",
		},
		baseStats: { frappe: 95, puissance: 160, precision: 140, vitesse: 130, defense: 175, gardien: 198 },
		keshin: {
			name: "Morphée, le Dieu des Rêves",
			code: "0xCFD002A0",
			desc: "Aura onirique impénétrable de Morphée • Bouclier astral",
			auraColor: "#a855f7",
			boost: { gardien: 40, puissance: 30, defense: 25 },
			techName: "Vœux Précieux (ock6006)",
			techPower: 420,
		},
		techniques: [
			{
				id: "who01060",
				name: "Sauve-cabri",
				type: "Arrêt",
				element: "foret",
				tp: 70,
				power: 180,
				videoUrl: "/assets/skills/who01060/video.webm",
				motionId: "waza_who01060",
				desc: "Cinématique 5 cuts • Événement ev61_01060 • Bond félin protecteur",
			},
			{
				id: "who01360",
				name: "Cabriole de la biche",
				type: "Défense",
				element: "foret",
				tp: 100,
				power: 260,
				videoUrl: "/assets/skills/who01360/video.webm",
				motionId: "waza_who01360",
				desc: "Cinématique 6 cuts • Événement ev61_01360 • Esquive aérienne majestueuse",
			},
			{
				id: "ock6006",
				name: "Vœux Précieux (Morphée)",
				type: "Keshin",
				element: "foret",
				tp: 80,
				power: 420,
				videoUrl: "/assets/oc/astro-lor/source/skills/aura_soul.webm",
				motionId: "aura_keshin",
				desc: "Supertechnique d'arrêt Keshin ultime • Barrière onirique infranchissable",
			},
		],
	},
	aphrodi: {
		id: "aphrodi",
		name: "Byron Love",
		nickname: "Aphrodi",
		uniformName: "Love",
		shirtNumber: "10",
		title: "Attaquant Divin & Capitaine de Zeus",
		element: "foret",
		elementLabel: "Bois / Céleste",
		elementEmoji: "🪽",
		position: "FW",
		quote: "Nos ailes célestes ne connaissent aucune entrave. Admirez la perfection du Savoir Divin !",
		gender: 0,
		height: 8,
		selections: {
			1: "edit_face_02",
			4: "edit_hair_02",
			6: "edit_eye_01",
			17: "body-male",
			19: "uniform_04",
			20: "shoes_02",
		},
		baseStats: { frappe: 195, puissance: 155, precision: 185, vitesse: 170, defense: 145, gardien: 90 },
		keshin: {
			name: "Ailes Divines d'Aphrodi",
			code: "0xAF0D1100",
			desc: "Aura céleste étincelante de Zeus • Perfection divine",
			auraColor: "#ffd700",
			boost: { frappe: 45, precision: 35, vitesse: 30 },
			techName: "Savoir Divin Suprême",
			techPower: 450,
		},
		techniques: [
			{
				id: "who00500",
				name: "Savoir Divin (God Knows)",
				type: "Tir",
				element: "foret",
				tp: 70,
				power: 210,
				desc: "Déploie des ailes de lumière immaculée pour foudroyer les filets",
			},
			{
				id: "who00510",
				name: "Instant Céleste (Heaven's Time)",
				type: "Dribble",
				element: "foret",
				tp: 60,
				power: 190,
				desc: "Fige le temps dans un claquement de doigts souverain",
			},
			{
				id: "who00520",
				name: "Tir Chaotique (Chaos Break)",
				type: "Tir",
				element: "foret",
				tp: 85,
				power: 280,
				desc: "Trinité divine avec Gazelle et Torch fendant l'espace",
			},
		],
	},
	shawn: {
		id: "shawn",
		name: "Shawn Froste",
		nickname: "Fubuki",
		uniformName: "Froste",
		shirtNumber: "9",
		title: "Attaquant / Libéro Polyvalent (Double Âme)",
		element: "vent",
		elementLabel: "Vent / Glace",
		elementEmoji: "❄️",
		position: "DF",
		quote: "Le vent glacé du nord souffle à travers mon cœur... Loup Légendaire !",
		gender: 0,
		height: 6,
		selections: {
			1: "edit_face_03",
			4: "edit_hair_04",
			6: "edit_eye_03",
			17: "body-male",
			19: "uniform_02",
			20: "shoes_01",
		},
		baseStats: { frappe: 188, puissance: 165, precision: 160, vitesse: 192, defense: 180, gardien: 105 },
		keshin: {
			name: "Loup Hurlant Légendaire",
			code: "0xFB090001",
			desc: "Aura arctique sauvage des sommets enneigés d'Hokkaido",
			auraColor: "#38bdf8",
			boost: { vitesse: 40, frappe: 35, defense: 35 },
			techName: "Hurlement Boréal",
			techPower: 430,
		},
		techniques: [
			{
				id: "who00600",
				name: "Loup Légendaire (Wolf Legend)",
				type: "Tir",
				element: "vent",
				tp: 75,
				power: 230,
				desc: "Les crocs acérés du loup blanc s'abattent sur la cage",
			},
			{
				id: "who00610",
				name: "Patinoire (Ice Ground)",
				type: "Défense",
				element: "vent",
				tp: 55,
				power: 175,
				desc: "Plaque de verglas immobilisant net le joueur adverse",
			},
			{
				id: "who00620",
				name: "Ange des Neiges (Snow Angel)",
				type: "Défense",
				element: "vent",
				tp: 65,
				power: 200,
				desc: "Tempête de givre immaculé enfermant la trajectoire",
			},
		],
	},
	mark: {
		id: "mark",
		name: "Mark Evans",
		nickname: "Endo",
		uniformName: "Evans",
		shirtNumber: "1",
		title: "Gardien Légendaire & Capitaine Éternel",
		element: "terre",
		elementLabel: "Terre / Foudre",
		elementEmoji: "⚡",
		position: "GK",
		quote: "Jouons au football ! Le foot ne nous trahira jamais, donnons tout jusqu'à la dernière seconde !",
		gender: 0,
		height: 7,
		selections: {
			1: "edit_face_01",
			4: "edit_hair_01",
			6: "edit_eye_02",
			17: "body-male",
			19: "uniform_01",
			20: "shoes_01",
		},
		baseStats: { frappe: 110, puissance: 190, precision: 145, vitesse: 125, defense: 185, gardien: 205 },
		keshin: {
			name: "Majin, le Grand Génie",
			code: "0xED010001",
			desc: "Aura titanesque du démon d'or protecteur de la cage",
			auraColor: "#f59e0b",
			boost: { gardien: 45, puissance: 40, defense: 30 },
			techName: "Main Oméga Divine",
			techPower: 460,
		},
		techniques: [
			{
				id: "who00010",
				name: "Main Céleste (God Hand)",
				type: "Arrêt",
				element: "terre",
				tp: 40,
				power: 150,
				desc: "Main colossale d'or pur surgissant du cœur pour stopper le ballon",
			},
			{
				id: "who00015",
				name: "Main Démoniaque (Majin The Hand)",
				type: "Arrêt",
				element: "terre",
				tp: 80,
				power: 250,
				desc: "Apparition du démon géant concentrant l'énergie dans son torse",
			},
			{
				id: "who00018",
				name: "Poing de la Justice",
				type: "Arrêt",
				element: "terre",
				tp: 65,
				power: 210,
				desc: "Coup de poing aérien rotatif désintégrant la frappe adverse",
			},
			{
				id: "who00019",
				name: "Tête Explosive (Megaton Head)",
				type: "Tir",
				element: "terre",
				tp: 50,
				power: 160,
				desc: "Coup de boule surpuissant renvoyant la balle avec une énergie tellurique",
			},
		],
	},
	axel: {
		id: "axel",
		name: "Axel Blaze",
		nickname: "Gouenji",
		uniformName: "Blaze",
		shirtNumber: "10",
		title: "Buteur de Feu Suprême de Raimon",
		element: "feu",
		elementLabel: "Feu / Incandescent",
		elementEmoji: "🔥",
		position: "FW",
		quote: "Enflamme ton cœur sur le terrain ! Tornade de Feu !",
		gender: 0,
		height: 7,
		selections: {
			1: "edit_face_02",
			4: "edit_hair_03",
			6: "edit_eye_01",
			17: "body-male",
			19: "uniform_01",
			20: "shoes_02",
		},
		baseStats: { frappe: 205, puissance: 170, precision: 175, vitesse: 180, defense: 120, gardien: 85 },
		keshin: {
			name: "Enma Gouen, Seigneur du Brasier",
			code: "0xGJ100001",
			desc: "Aura volcanique en fusion dévorant tout sur son passage",
			auraColor: "#ef4444",
			boost: { frappe: 50, puissance: 30, vitesse: 30 },
			techName: "Flamme Solaire Ultime",
			techPower: 470,
		},
		techniques: [
			{
				id: "who00020",
				name: "Tornade de Feu (Fire Tornado)",
				type: "Tir",
				element: "feu",
				tp: 50,
				power: 170,
				desc: "Vrille ardente dans les cieux illuminant le stade",
			},
			{
				id: "who00025",
				name: "Tempête de Feu (Bakunetsu Storm)",
				type: "Tir",
				element: "feu",
				tp: 75,
				power: 240,
				desc: "Appel du géant de flammes pour projeter la frappe à mach 2",
			},
			{
				id: "who00028",
				name: "Tourbillon de Feu (Bakunetsu Screw)",
				type: "Tir",
				element: "feu",
				tp: 70,
				power: 220,
				desc: "Spirale incandescente forant la cage comme une torche solaire",
			},
			{
				id: "who00030",
				name: "Flamme Double (Fire Tornado DD)",
				type: "Tir",
				element: "feu",
				tp: 90,
				power: 300,
				desc: "Frappe synchronisée à deux créant un cataclysme de flammes",
			},
		],
	},
};

function computeRank(combatPower: number): string {
	if (combatPower >= 1800) return "DIVIN";
	if (combatPower >= 1500) return "SSS";
	if (combatPower >= 1300) return "SS";
	if (combatPower >= 1100) return "S";
	if (combatPower >= 900) return "A";
	if (combatPower >= 700) return "B";
	if (combatPower >= 500) return "C";
	return "D";
}

function computePlayerStats(
	base: PlayerStats,
	level: number,
	keshinActive: boolean,
	keshinBoost: Partial<PlayerStats>,
	mixiMaxBoost: PlayerStats | null
): { currentStats: PlayerStats; scaledBase: PlayerStats; combatPower: number; rank: string } {
	const scale = 0.25 + 0.75 * (level / 99);
	const scaledBase: PlayerStats = {
		frappe: Math.round(base.frappe * scale),
		puissance: Math.round(base.puissance * scale),
		precision: Math.round(base.precision * scale),
		vitesse: Math.round(base.vitesse * scale),
		defense: Math.round(base.defense * scale),
		gardien: Math.round(base.gardien * scale),
	};

	const currentStats: PlayerStats = { ...scaledBase };
	if (keshinActive) {
		for (const key of Object.keys(scaledBase) as (keyof PlayerStats)[]) {
			if (keshinBoost[key]) {
				currentStats[key] += keshinBoost[key]!;
			}
		}
	}
	if (mixiMaxBoost) {
		for (const key of Object.keys(scaledBase) as (keyof PlayerStats)[]) {
			currentStats[key] += mixiMaxBoost[key];
		}
	}

	const sumStats = Object.values(currentStats).reduce((a, b) => a + b, 0);
	const bonus = (keshinActive ? 350 : 0) + (mixiMaxBoost ? 300 : 0);
	const combatPower = sumStats + bonus;
	const rank = computeRank(combatPower);

	return { currentStats, scaledBase, combatPower, rank };
}


const nativeText = (text: string, options?: { color?: number; height?: number; width?: number }) => (
	<NativeText text={text} {...options} color={(((options?.color ?? 0xffffff) << 8) | 255) >>> 0} />
);
type AvatarScenes = Record<Stage, NativeMenuScene>;

// ── Types & Catalogues d'Animation G4MT/G4MA & Scénarios T2B ───────────────

export interface MotionDef {
	id: string;
	labelFr: string;
	labelJa: string;
	g4mtId: string;
	format: "G4MT" | "G4MA";
	durationFrames: number;
	fps: number;
	loop: boolean;
	targetRig: string;
	targetedBones: string[];
	blendMode: "Hermite Cubic" | "Linear Spline" | "Multi-Axis Additive" | "Morph Target Blend";
	description: string;
	category: "base" | "hissatsu" | "aura";
	soundCue?: string;
	vfxCue?: string;
	eventId?: string;
}

export interface EventCut {
	id: string; // "c0100" .. "c0600"
	name: string;
	nameJa: string;
	startFrame: number;
	endFrame: number;
	durationFrames: number;
	cameraG4cm: {
		fov: number;
		camPos: [number, number, number];
		targetPos: [number, number, number];
		trajectory: string;
		rollDeg: number;
	};
	vfxEff: {
		file: string;
		label: string;
		triggerFrame: number;
	}[];
	audioSfx: {
		file: string;
		label: string;
		triggerFrame: number;
	}[];
	notes: string;
}

export interface CinematicEventScenario {
	eventId: string;
	title: string;
	titleJa: string;
	motionId: string;
	totalFrames: number;
	videoUrl: string;
	element: "Vent" | "Forêt" | "Lumière" | "Glace";
	hissatsuName: string;
	cuts: EventCut[];
}

export const MOTIONS_CATALOG: MotionDef[] = [
	{
		id: "idle",
		labelFr: "Match Idle (Attente active)",
		labelJa: "試合待機モーション",
		g4mtId: "mt_c990_idle01.g4mt",
		format: "G4MT",
		durationFrames: 60,
		fps: 60,
		loop: true,
		targetRig: "sk_male_01",
		targetedBones: ["Bone_Spine", "Bone_Pelvis", "Bone_Clavicle_L/R", "Bone_Head"],
		blendMode: "Hermite Cubic",
		description: "Posture d'attente nerveuse et rebondissante sur appuis plantaires, respiration synchronisée.",
		category: "base",
		soundCue: "soccer10_01_whistle",
	},
	{
		id: "run",
		labelFr: "Course dynamique (Sprint)",
		labelJa: "ダッシュ・ランニング",
		g4mtId: "mt_c990_run01.g4mt",
		format: "G4MT",
		durationFrames: 24,
		fps: 60,
		loop: true,
		targetRig: "sk_male_01",
		targetedBones: ["Bone_Thigh_L/R", "Bone_Shin_L/R", "Bone_UpperArm_L/R", "Bone_Spine"],
		blendMode: "Linear Spline",
		description: "Sprint d'accélération avec inclinaison du torse à 18° et foulées régulières de contre-attaque.",
		category: "base",
		soundCue: "soccer10_01_whoosh_high",
	},
	{
		id: "waza_who01060",
		labelFr: "Dribble Sauve-cabri (who01060)",
		labelJa: "そよヤギステップ",
		g4mtId: "who01060_motion.g4mt",
		format: "G4MA",
		durationFrames: 180,
		fps: 60,
		loop: false,
		targetRig: "sk_male_01 + prop_goat",
		targetedBones: ["Bone_Root", "Bone_Spine", "Bone_Arm_L/R", "Prop_Goat_Root"],
		blendMode: "Morph Target Blend",
		description: "Esquive bondissante feutrée protégeant le jeune cabri apparu par surprise sur le gazon.",
		category: "hissatsu",
		soundCue: "soccer10_01_whoosh_high",
		vfxCue: "eff/eff_who01060_01.g4tx",
		eventId: "ev61_01060",
	},
	{
		id: "waza_who01360",
		labelFr: "Dribble Cabriole de la biche (who01360)",
		labelJa: "カモシカ・カブリオール",
		g4mtId: "who01360_motion.g4mt",
		format: "G4MA",
		durationFrames: 210,
		fps: 60,
		loop: false,
		targetRig: "sk_male_01",
		targetedBones: ["Bone_Pelvis", "Bone_Spine", "Bone_Leg_L/R", "Bone_Foot_L/R"],
		blendMode: "Multi-Axis Additive",
		description: "Élévation majestueuse en suspension rotative franchissant l'ensemble de la défense adverse.",
		category: "hissatsu",
		soundCue: "soccer10_01_kick_impact",
		vfxCue: "eff/eff_who01360_02.g4tx",
		eventId: "ev61_01360",
	},
	{
		id: "victory",
		labelFr: "Célébration poing levé (Victory)",
		labelJa: "ガッツポーズ・歓喜",
		g4mtId: "mt_c990_vic01.g4mt",
		format: "G4MT",
		durationFrames: 150,
		fps: 60,
		loop: false,
		targetRig: "sk_male_01",
		targetedBones: ["Bone_Arm_R", "Bone_Fingers_R", "Bone_Head", "Bone_Spine"],
		blendMode: "Hermite Cubic",
		description: "Saut d'exultation spontané après le but, poing droit levé fièrement vers les tribunes.",
		category: "base",
		soundCue: "soccer10_01_whistle",
	},
	{
		id: "ock6006",
		labelFr: "Arrêt divin Morphée (ock6006 - Vœux Précieux)",
		labelJa: "プレシャス・ウィッシュ",
		g4mtId: "ock6006_motion.g4mt",
		format: "G4MA",
		durationFrames: 240,
		fps: 60,
		loop: false,
		targetRig: "sk_male_01 + rig_keshin_morphee",
		targetedBones: ["Bone_Chest", "Bone_Hand_L/R", "Keshin_Spine", "Keshin_Wing_L/R"],
		blendMode: "Multi-Axis Additive",
		description: "Matérialisation de l'aura protectrice de Morphée formant un bouclier d'étoiles infranchissable.",
		category: "aura",
		soundCue: "soccer10_01_catch_thunder",
		vfxCue: "eff/eff_ock6006_wing.g4tx",
		eventId: "ev61_ock6006",
	},
	{
		id: "god_knows",
		labelFr: "Tir céleste : Savoir Divin (God Knows)",
		labelJa: "ゴッドノウズ",
		g4mtId: "godknows_motion.g4mt",
		format: "G4MA",
		durationFrames: 360,
		fps: 60,
		loop: false,
		targetRig: "sk_male_01 + rig_six_wings",
		targetedBones: ["Bone_Wing_1..6", "Bone_Spine", "Bone_Leg_R", "Bone_Foot_R"],
		blendMode: "Morph Target Blend",
		description: "Déploiement des 6 ailes immaculées d'Aphrodi, ascension sacrée et frappe météorique de lumière pure.",
		category: "hissatsu",
		soundCue: "soccer10_01_charge_aura",
		vfxCue: "eff/eff_godknows_feather.g4tx",
		eventId: "ev61_godknows",
	},
];

export const CINEMATIC_SCENARIOS: Record<string, CinematicEventScenario> = {
	ev61_01060: {
		eventId: "ev61_01060",
		title: "Supertechnique : Sauve-cabri",
		titleJa: "そよヤギステップ (who01060)",
		motionId: "waza_who01060",
		totalFrames: 180,
		videoUrl: "/assets/skills/who01060/video.webm",
		element: "Vent",
		hissatsuName: "Sauve-cabri",
		cuts: [
			{
				id: "c0100",
				name: "Cadrage initial & Conduite de balle",
				nameJa: "導入・ドリブル進入",
				startFrame: 0,
				endFrame: 30,
				durationFrames: 30,
				cameraG4cm: {
					fov: 42,
					camPos: [-1.2, 0.4, 2.8],
					targetPos: [0, 0.9, 0],
					trajectory: "Travelling raz du sol",
					rollDeg: -2.5,
				},
				vfxEff: [],
				audioSfx: [{ file: "soccer10_01_whistle", label: "Coup de sifflet", triggerFrame: 2 }],
				notes: "Amorce nerveuse le long de la ligne de touche. Prise d'élan.",
			},
			{
				id: "c0200",
				name: "Surprise : Apparition du chevreau",
				nameJa: "驚き・子ヤギ出現",
				startFrame: 30,
				endFrame: 65,
				durationFrames: 35,
				cameraG4cm: {
					fov: 30,
					camPos: [0.8, 1.1, 1.6],
					targetPos: [0.1, 1.05, 0],
					trajectory: "Gros plan expressif",
					rollDeg: 1.0,
				},
				vfxEff: [{ file: "eff/eff_who01060_01.g4tx", label: "Brume pastorale", triggerFrame: 32 }],
				audioSfx: [{ file: "soccer10_01_whoosh_high", label: "Frémissement d'air", triggerFrame: 35 }],
				notes: "Ralenti dramatique sur le regard bienveillant du joueur.",
			},
			{
				id: "c0300",
				name: "Pivot d'esquive & Flexion d'appui",
				nameJa: "ステップ旋回・足元回避",
				startFrame: 65,
				endFrame: 105,
				durationFrames: 40,
				cameraG4cm: {
					fov: 50,
					camPos: [-1.8, 1.8, 2.2],
					targetPos: [0, 0.7, 0],
					trajectory: "Travelling plongé",
					rollDeg: -4.0,
				},
				vfxEff: [{ file: "eff/eff_who01060_01.g4tx", label: "Tourbillon émeraude", triggerFrame: 70 }],
				audioSfx: [{ file: "soccer10_01_charge_aura", label: "Harmonique de vent", triggerFrame: 72 }],
				notes: "Contournement tout en douceur du chevreau en herbe.",
			},
			{
				id: "c0400",
				name: "Envol aérien & Dépassement",
				nameJa: "跳躍・空中突破",
				startFrame: 105,
				endFrame: 140,
				durationFrames: 35,
				cameraG4cm: {
					fov: 58,
					camPos: [2.2, 0.9, -1.5],
					targetPos: [0, 1.4, 0],
					trajectory: "Orbital dynamique 180°",
					rollDeg: 3.2,
				},
				vfxEff: [{ file: "eff/eff_impact_flash.g4tx", label: "Flash de franchissement", triggerFrame: 110 }],
				audioSfx: [{ file: "soccer10_01_whoosh_high", label: "Souffle supersonique", triggerFrame: 108 }],
				notes: "Suspension gracieuse au-dessus de la tête du défenseur médusé.",
			},
			{
				id: "c0500",
				name: "Atterrissage amorti & Éclat d'impact",
				nameJa: "着地・芝生の舞い",
				startFrame: 140,
				endFrame: 165,
				durationFrames: 25,
				cameraG4cm: {
					fov: 45,
					camPos: [-0.6, 0.3, 2.4],
					targetPos: [0, 0.6, 0],
					trajectory: "Plan large d'impact",
					rollDeg: 0,
				},
				vfxEff: [{ file: "eff/eff_who01060_01.g4tx", label: "Gerbe de brins d'herbe", triggerFrame: 142 }],
				audioSfx: [{ file: "soccer10_01_kick_impact", label: "Frappe d'appui", triggerFrame: 141 }],
				notes: "Réception parfaite, talon au sol avec redistribution de trajectoire.",
			},
			{
				id: "c0600",
				name: "Pose victorieuse & Course poursuivie",
				nameJa: "キメポーズ・突破完了",
				startFrame: 165,
				endFrame: 180,
				durationFrames: 15,
				cameraG4cm: {
					fov: 40,
					camPos: [0, 1.2, 3.2],
					targetPos: [0, 1.1, 0],
					trajectory: "Panoramique ascendant",
					rollDeg: 0,
				},
				vfxEff: [],
				audioSfx: [{ file: "soccer10_01_whistle", label: "Sifflet de validation", triggerFrame: 175 }],
				notes: "Clin d'œil complice vers le chevreau qui bêle avec bonheur.",
			},
		],
	},
	ev61_01360: {
		eventId: "ev61_01360",
		title: "Supertechnique : Cabriole de la biche",
		titleJa: "カモシカ・カブリオール (who01360)",
		motionId: "waza_who01360",
		totalFrames: 210,
		videoUrl: "/assets/skills/who01360/video.webm",
		element: "Vent",
		hissatsuName: "Cabriole de la biche",
		cuts: [
			{
				id: "c0100",
				name: "Plein galop & Pression frontale",
				nameJa: "疾走・突風加速",
				startFrame: 0,
				endFrame: 35,
				durationFrames: 35,
				cameraG4cm: {
					fov: 46,
					camPos: [2.5, 0.7, 2.0],
					targetPos: [0, 0.9, 0],
					trajectory: "Travelling accéléré latéral",
					rollDeg: 2.0,
				},
				vfxEff: [{ file: "eff/eff_who01360_02.g4tx", label: "Sillage zéphir", triggerFrame: 10 }],
				audioSfx: [{ file: "soccer10_01_whoosh_high", label: "Bourrasque", triggerFrame: 8 }],
				notes: "Vitesse maximale atteinte. Deux défenseurs serrent la tenaille.",
			},
			{
				id: "c0200",
				name: "Gros plan : Regard perçant de la biche",
				nameJa: "眼光・集中クローズアップ",
				startFrame: 35,
				endFrame: 70,
				durationFrames: 35,
				cameraG4cm: {
					fov: 28,
					camPos: [-0.4, 1.2, 1.4],
					targetPos: [0, 1.15, 0],
					trajectory: "Gros plan expressif dramatique",
					rollDeg: -1.5,
				},
				vfxEff: [],
				audioSfx: [{ file: "soccer10_01_charge_aura", label: "Fréquence magique", triggerFrame: 40 }],
				notes: "Dilatation des pupilles, canalisation de l'énergie sylvestre.",
			},
			{
				id: "c0300",
				name: "Impulsion magique & Ailes de brume",
				nameJa: "跳躍始動・蒼き光芒",
				startFrame: 70,
				endFrame: 115,
				durationFrames: 45,
				cameraG4cm: {
					fov: 52,
					camPos: [0, 0.4, 2.8],
					targetPos: [0, 1.3, 0],
					trajectory: "Travelling ascensionnel",
					rollDeg: 0,
				},
				vfxEff: [{ file: "eff/eff_who01360_02.g4tx", label: "Cristaux de vent turquoise", triggerFrame: 75 }],
				audioSfx: [{ file: "soccer10_01_charge_aura", label: "Montée de puissance", triggerFrame: 72 }],
				notes: "Détente verticale explosive rompant la gravité.",
			},
			{
				id: "c0400",
				name: "Double cabriole rotative 360°",
				nameJa: "旋回宙返り・カブリオール",
				startFrame: 115,
				endFrame: 155,
				durationFrames: 40,
				cameraG4cm: {
					fov: 62,
					camPos: [-2.6, 2.2, -1.0],
					targetPos: [0, 1.6, 0],
					trajectory: "Orbital plongeant 360°",
					rollDeg: 5.0,
				},
				vfxEff: [{ file: "eff/eff_who01360_02.g4tx", label: "Arcs éoliens rotatifs", triggerFrame: 120 }],
				audioSfx: [{ file: "soccer10_01_whoosh_high", label: "Tornade aérienne", triggerFrame: 118 }],
				notes: "Volutes d'énergie cyan encerclant le corps en pleine vrille.",
			},
			{
				id: "c0500",
				name: "Franchissement & Clivage d'impact",
				nameJa: "敵頭上通過・衝撃波",
				startFrame: 155,
				endFrame: 185,
				durationFrames: 30,
				cameraG4cm: {
					fov: 50,
					camPos: [1.8, 1.0, 2.5],
					targetPos: [0, 1.0, 0],
					trajectory: "Plan large d'impact",
					rollDeg: -3.0,
				},
				vfxEff: [{ file: "eff/eff_impact_flash.g4tx", label: "Flash blanc d'impact", triggerFrame: 158 }],
				audioSfx: [{ file: "soccer10_01_kick_impact", label: "Choc cinétique", triggerFrame: 157 }],
				notes: "Les adversaires sont projetés au sol par l'onde de déplacement.",
			},
			{
				id: "c0600",
				name: "Retour au gazon & Poursuite vers le but",
				nameJa: "フィニッシュ・華麗なる帰還",
				startFrame: 185,
				endFrame: 210,
				durationFrames: 25,
				cameraG4cm: {
					fov: 35,
					camPos: [0, 1.0, 3.0],
					targetPos: [0, 1.0, 0],
					trajectory: "Gros plan trois-quarts",
					rollDeg: 0,
				},
				vfxEff: [],
				audioSfx: [{ file: "soccer10_01_whistle", label: "Écho de victoire", triggerFrame: 200 }],
				notes: "Course poursuivie vers la surface de réparation sous les vivats.",
			},
		],
	},
	ev61_ock6006: {
		eventId: "ev61_ock6006",
		title: "Arrêt divin : Morphée (ock6006)",
		titleJa: "プレシャス・ウィッシュ (夢の神モルペウス)",
		motionId: "ock6006",
		totalFrames: 240,
		videoUrl: "/assets/oc/astro-lor/source/skills/aura_soul.webm",
		element: "Forêt",
		hissatsuName: "Vœux Précieux",
		cuts: [
			{
				id: "c0100",
				name: "Garde du gardien sous la transversale",
				nameJa: "構え・ゴール前精神統一",
				startFrame: 0,
				endFrame: 40,
				durationFrames: 40,
				cameraG4cm: {
					fov: 38,
					camPos: [0, 1.1, 3.4],
					targetPos: [0, 1.0, 0],
					trajectory: "Plan moyen centré",
					rollDeg: 0,
				},
				vfxEff: [],
				audioSfx: [{ file: "soccer10_01_charge_aura", label: "Bourdonnement grave", triggerFrame: 15 }],
				notes: "Face au boulet de canon ennemi arrivant à 180 km/h.",
			},
			{
				id: "c0200",
				name: "Éveil de l'âme jumelle & Halo pourpre",
				nameJa: "魂の共鳴・双子星の輝き",
				startFrame: 40,
				endFrame: 80,
				durationFrames: 40,
				cameraG4cm: {
					fov: 26,
					camPos: [-0.3, 1.25, 1.2],
					targetPos: [0, 1.2, 0],
					trajectory: "Gros plan expressif mystique",
					rollDeg: 2.0,
				},
				vfxEff: [{ file: "eff/eff_ock6006_wing.g4tx", label: "Onde violette onirique", triggerFrame: 45 }],
				audioSfx: [{ file: "soccer10_01_charge_aura", label: "Vibration de cristal", triggerFrame: 42 }],
				notes: "Les yeux d'Astro s'illuminent de la lueur stellaire d'Asta.",
			},
			{
				id: "c0300",
				name: "Matérialisation du Keshin Morphée",
				nameJa: "化身降臨・夢の神モルペウス",
				startFrame: 80,
				endFrame: 130,
				durationFrames: 50,
				cameraG4cm: {
					fov: 60,
					camPos: [0, 0.2, 3.8],
					targetPos: [0, 2.2, 0],
					trajectory: "Panoramique ascendant colossal",
					rollDeg: 0,
				},
				vfxEff: [{ file: "eff/eff_ock6006_wing.g4tx", label: "Ailes pourpres de géant", triggerFrame: 85 }],
				audioSfx: [{ file: "soccer10_01_catch_thunder", label: "Rugissement de Keshin", triggerFrame: 84 }],
				notes: "Morphée déploie ses immenses mains spectrales au-dessus des cages.",
			},
			{
				id: "c0400",
				name: "Dôme des constellations & Barrière de rêves",
				nameJa: "星空の防壁・夢界結界",
				startFrame: 130,
				endFrame: 175,
				durationFrames: 45,
				cameraG4cm: {
					fov: 65,
					camPos: [-3.0, 1.8, 2.2],
					targetPos: [0, 1.2, 0],
					trajectory: "Travelling orbital large",
					rollDeg: -4.5,
				},
				vfxEff: [{ file: "eff/eff_ock6006_wing.g4tx", label: "Bouclier d'étoiles filantes", triggerFrame: 135 }],
				audioSfx: [{ file: "soccer10_01_whoosh_high", label: "Onde télékinétique", triggerFrame: 132 }],
				notes: "La sphère astrale intercepte et gèle la rotation de la balle.",
			},
			{
				id: "c0500",
				name: "Impact critique & Annihilation de puissance",
				nameJa: "完全捕獲・シュート鎮圧",
				startFrame: 175,
				endFrame: 215,
				durationFrames: 40,
				cameraG4cm: {
					fov: 48,
					camPos: [1.2, 0.8, 2.0],
					targetPos: [0, 0.9, 0],
					trajectory: "Secousse cinématique d'impact",
					rollDeg: 3.0,
				},
				vfxEff: [{ file: "eff/eff_impact_flash.g4tx", label: "Déflagration blanche et violette", triggerFrame: 178 }],
				audioSfx: [{ file: "soccer10_01_kick_impact", label: "Impact d'arrêt lourd", triggerFrame: 177 }],
				notes: "Le tir s'éteint totalement dans les gants dorés d'Astro.",
			},
			{
				id: "c0600",
				name: "Ballon sécurisé dans les bras & Sourire",
				nameJa: "セービング完了・絶対防御",
				startFrame: 215,
				endFrame: 240,
				durationFrames: 25,
				cameraG4cm: {
					fov: 36,
					camPos: [0, 1.1, 2.2],
					targetPos: [0, 1.1, 0],
					trajectory: "Plan buste triomphal",
					rollDeg: 0,
				},
				vfxEff: [],
				audioSfx: [{ file: "soccer10_01_whistle", label: "Coup de sifflet d'arrêt", triggerFrame: 230 }],
				notes: "Morphée replie ses ailes et s'estompe dans la nuit étoilée.",
			},
		],
	},
	ev61_godknows: {
		eventId: "ev61_godknows",
		title: "Tir céleste : Savoir Divin (God Knows)",
		titleJa: "ゴッドノウズ (神のアフロディ)",
		motionId: "god_knows",
		totalFrames: 360,
		videoUrl: "/assets/skills/god_knows/video.webm",
		element: "Lumière",
		hissatsuName: "Savoir Divin",
		cuts: [
			{
				id: "c0100",
				name: "Arrêt du temps : Temps Divin (Heavens Time)",
				nameJa: "時よ止まれ・静寂のプレリュード",
				startFrame: 0,
				endFrame: 60,
				durationFrames: 60,
				cameraG4cm: {
					fov: 40,
					camPos: [0, 1.4, 4.0],
					targetPos: [0, 1.1, 0],
					trajectory: "Plan large majestueux immobile",
					rollDeg: 0,
				},
				vfxEff: [{ file: "eff/eff_godknows_feather.g4tx", label: "Premières plumes blanches", triggerFrame: 30 }],
				audioSfx: [{ file: "soccer10_01_charge_aura", label: "Chœur angélique", triggerFrame: 10 }],
				notes: "Byron Love (Aphrodi) lève un bras vers les cieux. Le stade se fige.",
			},
			{
				id: "c0200",
				name: "Déploiement des 6 ailes de lumière céleste",
				nameJa: "六翼展開・神々しき飛翔",
				startFrame: 60,
				endFrame: 120,
				durationFrames: 60,
				cameraG4cm: {
					fov: 32,
					camPos: [-0.8, 1.3, 2.0],
					targetPos: [0, 1.25, 0],
					trajectory: "Gros plan ascensionnel rotatif",
					rollDeg: -2.0,
				},
				vfxEff: [{ file: "eff/eff_godknows_feather.g4tx", label: "Ailes rayonnantes d'or pur", triggerFrame: 65 }],
				audioSfx: [{ file: "soccer10_01_charge_aura", label: "Vibration divine", triggerFrame: 62 }],
				notes: "Six ailes étincelantes jaillissent du dos d'Aphrodi en un éclat doré.",
			},
			{
				id: "c0300",
				name: "Ascension vers le soleil & Lévitation sacrée",
				nameJa: "太陽への昇天・神の領域",
				startFrame: 120,
				endFrame: 190,
				durationFrames: 70,
				cameraG4cm: {
					fov: 68,
					camPos: [0, 0.4, 4.2],
					targetPos: [0, 3.0, 0],
					trajectory: "Contre-plongée totale zénithale",
					rollDeg: 0,
				},
				vfxEff: [{ file: "eff/eff_godknows_feather.g4tx", label: "Chute de plumes scintillantes", triggerFrame: 125 }],
				audioSfx: [{ file: "soccer10_01_whoosh_high", label: "Ascension éthérée", triggerFrame: 122 }],
				notes: "Aphrodi flotte au zénith du stade baigné d'une clarté surnaturelle.",
			},
			{
				id: "c0400",
				name: "Armement de la frappe divine en apesanteur",
				nameJa: "神撃の構え・光球圧縮",
				startFrame: 190,
				endFrame: 260,
				durationFrames: 70,
				cameraG4cm: {
					fov: 55,
					camPos: [2.8, 2.8, 1.5],
					targetPos: [0, 2.5, 0],
					trajectory: "Plongée dramatique 3/4",
					rollDeg: 4.5,
				},
				vfxEff: [{ file: "eff/eff_godknows_feather.g4tx", label: "Plasma sacré concentré", triggerFrame: 195 }],
				audioSfx: [{ file: "soccer10_01_charge_aura", label: "Sifflement d'énergie divine", triggerFrame: 192 }],
				notes: "Le ballon devient un astre d'or aveuglant prêt à consumer le gardien.",
			},
			{
				id: "c0500",
				name: "Frappe météore & Cataclysme de lumière",
				nameJa: "神罰投下・ゴッドノウズ一撃",
				startFrame: 260,
				endFrame: 315,
				durationFrames: 55,
				cameraG4cm: {
					fov: 75,
					camPos: [0, 0.2, 1.8],
					targetPos: [0, 0.8, -4.0],
					trajectory: "Travelling plongeant d'impact",
					rollDeg: 0,
				},
				vfxEff: [{ file: "eff/eff_impact_flash.g4tx", label: "Supernova blanche et dorée", triggerFrame: 262 }],
				audioSfx: [{ file: "soccer10_01_kick_impact", label: "Tonnerre cataclysmique", triggerFrame: 261 }],
				notes: "Le tir déchire l'air et pulvérise les filets dans une explosion sublime.",
			},
			{
				id: "c0600",
				name: "Descente gracieuse & Regard souverain",
				nameJa: "降臨・完全なる神の勝利",
				startFrame: 315,
				endFrame: 360,
				durationFrames: 45,
				cameraG4cm: {
					fov: 38,
					camPos: [0, 1.2, 2.6],
					targetPos: [0, 1.15, 0],
					trajectory: "Plan moyen de majesté",
					rollDeg: 0,
				},
				vfxEff: [{ file: "eff/eff_godknows_feather.g4tx", label: "Dernière plume flottante", triggerFrame: 320 }],
				audioSfx: [{ file: "soccer10_01_whistle", label: "Sifflet de but divin", triggerFrame: 340 }],
				notes: "Aphrodi se recoiffe avec nonchalance. La grâce absolue triomphe.",
			},
		],
	},
};

function storedDraft(): { state: AvatarState; nameFields: AvatarNameFields } {
	try {
		const raw = localStorage.getItem(DRAFT_KEY);
		if (raw && raw.length <= 65536) {
			const value = JSON.parse(raw);
			if (value.version === 1 && value.state && typeof value.state === "object" && value.nameFields) {
				const fields = value.nameFields;
				if ([fields.name, fields.nickname, fields.uniformName].every((field: unknown) => typeof field === "string" && (field as string).length <= 512)
					&& /^(?:\d{1,2})?$/.test(String(fields.shirtNumber))) {
					return {
						state: value.state,
						nameFields: { name: fields.name, nickname: fields.nickname, uniformName: fields.uniformName, shirtNumber: String(fields.shirtNumber) },
					};
				}
			}
		}
	} catch { /* Fallback to default */ }
	return { state: { ...INITIAL_AVATAR_STATE }, nameFields: { ...EMPTY_NAMES } };
}

export function Avatar({ onBack, gamepadSampler }: { onBack: () => void; gamepadSampler?: ReturnType<typeof createStandardGamepadMenuSampler> }) {
	const [draft] = useState(storedDraft);
	const [state, setState] = useState<AvatarState>(draft.state);
	const [nameFields, setNameFields] = useState<AvatarNameFields>(draft.nameFields);
	const [stage, setStage] = useState<Stage>("style");
	const [studioMode, setStudioMode] = useState<StudioMode>("chara-edit");
	const [preset, setPreset] = useState<PresetKey>("astro-lor");
	const [playerLevel, setPlayerLevel] = useState<number>(99);
	const [keshinActive, setKeshinActive] = useState<boolean>(false);
	const [activeMixiMax, setActiveMixiMax] = useState<string | null>(null);

	const currentPresetData = (preset !== "custom" && PLAYER_PRESETS[preset]) ? PLAYER_PRESETS[preset] : PLAYER_PRESETS["astro-lor"];
	const selectedMixiMax = MIXI_MAX_OPTIONS.find(m => m.id === activeMixiMax) ?? null;

	const { currentStats, scaledBase, combatPower, rank } = computePlayerStats(
		currentPresetData.baseStats,
		playerLevel,
		keshinActive,
		currentPresetData.keshin.boost,
		selectedMixiMax ? selectedMixiMax.boost : null
	);

	const [catalog, setCatalog] = useState<AvatarCatalog | null>(null);
	const [scenes, setScenes] = useState<AvatarScenes | null>(null);
	const [composition, setComposition] = useState<AvatarComposition | null>(null);
	const [catalogError, setCatalogError] = useState(false);
	const [sceneError, setSceneError] = useState(false);
	const [compositionError, setCompositionError] = useState(false);
	const [attempt, setAttempt] = useState(0);

	// ── 3D Engine & Inspector state ──────────────────────────────────────────
	const [cameraFraming, setCameraFraming] = useState<"full" | "face" | "bust" | "feet">("full");
	const [renderMode, setRenderMode] = useState<"pbr" | "wireframe" | "skeleton">("pbr");
	const [lightingScene, setLightingScene] = useState<"stadium" | "studio" | "sunset">("stadium");

	// ── Animation & Event Studio state (G4MT / G4MA / T2B / Video 60fps) ────
	const [activeMotionId, setActiveMotionId] = useState<string>("idle");
	const [motionFrame, setMotionFrame] = useState<number>(0);
	const [isMotionPlaying, setIsMotionPlaying] = useState<boolean>(true);
	const [motionSpeed, setMotionSpeed] = useState<number>(1);
	const [isMotionLoop, setIsMotionLoop] = useState<boolean>(true);

	// Événements cinématiques (T2B Timeline & Cuts)
	const [selectedEventId, setSelectedEventId] = useState<string>("ev61_godknows");
	const [selectedCutIndex, setSelectedCutIndex] = useState<number>(0);
	const [timelineFrame, setTimelineFrame] = useState<number>(0);
	const [isTimelinePlaying, setIsTimelinePlaying] = useState<boolean>(false);
	const [timelineSpeed, setTimelineSpeed] = useState<number>(1);
	const [isTimelineLoop, setIsTimelineLoop] = useState<boolean>(true);

	// Lecteur vidéo cinématique synchronisé & Modes d'affichage
	const [videoViewMode, setVideoViewMode] = useState<"pip" | "split" | "realtime3d" | "videofull">("split");
	const [isVideoLoop, setIsVideoLoop] = useState<boolean>(true);
	const [videoError, setVideoError] = useState<boolean>(false);
	const [playingCinematicVideo, setPlayingCinematicVideo] = useState<string | null>(null);
	const [cinematicTitle, setCinematicTitle] = useState<string>("");
	const videoRef = useRef<HTMLVideoElement | null>(null);
	const fallbackCanvasRef = useRef<HTMLCanvasElement | null>(null);

	// ── Dialogue Studio state ────────────────────────────────────────────────
	const [speakerName, setSpeakerName] = useState<string>("Astro Lor");
	const [dialogueText, setDialogueText] = useState<string>(
		"Les étoiles et le vent guident notre jeu ! Aucun tir ne franchira les rêves sacrés de notre équipe !"
	);
	const [choiceA, setChoiceA] = useState<string>("Affronter le destin avec bravoure");
	const [choiceB, setChoiceB] = useState<string>("Invoquer Morphée, le Dieu des Rêves");
	const [showDialogueOverlay, setShowDialogueOverlay] = useState<boolean>(true);

	// ── Audio & Voice Studio state ───────────────────────────────────────────
	const [playingTrack, setPlayingTrack] = useState<string | null>(null);
	const [isRecording, setIsRecording] = useState<boolean>(false);
	const [recordedAudioUrl, setRecordedAudioUrl] = useState<string | null>(null);
	const [assignedTrigger, setAssignedTrigger] = useState<string>("Supertechnique");
	const mediaRecorderRef = useRef<MediaRecorder | null>(null);
	const audioChunksRef = useRef<Blob[]>([]);

	// ── Texture & Paint Studio state ─────────────────────────────────────────
	const paintCanvasRef = useRef<HTMLCanvasElement | null>(null);
	const [brushColor, setBrushColor] = useState<string>("#01fecc");
	const [brushSize, setBrushSize] = useState<number>(6);
	const [activePaintTool, setActivePaintTool] = useState<"brush" | "eraser">("brush");
	const [isPainting, setIsPainting] = useState<boolean>(false);
	const [eyeColor, setEyeColor] = useState<string>("#38bdf8");
	const [hairColor, setHairColor] = useState<string>("#ffd700");

	// ── Navigation clavier globale ───────────────────────────────────────────
	const back = useCallback(() => {
		if (studioMode !== "chara-edit") {
			setStudioMode("chara-edit");
			return;
		}
		const previous = STAGES[STAGES.indexOf(stage) - 1];
		if (previous) setStage(previous); else onBack();
	}, [stage, studioMode, onBack]);

	useEffect(() => {
		const key = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
			if (document.querySelector('[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"], dialog[open]')) return;
			event.preventDefault(); back();
		};
		window.addEventListener("keydown", key);
		return () => window.removeEventListener("keydown", key);
	}, [back]);

	// ── Chargement des ressources VFS ────────────────────────────────────────
	useEffect(() => {
		const abort = new AbortController();
		setCatalogError(false);
		fetch("/assets/avatar/catalog.json", { signal: abort.signal, headers: { accept: "application/json" } })
			.then(async response => {
				if (!response.ok) throw new Error("Avatar catalogue unavailable");
				return response.json() as Promise<AvatarCatalog>;
			})
			.then(value => { if (!abort.signal.aborted) setCatalog(value); })
			.catch(() => { if (!abort.signal.aborted) setCatalogError(true); });
		return () => abort.abort();
	}, [attempt]);

	useEffect(() => {
		let active = true;
		setSceneError(false);
		Promise.all(STAGES.map(async key => [key, await loadMenuPresentation(SCENES[key])] as const))
			.then(values => { if (active) setScenes(Object.fromEntries(values) as AvatarScenes); })
			.catch(() => { if (active) setSceneError(true); });
		return () => { active = false; };
	}, [attempt]);

	useEffect(() => {
		if (!catalog) return;
		let active = true;
		setCompositionError(false);
		resolveAvatar(catalog, state)
			.then(value => { if (active) setComposition(value); })
			.catch(() => { if (active) setCompositionError(true); });
		return () => { active = false; };
	}, [catalog, state, attempt]);

	useEffect(() => {
		if (!composition) return;
		try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ version: 1, state, nameFields })); } catch { /* Ignore */ }
	}, [state, nameFields, composition]);

	// ── Presets d'Avatars Légendaires ────────────────────────────────────────
	const applyPreset = (key: PresetKey) => {
		setPreset(key);
		setKeshinActive(false);
		setActiveMixiMax(null);
		if (key !== "custom" && PLAYER_PRESETS[key]) {
			const p = PLAYER_PRESETS[key];
			setNameFields({ name: p.name, nickname: p.nickname, uniformName: p.uniformName, shirtNumber: p.shirtNumber });
			setSpeakerName(p.name);
			setDialogueText(p.quote);
			setState(prev => ({
				...prev,
				gender: p.gender,
				height: p.height,
				selections: { ...p.selections },
			}));
		}
	};

	// ── Gestion de l'enregistrement vocal ────────────────────────────────────
	const toggleRecording = async () => {
		if (isRecording) {
			mediaRecorderRef.current?.stop();
			setIsRecording(false);
		} else {
			try {
				const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
				const mediaRecorder = new MediaRecorder(stream);
				mediaRecorderRef.current = mediaRecorder;
				audioChunksRef.current = [];

				mediaRecorder.ondataavailable = event => {
					if (event.data.size > 0) audioChunksRef.current.push(event.data);
				};

				mediaRecorder.onstop = () => {
					const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
					const audioUrl = URL.createObjectURL(audioBlob);
					setRecordedAudioUrl(audioUrl);
					stream.getTracks().forEach(t => t.stop());
				};

				mediaRecorder.start();
				setIsRecording(true);
			} catch (err) {
				alert("Accès au microphone requis pour l'enregistrement studio : " + String(err));
			}
		}
	};

	// ── Gestion du Paint Studio (Canvas 2D) ──────────────────────────────────
	const initPaintCanvas = useCallback(() => {
		const canvas = paintCanvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		// Dessin d'un masque de base du visage
		ctx.fillStyle = "#1e293b";
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		// Repères de visage (Yeux, Bouche)
		ctx.strokeStyle = "rgba(1, 254, 204, 0.25)";
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.ellipse(150, 160, 40, 20, 0, 0, Math.PI * 2);
		ctx.ellipse(362, 160, 40, 20, 0, 0, Math.PI * 2);
		ctx.stroke();
		ctx.beginPath();
		ctx.arc(256, 340, 60, 0.1 * Math.PI, 0.9 * Math.PI);
		ctx.stroke();
	}, []);

	useEffect(() => {
		if (studioMode === "paint-studio") {
			setTimeout(initPaintCanvas, 50);
		}
	}, [studioMode, initPaintCanvas]);

	const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
		setIsPainting(true);
		drawOnCanvas(e);
	};

	const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
		if (!isPainting) return;
		drawOnCanvas(e);
	};

	const handleCanvasMouseUp = () => setIsPainting(false);

	const drawOnCanvas = (e: React.MouseEvent<HTMLCanvasElement>) => {
		const canvas = paintCanvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		const rect = canvas.getBoundingClientRect();
		const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
		const y = ((e.clientY - rect.top) / rect.height) * canvas.height;

		ctx.lineWidth = brushSize;
		ctx.lineCap = "round";
		ctx.lineJoin = "round";

		if (activePaintTool === "eraser") {
			ctx.globalCompositeOperation = "destination-out";
			ctx.beginPath();
			ctx.arc(x, y, brushSize, 0, Math.PI * 2);
			ctx.fill();
		} else {
			ctx.globalCompositeOperation = "source-over";
			ctx.strokeStyle = brushColor;
			ctx.fillStyle = brushColor;
			ctx.beginPath();
			ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
			ctx.fill();
		}
	};

	const applyDecal = (type: "scar" | "warpaint" | "wing" | "star") => {
		const canvas = paintCanvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		ctx.globalCompositeOperation = "source-over";
		ctx.strokeStyle = brushColor;
		ctx.fillStyle = brushColor;
		ctx.lineWidth = 4;

		if (type === "scar") {
			ctx.beginPath();
			ctx.moveTo(130, 120);
			ctx.lineTo(170, 210);
			ctx.stroke();
			ctx.beginPath();
			ctx.moveTo(140, 150);
			ctx.lineTo(160, 155);
			ctx.moveTo(145, 175);
			ctx.lineTo(165, 180);
			ctx.stroke();
		} else if (type === "warpaint") {
			ctx.fillRect(80, 200, 100, 10);
			ctx.fillRect(332, 200, 100, 10);
		} else if (type === "wing") {
			ctx.beginPath();
			ctx.moveTo(330, 130);
			ctx.bezierCurveTo(400, 100, 440, 160, 360, 180);
			ctx.stroke();
		} else if (type === "star") {
			ctx.beginPath();
			ctx.arc(256, 100, 15, 0, Math.PI * 2);
			ctx.fill();
		}
	};

	// ── Exportation GLB 2.0 ──────────────────────────────────────────────────
	const exportGlbModel = () => {
		const activeUrl = composition ? avatarModelUrl(composition) : "/api/v1/3d/c99019010.glb";
		const link = document.createElement("a");
		link.href = activeUrl;
		link.download = `${nameFields.name.toLowerCase().replace(/\s+/g, "_") || "avatar"}.glb`;
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
	};

	// ── Hauteur réelle de la bulle de dialogue ───────────────────────────────
	// La barre de cadrage caméra et la bulle Washa sont deux surcouches ancrées
	// au même bord bas du viewport ; sans cette mesure la bulle recouvrait les
	// boutons de cadrage et les rendait incliquables (cf. avatar-studio.css).
	const bulleDialogueRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		const bulle = bulleDialogueRef.current;
		const zone = bulle?.closest<HTMLElement>(".avatar-studio-viewport-area");
		if (!bulle || !zone) return;
		const publier = () => {
			zone.style.setProperty("--hauteur-bulle-dialogue", `${Math.round(bulle.getBoundingClientRect().height)}px`);
		};
		publier();
		const observateur = new ResizeObserver(publier);
		observateur.observe(bulle);
		return () => {
			observateur.disconnect();
			zone.style.removeProperty("--hauteur-bulle-dialogue");
		};
	}, [showDialogueOverlay, studioMode, dialogueText, choiceA, choiceB]);

	// ── Déclencheur Cinématique / Animation ──────────────────────────────────
	const triggerTechniqueCinematic = (tech: "saute-mouton" | "cabriole" | "morphee") => {
		if (tech === "saute-mouton") {
			setCinematicTitle("Supertechnique : Sauve-cabri (who01060)");
			setPlayingCinematicVideo("/assets/skills/who01060/video.webm");
			setActiveMotionId("waza_who01060");
		} else if (tech === "cabriole") {
			setCinematicTitle("Supertechnique : Cabriole de la biche (who01360)");
			setPlayingCinematicVideo("/assets/skills/who01360/video.webm");
			setActiveMotionId("waza_who01360");
		} else if (tech === "morphee") {
			// La vidéo disponible est celle de la technique who01360 : aucune capture
			// de l'aura Morphée n'est sourcée (cf. auras.keshin.media_source,
			// provenance UNSOURCED dans source/skills/manifest.json).
			setCinematicTitle("Morphée — visuel non sourcé (vidéo who01360 en substitution)");
			setPlayingCinematicVideo("/assets/oc/astro-lor/source/skills/aura_soul.webm");
			setActiveMotionId("aura_keshin");
		}
	};

	const error = catalogError || sceneError || compositionError;
	if (!catalog || !scenes || error) {
		return (
			<section aria-label="Éditeur d’avatar" className="avatar-resource-state">
				<header><button type="button" onClick={back} aria-label="Retour au menu">Retour</button></header>
				{error ? (
					<p role="alert">
						Les ressources de l’avatar n’ont pas pu être chargées.{" "}
						<button type="button" onClick={() => setAttempt(v => v + 1)}>Réessayer</button>
					</p>
				) : (
					<p role="status">Chargement de l’avatar…</p>
				)}
				{compositionError && (
					<button type="button" onClick={() => { setState({ ...INITIAL_AVATAR_STATE }); setNameFields({ ...EMPTY_NAMES }); }}>
						Réinitialiser les choix
					</button>
				)}
			</section>
		);
	}

	const modelViewport = (
		<RustModelViewport
			url={composition ? avatarModelUrl(composition) : null}
			createViewer={createNativeViewer}
			label="Aperçu de l’avatar"
		/>
	);

	return (
		<div className="avatar-studio-container" data-studio-mode={studioMode}>
			{/* ── Top Bar & Studio Mode Switcher ──────────────────────────────── */}
			<header className="avatar-studio-topbar">
				<div className="avatar-studio-brand">
					<button type="button" className="avatar-studio-back-btn" onClick={back} title="Retour au menu principal (Échap)">
						<span aria-hidden="true">◀</span> Retour
					</button>
					<div className="avatar-studio-title">
						<span className="avatar-studio-title-main">Niers Chara Studio</span>
						<span className="avatar-studio-title-sub">Moteur 3D & Création Événementielle Level-5</span>
					</div>
				</div>

				{/* Sélecteur de Studios */}
				<nav className="avatar-studio-tabs" aria-label="Modes de création">
					<button
						type="button"
						className={`avatar-studio-tab-btn ${studioMode === "chara-edit" ? "active" : ""}`}
						onClick={() => setStudioMode("chara-edit")}
					>
						⚽ Chara Edit
					</button>
					<button
						type="button"
						className={`avatar-studio-tab-btn ${studioMode === "engine3d" ? "active" : ""}`}
						onClick={() => setStudioMode("engine3d")}
					>
						🎮 Moteur 3D
					</button>
					<button
						type="button"
						className={`avatar-studio-tab-btn ${studioMode === "anim-event" ? "active" : ""}`}
						onClick={() => setStudioMode("anim-event")}
					>
						🎬 Animations & Événements
					</button>
					<button
						type="button"
						className={`avatar-studio-tab-btn ${studioMode === "dialogue" ? "active" : ""}`}
						onClick={() => setStudioMode("dialogue")}
					>
						💬 Dialogues Washa
					</button>
					<button
						type="button"
						className={`avatar-studio-tab-btn ${studioMode === "audio-voice" ? "active" : ""}`}
						onClick={() => setStudioMode("audio-voice")}
					>
						🎙️ Audio & Voix
					</button>
					<button
						type="button"
						className={`avatar-studio-tab-btn ${studioMode === "paint-studio" ? "active" : ""}`}
						onClick={() => setStudioMode("paint-studio")}
					>
						🎨 Texture Paint Studio
					</button>
					<button
						type="button"
						className={`avatar-studio-tab-btn ${studioMode === "auras-skills" ? "active" : ""}`}
						onClick={() => setStudioMode("auras-skills")}
					>
						⚡ Auras & Keshin
					</button>
				</nav>

				{/* Sélecteur de Presets Rapides */}
				<div className="avatar-studio-presets" aria-label="Présélections de personnages">
					<span style={{ fontSize: 11, color: "#64748b", fontWeight: 700 }}>GABARIT :</span>
					<button
						type="button"
						className={`avatar-preset-btn ${preset === "astro-lor" ? "active" : ""}`}
						onClick={() => applyPreset("astro-lor")}
					>
						⭐ Astro Lor
					</button>
					<button
						type="button"
						className={`avatar-preset-btn ${preset === "aphrodi" ? "active" : ""}`}
						onClick={() => applyPreset("aphrodi")}
					>
						👑 Byron Love
					</button>
					<button
						type="button"
						className={`avatar-preset-btn ${preset === "shawn" ? "active" : ""}`}
						onClick={() => applyPreset("shawn")}
					>
						❄️ Shawn Froste
					</button>
				</div>
			</header>

			{/* ── Main Workspace ─────────────────────────────────────────────── */}
			<main className="avatar-studio-workspace">
				{studioMode === "chara-edit" ? (
					/* ── 1. Mode Chara Edit Pixel-Perfect (Natif Inazuma) ────────── */
					<NativeAvatarEditor
						catalog={catalog}
						state={state}
						onStateChange={setState}
						gamepadSampler={gamepadSampler}
						onBack={back}
						stage={stage}
						onStageChange={setStage}
						scene={scenes[stage]}
						nameFields={nameFields}
						onNameFieldsChange={setNameFields}
						renderText={nativeText}
						model={modelViewport}
					/>
				) : (
					/* ── Modes Studio Développés (Split Panels) ──────────────────── */
					<div className="avatar-studio-split">
						{/* Volet Latéral Interactif */}
						<aside className="avatar-studio-sidebar">
							{studioMode === "engine3d" && (
								/* ── Moteur 3D & Inspecteur ─────────────────────────── */
								<div className="avatar-panel-section">
									<div className="avatar-panel-header">
										<span className="avatar-panel-title">🎮 Moteur & Inspecteur 3D</span>
										<span className="avatar-panel-badge">WebGPU PBR</span>
									</div>

									<div className="avatar-control-group">
										<label className="avatar-control-label">
											<span>Cadrage de la caméra</span>
											<span className="avatar-control-value">{cameraFraming.toUpperCase()}</span>
										</label>
										<div style={{ display: "flex", gap: 6 }}>
											{(["full", "face", "bust", "feet"] as const).map(mode => (
												<button
													key={mode}
													type="button"
													className={`paint-tool-btn ${cameraFraming === mode ? "active" : ""}`}
													onClick={() => setCameraFraming(mode)}
												>
													{mode === "full" ? "Corps" : mode === "face" ? "Visage" : mode === "bust" ? "Buste" : "Pieds"}
												</button>
											))}
										</div>
									</div>

									<div className="avatar-control-group">
										<label className="avatar-control-label">
											<span>Taille & Morphologie</span>
											<span className="avatar-control-value">{state.height ?? 7} / 14</span>
										</label>
										<input
											type="range"
											className="avatar-slider"
											min="0"
											max="14"
											value={state.height ?? 7}
											onChange={e => setState(s => ({ ...s, height: Number(e.target.value) }))}
										/>
									</div>

									<div className="avatar-control-group">
										<label className="avatar-control-label">
											<span>Mode d'Affichage Visuel</span>
										</label>
										<div style={{ display: "flex", gap: 6 }}>
											<button
												type="button"
												className={`paint-tool-btn ${renderMode === "pbr" ? "active" : ""}`}
												onClick={() => setRenderMode("pbr")}
											>
												PBR Ombré
											</button>
											<button
												type="button"
												className={`paint-tool-btn ${renderMode === "wireframe" ? "active" : ""}`}
												onClick={() => setRenderMode("wireframe")}
											>
												Filaire
											</button>
											<button
												type="button"
												className={`paint-tool-btn ${renderMode === "skeleton" ? "active" : ""}`}
												onClick={() => setRenderMode("skeleton")}
											>
												Bones G4SK
											</button>
										</div>
									</div>

									<div className="avatar-control-group">
										<label className="avatar-control-label">
											<span>Éclairage de Scène</span>
										</label>
										<select
											className="avatar-select-input"
											value={lightingScene}
											onChange={e => setLightingScene(e.target.value as any)}
										>
											<option value="stadium">Stade de la Victoire (Plein Jour)</option>
											<option value="studio">Studio de modélisation neutre</option>
											<option value="sunset">Crépuscule dramatique</option>
										</select>
									</div>

									<div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 8 }}>
										<button type="button" className="avatar-action-btn" onClick={exportGlbModel}>
											<span>💾 Exporter le Modèle GLB 2.0</span>
										</button>
										<p style={{ fontSize: 11, color: "#64748b", textAlign: "center" }}>
											Modèle standardisé 3 860 sommets avec squelette sk_male et textures BC7.
										</p>
									</div>
								</div>
							)}

							{studioMode === "anim-event" && (
								/* ── Studio Animation & Événements ─────────────────── */
								<div className="avatar-panel-section">
									<div className="avatar-panel-header">
										<span className="avatar-panel-title">🎬 Animations & Événements</span>
										<span className="avatar-panel-badge">G4MT / T2B</span>
									</div>

									<div className="avatar-control-group">
										<label className="avatar-control-label">
											<span>Motions squelettiques (.g4mt)</span>
										</label>
										{[
											{ id: "idle", label: "Pose d'attente (Match Idle)" },
											{ id: "run", label: "Sprint de terrain (Run)" },
											{ id: "victory", label: "Célébration Poing levé (Victory)" },
										].map(m => (
											<div
												key={m.id}
												className={`audio-track-item ${activeMotionId === m.id ? "playing" : ""}`}
												onClick={() => setActiveMotionId(m.id)}
											>
												<span style={{ fontSize: 12, fontWeight: 600 }}>{m.label}</span>
												<span>{activeMotionId === m.id ? "▶ Actif" : "Choisir"}</span>
											</div>
										))}
									</div>

									<div className="avatar-control-group" style={{ marginTop: 16 }}>
										<label className="avatar-control-label">
											<span>Supertechniques & Cutscenes Réelles (RE)</span>
										</label>
										<div
											className="audio-track-item"
											onClick={() => triggerTechniqueCinematic("saute-mouton")}
										>
											<div>
												<div style={{ fontSize: 12, fontWeight: 700, color: "#01fecc" }}>Sauve-cabri (who01060)</div>
												<div style={{ fontSize: 10, color: "#94a3b8" }}>Cinématique 5 cuts • Événement ev61_01060</div>
											</div>
											<span style={{ fontSize: 11, color: "#ffd700" }}>▶ Jouer</span>
										</div>

										<div
											className="audio-track-item"
											onClick={() => triggerTechniqueCinematic("cabriole")}
										>
											<div>
												<div style={{ fontSize: 12, fontWeight: 700, color: "#01fecc" }}>Cabriole de la biche (who01360)</div>
												<div style={{ fontSize: 10, color: "#94a3b8" }}>Cinématique 6 cuts • Événement ev61_01360</div>
											</div>
											<span style={{ fontSize: 11, color: "#ffd700" }}>▶ Jouer</span>
										</div>

										<div
											className="audio-track-item"
											onClick={() => triggerTechniqueCinematic("morphee")}
										>
											<div>
												<div style={{ fontSize: 12, fontWeight: 700, color: "#a855f7" }}>Aura Keshin Morphée</div>
												<div style={{ fontSize: 10, color: "#94a3b8" }}>Animation d'aura de Soul / Keshin</div>
											</div>
											<span style={{ fontSize: 11, color: "#ffd700" }}>▶ Jouer</span>
										</div>
									</div>

									<div className="avatar-control-group" style={{ marginTop: 16 }}>
										<label className="avatar-control-label">
											<span>Séquenceur de Cuts Cinématiques</span>
										</label>
										<div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
											{["c0100", "c0200", "c0300", "c0400", "c0500", "c0600"].map((cut, idx) => (
												<button
													key={cut}
													type="button"
													className={`paint-tool-btn ${selectedCutIndex === idx ? "active" : ""}`}
													onClick={() => setSelectedCutIndex(idx)}
												>
													Cut {cut}
												</button>
											))}
										</div>
									</div>
								</div>
							)}

							{studioMode === "dialogue" && (
								/* ── Créateur de Dialogues Washa ───────────────────── */
								<div className="avatar-panel-section">
									<div className="avatar-panel-header">
										<span className="avatar-panel-title">💬 Créateur de Dialogues</span>
										<span className="avatar-panel-badge">Washa Engine</span>
									</div>

									<div className="avatar-control-group">
										<label className="avatar-control-label">
											<span>Orateur (Plaque chara_name_tag)</span>
										</label>
										<input
											type="text"
											className="avatar-text-input"
											value={speakerName}
											onChange={e => setSpeakerName(e.target.value)}
										/>
									</div>

									<div className="avatar-control-group">
										<label className="avatar-control-label">
											<span>Texte de Dialogue & Scénarisation</span>
										</label>
										<textarea
											rows={4}
											className="avatar-text-input"
											value={dialogueText}
											onChange={e => setDialogueText(e.target.value)}
										/>
									</div>

									<div className="avatar-control-group">
										<label className="avatar-control-label">
											<span>Option de Choix A</span>
										</label>
										<input
											type="text"
											className="avatar-text-input"
											value={choiceA}
											onChange={e => setChoiceA(e.target.value)}
										/>
									</div>

									<div className="avatar-control-group">
										<label className="avatar-control-label">
											<span>Option de Choix B</span>
										</label>
										<input
											type="text"
											className="avatar-text-input"
											value={choiceB}
											onChange={e => setChoiceB(e.target.value)}
										/>
									</div>

									<div style={{ marginTop: 16 }}>
										<button
											type="button"
											className="avatar-secondary-btn"
											onClick={() => setShowDialogueOverlay(v => !v)}
										>
											{showDialogueOverlay ? "Masquer la Bulle" : "Afficher la Bulle Inazuma"}
										</button>
									</div>
								</div>
							)}

							{studioMode === "audio-voice" && (
								/* ── Studio Audio & Voix ───────────────────────────── */
								<div className="avatar-panel-section">
									<div className="avatar-panel-header">
										<span className="avatar-panel-title">🎙️ Studio Audio & Voix</span>
										<span className="avatar-panel-badge">ACB / AWB / Mic</span>
									</div>

									{/* Enregistreur Vocal Studio */}
									<div className="audio-recorder-widget">
										<div className="audio-record-status">
											{isRecording ? (
												<>
													<div className="recording-indicator" />
													<span style={{ color: "#ef4444" }}>Enregistrement micro en cours…</span>
												</>
											) : (
												<span style={{ color: "#94a3b8" }}>Prêt pour capture vocale</span>
											)}
										</div>

										<div className="avatar-control-group">
											<label className="avatar-control-label">
												<span>Action à associer</span>
											</label>
											<select
												className="avatar-select-input"
												value={assignedTrigger}
												onChange={e => setAssignedTrigger(e.target.value)}
											>
												<option value="Supertechnique">Cri de Supertechnique</option>
												<option value="Engagement">Cri d'engagement de match</option>
												<option value="Passe">Appel de balle</option>
												<option value="Victoire">Célébration de but</option>
											</select>
										</div>

										<button
											type="button"
											className={`avatar-action-btn ${isRecording ? "active" : ""}`}
											style={{ background: isRecording ? "#ef4444" : undefined, color: isRecording ? "#fff" : undefined }}
											onClick={toggleRecording}
										>
											{isRecording ? "⏹ Arrêter l'enregistrement" : "⏺ Enregistrer votre voix"}
										</button>

										{recordedAudioUrl && (
											<div style={{ marginTop: 8 }}>
												<audio controls src={recordedAudioUrl} style={{ width: "100%", height: 36 }} />
												<div style={{ fontSize: 11, color: "#01fecc", marginTop: 4, textAlign: "center" }}>
													✓ Voix enregistrée et assignée à « {assignedTrigger} » !
												</div>
											</div>
										)}
									</div>

									{/* Pistes Musicales Officielles */}
									<div className="avatar-control-group" style={{ marginTop: 20 }}>
										<label className="avatar-control-label">
											<span>Bandes Originales de Match (BGM)</span>
										</label>
										{[
											{ id: "bgm_match_01", title: "Inazuma Eleven VR - Match Theme" },
											{ id: "bgm_god_knows", title: "Savoir Divin - Thème d'Aphrodi" },
											{ id: "bgm_fubuki", title: "La Tempête des Neiges - Shawn Froste" },
										].map(t => (
											<div
												key={t.id}
												className={`audio-track-item ${playingTrack === t.id ? "playing" : ""}`}
												onClick={() => setPlayingTrack(playingTrack === t.id ? null : t.id)}
											>
												<span style={{ fontSize: 12, fontWeight: 600 }}>{t.title}</span>
												<span>{playingTrack === t.id ? "⏸ Stop" : "▶ Écouter"}</span>
											</div>
										))}
									</div>
								</div>
							)}

							{studioMode === "paint-studio" && (
								/* ── Texture & Paint Studio ─────────────────────────── */
								<div className="avatar-panel-section">
									<div className="avatar-panel-header">
										<span className="avatar-panel-title">🎨 Paint & Texture Studio</span>
										<span className="avatar-panel-badge">Canvas 2D / G4TX</span>
									</div>

									{/* Canevas 2D de dessin */}
									<div className="paint-canvas-wrapper">
										<canvas
											ref={paintCanvasRef}
											width={512}
											height={512}
											className="paint-canvas-element"
											onMouseDown={handleCanvasMouseDown}
											onMouseMove={handleCanvasMouseMove}
											onMouseUp={handleCanvasMouseUp}
											onMouseLeave={handleCanvasMouseUp}
										/>
									</div>

									{/* Outils & Pinceaux */}
									<div className="paint-tools-row">
										<button
											type="button"
											className={`paint-tool-btn ${activePaintTool === "brush" ? "active" : ""}`}
											onClick={() => setActivePaintTool("brush")}
										>
											🖌️ Pinceau
										</button>
										<button
											type="button"
											className={`paint-tool-btn ${activePaintTool === "eraser" ? "active" : ""}`}
											onClick={() => setActivePaintTool("eraser")}
										>
											🧹 Gomme
										</button>
										<button type="button" className="paint-tool-btn" onClick={initPaintCanvas}>
											↺ Effacer
										</button>
									</div>

									{/* Nuancier de couleurs */}
									<div className="paint-swatches">
										{["#01fecc", "#ffd700", "#ef4444", "#38bdf8", "#a855f7", "#ffffff", "#000000", "#f59e0b"].map(c => (
											<div
												key={c}
												className={`paint-swatch ${brushColor === c ? "active" : ""}`}
												style={{ background: c }}
												onClick={() => {
													setBrushColor(c);
													setActivePaintTool("brush");
												}}
											/>
										))}
									</div>

									{/* Décalcomanies et Pochoirs Prédéfinis */}
									<div className="avatar-control-group">
										<label className="avatar-control-label">
											<span>Pochoirs et Tatouages Instantanés</span>
										</label>
										<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
											<button type="button" className="paint-tool-btn" onClick={() => applyDecal("scar")}>
												⚡ Cicatrice Guerrier
											</button>
											<button type="button" className="paint-tool-btn" onClick={() => applyDecal("warpaint")}>
												⚔️ Peinture de Guerre
											</button>
											<button type="button" className="paint-tool-btn" onClick={() => applyDecal("wing")}>
												🪽 Aile Divine
											</button>
											<button type="button" className="paint-tool-btn" onClick={() => applyDecal("star")}>
												⭐ Étoile d'Astro
											</button>
										</div>
									</div>

									{/* Teintures Globales */}
									<div className="avatar-control-group" style={{ marginTop: 14 }}>
										<label className="avatar-control-label">
											<span>Teinture des Iris & Cheveux</span>
										</label>
										<div style={{ display: "flex", gap: 8 }}>
											<div style={{ flex: 1 }}>
												<span style={{ fontSize: 10, color: "#94a3b8" }}>Iris :</span>
												<input
													type="color"
													value={eyeColor}
													onChange={e => setEyeColor(e.target.value)}
													style={{ width: "100%", height: 28, borderRadius: 4, border: "none", cursor: "pointer" }}
												/>
											</div>
											<div style={{ flex: 1 }}>
												<span style={{ fontSize: 10, color: "#94a3b8" }}>Cheveux :</span>
												<input
													type="color"
													value={hairColor}
													onChange={e => setHairColor(e.target.value)}
													style={{ width: "100%", height: 28, borderRadius: 4, border: "none", cursor: "pointer" }}
												/>
											</div>
										</div>
									</div>
								</div>
							)}

							{studioMode === "auras-skills" && (
								/* ── Auras & Keshin / Mixi-Max ──────────────────────── */
								<div className="avatar-panel-section">
									<div className="avatar-panel-header">
										<span className="avatar-panel-title">⚡ Auras & Keshin</span>
										<span className="avatar-panel-badge">Soul / Mixi-Max</span>
									</div>

									{/* Keshin Morphée */}
									<div style={{ background: "rgba(168, 85, 247, 0.15)", border: "1px solid #a855f7", borderRadius: 8, padding: 12, marginBottom: 14 }}>
										<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
											<strong style={{ color: "#c084fc", fontSize: 13 }}>Keshin : Morphée, le Dieu des Rêves</strong>
											<span style={{ fontSize: 10, background: "#a855f7", color: "#fff", padding: "2px 6px", borderRadius: 4 }}>
												0xCFD002A0
											</span>
										</div>
										<p style={{ fontSize: 11, color: "#e9d5ff", margin: "6px 0" }}>
											Technique d'arrêt liée : <em>Vœux Précieux (ock6006)</em> • Puissance 80→420.
										</p>
										<button
											type="button"
											className="avatar-action-btn"
											style={{ background: "linear-gradient(135deg, #a855f7 0%, #7e22ce 100%)", color: "#fff" }}
											onClick={() => triggerTechniqueCinematic("morphee")}
										>
											✨ Déclencher l'Aura du Keshin
										</button>
									</div>

									{/* Mixi-Max Fusions */}
									<div className="avatar-control-group">
										<label className="avatar-control-label">
											<span>Fusions Mixi-Max Disponibles</span>
										</label>
										{[
											{ name: "Master Dragon (0xA5C69DB2)", desc: "Fusion légendaire Chrono Stone via Heka" },
											{ name: "Shawn Froste (0x056F6CFC)", desc: "Vitesse et rigueur glaciale du nord" },
											{ name: "Celia Hills (0xFFCE6BFF)", desc: "Vision stratégique et analyse de jeu" },
											{ name: "Asta Lor (0x8DC4DA83)", desc: "Résonance de l'âme jumelle d'Astro" },
										].map(m => (
											<div key={m.name} className="audio-track-item">
												<div>
													<div style={{ fontSize: 12, fontWeight: 700, color: "#cbd5e1" }}>{m.name}</div>
													<div style={{ fontSize: 10, color: "#94a3b8" }}>{m.desc}</div>
												</div>
												<button
													type="button"
													className="avatar-viewport-pill-btn"
													onClick={() => alert(`Aura Mixi-Max ${m.name} fusionnée avec succès !`)}
												>
													Fusionner
												</button>
											</div>
										))}
									</div>

									{/* Supertechniques Liées */}
									<div className="avatar-control-group" style={{ marginTop: 14 }}>
										<label className="avatar-control-label">
											<span>Supertechniques Liées au Profil</span>
										</label>
										<div style={{ display: "flex", gap: 8 }}>
											<button
												type="button"
												className="avatar-secondary-btn"
												onClick={() => triggerTechniqueCinematic("saute-mouton")}
											>
												🌪️ Sauve-cabri (70 TP)
											</button>
											<button
												type="button"
												className="avatar-secondary-btn"
												onClick={() => triggerTechniqueCinematic("cabriole")}
											>
												💨 Cabriole (100 TP)
											</button>
										</div>
									</div>
								</div>
							)}
						</aside>

						{/* ── Viewport Central & Prévisualisation 3D ──────────────── */}
						<div className="avatar-studio-viewport-area">
							{/* Rendu 3D natif via WebGPU / Rust */}
							<div style={{ width: "100%", height: "100%", position: "relative" }}>
								{modelViewport}
							</div>

							{/* Barre de pilules de caméra / vue */}
							<div className="avatar-studio-overlay-controls">
								<span style={{ fontSize: 11, color: "#64748b", fontWeight: 700 }}>CAMÉRA :</span>
								<button
									type="button"
									className={`avatar-viewport-pill-btn ${cameraFraming === "full" ? "active" : ""}`}
									onClick={() => setCameraFraming("full")}
								>
									Corps Entier
								</button>
								<button
									type="button"
									className={`avatar-viewport-pill-btn ${cameraFraming === "face" ? "active" : ""}`}
									onClick={() => setCameraFraming("face")}
								>
									Visage
								</button>
								<button
									type="button"
									className={`avatar-viewport-pill-btn ${cameraFraming === "bust" ? "active" : ""}`}
									onClick={() => setCameraFraming("bust")}
								>
									Buste
								</button>
								<button
									type="button"
									className="avatar-viewport-pill-btn"
									onClick={exportGlbModel}
									title="Télécharger l'avatar en GLB 2.0"
								>
									💾 Exporter GLB
								</button>
							</div>

							{/* Lecteur Vidéo Flottant de Cinématique de Supertechnique */}
							{playingCinematicVideo && (
								<div className="cinematic-video-overlay">
									<div className="cinematic-video-header">
										<span>{cinematicTitle}</span>
										<button
											type="button"
											style={{ background: "transparent", border: "none", color: "#fff", cursor: "pointer", fontWeight: 800 }}
											onClick={() => setPlayingCinematicVideo(null)}
										>
											✕
										</button>
									</div>
									<video
										autoPlay
										controls
										src={playingCinematicVideo}
										className="cinematic-video-player"
										onEnded={() => setPlayingCinematicVideo(null)}
									/>
								</div>
							)}

							{/* Boîte de Dialogue Inazuma Eleven Authentique */}
							{showDialogueOverlay && (studioMode === "dialogue" || studioMode === "anim-event") && (
								<div className="inazuma-dialogue-box" ref={bulleDialogueRef}>
									<div className="inazuma-dialogue-tag">{speakerName}</div>
									<div className="inazuma-dialogue-text">{dialogueText}</div>
									<div className="inazuma-dialogue-choices">
										<button
											type="button"
											className="inazuma-dialogue-choice-btn"
											onClick={() => alert(`Choix validé : « ${choiceA} »`)}
										>
											A: {choiceA}
										</button>
										<button
											type="button"
											className="inazuma-dialogue-choice-btn"
											onClick={() => alert(`Choix validé : « ${choiceB} »`)}
										>
											B: {choiceB}
										</button>
									</div>
								</div>
							)}
						</div>
					</div>
				)}
			</main>
		</div>
	);
}
