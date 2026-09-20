import { describe, expect, test } from "bun:test";
import type { SanteApi } from "@niers/asset-source/nie-site";
import {
	isFreshPublicRoot,
	isStartupReady,
	mountPublicBootstrap,
	type PublicBootstrapDependencies,
} from "./public-bootstrap";

const readyHealth: SanteApi = {
	api: "test",
	capacites: {
		vfs: "pret",
		vfs_entrees: 1,
		vfs_dump: false,
		vfs_contenu: true,
		gisement: true,
		anime: true,
		bundle: true,
	},
	vues: [],
};

function dependencies(health: SanteApi, pathname = "/"): PublicBootstrapDependencies {
	return {
		pathname: () => pathname,
		readHealth: async () => health,
		loadWasm: async () => {},
		markMenuReady: () => {},
		schedule: () => 1,
		cancelSchedule: () => {},
	};
}

async function settle(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

describe("framework-free public bootstrap", () => {
	test("the readiness path has no React import and defers the compatibility host", async () => {
		const main = await Bun.file(new URL("main.ts", import.meta.url)).text();
		const bootstrap = await Bun.file(new URL("public-bootstrap.ts", import.meta.url)).text();
		for (const source of [main, bootstrap]) {
			expect(source).not.toMatch(/(?:from\s+|import\()["']react(?:-dom)?(?:\/[^"']*)?["']/u);
			expect(source).not.toContain("#nie-host");
		}
		expect(main).not.toMatch(/from\s+["']\.\/host-mount["']/u);
		expect(main).toContain('import("./host-mount")');
		expect(bootstrap).not.toContain("host-mount");
	});

	test("recognizes only localized roots as fresh startup routes", () => {
		for (const route of ["/", "/en", "/es", "/ja"]) expect(isFreshPublicRoot(route)).toBeTrue();
		for (const route of ["/menu", "/en/menu", "/textures", "/story_mode"]) expect(isFreshPublicRoot(route)).toBeFalse();
	});

	test("requires the complete content-backed readiness contract", () => {
		expect(isStartupReady(readyHealth)).toBeTrue();
		for (const incomplete of [
			{ vfs_entrees: 0 },
			{ vfs_contenu: false },
			{ gisement: false },
			{ anime: false },
			{ bundle: false },
		] as const) {
			expect(isStartupReady({ ...readyHealth, capacites: { ...readyHealth.capacites, ...incomplete } })).toBeFalse();
		}
	});

	test("mounts secondary routes immediately without probing startup", async () => {
		const root = document.createElement("div");
		let mounted = 0;
		let probes = 0;
		const deps = dependencies(readyHealth, "/textures");
		deps.readHealth = async () => { probes += 1; return readyHealth; };
		mountPublicBootstrap(root, () => { mounted += 1; }, deps);
		await settle();
		expect(mounted).toBe(1);
		expect(probes).toBe(0);
	});

	test("keeps the fresh root framework-free until both health and WASM are ready", async () => {
		const root = document.createElement("div");
		let mounted = 0;
		let markedReady = 0;
		const deps = dependencies(readyHealth);
		deps.markMenuReady = () => { markedReady += 1; };
		mountPublicBootstrap(root, () => { mounted += 1; }, deps);
		const canvas = root.querySelector<HTMLCanvasElement>('canvas[data-public-bootstrap="loading"]');
		expect(canvas).not.toBeNull();
		expect([canvas?.width, canvas?.height]).toEqual([1280, 720]);
		expect(root.querySelector('[role="status"]')?.getAttribute("style")).toContain("clip-path");
		expect(root.querySelector("div")).toBeNull();
		expect(mounted).toBe(0);
		await settle();
		expect(mounted).toBe(1);
		expect(markedReady).toBe(1);
	});

	test("an absent VFS offers retry but never a bypass", async () => {
		const root = document.createElement("div");
		let mounted = 0;
		mountPublicBootstrap(root, () => { mounted += 1; }, dependencies({
			...readyHealth,
			capacites: { ...readyHealth.capacites, vfs: "absent" },
		}));
		await settle();
		expect(mounted).toBe(0);
		expect(root.querySelector('canvas[data-public-bootstrap="failed"]')).not.toBeNull();
		expect(root.querySelector('button[aria-label="Réessayer"]')).not.toBeNull();
		expect(root.textContent).not.toContain("Passer");
	});
});
