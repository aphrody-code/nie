/**
 * @file unlock-condition.ts
 * @description Decodeur des conditions de deblocage (galerie + scene_archive)
 *
 * Les champs `openCond` (gallery_config) et `condition` (scene_archive_config)
 * encodent en base64 un petit arbre de conditions binaire.
 *
 * Format du blob decode :
 *   [00 00 00 00]      4 octets nuls (en-tete)
 *   [len:1]            longueur du reste du blob
 *   [OPCODE racine:1]  0x05 feuille / 0x0B,0x17 compose (AND) / 0x3F trivial
 *   [corps...]         suite de tokens
 *
 * Tokens du corps (a partir de l'octet 6) :
 *   0x35 <ns:4 BE>     debut d'une feuille, namespace de la condition
 *   0x34 <val:4 BE>    valeur taguee (CRC32 de l'event id pour les event-flags)
 *   0x32 <cmp:4 BE>    comparateur (>= cmp). Pour le story : la valeur EST le seuil
 *   autres octets      ignores (separateurs / padding)
 *
 * Namespaces connus :
 *   0xB91936DA  progression de l'histoire (seuil BE : ev01=20010 .. ev08=90010, +10000/episode)
 *   0x2A3D4543  event-flag      (val = CRC32 poly 0xEDB88320 de l'event_id)
 *   0xC9783DBF  event-flag (2e)
 *   0xBE04A598  event-flag (3e)
 *   0xDAFAB70A  event-flag (4e)
 *   0x17ED34F7  event-flag (5e)
 *
 * Une feuille au namespace story => seuil de progression.
 * Toute autre feuille => event-flag identifie par CRC32.
 * Plusieurs feuilles (opcode 0x0B / 0x17) => combinaison AND.
 * Opcode 0x3F (ou aucune feuille) => condition triviale (toujours debloque).
 */

import { crc32String } from "./hash/crc32.js";

// ============================================================================
// Constantes
// ============================================================================

/** Namespace de la progression de l'histoire (seuil BE). */
export const STORY_NAMESPACE = 0xb91936da;

/** Seuil de progression du 1er episode (ev01). */
export const STORY_EPISODE_BASE = 20010;
/** Increment de seuil entre deux episodes successifs. */
export const STORY_EPISODE_STEP = 10000;

const TOKEN_LEAF = 0x35;
const TOKEN_VALUE = 0x34;
const TOKEN_COMPARE = 0x32;

const ROOT_TRIVIAL = 0x3f;

// ============================================================================
// Types
// ============================================================================

/** Operateur de combinaison entre les feuilles d'une condition. */
export type UnlockOp = "none" | "single" | "and";

/** Une exigence d'event-flag (event accompli au moins `count` fois). */
export interface RequiredEvent {
	/** Namespace de l'event-flag, ex. "0x2A3D4543". */
	namespace: string;
	/** CRC32 (poly 0xEDB88320) de l'event_id, non signe. */
	crc: number;
	/** CRC32 au format hex "0xABCD1234". */
	crcHex: string;
	/** Nombre d'occurrences requises (comparateur >=). */
	count: number;
	/** event_id resolu via le reverse-lookup, si disponible. */
	eventId?: string;
}

/** Condition de deblocage decodee. */
export interface UnlockCondition {
	/**
	 * Type de condition :
	 * - `always`     : aucune exigence (opcode trivial)
	 * - `story`      : uniquement un seuil de progression de l'histoire
	 * - `eventFlag`  : uniquement des event-flags
	 * - `composite`  : seuil story + event-flags combines
	 */
	type: "always" | "story" | "eventFlag" | "composite";
	/** Operateur entre les feuilles. */
	op: UnlockOp;
	/** Seuil de progression de l'histoire (BE), si present. */
	storyThreshold?: number;
	/** Numero d'episode deduit du seuil (ev01 = 1), si applicable. */
	storyEpisode?: number;
	/** Event-flags requis (combines en AND), si presents. */
	requiredEvents: RequiredEvent[];
	/** Le blob base64 d'origine (conserve pour debug/round-trip). */
	raw: string;
}

// ============================================================================
// Helpers internes
// ============================================================================

interface Leaf {
	ns: number;
	value: number | null;
	compare: number | null;
}

function toHex32(value: number): string {
	return `0x${(value >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
}

/**
 * Deduit le numero d'episode (1-based) depuis un seuil de progression.
 * Les seuils non alignes sur la grille des episodes renvoient `undefined`.
 */
export function storyThresholdToEpisode(threshold: number): number | undefined {
	if (threshold < STORY_EPISODE_BASE) return undefined;
	const delta = threshold - STORY_EPISODE_BASE;
	if (delta % STORY_EPISODE_STEP !== 0) return undefined;
	return delta / STORY_EPISODE_STEP + 1;
}

/**
 * Tokenise le corps du blob en feuilles brutes.
 * Chaque feuille demarre a un token 0x35 (namespace).
 */
function tokenizeLeaves(buf: Uint8Array): Leaf[] {
	const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	const leaves: Leaf[] = [];
	let current: Leaf | null = null;
	let i = 6; // saute [00 00 00 00][len][root]

	while (i < buf.length) {
		const token = buf[i];
		if (token === TOKEN_LEAF && i + 5 <= buf.length) {
			if (current) leaves.push(current);
			current = { ns: view.getUint32(i + 1, false), value: null, compare: null };
			i += 5;
			continue;
		}
		if (token === TOKEN_VALUE && i + 5 <= buf.length && current) {
			current.value = view.getUint32(i + 1, false) >>> 0;
			i += 5;
			continue;
		}
		// Premier comparateur de la feuille uniquement (les feuilles event-flag
		// peuvent en contenir plusieurs ; seul le premier porte la semantique).
		if (token === TOKEN_COMPARE && i + 5 <= buf.length && current && current.compare === null) {
			current.compare = view.getUint32(i + 1, false) >>> 0;
			i += 5;
			continue;
		}
		i += 1;
	}
	if (current) leaves.push(current);
	return leaves;
}

// ============================================================================
// Decodeur principal
// ============================================================================

/**
 * Decode une condition de deblocage encodee en base64.
 *
 * @param encoded - Blob base64 (openCond / condition) ; vide ou invalide => `always`.
 * @param resolveEvent - Optionnel : map CRC32 -> event_id pour annoter les feuilles.
 */
export function decodeUnlockCondition(
	encoded: string | null | undefined,
	resolveEvent?: (crc: number) => string | undefined
): UnlockCondition {
	const raw = encoded ?? "";
	const buf = decodeBase64(raw);

	if (!buf || buf.length < 6) {
		return { type: "always", op: "none", requiredEvents: [], raw };
	}

	const root = buf[5];
	const leaves = tokenizeLeaves(buf);

	if (root === ROOT_TRIVIAL || leaves.length === 0) {
		return { type: "always", op: "none", requiredEvents: [], raw };
	}

	let storyThreshold: number | undefined;
	const requiredEvents: RequiredEvent[] = [];

	for (const leaf of leaves) {
		if (leaf.ns === STORY_NAMESPACE) {
			// Pour le story, la valeur de comparaison EST le seuil.
			if (leaf.compare !== null) storyThreshold = leaf.compare;
			continue;
		}
		const crc = (leaf.value ?? 0) >>> 0;
		const event: RequiredEvent = {
			namespace: toHex32(leaf.ns),
			crc,
			crcHex: toHex32(crc),
			count: leaf.compare ?? 1,
		};
		const resolved = resolveEvent?.(crc);
		if (resolved) event.eventId = resolved;
		requiredEvents.push(event);
	}

	const hasStory = storyThreshold !== undefined;
	const hasEvents = requiredEvents.length > 0;

	let type: UnlockCondition["type"];
	if (hasStory && hasEvents) type = "composite";
	else if (hasStory) type = "story";
	else if (hasEvents) type = "eventFlag";
	else type = "always";

	const leafCount = (hasStory ? 1 : 0) + requiredEvents.length;
	const op: UnlockOp = leafCount > 1 ? "and" : leafCount === 1 ? "single" : "none";

	const result: UnlockCondition = { type, op, requiredEvents, raw };
	if (hasStory) {
		result.storyThreshold = storyThreshold;
		const episode = storyThresholdToEpisode(storyThreshold as number);
		if (episode !== undefined) result.storyEpisode = episode;
	}
	return result;
}

// ============================================================================
// Reverse-lookup CRC32
// ============================================================================

/**
 * Construit une map CRC32 -> event_id depuis une liste d'event ids connus.
 * Utile pour annoter les `requiredEvents` avec leur identifiant lisible.
 */
export function buildEventCrcLookup(eventIds: Iterable<string>): Map<number, string> {
	const map = new Map<number, string>();
	for (const id of eventIds) {
		if (!id) continue;
		map.set(crc32String(id) >>> 0, id);
	}
	return map;
}

// ============================================================================
// Utilitaire base64 (sans dependance Node-only)
// ============================================================================

function decodeBase64(value: string): Uint8Array | null {
	if (!value) return null;
	try {
		if (typeof Buffer !== "undefined") {
			return new Uint8Array(Buffer.from(value, "base64"));
		}
		// Fallback navigateur
		const bin = atob(value);
		const out = new Uint8Array(bin.length);
		for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
		return out;
	} catch {
		return null;
	}
}
