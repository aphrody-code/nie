/** Host binding: VFS bytes enter the native Rust decoder; browsers only paint its RGBA. */
import type { AssetSource } from "@niers/asset-source";
import { ensureWasm } from "./bridge";
import { WasmBitmapFont } from "../wasm/nie_wasm.js";

export const NATIVE_FONT_CONFIG = "data/common/font/font/font_def/font.cfg.bin";
export const NATIVE_FONT_TEXTURE = "data/dx11/font/font_def/font.g4tx";
type FontEntry = { key: string; promise: Promise<WasmBitmapFont>; font?: WasmBitmapFont; users: number; retired: boolean };
let cached: FontEntry | null = null;

async function fontBytes(url: string, maxBytes: number): Promise<Uint8Array> {
	const response = await fetch(url, { cache: "no-cache" });
	if (!response.ok) throw new Error(`Font HTTP ${response.status}`);
	if (Number(response.headers.get("content-length")) > maxBytes) throw new Error("Font response exceeds limit");
	const data = new Uint8Array(await response.arrayBuffer());
	if (data.byteLength > maxBytes) throw new Error("Font response exceeds limit");
	return data;
}

function releaseRetired(entry: FontEntry) {
	if (entry.retired && entry.users === 0 && entry.font) {
		entry.font.free();
		delete entry.font;
	}
}

function acquireFont(source: Pick<AssetSource, "urlFichier">): FontEntry {
	const configUrl = source.urlFichier(NATIVE_FONT_CONFIG);
	const textureUrl = source.urlFichier(NATIVE_FONT_TEXTURE);
	const key = `${configUrl}\n${textureUrl}`;
	if (cached?.key === key) { cached.users++; return cached; }
	if (cached) { cached.retired = true; releaseRetired(cached); }
	const entry: FontEntry = { key, users: 1, retired: false, promise: null! };
	entry.promise = (async () => {
		await ensureWasm();
		const [config, texture] = await Promise.all([
			fontBytes(configUrl, 4 * 1024 * 1024),
			fontBytes(textureUrl, 128 * 1024 * 1024),
		]);
		entry.font = new WasmBitmapFont(config, texture);
		return entry.font;
	})();
	cached = entry;
	return entry;
}

export async function nativeTextRaster(source: Pick<AssetSource, "urlFichier">, text: string, color: number) {
	const entry = acquireFont(source);
	try {
		const font = await entry.promise;
		const rgba = font.render(text, color);
		return { rgba, width: font.width, height: font.height };
	} catch (error) {
		if (cached === entry) { cached = null; entry.retired = true; }
		throw error;
	} finally {
		entry.users--;
		releaseRetired(entry);
	}
}
