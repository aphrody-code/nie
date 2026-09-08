import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { AssetSourceProvider } from "@niers/inacord-ui";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Game } from "./Game";
import { OpeningVisual } from "./OpeningVisual";
import * as bridge from "../game/bridge";
import * as nativeFont from "../game/native-font";
import loadingScene from "../../../../crates/engine/nie-formats/src/menu_scenes/loading.json";

const source = {
	urlVideo: (path: string) => `/assets/video/${path}.mp4`,
	urlTexture: () => undefined,
	capacites: () => new Promise(() => {}),
} as never;
const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const previousActEnvironment = environment.IS_REACT_ACT_ENVIRONMENT;
let root: Root;
let container: HTMLDivElement;
let play: ReturnType<typeof spyOn<HTMLMediaElement, "play">>;

beforeEach(() => {
	environment.IS_REACT_ACT_ENVIRONMENT = true;
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	play = spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	play.mockRestore();
	environment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

async function mount(content: ReactNode) {
	await act(async () =>
		root.render(<AssetSourceProvider source={source}>{content}</AssetSourceProvider>)
	);
}

function video() {
	const element = container.querySelector("video");
	expect(element).not.toBeNull();
	return element!;
}

async function dispatch(element: Element, event: string) {
	await act(async () => {
		element.dispatchEvent(new Event(event));
	});
}

async function click(label: string) {
	const button = [...container.querySelectorAll("button")].find(
		(element) => element.textContent === label
	);
	expect(button).toBeDefined();
	await act(async () => button!.click());
}

describe("native opening movies", () => {
	test("loading consumes shared geometry and waits for both bitmap text and the ball", async () => {
		const scene = structuredClone(loadingScene);
		scene.layers[0]!.rect.x = 1200;
		const presentation = spyOn(bridge, "loadMenuPresentation").mockResolvedValue(scene);
		const font = spyOn(nativeFont, "nativeTextRaster").mockResolvedValue({ width: 1, height: 1, rgba: new Uint8Array([255, 255, 255, 255]) });
		const context = spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ putImageData() {} } as never);
		const imageData = Object.getOwnPropertyDescriptor(globalThis, "ImageData");
		Object.defineProperty(globalThis, "ImageData", { configurable: true, value: class { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} } });
		let ready = 0;
		try {
			await mount(<OpeningVisual phase="loading" onReady={() => ready++} />);
			expect(presentation).toHaveBeenCalledWith("loading");
			expect(font).toHaveBeenCalled();
			expect(context).toHaveBeenCalled();
			expect(container.innerHTML).toContain("data-native-region");
			const ball = container.querySelector<HTMLImageElement>("[data-native-region=load_ball01]")!;
			expect(ball.style.left).toBe("1200px");
			expect(container.querySelector("[data-native-text]")).not.toBeNull();
			expect(ready).toBe(0);
			await dispatch(ball, "load");
			expect(ready).toBe(1);
		} finally {
			presentation.mockRestore(); font.mockRestore(); context.mockRestore();
			if (imageData) Object.defineProperty(globalThis, "ImageData", imageData);
			else Reflect.deleteProperty(globalThis, "ImageData");
		}
	});
	test("survives rejected autoplay and a rejected manual retry until playback resumes", async () => {
		let ready = 0,
			ended = 0;
		play.mockRejectedValue(new DOMException("Playback blocked", "NotAllowedError"));
		await mount(
			<OpeningVisual phase="inazuma-eleven" onReady={() => ready++} onEnded={() => ended++} />
		);
		const movie = video();
		expect(movie.getAttribute("src")).toBe("/assets/video/data/common/movie/IE_15th.usm.mp4");
		expect(movie.autoplay).toBe(true);
		expect(movie.muted).toBe(true);
		expect(movie.hasAttribute("playsinline")).toBe(true);
		await dispatch(movie, "canplay");
		expect(ready).toBe(1);
		expect(ended).toBe(0);
		expect(container.textContent).toContain("Reprendre");
		await click("Reprendre");
		expect(play).toHaveBeenCalledTimes(2);
		expect(container.textContent).toContain("Reprendre");
		expect(ended).toBe(0);
		play.mockResolvedValue(undefined);
		await click("Reprendre");
		await dispatch(movie, "playing");
		expect(container.textContent).not.toContain("Reprendre");
		expect(ended).toBe(0);
		await dispatch(movie, "ended");
		expect(ended).toBe(1);
	});

	for (const errorCode of [2, 3]) {
		test(`retries a native media error (${errorCode}) with a fresh video element`, async () => {
			let ready = 0,
				ended = 0;
			await mount(<OpeningVisual phase="level5" onReady={() => ready++} onEnded={() => ended++} />);
			const first = video();
			expect(first.getAttribute("src")).toBe("/assets/video/data/common/movie/L5logo.usm.mp4");
			await dispatch(first, "pause");
			Object.defineProperty(first, "error", { value: { code: errorCode }, configurable: true });
			await dispatch(first, "error");
			expect(container.querySelector("[role=alert]")).not.toBeNull();
			expect(container.querySelector("video")).toBeNull();
			expect(container.textContent).not.toContain("Reprendre");
			expect(ready).toBe(0);
			expect(ended).toBe(0);
			await click("Réessayer");
			const retry = video();
			expect(retry).not.toBe(first);
			expect(retry.getAttribute("src")).toBe(first.getAttribute("src"));
			expect(container.querySelector("[role=alert]")).toBeNull();
			await dispatch(retry, "canplay");
			await dispatch(retry, "playing");
			expect(ready).toBe(1);
			expect(ended).toBe(0);
			await dispatch(retry, "ended");
			expect(ended).toBe(1);
		});
	}

	test("the mounted game advances each logo only once, on ended", async () => {
		const phases: string[] = [];
		const callbacks = {
			onPhaseChange: (phase: string) => phases.push(phase),
			onOpenAvatar() {},
			onOpenSettings() {},
			onOpenMedia() {},
			onOpenExplorer() {},
		};
		await mount(<Game phase="inazuma-eleven" {...callbacks} />);
		let movie = video();
		for (const event of ["loadeddata", "canplay", "playing", "pause", "waiting"]) {
			await dispatch(movie, event);
			expect(phases).toEqual([]);
		}
		await act(async () =>
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
		);
		expect(phases).toEqual([]);
		await dispatch(movie, "ended");
		await dispatch(movie, "ended");
		expect(phases).toEqual(["level5"]);
		await mount(<Game phase="level5" {...callbacks} />);
		movie = video();
		await dispatch(movie, "canplay");
		expect(phases).toEqual(["level5"]);
		await dispatch(movie, "ended");
		await dispatch(movie, "ended");
		expect(phases).toEqual(["level5", "autosave"]);
	});
});
