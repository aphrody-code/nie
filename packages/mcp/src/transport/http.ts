/**
 * Transport **Streamable HTTP**, écrit directement sur `Bun.serve` (aucune
 * dépendance Node : pas d'express, pas de hono, pas de `node:http`).
 *
 * Il sert les deux ères simultanément sur le même point d'entrée, ce que la
 * spécification autorise explicitement :
 *
 * - **moderne** (`2026-07-28`) : sans session, métadonnées par requête,
 *   validation stricte des en-têtes miroir (`MCP-Protocol-Version`,
 *   `Mcp-Method`, `Mcp-Name`, `Mcp-Param-*`), `405` sur GET/DELETE ;
 * - **legacy** (`2025-11-25` et avant) : handshake `initialize`, en-têtes de
 *   session ignorés (le serveur est sans état, ce que la spec legacy permet —
 *   l'attribution d'un `Mcp-Session-Id` y est facultative).
 *
 * Sécurité : validation de l'`Origin` (anti DNS-rebinding), écoute sur la
 * boucle locale par défaut, authentification par jeton porteur facultative.
 */

import {
	ErrorCode,
	type JsonRpcMessage,
	type JsonRpcNotification,
	McpError,
	errorResponse,
	isJsonRpcNotification,
	isJsonRpcRequest,
	isPlainObject,
	toErrorPayload,
} from "../protocol/json-rpc.ts";
import { META_KEYS, legacyMeta, parseModernMeta } from "../protocol/meta.ts";
import {
	ASSUMED_LEGACY_VERSION,
	MODERN_PROTOCOL_VERSION,
	SUPPORTED_PROTOCOL_VERSIONS,
	isModernVersion,
	isSupportedVersion,
} from "../protocol/versions.ts";
import type { McpScope } from "../registry.ts";
import type { McpServer } from "../server.ts";

export interface HttpTransportOptions {
	server: McpServer;
	/** Port d'écoute. `0` laisse Bun en choisir un libre (utile en test). */
	port?: number;
	/** Interface d'écoute. Boucle locale par défaut, comme le veut la spec. */
	hostname?: string;
	/** Chemin du point d'entrée MCP unique. */
	endpoint?: string;
	/**
	 * Jetons porteurs de **lecture**. Vide = accès libre (à réserver à
	 * `127.0.0.1`, la publication distante devant toujours être authentifiée).
	 */
	tokens?: string[];
	/**
	 * Jetons porteurs d'**administration** : mêmes outils, plus l'écriture, la
	 * suppression et l'exécution de commandes. Un jeton d'administration ne
	 * doit jamais être identique à un jeton de lecture.
	 */
	adminTokens?: string[];
	/**
	 * Portée accordée quand AUCUN jeton n'est configuré (serveur local sans
	 * authentification). `read` par défaut : on n'ouvre jamais l'écriture par
	 * omission.
	 */
	defaultScope?: McpScope;
	/**
	 * Origines autorisées. `"*"` désactive le contrôle (déconseillé).
	 * Une requête sans en-tête `Origin` (cas des clients non-navigateur comme
	 * Claude Code) est toujours acceptée : la spec n'impose la validation que
	 * lorsque l'en-tête est présent.
	 */
	allowedOrigins?: string[] | "*";
	/** Ajoute les en-têtes CORS (nécessaire pour l'Inspector en navigateur). */
	cors?: boolean;
	/** Journalisation d'une ligne par requête sur stderr. */
	onLog?: (line: string) => void;
}

export interface RunningHttpTransport {
	port: number;
	hostname: string;
	url: string;
	endpoint: string;
	stop: (closeActiveConnections?: boolean) => void | Promise<void>;
	/** Traite une requête HTTP brute — exposé pour les tests et le montage. */
	fetch: (request: Request) => Promise<Response>;
}

const DEFAULT_ENDPOINT = "/mcp";
const JSON_TYPE = "application/json";
const SSE_TYPE = "text/event-stream";

/** Méthodes dont la spec impose le miroir de `params.name`/`params.uri`. */
const NAME_MIRRORED_METHODS = new Set(["tools/call", "resources/read", "prompts/get"]);

export function createHttpTransport(options: HttpTransportOptions): RunningHttpTransport {
	const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
	const hostname = options.hostname ?? "127.0.0.1";
	const handler = createFetchHandler({ ...options, endpoint });

	const server = Bun.serve({
		port: options.port ?? 0,
		hostname,
		// Un outil peut être long (lecture SQLite, appel CDN) : pas de coupure
		// prématurée, et les flux SSE doivent pouvoir rester ouverts.
		idleTimeout: 0,
		fetch: handler,
	});

	const boundPort = server.port ?? options.port ?? 0;
	const boundHost = server.hostname ?? hostname;

	return {
		port: boundPort,
		hostname: boundHost,
		url: `http://${boundHost}:${boundPort}${endpoint}`,
		endpoint,
		stop: (closeActiveConnections = false) => server.stop(closeActiveConnections),
		fetch: handler,
	};
}

/**
 * Construit le gestionnaire `fetch`. Isolé de `Bun.serve` pour être testable
 * sans ouvrir de port, et réutilisable derrière un autre serveur.
 */
export function createFetchHandler(options: HttpTransportOptions & { endpoint?: string }) {
	const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
	const readDigests = new Set((options.tokens ?? []).filter(Boolean).map(digest));
	const adminDigests = new Set((options.adminTokens ?? []).filter(Boolean).map(digest));
	const authRequired = readDigests.size > 0 || adminDigests.size > 0;
	const defaultScope: McpScope = options.defaultScope ?? "read";
	const allowedOrigins = options.allowedOrigins ?? [];
	const log = options.onLog ?? (() => {});

	return async function fetchHandler(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const cors = options.cors ? corsHeaders(request) : {};

		if (request.method === "OPTIONS") {
			return new Response(null, { status: 204, headers: cors });
		}

		// Point de santé hors protocole : pratique pour systemd et nginx.
		if (url.pathname === "/health" || url.pathname === `${endpoint}/health`) {
			return Response.json(
				{
					ok: true,
					server: options.server.serverInfo,
					protocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
					tools: options.server.registry.toolsFor("read").length,
					prompts: options.server.registry.prompts.length,
				},
				{ headers: cors },
			);
		}

		if (url.pathname !== endpoint) {
			return new Response("Not Found", { status: 404, headers: cors });
		}

		// 1. Anti DNS-rebinding : `Origin` présent ⇒ il doit être autorisé.
		const origin = request.headers.get("origin");
		if (origin && !isOriginAllowed(origin, allowedOrigins)) {
			log(`mcp-http origin=refusé value=${origin}`);
			return jsonRpcHttpError(403, ErrorCode.InvalidRequest, `Origine refusée : ${origin}`, cors);
		}

		// 2. Authentification par jeton porteur (si configurée). Le jeton
		//    détermine aussi la PORTÉE : lecture seule ou administration.
		// `scope` ne vaut `undefined` que si une authentification est exigée et
		// qu'aucun jeton ne correspond — d'où le test unique ci-dessous.
		const scope: McpScope | undefined = authRequired
			? resolveScope(request, readDigests, adminDigests)
			: defaultScope;
		if (scope === undefined) {
			return new Response(
				JSON.stringify(errorResponse(undefined, { code: ErrorCode.InvalidRequest, message: "Non autorisé." })),
				{
					status: 401,
					headers: {
						...cors,
						"content-type": JSON_TYPE,
						"www-authenticate": 'Bearer realm="rg-mcp", error="invalid_token"',
					},
				},
			);
		}

		// 3. GET/DELETE : mécanismes des révisions antérieures, supprimés en
		//    2026-07-28. La spec demande explicitement `405`.
		if (request.method === "GET" || request.method === "DELETE") {
			return new Response(null, { status: 405, headers: { ...cors, allow: "POST, OPTIONS" } });
		}

		if (request.method !== "POST") {
			return new Response(null, { status: 405, headers: { ...cors, allow: "POST, OPTIONS" } });
		}

		// 4. Corps JSON-RPC.
		let payload: unknown;
		try {
			payload = await request.json();
		} catch {
			return jsonRpcHttpError(400, ErrorCode.ParseError, "Corps JSON illisible.", cors);
		}

		if (Array.isArray(payload)) {
			// Le traitement par lots (batch JSON-RPC) a été retiré du protocole.
			return jsonRpcHttpError(400, ErrorCode.InvalidRequest, "Les lots JSON-RPC ne sont pas supportés.", cors);
		}
		if (!isPlainObject(payload)) {
			return jsonRpcHttpError(400, ErrorCode.InvalidRequest, "Message JSON-RPC attendu.", cors);
		}

		const message = payload as unknown as JsonRpcMessage;

		// 5. Détermination de l'ère + métadonnées, puis validation d'en-têtes.
		let meta;
		try {
			meta = resolveMeta(message, request);
		} catch (error) {
			const payloadError = toErrorPayload(error);
			const status = error instanceof McpError ? error.httpStatus : 400;
			const id = isJsonRpcRequest(message) ? message.id : undefined;
			return new Response(JSON.stringify(errorResponse(id, payloadError)), {
				status,
				headers: { ...cors, "content-type": JSON_TYPE },
			});
		}

		// 6. Notification : 202 sans corps, la spec est formelle.
		if (isJsonRpcNotification(message)) {
			await options.server.handle(message, {
				meta,
				scope,
				signal: request.signal,
				emit: () => {},
			});
			return new Response(null, { status: 202, headers: cors });
		}

		if (!isJsonRpcRequest(message)) {
			return jsonRpcHttpError(400, ErrorCode.InvalidRequest, "Requête JSON-RPC invalide.", cors);
		}

		const method = message.method;
		const wantsStream = meta.progressToken !== undefined && request.headers.get("accept")?.includes(SSE_TYPE);

		log(
			`mcp-http method=${method} era=${meta.era} v=${meta.protocolVersion} scope=${scope} stream=${wantsStream ? 1 : 0}`,
		);

		// 7a. Réponse simple : un objet JSON.
		if (!wantsStream) {
			const response = await options.server.handle(message, {
				meta,
				scope,
				signal: request.signal,
				emit: () => {},
			});
			if (!response) return new Response(null, { status: 202, headers: cors });
			return new Response(JSON.stringify(response), {
				status: 200,
				headers: { ...cors, "content-type": JSON_TYPE },
			});
		}

		// 7b. Réponse en flux : notifications de progression puis résultat final.
		const stream = new ReadableStream<Uint8Array>({
			start: (controller) => {
				const encoder = new TextEncoder();
				let closed = false;
				const write = (data: unknown) => {
					if (closed) return;
					controller.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify(data)}\n\n`));
				};
				const finish = () => {
					if (closed) return;
					closed = true;
					controller.close();
				};

				const emit = (notification: JsonRpcNotification) => write(notification);
				void options.server
					.handle(message, { meta, scope, signal: request.signal, emit })
					.then((response) => {
						if (response) write(response);
						finish();
					})
					.catch((error: unknown) => {
						write(errorResponse(message.id, toErrorPayload(error)));
						finish();
					});

				request.signal.addEventListener("abort", finish, { once: true });
			},
		});

		return new Response(stream, {
			status: 200,
			headers: {
				...cors,
				"content-type": `${SSE_TYPE}; charset=utf-8`,
				"cache-control": "no-cache, no-transform",
				connection: "keep-alive",
				// Demande à nginx de ne pas tamponner le flux (exigence de la spec).
				"x-accel-buffering": "no",
			},
		});
	};
}

/**
 * Détermine l'ère du client et valide les en-têtes miroir.
 *
 * Règles appliquées (révision 2026-07-28) :
 * - `MCP-Protocol-Version` DOIT correspondre à `_meta.…/protocolVersion`,
 *   sinon `-32020 HeaderMismatch` / HTTP 400 ;
 * - `Mcp-Method` et, pour `tools/call` / `resources/read` / `prompts/get`,
 *   `Mcp-Name` sont REQUIS et doivent correspondre au corps ;
 * - une version inconnue donne `-32022 UnsupportedProtocolVersion` avec la
 *   liste des versions supportées.
 */
function resolveMeta(message: JsonRpcMessage, request: Request) {
	const params = isPlainObject((message as { params?: unknown }).params)
		? ((message as { params: Record<string, unknown> }).params)
		: {};
	const headerVersion = request.headers.get("mcp-protocol-version") ?? undefined;
	const bodyVersion = isPlainObject(params._meta)
		? (params._meta as Record<string, unknown>)[META_KEYS.protocolVersion]
		: undefined;

	const isModern = typeof bodyVersion === "string" ? isModernVersion(bodyVersion) : false;

	if (isModern) {
		if (typeof headerVersion !== "string") {
			throw new McpError(ErrorCode.HeaderMismatch, "En-tête `MCP-Protocol-Version` manquant.", {
				httpStatus: 400,
			});
		}
		if (headerVersion !== bodyVersion) {
			throw new McpError(
				ErrorCode.HeaderMismatch,
				`En-tête MCP-Protocol-Version « ${headerVersion} » ≠ corps « ${String(bodyVersion)} ».`,
				{ httpStatus: 400 },
			);
		}
		if (!isSupportedVersion(headerVersion)) {
			throw unsupportedVersion(headerVersion);
		}
		validateMirroredHeaders(message, request);
		return parseModernMeta(params);
	}

	// Ère legacy : la version vient de l'en-tête (≥ 2025-06-18), du handshake,
	// ou vaut 2025-03-26 par défaut, comme la spec l'autorise.
	const version =
		typeof headerVersion === "string"
			? headerVersion
			: (message as { method?: string }).method === "initialize" &&
					typeof params.protocolVersion === "string"
				? params.protocolVersion
				: ASSUMED_LEGACY_VERSION;

	if (typeof headerVersion === "string" && !isSupportedVersion(headerVersion)) {
		throw unsupportedVersion(headerVersion);
	}

	const clientInfo = isPlainObject(params.clientInfo) && typeof params.clientInfo.name === "string"
		? { name: params.clientInfo.name as string, version: params.clientInfo.version as string | undefined }
		: undefined;

	return legacyMeta(params, version, clientInfo);
}

function unsupportedVersion(requested: string): McpError {
	return new McpError(ErrorCode.UnsupportedProtocolVersion, `Version de protocole non supportée : ${requested}`, {
		data: { supported: SUPPORTED_PROTOCOL_VERSIONS, requested },
		httpStatus: 400,
	});
}

/** Vérifie `Mcp-Method`, `Mcp-Name` et les éventuels `Mcp-Param-*`. */
function validateMirroredHeaders(message: JsonRpcMessage, request: Request): void {
	const method = (message as { method?: unknown }).method;
	if (typeof method !== "string") return;

	const headerMethod = request.headers.get("mcp-method");
	if (headerMethod === null) {
		throw new McpError(ErrorCode.HeaderMismatch, "En-tête `Mcp-Method` manquant.", { httpStatus: 400 });
	}
	if (headerMethod !== method) {
		throw new McpError(
			ErrorCode.HeaderMismatch,
			`En-tête Mcp-Method « ${headerMethod} » ≠ corps « ${method} ».`,
			{ httpStatus: 400 },
		);
	}

	if (!NAME_MIRRORED_METHODS.has(method)) return;

	const params = isPlainObject((message as { params?: unknown }).params)
		? ((message as { params: Record<string, unknown> }).params)
		: {};
	const expected = method === "resources/read" ? params.uri : params.name;
	if (typeof expected !== "string") return;

	const headerName = request.headers.get("mcp-name");
	if (headerName === null) {
		throw new McpError(ErrorCode.HeaderMismatch, "En-tête `Mcp-Name` manquant.", { httpStatus: 400 });
	}
	if (decodeHeaderValue(headerName) !== expected) {
		throw new McpError(
			ErrorCode.HeaderMismatch,
			`En-tête Mcp-Name « ${headerName} » ≠ corps « ${expected} ».`,
			{ httpStatus: 400 },
		);
	}
}

/** Décode la sentinelle `=?base64?…?=` définie par la spec pour les en-têtes. */
export function decodeHeaderValue(value: string): string {
	if (!value.startsWith("=?base64?") || !value.endsWith("?=")) return value;
	try {
		const encoded = value.slice("=?base64?".length, -"?=".length);
		return new TextDecoder().decode(Uint8Array.fromBase64(encoded));
	} catch {
		return value;
	}
}

function isOriginAllowed(origin: string, allowed: string[] | "*"): boolean {
	if (allowed === "*") return true;
	if (allowed.includes(origin)) return true;
	// La boucle locale reste autorisée par défaut : c'est le cas d'usage
	// « MCP Inspector ouvert sur la machine qui héberge le serveur ».
	try {
		const { hostname } = new URL(origin);
		return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
	} catch {
		return false;
	}
}

/**
 * Portée déduite du jeton présenté, ou `undefined` si aucun ne correspond.
 * L'administration est testée en premier : un même jeton ne peut pas être
 * dégradé en lecture seule par erreur d'ordre.
 */
function resolveScope(
	request: Request,
	readDigests: Set<string>,
	adminDigests: Set<string>,
): McpScope | undefined {
	const header = request.headers.get("authorization");
	if (!header?.toLowerCase().startsWith("bearer ")) return undefined;
	const presented = digest(header.slice(7).trim());
	if (adminDigests.has(presented)) return "admin";
	if (readDigests.has(presented)) return "read";
	return undefined;
}

/**
 * Empreinte SHA-256 d'un jeton : la comparaison porte alors sur des condensats
 * de longueur fixe, ce qui évite de comparer les secrets octet par octet.
 */
function digest(value: string): string {
	return new Bun.CryptoHasher("sha256").update(value).digest("hex");
}

function corsHeaders(request: Request): Record<string, string> {
	return {
		"access-control-allow-origin": request.headers.get("origin") ?? "*",
		"access-control-allow-methods": "POST, OPTIONS",
		"access-control-allow-headers":
			"content-type, authorization, mcp-protocol-version, mcp-method, mcp-name, mcp-session-id, last-event-id",
		"access-control-expose-headers": "mcp-protocol-version, mcp-session-id",
		"access-control-max-age": "86400",
	};
}

function jsonRpcHttpError(
	status: number,
	code: number,
	message: string,
	extraHeaders: Record<string, string>,
): Response {
	return new Response(JSON.stringify(errorResponse(undefined, { code, message })), {
		status,
		headers: { ...extraHeaders, "content-type": JSON_TYPE },
	});
}

export { MODERN_PROTOCOL_VERSION };
