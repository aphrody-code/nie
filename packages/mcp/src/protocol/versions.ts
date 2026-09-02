/**
 * Versions du protocole et détection d'« ère ».
 *
 * La révision `2026-07-28` a supprimé le handshake `initialize`, les sessions
 * et le flux SSE ouvert en GET : chaque requête porte désormais sa version et
 * ses capacités dans `_meta`. Les révisions antérieures (`2025-11-25` et
 * avant) restent très répandues — Claude Code 2.1.x est encore un client
 * *legacy* (il envoie `initialize` et gère `Mcp-Session-Id`).
 *
 * Ce serveur est donc **dual-era** : la spec l'autorise explicitement
 * (« A dual-era server MAY serve both eras concurrently on the same endpoint
 * or process »), et c'est la seule façon d'être à la fois conforme à la
 * révision courante et utilisable par les clients d'aujourd'hui.
 */

/** Révision courante, sans session ni handshake. */
export const MODERN_PROTOCOL_VERSION = "2026-07-28";

/**
 * Révisions à handshake encore acceptées, de la plus récente à la plus
 * ancienne. L'ordre compte : c'est l'ordre de préférence renvoyé à un client
 * qui demande une version inconnue.
 */
export const LEGACY_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"] as const;

export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [
	MODERN_PROTOCOL_VERSION,
	...LEGACY_PROTOCOL_VERSIONS,
];

/**
 * Version supposée quand un client omet l'en-tête `MCP-Protocol-Version` :
 * la spec autorise à traiter ce cas comme `2025-03-26` (l'en-tête n'existait
 * pas avant `2025-06-18`).
 */
export const ASSUMED_LEGACY_VERSION = "2025-03-26";

export type ProtocolEra = "modern" | "legacy";

export function isModernVersion(version: string): boolean {
	return version === MODERN_PROTOCOL_VERSION || version > MODERN_PROTOCOL_VERSION;
}

export function isSupportedVersion(version: string): boolean {
	return SUPPORTED_PROTOCOL_VERSIONS.includes(version);
}

export function eraOf(version: string): ProtocolEra {
	return isModernVersion(version) ? "modern" : "legacy";
}

/**
 * Choisit la version à annoncer à un client *legacy* lors de `initialize`.
 * La règle des révisions à handshake : si le serveur supporte la version
 * demandée il la renvoie telle quelle, sinon il propose la sienne.
 */
export function negotiateLegacyVersion(requested: unknown): string {
	if (typeof requested === "string" && (LEGACY_PROTOCOL_VERSIONS as readonly string[]).includes(requested)) {
		return requested;
	}
	return LEGACY_PROTOCOL_VERSIONS[0];
}
