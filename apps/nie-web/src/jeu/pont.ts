/**
 * Le pont navigateur vers le jeu — `nie-wasm`/`WasmGame`, 100 % Rust compilé en WebAssembly.
 *
 * `WasmGame` est une machine à états : écran-titre → menu principal → sélection de mode →
 * match (moteur `nie-runtime` : physique, 22 joueurs, ballon, buts) ou dialogue. Commandes de
 * menu en entrée, framebuffer RGBA8 en sortie. Ce module ne fait que trois choses : charger le
 * wasm, chercher la vraie police du jeu, et adapter clavier ↔ commande et framebuffer ↔ canevas.
 *
 * ## Ce que cette surface est, et ce qu'elle n'est pas
 *
 * `crates/engine/nie-wasm/src/lib.rs` le dit sans détour : le rendu est un **placeholder 2D**,
 * il ne reproduit pas l'interface d'IEVR, parce que le vrai menu n'existe dans aucun fichier —
 * il est construit à l'exécution par le menu-manager C++ qui pilote Lua via
 * `funcLuaMenuCommand`, boucle non portée à ce jour. Le modèle de but de `match_sim` reste
 * nominal. Ce que cette page prouve, c'est que la logique portée tourne dans un navigateur ;
 * elle ne prouve pas une fidélité au jeu, et rien ici ne doit l'affirmer.
 *
 * ## Pourquoi les octets viennent de `/static/jeu/`, et pas de `/assets/`
 *
 * `nie-site` route `/assets/*` vers le proxy de décodage : y poser des fichiers du bundle les
 * enverrait à `nie-model-serve`, qui n'en sait rien. `/static/` est servi par le bundle
 * lui-même, avec sa pré-compression et son cache — c'est là qu'ils vivent.
 */
import init, { WasmGame } from "../wasm/nie_wasm.js";

const WASM_URL = "/static/jeu/nie_wasm_bg.wasm";
const FONT_CFG_URL = "/static/jeu/font.cfg.bin.gz";
const FONT_G4TX_URL = "/static/jeu/font.g4tx.gz";

let initPromise: Promise<void> | null = null;

/** Charge le module wasm une seule fois, même si deux écrans le demandent en même temps. */
async function assurerWasm(): Promise<void> {
	if (initPromise === null) {
		initPromise = (async () => {
			await init({ module_or_path: fetch(WASM_URL) });
		})();
	}
	return initPromise;
}

/**
 * Récupère un asset gzippé et le décompresse en flux.
 *
 * La police fait 5,7 Mio en clair : la servir compressée n'est pas une optimisation, c'est ce
 * qui rend le premier chargement supportable. `DecompressionStream` est natif partout où le
 * wasm l'est, donc aucune bibliothèque n'entre ici.
 */
async function chargerGzip(url: string): Promise<Uint8Array> {
	const res = await fetch(url);
	if (!res.ok || res.body === null) throw new Error(`${url} → HTTP ${res.status}`);
	const flux = res.body.pipeThrough(new DecompressionStream("gzip"));
	return new Uint8Array(await new Response(flux).arrayBuffer());
}

/** La poignée du jeu : dimensions, entrée, temps, image, score. */
export interface PoigneeJeu {
	/** Largeur du framebuffer, en pixels du jeu. */
	readonly largeur: number;
	/** Hauteur du framebuffer, en pixels du jeu. */
	readonly hauteur: number;
	/** Transmet une commande de menu IEVR (`CMD_ENTER`, `CMD_BACK`, `CMD_FCS_MTX_UP`…). */
	entree(cmd: string): void;
	/** Avance le temps de `dt` secondes — la physique du match tourne pendant un match. */
	avancer(dt: number): void;
	/** Rend l'écran courant, prêt pour `putImageData`. */
	image(): ImageData;
	/** Score courant `[domicile, extérieur]` ; des zéros hors match. */
	score(): [number, number];
	/** Vrai si un match est en cours. */
	enMatch(): boolean;
}

/** Charge le jeu et sa police, et rend une poignée pilotable. */
export async function chargerJeu(): Promise<PoigneeJeu> {
	await assurerWasm();
	const [cfg, g4tx] = await Promise.all([chargerGzip(FONT_CFG_URL), chargerGzip(FONT_G4TX_URL)]);
	const jeu = new WasmGame(cfg, g4tx);
	const l = jeu.width;
	const h = jeu.height;
	return {
		largeur: l,
		hauteur: h,
		entree: (cmd) => jeu.input(cmd),
		avancer: (dt) => jeu.update(dt),
		image: () => new ImageData(new Uint8ClampedArray(jeu.render()), l, h),
		score: () => {
			const s = jeu.score();
			return [s[0] ?? 0, s[1] ?? 0];
		},
		enMatch: () => jeu.in_match,
	};
}

/**
 * Le clavier, traduit en commandes de menu du jeu.
 *
 * Les noms sont ceux du jeu (`CMD_FCS_MTX_*` pour le déplacement dans une matrice de focus,
 * `CMD_ENTER`/`CMD_BACK` pour valider et revenir), pas une convention inventée ici : la FSM de
 * `nie_app::flow` les attend mot pour mot, et un nom approché ne produirait pas d'erreur — il
 * ne ferait simplement rien.
 *
 * Les deux jeux de touches coexistent délibérément : les flèches pour qui arrive au clavier,
 * ZQSD/WASD pour qui joue. `Entrée` et `Espace` valident, `Échap` et `Retour arrière` reviennent.
 */
const TOUCHES: Readonly<Record<string, string>> = {
	ArrowUp: "CMD_FCS_MTX_UP",
	ArrowDown: "CMD_FCS_MTX_DOWN",
	ArrowLeft: "CMD_FCS_MTX_LEFT",
	ArrowRight: "CMD_FCS_MTX_RIGHT",
	w: "CMD_FCS_MTX_UP",
	z: "CMD_FCS_MTX_UP",
	s: "CMD_FCS_MTX_DOWN",
	a: "CMD_FCS_MTX_LEFT",
	q: "CMD_FCS_MTX_LEFT",
	d: "CMD_FCS_MTX_RIGHT",
	Enter: "CMD_ENTER",
	" ": "CMD_ENTER",
	Escape: "CMD_BACK",
	Backspace: "CMD_BACK",
	Tab: "CMD_FCS_NEXT",
	i: "CMD_INFO",
};

/** La commande que déclenche une touche, ou `null` si cette touche ne fait rien. */
export function commandePourTouche(touche: string): string | null {
	return TOUCHES[touche] ?? TOUCHES[touche.toLowerCase()] ?? null;
}
