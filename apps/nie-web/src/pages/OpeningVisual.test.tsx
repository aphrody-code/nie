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
	urlVideoAudio: (path: string) => `/assets/video/${path}?track=audio`,
	urlTexture: (path: string) => `/assets/texture/${path}`,
	capacites: () => new Promise(() => {}),
} as never;
const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const previousActEnvironment = environment.IS_REACT_ACT_ENVIRONMENT;
let root: Root;
let container: HTMLDivElement;
let fetchMock: ReturnType<typeof spyOn>;
let hidden: PropertyDescriptor | undefined;
let play: ReturnType<typeof spyOn<HTMLMediaElement, "play">>;

beforeEach(() => {
	environment.IS_REACT_ACT_ENVIRONMENT = true;
	(window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL("http://localhost:3000/");
	hidden = Object.getOwnPropertyDescriptor(document, "hidden");
	Object.defineProperty(document, "hidden", { configurable: true, value: false });
	fetchMock = spyOn(globalThis, "fetch").mockImplementation(Object.assign(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "video/mp4" } }), { preconnect: globalThis.fetch.preconnect }));
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	play = spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	play.mockRestore();
	fetchMock.mockRestore();
	if (hidden) Object.defineProperty(document, "hidden", hidden); else Reflect.deleteProperty(document, "hidden");
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
		const settings = (window as unknown as { happyDOM: { settings: { enableImageFileLoading: boolean } } }).happyDOM.settings;
		const imageLoading = settings.enableImageFileLoading;
		settings.enableImageFileLoading = false;
		const complete = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "complete");
		Object.defineProperty(HTMLImageElement.prototype, "complete", { configurable: true, get: () => false });
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
			if (complete) Object.defineProperty(HTMLImageElement.prototype, "complete", complete);
			settings.enableImageFileLoading = imageLoading;
			if (imageData) Object.defineProperty(globalThis, "ImageData", imageData);
			else Reflect.deleteProperty(globalThis, "ImageData");
		}
	});
	test("waits for both ready tracks and successful playback after rejected autoplay", async () => {
		let ready = 0, ended = 0;
		play.mockRejectedValue(new DOMException("Playback blocked", "NotAllowedError"));
		await mount(<OpeningVisual phase="inazuma-eleven" onReady={() => ready++} onEnded={() => ended++} />);
		const movie = video();
		const audio = soundtrack();
		expect(movie.getAttribute("src")).toStartWith("blob:");
		expect(movie.muted).toBe(true);
		expect(movie.hasAttribute("playsinline")).toBe(true);
		expect(fetchMock).toHaveBeenCalledWith("/assets/video/data/common/movie/IE_15th.usm.mp4", expect.anything());
		expect(fetchMock).toHaveBeenCalledWith("/assets/video/data/common/movie/IE_15th.usm?track=audio", expect.anything());
		Object.defineProperty(movie, "readyState", { configurable: true, value: 3 });
		await dispatch(movie, "canplay");
		expect(play).not.toHaveBeenCalled();
		expect(ready).toBe(0);
		Object.defineProperty(audio, "readyState", { configurable: true, value: 3 });
		await dispatch(audio, "canplay");
		expect(ready).toBe(0);
		expect(container.textContent).toContain("Reprendre");
		await click("Reprendre");
		expect(play).toHaveBeenCalledTimes(4);
		expect(ready).toBe(0);
		play.mockResolvedValue(undefined);
		await click("Reprendre");
		expect(ready).toBe(1);
		expect(container.textContent).not.toContain("Reprendre");
		await end(movie);
		expect(ended).toBe(0);
		await end(audio);
		await end(movie);
		expect(ended).toBe(1);
	});

	for (const errorCode of [2, 3]) {
		test(`retries native media error (${errorCode}) with fresh paired elements`, async () => {
			let ready = 0, ended = 0;
			await mount(<OpeningVisual phase="level5" onReady={() => ready++} onEnded={() => ended++} />);
			const first = video();
			Object.defineProperty(first, "error", { value: { code: errorCode }, configurable: true });
			await dispatch(first, "error");
			expect(container.querySelector("[role=alert]")).not.toBeNull();
			expect(container.querySelector("video")).toBeNull();
			expect(ready).toBe(0);
			expect(ended).toBe(0);
			await click("Réessayer");
			const retry = video();
			expect(retry).not.toBe(first);
			expect(retry.getAttribute("src")).not.toBe(first.getAttribute("src"));
			await readyPair();
			expect(ready).toBe(1);
			await end(retry);
			expect(ended).toBe(0);
			await end(soundtrack());
			expect(ended).toBe(1);
		});
	}

	test("the mounted game advances each logo only once after both tracks end", async () => {
		const phases: string[] = [];
		const callbacks = { onPhaseChange: (phase: string) => phases.push(phase), onOpenAvatar() {}, onOpenSettings() {}, onOpenMedia() {}, onOpenExplorer() {} };
		await mount(<Game phase="inazuma-eleven" {...callbacks} />);
		await readyPair();
		await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
		expect(phases).toEqual([]);
		await end(video());
		expect(phases).toEqual([]);
		await end(soundtrack());
		await end(video());
		expect(phases).toEqual(["level5"]);
		await mount(<Game phase="level5" {...callbacks} />);
		await readyPair();
		await end(soundtrack());
		expect(phases).toEqual(["level5"]);
		await end(video());
		await end(video());
		expect(phases).toEqual(["level5", "autosave"]);
	});

	test("late pending playback cannot announce readiness after unmount", async () => {
		const resolves: Array<() => void> = [];
		let ready = 0;
		play.mockImplementation(() => new Promise<void>(done => { resolves.push(done); }));
		await mount(<OpeningVisual phase="level5" onReady={() => ready++} />);
		await readyPair();
		await mount(null);
		await act(async () => { resolves.forEach(resolve => resolve()); });
		expect(ready).toBe(0);
		expect(container.querySelector("video")).toBeNull();
	});
});

function soundtrack() {
	const audio = container.querySelector("audio");
	expect(audio).not.toBeNull();
	return audio!;
}
async function readyPair() {
	const movie = video(), audio = soundtrack();
	for (const element of [movie, audio]) Object.defineProperty(element, "readyState", { configurable: true, value: 3 });
	await dispatch(movie, "canplay");
}
async function end(element: HTMLMediaElement) {
	Object.defineProperty(element, "ended", { configurable: true, value: true });
	await dispatch(element, "ended");
}
