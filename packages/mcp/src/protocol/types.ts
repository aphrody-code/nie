/**
 * Types de domaine MCP : outils, ressources, prompts, contenus.
 *
 * Reflet fidèle du schéma officiel de la révision `2026-07-28`
 * (https://modelcontextprotocol.io/specification/2026-07-28/schema), réduit
 * à ce qu'un serveur émet ou consomme réellement.
 */

import type { LogLevel } from "./meta.ts";

/** Schéma JSON 2020-12 — dialecte par défaut de MCP depuis 2026-07-28. */
export type JsonSchema = Record<string, unknown>;

export interface Icon {
	src: string;
	mimeType?: string;
	sizes?: string[];
}

/** Métadonnées d'affichage communes aux contenus, ressources et prompts. */
export interface Annotations {
	audience?: ("user" | "assistant")[];
	priority?: number;
	lastModified?: string;
}

export interface TextContent {
	type: "text";
	text: string;
	annotations?: Annotations;
	_meta?: Record<string, unknown>;
}

export interface ImageContent {
	type: "image";
	data: string;
	mimeType: string;
	annotations?: Annotations;
}

export interface AudioContent {
	type: "audio";
	data: string;
	mimeType: string;
	annotations?: Annotations;
}

export interface ResourceLinkContent {
	type: "resource_link";
	uri: string;
	name: string;
	title?: string;
	description?: string;
	mimeType?: string;
	annotations?: Annotations;
}

export interface ResourceContents {
	uri: string;
	name?: string;
	title?: string;
	mimeType?: string;
	text?: string;
	blob?: string;
	annotations?: Annotations;
	_meta?: Record<string, unknown>;
}

export interface EmbeddedResourceContent {
	type: "resource";
	resource: ResourceContents;
	annotations?: Annotations;
}

export type ContentBlock =
	| TextContent
	| ImageContent
	| AudioContent
	| ResourceLinkContent
	| EmbeddedResourceContent;

/** Indications déclaratives — non vérifiées, donc « non fiables » côté client. */
export interface ToolAnnotations {
	title?: string;
	readOnlyHint?: boolean;
	destructiveHint?: boolean;
	idempotentHint?: boolean;
	openWorldHint?: boolean;
}

export interface ToolDefinition {
	name: string;
	title?: string;
	description?: string;
	inputSchema: JsonSchema;
	outputSchema?: JsonSchema;
	annotations?: ToolAnnotations;
	icons?: Icon[];
	_meta?: Record<string, unknown>;
}

export interface ToolResult {
	content: ContentBlock[];
	structuredContent?: unknown;
	isError?: boolean;
	_meta?: Record<string, unknown>;
}

export interface ResourceDefinition {
	uri: string;
	name: string;
	title?: string;
	description?: string;
	mimeType?: string;
	size?: number;
	annotations?: Annotations;
	icons?: Icon[];
	_meta?: Record<string, unknown>;
}

export interface ResourceTemplateDefinition {
	uriTemplate: string;
	name: string;
	title?: string;
	description?: string;
	mimeType?: string;
	annotations?: Annotations;
}

export interface PromptArgumentDefinition {
	name: string;
	description?: string;
	required?: boolean;
}

export interface PromptDefinition {
	name: string;
	title?: string;
	description?: string;
	arguments?: PromptArgumentDefinition[];
	icons?: Icon[];
}

export interface PromptMessage {
	role: "user" | "assistant";
	content: ContentBlock;
}

export interface PromptResult {
	description?: string;
	messages: PromptMessage[];
}

export interface ServerCapabilities {
	tools?: { listChanged?: boolean };
	resources?: { subscribe?: boolean; listChanged?: boolean };
	prompts?: { listChanged?: boolean };
	logging?: Record<string, unknown>;
	completions?: Record<string, unknown>;
	experimental?: Record<string, unknown>;
	extensions?: Record<string, Record<string, unknown>>;
}

/** Notification `notifications/message` (journalisation côté serveur). */
export interface LoggingMessageNotification {
	level: LogLevel;
	logger?: string;
	data: unknown;
}

export const isTextContent = (block: ContentBlock): block is TextContent => block.type === "text";

/** Raccourci : un bloc texte, le contenu le plus courant d'un résultat d'outil. */
export function text(value: string, annotations?: Annotations): TextContent {
	return annotations ? { type: "text", text: value, annotations } : { type: "text", text: value };
}

/**
 * Résultat structuré + sa sérialisation texte.
 *
 * La spec recommande explicitement de dupliquer `structuredContent` dans un
 * bloc texte pour les clients qui ne lisent pas encore le champ structuré.
 */
export function structured(value: unknown, options: { pretty?: boolean } = {}): ToolResult {
	const serialized = options.pretty === false ? JSON.stringify(value) : JSON.stringify(value, null, 2);
	return { content: [text(serialized)], structuredContent: value };
}

/** Résultat d'erreur *d'exécution* : `isError`, pas une erreur de protocole. */
export function toolError(message: string): ToolResult {
	return { content: [text(message)], isError: true };
}
