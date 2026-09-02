/**
 * Couche JSON-RPC 2.0 du protocole MCP.
 *
 * Source de vérité : spécification MCP, révision `2026-07-28`
 * — https://modelcontextprotocol.io/specification/2026-07-28/basic
 *
 * Rien ici ne dépend d'un transport : ces types et ces gardes sont partagés
 * par le transport stdio et par le transport Streamable HTTP.
 */

/** Identifiant de requête JSON-RPC. MCP interdit explicitement `null`. */
export type RequestId = string | number;

export interface JsonRpcRequest {
	jsonrpc: "2.0";
	id: RequestId;
	method: string;
	params?: Record<string, unknown>;
}

export interface JsonRpcNotification {
	jsonrpc: "2.0";
	method: string;
	params?: Record<string, unknown>;
}

export interface JsonRpcErrorPayload {
	code: number;
	message: string;
	data?: unknown;
}

export interface JsonRpcResultResponse {
	jsonrpc: "2.0";
	id: RequestId;
	/** MCP impose un `resultType` dans tout résultat depuis 2026-07-28. */
	result: Record<string, unknown> & { resultType?: string };
}

export interface JsonRpcErrorResponse {
	jsonrpc: "2.0";
	id?: RequestId;
	error: JsonRpcErrorPayload;
}

export type JsonRpcResponse = JsonRpcResultResponse | JsonRpcErrorResponse;
export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

/**
 * Codes d'erreur.
 *
 * `-32000`..`-32019` est la sous-plage « héritée » : la spec interdit d'y
 * allouer de nouveaux codes. `-32020`..`-32099` est réservée à la spec
 * elle-même — on n'y émet donc QUE les trois codes qu'elle définit.
 */
export const ErrorCode = {
	// JSON-RPC 2.0 standard
	ParseError: -32_700,
	InvalidRequest: -32_600,
	MethodNotFound: -32_601,
	InvalidParams: -32_602,
	InternalError: -32_603,
	// Réservés à la spécification MCP
	HeaderMismatch: -32_020,
	MissingRequiredClientCapability: -32_021,
	UnsupportedProtocolVersion: -32_022,
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * Erreur transportable en JSON-RPC.
 *
 * `httpStatus` permet au transport HTTP de choisir le bon code de statut sans
 * refaire la classification (la spec impose par exemple `400` pour
 * `HeaderMismatch` et `UnsupportedProtocolVersion`, `404` pour une méthode
 * inconnue).
 */
export class McpError extends Error {
	readonly code: number;
	readonly data?: unknown;
	readonly httpStatus: number;

	constructor(code: number, message: string, options: { data?: unknown; httpStatus?: number } = {}) {
		super(message);
		this.name = "McpError";
		this.code = code;
		this.data = options.data;
		this.httpStatus = options.httpStatus ?? defaultHttpStatus(code);
	}

	toPayload(): JsonRpcErrorPayload {
		return this.data === undefined
			? { code: this.code, message: this.message }
			: { code: this.code, message: this.message, data: this.data };
	}

	static invalidParams(message: string, data?: unknown): McpError {
		return new McpError(ErrorCode.InvalidParams, message, { data, httpStatus: 400 });
	}

	static methodNotFound(method: string): McpError {
		return new McpError(ErrorCode.MethodNotFound, `Méthode inconnue : ${method}`, { httpStatus: 404 });
	}

	static internal(message: string, data?: unknown): McpError {
		return new McpError(ErrorCode.InternalError, message, { data, httpStatus: 500 });
	}
}

function defaultHttpStatus(code: number): number {
	switch (code) {
		case ErrorCode.MethodNotFound:
			return 404;
		case ErrorCode.ParseError:
		case ErrorCode.InvalidRequest:
		case ErrorCode.InvalidParams:
		case ErrorCode.HeaderMismatch:
		case ErrorCode.MissingRequiredClientCapability:
		case ErrorCode.UnsupportedProtocolVersion:
			return 400;
		default:
			return 500;
	}
}

/** Vrai si `value` est un objet JSON simple (ni tableau, ni `null`). */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
	if (!isPlainObject(value) || value.jsonrpc !== "2.0" || typeof value.method !== "string") return false;
	const { id } = value;
	return typeof id === "string" || (typeof id === "number" && Number.isFinite(id));
}

export function isJsonRpcNotification(value: unknown): value is JsonRpcNotification {
	return (
		isPlainObject(value) && value.jsonrpc === "2.0" && typeof value.method === "string" && value.id === undefined
	);
}

export function isJsonRpcResponse(value: unknown): value is JsonRpcResponse {
	return isPlainObject(value) && value.jsonrpc === "2.0" && ("result" in value || "error" in value);
}

export function resultResponse(id: RequestId, result: Record<string, unknown>): JsonRpcResultResponse {
	return { jsonrpc: "2.0", id, result: result as JsonRpcResultResponse["result"] };
}

export function errorResponse(id: RequestId | undefined, error: JsonRpcErrorPayload): JsonRpcErrorResponse {
	return id === undefined ? { jsonrpc: "2.0", error } : { jsonrpc: "2.0", id, error };
}

/** Normalise n'importe quelle exception en charge utile JSON-RPC. */
export function toErrorPayload(error: unknown): JsonRpcErrorPayload {
	if (error instanceof McpError) return error.toPayload();
	if (error instanceof Error) return { code: ErrorCode.InternalError, message: error.message };
	return { code: ErrorCode.InternalError, message: String(error) };
}
