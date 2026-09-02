/**
 * Image path resolution utilities
 *
 * Maps game entities (characters, skills, items) to their image file paths.
 * Uses MenuExplorer to auto-discover assets recursively.
 */

import { join } from "node:path";
import { createMenuExplorer, type MenuEntry } from "../menu/explorer.js";
import { hasMenuMaps, loadMenuMaps } from "../menu/maps.js";
import { CDN_URL, PATHS } from "./paths.js";

// Base path for menu images relative to configured data root
const _IMAGES_BASE = join(PATHS.images, "menu");

export const WEB_PATHS = {
	// These will be dynamically resolved, but we keep defaults for fallbacks
	characterFaces: "200_icon/10_icon_chr/face",
	characterUniform: "200_icon/10_icon_chr/uniform",
	skills: "220_img/telop_waza/fr",
	items: "200_icon/02_icon_item",
	emblems: "200_icon/01_icon_emblem",
} as const;

/** Image index for fast lookups */
export interface ImageIndex {
	/** Character faces map: "c01001" -> "path/to/c01001_face.webp" */
	faces: Map<string, string>;
	/** Character uniforms: "c01001" -> "path/to/c01001_uniform.webp" */
	uniforms: Map<string, string>;
	/** Skills: "whs001" -> "path/to/image.webp" */
	skills: Map<string, string>;
	/** Items: "item_id" -> "path/to/image.webp" */
	items: Map<string, string>;
	/** Emblems: "emblem_id" -> "path/to/image.webp" */
	emblems: Map<string, string>;
	/** Auras (Keshin, Soul, etc.): "k00010" -> "path/to/k00010...webp" */
	auras: Map<string, string>;
	/** Classes/Positions icons */
	classes: Map<string, string>;
	/** Common UI icons */
	common: Map<string, string>;
}

let _imageIndex: ImageIndex | null = null;

/**
 * Build index of all available images using recursive scanning
 */
export function buildImageIndex(forceRebuild = false): ImageIndex {
	if (_imageIndex && !forceRebuild) return _imageIndex;

	const index: ImageIndex = {
		faces: new Map(),
		uniforms: new Map(),
		skills: new Map(),
		items: new Map(),
		emblems: new Map(),
		auras: new Map(),
		classes: new Map(),
		common: new Map(),
	};

	let allFiles: MenuEntry[] = [];

	// Strategy 1: Load from cached maps (Fastest)
	if (hasMenuMaps()) {
		// console.log("[ImageAPI] Loading from cached menu maps...");
		allFiles = loadMenuMaps();
	}

	// Strategy 2: Live filesystem scan (Fallback)
	if (allFiles.length === 0) {
		// console.log("[ImageAPI] Cached maps not found. Scanning filesystem...");
		const explorer = createMenuExplorer();
		// Scan specific targets to optimize
		const targets = [
			"200_icon/10_icon_chr",
			"220_img/telop_waza",
			"200_icon/02_icon_item",
			"200_icon/01_icon_emblem",
			"200_icon/06_icon_class",
			"200_icon/15_icon_common",
			"200_icon/00_icon_commn",
		];

		for (const target of targets) {
			const files = explorer.scan(target, { recursive: true, extensions: ["webp", "png"] });
			allFiles.push(...files);
		}
	}

	// Process files
	for (const file of allFiles) {
		const name = file.name;
		const path = file.path; // Relative path

		// 1. Characters (Face)
		// Pattern: .../face/c01000010_l_...
		if (path.includes("/face/")) {
			const match = name.match(/^([a-z]{1,2}\d{6,9})_l_/);
			if (match && !index.faces.has(match[1])) {
				index.faces.set(match[1], path);
			}
		}
		// 1b. Characters (Uniform)
		// Pattern: .../uniform/c01000010_...
		else if (path.includes("/uniform/") || path.includes("/body/")) {
			const match = name.match(/^([a-z]{1,2}\d{6,9})_/);
			if (match && !index.uniforms.has(match[1])) {
				index.uniforms.set(match[1], path);
			}
		}
		// 1c. Auras (Keshin, Soul, etc.)
		// Patterns: aura_fs/k00010..., aura_soul/a00010..., aura_armed/..., aura_mixi/...
		else if (path.includes("/aura_")) {
			const match = name.match(/^([a-z]\d{5,9})_l_/);
			if (match) {
				index.auras.set(match[1], path);
			} else {
				// Some files don't have _l_ suffix
				const simpleMatch = name.match(/^([a-z]\d{5,9})/);
				if (simpleMatch && !index.auras.has(simpleMatch[1])) {
					index.auras.set(simpleMatch[1], path);
				}
			}
		}
		// 2. Skills
		// Pattern: .../telop_waza/.../whs00010_... or aur00010
		else if (path.includes("telop_waza")) {
			const match = name.match(/^(wh[a-z]\d+|aur\d+)/);
			if (match) {
				// Prioritize FR if multiple exist (implicit order or check path)
				if (path.includes("/fr/") || !index.skills.has(match[1])) {
					index.skills.set(match[1], path);
				}
			}
		}
		// 3. Items
		// Pattern: .../02_icon_item/...
		else if (path.includes("02_icon_item")) {
			const baseName = name.replace(/\.(webp|png)$/, "");
			index.items.set(baseName, path);
		}
		// 4. Emblems
		// Pattern: .../01_icon_emblem/...
		else if (path.includes("01_icon_emblem")) {
			const match = name.match(/^(em\d+)/);
			if (match) {
				index.emblems.set(match[1], path);
				const num = parseInt(match[1].replace("em", ""), 10);
				if (!Number.isNaN(num)) {
					index.emblems.set(num.toString(), path);
				}
			}
		}
		// 5. Classes
		else if (path.includes("06_icon_class")) {
			const baseName = name.replace(/\.(webp|png)$/, "");
			index.classes.set(baseName, path);
		}
		// 6. Common
		else if (path.includes("15_icon_common") || path.includes("00_icon_commn")) {
			const baseName = name.replace(/\.(webp|png)$/, "");
			index.common.set(baseName, path);
		}
	}

	_imageIndex = index;
	// console.log(`[ImageAPI] Indexed: ${index.faces.size} faces, ${index.skills.size} skills, ${index.items.size} items, ${index.emblems.size} emblems, ${index.auras.size} auras`);
	return index;
}

/**
 * Rewrite official Zukan/CloudFront URLs to our internal CDN
 */
export function rewriteZukanUrl(url: string | undefined | null): string | undefined {
	if (!url) return undefined;
	if (!url.includes("cloudfront.net") && !url.includes("zukan.inazuma.jp")) return url;

	// Extract path after domain
	let path = url.replace(/https?:\/\/[^/]+/, "");

	// CloudFront URLs often start with /1/, we need to strip it for the mirror
	if (path.startsWith("/1/")) {
		path = path.slice(2);
	}

	// Ensure path starts with /
	const cleanPath = path.startsWith("/") ? path : `/${path}`;

	return `${CDN_URL}/zukan-assets-mirror${cleanPath}`;
}

// ============================================================================
// Image API Factory
// ============================================================================

export function createImageAPI(options?: { baseUrl?: string; useRawPaths?: boolean }) {
	const baseUrl = options?.baseUrl || "";
	const _useRawPaths = options?.useRawPaths || false;

	// Helper to format URL
	const formatUrl = (relativePath: string | undefined) => {
		if (!relativePath) return null;
		if (relativePath.startsWith("http")) return relativePath;

		// Ensure path is consistent with Supabase Storage public URL
		const cleanPath = relativePath.startsWith("/") ? relativePath.slice(1) : relativePath;
		return `${baseUrl}/storage/v1/object/public/menu/${cleanPath}`.replace(/([^:]\/)\/+/g, "$1");
	};

	return {
		/** Get index statistics */
		stats: () => {
			const idx = buildImageIndex();
			return {
				faces: idx.faces.size,
				skills: idx.skills.size,
				items: idx.items.size,
				emblems: idx.emblems.size,
				auras: idx.auras.size,
				classes: idx.classes.size,
				common: idx.common.size,
			};
		},

		/** Rebuild index (force) */
		rebuild: () => buildImageIndex(true),

		// === Character Faces ===
		face: (charaIdStr: string) => {
			const idx = buildImageIndex();
			const found = idx.faces.get(charaIdStr);
			if (found) return found;

			// Fallback: Deterministic path
			return `200_icon/10_icon_chr/face/${charaIdStr}_l_${charaIdStr}_1_l00.webp`;
		},
		faceUrl: (charaIdStr: string) => formatUrl(buildImageIndex().faces.get(charaIdStr)),

		uniform: (charaIdStr: string) =>
			buildImageIndex().uniforms.get(charaIdStr) ||
			`200_icon/10_icon_chr/uniform/${charaIdStr}_0.webp`,
		uniformUrl: (charaIdStr: string) =>
			formatUrl(
				buildImageIndex().uniforms.get(charaIdStr) ||
					`200_icon/10_icon_chr/uniform/${charaIdStr}_0.webp`
			),

		// === Skills ===
		skill: (skillIdStr: string) =>
			buildImageIndex().skills.get(skillIdStr) || `220_img/telop_waza/fr/${skillIdStr}_0.webp`,
		skillUrl: (skillIdStr: string) =>
			formatUrl(
				buildImageIndex().skills.get(skillIdStr) || `220_img/telop_waza/fr/${skillIdStr}_0.webp`
			),

		// === Auras ===
		aura: (auraIdStr: string) => buildImageIndex().auras.get(auraIdStr),
		auraUrl: (auraIdStr: string) => formatUrl(buildImageIndex().auras.get(auraIdStr)),

		// === Items ===
		item: (itemIdStr: string) =>
			buildImageIndex().items.get(itemIdStr) || `200_icon/02_icon_item/${itemIdStr}.webp`,
		itemUrl: (itemIdStr: string) =>
			formatUrl(
				buildImageIndex().items.get(itemIdStr) || `200_icon/02_icon_item/${itemIdStr}.webp`
			),

		// === Emblems ===
		emblem: (emblemId: string) =>
			buildImageIndex().emblems.get(emblemId) || `200_icon/01_icon_emblem/${emblemId}.webp`,
		emblemUrl: (emblemId: string) =>
			formatUrl(
				buildImageIndex().emblems.get(emblemId) || `200_icon/01_icon_emblem/${emblemId}.webp`
			),

		// === Classes & Common ===
		class: (classId: string) => buildImageIndex().classes.get(classId),
		classUrl: (classId: string) => formatUrl(buildImageIndex().classes.get(classId)),
		common: (commonId: string) => buildImageIndex().common.get(commonId),
		commonUrl: (commonId: string) => formatUrl(buildImageIndex().common.get(commonId)),

		/** Get full index */
		index: () => buildImageIndex(),
	};
}

export type ImageAPI = ReturnType<typeof createImageAPI>;
