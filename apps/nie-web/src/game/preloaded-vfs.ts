import { ensureWasm } from "./bridge";
import { PreloadedVfs } from "../wasm/nie_wasm.js";
import { vfsResources, type VfsResources } from "./vfs-resources";
import { fetchBytes } from "@nie/asset-source";

export interface VfsArchiveReference {
	id: string;
	url: string;
	sha256: string;
	bytes: number;
	paths?: string[];
}

/** Host I/O is replaceable; archive parsing always uses the actual Rust WASM class. */
export interface PreloadedVfsHost {
	resources: VfsResources;
	ensureWasm(): Promise<void>;
	fetchArchive(url: string, maximumBytes: number): Promise<Uint8Array>;
	fetchManifest(): Promise<Response>;
}

/** Independent loader lifetime for each host, with session-local integrity and demand caches. */
export function createPreloadedVfsLoader(host: PreloadedVfsHost) {
	const pending = new Map<string, { promise: Promise<number>; version: number }>();
	const mounted = new Map<string, { key: string; archive: PreloadedVfs }>();
	const generation = new Map<string, number>();

	/** Demand-only: callers mount the menu archive after readiness, cold archives on first use. */
	function mountPreloadedVfs(reference: VfsArchiveReference): Promise<number> {
		if (!/^[a-z_]+$/.test(reference.id) || !/^[a-f0-9]{64}$/.test(reference.sha256) || !Number.isSafeInteger(reference.bytes)
			|| reference.bytes <= 0 || reference.bytes > 512 * 1024 * 1024
			|| reference.url !== `/static/game/vfs/${reference.id}_${reference.sha256}.nievfs`) {
			return Promise.reject(new Error("Invalid VFS archive reference"));
		}
		// Optional manifest path lists are lookup metadata, not archive identity.
		const key = JSON.stringify([reference.id, reference.sha256, reference.bytes]);
		const cached = mounted.get(reference.id);
		if (cached?.key === key && host.resources.isMounted(reference.id, cached.archive)) {
			// Returning to the mounted version also supersedes a pending replacement.
			generation.set(reference.id, (generation.get(reference.id) ?? 0) + 1);
			return Promise.resolve(0);
		}
		const existing = pending.get(key);
		if (existing && existing.version === generation.get(reference.id)) return existing.promise;
		const version = (generation.get(reference.id) ?? 0) + 1;
		generation.set(reference.id, version);
		const request = (async () => {
			const bytes = await host.fetchArchive(reference.url, reference.bytes);
			if (bytes.length !== reference.bytes) throw new Error("VFS archive size mismatch");
			const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)));
			const sha256 = Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
			if (sha256 !== reference.sha256) throw new Error("VFS archive SHA-256 mismatch");
			await host.ensureWasm();
			if (generation.get(reference.id) !== version) throw new Error("VFS archive request superseded");
			// Rust checks every canonical path, range and entry CRC before publication.
			const archive = new PreloadedVfs(bytes);
			const count = archive.entry_count;
			host.resources.mount(reference.id, archive);
			mounted.set(reference.id, { key, archive });
			return count;
		})();
		pending.set(key, { promise: request, version });
		void request.finally(() => { if (pending.get(key)?.promise === request) pending.delete(key); }).catch(() => {});
		return request;
	}

	interface VfsManifest {
		schemaVersion: number;
		screen: string;
		locale: string;
		archives: VfsArchiveReference[];
	}

	let manifestPromise: Promise<VfsManifest | null> | null = null;

	/** Existing installations without a candidate manifest retain their individual-file path. */
	async function loadManifest(): Promise<VfsManifest | null> {
		manifestPromise ??= (async () => {
			const response = await host.fetchManifest();
			if (response.status === 404) return null;
			if (!response.ok) throw new Error(`VFS manifest HTTP ${response.status}`);
			const manifest = await response.json() as VfsManifest;
			if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.archives)) throw new Error("Invalid VFS manifest");
			return manifest;
		})();
		let manifest: VfsManifest | null;
		try { manifest = await manifestPromise; }
		catch (error) { manifestPromise = null; throw error; }
		return manifest;
	}

	async function ensureVfsArchive(id: string, screen: string, locale: string): Promise<number> {
		const manifest = await loadManifest();
		if (!manifest || manifest.screen !== screen || manifest.locale !== locale) return 0;
		const matches = manifest.archives.filter(archive => archive.id === id);
		if (matches.length !== 1) throw new Error(`VFS archive is missing or ambiguous: ${id}`);
		return mountPreloadedVfs(matches[0]!);
	}

	/** A cold archive is downloaded only when a consumer requests one of its exact paths. */
	async function readPreloadedFile(path: string): Promise<Uint8Array | null> {
		const cached = host.resources.read(path);
		if (cached) return cached;
		const manifest = await loadManifest();
		if (!manifest) return null;
		const matches = manifest.archives.filter(archive => archive.paths?.includes(path));
		if (matches.length === 0) return null;
		if (matches.length !== 1) throw new Error(`Ambiguous VFS path: ${path}`);
		await mountPreloadedVfs(matches[0]!);
		const bytes = host.resources.read(path);
		if (!bytes) throw new Error(`VFS manifest path is absent from archive: ${path}`);
		return bytes;
	}
	return { mountPreloadedVfs, ensureVfsArchive, readPreloadedFile };
}

const loader = createPreloadedVfsLoader({
	resources: vfsResources,
	ensureWasm,
	fetchArchive: (url, maximumBytes) => fetchBytes(url, maximumBytes, { timeoutMs: 60_000, retries: 0 }),
	fetchManifest: () => fetch("/static/game/vfs/manifest.json", { cache: "no-cache" }),
});

export const { mountPreloadedVfs, ensureVfsArchive, readPreloadedFile } = loader;
