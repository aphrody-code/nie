/**
 * Cœur du serveur : routage des méthodes JSON-RPC, indépendant du transport.
 *
 * `McpServer.handle()` est une fonction quasi pure `message → réponse` : le
 * transport (stdio ou Streamable HTTP) se contente de fournir le contexte
 * (métadonnées de la requête, signal d'annulation, canal de notifications).
 * C'est ce découpage qui permet de tester tout le protocole sans ouvrir de
 * socket, et de servir les deux ères sur le même code.
 */

import {
	ErrorCode,
	type JsonRpcMessage,
	type JsonRpcNotification,
	type JsonRpcRequest,
	type JsonRpcResponse,
	McpError,
	errorResponse,
	isJsonRpcNotification,
	isJsonRpcRequest,
	isPlainObject,
	resultResponse,
	toErrorPayload,
} from "./protocol/json-rpc.ts";
import {
	type Implementation,
	type LogLevel,
	LOG_LEVELS,
	type RequestMeta,
	isLogLevel,
	legacyMeta,
	parseModernMeta,
	withServerInfo,
} from "./protocol/meta.ts";
import type { ContentBlock, ResourceContents, ServerCapabilities, ToolResult } from "./protocol/types.ts";
import {
	LEGACY_PROTOCOL_VERSIONS,
	MODERN_PROTOCOL_VERSION,
	SUPPORTED_PROTOCOL_VERSIONS,
	isSupportedVersion,
	negotiateLegacyVersion,
} from "./protocol/versions.ts";
import { type HandlerContext, type McpRegistry, type McpScope, matchUriTemplate } from "./registry.ts";

export interface DispatchContext {
	/** Métadonnées déjà validées par le transport (ère, version, capacités). */
	meta: RequestMeta;
	/**
	 * Portée accordée par le transport d'après le jeton présenté. Jamais
	 * fournie par le client : c'est la frontière d'autorisation du serveur.
	 */
	scope?: McpScope;
	signal: AbortSignal;
	/** Envoie une notification liée à la requête en cours (progression, logs). */
	emit(notification: JsonRpcNotification): void;
}

export interface McpServerOptions {
	serverInfo: Implementation;
	registry: McpRegistry;
	/** Instructions en langue naturelle destinées au modèle client. */
	instructions?: string;
	/** Taille de page des listes paginées (`tools/list`, `resources/list`…). */
	pageSize?: number;
	/** Durée de validité annoncée pour les listes (`ttlMs`). */
	listTtlMs?: number;
}

const DEFAULT_PAGE_SIZE = 200;
const DEFAULT_LIST_TTL_MS = 300_000;

export class McpServer {
	readonly serverInfo: Implementation;
	readonly registry: McpRegistry;
	readonly instructions?: string;
	readonly #pageSize: number;
	readonly #listTtlMs: number;
	/** Niveau minimal courant, réglé par `logging/setLevel` (clients legacy). */
	#logLevel: LogLevel = "info";

	constructor(options: McpServerOptions) {
		this.serverInfo = options.serverInfo;
		this.registry = options.registry;
		this.instructions = options.instructions;
		this.#pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
		this.#listTtlMs = options.listTtlMs ?? DEFAULT_LIST_TTL_MS;
	}

	capabilities(): ServerCapabilities {
		const capabilities: ServerCapabilities = {
			tools: { listChanged: false },
			resources: { subscribe: false, listChanged: false },
			prompts: { listChanged: false },
			logging: {},
			completions: {},
		};
		return capabilities;
	}

	/**
	 * Traite un message JSON-RPC. Renvoie `null` pour une notification (une
	 * notification n'a jamais de réponse, c'est une règle de JSON-RPC).
	 */
	async handle(message: JsonRpcMessage, context: DispatchContext): Promise<JsonRpcResponse | null> {
		if (isJsonRpcNotification(message)) {
			this.#handleNotification(message);
			return null;
		}
		if (!isJsonRpcRequest(message)) {
			return errorResponse(undefined, {
				code: ErrorCode.InvalidRequest,
				message: "Message JSON-RPC invalide : `id` et `method` sont requis.",
			});
		}
		try {
			const result = await this.#route(message, context);
			return resultResponse(message.id, withServerInfo({ resultType: "complete", ...result }, this.serverInfo));
		} catch (error) {
			if (context.signal.aborted) {
				// Le client a fermé le flux : la spec interdit d'envoyer quoi que
				// ce soit de plus pour cette requête.
				return null;
			}
			return errorResponse(message.id, toErrorPayload(error));
		}
	}

	#handleNotification(notification: JsonRpcNotification): void {
		switch (notification.method) {
			// Fin du handshake legacy : rien à faire, le serveur est sans état.
			case "notifications/initialized":
			case "notifications/cancelled":
			case "notifications/roots/list_changed":
				return;
			default:
				// Une notification inconnue est ignorée : la spec interdit d'y
				// répondre, y compris par une erreur.
				return;
		}
	}

	async #route(request: JsonRpcRequest, context: DispatchContext): Promise<Record<string, unknown>> {
		const params = isPlainObject(request.params) ? request.params : {};
		switch (request.method) {
			case "server/discover":
				return this.#discover();
			case "initialize":
				return this.#initialize(params);
			case "ping":
				return {};
			case "tools/list":
				return this.#listTools(params, context);
			case "tools/call":
				return await this.#callTool(params, context);
			case "resources/list":
				return await this.#listResources(params);
			case "resources/templates/list":
				return this.#listResourceTemplates(params);
			case "resources/read":
				return await this.#readResource(params, context);
			case "prompts/list":
				return this.#listPrompts(params);
			case "prompts/get":
				return await this.#getPrompt(params, context);
			case "completion/complete":
				return await this.#complete(params);
			case "logging/setLevel":
				return this.#setLogLevel(params);
			default:
				throw McpError.methodNotFound(request.method);
		}
	}

	// ── Découverte et handshake ────────────────────────────────────────────

	#discover(): Record<string, unknown> {
		const result: Record<string, unknown> = {
			supportedVersions: SUPPORTED_PROTOCOL_VERSIONS,
			capabilities: this.capabilities(),
			ttlMs: this.#listTtlMs,
			cacheScope: "public",
		};
		if (this.instructions) result.instructions = this.instructions;
		return result;
	}

	/**
	 * Handshake des révisions à session. On répond même si le client demande
	 * une version qu'on ne connaît pas : la règle legacy est de proposer alors
	 * notre version la plus récente, à charge pour le client de l'accepter.
	 */
	#initialize(params: Record<string, unknown>): Record<string, unknown> {
		const version = negotiateLegacyVersion(params.protocolVersion);
		const result: Record<string, unknown> = {
			protocolVersion: version,
			capabilities: this.capabilities(),
			serverInfo: this.serverInfo,
		};
		if (this.instructions) result.instructions = this.instructions;
		return result;
	}

	// ── Outils ─────────────────────────────────────────────────────────────

	#listTools(params: Record<string, unknown>, context: DispatchContext): Record<string, unknown> {
		const tools = this.registry.toolsFor(context.scope ?? "read").map((tool) => tool.definition);
		return this.#paginate(tools, params.cursor, "tools");
	}

	async #callTool(params: Record<string, unknown>, context: DispatchContext): Promise<Record<string, unknown>> {
		const name = params.name;
		if (typeof name !== "string") {
			throw McpError.invalidParams("`params.name` est requis pour `tools/call`.");
		}
		const tool = this.registry.getTool(name);
		if (!tool) {
			// Outil inconnu = erreur de protocole (et non un résultat `isError`).
			throw McpError.invalidParams(`Outil inconnu : « ${name} ».`);
		}
		const scope = context.scope ?? "read";
		if (tool.scope === "admin" && scope !== "admin") {
			// Refus d'autorisation, pas un échec d'exécution : le modèle ne doit
			// pas réessayer. On le dit explicitement — c'est le serveur de
			// l'utilisateur, l'obscurité n'apporte rien.
			throw new McpError(
				ErrorCode.InvalidParams,
				`Outil « ${name} » réservé à la portée « admin » : la connexion courante est en lecture seule.`,
				{ data: { requiredScope: "admin", grantedScope: scope }, httpStatus: 403 },
			);
		}
		const args = this.registry.parseToolArguments(tool, params.arguments);
		const handlerContext = this.#handlerContext(context);
		try {
			const result = await tool.run(args, handlerContext);
			return this.#normalizeToolResult(result);
		} catch (error) {
			if (error instanceof McpError) throw error;
			if (context.signal.aborted) throw error;
			// Échec *d'exécution* : la spec veut un résultat `isError: true`,
			// pour que le modèle puisse le lire et se corriger.
			const message = error instanceof Error ? error.message : String(error);
			return {
				content: [{ type: "text", text: `Échec de l'outil « ${name} » : ${message}` }],
				isError: true,
			};
		}
	}

	#normalizeToolResult(result: ToolResult): Record<string, unknown> {
		const normalized: Record<string, unknown> = { content: result.content };
		if (result.structuredContent !== undefined) normalized.structuredContent = result.structuredContent;
		if (result.isError) normalized.isError = true;
		if (result._meta) normalized._meta = result._meta;
		return normalized;
	}

	// ── Ressources ─────────────────────────────────────────────────────────

	async #listResources(params: Record<string, unknown>): Promise<Record<string, unknown>> {
		const resources = await this.registry.listResourceDefinitions();
		return this.#paginate(resources, params.cursor, "resources");
	}

	#listResourceTemplates(params: Record<string, unknown>): Record<string, unknown> {
		return this.#paginate(this.registry.templateDefinitions(), params.cursor, "resourceTemplates");
	}

	async #readResource(params: Record<string, unknown>, context: DispatchContext): Promise<Record<string, unknown>> {
		const uri = params.uri;
		if (typeof uri !== "string") {
			throw McpError.invalidParams("`params.uri` est requis pour `resources/read`.");
		}
		const handlerContext = this.#handlerContext(context);
		const direct = this.registry.getResource(uri);
		if (direct) {
			return { contents: [normalizeContents(await direct.read(handlerContext), uri, direct.mimeType)] };
		}
		for (const template of this.registry.templates) {
			const variables = matchUriTemplate(template.uriTemplate, uri);
			if (!variables) continue;
			const contents = await template.read(uri, variables, handlerContext);
			if (contents) return { contents: [normalizeContents(contents, uri, template.mimeType)] };
		}
		// Depuis 2026-07-28, une ressource introuvable est un `-32602`
		// (`-32002` est réservé aux révisions antérieures et interdit ici).
		throw McpError.invalidParams(`Ressource introuvable : ${uri}`, { uri });
	}

	// ── Prompts ────────────────────────────────────────────────────────────

	#listPrompts(params: Record<string, unknown>): Record<string, unknown> {
		return this.#paginate(this.registry.promptDefinitions(), params.cursor, "prompts");
	}

	async #getPrompt(params: Record<string, unknown>, context: DispatchContext): Promise<Record<string, unknown>> {
		const name = params.name;
		if (typeof name !== "string") {
			throw McpError.invalidParams("`params.name` est requis pour `prompts/get`.");
		}
		const prompt = this.registry.getPrompt(name);
		if (!prompt) throw McpError.invalidParams(`Prompt inconnu : « ${name} ».`);
		const rawArguments = isPlainObject(params.arguments) ? params.arguments : {};
		const args: Record<string, string> = {};
		for (const [key, value] of Object.entries(rawArguments)) {
			args[key] = typeof value === "string" ? value : JSON.stringify(value);
		}
		for (const argument of prompt.arguments ?? []) {
			if (argument.required && !(argument.name in args)) {
				throw McpError.invalidParams(`Argument requis manquant pour « ${name} » : ${argument.name}.`);
			}
		}
		const result = await prompt.build(args, this.#handlerContext(context));
		const payload: Record<string, unknown> = { messages: result.messages };
		if (result.description ?? prompt.description) {
			payload.description = result.description ?? prompt.description;
		}
		return payload;
	}

	// ── Complétion d'arguments ─────────────────────────────────────────────

	async #complete(params: Record<string, unknown>): Promise<Record<string, unknown>> {
		const ref = isPlainObject(params.ref) ? params.ref : undefined;
		const argument = isPlainObject(params.argument) ? params.argument : undefined;
		if (!ref || !argument || typeof argument.name !== "string") {
			throw McpError.invalidParams("`params.ref` et `params.argument` sont requis pour `completion/complete`.");
		}
		const value = typeof argument.value === "string" ? argument.value : "";
		let values: string[] = [];

		if (ref.type === "ref/prompt" && typeof ref.name === "string") {
			const prompt = this.registry.getPrompt(ref.name);
			if (prompt?.complete) values = await prompt.complete(argument.name, value);
		} else if (ref.type === "ref/resource" && typeof ref.uri === "string") {
			for (const template of this.registry.templates) {
				if (template.uriTemplate !== ref.uri || !template.complete) continue;
				values = await template.complete(argument.name, value);
				break;
			}
		}

		// La spec plafonne une réponse de complétion à 100 valeurs.
		const total = values.length;
		const page = values.slice(0, 100);
		return { completion: { values: page, total, hasMore: total > page.length } };
	}

	#setLogLevel(params: Record<string, unknown>): Record<string, unknown> {
		const level = params.level;
		if (!isLogLevel(level)) {
			throw McpError.invalidParams(`Niveau de journalisation invalide (attendu : ${LOG_LEVELS.join(", ")}).`);
		}
		this.#logLevel = level;
		return {};
	}

	// ── Utilitaires ────────────────────────────────────────────────────────

	#handlerContext(context: DispatchContext): HandlerContext {
		const minimum = context.meta.logLevel ?? this.#logLevel;
		return {
			scope: context.scope ?? "read",
			meta: context.meta,
			signal: context.signal,
			progress: (progress, total, message) => {
				const token = context.meta.progressToken;
				if (token === undefined) return;
				const params: Record<string, unknown> = { progressToken: token, progress };
				if (total !== undefined) params.total = total;
				if (message !== undefined) params.message = message;
				context.emit({ jsonrpc: "2.0", method: "notifications/progress", params });
			},
			log: (level, data, logger) => {
				if (LOG_LEVELS.indexOf(level) < LOG_LEVELS.indexOf(minimum)) return;
				const params: Record<string, unknown> = { level, data };
				if (logger) params.logger = logger;
				context.emit({ jsonrpc: "2.0", method: "notifications/message", params });
			},
		};
	}

	/**
	 * Pagination par curseur opaque. Le curseur encode simplement le décalage,
	 * mais reste opaque côté client : la spec interdit d'en supposer la forme.
	 */
	#paginate<T>(items: T[], cursor: unknown, key: string): Record<string, unknown> {
		let offset = 0;
		if (typeof cursor === "string" && cursor.length > 0) {
			offset = decodeCursor(cursor);
			if (offset < 0 || offset > items.length) {
				throw McpError.invalidParams("Curseur de pagination invalide.");
			}
		}
		const page = items.slice(offset, offset + this.#pageSize);
		const next = offset + page.length;
		const result: Record<string, unknown> = {
			[key]: page,
			ttlMs: this.#listTtlMs,
			cacheScope: "public",
		};
		if (next < items.length) result.nextCursor = encodeCursor(next);
		return result;
	}
}

function encodeCursor(offset: number): string {
	return btoa(`rg:${offset}`);
}

function decodeCursor(cursor: string): number {
	try {
		const decoded = atob(cursor);
		if (!decoded.startsWith("rg:")) return -1;
		const parsed = Number.parseInt(decoded.slice(3), 10);
		return Number.isFinite(parsed) ? parsed : -1;
	} catch {
		return -1;
	}
}

function normalizeContents(contents: ResourceContents, uri: string, fallbackMime?: string): ResourceContents {
	const normalized: ResourceContents = { ...contents, uri: contents.uri || uri };
	if (!normalized.mimeType && fallbackMime) normalized.mimeType = fallbackMime;
	return normalized;
}

/** Types réexportés pour les implémenteurs d'outils. */
export type { ContentBlock, HandlerContext, RequestMeta };
export { LEGACY_PROTOCOL_VERSIONS, MODERN_PROTOCOL_VERSION, isSupportedVersion, legacyMeta, parseModernMeta };
