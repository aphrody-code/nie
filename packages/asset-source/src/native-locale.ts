/** VFS locale tags measured in declared game-resource paths. */
export type GameLocale = "de" | "en" | "es" | "fr" | "it" | "ja" | "ko" | "pt" | "zh_hans" | "zh_hant";

/** The canonical locale vocabulary for game assets; capability discovery decides availability. */
export const GAME_LOCALES: readonly GameLocale[] = ["de", "en", "es", "fr", "it", "ja", "ko", "pt", "zh_hans", "zh_hant"];

/** Keeps persisted/user supplied locale values inside the native resource vocabulary. */
export function isGameLocale(value: string): value is GameLocale {
	return (GAME_LOCALES as readonly string[]).includes(value);
}

/**
 * Locale-aware game asset selection. The resolver owns VFS fallback order; UI code receives an
 * exact resolved path or `null`, never reconstructs `de/`, `fr/` or `<LG>` paths itself.
 */
export interface NativeAssetResolution {
	logical: string;
	locale: string;
	resolved: string | null;
}

export type NativeAssetResolver = (logical: string, locale: GameLocale) => Promise<NativeAssetResolution>;

/** Browser adapter over the native Rust VFS resolver. */
export const fetchNativeAsset: NativeAssetResolver = async (logical, locale) => {
	const query = new URLSearchParams({ logical, locale });
	const response = await fetch(`/api/v1/inspect/companion?${query}`);
	if (!response.ok) throw new Error("Native asset resolution is unavailable");
	return response.json() as Promise<NativeAssetResolution>;
};
