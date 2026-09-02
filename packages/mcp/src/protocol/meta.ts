/**
 * Métadonnées `_meta` : clés réservées, lecture et écriture.
 *
 * Depuis `2026-07-28`, un client *moderne* déclare sa version, son identité
 * et ses capacités dans `params._meta`, à chaque requête. Le serveur, lui,
 * DEVRAIT renvoyer son identité dans `result._meta`.
 */

import { ErrorCode, isPlainObject, McpError } from "./json-rpc.ts";
import { type ProtocolEra, eraOf } from "./versions.ts";

/** Clés `_meta` réservées par la spécification. */
export const META_KEYS = {
	progressToken: "progressToken",
	protocolVersion: "io.modelcontextprotocol/protocolVersion",
	clientInfo: "io.modelcontextprotocol/clientInfo",
	clientCapabilities: "io.modelcontextprotocol/clientCapabilities",
	logLevel: "io.modelcontextprotocol/logLevel",
	subscriptionId: "io.modelcontextprotocol/subscriptionId",
	serverInfo: "io.modelcontextprotocol/serverInfo",
} as const;

/** Niveaux de journalisation, repris de RFC 5424 comme le fait la spec. */
export const LOG_LEVELS = [
	"debug",
	"info",
	"notice",
	"warning",
	"error",
	"critical",
	"alert",
	"emergency",
] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export interface Implementation {
	name: string;
	version?: string;
	title?: string;
}

export interface ClientCapabilities {
	roots?: { listChanged?: boolean };
	sampling?: Record<string, unknown>;
	elicitation?: Record<string, unknown>;
	experimental?: Record<string, unknown>;
	extensions?: Record<string, Record<string, unknown>>;
}

/** Ce que le serveur sait d'une requête, indépendamment du transport. */
export interface RequestMeta {
	era: ProtocolEra;
	protocolVersion: string;
	clientInfo?: Implementation;
	clientCapabilities: ClientCapabilities;
	logLevel?: LogLevel;
	progressToken?: string | number;
	raw: Record<string, unknown>;
}

function readMetaObject(params: unknown): Record<string, unknown> {
	if (!isPlainObject(params)) return {};
	const meta = params._meta;
	return isPlainObject(meta) ? meta : {};
}

/** Vrai si la requête porte les métadonnées per-requête de l'ère moderne. */
export function hasModernMeta(params: unknown): boolean {
	return typeof readMetaObject(params)[META_KEYS.protocolVersion] === "string";
}

export function readProtocolVersion(params: unknown): string | undefined {
	const value = readMetaObject(params)[META_KEYS.protocolVersion];
	return typeof value === "string" ? value : undefined;
}

/**
 * Construit le contexte d'une requête *moderne*.
 *
 * La spec est stricte : `protocolVersion` et `clientCapabilities` sont
 * OBLIGATOIRES, et une requête à laquelle il manque un champ requis est
 * malformée → `-32602` (et `400` en HTTP).
 */
export function parseModernMeta(params: unknown): RequestMeta {
	const meta = readMetaObject(params);
	const version = meta[META_KEYS.protocolVersion];
	if (typeof version !== "string") {
		throw McpError.invalidParams(`Champ \`_meta.${META_KEYS.protocolVersion}\` manquant ou invalide.`);
	}
	const capabilities = meta[META_KEYS.clientCapabilities];
	if (!isPlainObject(capabilities)) {
		throw McpError.invalidParams(`Champ \`_meta.${META_KEYS.clientCapabilities}\` manquant ou invalide.`);
	}
	const info = meta[META_KEYS.clientInfo];
	const level = meta[META_KEYS.logLevel];
	const progressToken = meta[META_KEYS.progressToken];

	return {
		era: eraOf(version),
		protocolVersion: version,
		clientInfo: isPlainObject(info) && typeof info.name === "string" ? (info as unknown as Implementation) : undefined,
		clientCapabilities: capabilities as ClientCapabilities,
		logLevel: isLogLevel(level) ? level : undefined,
		progressToken:
			typeof progressToken === "string" || typeof progressToken === "number" ? progressToken : undefined,
		raw: meta,
	};
}

/** Contexte d'une requête *legacy* : les infos viennent du handshake, pas de `_meta`. */
export function legacyMeta(params: unknown, version: string, clientInfo?: Implementation): RequestMeta {
	const meta = readMetaObject(params);
	const progressToken = meta[META_KEYS.progressToken];
	return {
		era: "legacy",
		protocolVersion: version,
		clientInfo,
		clientCapabilities: {},
		progressToken:
			typeof progressToken === "string" || typeof progressToken === "number" ? progressToken : undefined,
		raw: meta,
	};
}

export function isLogLevel(value: unknown): value is LogLevel {
	return typeof value === "string" && (LOG_LEVELS as readonly string[]).includes(value);
}

/** `-32021` : la requête a besoin d'une capacité que le client n'a pas déclarée. */
export function requireClientCapability(meta: RequestMeta, ...required: string[]): void {
	const declared = meta.clientCapabilities as Record<string, unknown>;
	const missing = required.filter((key) => declared[key] === undefined);
	if (missing.length > 0) {
		throw new McpError(
			ErrorCode.MissingRequiredClientCapability,
			`Capacité client requise absente : ${missing.join(", ")}`,
			{ data: { requiredCapabilities: missing }, httpStatus: 400 },
		);
	}
}

/** Ajoute `io.modelcontextprotocol/serverInfo` au `_meta` d'un résultat. */
export function withServerInfo<T extends Record<string, unknown>>(result: T, serverInfo: Implementation): T {
	const existing = isPlainObject(result._meta) ? result._meta : {};
	return { ...result, _meta: { ...existing, [META_KEYS.serverInfo]: serverInfo } };
}
