/**
 * Hybrid GameTextResolver for Inacord & nie-web.
 *
 * Resolves localized game text directly from loaded .cfg.bin binary tables via nie-wasm
 * (offline / local VFS first), with automatic fallback to the nie-site GraphQL backend.
 *
 * Supports the 9 authentic game locales:
 * de, en, es, fr, it, ja, pt, zh_hans, zh_hant.
 */
import type { GameLocale } from "@niers/inacord-ui";
import {
	type GameTextRef,
	type GameTextResolver,
	fetchGameText,
	refKey,
} from "@niers/inacord-ui/lib/game-text";
import { cfgbin_text_map_json } from "../wasm/nie_wasm.js";
import { ensureWasm } from "./bridge";
import { offlineVfs } from "./offline-vfs";
import { vfsResources } from "./vfs-resources";

/** Candidate VFS file paths for a given locale's menu and common text tables. */
function candidateTextPaths(locale: GameLocale): string[] {
	return [
		`data/common/text/${locale}/menu_text.cfg.bin`,
		`data/common/text/${locale}/system_text.cfg.bin`,
		`data/common/text/${locale}/item_text.cfg.bin`,
		`data/common/text/${locale}/skill_text.cfg.bin`,
		`data/common/text/${locale}/chara_text.cfg.bin`,
		`common/text/${locale}/menu_text.cfg.bin`,
	];
}

/** In-memory cache of decoded text tables: `${locale}:${path}` -> Record<hash, text>. */
const decodedTables = new Map<string, Record<string, string>>();

/** Decodes and caches a .cfg.bin text table using nie-wasm. */
export async function decodeTextTable(
	locale: GameLocale,
	path: string,
	bytes: Uint8Array,
): Promise<Record<string, string> | null> {
	const cacheKey = `${locale}:${path}`;
	const cached = decodedTables.get(cacheKey);
	if (cached) return cached;

	try {
		await ensureWasm();
		const json = cfgbin_text_map_json(bytes);
		const table = JSON.parse(json) as Record<string, string>;
		decodedTables.set(cacheKey, table);
		return table;
	} catch (err) {
		console.warn(`[hybrid-text-resolver] Failed to parse cfg.bin table ${path}:`, err);
		return null;
	}
}

/**
 * Creates a hybrid text resolver that checks local VFS / in-memory cfg.bin tables first,
 * and falls back to the remote nie-site backend for unresolved references.
 */
export function createHybridGameTextResolver(
	fallback: GameTextResolver = fetchGameText,
): GameTextResolver {
	return async (locale: GameLocale, refs: readonly GameTextRef[]) => {
		try {
			await ensureWasm();
		} catch {
			// En environnement de test ou sans origine HTTP relative, on poursuit avec le fallback
		}
		const resolved = new Map<string, readonly string[]>();
		const remainingRefs: GameTextRef[] = [];

		// Try to decode any text tables present in the offline VFS
		const candidates = candidateTextPaths(locale);
		const tables: Record<string, string>[] = [];

		for (const path of candidates) {
			const bytes = vfsResources.read(path) ?? await offlineVfs.fetchFile(path);
			if (bytes) {
				const table = await decodeTextTable(locale, path, bytes);
				if (table) tables.push(table);
			}
		}

		for (const ref of refs) {
			let found = false;
			const targetHash = ref.hash.toString().toLowerCase();

			for (const table of tables) {
				const text = table[targetHash];
				if (text !== undefined) {
					resolved.set(refKey(ref.family, ref.hash), [text]);
					found = true;
					break;
				}
			}

			if (!found) {
				remainingRefs.push(ref);
			}
		}

		// If some references remain unresolved, delegate to the remote backend
		if (remainingRefs.length > 0) {
			try {
				const fallbackResolved = await fallback(locale, remainingRefs);
				for (const [key, texts] of fallbackResolved) {
					resolved.set(key, texts);
				}
			} catch (err) {
				// Remote backend unreachable (e.g. offline mode) — keep what was resolved locally
				console.info("[hybrid-text-resolver] Remote fallback unreachable, using local text:", err);
			}
		}

		return resolved;
	};
}

/** Global shared instance of the hybrid resolver. */
export const hybridGameTextResolver = createHybridGameTextResolver();
