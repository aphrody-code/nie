import { unavailable } from "./native-error";

type Arguments = Record<string, unknown>;
type JsonRecord = Record<string, unknown>;
interface ApiFile { chemin: string; nom: string; taille: number; cpk?: string }
interface ApiFolder { dossiers: string[]; folder_counts?: Record<string, number>; fichiers: ApiFile[]; total_fichiers: number }
interface ApiSearch { fichiers: ApiFile[]; total: number }
interface ApiHealth {
	capacites: { vfs: string; vfs_entrees: number; vfs_dump: boolean; vfs_cpks: number };
	extensions: Array<{ valeur: string; total: number }>;
}

const WEB_VFS = "web://production-vfs";

function messageFrom(payload: unknown, fallback: string): string {
	if (typeof payload === "string" && payload.trim()) return payload.trim();
	if (payload && typeof payload === "object") {
		for (const key of ["message", "error", "erreur"]) {
			const value = (payload as JsonRecord)[key];
			if (typeof value === "string" && value.trim()) return value.trim();
		}
	}
	return fallback;
}

/** Reject with a string so generated `typedError` bindings preserve their error envelope. */
async function getJson<T>(path: string): Promise<T> {
	let response: Response;
	try {
		response = await fetch(path, { headers: { Accept: "application/json" } });
	} catch (error) {
		return Promise.reject(messageFrom(error, "Le service de lecture est inaccessible."));
	}
	let payload: unknown;
	try { payload = await response.json(); } catch { payload = undefined; }
	if (!response.ok) return Promise.reject(messageFrom(payload, `Lecture impossible (HTTP ${response.status}).`));
	return payload as T;
}

const entry = (file: ApiFile) => ({ path: file.chemin, name: file.nom, size: file.taille, cpk: file.cpk ?? "" });
const positive = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
const nonNegative = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
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

async function list(args: Arguments) {
	const prefix = typeof args.prefix === "string" ? args.prefix.replace(/^\/+|\/+$/gu, "") : "";
	const limit = positive(args.limit, 200);
	const offset = nonNegative(args.offset);
	const page = Math.floor(offset / limit) + 1;
	const params = new URLSearchParams({ page: String(page), per_page: String(limit) });
	const url = prefix ? `/b/${prefix.split("/").map(encodeURIComponent).join("/")}?${params}` : `/b?${params}`;
	const response = await getJson<ApiFolder>(url);
	return {
		dirs: response.dossiers.map(path => ({ name: path.slice(path.lastIndexOf("/") + 1), count: response.folder_counts?.[path] ?? 0 })),
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
	const params = new URLSearchParams({ q: typeof args.query === "string" ? args.query : "", page: String(page), per_page: String(limit) });
	if (typeof args.ext === "string" && args.ext) params.set("ext", args.ext.replace(/^\./u, ""));
	const response = await getJson<ApiSearch>(`/api/v1/recherche?${params}`);
	const files = response.fichiers.map(entry);
	return paged ? { files, total: response.total, offset } : files;
}

/** Read-only HTTP adapter for browser exploration; all other commands remain native-only. */
export function invoke<T>(command: string, args: Arguments = {}): Promise<T> {
	let result: Promise<unknown>;
	switch (command) {
		case "default_game_dir": result = health().then(value => value.capacites.vfs === "pret" ? WEB_VFS : ""); break;
		case "check_game_dir": result = health().then(value => args.gameDir === WEB_VFS && value.capacites.vfs === "pret"); break;
		case "default_wiki_db": case "default_re_db": case "default_anime_db": result = Promise.resolve(null); break;
		case "preload_vfs": case "vfs_stats": result = stats(); break;
		case "vfs_ls": result = list(args); break;
		case "vfs_find": result = search(args, false); break;
		case "vfs_find_paged": result = search(args, true); break;
		case "health": case "api_health": result = health(); break;
		default: return Promise.reject(unavailable(`La commande native « ${command} »`));
	}
	return result as Promise<T>;
}

export function convertFileSrc(path: string): string { return path; }
