export interface Page<T> { items: T[]; total: number; page: number; per_page: number }
export interface IconEntry { name: string; atlas: string; texture: string; rect: { x:number; y:number; w:number; h:number } | null; width:number; height:number; url:string; atlas_url:string }
export interface IconCatalog { total_indexed:number; results: Page<IconEntry> }
export interface ModeSummary { slug:string; label:string; prefixes:string[]; official:boolean; content_route:string }
export interface ModeCatalog { total_modes:number; official_modes:number; results: Page<ModeSummary> }

import { fetchJson, HttpError } from "@nie/asset-source";

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
	try {
		return await fetchJson<T>(path, { signal, timeoutMs: 15_000, retries: 1 });
	} catch (err: unknown) {
		if (err instanceof HttpError) {
			throw new Error(`${path}: HTTP ${err.status}`);
		}
		throw err;
	}
}

export const screenCatalog = {
	icons(query = "", signal?: AbortSignal) {
		return getJson<IconCatalog>(`/api/v1/icons${query ? `?${query}` : ""}`, signal);
	},
	modes(query = "", signal?: AbortSignal) {
		return getJson<ModeCatalog>(`/api/v1/modes${query ? `?${query}` : ""}`, signal);
	},
	mode(slug: string, signal?: AbortSignal) {
		return getJson<unknown>(`/api/v1/modes/${encodeURIComponent(slug)}`, signal);
	},
};
