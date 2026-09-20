/**
 * Resilient HTTP client utilities for all consumers of nie servers (`nie-site`, `nie-model-serve`, `nie-net`).
 *
 * Provides:
 * - Default timeouts merging user-supplied AbortSignals
 * - Automatic exponential backoff retries for transient status codes (502, 503, 504) and network dropouts
 * - Structured error message extraction from server JSON responses (`{ erreur: "..." }`)
 * - Transparent HEAD preflight checks and ETag conditional request support
 * - Zero external runtime dependencies (100% Web API standard)
 */

export interface RequestOptions extends Omit<RequestInit, "signal"> {
	/** Optional AbortSignal from the caller. Combined with the timeout controller. */
	signal?: AbortSignal | null;
	/** Timeout in milliseconds. Defaults to 15,000 ms (15 s). Set to 0 to disable. */
	timeoutMs?: number;
	/** Maximum number of retry attempts for idempotent GET/HEAD requests or network errors. Defaults to 2. */
	retries?: number;
	/** Initial retry backoff in milliseconds. Defaults to 150 ms, doubling on each attempt. */
	retryDelayMs?: number;
	/** HTTP status codes that trigger a retry attempt. Defaults to [502, 503, 504]. */
	retryStatuses?: number[];
	/** Enable If-None-Match caching via memory ETag cache. Defaults to false. */
	useEtagCache?: boolean;
}

export class HttpError extends Error {
	readonly status: number;
	readonly statusText: string;
	readonly url: string;
	readonly details?: unknown;

	constructor(status: number, statusText: string, url: string, message: string, details?: unknown) {
		super(message);
		this.name = "HttpError";
		this.status = status;
		this.statusText = statusText;
		this.url = url;
		this.details = details;
	}
}

const etagCache = new Map<string, { etag: string; body: unknown }>();

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 150;
const DEFAULT_RETRY_STATUSES = [502, 503, 504];

/**
 * Extracts a concise, human-readable error description from an HTTP response.
 */
export async function extractErrorMessage(response: Response, url: string): Promise<{ message: string; details?: unknown }> {
	const status = response.status;
	const statusText = response.statusText || `${status}`;
	const contentType = response.headers.get("content-type") || "";

	if (contentType.includes("application/json")) {
		try {
			const json = await response.json();
			if (json && typeof json === "object") {
				const obj = json as Record<string, unknown>;
				const serverMsg = obj["erreur"] ?? obj["error"] ?? obj["message"] ?? obj["detail"];
				if (typeof serverMsg === "string" && serverMsg.trim().length > 0) {
					return {
						message: `${url} → ${status} (${serverMsg.trim()})`,
						details: json,
					};
				}
			}
			return { message: `${url} → ${status} ${statusText}`, details: json };
		} catch {
			// fall through to text extraction
		}
	}

	try {
		const text = (await response.text()).trim();
		if (text.length > 0) {
			const snippet = text.length > 180 ? `${text.slice(0, 180)}…` : text;
			return { message: `${url} → ${status} (${snippet})` };
		}
	} catch {
		// ignore
	}

	return { message: `${url} → ${status} ${statusText}` };
}

/**
 * Executes a resilient HTTP request with timeout, signal combination, and backoff retries.
 */
export async function resilientFetch(url: string, options: RequestOptions = {}): Promise<Response> {
	const method = (options.method || "GET").toUpperCase();
	const isIdempotent = method === "GET" || method === "HEAD";
	const maxRetries = options.retries !== undefined ? options.retries : isIdempotent ? DEFAULT_RETRIES : 0;
	const timeoutMs = options.timeoutMs !== undefined ? options.timeoutMs : options.signal ? 0 : DEFAULT_TIMEOUT_MS;
	const initialDelay = options.retryDelayMs !== undefined ? options.retryDelayMs : DEFAULT_RETRY_DELAY_MS;
	const retryStatuses = options.retryStatuses ?? DEFAULT_RETRY_STATUSES;

	let lastError: unknown;
	let currentDelay = initialDelay;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		if (options.signal?.aborted) {
			throw options.signal.reason ?? new DOMException("The operation was aborted", "AbortError");
		}

		let controller: AbortController | null = null;
		let timeoutId: ReturnType<typeof setTimeout> | null = null;
		let effectiveSignal: AbortSignal | undefined = options.signal ?? undefined;

		let abortListener: (() => void) | null = null;

		if (timeoutMs > 0) {
			controller = new AbortController();
			effectiveSignal = controller.signal;
			timeoutId = setTimeout(() => {
				controller!.abort(new DOMException(`Request timed out after ${timeoutMs}ms`, "TimeoutError"));
			}, timeoutMs);

			if (options.signal) {
				abortListener = () => {
					if (timeoutId) clearTimeout(timeoutId);
					controller!.abort(options.signal?.reason ?? new DOMException("The operation was aborted", "AbortError"));
				};
				options.signal.addEventListener("abort", abortListener, { once: true });
			}
		}

		try {
			const headers = new Headers(options.headers);
			if (options.useEtagCache && isIdempotent) {
				const cached = etagCache.get(url);
				if (cached?.etag) {
					headers.set("if-none-match", cached.etag);
				}
			}

			const response = await fetch(url, {
				...options,
				method,
				headers,
				signal: effectiveSignal,
			});

			if (timeoutId) clearTimeout(timeoutId);
			if (options.signal && abortListener) options.signal.removeEventListener("abort", abortListener);

			if (options.useEtagCache && response.status === 304) {
				const cached = etagCache.get(url);
				if (cached) {
					return new Response(JSON.stringify(cached.body), {
						status: 200,
						statusText: "OK",
						headers: response.headers,
					});
				}
			}

			if (response.ok) {
				const etag = response.headers.get("etag");
				if (options.useEtagCache && etag) {
					// We'll let caller cache the body if desired
				}
				return response;
			}

			// If transient failure, check if we should retry
			if (attempt < maxRetries && retryStatuses.includes(response.status)) {
				await new Promise((resolve) => setTimeout(resolve, currentDelay));
				currentDelay *= 2;
				continue;
			}

			// Not transient or retries exhausted: construct typed HttpError
			const { message, details } = await extractErrorMessage(response, url);
			throw new HttpError(response.status, response.statusText, url, message, details);
		} catch (err: unknown) {
			if (timeoutId) clearTimeout(timeoutId);
			if (options.signal && abortListener) options.signal.removeEventListener("abort", abortListener);

			// Never retry user-requested explicit aborts
			if (options.signal?.aborted) {
				throw err;
			}

			// If it was our own timeout and attempts remain
			const isTimeout = err instanceof DOMException && err.name === "TimeoutError";
			const isNetworkErr = err instanceof TypeError;

			if (attempt < maxRetries && (isTimeout || isNetworkErr)) {
				lastError = err;
				await new Promise((resolve) => setTimeout(resolve, currentDelay));
				currentDelay *= 2;
				continue;
			}

			throw err;
		}
	}

	throw lastError;
}

/**
 * Fetches and parses a JSON payload with resilient error handling and timeouts.
 */
export async function fetchJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
	const headers = new Headers(options.headers);
	if (!headers.has("accept")) {
		headers.set("accept", "application/json");
	}

	const response = await resilientFetch(url, { ...options, headers });
	const data = (await response.json()) as T;

	if (options.useEtagCache) {
		const etag = response.headers.get("etag");
		if (etag) {
			etagCache.set(url, { etag, body: data });
		}
	}

	return data;
}

/**
 * Fetches raw bytes (Uint8Array) with size bounding, retries, and timeouts.
 */
export function fetchBytes(url: string, options?: RequestOptions): Promise<Uint8Array>;
export function fetchBytes(url: string, maxBytes?: number, options?: RequestOptions): Promise<Uint8Array>;
export async function fetchBytes(
	url: string,
	maxBytesOrOptions?: number | RequestOptions,
	options: RequestOptions = {},
): Promise<Uint8Array> {
	let maxBytes: number | undefined;
	let reqOptions: RequestOptions = options;
	if (typeof maxBytesOrOptions === "number") {
		maxBytes = maxBytesOrOptions;
	} else if (maxBytesOrOptions && typeof maxBytesOrOptions === "object") {
		reqOptions = maxBytesOrOptions;
	}

	const response = await resilientFetch(url, reqOptions);

	if (maxBytes !== undefined) {
		const contentLength = Number(response.headers.get("content-length"));
		if (contentLength && contentLength > maxBytes) {
			throw new HttpError(response.status, response.statusText, url, `Payload size exceeds limit (${contentLength} > ${maxBytes})`);
		}
	}

	const buffer = await response.arrayBuffer();
	const bytes = new Uint8Array(buffer);

	if (maxBytes !== undefined && bytes.byteLength > maxBytes) {
		throw new HttpError(response.status, response.statusText, url, `Payload size exceeds limit (${bytes.byteLength} > ${maxBytes})`);
	}

	return bytes;
}

/**
 * Preflight HEAD request to check availability, size, and Content-Type without transferring body.
 */
export async function preflightHead(
	url: string,
	options: RequestOptions = {},
): Promise<{ ok: boolean; status: number; contentLength: number | null; contentType: string | null }> {
	try {
		const response = await resilientFetch(url, { ...options, method: "HEAD" });
		const lenStr = response.headers.get("content-length");
		return {
			ok: response.ok,
			status: response.status,
			contentLength: lenStr ? Number(lenStr) : null,
			contentType: response.headers.get("content-type"),
		};
	} catch (err) {
		if (err instanceof HttpError) {
			return {
				ok: false,
				status: err.status,
				contentLength: null,
				contentType: null,
			};
		}
		throw err;
	}
}
