/**
 * L'accueil : le jeu, dans le navigateur.
 *
 * Un canevas, une boucle d'animation, et le clavier. Rien d'autre — pas de menu React
 * par-dessus, pas de barre, pas d'encart d'état : ce qui s'affiche est ce que le moteur rend.
 *
 * ## Le jeu ne dépend pas de l'index du VFS
 *
 * L'accueil attendait que `/api/v1/health` déclare son VFS `pret` avant d'afficher quoi que ce
 * soit : c'était juste, tant que l'accueil était un menu de catalogues qui n'aurait mené nulle
 * part. Le jeu, lui, embarque ce dont il a besoin — sa logique dans le wasm, sa police dans
 * `/static/game/`. Le faire attendre un index qu'il n'interroge pas ajouterait une seconde
 * d'écran vide pour rien.
 *
 * ## L'échelle est entière, et le rendu n'est pas lissé
 *
 * Le framebuffer fait 1280×720 pixels du jeu. Un facteur fractionnaire (1,37×) interpole des
 * pixels qui n'existent pas et rend un texte flou ; l'entier le plus grand qui tienne dans la
 * fenêtre garde chaque pixel carré. `image-rendering: pixelated` fait le reste : sans lui, le
 * navigateur lisse l'agrandissement et annule la mesure.
 *
 * ## Ce que cette page ne prétend pas
 *
 * Le moteur porté rend un **placeholder 2D** — voir `game/bridge.ts` et
 * `crates/engine/nie-wasm/src/lib.rs`. Aucune fidélité au rendu du jeu n'est affirmée ici, et
 * aucun texte de cette page n'en promet.
 */
import {
	GameCanvas,
	LayoutRender,
	lireLayout as readLayout,
	type LayoutJeu as GameLayout,
} from "@niers/inacord-ui";
import { useEffect, useRef, useState } from "react";
import {
	canvasDisplaySize,
	commandForKey,
	type DisplaySize,
	FIXED_TIME_STEP,
	type GameHandle,
	loadGame,
	simulationTiming,
} from "../game/bridge";

/** Real game cinematic, remuxed to MP4 by `nie-model-serve` for browser playback. */
const LOADING_VIDEO = "/assets/video/data/common/movie/Chronicle_Title_fr_01.usm";
/** Runtime export of the real `title_menu` / `title00` START screen. */
const TITLE_LAYOUT_URL = "/api/v1/menu/layout/title_menu";

type OpeningPhase = "video" | "title" | "game";
type LoadState = "loading" | "ready" | "failed";

/** Runs the real VFS opening sequence before handing control to the Rust/WASM game. */
export function Game() {
	const [phase, setPhase] = useState<OpeningPhase>("video");

	if (phase === "video") return <LoadingVideo onComplete={() => setPhase("title")} />;
	if (phase === "title") return <TitleScreen onStart={() => setPhase("game")} />;
	return <InteractiveGame startImmediately />;
}

function LoadingVideo({ onComplete }: { onComplete: () => void }) {
	const [failed, setFailed] = useState(false);
	return (
		<div style={FULL_SCREEN_STYLE}>
			<video
				aria-label="Vidéo d'ouverture d'Inazuma Eleven Victory Road"
				autoPlay
				muted
				playsInline
				preload="auto"
				src={LOADING_VIDEO}
				onEnded={onComplete}
				onError={() => setFailed(true)}
				style={{ width: "100%", height: "100%", objectFit: "contain" }}
			/>
			<button type="button" onClick={onComplete} style={SKIP_BUTTON_STYLE}>
				{failed ? "Ouvrir l'écran START" : "Passer à l'écran START"}
			</button>
		</div>
	);
}

function TitleScreen({ onStart }: { onStart: () => void }) {
	const [layout, setLayout] = useState<GameLayout | null>(null);
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		const controller = new AbortController();
		void fetch(TITLE_LAYOUT_URL, {
			headers: { accept: "application/json" },
			signal: controller.signal,
		})
			.then(async (response) => {
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				return readLayout(await response.json());
			})
			.then(setLayout)
			.catch((error: unknown) => {
				if (!(error instanceof DOMException && error.name === "AbortError")) setFailed(true);
			});
		return () => controller.abort();
	}, []);

	useEffect(() => {
		const accept = (event: KeyboardEvent) => {
			if (event.key !== "Enter" && event.key !== " ") return;
			event.preventDefault();
			onStart();
		};
		window.addEventListener("keydown", accept);
		return () => window.removeEventListener("keydown", accept);
	}, [onStart]);

	if (layout === null) {
		return (
			<div style={FULL_SCREEN_STYLE}>
				<Message>{failed ? "Écran START indisponible." : "Chargement de l'écran START…"}</Message>
			</div>
		);
	}

	const opening = openingTitleLayout(layout);
	return (
		<div style={FULL_SCREEN_STYLE}>
			<GameCanvas canvas={opening.canvas} fond="#080a14">
				<LayoutRender layout={opening} />
				<button type="button" aria-label="COMMENCER" onClick={onStart} style={START_BUTTON_STYLE} />
			</GameCanvas>
		</div>
	);
}

/**
 * Keeps the two title sprites that are complete screen elements. Other runtime objects are
 * whole atlases or still depend on Lua-injected transforms, so drawing them would be false.
 */
export function openingTitleLayout(layout: GameLayout): GameLayout {
	const objects = layout.objects
		.filter((object) => object.name === "title00_03_title_logo" || object.name === "title00_04_gamestart")
		.map((object) => ({
			...object,
			transform:
				object.name === "title00_03_title_logo"
					? { ...object.transform, x: 640, y: 270, scaleX: 0.5, scaleY: 0.5 }
					: { ...object.transform, x: 640, y: 630, scaleX: 2 / 3, scaleY: 2 / 3 },
		}));
	return { ...layout, objects };
}

const FULL_SCREEN_STYLE = {
	position: "fixed",
	inset: 0,
	display: "grid",
	placeItems: "center",
	background: "#080a14",
	overflow: "hidden",
} as const;

const SKIP_BUTTON_STYLE = {
	position: "absolute",
	right: "1.25rem",
	bottom: "1.25rem",
	padding: "0.6rem 1rem",
	border: "1px solid #6bbdff",
	background: "rgb(8 10 20 / 82%)",
	color: "#eef3ff",
	cursor: "pointer",
} as const;

const START_BUTTON_STYLE = {
	position: "absolute",
	inset: 0,
	width: "100%",
	height: "100%",
	border: 0,
	background: "transparent",
	cursor: "pointer",
} as const;

function InteractiveGame({ startImmediately = false }: { startImmediately?: boolean }) {
	const canevas = useRef<HTMLCanvasElement | null>(null);
	const [etat, setEtat] = useState<LoadState>("loading");
	const [score, setScore] = useState<[number, number] | null>(null);
	const [displaySize, setDisplaySize] = useState<DisplaySize | null>(null);

	useEffect(() => {
		let game: GameHandle | null = null;
		let image: number | undefined;
		let vivant = true;
		let resizeCanvas: (() => void) | null = null;
		const heldKeys = new Set<string>();

		const surTouche = (e: KeyboardEvent) => {
			const cmd = commandForKey(e.key);
			if (cmd === null || game === null) return;
			// Les flèches font défiler la page et `Tab` sort du canevas : une touche que le jeu
			// consomme ne doit pas AUSSI agir sur le document.
			e.preventDefault();
			heldKeys.add(e.key.toLowerCase());
			if (!e.repeat) game.input(cmd);
		};

		const surRelache = (e: KeyboardEvent) => {
			if (commandForKey(e.key) === null) return;
			e.preventDefault();
			heldKeys.delete(e.key.toLowerCase());
		};

		const clearHeldKeys = () => heldKeys.clear();

		void (async () => {
			try {
				const p = await loadGame();
				if (!vivant) {
					p.dispose();
					return;
				}
				game = p;
				if (startImmediately) p.input("CMD_ENTER");
				const el = canevas.current;
				const ctx = el?.getContext("2d") ?? null;
				if (el === null || ctx === null) {
					p.dispose();
					game = null;
					setEtat("failed");
					return;
				}
				el.width = p.width;
				el.height = p.height;
				resizeCanvas = () => {
					setDisplaySize(canvasDisplaySize(p.width, p.height, window.innerWidth, window.innerHeight));
				};
				resizeCanvas();
				setEtat("ready");
				window.addEventListener("keydown", surTouche);
				window.addEventListener("keyup", surRelache);
				window.addEventListener("blur", clearHeldKeys);
				window.addEventListener("resize", resizeCanvas);

				let precedent = performance.now();
				let accumulator = 0;
				let displayedScore = "outside-match";
				const boucle = (maintenant: number) => {
					const timing = simulationTiming(accumulator, (maintenant - precedent) / 1000);
					precedent = maintenant;
					accumulator = timing.remainder;
					const held = (keys: readonly string[]) => keys.some((key) => heldKeys.has(key));
					const dx = Number(held(["arrowright", "d"])) - Number(held(["arrowleft", "a", "q"]));
					const dy = Number(held(["arrowdown", "s"])) - Number(held(["arrowup", "w", "z"]));
					p.setMatchInput(dx, dy, held([" ", "enter"]));
					for (let step = 0; step < timing.steps; step += 1) p.update(FIXED_TIME_STEP);
					ctx.putImageData(p.frame(), 0, 0);
					const nextScore = p.isMatch() ? p.score() : null;
					const scoreKey = nextScore === null ? "outside-match" : `${nextScore[0]}:${nextScore[1]}`;
					if (scoreKey !== displayedScore) {
						displayedScore = scoreKey;
						setScore(nextScore);
					}
					image = requestAnimationFrame(boucle);
				};
				image = requestAnimationFrame(boucle);
			} catch {
				// Le détail ne dit rien à qui ouvre la page, et le seul geste utile — recharger —
				// n'en dépend pas.
				if (vivant) setEtat("failed");
			}
		})();

		return () => {
			vivant = false;
			if (image !== undefined) cancelAnimationFrame(image);
			window.removeEventListener("keydown", surTouche);
			window.removeEventListener("keyup", surRelache);
			window.removeEventListener("blur", clearHeldKeys);
			if (resizeCanvas !== null) window.removeEventListener("resize", resizeCanvas);
			game?.dispose();
			game = null;
		};
	}, [startImmediately]);

	return (
		<div
			style={{
				position: "fixed",
				inset: 0,
				display: "grid",
				placeItems: "center",
				background: "#000",
				overflow: "hidden",
			}}
		>
			<canvas
				ref={canevas}
				// Le canevas garde ses proportions et remplit la fenêtre sans la dépasser. `100%`
				// sur les deux axes avec `object-fit` ne s'applique pas à un canevas : ce sont les
				// deux maximums qui bornent, et le rapport d'aspect qui décide lequel mord.
				style={{
					maxWidth: "100%",
					maxHeight: "100%",
					aspectRatio: "16 / 9",
					width: displaySize === null ? "100%" : `${displaySize.width}px`,
					height: displaySize === null ? "auto" : `${displaySize.height}px`,
					imageRendering: "pixelated",
					visibility: etat === "ready" ? "visible" : "hidden",
				}}
			/>
			{etat === "loading" ? <Message>Chargement…</Message> : null}
			{etat === "failed" ? <Message>Le jeu n'a pas pu démarrer. Rechargez la page.</Message> : null}
			{score === null ? null : (
				<p
					aria-live="polite"
					style={{
						position: "absolute",
						top: "1rem",
						color: "#fff",
						font: "600 1.25rem/1 system-ui, sans-serif",
						margin: 0,
					}}
				>
					{score[0]} — {score[1]}
				</p>
			)}
		</div>
	);
}

/** Le seul texte que cette page affiche hors du jeu lui-même. */
function Message({ children }: { children: React.ReactNode }) {
	return (
		<p
			style={{
				position: "absolute",
				color: "#fff",
				font: "400 1rem/1.5 system-ui, sans-serif",
				margin: 0,
			}}
		>
			{children}
		</p>
	);
}
