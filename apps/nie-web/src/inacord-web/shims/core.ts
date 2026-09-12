/**
 * Browser adapter for the Tauri command surface of the Inacord workspace.
 *
 * The desktop host answers `invoke(command, args)` from Rust. In a page there is no host, but
 * there *is* the same data: `crates/tools/nie-site` serves the live VFS (255 346 entries) on this
 * origin. Every read-only command is therefore routed to HTTP and reshaped into the exact DTO the
 * generated bindings (`src/desktop/lib/bindings.ts`) promise — the views are not rewritten.
 *
 * Commands that touch the user's machine are rebuilt on browser APIs in `./browser-fs` when one
 * exists (File System Access, OPFS, clipboard, downloads). Only what no Web API can express stays
 * rejected, and then the message names the capability instead of blaming the browser.
 */

import * as disk from "./browser-fs";
import {
	type Arguments,
	type JsonRecord,
	encodePath,
	getBase64,
	getBytes,
	getJson,
	nonNegative,
	positive,
	postJson,
	text,
	toBase64,
} from "./http";
import { unavailable } from "./native-error";

interface ApiFile { chemin: string; nom: string; taille: number; cpk?: string }
interface ApiFolder { dossiers: string[]; folder_counts?: Record<string, number>; fichiers: ApiFile[]; total_fichiers: number }
interface ApiSearch { fichiers: ApiFile[]; total: number }
interface ApiHealth {
	capacites: { vfs: string; vfs_entrees: number; vfs_dump: boolean; vfs_cpks: number };
	extensions: Array<{ valeur: string; total: number }>;
}

const WEB_VFS = "web://production-vfs";
/** The upper bound `vfs_read_b64` applies when the caller passes none, as the desktop does. */
const DEFAULT_READ_BYTES = 2 * 1024 * 1024;

const entry = (file: ApiFile) => ({ path: file.chemin, name: file.nom, size: file.taille, cpk: file.cpk ?? "" });
const path = (args: Arguments) => encodePath(text(args.path));
const record = (value: unknown): JsonRecord => (value && typeof value === "object" ? value as JsonRecord : {});
const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

// ---------------------------------------------------------------------------
// VFS index
// ---------------------------------------------------------------------------

async function health(): Promise<ApiHealth> { return getJson<ApiHealth>("/api/v1/health"); }

async function stats() {
	const response = await health();
	const capabilities = response.capacites;
	return {
		montage: capabilities.vfs === "pret" ? capabilities.vfs_dump ? "dump" : "packs" : capabilities.vfs,
		total: capabilities.vfs_entrees,
		cpk_count: capabilities.vfs_cpks,
		extra_count: 0,
		loose_count: capabilities.vfs_dump ? capabilities.vfs_entrees : 0,
		top_ext: response.extensions.map(item => [item.valeur, item.total]),
	};
}

async function folder(prefix: string, limit: number, offset: number): Promise<ApiFolder> {
	const page = Math.floor(offset / Math.max(limit, 1)) + 1;
	const params = new URLSearchParams({ page: String(page), per_page: String(Math.max(limit, 1)) });
	const clean = encodePath(prefix);
	return getJson<ApiFolder>(clean ? `/b/${clean}?${params}` : `/b?${params}`);
}

async function list(args: Arguments) {
	const limit = positive(args.limit, 200);
	const offset = nonNegative(args.offset);
	const response = await folder(text(args.prefix), limit, offset);
	return {
		dirs: response.dossiers.map(dir => ({ name: dir.slice(dir.lastIndexOf("/") + 1), count: response.folder_counts?.[dir] ?? 0 })),
		files: response.fichiers.map(entry),
		file_total: response.total_fichiers,
		file_offset: offset,
		role: null,
	};
}

async function search(args: Arguments, paged: boolean) {
	const limit = positive(args.limit, 200);
	const offset = paged ? nonNegative(args.offset) : 0;
	const page = Math.floor(offset / limit) + 1;
	const params = new URLSearchParams({ q: text(args.query), page: String(page), per_page: String(limit) });
	const ext = text(args.ext);
	if (ext) params.set("ext", ext.replace(/^\./u, ""));
	const response = await getJson<ApiSearch>(`/api/v1/recherche?${params}`);
	const files = response.fichiers.map(entry);
	return paged ? { files, total: response.total, offset } : files;
}

/** One entry's metadata, resolved through the listing of its own folder. */
async function entryMeta(args: Arguments) {
	const full = text(args.path).replace(/^\/+/u, "");
	const cut = full.lastIndexOf("/");
	const parent = cut < 0 ? "" : full.slice(0, cut);
	const response = await folder(parent, 20_000, 0);
	const found = response.fichiers.find(file => file.chemin === full);
	return found ? entry(found) : null;
}

/**
 * The whole index, gathered by walking the folder tree.
 *
 * `vfs_all_entries` feeds the desktop tree and the offline search box. Paging `/api/v1/recherche`
 * on an empty query is not an option — it is a substring filter, not an enumerator — so the walk
 * reuses the same `/b` listing the tree already streams, breadth-first and bounded.
 */
async function allEntries(): Promise<Array<ReturnType<typeof entry>>> {
	const out: Array<ReturnType<typeof entry>> = [];
	const queue = [""];
	while (queue.length > 0 && out.length < 400_000) {
		const prefix = queue.shift() ?? "";
		const response = await folder(prefix, 20_000, 0);
		for (const file of response.fichiers) out.push(entry(file));
		queue.push(...response.dossiers);
	}
	return out;
}

// ---------------------------------------------------------------------------
// Media conventions — `crates/tools/nie-site/src/routes/assets.rs` owns these URLs
// ---------------------------------------------------------------------------

/** `/assets/tex/<atlas>.png`: the `.g4tx` suffix and the `data/` prefix both go, and only then. */
function textureUrl(raw: string, name?: string): string {
	const clean = raw.replace(/^\/+/u, "");
	if (name) return `/assets/tex/${encodePath(clean)}/${encodeURIComponent(name)}.png`;
	const atlas = /\.g4tx$/iu.test(clean) ? clean.replace(/\.g4tx$/iu, "").replace(/^data\//u, "") : clean;
	return `/assets/tex/${encodePath(atlas)}.png`;
}

/** Downscale a PNG to `maxCote` when the browser can, otherwise hand back the full image. */
async function thumbnail(url: string, maxCote: number): Promise<string> {
	const bytes = new Uint8Array(await getBytes(url));
	const scope = globalThis as unknown as {
		createImageBitmap?: (blob: Blob) => Promise<{ width: number; height: number; close?: () => void }>;
		OffscreenCanvas?: new (width: number, height: number) => {
			getContext: (kind: "2d") => { drawImage: (image: unknown, x: number, y: number, w: number, h: number) => void } | null;
			convertToBlob: (options?: { type?: string }) => Promise<Blob>;
		};
	};
	if (!(maxCote > 0) || typeof scope.createImageBitmap !== "function" || typeof scope.OffscreenCanvas !== "function") {
		return toBase64(bytes);
	}
	try {
		const bitmap = await scope.createImageBitmap(new Blob([bytes as BlobPart], { type: "image/png" }));
		const side = Math.max(bitmap.width, bitmap.height);
		if (side <= maxCote) { bitmap.close?.(); return toBase64(bytes); }
		const ratio = maxCote / side;
		const width = Math.max(1, Math.round(bitmap.width * ratio));
		const heightPx = Math.max(1, Math.round(bitmap.height * ratio));
		const canvas = new scope.OffscreenCanvas(width, heightPx);
		const context = canvas.getContext("2d");
		if (!context) { bitmap.close?.(); return toBase64(bytes); }
		context.drawImage(bitmap, 0, 0, width, heightPx);
		bitmap.close?.();
		return toBase64(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
	} catch {
		return toBase64(bytes);
	}
}


/** `tex-info/<path without data/ and .g4tx>` — the upstream adds both back. */
function texInfoPath(vfsPath: string): string {
	const rel = vfsPath.replace(/^\/+/u, "").replace(/^data\//u, "").replace(/\.g4tx$/u, "");
	return rel.split("/").map(encodeURIComponent).join("/");
}

interface FilmLike {
	chemin: string; nom: string; rubrique: string; langue: string | null; octets: number;
	codec: string | null; lisible: boolean | null; largeur: number | null; hauteur: number | null;
	images: number | null; cadence: number | null; duree: number | null; audio: unknown[];
	chiffre: boolean | null; nom_origine: string | null;
}

let videoCatalogPromise: Promise<{ films: FilmLike[]; rubriques: string[] }> | null = null;

/** `CatalogueVideoDto` from the upstream inventory; field names differ only by casing. */
function videoCatalog(): Promise<{ films: FilmLike[]; rubriques: string[] }> {
	videoCatalogPromise ??= getJson<unknown>("/assets/video/catalog.json").then((payload) => {
		const films = array(record(payload).films).map((item): FilmLike => {
			const it = record(item);
			const num = (v: unknown) => (typeof v === "number" ? v : null);
			return {
				chemin: text(it.chemin), nom: text(it.nom), rubrique: text(it.rubrique),
				langue: typeof it.langue === "string" ? it.langue : null,
				octets: num(it.octets) ?? 0, codec: typeof it.codec === "string" ? it.codec : null,
				lisible: typeof it.lisibleNavigateur === "boolean" ? it.lisibleNavigateur : typeof it.lisible === "boolean" ? it.lisible : null,
				largeur: num(it.largeur), hauteur: num(it.hauteur), images: num(it.images),
				cadence: num(it.cadence), duree: num(it.duree), audio: array(it.audio),
				chiffre: typeof it.chiffre === "boolean" ? it.chiffre : null,
				nom_origine: typeof it.nomOrigine === "string" ? it.nomOrigine : typeof it.nom_origine === "string" ? it.nom_origine : null,
			};
		});
		const rubriques = array(record(payload).rubriques).map(text).filter(Boolean);
		return { films, rubriques: rubriques.length ? rubriques : [...new Set(films.map((f) => f.rubrique))] };
	}).catch((error: unknown) => { videoCatalogPromise = null; throw error; });
	return videoCatalogPromise;
}

/** `TextureDto[]` out of the upstream `tex-info` document, whatever casing it uses. */
function textureList(payload: unknown) {
	const source = Array.isArray(payload) ? payload : array(record(payload).textures ?? record(payload).entries);
	return source.map((item, index) => {
		const it = record(item);
		const num = (...keys: string[]) => {
			for (const key of keys) { const v = it[key]; if (typeof v === "number") return v; }
			return 0;
		};
		return {
			id: num("id", "index") || index,
			name: text(it.name ?? it.nom ?? it.texture ?? ""),
			width: num("width", "largeur"),
			height: num("height", "hauteur"),
			dds: it.dds === true || it.has_dds === true,
			size: num("size", "taille", "bytes"),
			regions: num("regions", "region_count"),
		};
	});
}

// ---------------------------------------------------------------------------
// Wiki — `wiki_query` operations onto `/api/v1/wiki/*`
// ---------------------------------------------------------------------------

const WIKI_KINDS: Record<string, string[]> = {
	search_character: ["chara", "character", "personnage"],
	search_skill: ["waza", "skill", "technique"],
};

async function wikiQuery(args: Arguments): Promise<unknown> {
	const operation = text(args.operation);
	const inner = record(args.args);
	switch (operation) {
		case "search_character":
		case "search_skill": {
			const q = text(inner.query);
			if (!q) return [];
			const page = await getJson<{ results?: unknown[] }>(`/api/v1/wiki/search?${new URLSearchParams({ q, limit: "50" })}`);
			const kinds = WIKI_KINDS[operation] ?? [];
			return array(page.results).filter(item => {
				const kind = text(record(item).kind ?? record(item).type).toLowerCase();
				return kind === "" || kinds.includes(kind);
			});
		}
		case "character_skills": {
			const id = text(inner.id);
			if (!id) return [];
			const card = record(await getJson(`/api/v1/wiki/characters/${encodeURIComponent(id)}`));
			return array(card.skills ?? card.techniques ?? record(card.character).skills);
		}
		case "load_staff":
			return getJson("/api/v1/wiki/coaches");
		case "resolve_many_by_code": {
			const codes = array(inner.codes).filter((code): code is string => typeof code === "string" && code !== "");
			if (codes.length === 0) return [];
			const query = new URLSearchParams({ codes: codes.slice(0, 200).join(","), locale: text(inner.locale) || "fr" });
			const page = record(await getJson(`/api/v1/wiki/names?${query}`));
			return array(page.entries ?? page.noms ?? page.results ?? page.names);
		}
		default:
			return Promise.reject(
				`L’opération wiki « ${operation} » n’a pas d’équivalent HTTP sur cette origine : `
				+ `nie-site n’expose pas encore la route correspondante (/api/v1/wiki/${operation.replace(/_/gu, "-")}). `
				+ "L’application Desktop l’exécute contre le miroir SQLite local.",
			);
	}
}

// ---------------------------------------------------------------------------
// Game data — the routes added alongside this adapter
// ---------------------------------------------------------------------------

const GAME_DATA_FAMILIES = [
	"skills", "items", "auras", "trophies", "quests", "chara_picker", "shops", "stadiums", "passives",
	"special_tactics", "emblems", "gallery", "tricks", "activities", "belong_teams", "formations",
	"uniforms", "charas", "opponent_teams", "movies", "musics", "dictionary", "exp_table", "drops",
	"capsule_rates", "noms",
] as const;

const gameDataUrl = (family: string) => `/api/v1/game-data/${family}`;

// ---------------------------------------------------------------------------
// Machine-bound commands with no Web API at all
// ---------------------------------------------------------------------------

/** `command → why the browser cannot do it`, appended to the Desktop invitation. */
const DESKTOP_ONLY: Record<string, string> = {
	encode_cfgbin_config: "Réencoder un `.cfg.bin` (encodeur natif nie-formats)",
	export_mod_as_cpk: "Empaqueter un mod en CPK",
	vfs_index_scan_start: "Le balayage d’index en tâche de fond",
	vfs_index_scan_cancel: "Le balayage d’index en tâche de fond",
	vfs_index_scan_take: "Le balayage d’index en tâche de fond",
	vfs_cache_vider: "Vider le cache CPK du serveur",
	video_precharger: "Le préchargement vidéo sur disque",
	resolve_avatar_composition: "La composition d’avatar (résolveur natif)",
	save_open: "Ouvrir une sauvegarde : le parseur est en Rust et nie-site n’expose aucune route de sauvegarde (crates/tools/nie-site/src/routes/save.rs ne sert que le contrat de roster)",
	save_list_blobs: "Lister les blobs d’une sauvegarde : aucune route nie-site ne parse une sauvegarde",
	save_blob_hex_b64: "Lire un blob de sauvegarde : aucune route nie-site ne parse une sauvegarde",
	save_export: "Exporter une sauvegarde : aucune route nie-site ne parse une sauvegarde",
	default_save_path: "Le chemin de sauvegarde du jeu",
	launch_save_editor: "Lancer l’éditeur de sauvegarde",
	open_raw_cpk: "Ouvrir un CPK du disque : aucune route nie-site n’accepte un CPK téléversé",
	raw_cpk_describe: "Inspecter un CPK du disque",
	raw_cpk_read_b64: "Lire dans un CPK du disque",
	raw_cpk_extract_to: "Extraire depuis un CPK du disque",
	raw_cpk_extract_all: "Extraire un CPK du disque",
	raw_cpk_audio_preview_b64: "Décoder un audio d’un CPK du disque",
	raw_cpk_video_preview_b64: "Décoder une vidéo d’un CPK du disque",
	raw_cpk_glb_bytes_b64: "Assembler un modèle d’un CPK du disque",
	install_niers_blender_addon: "Installer l’add-on Blender",
	blender_preview_png_b64: "Le rendu Blender",
	blender_open_scene: "Ouvrir une scène dans Blender",
	blender_build_skill_scene: "Construire une scène Blender",
	lua_eval: "Évaluer du Lua",
	lua_execute: "Exécuter du Lua",
	lua_globals: "Inspecter les globales Lua",
	lua_session_exec: "La session Lua persistante",
	lua_session_attach: "La session Lua persistante",
	lua_session_broadcast: "La session Lua persistante",
	lua_session_eval: "La session Lua persistante",
	lua_session_set_global: "La session Lua persistante",
	lua_session_globals: "La session Lua persistante",
	lua_session_reload: "La session Lua persistante",
	lua_session_drain: "La session Lua persistante",
	lua_session_api_report: "La session Lua persistante",
	live_status: "L’attachement au jeu en cours d’exécution",
	live_find_team: "L’attachement au jeu en cours d’exécution",
	live_read_team: "L’attachement au jeu en cours d’exécution",
	live_write_member: "L’attachement au jeu en cours d’exécution",
	live_scan_u32: "L’attachement au jeu en cours d’exécution",
	live_write_u32: "L’attachement au jeu en cours d’exécution",
	re_trace_module_regions: "Le traçage de processus",
	re_trace_read_bytes_b64: "Le traçage de processus",
	re_trace_write_bytes_b64: "Le traçage de processus",
	re_trace_dump_module: "Le traçage de processus",
	re_dump_open: "L’analyse d’un dump mémoire",
	re_dump_scan: "L’analyse d’un dump mémoire",
	mcp_status: "La configuration du serveur MCP",
	mcp_install: "La configuration du serveur MCP",
	viola_dump_start: "Les opérations Viola (dump, pack, merge, crypto)",
	viola_cancel: "Les opérations Viola (dump, pack, merge, crypto)",
	viola_pack: "Les opérations Viola (dump, pack, merge, crypto)",
	viola_merge: "Les opérations Viola (dump, pack, merge, crypto)",
	viola_crypto: "Les opérations Viola (dump, pack, merge, crypto)",
	forge_report: "L’audit Forge d’un dépôt local",
	forge_blockers: "L’audit Forge d’un dépôt local",
	aphrody_pixel_mesurer: "La mesure pixel d’une image du disque",
	aphrody_pixel_tokens_css: "La mesure pixel d’une image du disque",
	aphrody_pixel_comparer: "La comparaison pixel de deux images du disque",
	aphrody_pixel_vectoriser: "La vectorisation d’une image du disque",
	aphrody_pixel_planche: "L’assemblage de planche depuis le disque",
	sqlite_load: "L’accès SQLite direct",
	sqlite_select: "L’accès SQLite direct",
	sqlite_execute: "L’accès SQLite direct",
	sqlite_close: "L’accès SQLite direct",
	open_in_scene_editor: "L’éditeur de scène natif",
};

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/** Adapter for the Tauri command surface: HTTP for reads, Web APIs for the rest. */
export function invoke<T>(command: string, args: Arguments = {}): Promise<T> {
	let result: Promise<unknown>;
	switch (command) {
		// --- host discovery -------------------------------------------------
		case "default_game_dir": result = health().then(value => value.capacites.vfs === "pret" ? WEB_VFS : ""); break;
		case "check_game_dir": result = health().then(value => args.gameDir === WEB_VFS && value.capacites.vfs === "pret"); break;
		case "default_wiki_db": case "default_re_db": case "default_anime_db": result = Promise.resolve(null); break;
		case "health": case "api_health": result = health(); break;
		case "preload_vfs": case "vfs_stats": result = stats(); break;
		case "vfs_cache_stats":
			result = health().then(value => ({ cpk_count: value.capacites.vfs_cpks, entries: value.capacites.vfs_entrees, bytes: 0, hits: 0, misses: 0 }));
			break;

		// --- index ----------------------------------------------------------
		case "vfs_ls": result = list(args); break;
		case "vfs_find": result = search(args, false); break;
		case "vfs_find_paged": result = search(args, true); break;
		case "vfs_entry_meta": result = entryMeta(args); break;
		case "vfs_all_entries": result = allEntries(); break;
		case "vfs_describe":
			result = entryMeta(args).then(meta => meta
				? [`Chemin : ${meta.path}`, `Taille : ${meta.size} octets`, meta.cpk ? `Archive : ${meta.cpk}` : "Fichier libre (hors CPK)"]
				: Promise.reject("Chemin introuvable dans l’index VFS."));
			break;
		case "vfs_related":
			result = getJson(`/api/v1/resources/related/${path({ path: args.needle })}?${new URLSearchParams({ limit: String(positive(args.limit, 50)) })}`)
				.then(payload => array(Array.isArray(payload) ? payload : record(payload).fichiers ?? record(payload).entries ?? record(payload).related)
					.map(item => { const it = record(item); return entry({ chemin: text(it.chemin ?? it.path), nom: text(it.nom ?? it.name), taille: typeof it.taille === "number" ? it.taille : typeof it.size === "number" ? it.size : 0, cpk: text(it.cpk) }); }));
			break;

		// --- bytes and media ------------------------------------------------
		case "vfs_read_b64": result = getBase64(`/f/${path(args)}`, typeof args.maxBytes === "number" ? args.maxBytes : DEFAULT_READ_BYTES); break;
		case "vfs_texture_png_b64": result = getBase64(textureUrl(text(args.path))); break;
		case "vfs_texture_named_png_b64": result = getBase64(textureUrl(text(args.path), text(args.nom))); break;
		case "vfs_texture_thumb_png_b64": result = thumbnail(textureUrl(text(args.path)), positive(args.maxCote, 256)); break;
		case "vfs_texture_named_thumb_png_b64": result = thumbnail(textureUrl(text(args.path), text(args.nom)), positive(args.maxCote, 256)); break;
		// Measured 2026-09-12: `nie-model-serve` prefixes `data/` itself and appends `.g4tx`.
		case "vfs_texture_list": result = getJson(`/assets/tex-info/${texInfoPath(text(args.path))}`).then(textureList); break;
		case "vfs_audio_preview_b64": result = getBase64(`/assets/audio/${path(args)}`); break;
		case "vfs_audio_cues": result = getJson(`/assets/audio-info/${path(args)}`); break;
		case "vfs_audio_cue_wav_b64":
			result = getBase64(`/assets/audio/${path(args)}?${new URLSearchParams({ id: String(nonNegative(args.awbId)) })}`);
			break;
		case "vfs_video_preview_b64": result = getBase64(`/assets/video/${path(args)}`); break;
		// One document for both: `/assets/video/catalog.json` is the full inventory the Cinema
		// page needs (measured 2026-09-12), and a film's info is its entry in it.
		case "video_catalog": result = videoCatalog(); break;
		case "video_info": result = videoCatalog().then((catalogue) => {
			const wanted = text(args.path).replace(/^\/+/u, "");
			const film = catalogue.films.find((f) => f.chemin === wanted);
			if (!film) throw new Error(`Film inconnu du catalogue : ${wanted}`);
			return film;
		}); break;
		case "vfs_glb_bytes_b64": {
			const stem = text(args.path).split("/").pop()?.replace(/\.[^.]+$/u, "") ?? "";
			result = getBase64(`/assets/model-full/${encodeURIComponent(stem)}.glb`);
			break;
		}
		case "vfs_motion_clips": result = getJson(`/api/v1/motion/clips/${path(args)}`); break;
		case "vfs_apercu_camera": result = getJson(`/api/v1/preview/camera/${path(args)}`); break;
		case "vfs_apercu_navmesh": result = getJson(`/api/v1/preview/navmesh/${path(args)}`); break;

		// --- configuration files --------------------------------------------
		case "vfs_decode_cfgbin": result = getJson(`/api/v1/formats/decode/${path(args)}`); break;
		case "vfs_decode_cfgbin_typed": result = getJson(`/api/v1/game-data/decode_cfgbin?${new URLSearchParams({ path: text(args.path) })}`); break;

		// --- export ----------------------------------------------------------
		case "vfs_export_formats": result = getJson(`/api/v1/export/formats/${path(args)}`); break;
		case "vfs_export_default_name": {
			const name = text(args.path).split("/").pop() ?? "export";
			result = Promise.resolve(`${name.replace(/\.[^.]+$/u, "")}.${text(args.format) || "bin"}`);
			break;
		}
		case "vfs_export_as":
			result = getBytes(`/api/v1/export/file/${path(args)}?${new URLSearchParams({ format: text(args.format) })}`)
				.then(buffer => disk.saveBytes(text(args.dest) || text(args.path), new Uint8Array(buffer)));
			break;
		case "vfs_extract_to":
			result = getBytes(`/f/${path(args)}`).then(buffer => disk.saveBytes(text(args.dest) || text(args.path), new Uint8Array(buffer)));
			break;
		case "vfs_export_many": {
			const paths = array(args.paths).filter((p): p is string => typeof p === "string");
			const format = text(args.format);
			result = (async () => {
				const dir = await disk.pickDirectory();
				let written = 0;
				let bytes = 0;
				for (const item of paths) {
					const url = format
						? `/api/v1/export/file/${encodePath(item)}?${new URLSearchParams({ format })}`
						: `/f/${encodePath(item)}`;
					const data = new Uint8Array(await getBytes(url));
					if (dir) await disk.writeInto(dir, item, data); else disk.download(item, data);
					written += 1;
					bytes += data.byteLength;
				}
				return { count: written, bytes, dest: dir?.name ?? "téléchargements" };
			})();
			break;
		}

		// --- Lua -------------------------------------------------------------
		case "lua_list_scripts":
			result = getJson("/api/v1/lua/scripts").then(payload => array(Array.isArray(payload) ? payload : record(payload).scripts ?? record(payload).fichiers)
				.map(item => { const it = record(item); return entry({ chemin: text(it.chemin ?? it.path), nom: text(it.nom ?? it.name), taille: typeof it.taille === "number" ? it.taille : typeof it.size === "number" ? it.size : 0, cpk: text(it.cpk) }); }));
			break;
		case "lua_chunk_info": result = getJson(`/api/v1/lua/scripts/${path(args)}`); break;
		case "lua_disassemble": result = getJson(`/api/v1/lua/desassemblage/${path(args)}`); break;

		// --- 3D services ------------------------------------------------------
		case "model_service_avatar_catalog": result = getJson("/api/v1/3d/modeles"); break;
		case "model_service_avatar_glb_b64": {
			const model = text(args.modelPath);
			const [family, file] = model.includes("/") ? [model.slice(0, model.indexOf("/")), model.slice(model.indexOf("/") + 1)] : ["chara", model];
			result = getBase64(`/model/${encodeURIComponent(family)}/${encodeURIComponent(file)}`);
			break;
		}
		case "model_service_menu_png_b64": result = getBase64(`/api/v1/menu/runtime/${encodeURIComponent(text(args.screen))}?format=png`); break;

		// --- Aphrody pet -------------------------------------------------------
		case "aphrody_pet_etat": result = getJson("/pet/aphrody.json"); break;
		case "aphrody_pet_frame_png_b64":
			result = getBase64(`/pet/frame/${encodeURIComponent(text(args.animation))}/${nonNegative(args.index)}.png`);
			break;

		// --- wiki ---------------------------------------------------------------
		case "wiki_query": result = wikiQuery(args); break;

		// --- disk, rebuilt on browser APIs ---------------------------------------
		case "describe_disk_file": result = disk.pickFile().then(disk.describeFile); break;
		case "read_disk_file_b64":
			result = disk.pickFile().then(async file => {
				const max = typeof args.maxBytes === "number" && args.maxBytes > 0 ? args.maxBytes : file.size;
				return toBase64(await file.slice(0, max).arrayBuffer());
			});
			break;
		case "disk_file_exists": result = Promise.resolve(false); break;
		case "write_text_file":
			result = disk.saveBytes(text(args.dest) || "note.txt", new TextEncoder().encode(text(args.contents)), "text/plain")
				.then(() => null);
			break;
		case "copy_disk_file_to_appdata":
			result = disk.pickFile().then(async file => {
				const target = text(args.destAppdataRel) || file.name;
				await disk.writeOverride(target, toBase64(await file.arrayBuffer()));
				return target;
			});
			break;
		case "vfs_write_b64":
		case "vfs_write_loose_override_b64":
			result = disk.writeOverride(text(args.path), text(args.dataB64));
			break;
		case "save_bytes_b64":
			result = Promise.resolve(disk.download(text(args.dest) || "export.bin", (() => {
				const binary = atob(text(args.dataB64));
				const bytes = new Uint8Array(binary.length);
				for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
				return bytes;
			})()));
			break;
		case "stage_texture_replacement":
			result = disk.pickFile("image/png").then(async file => {
				const target = text(args.destAppdataRel) || text(args.vfsPath);
				await disk.writeOverride(target, toBase64(await file.arrayBuffer()));
				return target;
			});
			break;
		case "list_packs_dir": result = disk.listOverrides(); break;
		case "trash_appdata_files":
			result = disk.removeOverrides(array(args.appdataRelPaths).filter((p): p is string => typeof p === "string"));
			break;
		case "clipboard_write_file_list":
			result = disk.copyPathList(array(args.paths).filter((p): p is string => typeof p === "string"));
			break;
		case "clipboard_read_file_list": result = Promise.resolve([]); break;

		// --- process launches, replaced by a navigation ------------------------
		case "open_in_blender": {
			const stem = text(args.path).split("/").pop()?.replace(/\.[^.]+$/u, "") ?? "";
			result = getBytes(`/assets/model-full/${encodeURIComponent(stem)}.glb`)
				.then(buffer => { disk.download(`${stem}.glb`, new Uint8Array(buffer), "model/gltf-binary"); return null; });
			break;
		}

		// --- silent no-ops -----------------------------------------------------
		case "set_titlebar_theme": result = Promise.resolve(null); break;
		case "take_pending_open": result = Promise.resolve(null); break;

		default: {
			if (command.startsWith("game_data_")) {
				const family = command.slice("game_data_".length);
				if (family === "calculate_stats") {
					result = postJson("/api/v1/game-data/calculate_stats", {
						charaParamId: text(args.charaParamId), chara_param_id: text(args.charaParamId),
						level: nonNegative(args.level), rarityCode: nonNegative(args.rarityCode), rarity_code: nonNegative(args.rarityCode),
					});
					break;
				}
				if ((GAME_DATA_FAMILIES as readonly string[]).includes(family)) { result = getJson(gameDataUrl(family)); break; }
			}
			const reason = DESKTOP_ONLY[command];
			return Promise.reject(unavailable(reason ?? `La commande native « ${command} »`));
		}
	}
	return result as Promise<T>;
}

export function convertFileSrc(path: string): string { return path; }
