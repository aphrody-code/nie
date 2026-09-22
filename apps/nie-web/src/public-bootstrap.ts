/**
 * Zero-framework bootstrap for the public root.
 *
 * A fresh `/`, `/en`, `/es` or `/ja` must prove the WASM module and every server readiness
 * capability before the application menu is mounted. Secondary routes retain the existing host
 * immediately; they already represent an explicit destination and must not replay startup.
 *
 * This module deliberately imports no UI framework. It is the first extraction boundary for the
 * public host: readiness, retry and the transition into the menu are plain DOM and TypeScript.
 */
import { sante, type SanteApi } from "@nie/asset-source/nie-site";
import { ensureWasm } from "./game/bridge";
import { gameNavigationHistory } from "./game/navigation";
import { splitLanguagePrefix } from "./routing";

const RETRY_DELAY_MS = 2_000;

export interface PublicBootstrapDependencies {
	pathname(): string;
	readHealth(signal: AbortSignal): Promise<SanteApi>;
	loadWasm(): Promise<void>;
	markMenuReady(): void;
	schedule(callback: () => void, delayMs: number): number;
	cancelSchedule(id: number): void;
}

const DEFAULT_DEPENDENCIES: PublicBootstrapDependencies = {
	pathname: () => window.location.pathname,
	readHealth: sante,
	loadWasm: ensureWasm,
	markMenuReady: () => {
		window.history.replaceState(
			gameNavigationHistory(window.history.state, { view: "home", openingPhase: "menu" }),
			"",
			window.location.href,
		);
	},
	schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
	cancelSchedule: (id) => window.clearTimeout(id),
};

export function isFreshPublicRoot(pathname: string): boolean {
	return splitLanguagePrefix(pathname).route === "/";
}

export function isStartupReady(health: SanteApi): boolean {
	const capabilities = health.capacites;
	return capabilities.vfs === "pret"
		&& capabilities.vfs_entrees > 0
		&& capabilities.vfs_contenu
		&& capabilities.gisement
		&& capabilities.anime
		&& capabilities.bundle;
}

function readinessSurface(root: HTMLElement, state: "loading" | "failed", retry?: () => void): void {
	// The gate owns no opening artwork: this empty 1280x720 surface is only the eventual
	// framebuffer target. Until Rust and the content-backed VFS are ready, it paints no pixels.
	const canvas = document.createElement("canvas");
	canvas.width = 1280;
	canvas.height = 720;
	canvas.dataset.publicBootstrap = state;
	canvas.setAttribute("aria-hidden", "true");
	canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;object-fit:contain;image-rendering:pixelated";

	const status = document.createElement("p");
	status.setAttribute("role", state === "failed" ? "alert" : "status");
	status.textContent = state === "failed" ? "Ressources indisponibles." : "Chargement…";
	// Keep readiness available to assistive technology without adding invented game pixels.
	status.style.cssText = "position:fixed;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0";
	const children: Node[] = [canvas, status];
	if (state === "failed" && retry) {
		const button = document.createElement("button");
		button.type = "button";
		button.textContent = "Réessayer";
		button.setAttribute("aria-label", "Réessayer");
		button.style.cssText = "position:fixed;left:50%;bottom:2rem;transform:translateX(-50%)";
		button.addEventListener("click", retry, { once: true });
		children.push(button);
	}
	root.replaceChildren(...children);
}

/** Mount the framework-free root gate, returning a complete cancellation function. */
export function mountPublicBootstrap(
	root: HTMLElement,
	mountHost: () => Promise<void> | void,
	dependencies: PublicBootstrapDependencies = DEFAULT_DEPENDENCIES,
): () => void {
	if (!isFreshPublicRoot(dependencies.pathname())) {
		void mountHost();
		return () => {};
	}

	let disposed = false;
	let timer: number | null = null;
	let controller: AbortController | null = null;

	const attempt = async () => {
		if (disposed) return;
		if (timer !== null) {
			dependencies.cancelSchedule(timer);
			timer = null;
		}
		controller?.abort();
		controller = new AbortController();
		readinessSurface(root, "loading");
		try {
			const [health] = await Promise.all([
				dependencies.readHealth(controller.signal),
				dependencies.loadWasm(),
			]);
			if (disposed || controller.signal.aborted) return;
			if (health.capacites.vfs === "absent") {
				readinessSurface(root, "failed", () => { void attempt(); });
				return;
			}
			if (!isStartupReady(health)) {
				timer = dependencies.schedule(() => { void attempt(); }, RETRY_DELAY_MS);
				return;
			}
			dependencies.markMenuReady();
			await mountHost();
		} catch {
			if (!disposed && !controller.signal.aborted) {
				readinessSurface(root, "failed", () => { void attempt(); });
			}
		}
	};

	void attempt();
	return () => {
		disposed = true;
		controller?.abort();
		if (timer !== null) dependencies.cancelSchedule(timer);
	};
}
