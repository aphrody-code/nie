/**
 * Transport **stdio** : JSON-RPC délimité par des retours à la ligne sur les
 * flux standard, lu et écrit avec les API Bun (`Bun.stdin`, `Bun.stdout`).
 *
 * Règles de la spec appliquées ici :
 * - un message par ligne, encodé en UTF-8, **sans** retour à la ligne interne ;
 * - le serveur n'écrit sur stdout QUE des messages MCP valides — toute trace de
 *   journalisation part sur stderr, sinon le client casse ;
 * - le serveur est sans état : un même processus peut recevoir des requêtes
 *   sans lien entre elles, y compris des deux ères.
 */

import {
	ErrorCode,
	type JsonRpcMessage,
	type JsonRpcNotification,
	errorResponse,
	isJsonRpcNotification,
	isJsonRpcRequest,
	isPlainObject,
} from "../protocol/json-rpc.ts";
import { META_KEYS, legacyMeta, parseModernMeta } from "../protocol/meta.ts";
import { ASSUMED_LEGACY_VERSION, isModernVersion } from "../protocol/versions.ts";
import type { McpScope } from "../registry.ts";
import type { McpServer } from "../server.ts";

export interface StdioTransportOptions {
	server: McpServer;
	/**
	 * Portée accordée aux requêtes de ce processus.
	 *
	 * Défaut `admin` : sur stdio, le client a lancé le processus lui-même et
	 * dispose déjà d'un shell sur la machine — restreindre n'apporterait
	 * aucune sécurité, seulement de la gêne. Passer `"read"` pour un sidecar
	 * volontairement bridé.
	 */
	scope?: McpScope;
	/** Flux d'entrée ; `Bun.stdin` par défaut (surchargé dans les tests). */
	input?: ReadableStream<Uint8Array>;
	/** Écriture d'une ligne de sortie ; stdout par défaut. */
	write?: (line: string) => void | Promise<void>;
	/** Journalisation — jamais sur stdout. */
	onLog?: (line: string) => void;
	signal?: AbortSignal;
}

/**
 * Boucle de lecture. Résout quand l'entrée est fermée (le client a mis fin au
 * processus), ce qui laisse à l'appelant le soin de sortir proprement.
 */
export async function runStdioTransport(options: StdioTransportOptions): Promise<void> {
	const input = options.input ?? Bun.stdin.stream();
	const log = options.onLog ?? ((line: string) => process.stderr.write(`${line}\n`));
	const writeLine =
		options.write ??
		((line: string) => {
			process.stdout.write(`${line}\n`);
		});

	const send = async (message: unknown) => {
		await writeLine(JSON.stringify(message));
	};

	const decoder = new TextDecoder();
	let buffer = "";

	for await (const chunk of input as AsyncIterable<Uint8Array>) {
		if (options.signal?.aborted) break;
		buffer += decoder.decode(chunk, { stream: true });

		let newline = buffer.indexOf("\n");
		while (newline !== -1) {
			const line = buffer.slice(0, newline).trim();
			buffer = buffer.slice(newline + 1);
			newline = buffer.indexOf("\n");
			if (line.length === 0) continue;
			await handleLine(line, options.server, send, log, options.scope ?? "admin", options.signal);
		}
	}

	// Dernière ligne éventuellement non terminée par `\n`.
	const rest = buffer.trim();
	if (rest.length > 0) await handleLine(rest, options.server, send, log, options.scope ?? "admin", options.signal);
}

async function handleLine(
	line: string,
	server: McpServer,
	send: (message: unknown) => Promise<void>,
	log: (line: string) => void,
	scope: McpScope,
	signal?: AbortSignal,
): Promise<void> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch {
		await send(errorResponse(undefined, { code: ErrorCode.ParseError, message: "Ligne JSON illisible." }));
		return;
	}

	if (!isPlainObject(parsed)) {
		await send(errorResponse(undefined, { code: ErrorCode.InvalidRequest, message: "Message JSON-RPC attendu." }));
		return;
	}

	const message = parsed as unknown as JsonRpcMessage;
	const controller = new AbortController();
	if (signal) signal.addEventListener("abort", () => controller.abort(), { once: true });

	const emit = (notification: JsonRpcNotification) => {
		void send(notification);
	};

	try {
		const meta = resolveStdioMeta(message);
		if (isJsonRpcNotification(message)) {
			await server.handle(message, { meta, scope, signal: controller.signal, emit });
			return;
		}
		if (!isJsonRpcRequest(message)) {
			await send(
				errorResponse(undefined, { code: ErrorCode.InvalidRequest, message: "Requête JSON-RPC invalide." }),
			);
			return;
		}
		log(`mcp-stdio method=${message.method} era=${meta.era} scope=${scope}`);
		const response = await server.handle(message, { meta, scope, signal: controller.signal, emit });
		if (response) await send(response);
	} catch (error) {
		const id = isJsonRpcRequest(message) ? message.id : undefined;
		await send(
			errorResponse(id, {
				code: ErrorCode.InternalError,
				message: error instanceof Error ? error.message : String(error),
			}),
		);
	}
}

/**
 * Sur stdio il n'y a pas d'en-tête : l'ère se déduit uniquement de la présence
 * des métadonnées per-requête dans le corps.
 */
function resolveStdioMeta(message: JsonRpcMessage) {
	const params = isPlainObject((message as { params?: unknown }).params)
		? ((message as { params: Record<string, unknown> }).params)
		: {};
	const meta = isPlainObject(params._meta) ? (params._meta as Record<string, unknown>) : {};
	const version = meta[META_KEYS.protocolVersion];

	if (typeof version === "string" && isModernVersion(version)) {
		return parseModernMeta(params);
	}

	const clientInfo =
		isPlainObject(params.clientInfo) && typeof params.clientInfo.name === "string"
			? { name: params.clientInfo.name, version: params.clientInfo.version as string | undefined }
			: undefined;
	const negotiated = typeof params.protocolVersion === "string" ? params.protocolVersion : ASSUMED_LEGACY_VERSION;
	return legacyMeta(params, negotiated, clientInfo);
}
