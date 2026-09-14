/** Direct browser host for the Rust game state after a native title-menu choice. */
import { useEffect, useRef, useState } from "react";
import { createStandardGamepadMenuSampler, type MenuIntent } from "@niers/inacord-ui/shell/menu-interaction";
import {
	canvasDisplaySize,
	commandForKey,
	type DisplaySize,
	FIXED_TIME_STEP,
	type GameHandle,
	loadGame,
	simulationTiming,
} from "../game/bridge";
import { ScreenStatus } from "./screen-parts";

export const WASM_MODE_INDEX = {
	story_mode: 0,
	chronicle_mode: 1,
	competition: 2,
	victory_road: 3,
	bb_stadium: 4,
} as const;

export type WasmMode = keyof typeof WASM_MODE_INDEX;

export const WASM_MODE_LABELS: Record<WasmMode, string> = {
	story_mode: "Mode Histoire",
	chronicle_mode: "Mode Chronique",
	competition: "Mode Compétition",
	victory_road: "Victory Road",
	bb_stadium: "Stade BB",
};

export function runtimeCommandForMenuIntent(intent: MenuIntent): string | null {
	if (intent.type === "activate") return "CMD_ENTER";
	if (intent.type !== "move") return null;
	return {
		up: "CMD_FCS_MTX_UP",
		down: "CMD_FCS_MTX_DOWN",
		left: "CMD_FCS_MTX_LEFT",
		right: "CMD_FCS_MTX_RIGHT",
	}[intent.direction];
}

/** Enter a reconstructed mode through the same command API as keyboard/gamepad input. */
export function enterWasmMode(game: Pick<GameHandle, "input">, mode: WasmMode): void {
	game.input("CMD_ENTER"); // title -> host-owned main menu
	for (let index = 0; index < 5; index += 1) game.input("CMD_FCS_NEXT");
	game.input("CMD_ENTER"); // Adversaires -> mode selector
	for (let index = 0; index < WASM_MODE_INDEX[mode]; index += 1) game.input("CMD_FCS_NEXT");
	game.input("CMD_ENTER");
}

export function WasmGameSurface({ mode, onBack, gamepadSampler }: {
	mode: WasmMode;
	onBack: () => void;
	gamepadSampler?: ReturnType<typeof createStandardGamepadMenuSampler>;
}) {
	const canvas = useRef<HTMLCanvasElement | null>(null);
	const localSampler = useRef(createStandardGamepadMenuSampler());
	const sampler = gamepadSampler ?? localSampler.current;
	const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
	const [score, setScore] = useState<[number, number] | null>(null);
	const [displaySize, setDisplaySize] = useState<DisplaySize | null>(null);

	useEffect(() => {
		let game: GameHandle | null = null;
		let frame: number | undefined;
		let alive = true;
		let resize: (() => void) | null = null;
		const held = new Set<string>();
		const keydown = (event: KeyboardEvent) => {
			if (event.key === "Escape" && !event.repeat && !event.altKey && !event.ctrlKey && !event.metaKey) {
				event.preventDefault();
				onBack();
				return;
			}
			const command = commandForKey(event.key);
			if (command === null || game === null) return;
			event.preventDefault();
			held.add(event.key.toLowerCase());
			if (!event.repeat) game.input(command);
		};
		const keyup = (event: KeyboardEvent) => {
			if (commandForKey(event.key) === null) return;
			event.preventDefault();
			held.delete(event.key.toLowerCase());
		};
		const clearHeld = () => held.clear();

		void loadGame().then((loaded) => {
			if (!alive) { loaded.dispose(); return; }
			game = loaded;
			enterWasmMode(loaded, mode);
			const element = canvas.current;
			const context = element?.getContext("2d") ?? null;
			if (!element || !context) throw new Error("2D canvas unavailable");
			element.width = loaded.width;
			element.height = loaded.height;
			resize = () => setDisplaySize(canvasDisplaySize(loaded.width, loaded.height, window.innerWidth, window.innerHeight));
			resize();
			setState("ready");
			window.addEventListener("keydown", keydown);
			window.addEventListener("keyup", keyup);
			window.addEventListener("blur", clearHeld);
			window.addEventListener("resize", resize);
			let previous = performance.now();
			let accumulator = 0;
			let shownScore = "outside-match";
			let leaving = false;
			const render = (now: number) => {
				if (!alive || leaving) return;
				const timing = simulationTiming(accumulator, (now - previous) / 1000);
				previous = now;
				accumulator = timing.remainder;
				const down = (keys: readonly string[]) => keys.some((key) => held.has(key));
				const pads = typeof navigator.getGamepads === "function" ? navigator.getGamepads() : [];
				for (const intent of sampler.sample(pads)) {
					if (intent.type === "cancel") { leaving = true; onBack(); return; }
					const command = runtimeCommandForMenuIntent(intent);
					if (command) loaded.input(command);
				}
				const pad = [...pads].find(candidate => candidate?.connected && candidate.mapping === "standard");
				const padX = pad ? (pad.axes[0] ?? 0) + Number(pad.buttons[15]?.pressed) - Number(pad.buttons[14]?.pressed) : 0;
				const padY = pad ? (pad.axes[1] ?? 0) + Number(pad.buttons[13]?.pressed) - Number(pad.buttons[12]?.pressed) : 0;
				const dx = Math.max(-1, Math.min(1, Number(down(["arrowright", "d"])) - Number(down(["arrowleft", "a", "q"])) + padX));
				const dy = Math.max(-1, Math.min(1, Number(down(["arrowdown", "s"])) - Number(down(["arrowup", "w", "z"])) + padY));
				loaded.setMatchInput(dx, dy, down([" ", "enter"]) || Boolean(pad?.buttons[0]?.pressed));
				for (let step = 0; step < timing.steps; step += 1) loaded.update(FIXED_TIME_STEP);
				context.putImageData(loaded.frame(), 0, 0);
				const nextScore = loaded.isMatch() ? loaded.score() : null;
				const scoreKey = nextScore === null ? "outside-match" : `${nextScore[0]}:${nextScore[1]}`;
				if (scoreKey !== shownScore) { shownScore = scoreKey; setScore(nextScore); }
				frame = requestAnimationFrame(render);
			};
			frame = requestAnimationFrame(render);
		}).catch(() => { if (alive) setState("failed"); });

		return () => {
			alive = false;
			if (frame !== undefined) cancelAnimationFrame(frame);
			window.removeEventListener("keydown", keydown);
			window.removeEventListener("keyup", keyup);
			window.removeEventListener("blur", clearHeld);
			if (resize) window.removeEventListener("resize", resize);
			game?.dispose();
		};
	}, [mode, onBack, sampler]);

	const label = WASM_MODE_LABELS[mode];
	return <section className="wasm-game-surface" aria-label={label} data-wasm-mode={mode} data-runtime-completeness="partial">
		<canvas ref={canvas} role="img" aria-label={`${label} — rendu du jeu`} style={{
			width: displaySize ? `${displaySize.width}px` : "100%",
			height: displaySize ? `${displaySize.height}px` : "auto",
			visibility: state === "ready" ? "visible" : "hidden",
		}}>{label}</canvas>
		{state !== "ready" ? <ScreenStatus state={state === "failed" ? "unavailable" : "loading"} /> : null}
		{score ? <p className="wasm-game-surface__score" aria-live="polite">{score[0]} — {score[1]}</p> : null}
		<button type="button" className="game-shell-return" onClick={onBack}><kbd>Esc</kbd> Retour</button>
	</section>;
}
