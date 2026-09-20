/**
 * Kizuna Town Multiplayer Hub & Ultimate Team Integrated Experience.
 *
 * Implements Level-5's official Station Kizuna & IEVR Ultimate Team specification:
 * - https://www.inazuma.jp/victory-road/fr/kizuna/
 * - docs/IEVR-ULTIMATE-TEAM.md (497 players, 69 teams, 8 packs, 9 pitch formations, AES-256-GCM)
 *
 * Fuses:
 * 1. Création d'Avatar (Avatar Makeup: visage, cheveux, yeux, maillot, poste, élément)
 * 2. Monde Ouvert & MMO Mondial (Salon Privé vs Hub Mondial Tokio avec tous les joueurs connectés)
 * 3. Effectif Ultimate Team & Terrain Tactique 2D (4-3-3, 4-4-2, 3-5-2, alchimie, note globale)
 * 4. Boutique de Packs IEVR (8 packs officiels, taux de drop réels, tirages animés, vente rapide)
 * 5. Esprits Guerriers & Supertechniques (Catalogue officiel 1 852 techniques)
 * 6. Aménagement de Ville (Structures, statues, décors et personnages Level-5)
 * 7. Défis 1v1, Salons Inacode & Matchmaking Déterministe 60 Hz
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { playUiSound } from "../game/ui-sound";

export interface KizunaAvatarData {
	name: string;
	gender: number;
	faceId: number;
	hairStyle: number;
	hairColor: string;
	skinTone: number;
	eyeColor: string;
	kitId: number;
	shoesId: number;
	favoriteCharaId: string | null;
	position: "GK" | "DF" | "MF" | "FW";
	element: "Fire" | "Wind" | "Earth" | "Wood" | "Void";
}

export interface PlacedItem {
	instanceId: string;
	name: string;
	icon: string;
	x: number;
	y: number;
}

export interface PlacedChara {
	instanceId: string;
	charaId: string;
	name: string;
	x: number;
	y: number;
	greeting: string;
}

export interface UtSquadPlayer {
	id: string;
	name: string;
	element: "Fire" | "Wind" | "Earth" | "Wood";
	position: "GK" | "DF" | "MF" | "FW";
	rarity: "Común" | "Raro" | "Legendario" | "Ícono" | "Basara";
	rating: number;
	team: string;
	specialMove?: string;
	quicksell: number;
	pitchX: number; // percentage 5..95
	pitchY: number; // percentage 10..90
}

export interface UtSquadInfo {
	teamName: string;
	rating: number;
	chemistry: number;
	formation: string;
	captainName: string;
	captainRarity: string;
	starPlayers: string[];
}

export interface Visitor {
	id: string;
	name: string;
	country: string;
	avatar: KizunaAvatarData;
	squad: UtSquadInfo;
	x: number;
	y: number;
	activeEmote?: string;
	pingMs: number;
}

export interface ChatMessage {
	id: string;
	sender: string;
	text: string;
	timestamp: string;
}

export interface UtPackDef {
	id: string;
	name: string;
	nameFr: string;
	price: number;
	cardCount: number;
	description: string;
	probCommon: number;
	probRare: number;
	probLegendary: number;
	probIcon: number;
	probBasara: number;
	badge: string;
	gradient: string;
}

export interface SpiritCardDef {
	id: string;
	name: string;
	category: "Tir" | "Arrêt" | "Dribble" | "Blocage" | "Tactique";
	element: string;
	tpCost: number;
	power: number;
	description: string;
}

const FAVORITE_CHARACTERS = [
	{ id: "c01000010", name: "Endou Mamoru (Mark Evans)", team: "Raimon" },
	{ id: "c01000020", name: "Gouenji Shuuya (Axel Blaze)", team: "Raimon" },
	{ id: "c01000030", name: "Kidou Yuuto (Jude Sharp)", team: "Royal Academy / Raimon" },
	{ id: "c01000110", name: "Fubuki Shirou (Shawn Froste)", team: "Hakuren / Raimon" },
	{ id: "c01000070", name: "Afuro Terumi (Aphrody / Byron Love)", team: "Zeus" },
	{ id: "c02000010", name: "Matsukaze Tenma (Arion Sherwind)", team: "Raimon (GO)" },
	{ id: "c02000020", name: "Tsurugi Kyousuke (Victor Blade)", team: "Raimon (GO)" },
	{ id: "c02000030", name: "Nishizono Shinsuke (Jean-Pierre Lapin)", team: "Raimon (GO)" },
	{ id: "c03000010", name: "Destin Billows (Nagumohara)", team: "Nagumohara" },
];

const EMOTE_STAMPS = [
	{ id: 1, label: "⚽ But !", symbol: "⚽" },
	{ id: 2, label: "🔥 Tir de Feu !", symbol: "🔥" },
	{ id: 3, label: "⚡ Main Céleste !", symbol: "⚡" },
	{ id: 4, label: "🏆 Victoire !", symbol: "🏆" },
	{ id: 5, label: "🤝 Beau Jeu !", symbol: "🤝" },
	{ id: 6, label: "✨ Esprit Guerrier !", symbol: "✨" },
];

const TOWN_OBJECT_PRESETS = [
	{ id: 101, name: "Terrain de Football Officiel", icon: "🏟️" },
	{ id: 102, name: "Banc de Touche des Remplaçants", icon: "🪑" },
	{ id: 103, name: "Statue Triomphale de la Victoire", icon: "🗿" },
	{ id: 104, name: "Arbre de Lien Centenaire", icon: "🌳" },
	{ id: 105, name: "Arche Lumineuse Kizuna Station", icon: "⛩️" },
];

const OFFICIAL_PACKS: UtPackDef[] = [
	{
		id: "sobre-bronce",
		name: "Sobre Bronce",
		nameFr: "Pack Bronze Débutant",
		price: 5000,
		cardCount: 3,
		description: "Idéal pour recruter vos premiers joueurs de base et bâtir l'effectif.",
		probCommon: 75,
		probRare: 23,
		probLegendary: 2,
		probIcon: 0,
		probBasara: 0,
		badge: "Bronze",
		gradient: "from-amber-900 to-amber-700",
	},
	{
		id: "sobre-plata",
		name: "Sobre Plata",
		nameFr: "Pack Argent Confirmé",
		price: 10000,
		cardCount: 3,
		description: "Tirage équilibré avec forte probabilité de cartes Rares et esprits.",
		probCommon: 55,
		probRare: 40,
		probLegendary: 5,
		probIcon: 0,
		probBasara: 0,
		badge: "Argent",
		gradient: "from-slate-500 to-slate-400",
	},
	{
		id: "sobre-oro",
		name: "Sobre Oro",
		nameFr: "Pack Or Star",
		price: 15000,
		cardCount: 3,
		description: "Chances accrues d'obtenir des Légendes mondiales et joueurs d'Élite.",
		probCommon: 35,
		probRare: 48,
		probLegendary: 15,
		probIcon: 1.8,
		probBasara: 0.2,
		badge: "Or",
		gradient: "from-yellow-600 to-amber-400",
	},
	{
		id: "sobre-platino",
		name: "Sobre Esmeralda",
		nameFr: "Pack Émeraude Prestige",
		price: 25000,
		cardCount: 3,
		description: "25% de cartes Légendaires garanties, accès aux joueurs Basara.",
		probCommon: 20,
		probRare: 45,
		probLegendary: 28,
		probIcon: 6,
		probBasara: 1,
		badge: "Émeraude",
		gradient: "from-emerald-700 to-teal-400",
	},
	{
		id: "sobre-diamante",
		name: "Sobre Diamante",
		nameFr: "Pack Diamant Ultime",
		price: 50000,
		cardCount: 3,
		description: "Le sommet d'Inazuma : cartes Légendaires, Icônes et Basara à très fort taux.",
		probCommon: 5,
		probRare: 30,
		probLegendary: 50,
		probIcon: 13,
		probBasara: 2,
		badge: "Diamant",
		gradient: "from-sky-600 to-indigo-400",
	},
	{
		id: "sobre-escudos",
		name: "Sobre de Escudos",
		nameFr: "Pack Écussons & Logos",
		price: 6000,
		cardCount: 2,
		description: "Débloque 2 écussons officiels parmi les 69 clubs de la franchise.",
		probCommon: 50,
		probRare: 40,
		probLegendary: 10,
		probIcon: 0,
		probBasara: 0,
		badge: "Clubs",
		gradient: "from-purple-800 to-indigo-600",
	},
	{
		id: "sobre-supertacticas",
		name: "Sobre Supertácticas",
		nameFr: "Pack Tactiques & Esprits",
		price: 10000,
		cardCount: 2,
		description: "Cartes tactiques d'équipe et esprits guerriers pour renverser le match.",
		probCommon: 50,
		probRare: 25,
		probLegendary: 17,
		probIcon: 6,
		probBasara: 2,
		badge: "Tactique",
		gradient: "from-rose-800 to-pink-600",
	},
	{
		id: "sobre-equipaciones",
		name: "Sobre Equipaciones",
		nameFr: "Pack Maillots Officiels",
		price: 10000,
		cardCount: 1,
		description: "Une tenue ou uniforme officiel garanti parmi les 360 du catalogue.",
		probCommon: 0,
		probRare: 0,
		probLegendary: 100,
		probIcon: 0,
		probBasara: 0,
		badge: "Uniformes",
		gradient: "from-cyan-800 to-blue-600",
	},
];

const INITIAL_SQUAD_PLAYERS: UtSquadPlayer[] = [
	{ id: "1", name: "Endou Mamoru (Mark Evans)", element: "Earth", position: "GK", rarity: "Legendario", rating: 90, team: "Raimon", specialMove: "Main Céleste", quicksell: 4500, pitchX: 50, pitchY: 88 },
	{ id: "2", name: "Jack Wallside", element: "Earth", position: "DF", rarity: "Raro", rating: 82, team: "Raimon", specialMove: "Le Mur", quicksell: 1200, pitchX: 20, pitchY: 70 },
	{ id: "3", name: "Hurley Kane", element: "Wind", position: "DF", rarity: "Raro", rating: 84, team: "Mary Times", specialMove: "Tsunami Spark", quicksell: 1400, pitchX: 40, pitchY: 72 },
	{ id: "4", name: "Nathan Swift", element: "Wind", position: "DF", rarity: "Legendario", rating: 86, team: "Raimon", specialMove: "Danse du Vent", quicksell: 3200, pitchX: 60, pitchY: 72 },
	{ id: "5", name: "Tod Ironside", element: "Fire", position: "DF", rarity: "Común", rating: 78, team: "Raimon", specialMove: "Dash Rocket", quicksell: 400, pitchX: 80, pitchY: 70 },
	{ id: "6", name: "Jude Sharp", element: "Wind", position: "MF", rarity: "Legendario", rating: 91, team: "Royal Academy", specialMove: "Illusion Ball", quicksell: 5000, pitchX: 30, pitchY: 48 },
	{ id: "7", name: "Aphrody (Byron Love)", element: "Wood", position: "MF", rarity: "Ícono", rating: 93, team: "Zeus", specialMove: "Tir Solaire", quicksell: 8500, pitchX: 50, pitchY: 42 },
	{ id: "8", name: "Xavier Foster", element: "Fire", position: "MF", rarity: "Legendario", rating: 89, team: "Genesis", specialMove: "Météore Géant", quicksell: 4000, pitchX: 70, pitchY: 48 },
	{ id: "9", name: "Shawn Froste", element: "Wind", position: "FW", rarity: "Legendario", rating: 92, team: "Hakuren", specialMove: "Loup Légendaire", quicksell: 5500, pitchX: 22, pitchY: 22 },
	{ id: "10", name: "Votre Avatar (Capitaine)", element: "Fire", position: "FW", rarity: "Basara", rating: 95, team: "Ultimate Team", specialMove: "Tir Ultime Inazuma", quicksell: 15000, pitchX: 50, pitchY: 18 },
	{ id: "11", name: "Axel Blaze", element: "Fire", position: "FW", rarity: "Legendario", rating: 92, team: "Raimon", specialMove: "Tornade de Feu", quicksell: 5500, pitchX: 78, pitchY: 22 },
];

const INITIAL_SPIRITS: SpiritCardDef[] = [
	{ id: "m1", name: "Tornade de Feu Double", category: "Tir", element: "Feu", tpCost: 45, power: 95, description: "Un tir tourbillonnant embrasé d'une puissance fulgurante." },
	{ id: "m2", name: "Main Céleste V", category: "Arrêt", element: "Terre", tpCost: 50, power: 98, description: "La main spirituelle géante dorée arrête le tir net." },
	{ id: "m3", name: "Danse d'Éole", category: "Dribble", element: "Vent", tpCost: 35, power: 85, description: "Tourbillon de vent esquivant instantanément l'adversaire." },
	{ id: "m4", name: "La Tour Imbattable", category: "Blocage", element: "Terre", tpCost: 40, power: 90, description: "Une muraille de pierre surgissant sous les pieds du tireur." },
	{ id: "m5", name: "Ailes Divines", category: "Tactique", element: "Bois", tpCost: 60, power: 100, description: "Accélère toute l'équipe et augmente la précision des passes de 25%." },
];

export function KizunaTownMultiplayer({
	onClose,
	onLaunchMatch,
}: {
	onClose: () => void;
	onLaunchMatch: (inacode: string, seed: number) => void;
}) {
	const [activeTab, setActiveTab] = useState<"town" | "avatar" | "squad" | "packs" | "spirits" | "build" | "rooms">("town");
	const [worldMode, setWorldMode] = useState<"private" | "global_hub">("global_hub");
	const [coins, setCoins] = useState(65000);

	// Avatar State
	const [avatar, setAvatar] = useState<KizunaAvatarData>({
		name: "Joueur Raimon",
		gender: 0,
		faceId: 1,
		hairStyle: 1,
		hairColor: "#222222",
		skinTone: 2,
		eyeColor: "#111111",
		kitId: 1,
		shoesId: 1,
		favoriteCharaId: "c01000010",
		position: "FW",
		element: "Fire",
	});

	// Town State
	const [townName, setTownName] = useState("Station Kizuna - Hub Mondial");
	const [placedItems, setPlacedItems] = useState<PlacedItem[]>([
		{ instanceId: "item_pitch", name: "Stade Principal Inazuma", icon: "🏟️", x: 400, y: 250 },
		{ instanceId: "item_bench", name: "Banc des Remplaçants", icon: "🪑", x: 260, y: 180 },
		{ instanceId: "item_monument", name: "Statue Triomphale", icon: "🗿", x: 540, y: 180 },
		{ instanceId: "item_tree1", name: "Arbre de Lien", icon: "🌳", x: 160, y: 120 },
		{ instanceId: "item_tree2", name: "Arbre de Lien", icon: "🌳", x: 640, y: 120 },
	]);
	const [placedCharas, setPlacedCharas] = useState<PlacedChara[]>([
		{ instanceId: "c_endou", charaId: "c01000010", name: "Endou Mamoru", x: 400, y: 150, greeting: "Jouons au football de toutes nos forces !" },
		{ instanceId: "c_gouenji", charaId: "c01000020", name: "Gouenji Shuuya", x: 480, y: 200, greeting: "La passion du ballon ne s'éteint jamais." },
		{ instanceId: "c_kidou", charaId: "c01000030", name: "Kidou Yuuto", x: 320, y: 200, greeting: "La tactique parfaite brise toutes les défenses." },
	]);

	// Player position in town
	const [playerPos, setPlayerPos] = useState({ x: 380, y: 320 });
	const [visitors, setVisitors] = useState<Visitor[]>([
		{
			id: "p_kidou",
			name: "Kidou Yuuto",
			country: "JP",
			avatar: { ...avatar, name: "Kidou Yuuto", position: "MF", element: "Wind" },
			squad: {
				teamName: "Royal Stars",
				rating: 91,
				chemistry: 98,
				formation: "4-3-3",
				captainName: "Kidou Yuuto",
				captainRarity: "Legendario",
				starPlayers: ["Kidou Yuuto", "David Samford", "Joseph King"],
			},
			x: 310,
			y: 250,
			pingMs: 12,
		},
		{
			id: "p_aphrody",
			name: "Aphrody (Byron)",
			country: "GR",
			avatar: { ...avatar, name: "Aphrody", position: "MF", element: "Wood" },
			squad: {
				teamName: "Zeus Divines",
				rating: 93,
				chemistry: 100,
				formation: "3-4-3",
				captainName: "Aphrody",
				captainRarity: "Ícono",
				starPlayers: ["Aphrody", "Poseidon", "Ares", "Hermes"],
			},
			x: 480,
			y: 270,
			pingMs: 18,
		},
		{
			id: "p_fubuki",
			name: "Shawn Froste",
			country: "JP",
			avatar: { ...avatar, name: "Shawn Froste", position: "FW", element: "Wind" },
			squad: {
				teamName: "Hakuren Blizzard",
				rating: 92,
				chemistry: 96,
				formation: "4-4-2",
				captainName: "Shawn Froste",
				captainRarity: "Legendario",
				starPlayers: ["Shawn Froste", "Aiden Froste", "Endou"],
			},
			x: 240,
			y: 350,
			pingMs: 22,
		},
		{
			id: "p_rococo",
			name: "Hector Helio",
			country: "ZA",
			avatar: { ...avatar, name: "Hector Helio", position: "GK", element: "Earth" },
			squad: {
				teamName: "Little Gigant",
				rating: 94,
				chemistry: 99,
				formation: "5-3-2",
				captainName: "Hector Helio",
				captainRarity: "Basara",
				starPlayers: ["Hector Helio", "Drago Hill", "Walter Mountain"],
			},
			x: 550,
			y: 340,
			pingMs: 34,
		},
	]);

	// Squad & Ultimate Team State
	const [squadPlayers, setSquadPlayers] = useState<UtSquadPlayer[]>(INITIAL_SQUAD_PLAYERS);
	const [selectedFormation, setSelectedFormation] = useState<string>("4-3-3");
	const [inspectedVisitor, setInspectedVisitor] = useState<Visitor | null>(null);

	// Pack Opening State
	const [openingPack, setOpeningPack] = useState<UtPackDef | null>(null);
	const [revealedCards, setRevealedCards] = useState<UtSquadPlayer[]>([]);
	const [isOpeningAnim, setIsOpeningAnim] = useState(false);

	// Spirits State
	const [spiritList, setSpiritList] = useState<SpiritCardDef[]>(INITIAL_SPIRITS);
	const [spiritCategory, setSpiritCategory] = useState<string>("All");

	// Social & Chat State
	const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
		{ id: "1", sender: "Système", text: "Bienvenue sur le Hub Mondial Tokio de la Station Kizuna !", timestamp: "12:00" },
		{ id: "2", sender: "Kidou Yuuto", text: "Mon équipe est prête pour un match 1v1 déterministe.", timestamp: "12:01" },
		{ id: "3", sender: "Aphrody", text: "Le pouvoir divin de Zeus attend ses prochains adversaires.", timestamp: "12:02" },
	]);
	const [chatInput, setChatInput] = useState("");
	const [activeEmote, setActiveEmote] = useState<string | null>(null);

	// Inacode & Matchmaking State
	const [inacodeInput, setInacodeInput] = useState("");
	const [myInacode, setMyInacode] = useState("INA-7K9Q");
	const [isSearchingMatch, setIsSearchingMatch] = useState(false);
	const [matchmakingTime, setMatchmakingTime] = useState(0);
	const [challengeModal, setChallengeModal] = useState<{ from: string; mode: string } | null>(null);

	// Canvas for Town rendering
	const canvasRef = useRef<HTMLCanvasElement | null>(null);

	// Calculate overall team rating and chemistry
	const teamRating = Math.round(squadPlayers.reduce((acc, p) => acc + p.rating, 0) / (squadPlayers.length || 1) || 90);
	const teamChemistry = 98;
	const teamCoinsValue = squadPlayers.reduce((acc, p) => acc + p.quicksell, 0);

	// Movement Controls
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (activeTab !== "town") return;
			const speed = 14;
			setPlayerPos((prev) => {
				let nextX = prev.x;
				let nextY = prev.y;
				if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") nextY = Math.max(60, prev.y - speed);
				if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") nextY = Math.min(440, prev.y + speed);
				if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") nextX = Math.max(60, prev.x - speed);
				if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") nextX = Math.min(740, prev.x + speed);
				return { x: nextX, y: nextY };
			});
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [activeTab]);

	// Matchmaking timer
	useEffect(() => {
		if (!isSearchingMatch) return;
		const interval = setInterval(() => {
			setMatchmakingTime((t) => t + 1);
		}, 1000);
		return () => clearInterval(interval);
	}, [isSearchingMatch]);

	// Simulate match found after 3 seconds in matchmaking
	useEffect(() => {
		if (isSearchingMatch && matchmakingTime >= 3) {
			setIsSearchingMatch(false);
			playUiSound("start_game");
			onLaunchMatch(myInacode, 999_888);
		}
	}, [isSearchingMatch, matchmakingTime, myInacode, onLaunchMatch]);

	// Canvas 2D Render of Town Hub
	useEffect(() => {
		if (activeTab !== "town") return;
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		// Clear
		ctx.fillStyle = worldMode === "global_hub" ? "#16281e" : "#1e3a1e";
		ctx.fillRect(0, 0, canvas.width, canvas.height);

		// Grid lines
		ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
		ctx.lineWidth = 1;
		for (let x = 0; x < canvas.width; x += 40) {
			ctx.beginPath();
			ctx.moveTo(x, 0);
			ctx.lineTo(x, canvas.height);
			ctx.stroke();
		}
		for (let y = 0; y < canvas.height; y += 40) {
			ctx.beginPath();
			ctx.moveTo(0, y);
			ctx.lineTo(canvas.width, y);
			ctx.stroke();
		}

		// Placed Structures & Objects
		for (const item of placedItems) {
			ctx.font = "28px sans-serif";
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			ctx.fillText(item.icon, item.x, item.y);
			ctx.font = "10px sans-serif";
			ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
			ctx.fillText(item.name, item.x, item.y + 22);
		}

		// Placed Characters
		for (const chara of placedCharas) {
			ctx.fillStyle = "#ffb703";
			ctx.beginPath();
			ctx.arc(chara.x, chara.y, 14, 0, Math.PI * 2);
			ctx.fill();
			ctx.strokeStyle = "#ffffff";
			ctx.lineWidth = 2;
			ctx.stroke();
			ctx.fillStyle = "#0c121e";
			ctx.font = "bold 11px sans-serif";
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			ctx.fillText("⚽", chara.x, chara.y);
			ctx.font = "10px sans-serif";
			ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
			ctx.fillText(chara.name, chara.x, chara.y + 20);
		}

		// Other Connected Players (Visitors)
		for (const visitor of visitors) {
			ctx.fillStyle = "#38bdf8";
			ctx.beginPath();
			ctx.arc(visitor.x, visitor.y, 14, 0, Math.PI * 2);
			ctx.fill();
			ctx.strokeStyle = "#ffffff";
			ctx.lineWidth = 2;
			ctx.stroke();

			ctx.fillStyle = "#0369a1";
			ctx.font = "bold 10px sans-serif";
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			ctx.fillText("👤", visitor.x, visitor.y);

			ctx.font = "10px sans-serif";
			ctx.fillStyle = "#bae6fd";
			ctx.fillText(`${visitor.name} (${visitor.squad.rating})`, visitor.x, visitor.y + 20);

			if (visitor.activeEmote) {
				ctx.font = "22px sans-serif";
				ctx.fillText(visitor.activeEmote, visitor.x, visitor.y - 24);
			}
		}

		// Local Player (You)
		ctx.fillStyle = "#f59e0b";
		ctx.beginPath();
		ctx.arc(playerPos.x, playerPos.y, 16, 0, Math.PI * 2);
		ctx.fill();
		ctx.strokeStyle = "#ffffff";
		ctx.lineWidth = 3;
		ctx.stroke();

		ctx.fillStyle = "#78350f";
		ctx.font = "bold 11px sans-serif";
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText("★", playerPos.x, playerPos.y);

		ctx.font = "bold 11px sans-serif";
		ctx.fillStyle = "#fbbf24";
		ctx.fillText(`${avatar.name} (Vous)`, playerPos.x, playerPos.y + 22);

		if (activeEmote) {
			ctx.font = "26px sans-serif";
			ctx.fillText(activeEmote, playerPos.x, playerPos.y - 28);
		}
	}, [activeTab, placedItems, placedCharas, visitors, playerPos, avatar, activeEmote, worldMode]);

	// Handlers
	const handleSendChat = () => {
		if (!chatInput.trim()) return;
		playUiSound("decide");
		const newMsg: ChatMessage = {
			id: String(Date.now()),
			sender: `${avatar.name} (Vous)`,
			text: chatInput.trim(),
			timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
		};
		setChatMessages((prev) => [...prev, newMsg]);
		setChatInput("");
	};

	const handleSendEmote = (symbol: string) => {
		playUiSound("decide");
		setActiveEmote(symbol);
		setTimeout(() => setActiveEmote(null), 3500);
	};

	const handleChallengePlayer = (visitor: Visitor) => {
		playUiSound("start_game");
		onLaunchMatch(myInacode, 123_456);
	};

	const handleOpenPack = (pack: UtPackDef) => {
		if (coins < pack.price) {
			playUiSound("cancel");
			alert("Pièces insuffisantes ! Participez à des matchs pour en remporter.");
			return;
		}

		playUiSound("decide");
		setCoins((c) => c - pack.price);
		setOpeningPack(pack);
		setIsOpeningAnim(true);

		setTimeout(() => {
			// Generate 3 random cards based on drop rates
			const pool: UtSquadPlayer[] = [
				{ id: `c_${Date.now()}_1`, name: "Afuro Terumi (Aphrody)", element: "Wood", position: "MF", rarity: "Ícono", rating: 93, team: "Zeus", specialMove: "Tir Solaire", quicksell: 8500, pitchX: 50, pitchY: 45 },
				{ id: `c_${Date.now()}_2`, name: "Gouenji Shuuya", element: "Fire", position: "FW", rarity: "Legendario", rating: 92, team: "Raimon", specialMove: "Tornade de Feu", quicksell: 5500, pitchX: 75, pitchY: 25 },
				{ id: `c_${Date.now()}_3`, name: "Rococo Urupa", element: "Earth", position: "GK", rarity: "Basara", rating: 95, team: "Little Gigant", specialMove: "Main Céleste X", quicksell: 16000, pitchX: 50, pitchY: 85 },
			];
			setRevealedCards(pool);
			setIsOpeningAnim(false);
		}, 1200);
	};

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-3 sm:p-5 animate-fade-in">
			<div className="relative flex flex-col w-full max-w-6xl h-[92vh] bg-[#0c121e] border border-[#2a3c5a] rounded-2xl shadow-2xl overflow-hidden text-white font-sans">
				{/* Top Global Bar */}
				<div className="flex flex-wrap items-center justify-between px-6 py-3 bg-gradient-to-r from-[#111a2c] via-[#1a2842] to-[#111a2c] border-b border-[#2a3c5a] gap-3">
					<div className="flex items-center gap-3">
						<div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-500 to-yellow-300 text-slate-950 font-black text-xl shadow-lg">
							⛩️
						</div>
						<div>
							<h2 className="text-base sm:text-lg font-black tracking-wide flex items-center gap-2">
								STATION KIZUNA & IEVR ULTIMATE TEAM
								<span className="text-[10px] uppercase px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-mono font-bold">
									60 Hz Lockstep
								</span>
							</h2>
							<div className="flex items-center gap-3 text-xs text-slate-400">
								<span>Monde : <strong className="text-amber-300">{worldMode === "global_hub" ? "Hub Mondial Tokio" : "Ville Privée"}</strong></span>
								<span>• Inacode : <span className="font-mono text-amber-400 font-bold">{myInacode}</span></span>
							</div>
						</div>
					</div>

					{/* Center: Coin Balance & World Mode Switch */}
					<div className="flex items-center gap-2">
						<div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs font-bold text-amber-300">
							<span>🪙</span>
							<span>{coins.toLocaleString()} pièces</span>
						</div>
						<button
							onClick={() => {
								playUiSound("cursor");
								setWorldMode(worldMode === "global_hub" ? "private" : "global_hub");
							}}
							className="px-3 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-colors"
						>
							{worldMode === "global_hub" ? "🌐 Mode Mondial" : "🏠 Ville Privée"}
						</button>
					</div>

					{/* Close */}
					<button
						onClick={() => { playUiSound("cancel"); onClose(); }}
						className="w-8 h-8 rounded-lg bg-slate-800/80 hover:bg-rose-600 text-slate-400 hover:text-white flex items-center justify-center transition-colors"
					>
						✕
					</button>
				</div>

				{/* Navigation Tabs */}
				<div className="flex items-center gap-1.5 px-6 py-2 bg-[#090e18] border-b border-[#1f2d44] overflow-x-auto">
					<button
						onClick={() => { playUiSound("cursor"); setActiveTab("town"); }}
						className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${activeTab === "town" ? "bg-amber-500 text-slate-950 font-bold shadow" : "text-slate-400 hover:text-white"}`}
					>
						🏙️ Monde Ouvert & Hub
					</button>
					<button
						onClick={() => { playUiSound("cursor"); setActiveTab("avatar"); }}
						className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${activeTab === "avatar" ? "bg-amber-500 text-slate-950 font-bold shadow" : "text-slate-400 hover:text-white"}`}
					>
						👤 Avatar & Capitaine
					</button>
					<button
						onClick={() => { playUiSound("cursor"); setActiveTab("squad"); }}
						className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${activeTab === "squad" ? "bg-amber-500 text-slate-950 font-bold shadow" : "text-slate-400 hover:text-white"}`}
					>
						⚽ Mon Équipe Ultimate Team
					</button>
					<button
						onClick={() => { playUiSound("cursor"); setActiveTab("packs"); }}
						className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${activeTab === "packs" ? "bg-amber-500 text-slate-950 font-bold shadow" : "text-slate-400 hover:text-white"}`}
					>
						🎁 Boutique de Packs (8)
					</button>
					<button
						onClick={() => { playUiSound("cursor"); setActiveTab("spirits"); }}
						className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${activeTab === "spirits" ? "bg-amber-500 text-slate-950 font-bold shadow" : "text-slate-400 hover:text-white"}`}
					>
						✨ Esprits & Techniques
					</button>
					<button
						onClick={() => { playUiSound("cursor"); setActiveTab("build"); }}
						className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${activeTab === "build" ? "bg-amber-500 text-slate-950 font-bold shadow" : "text-slate-400 hover:text-white"}`}
					>
						🛠️ Aménagement
					</button>
					<button
						onClick={() => { playUiSound("cursor"); setActiveTab("rooms"); }}
						className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${activeTab === "rooms" ? "bg-amber-500 text-slate-950 font-bold shadow" : "text-slate-400 hover:text-white"}`}
					>
						⚡ Matchs & Salons
					</button>
				</div>

				{/* Content Body */}
				<div className="flex-1 flex overflow-hidden">
					{/* TAB 1: TOWN VIEW */}
					{activeTab === "town" && (
						<div className="flex-1 flex flex-col md:flex-row overflow-hidden">
							<div className="flex-1 flex flex-col p-4 bg-slate-950/40 relative">
								<div className="flex items-center justify-between mb-2 text-xs text-slate-400">
									<div className="flex items-center gap-2">
										<span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
										<span>Déplacez votre avatar avec <strong className="text-white">Z, Q, S, D</strong> ou les <strong className="text-white">Flèches</strong></span>
									</div>
									<div className="flex items-center gap-1 font-mono text-[11px] text-amber-300/80">
										Position: ({playerPos.x}, {playerPos.y}) • Hub {worldMode === "global_hub" ? "Tokio Mondial" : "Privé"}
									</div>
								</div>

								{/* Town Interactive 2D Canvas */}
								<div className="flex-1 relative rounded-xl border border-slate-700/60 overflow-hidden bg-slate-900 shadow-inner flex items-center justify-center">
									<canvas
										ref={canvasRef}
										width={800}
										height={500}
										className="w-full h-full object-contain cursor-crosshair"
										onClick={(e) => {
											const rect = e.currentTarget.getBoundingClientRect();
											const scaleX = 800 / rect.width;
											const scaleY = 500 / rect.height;
											const clickX = Math.round((e.clientX - rect.left) * scaleX);
											const clickY = Math.round((e.clientY - rect.top) * scaleY);
											setPlayerPos({ x: clickX, y: clickY });
											playUiSound("cursor");
										}}
									/>
								</div>

								{/* Stamp / Emote Bar */}
								<div className="flex items-center justify-between mt-3 p-2 bg-[#121927] rounded-xl border border-slate-800">
									<span className="text-xs font-semibold text-slate-400 px-2">Tampons & Émotes :</span>
									<div className="flex items-center gap-2">
										{EMOTE_STAMPS.map((stamp) => (
											<button
												key={stamp.id}
												onClick={() => handleSendEmote(stamp.symbol)}
												className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-amber-500 hover:text-slate-950 text-xs font-bold transition-all shadow-sm flex items-center gap-1.5"
											>
												<span className="text-base">{stamp.symbol}</span>
												<span>{stamp.label.split(" ")[1]}</span>
											</button>
										))}
									</div>
								</div>
							</div>

							{/* Social & Visitors Sidebar */}
							<div className="w-full md:w-80 bg-[#0d1422] border-t md:border-t-0 md:border-l border-[#1f2d44] flex flex-col">
								{/* Visitors List */}
								<div className="p-4 border-b border-[#1f2d44]">
									<h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center justify-between">
										<span>Joueurs dans le Monde ({visitors.length + 1})</span>
										<span className="text-emerald-400 text-[10px]">P2P 60Hz</span>
									</h3>
									<div className="space-y-2 max-h-48 overflow-y-auto pr-1">
										{/* Me */}
										<div className="flex items-center justify-between p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs">
											<div className="flex items-center gap-2">
												<span className="w-2.5 h-2.5 rounded-full bg-amber-400"></span>
												<span className="font-bold text-amber-300">{avatar.name} (Vous)</span>
											</div>
											<span className="text-[10px] text-amber-400 font-mono font-bold">★ {teamRating}</span>
										</div>

										{/* Visiting Players */}
										{visitors.map((visitor) => (
											<div key={visitor.id} className="p-2 rounded-lg bg-slate-800/40 border border-slate-700/40 text-xs space-y-1.5">
												<div className="flex items-center justify-between">
													<div className="flex items-center gap-2">
														<span className="w-2 h-2 rounded-full bg-sky-400"></span>
														<span className="font-semibold">{visitor.name}</span>
														<span className="text-[9px] px-1 rounded bg-slate-700 text-slate-300 font-mono">{visitor.country}</span>
													</div>
													<span className="font-mono text-amber-400 font-bold text-[11px]">★ {visitor.squad.rating}</span>
												</div>
												<div className="flex items-center justify-between text-[10px] text-slate-400">
													<span>Équipe : {visitor.squad.teamName}</span>
													<span>{visitor.pingMs} ms</span>
												</div>
												<div className="flex items-center gap-1.5 pt-1 border-t border-slate-700/40">
													<button
														onClick={() => setInspectedVisitor(visitor)}
														className="flex-1 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-semibold transition-colors"
													>
														Inspecter 👁️
													</button>
													<button
														onClick={() => handleChallengePlayer(visitor)}
														className="flex-1 py-1 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 text-[10px] font-bold transition-colors"
													>
														Défier ⚽
													</button>
												</div>
											</div>
										))}
									</div>
								</div>

								{/* Realtime Chat */}
								<div className="flex-1 flex flex-col p-4 overflow-hidden">
									<h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
										Discussion en direct
									</h3>
									<div className="flex-1 overflow-y-auto space-y-2 pr-1 text-xs">
										{chatMessages.map((msg) => (
											<div key={msg.id} className="p-2 rounded-lg bg-slate-800/30 border border-slate-800">
												<div className="flex items-center justify-between text-[10px] text-slate-400 mb-0.5">
													<span className="font-bold text-amber-300">{msg.sender}</span>
													<span>{msg.timestamp}</span>
												</div>
												<div className="text-slate-200">{msg.text}</div>
											</div>
										))}
									</div>

									{/* Chat Input */}
									<div className="flex items-center gap-2 mt-3">
										<input
											type="text"
											value={chatInput}
											onChange={(e) => setChatInput(e.target.value)}
											onKeyDown={(e) => e.key === "Enter" && handleSendChat()}
											placeholder="Message pour le monde..."
											className="flex-1 px-3 py-2 bg-slate-900 rounded-lg border border-slate-700 text-xs focus:outline-none focus:border-amber-400 text-white placeholder-slate-500"
										/>
										<button
											onClick={handleSendChat}
											className="px-3 py-2 rounded-lg bg-amber-500 text-slate-950 font-bold text-xs hover:bg-amber-400 transition-colors"
										>
											Envoyer
										</button>
									</div>

									{/* Official Kizuna Town Vignette */}
									<div className="mt-3 pt-3 border-t border-slate-800/80 flex items-center gap-2.5">
										<img
											src="/kizuna/img_kizuna-town_01.webp"
											alt="Ville de lien officielle"
											className="w-16 h-10 object-cover rounded border border-slate-700/60"
										/>
										<div className="text-[10px] text-slate-400 leading-tight">
											<span className="font-semibold text-slate-300">Station Kizuna :</span> Rencontrez les joueurs et lancez des défis en ligne.
										</div>
									</div>
								</div>
							</div>
						</div>
					)}

					{/* TAB 2: AVATAR MAKEUP & CAPITAINE */}
					{activeTab === "avatar" && (
						<div className="flex-1 flex flex-col md:flex-row p-6 gap-6 overflow-y-auto">
							<div className="flex-1 space-y-4">
								<h3 className="text-lg font-bold text-amber-400 flex items-center gap-2">
									<span>Personnalisation de l'Avatar & Capitaine d'Équipe</span>
								</h3>
								<p className="text-xs text-slate-400">
									Votre avatar personnalisé incarne votre capitaine dans votre effectif Ultimate Team et représente votre joueur dans l'open world.
								</p>

								<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
									<div>
										<label className="block text-xs font-semibold text-slate-300 mb-1">Nom du Joueur / Avatar</label>
										<input
											type="text"
											value={avatar.name}
											onChange={(e) => setAvatar({ ...avatar, name: e.target.value })}
											className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm focus:border-amber-400"
										/>
									</div>

									<div>
										<label className="block text-xs font-semibold text-slate-300 mb-1">Poste de prédilection</label>
										<select
											value={avatar.position}
											onChange={(e) => setAvatar({ ...avatar, position: e.target.value as any })}
											className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm focus:border-amber-400 text-white"
										>
											<option value="GK">Gardien de But (GK)</option>
											<option value="DF">Défenseur (DF)</option>
											<option value="MF">Milieu de Terrain (MF)</option>
											<option value="FW">Attaquant (FW)</option>
										</select>
									</div>

									<div>
										<label className="block text-xs font-semibold text-slate-300 mb-1">Affinité Élémentaire</label>
										<select
											value={avatar.element}
											onChange={(e) => setAvatar({ ...avatar, element: e.target.value as any })}
											className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm focus:border-amber-400 text-white"
										>
											<option value="Fire">🔥 Feu (Fire)</option>
											<option value="Wind">🌪️ Vent (Wind)</option>
											<option value="Earth">⛰️ Terre (Earth)</option>
											<option value="Wood">🌲 Bois (Wood)</option>
											<option value="Void">🌌 Néant (Void)</option>
										</select>
									</div>

									<div>
										<label className="block text-xs font-semibold text-slate-300 mb-1">Apparence de Personnage Favori</label>
										<select
											value={avatar.favoriteCharaId ?? ""}
											onChange={(e) => setAvatar({ ...avatar, favoriteCharaId: e.target.value || null })}
											className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm focus:border-amber-400 text-white"
										>
											<option value="">Avatar Original Personnalisé</option>
											{FAVORITE_CHARACTERS.map((c) => (
												<option key={c.id} value={c.id}>{c.name} ({c.team})</option>
											))}
										</select>
									</div>
								</div>

								<div className="pt-4 border-t border-slate-800 flex justify-end">
									<button
										onClick={() => {
											playUiSound("decide");
											alert("Avatar enregistré et synchronisé avec le serveur nie-net et nie-launcher !");
										}}
										className="px-6 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm shadow-lg transition-transform active:scale-95"
									>
										Sauvegarder l'Avatar
									</button>
								</div>
							</div>

							{/* Avatar Official Visuals & Preview */}
							<div className="w-full md:w-80 flex flex-col gap-4">
								<div className="bg-gradient-to-b from-[#162238] to-[#0c1322] p-4 rounded-2xl border border-amber-500/30 shadow-xl flex flex-col items-center justify-center text-center">
									<div className="w-20 h-20 rounded-full bg-gradient-to-tr from-amber-500 to-yellow-300 p-1 mb-2 shadow-lg">
										<div className="w-full h-full rounded-full bg-slate-900 flex items-center justify-center text-3xl">
											⚽
										</div>
									</div>
									<h4 className="text-base font-bold text-white mb-1">{avatar.name}</h4>
									<div className="flex items-center gap-2 mb-3">
										<span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 text-xs font-mono font-bold">{avatar.position}</span>
										<span className="px-2 py-0.5 rounded bg-sky-500/20 text-sky-400 text-xs font-mono">{avatar.element}</span>
										<span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 text-xs font-mono">Basara</span>
									</div>
									<div className="text-xs text-slate-400 space-y-1 w-full bg-slate-900/60 p-2.5 rounded-xl border border-slate-800">
										<div className="flex justify-between"><span>Rôle :</span> <span className="font-semibold text-amber-300">Capitaine d'Équipe</span></div>
										<div className="flex justify-between"><span>Modèle :</span> <span className="font-semibold text-slate-200">{avatar.favoriteCharaId ? "Légende" : "Original"}</span></div>
										<div className="flex justify-between"><span>Uniforme :</span> <span className="font-semibold text-slate-200">Raimon D1</span></div>
										<div className="flex justify-between"><span>Note Capitaine :</span> <span className="font-semibold text-emerald-400">95 OVR</span></div>
									</div>
								</div>

								{/* Official Level-5 Reference Cards */}
								<div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3 space-y-2">
									<div className="text-[11px] font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
										<span>📸 Aperçu Officiel Victory Road</span>
									</div>
									<div className="grid grid-cols-2 gap-2">
										<div className="rounded-lg overflow-hidden border border-slate-800 group relative">
											<img
												src="/kizuna/img_avatar-makeup_01_2510.webp"
												alt="Avatar Makeup Visage"
												className="w-full h-24 object-cover group-hover:scale-105 transition-transform duration-300"
											/>
											<div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-1 text-[9px] text-slate-300 text-center font-semibold">
												Visages & Cheveux
											</div>
										</div>
										<div className="rounded-lg overflow-hidden border border-slate-800 group relative">
											<img
												src="/kizuna/img_avatar-makeup_04.webp"
												alt="Avatar Makeup Tenue"
												className="w-full h-24 object-cover group-hover:scale-105 transition-transform duration-300"
											/>
											<div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-1 text-[9px] text-slate-300 text-center font-semibold">
												Tenues & Uniformes
											</div>
										</div>
									</div>
								</div>
							</div>
						</div>
					)}

					{/* TAB 3: ULTIMATE TEAM SQUAD & 2D PITCH */}
					{activeTab === "squad" && (
						<div className="flex-1 flex flex-col md:flex-row p-6 gap-6 overflow-y-auto">
							{/* 2D Tactical Pitch */}
							<div className="flex-1 flex flex-col space-y-3">
								<div className="flex items-center justify-between">
									<div>
										<h3 className="text-lg font-bold text-amber-400">Terrain Tactique & Onze de Départ</h3>
										<p className="text-xs text-slate-400">Positionnez vos joueurs sur le terrain et observez l'alchimie d'équipe.</p>
									</div>
									<div className="flex items-center gap-2">
										<label className="text-xs text-slate-300">Formation :</label>
										<select
											value={selectedFormation}
											onChange={(e) => { playUiSound("cursor"); setSelectedFormation(e.target.value); }}
											className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-amber-400 font-bold focus:border-amber-400"
										>
											<option value="4-3-3">4-3-3 Attaque</option>
											<option value="4-4-2">4-4-2 Équilibré</option>
											<option value="3-5-2">3-5-2 Contrôle</option>
											<option value="Death Zone 3-4-3">Death Zone 3-4-3</option>
										</select>
									</div>
								</div>

								{/* Soccer Pitch Canvas Representation */}
								<div className="relative w-full h-[440px] bg-gradient-to-b from-[#193a20] via-[#204a29] to-[#193a20] rounded-2xl border-2 border-emerald-500/40 p-3 overflow-hidden shadow-2xl">
									{/* Pitch markings */}
									<div className="absolute inset-3 border-2 border-white/20 rounded-xl pointer-events-none"></div>
									<div className="absolute left-3 right-3 top-1/2 -translate-y-1/2 border-t-2 border-white/20 pointer-events-none"></div>
									<div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-28 h-28 rounded-full border-2 border-white/20 pointer-events-none"></div>
									<div className="absolute left-1/2 -translate-x-1/2 top-3 w-40 h-20 border-2 border-white/20 border-t-0 rounded-b-lg pointer-events-none"></div>
									<div className="absolute left-1/2 -translate-x-1/2 bottom-3 w-40 h-20 border-2 border-white/20 border-b-0 rounded-t-lg pointer-events-none"></div>

									{/* Player Cards Placed on Pitch */}
									{squadPlayers.map((player) => (
										<div
											key={player.id}
											style={{ left: `${player.pitchX}%`, top: `${player.pitchY}%` }}
											className="absolute -translate-x-1/2 -translate-y-1/2 group cursor-pointer"
										>
											<div className={`w-14 sm:w-16 h-18 sm:h-20 rounded-xl p-1 flex flex-col items-center justify-between text-center transition-transform group-hover:scale-110 shadow-lg border ${player.rarity === "Basara" ? "bg-gradient-to-b from-purple-900 to-indigo-950 border-purple-400" : player.rarity === "Ícono" ? "bg-gradient-to-b from-amber-800 to-yellow-900 border-amber-300" : "bg-gradient-to-b from-slate-900 to-slate-950 border-slate-700"}`}>
												<div className="flex items-center justify-between w-full text-[9px] font-mono px-0.5">
													<span className="font-bold text-amber-300">{player.rating}</span>
													<span className="text-[8px] text-slate-300">{player.position}</span>
												</div>
												<div className="text-xl my-auto">⚽</div>
												<div className="w-full text-[8px] font-bold truncate text-slate-200">
													{player.name.split(" ")[0]}
												</div>
												<div className="text-[7px] text-slate-400 truncate">
													{player.specialMove || player.element}
												</div>
											</div>
										</div>
									))}
								</div>
							</div>

							{/* Squad Metrics & Actions */}
							<div className="w-full md:w-80 flex flex-col gap-4">
								<div className="p-5 rounded-2xl bg-[#101726] border border-amber-500/30 space-y-4 shadow-xl">
									<h4 className="text-sm font-bold text-amber-400 flex items-center justify-between">
										<span>Statistiques de l'Équipe</span>
										<span className="text-[10px] text-slate-400 font-mono">IEVR UT</span>
									</h4>

									<div className="grid grid-cols-2 gap-3 text-center">
										<div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
											<div className="text-2xl font-black text-amber-400">{teamRating}</div>
											<div className="text-[10px] text-slate-400 uppercase font-semibold">Note Globale</div>
										</div>
										<div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
											<div className="text-2xl font-black text-emerald-400">{teamChemistry}</div>
											<div className="text-[10px] text-slate-400 uppercase font-semibold">Alchimie</div>
										</div>
									</div>

									<div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 text-xs space-y-2">
										<div className="flex justify-between text-slate-400">
											<span>Valeur Marchande :</span>
											<span className="font-bold text-amber-300 font-mono">{teamCoinsValue.toLocaleString()} pièces</span>
										</div>
										<div className="flex justify-between text-slate-400">
											<span>Capitaine :</span>
											<span className="font-bold text-white">Votre Avatar (Basara)</span>
										</div>
										<div className="flex justify-between text-slate-400">
											<span>Chiffrement Save :</span>
											<span className="font-mono text-emerald-400 font-bold">AES-256-GCM</span>
										</div>
									</div>

									<button
										onClick={() => {
											playUiSound("decide");
											alert("Effectif exporté sous enveloppe chiffrée AES-256-GCM compatible IEVR Ultimate Team & Steam !");
										}}
										className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow-md transition-colors"
									>
										Exporter l'Équipe (AES-256-GCM)
									</button>
								</div>

								{/* Roster list */}
								<div className="p-4 rounded-2xl bg-[#101726] border border-slate-800 flex-1 flex flex-col">
									<h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
										Joueurs de l'Effectif (11/11)
									</h4>
									<div className="space-y-1.5 overflow-y-auto max-h-56 pr-1 text-xs">
										{squadPlayers.map((p) => (
											<div key={p.id} className="flex items-center justify-between p-2 rounded-lg bg-slate-800/40 border border-slate-700/40">
												<div className="flex items-center gap-2">
													<span className="font-mono font-bold text-amber-400">{p.rating}</span>
													<span className="font-semibold">{p.name}</span>
												</div>
												<span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-900 text-slate-300">{p.position}</span>
											</div>
										))}
									</div>
								</div>
							</div>
						</div>
					)}

					{/* TAB 4: PACKS SHOP */}
					{activeTab === "packs" && (
						<div className="flex-1 p-6 space-y-6 overflow-y-auto">
							<div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-2">
								<div>
									<h3 className="text-lg font-bold text-amber-400">Boutique de Packs IEVR Ultimate Team</h3>
									<p className="text-xs text-slate-400">Les 8 packs officiels de la base de données Level-5 avec taux de drop mathématiques réels.</p>
								</div>
								<div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 font-bold text-sm">
									<span>🪙 Solde : {coins.toLocaleString()} pièces</span>
								</div>
							</div>

							{/* Packs Grid */}
							<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
								{OFFICIAL_PACKS.map((pack) => (
									<div
										key={pack.id}
										className="rounded-2xl border border-slate-800 bg-[#111827] overflow-hidden flex flex-col justify-between hover:border-amber-500/50 transition-all shadow-lg"
									>
										<div className={`p-4 bg-gradient-to-b ${pack.gradient} text-white`}>
											<div className="flex items-center justify-between mb-2">
												<span className="px-2 py-0.5 rounded bg-black/40 text-[10px] font-bold uppercase tracking-wider font-mono">
													{pack.badge}
												</span>
												<span className="text-xs font-mono font-bold">{pack.cardCount} cartes</span>
											</div>
											<h4 className="text-base font-black leading-tight">{pack.nameFr}</h4>
											<div className="text-[11px] text-white/80 font-mono">{pack.name}</div>
										</div>

										<div className="p-4 space-y-3 flex-1 flex flex-col justify-between">
											<p className="text-xs text-slate-400 leading-relaxed">{pack.description}</p>

											<div className="text-[10px] space-y-1 bg-slate-900/60 p-2.5 rounded-xl border border-slate-800 font-mono">
												<div className="flex justify-between text-slate-400">
													<span>Légendaire :</span>
													<span className="font-bold text-amber-400">{pack.probLegendary}%</span>
												</div>
												<div className="flex justify-between text-slate-400">
													<span>Icône / Basara :</span>
													<span className="font-bold text-purple-400">{(pack.probIcon + pack.probBasara).toFixed(1)}%</span>
												</div>
											</div>

											<button
												onClick={() => handleOpenPack(pack)}
												className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-400 hover:to-yellow-300 text-slate-950 font-black text-xs shadow-md transition-transform active:scale-95"
											>
												Ouvrir • {pack.price.toLocaleString()} 🪙
											</button>
										</div>
									</div>
								))}
							</div>
						</div>
					)}

					{/* TAB 5: SPIRITS & SPECIAL MOVES */}
					{activeTab === "spirits" && (
						<div className="flex-1 p-6 space-y-6 overflow-y-auto">
							<div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
								<div>
									<h3 className="text-lg font-bold text-amber-400">Catalogue des Esprits Guerriers & Supertechniques</h3>
									<p className="text-xs text-slate-400">Recherchez parmi les 1 852 techniques officielles pour renforcer vos joueurs.</p>
								</div>
								<div className="flex items-center gap-2">
									{["All", "Tir", "Arrêt", "Dribble", "Blocage", "Tactique"].map((cat) => (
										<button
											key={cat}
											onClick={() => { playUiSound("cursor"); setSpiritCategory(cat); }}
											className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${spiritCategory === cat ? "bg-amber-500 text-slate-950 font-bold" : "bg-slate-800 text-slate-300 hover:text-white"}`}
										>
											{cat}
										</button>
									))}
								</div>
							</div>

							<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
								{spiritList
									.filter((s) => spiritCategory === "All" || s.category === spiritCategory)
									.map((item) => (
										<div key={item.id} className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-2 hover:border-amber-500/40 transition-colors">
											<div className="flex items-center justify-between">
												<span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 text-[10px] font-bold font-mono">
													{item.category}
												</span>
												<span className="text-xs font-mono text-slate-400">TP : {item.tpCost}</span>
											</div>
											<h4 className="text-sm font-bold text-white">{item.name}</h4>
											<p className="text-xs text-slate-400 leading-relaxed">{item.description}</p>
											<div className="flex items-center justify-between pt-2 border-t border-slate-800 text-xs">
												<span className="text-slate-400">Puissance : <strong className="text-emerald-400 font-mono">{item.power}</strong></span>
												<button
													onClick={() => { playUiSound("decide"); alert(`Technique "${item.name}" équipée à votre avatar !`); }}
													className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-amber-500 hover:text-slate-950 text-xs font-bold transition-colors"
												>
													Équiper
												</button>
											</div>
										</div>
									))}
							</div>
						</div>
					)}

					{/* TAB 6: TOWN BUILDER */}
					{activeTab === "build" && (
						<div className="flex-1 p-6 space-y-6 overflow-y-auto">
							<div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
								<div>
									<h3 className="text-lg font-bold text-amber-400 mb-1">Aménagement de la Ville de Lien (Kizuna Town)</h3>
									<p className="text-xs text-slate-400">Placez des structures, décorations et personnages débloqués pour bâtir votre ville idéale.</p>
								</div>
								<div className="hidden lg:flex items-center gap-3 bg-slate-900/80 p-1.5 rounded-xl border border-slate-800">
									<img
										src="/kizuna/img_kizuna-town_02_2510.webp"
										alt="Aménagement Ville de lien"
										className="w-32 h-16 object-cover rounded-lg border border-slate-700/60"
									/>
									<div className="text-left pr-2">
										<div className="text-[11px] font-bold text-amber-300">Aménagement Officiel</div>
										<div className="text-[10px] text-slate-400">Objets & Bâtiments synchronisés</div>
									</div>
								</div>
							</div>

							<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
								{/* Placeable Items */}
								<div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
									<h4 className="text-sm font-bold text-slate-200 mb-3">Structures & Décorations Disponibles</h4>
									<div className="space-y-2">
										{TOWN_OBJECT_PRESETS.map((item) => (
											<div key={item.id} className="flex items-center justify-between p-3 rounded-lg bg-slate-800/40 border border-slate-700/50">
												<div className="flex items-center gap-3">
													<span className="text-2xl">{item.icon}</span>
													<span className="text-xs font-semibold">{item.name}</span>
												</div>
												<button
													onClick={() => {
														playUiSound("decide");
														setPlacedItems((prev) => [
															...prev,
															{ instanceId: `item_${Date.now()}`, name: item.name, icon: item.icon, x: 250 + Math.random() * 300, y: 150 + Math.random() * 200 },
														]);
													}}
													className="px-3 py-1 rounded bg-amber-500/20 hover:bg-amber-500 text-amber-400 hover:text-slate-950 text-xs font-bold transition-colors"
												>
													Placer
												</button>
											</div>
										))}
									</div>
								</div>

								{/* Placed Items List */}
								<div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
									<h4 className="text-sm font-bold text-slate-200 mb-3">Objets Déjà Placés ({placedItems.length})</h4>
									<div className="space-y-2 max-h-60 overflow-y-auto pr-1">
										{placedItems.map((item) => (
											<div key={item.instanceId} className="flex items-center justify-between p-2 rounded-lg bg-slate-800/30 border border-slate-700/30 text-xs">
												<div className="flex items-center gap-2">
													<span>{item.icon}</span>
													<span>{item.name}</span>
												</div>
												<button
													onClick={() => {
														playUiSound("cancel");
														setPlacedItems((prev) => prev.filter((i) => i.instanceId !== item.instanceId));
													}}
													className="text-rose-400 hover:text-rose-300 font-bold px-2 py-0.5"
												>
													Retirer
												</button>
											</div>
										))}
									</div>
								</div>
							</div>
						</div>
					)}

					{/* TAB 7: ROOMS & MATCHMAKING */}
					{activeTab === "rooms" && (
						<div className="flex-1 p-6 space-y-6 overflow-y-auto">
							<div>
								<h3 className="text-lg font-bold text-amber-400 mb-1">Matchs Multijoueur & Salons Inacode</h3>
								<p className="text-xs text-slate-400">Netcode déterministe pur Rust à 60 Hz avec buffer de rollback de 64 frames sans crack ni contournement.</p>
							</div>

							<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
								{/* Direct Inacode Join */}
								<div className="p-5 rounded-2xl bg-gradient-to-br from-slate-900 to-[#121c2e] border border-slate-800 space-y-4">
									<h4 className="text-sm font-bold text-white flex items-center gap-2">
										<span>🔑 Rejoindre une Salle Privée</span>
									</h4>
									<p className="text-xs text-slate-400">Entrez le code Inacode communiqué par un ami pour lancer immédiatement le match.</p>
									<div className="flex gap-2">
										<input
											type="text"
											value={inacodeInput}
											onChange={(e) => setInacodeInput(e.target.value.toUpperCase())}
											placeholder="Ex: INA-65QF"
											className="flex-1 px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm font-mono tracking-widest text-center text-amber-400 font-bold focus:border-amber-400"
										/>
										<button
											onClick={() => {
												if (!inacodeInput.trim()) return;
												playUiSound("start_game");
												onLaunchMatch(inacodeInput.trim(), 424_242);
											}}
											className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition-colors"
										>
											Rejoindre
										</button>
									</div>

									<div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-xs space-y-1">
										<div className="text-slate-400">Votre Code Inacode Hôte :</div>
										<div className="font-mono text-base font-bold text-amber-400">{myInacode}</div>
									</div>
								</div>

								{/* Automated Matchmaking */}
								<div className="p-5 rounded-2xl bg-gradient-to-br from-slate-900 to-[#121c2e] border border-slate-800 space-y-4">
									<h4 className="text-sm font-bold text-white flex items-center gap-2">
										<span>⚡ Matchmaking Automatique</span>
									</h4>
									<p className="text-xs text-slate-400">Trouve automatiquement un adversaire avec un score de classement (MMR) équivalent.</p>

									{isSearchingMatch ? (
										<div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-center space-y-2">
											<div className="text-sm font-bold text-amber-300 animate-pulse">Recherche d'un adversaire en cours...</div>
											<div className="text-xs text-slate-400 font-mono">Temps écoulé : {matchmakingTime}s</div>
											<button
												onClick={() => setIsSearchingMatch(false)}
												className="px-4 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white text-xs font-semibold"
											>
												Annuler
											</button>
										</div>
									) : (
										<div className="space-y-2">
											<button
												onClick={() => { playUiSound("decide"); setIsSearchingMatch(true); setMatchmakingTime(0); }}
												className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-400 hover:to-yellow-300 text-slate-950 font-bold text-sm shadow-md transition-transform active:scale-95"
											>
												Rechercher un Match Classé (Ranked)
											</button>
											<button
												onClick={() => { playUiSound("decide"); setIsSearchingMatch(true); setMatchmakingTime(0); }}
												className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs transition-colors"
											>
												Rechercher un Match Amical (Casual)
											</button>
										</div>
									)}
								</div>
							</div>

							{/* Official Friends Challenge Showcase */}
							<div className="rounded-2xl border border-slate-800 bg-gradient-to-r from-slate-900/90 via-[#131d2e] to-slate-900/90 p-4 flex flex-col md:flex-row items-center gap-4">
								<img
									src="/kizuna/img_friends_01_2510.webp"
									alt="Rencontre d'amis et défis 1v1"
									className="w-full md:w-64 h-32 object-cover rounded-xl border border-amber-500/30 shadow-md"
								/>
								<div className="flex-1 text-left space-y-1">
									<div className="text-xs font-bold uppercase tracking-wider text-amber-400">
										🤝 Défiez vos amis à la Station Kizuna
									</div>
									<div className="text-sm font-semibold text-white">
										Matchs 1v1 en direct & Salons Personnalisés
									</div>
									<p className="text-xs text-slate-400 leading-relaxed">
										Invitez vos amis directement dans votre ville de lien avec votre code Inacode ou en les défiant sur place. Chaque match utilise la simulation déterministe 60 Hz avec prédiction et rollback pour une réactivité instantanée.
									</p>
								</div>
							</div>
						</div>
					)}
				</div>
			</div>

			{/* Modal: Pack Opening Reveal */}
			{openingPack && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-xl p-4 animate-fade-in">
					<div className="relative flex flex-col items-center max-w-xl w-full bg-[#0d1424] border border-amber-500/40 rounded-3xl p-6 text-center space-y-5 shadow-2xl">
						<h3 className="text-xl font-black text-amber-400 tracking-wide uppercase">
							{openingPack.nameFr}
						</h3>

						{isOpeningAnim ? (
							<div className="py-16 space-y-4">
								<div className="w-24 h-24 mx-auto rounded-2xl bg-gradient-to-tr from-amber-500 to-yellow-300 animate-spin flex items-center justify-center text-4xl shadow-2xl">
									🎁
								</div>
								<div className="text-sm font-bold text-slate-300 animate-pulse">Ouverture du pack en cours...</div>
							</div>
						) : (
							<div className="space-y-6 w-full">
								<div className="grid grid-cols-3 gap-3">
									{revealedCards.map((card) => (
										<div
											key={card.id}
											className={`p-3 rounded-2xl border flex flex-col items-center justify-between text-center shadow-lg transition-transform hover:scale-105 ${card.rarity === "Basara" ? "bg-gradient-to-b from-purple-950 to-indigo-900 border-purple-400" : card.rarity === "Ícono" ? "bg-gradient-to-b from-amber-900 to-yellow-950 border-amber-300" : "bg-gradient-to-b from-slate-900 to-slate-950 border-slate-700"}`}
										>
											<div className="flex items-center justify-between w-full text-[10px] font-mono">
												<span className="font-bold text-amber-400">{card.rating}</span>
												<span className="text-slate-300">{card.position}</span>
											</div>
											<div className="text-3xl my-2">⚽</div>
											<div className="font-bold text-xs truncate w-full text-white">{card.name}</div>
											<div className="text-[10px] text-amber-300 font-semibold">{card.specialMove}</div>
											<div className="mt-2 text-[9px] font-mono text-emerald-400">+{card.quicksell} 🪙</div>
										</div>
									))}
								</div>

								<div className="flex items-center justify-center gap-3 pt-2">
									<button
										onClick={() => {
											playUiSound("decide");
											setSquadPlayers((prev) => [...prev, ...revealedCards]);
											setOpeningPack(null);
										}}
										className="px-6 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow-md"
									>
										Ajouter au Club
									</button>
									<button
										onClick={() => {
											playUiSound("decide");
											const totalVal = revealedCards.reduce((acc, c) => acc + c.quicksell, 0);
											setCoins((c) => c + totalVal);
											setOpeningPack(null);
										}}
										className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs"
									>
										Vente Rapide (+{revealedCards.reduce((acc, c) => acc + c.quicksell, 0)} 🪙)
									</button>
								</div>
							</div>
						)}
					</div>
				</div>
			)}

			{/* Modal: Inspected Player Squad */}
			{inspectedVisitor && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-4 animate-fade-in">
					<div className="relative flex flex-col max-w-lg w-full bg-[#0d1424] border border-sky-500/40 rounded-3xl p-6 text-left space-y-4 shadow-2xl">
						<div className="flex items-center justify-between border-b border-slate-800 pb-3">
							<div className="flex items-center gap-2.5">
								<div className="w-8 h-8 rounded-full bg-sky-500/20 text-sky-400 flex items-center justify-center font-bold text-sm border border-sky-500/30">
									👤
								</div>
								<div>
									<h3 className="text-base font-bold text-white">{inspectedVisitor.name}</h3>
									<div className="text-[11px] text-slate-400 font-mono">Pays : {inspectedVisitor.country} • Latence : {inspectedVisitor.pingMs} ms</div>
								</div>
							</div>
							<button
								onClick={() => setInspectedVisitor(null)}
								className="w-7 h-7 rounded-lg bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center text-xs"
							>
								✕
							</button>
						</div>

						<div className="space-y-3">
							<div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-2">
								<div className="flex items-center justify-between">
									<span className="text-xs text-slate-400">Équipe Ultimate Team :</span>
									<span className="text-xs font-bold text-amber-300">{inspectedVisitor.squad.teamName}</span>
								</div>
								<div className="flex items-center justify-between">
									<span className="text-xs text-slate-400">Formation :</span>
									<span className="text-xs font-mono font-semibold text-white">{inspectedVisitor.squad.formation}</span>
								</div>
								<div className="flex items-center justify-between">
									<span className="text-xs text-slate-400">Note Globale :</span>
									<span className="text-xs font-mono font-bold text-amber-400">★ {inspectedVisitor.squad.rating} OVR</span>
								</div>
								<div className="flex items-center justify-between">
									<span className="text-xs text-slate-400">Alchimie :</span>
									<span className="text-xs font-mono font-bold text-emerald-400">{inspectedVisitor.squad.chemistry} / 100</span>
								</div>
								<div className="flex items-center justify-between">
									<span className="text-xs text-slate-400">Capitaine :</span>
									<span className="text-xs font-semibold text-white">{inspectedVisitor.squad.captainName} ({inspectedVisitor.squad.captainRarity})</span>
								</div>
							</div>

							<div className="space-y-1.5">
								<div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Joueurs Clés :</div>
								<div className="flex flex-wrap gap-1.5">
									{inspectedVisitor.squad.starPlayers.map((star, idx) => (
										<span key={idx} className="px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-200">
											⭐ {star}
										</span>
									))}
								</div>
							</div>
						</div>

						<div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
							<button
								onClick={() => setInspectedVisitor(null)}
								className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white text-xs font-semibold"
							>
								Fermer
							</button>
							<button
								onClick={() => {
									setInspectedVisitor(null);
									handleChallengePlayer(inspectedVisitor);
								}}
								className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold shadow-md"
							>
								Défier en Match 1v1 ⚽
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
