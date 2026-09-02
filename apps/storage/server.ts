// Service Storage self-host — remplace Supabase Storage à l'identique côté client.
//
// Implémente le sous-ensemble de l'API `/storage/v1` réellement consommé par
// `@supabase/storage-js` dans le monorepo : upload, update, remove, list, move,
// copy, createSignedUrl, download public et authentifié, et lecture des buckets.
// Les octets vivent sur le disque du VPS (`RG_STORAGE_ROOT`), l'index reste dans
// la table `storage.objects` de la base locale — donc les listings et les URLs
// publiques déjà stockées en base restent valables sans réécriture.
//
// L'authentification réutilise `SUPABASE_JWT_SECRET` : les clés anon et
// service_role existantes continuent de fonctionner telles quelles.
import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join as pathJoin, normalize as pathNormalize, resolve } from "node:path";
import { SQL } from "bun";
import { boundaryOf, extractFilePart } from "./multipart";

const PORT = Number(process.env.RG_STORAGE_PORT ?? 8810);
const HOST = process.env.RG_STORAGE_HOST ?? "127.0.0.1";
const ROOT = resolve(process.env.RG_STORAGE_ROOT ?? "/var/www/rg-storage");
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET ?? "";
const DATABASE_URL = process.env.DATABASE_URL ?? "";

if (!JWT_SECRET) throw new Error("[rg-storage] SUPABASE_JWT_SECRET manquant");
if (!DATABASE_URL) throw new Error("[rg-storage] DATABASE_URL manquant");

const sql = new SQL(DATABASE_URL);

const CORS: Record<string, string> = {
	"access-control-allow-origin": "*",
	"access-control-allow-methods": "GET, POST, PUT, DELETE, HEAD, OPTIONS",
	"access-control-allow-headers": "authorization, apikey, content-type, x-upsert, cache-control, x-client-info",
	"access-control-expose-headers": "content-length, content-range, etag, last-modified",
	"access-control-max-age": "86400",
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", ...CORS, ...extra },
	});
}

/** Erreur au format Supabase Storage (`{ statusCode, error, message }`). */
function fail(status: number, error: string, message: string): Response {
	return json({ statusCode: String(status), error, message }, status);
}

// ─────────────────────────────── JWT ───────────────────────────────

interface Claims {
	role?: string;
	sub?: string;
	email?: string;
	[k: string]: unknown;
}

/** Vérifie un JWT HS256 signé avec `SUPABASE_JWT_SECRET`. Renvoie null si invalide. */
function verifyJwt(token: string): Claims | null {
	const parts = token.split(".");
	if (parts.length !== 3) return null;
	const [head, payload, signature] = parts;
	const expected = createHmac("sha256", JWT_SECRET).update(`${head}.${payload}`).digest();
	let given: Buffer;
	try {
		given = Buffer.from(signature, "base64url");
	} catch {
		return null;
	}
	if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
	try {
		const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as Claims;
		if (typeof claims.exp === "number" && claims.exp * 1000 < Date.now()) return null;
		return claims;
	} catch {
		return null;
	}
}

/** Extrait les claims de la requête (header Authorization, sinon apikey). */
function claimsOf(req: Request): Claims | null {
	const auth = req.headers.get("authorization");
	const bearer = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
	const token = bearer ?? req.headers.get("apikey");
	return token ? verifyJwt(token) : null;
}

// ───────────────────────── Autorisations ─────────────────────────

/** Cache des buckets (id → public), rafraîchi à la demande. */
let bucketCache: Map<string, boolean> | null = null;

async function buckets(): Promise<Map<string, boolean>> {
	if (bucketCache) return bucketCache;
	const rows = await sql`select id, public from storage.buckets`;
	bucketCache = new Map(rows.map((r: { id: string; public: boolean }) => [r.id, r.public]));
	return bucketCache;
}

/** Vrai si l'utilisateur porté par les claims est administrateur (table `profiles`). */
async function isAdmin(claims: Claims | null): Promise<boolean> {
	if (!claims) return false;
	if (claims.role === "service_role") return true;
	if (!claims.sub) return false;
	const rows = await sql`select public.is_admin() as ok`.catch(() => []);
	return rows[0]?.ok === true;
}

/**
 * Reproduit les politiques RLS de `storage.objects` telles qu'elles existaient
 * sur Supabase : lecture publique sur les buckets publics, écriture réservée au
 * service_role ou aux administrateurs, et dossier personnel pour `avatars`.
 */
async function canWrite(bucket: string, name: string, claims: Claims | null): Promise<boolean> {
	if (claims?.role === "service_role") return true;
	if (bucket === "avatars") {
		const folder = name.split("/")[0];
		return Boolean(claims?.sub) && folder === claims?.sub;
	}
	return await isAdmin(claims);
}

async function canRead(bucket: string, claims: Claims | null): Promise<boolean> {
	const map = await buckets();
	if (map.get(bucket)) return true;
	if (claims?.role === "service_role") return true;
	return await isAdmin(claims);
}

// ───────────────────────── Chemins disque ─────────────────────────

/** Résout `<bucket>/<name>` sous ROOT en refusant toute traversée de répertoire. */
function diskPath(bucket: string, name: string): string | null {
	if (!bucket || bucket.includes("/") || bucket.startsWith(".")) return null;
	const clean = pathNormalize(decodeURIComponent(name)).replace(/^(\.\.[/\\])+/, "");
	const full = resolve(pathJoin(ROOT, bucket, clean));
	if (full !== pathJoin(ROOT, bucket) && !full.startsWith(pathJoin(ROOT, bucket) + "/")) return null;
	return full;
}

// ───────────────────────── Index Postgres ─────────────────────────

/**
 * Insère ou met à jour la ligne d'index d'un objet.
 *
 * ⚠ ON BINDE L'OBJET, jamais `JSON.stringify(...)`. Bun sérialise déjà un objet
 * vers JSON pour un paramètre jsonb ; passer une chaîne l'encode une SECONDE fois
 * et écrit un jsonb de type `string`, dont `metadata->>'mimetype'` vaut NULL.
 * Mesuré sur cette base le 12/8/2026 :
 *   `${JSON.stringify(o)}::jsonb` -> jsonb_typeof = "string", mimetype = NULL
 *   `${o}::jsonb`                 -> jsonb_typeof = "object", mimetype = "image/webp"
 * C'est ce défaut qui a laissé 5535 des 6423 lignes du bucket `tweets` sans type
 * MIME exploitable dans l'index. Même forme que
 * `packages/cron/src/tasks/ie-crawl/tweet-media-storage.ts`, qui, lui, était juste.
 */
async function indexObject(bucket: string, name: string, size: number, mime: string) {
	await sql`
		insert into storage.objects (bucket_id, name, metadata, created_at, updated_at, last_accessed_at, version)
		values (${bucket}, ${name}, ${{ size, mimetype: mime, cacheControl: "max-age=3600" }},
		        now(), now(), now(), gen_random_uuid()::text)
		on conflict (bucket_id, name) do update
		  set metadata = excluded.metadata, updated_at = now(), version = excluded.version`;
}

/**
 * Retire une ligne d'index.
 *
 * Le trigger `storage.protect_delete` hérité de Supabase refuse toute
 * suppression directe tant que le drapeau de session `storage.allow_delete_query`
 * ne vaut pas `true` — c'est le garde-fou contre les purges accidentelles, et
 * l'API Storage est justement la seule autorisée à le lever. On le pose donc
 * localement à la transaction plutôt que de retirer le trigger.
 */
async function unindexObject(bucket: string, name: string) {
	await sql.begin(async (tx) => {
		await tx`select set_config('storage.allow_delete_query', 'true', true)`;
		await tx`delete from storage.objects where bucket_id = ${bucket} and name = ${name}`;
	});
}

// ───────────────────────── URL signées ─────────────────────────

function signPath(bucket: string, name: string, expiresAt: number): string {
	return createHmac("sha256", JWT_SECRET).update(`${bucket}/${name}:${expiresAt}`).digest("base64url");
}

function checkSignature(bucket: string, name: string, token: string | null): boolean {
	if (!token) return false;
	const [expRaw, sig] = token.split(".");
	const expiresAt = Number(expRaw);
	if (!Number.isFinite(expiresAt) || expiresAt * 1000 < Date.now()) return false;
	return signPath(bucket, name, expiresAt) === sig;
}

// ───────────────────────── Service des fichiers ─────────────────────────

async function serveFile(full: string, req: Request, download: string | null): Promise<Response> {
	const file = Bun.file(full);
	if (!(await file.exists())) return fail(404, "not_found", "Object not found");
	const info = await stat(full);
	const etag = `"${info.size.toString(16)}-${info.mtimeMs.toString(16)}"`;
	if (req.headers.get("if-none-match") === etag) {
		return new Response(null, { status: 304, headers: { etag, ...CORS } });
	}
	const headers: Record<string, string> = {
		...CORS,
		etag,
		"content-type": file.type || "application/octet-stream",
		"cache-control": "public, max-age=3600",
		"last-modified": new Date(info.mtimeMs).toUTCString(),
		"accept-ranges": "bytes",
	};
	if (download !== null) {
		const filename = download || full.split("/").pop() || "download";
		headers["content-disposition"] = `attachment; filename="${filename}"`;
	}
	if (req.method === "HEAD") {
		return new Response(null, { status: 200, headers: { ...headers, "content-length": String(info.size) } });
	}
	// Requêtes Range (lecture vidéo, reprise de téléchargement).
	const range = req.headers.get("range");
	const match = range?.match(/bytes=(\d*)-(\d*)/);
	if (match) {
		const start = match[1] ? Number(match[1]) : 0;
		const end = match[2] ? Number(match[2]) : info.size - 1;
		if (start >= info.size || end >= info.size || start > end) {
			return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${info.size}` } });
		}
		return new Response(file.slice(start, end + 1), {
			status: 206,
			headers: { ...headers, "content-range": `bytes ${start}-${end}/${info.size}`, "content-length": String(end - start + 1) },
		});
	}
	return new Response(file, { status: 200, headers: { ...headers, "content-length": String(info.size) } });
}

// ───────────────────────── Routage ─────────────────────────

async function handle(req: Request): Promise<Response> {
	const url = new URL(req.url);
	if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

	// nginx peut transmettre le préfixe `/storage/v1` ou non : on accepte les deux.
	let path = url.pathname.replace(/^\/storage\/v1/, "");
	if (path === "") path = "/";

	if (path === "/health" || path === "/") {
		return json({ service: "rg-storage", root: ROOT, ok: true });
	}

	const claims = claimsOf(req);

	// ── Buckets ──
	if (path === "/bucket" && req.method === "GET") {
		if (claims?.role !== "service_role" && !(await isAdmin(claims))) {
			return fail(401, "Unauthorized", "Invalid credentials");
		}
		const rows = await sql`select id, name, public, created_at, updated_at from storage.buckets order by id`;
		return json(rows);
	}
	if (path.startsWith("/bucket/") && req.method === "GET") {
		const id = decodeURIComponent(path.slice("/bucket/".length));
		const rows = await sql`select id, name, public, created_at, updated_at from storage.buckets where id = ${id}`;
		return rows.length ? json(rows[0]) : fail(404, "not_found", "Bucket not found");
	}

	// ── Téléchargement public : /object/public/<bucket>/<name> ──
	if (path.startsWith("/object/public/")) {
		const rest = path.slice("/object/public/".length);
		const slash = rest.indexOf("/");
		if (slash < 1) return fail(400, "InvalidRequest", "Missing object name");
		const bucket = rest.slice(0, slash);
		const name = rest.slice(slash + 1);
		const map = await buckets();
		if (!map.get(bucket)) return fail(400, "InvalidRequest", "Bucket not found or not public");
		const full = diskPath(bucket, name);
		if (!full) return fail(400, "InvalidRequest", "Invalid path");
		return serveFile(full, req, url.searchParams.get("download"));
	}

	// ── Téléchargement signé : /object/sign/<bucket>/<name>?token=… ──
	if (path.startsWith("/object/sign/") && req.method === "GET") {
		const rest = path.slice("/object/sign/".length);
		const slash = rest.indexOf("/");
		if (slash < 1) return fail(400, "InvalidRequest", "Missing object name");
		const bucket = rest.slice(0, slash);
		const name = rest.slice(slash + 1);
		if (!checkSignature(bucket, name, url.searchParams.get("token"))) {
			return fail(400, "InvalidJWT", "Invalid or expired signature");
		}
		const full = diskPath(bucket, name);
		if (!full) return fail(400, "InvalidRequest", "Invalid path");
		return serveFile(full, req, url.searchParams.get("download"));
	}

	// ── Création d'URL signée : POST /object/sign/<bucket>/<name> ──
	if (path.startsWith("/object/sign/") && req.method === "POST") {
		const rest = path.slice("/object/sign/".length);
		const slash = rest.indexOf("/");
		if (slash < 1) return fail(400, "InvalidRequest", "Missing object name");
		const bucket = rest.slice(0, slash);
		const name = decodeURIComponent(rest.slice(slash + 1));
		if (!(await canRead(bucket, claims))) return fail(401, "Unauthorized", "Invalid credentials");
		const body = (await req.json().catch(() => ({}))) as { expiresIn?: number };
		const expiresAt = Math.floor(Date.now() / 1000) + (body.expiresIn ?? 3600);
		const token = `${expiresAt}.${signPath(bucket, name, expiresAt)}`;
		return json({ signedURL: `/object/sign/${bucket}/${encodeURI(name)}?token=${token}` });
	}

	// ── Listing : POST /object/list/<bucket> ──
	if (path.startsWith("/object/list/") && req.method === "POST") {
		const bucket = decodeURIComponent(path.slice("/object/list/".length));
		if (!(await canRead(bucket, claims))) return fail(401, "Unauthorized", "Invalid credentials");
		const body = (await req.json().catch(() => ({}))) as {
			prefix?: string;
			limit?: number;
			offset?: number;
			search?: string;
			sortBy?: { column?: string; order?: string };
		};
		const prefix = body.prefix ?? "";
		const limit = Math.min(body.limit ?? 100, 1000);
		const offset = body.offset ?? 0;
		const column = ["name", "created_at", "updated_at", "last_accessed_at"].includes(body.sortBy?.column ?? "")
			? (body.sortBy?.column as string)
			: "name";
		const order = body.sortBy?.order?.toLowerCase() === "desc" ? "desc" : "asc";
		const search = body.search ? `%${body.search}%` : "%";
		// `storage.search` reproduit la pagination et le repli en dossiers de Supabase.
		const rows = await sql.unsafe(
			`select name, id, updated_at, created_at, last_accessed_at, metadata
			 from storage.objects
			 where bucket_id = $1 and name like $2 and name like $3
			 order by ${column} ${order} limit $4 offset $5`,
			[bucket, `${prefix}%`, search, limit, offset]
		);
		return json(rows);
	}

	// ── Déplacement / copie ──
	if ((path === "/object/move" || path === "/object/copy") && req.method === "POST") {
		const body = (await req.json().catch(() => ({}))) as {
			bucketId?: string;
			sourceKey?: string;
			destinationKey?: string;
			destinationBucket?: string;
		};
		const bucket = body.bucketId ?? "";
		const dstBucket = body.destinationBucket ?? bucket;
		const src = diskPath(bucket, body.sourceKey ?? "");
		const dst = diskPath(dstBucket, body.destinationKey ?? "");
		if (!src || !dst) return fail(400, "InvalidRequest", "Invalid path");
		if (!(await canWrite(dstBucket, body.destinationKey ?? "", claims))) {
			return fail(401, "Unauthorized", "Invalid credentials");
		}
		await mkdir(dirname(dst), { recursive: true });
		if (path === "/object/move") {
			await rename(src, dst);
			await unindexObject(bucket, body.sourceKey ?? "");
		} else {
			await Bun.write(dst, Bun.file(src));
		}
		const info = await stat(dst);
		await indexObject(dstBucket, body.destinationKey ?? "", info.size, Bun.file(dst).type);
		return json({ message: "Successfully " + (path === "/object/move" ? "moved" : "copied") });
	}

	// ── Suppression multiple : DELETE /object/<bucket> ──
	if (path.startsWith("/object/") && req.method === "DELETE" && !path.slice("/object/".length).includes("/")) {
		const bucket = decodeURIComponent(path.slice("/object/".length));
		const body = (await req.json().catch(() => ({}))) as { prefixes?: string[] };
		const names = body.prefixes ?? [];
		const removed: Array<{ name: string }> = [];
		for (const name of names) {
			if (!(await canWrite(bucket, name, claims))) return fail(401, "Unauthorized", "Invalid credentials");
			const full = diskPath(bucket, name);
			if (!full) continue;
			await rm(full, { force: true });
			await unindexObject(bucket, name);
			removed.push({ name });
		}
		return json(removed);
	}

	// ── Objet unique : /object/<bucket>/<name> ──
	if (path.startsWith("/object/")) {
		let rest = path.slice("/object/".length);
		if (rest.startsWith("authenticated/")) rest = rest.slice("authenticated/".length);
		const slash = rest.indexOf("/");
		if (slash < 1) return fail(400, "InvalidRequest", "Missing object name");
		const bucket = rest.slice(0, slash);
		const name = decodeURIComponent(rest.slice(slash + 1));
		const full = diskPath(bucket, name);
		if (!full) return fail(400, "InvalidRequest", "Invalid path");

		if (req.method === "GET" || req.method === "HEAD") {
			if (!(await canRead(bucket, claims))) return fail(401, "Unauthorized", "Invalid credentials");
			return serveFile(full, req, url.searchParams.get("download"));
		}

		if (req.method === "POST" || req.method === "PUT") {
			if (!(await canWrite(bucket, name, claims))) return fail(401, "Unauthorized", "Invalid credentials");
			const upsert = req.headers.get("x-upsert") === "true" || req.method === "PUT";
			if (!upsert && (await Bun.file(full).exists())) {
				return fail(409, "Duplicate", "The resource already exists");
			}
			// storage-js envoie un multipart dont le champ fichier porte un nom
			// VIDE (`body.append("", blob)`) ; d'autres clients utilisent `file`.
			// On prend donc la première entrée qui est un fichier, quel que soit
			// son nom, et on retombe sur le corps brut hors multipart.
			const contentType = req.headers.get("content-type") ?? "";
			let bytes: Uint8Array;
			let mime = contentType;
			if (contentType.startsWith("multipart/form-data")) {
				const marker = boundaryOf(contentType);
				if (!marker) return fail(400, "InvalidRequest", "Missing multipart boundary");
				const part = extractFilePart(new Uint8Array(await req.arrayBuffer()), marker);
				if (!part) return fail(400, "InvalidRequest", "Missing file part");
				bytes = part.bytes;
				mime = part.mime;
			} else {
				bytes = new Uint8Array(await req.arrayBuffer());
			}
			await mkdir(dirname(full), { recursive: true });
			await Bun.write(full, bytes);
			await indexObject(bucket, name, bytes.byteLength, mime || "application/octet-stream");
			return json({ Id: crypto.randomUUID(), Key: `${bucket}/${name}`, path: name }, 200);
		}

		if (req.method === "DELETE") {
			if (!(await canWrite(bucket, name, claims))) return fail(401, "Unauthorized", "Invalid credentials");
			await rm(full, { force: true });
			await unindexObject(bucket, name);
			return json({ message: "Successfully deleted" });
		}
	}

	return fail(404, "not_found", `Route inconnue : ${req.method} ${path}`);
}

const server = Bun.serve({
	port: PORT,
	hostname: HOST,
	maxRequestBodySize: 512 * 1024 * 1024,
	async fetch(req) {
		try {
			return await handle(req);
		} catch (error) {
			console.error("[rg-storage]", error);
			return fail(500, "InternalError", error instanceof Error ? error.message : String(error));
		}
	},
});

console.log(`rg-storage port=${server.port} root=${ROOT}`);
