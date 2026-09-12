/**
 * HTTP primitives shared by the browser command adapter.
 *
 * Every helper rejects with a **string** (not an `Error`) so the generated `typedError`
 * bindings in `src/desktop/lib/bindings.ts` keep their `{ status: "error", error }` envelope:
 * the desktop commands return `Result<T, String>` and the UI reads `.error` as text.
 */

export type Arguments = Record<string, unknown>;
export type JsonRecord = Record<string, unknown>;

/** Pull a human message out of whatever the server or the network handed back. */
export function messageFrom(payload: unknown, fallback: string): string {
	if (typeof payload === "string" && payload.trim()) return payload.trim();
	if (payload && typeof payload === "object") {
		for (const key of ["message", "error", "erreur", "detail"]) {
			const value = (payload as JsonRecord)[key];
			if (typeof value === "string" && value.trim()) return value.trim();
		}
	}
	return fallback;
}

/** Percent-encode each segment, keeping the separators the routes match on. */
export function encodePath(path: string): string {
	return String(path)
		.replace(/^\/+|\/+$/gu, "")
		.split("/")
		.filter(Boolean)
		.map(encodeURIComponent)
		.join("/");
}

async function request(url: string, init?: RequestInit): Promise<Response> {
	try {
		return await fetch(url, init);
	} catch (error) {
		return Promise.reject(messageFrom(error, "Le service de lecture est inaccessible."));
	}
}

/** `GET` a JSON document. */
export async function getJson<T>(url: string): Promise<T> {
	const response = await request(url, { headers: { Accept: "application/json" } });
	let payload: unknown;
	try { payload = await response.json(); } catch { payload = undefined; }
	if (!response.ok) return Promise.reject(messageFrom(payload, `Lecture impossible (HTTP ${response.status}).`));
	return payload as T;
}

/** `POST` a JSON body and read a JSON document back. */
export async function postJson<T>(url: string, body: unknown): Promise<T> {
	const response = await request(url, {
		method: "POST",
		headers: { Accept: "application/json", "Content-Type": "application/json" },
		body: JSON.stringify(body ?? {}),
	});
	let payload: unknown;
	try { payload = await response.json(); } catch { payload = undefined; }
	if (!response.ok) return Promise.reject(messageFrom(payload, `Requête refusée (HTTP ${response.status}).`));
	return payload as T;
}

/** `GET` raw bytes. */
export async function getBytes(url: string): Promise<ArrayBuffer> {
	const response = await request(url);
	if (!response.ok) {
		let text = "";
		try { text = await response.text(); } catch { text = ""; }
		let payload: unknown = text;
		try { payload = JSON.parse(text) as unknown; } catch { /* plain text body */ }
		return Promise.reject(messageFrom(payload, `Lecture impossible (HTTP ${response.status}).`));
	}
	return response.arrayBuffer();
}

/**
 * Base64 of a byte buffer, built in chunks.
 *
 * `String.fromCharCode(...bytes)` blows the argument limit past a few tens of kilobytes — the
 * files served here reach tens of megabytes, so the conversion walks a fixed window instead.
 */
export function toBase64(buffer: ArrayBuffer | Uint8Array): string {
	const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
	const chunk = 0x8000;
	let binary = "";
	for (let offset = 0; offset < bytes.length; offset += chunk) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
	}
	return btoa(binary);
}

/** Decode base64 back into bytes (used by the write-side browser fallbacks). */
export function fromBase64(data: string): Uint8Array {
	const binary = atob(data.replace(/^data:[^,]*,/u, ""));
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
	return bytes;
}

/** `GET` raw bytes as base64, optionally truncated like the desktop `max_bytes` bound. */
export async function getBase64(url: string, maxBytes?: number | null): Promise<string> {
	const buffer = await getBytes(url);
	const bytes = new Uint8Array(buffer);
	const limited = typeof maxBytes === "number" && maxBytes > 0 && maxBytes < bytes.length
		? bytes.subarray(0, Math.floor(maxBytes))
		: bytes;
	return toBase64(limited);
}

export const positive = (value: unknown, fallback: number) =>
	typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
export const nonNegative = (value: unknown) =>
	typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
export const text = (value: unknown): string => (typeof value === "string" ? value : "");
