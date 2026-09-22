import type { OcReference } from "@nie/inacord-ui/avatar/contract";

const MAX_GLB_BYTES = 64 * 1024 * 1024;
const MAX_PNG_BYTES = 32 * 1024 * 1024;
const MAX_VFS_DECODE_PASSES = 4;
const VFS_ROOT_PROBE = "data/__oc_vfs_root_probe__";

export interface OcReferenceLoadOptions {
	pageUrl: string;
	/** A URL built by the configured AssetSource, used only to admit that exact origin. */
	assetSourceUrl?: string | null;
	/** Host-owned mapping for a `data/...` VFS reference. */
	vfsUrl?: (path: string) => string;
	/** Injectable for deterministic trust-boundary tests; production uses the browser fetch. */
	fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

export interface LoadedOcReference {
	bytes: Uint8Array;
	name: string;
	url: string;
}

function httpUrl(value: string, base: string): URL {
	const url = new URL(value, base);
	if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
		throw new Error("La référence OC doit utiliser une URL HTTP(S) sans identifiants");
	}
	return url;
}

function allowedOrigins(pageUrl: string, assetSourceUrl?: string | null): Set<string> {
	const origins = new Set<string>();
	try {
		const page = httpUrl(pageUrl, pageUrl);
		origins.add(page.origin);
	} catch {
		// A Tauri/file host is not an HTTP asset origin. Only its explicitly configured service
		// may be admitted below.
	}
	if (assetSourceUrl) origins.add(httpUrl(assetSourceUrl, pageUrl).origin);
	return origins;
}

function decodeVfsSegment(segment: string): string {
	let decoded = segment;
	for (let pass = 0; pass < MAX_VFS_DECODE_PASSES; pass += 1) {
		let next: string;
		try {
			next = decodeURIComponent(decoded);
		} catch {
			throw new Error("Le chemin VFS contient un encodage invalide");
		}
		if (next === decoded) return decoded;
		decoded = next;
	}
	let next: string;
	try {
		next = decodeURIComponent(decoded);
	} catch {
		throw new Error("Le chemin VFS contient un encodage invalide");
	}
	if (next !== decoded) throw new Error("Le chemin VFS est encodé trop profondément");
	return decoded;
}

function canonicalVfsPath(value: string): string {
	if (/[\\?#\0]/u.test(value)) throw new Error("Le chemin VFS de la référence OC est invalide");
	const segments = value.split("/");
	if (segments[0] !== "data" || segments.length < 2) {
		throw new Error("Le chemin VFS de la référence OC est invalide");
	}
	const decoded = segments.map(decodeVfsSegment);
	if (decoded.some((segment) => (
		!segment
		|| segment === "."
		|| segment === ".."
		|| /[\/\\?#\0]/u.test(segment)
	))) {
		throw new Error("Le chemin VFS de la référence OC est invalide");
	}
	return decoded.join("/");
}

function resolveMappedVfsUrl(path: string, options: OcReferenceLoadOptions): URL {
	if (!options.vfsUrl) throw new Error("Cette source ne sait pas résoudre un chemin VFS");
	const url = httpUrl(options.vfsUrl(path), options.pageUrl);
	const probe = httpUrl(options.vfsUrl(VFS_ROOT_PROBE), options.pageUrl);
	const probeSegments = probe.pathname.split("/");
	let probeParent: string;
	let probeLeaf: string;
	try {
		probeParent = decodeURIComponent(probeSegments.at(-2) ?? "");
		probeLeaf = decodeURIComponent(probeSegments.at(-1) ?? "");
	} catch {
		throw new Error("La source a produit un préfixe VFS non canonique");
	}
	const separator = probe.pathname.lastIndexOf("/");
	const expectedPrefix = probe.pathname.slice(0, separator + 1);
	if (
		separator < 0
		|| probeParent !== "data"
		|| probeLeaf !== VFS_ROOT_PROBE.split("/").at(-1)
		|| probe.search
		|| probe.hash
		|| url.search
		|| url.hash
		|| url.origin !== probe.origin
		|| !url.pathname.startsWith(expectedPrefix)
	) {
		throw new Error("La source a résolu la référence hors de son préfixe VFS");
	}
	return url;
}

export function resolveOcReferenceUrl(
	reference: Pick<OcReference, "value">,
	options: Pick<OcReferenceLoadOptions, "pageUrl" | "assetSourceUrl" | "vfsUrl">,
): URL {
	const value = reference.value;
	if (!value) throw new Error("La référence OC est vide");
	if (value !== value.trim()) throw new Error("La référence OC contient des espaces non canoniques");
	const url = value.startsWith("data/")
		? resolveMappedVfsUrl(canonicalVfsPath(value), options)
		: httpUrl(value, options.pageUrl);
	if (!allowedOrigins(options.pageUrl, options.assetSourceUrl).has(url.origin)) {
		throw new Error("L’origine de la référence OC n’est pas autorisée");
	}
	return url;
}

async function readBoundedStream(response: Response, maximum: number): Promise<Uint8Array> {
	const declaredText = response.headers.get("content-length");
	if (declaredText !== null) {
		const declared = Number(declaredText);
		if (!Number.isSafeInteger(declared) || declared < 0 || declared > maximum) {
			throw new Error("Référence supérieure à la borne d’import");
		}
	}
	if (!response.body) throw new Error("La référence OC ne contient aucun flux lisible");
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			total += value.byteLength;
			if (total > maximum) {
				await reader.cancel("OC reference size limit exceeded");
				throw new Error("Référence supérieure à la borne d’import");
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

async function sha256(bytes: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Fetch an OC file only after URL admission, streaming bounds and declared integrity checks. */
export async function loadOcReference(
	reference: OcReference,
	options: OcReferenceLoadOptions,
): Promise<LoadedOcReference> {
	if (reference.kind !== "glb" && reference.kind !== "png") {
		throw new Error("Cette référence OC n’est pas un fichier chargeable");
	}
	const maximum = reference.kind === "glb" ? MAX_GLB_BYTES : MAX_PNG_BYTES;
	if (!Number.isSafeInteger(reference.bytes) || reference.bytes! <= 0 || reference.bytes! > maximum) {
		throw new Error("La référence OC doit déclarer une taille valide");
	}
	if (!reference.sha256 || !/^[0-9a-f]{64}$/iu.test(reference.sha256)) {
		throw new Error("La référence OC doit déclarer une empreinte SHA-256 valide");
	}
	const url = resolveOcReferenceUrl(reference, options);
	const response = await (options.fetcher ?? fetch)(url, {
		// Refuse redirects at the fetch layer so the browser never follows an OC document to a
		// second origin. The response URL check below remains defence-in-depth for host shims.
		redirect: "error",
		headers: { accept: reference.kind === "glb" ? "model/gltf-binary" : "image/png" },
	});
	if (!response.ok) throw new Error(`Référence indisponible (${response.status})`);
	const finalUrl = response.url ? httpUrl(response.url, url.toString()) : url;
	if (finalUrl.origin !== url.origin) {
		response.body?.cancel("Cross-origin OC redirect rejected").catch(() => {});
		throw new Error("Une redirection OC vers une autre origine est interdite");
	}
	const bytes = await readBoundedStream(response, maximum);
	if (bytes.byteLength !== reference.bytes) {
		throw new Error(`Taille OC incorrecte : ${bytes.byteLength} reçus, ${reference.bytes} attendus`);
	}
	const actualHash = await sha256(bytes);
	if (actualHash.toLowerCase() !== reference.sha256.toLowerCase()) {
		throw new Error("Empreinte SHA-256 de la référence OC incorrecte");
	}
	const leaf = decodeURIComponent(finalUrl.pathname.split("/").pop() || `reference.${reference.kind}`);
	const name = leaf.toLowerCase().endsWith(`.${reference.kind}`) ? leaf : `${leaf}.${reference.kind}`;
	return { bytes, name, url: finalUrl.toString() };
}
