/**
 * Registre typé des primitives MCP : outils, ressources, gabarits d'URI et
 * prompts.
 *
 * L'objectif est qu'un outil soit **impossible à mal déclarer** : le schéma
 * d'entrée est un schéma zod, le type des arguments du gestionnaire en est
 * déduit, et le JSON Schema publié dans `tools/list` en est dérivé
 * automatiquement (dialecte 2020-12, celui que MCP utilise par défaut depuis
 * la révision 2026-07-28).
 */

import { z } from "zod";
import { McpError } from "./protocol/json-rpc.ts";
import type { LogLevel, RequestMeta } from "./protocol/meta.ts";
import type {
	Icon,
	JsonSchema,
	PromptDefinition,
	PromptResult,
	ResourceContents,
	ResourceDefinition,
	ResourceTemplateDefinition,
	ToolAnnotations,
	ToolDefinition,
	ToolResult,
} from "./protocol/types.ts";

export type { ResourceContents, ResourceDefinition, ResourceTemplateDefinition, ToolDefinition, ToolResult };

/**
 * Portée d'accès. `read` = les outils de lecture (le défaut) ; `admin` ouvre
 * en plus l'écriture, la suppression et l'exécution de commandes. La portée
 * est déterminée par le jeton présenté au transport, jamais par le client.
 */
export type McpScope = "read" | "admin";

/** Contexte passé à tout gestionnaire : progression, journalisation, annulation. */
export interface HandlerContext {
	/** Portée effective de la requête en cours. */
	readonly scope: McpScope;
	readonly meta: RequestMeta;
	/** Abandonné quand le client ferme le flux (= annulation, cf. spec). */
	readonly signal: AbortSignal;
	/** Émet `notifications/progress` si le client a fourni un `progressToken`. */
	progress(progress: number, total?: number, message?: string): void;
	/** Émet `notifications/message` (journalisation MCP), filtré par niveau. */
	log(level: LogLevel, data: unknown, logger?: string): void;
}

export type ToolHandler<Args> = (args: Args, context: HandlerContext) => ToolResult | Promise<ToolResult>;

export interface ToolSpec<Schema extends z.ZodType> {
	name: string;
	title?: string;
	description: string;
	inputSchema: Schema;
	/** Schéma du `structuredContent` renvoyé ; publié tel quel dans `tools/list`. */
	outputSchema?: z.ZodType;
	annotations?: ToolAnnotations;
	icons?: Icon[];
	/** Portée requise pour voir et appeler cet outil. `read` par défaut. */
	scope?: McpScope;
	handler: ToolHandler<z.output<Schema>>;
}

export interface RegisteredTool {
	definition: ToolDefinition;
	inputSchema: z.ZodType;
	scope: McpScope;
	run: ToolHandler<unknown>;
}

export interface ResourceSpec {
	uri: string;
	name: string;
	title?: string;
	description?: string;
	mimeType?: string;
	icons?: Icon[];
	read: (context: HandlerContext) => ResourceContents | Promise<ResourceContents>;
}

export interface ResourceTemplateSpec {
	uriTemplate: string;
	name: string;
	title?: string;
	description?: string;
	mimeType?: string;
	/** Doit renvoyer `undefined` si l'URI ne correspond pas au gabarit. */
	read: (
		uri: string,
		variables: Record<string, string>,
		context: HandlerContext,
	) => ResourceContents | undefined | Promise<ResourceContents | undefined>;
	/** Valeurs proposées à `completion/complete` pour une variable du gabarit. */
	complete?: (variable: string, value: string) => string[] | Promise<string[]>;
	/** Ressources concrètes à publier dans `resources/list` (facultatif). */
	list?: () => ResourceDefinition[] | Promise<ResourceDefinition[]>;
}

export interface PromptSpec {
	name: string;
	title?: string;
	description: string;
	arguments?: { name: string; description?: string; required?: boolean }[];
	build: (args: Record<string, string>, context: HandlerContext) => PromptResult | Promise<PromptResult>;
	complete?: (argument: string, value: string) => string[] | Promise<string[]>;
}

/**
 * Nom d'outil : la spec « SHOULD » le restreindre aux caractères sûrs pour un
 * en-tête HTTP (`Mcp-Name`). On applique la règle strictement — c'est ce qui
 * évite d'avoir à encoder les noms en Base64 sur le transport HTTP.
 */
const SAFE_NAME = /^[a-zA-Z0-9_.-]{1,128}$/;

function assertSafeName(kind: string, name: string): void {
	if (!SAFE_NAME.test(name)) {
		throw new Error(`Nom de ${kind} invalide : « ${name} » (attendu : ${SAFE_NAME.source}).`);
	}
}

/** Convertit un schéma zod en JSON Schema 2020-12 publiable dans `tools/list`. */
export function toJsonSchema(schema: z.ZodType, io: "input" | "output" = "input"): JsonSchema {
	const json = z.toJSONSchema(schema, { target: "draft-2020-12", io, unrepresentable: "any" }) as JsonSchema;
	// MCP exige un schéma d'entrée de type objet ; zod produit déjà cela pour
	// un z.object, mais on garantit la forme pour les clients stricts.
	if (io === "input" && json.type !== "object") {
		return { type: "object", properties: {}, additionalProperties: false };
	}
	return json;
}

export function defineTool<Schema extends z.ZodType>(spec: ToolSpec<Schema>): RegisteredTool {
	assertSafeName("outil", spec.name);
	const definition: ToolDefinition = {
		name: spec.name,
		description: spec.description,
		inputSchema: toJsonSchema(spec.inputSchema, "input"),
	};
	if (spec.title) definition.title = spec.title;
	if (spec.outputSchema) definition.outputSchema = toJsonSchema(spec.outputSchema, "output");
	if (spec.annotations) definition.annotations = spec.annotations;
	if (spec.icons) definition.icons = spec.icons;

	return {
		definition,
		inputSchema: spec.inputSchema,
		scope: spec.scope ?? "read",
		run: (args, context) => spec.handler(args as z.output<Schema>, context),
	};
}

/**
 * Registre. Immuable côté lecture : on n'expose pas les `Map` internes, pour
 * que les listes publiées restent stables et triées.
 */
export class McpRegistry {
	readonly #tools = new Map<string, RegisteredTool>();
	readonly #resources = new Map<string, ResourceSpec>();
	readonly #templates: ResourceTemplateSpec[] = [];
	readonly #prompts = new Map<string, PromptSpec>();

	addTool(tool: RegisteredTool): this {
		if (this.#tools.has(tool.definition.name)) {
			throw new Error(`Outil déjà déclaré : ${tool.definition.name}`);
		}
		this.#tools.set(tool.definition.name, tool);
		return this;
	}

	addTools(tools: Iterable<RegisteredTool>): this {
		for (const tool of tools) this.addTool(tool);
		return this;
	}

	addResource(resource: ResourceSpec): this {
		if (this.#resources.has(resource.uri)) {
			throw new Error(`Ressource déjà déclarée : ${resource.uri}`);
		}
		this.#resources.set(resource.uri, resource);
		return this;
	}

	addResources(resources: Iterable<ResourceSpec>): this {
		for (const resource of resources) this.addResource(resource);
		return this;
	}

	addTemplate(template: ResourceTemplateSpec): this {
		this.#templates.push(template);
		return this;
	}

	addPrompt(prompt: PromptSpec): this {
		assertSafeName("prompt", prompt.name);
		if (this.#prompts.has(prompt.name)) {
			throw new Error(`Prompt déjà déclaré : ${prompt.name}`);
		}
		this.#prompts.set(prompt.name, prompt);
		return this;
	}

	get tools(): RegisteredTool[] {
		return [...this.#tools.values()].sort((a, b) => a.definition.name.localeCompare(b.definition.name));
	}

	/**
	 * Outils visibles pour une portée. Un client en lecture seule ne voit
	 * même pas les outils d'écriture : ils n'apparaissent pas dans
	 * `tools/list`, ce qui évite au modèle de les proposer pour rien.
	 */
	toolsFor(scope: McpScope): RegisteredTool[] {
		return scope === "admin" ? this.tools : this.tools.filter((tool) => tool.scope === "read");
	}

	get staticResources(): ResourceSpec[] {
		return [...this.#resources.values()].sort((a, b) => a.uri.localeCompare(b.uri));
	}

	get templates(): ResourceTemplateSpec[] {
		return [...this.#templates];
	}

	get prompts(): PromptSpec[] {
		return [...this.#prompts.values()].sort((a, b) => a.name.localeCompare(b.name));
	}

	getTool(name: string): RegisteredTool | undefined {
		return this.#tools.get(name);
	}

	getResource(uri: string): ResourceSpec | undefined {
		return this.#resources.get(uri);
	}

	getPrompt(name: string): PromptSpec | undefined {
		return this.#prompts.get(name);
	}

	/** Définitions publiables des ressources statiques + celles des gabarits. */
	async listResourceDefinitions(): Promise<ResourceDefinition[]> {
		const fromStatic = this.staticResources.map<ResourceDefinition>((resource) => {
			const definition: ResourceDefinition = { uri: resource.uri, name: resource.name };
			if (resource.title) definition.title = resource.title;
			if (resource.description) definition.description = resource.description;
			if (resource.mimeType) definition.mimeType = resource.mimeType;
			if (resource.icons) definition.icons = resource.icons;
			return definition;
		});
		const fromTemplates: ResourceDefinition[] = [];
		for (const template of this.#templates) {
			if (!template.list) continue;
			fromTemplates.push(...(await template.list()));
		}
		return [...fromStatic, ...fromTemplates].sort((a, b) => a.uri.localeCompare(b.uri));
	}

	templateDefinitions(): ResourceTemplateDefinition[] {
		return this.#templates.map((template) => {
			const definition: ResourceTemplateDefinition = {
				uriTemplate: template.uriTemplate,
				name: template.name,
			};
			if (template.title) definition.title = template.title;
			if (template.description) definition.description = template.description;
			if (template.mimeType) definition.mimeType = template.mimeType;
			return definition;
		});
	}

	promptDefinitions(): PromptDefinition[] {
		return this.prompts.map((prompt) => {
			const definition: PromptDefinition = { name: prompt.name, description: prompt.description };
			if (prompt.title) definition.title = prompt.title;
			if (prompt.arguments) definition.arguments = prompt.arguments;
			return definition;
		});
	}

	/** Valide les arguments d'un outil et renvoie la valeur analysée. */
	parseToolArguments(tool: RegisteredTool, rawArguments: unknown): unknown {
		const parsed = tool.inputSchema.safeParse(rawArguments ?? {});
		if (!parsed.success) {
			throw McpError.invalidParams(
				`Arguments invalides pour l'outil « ${tool.definition.name} » : ${formatZodError(parsed.error)}`,
				{ issues: parsed.error.issues },
			);
		}
		return parsed.data;
	}
}

function formatZodError(error: z.ZodError): string {
	return error.issues
		.map((issue) => {
			const path = issue.path.length > 0 ? issue.path.join(".") : "(racine)";
			return `${path} — ${issue.message}`;
		})
		.join(" ; ");
}

/**
 * Extraction des variables d'un gabarit d'URI RFC 6570 « niveau 1 »
 * (`rg://docs/{slug}`), suffisant pour tous les gabarits que ce serveur
 * publie et sans dépendance externe.
 */
export function matchUriTemplate(template: string, uri: string): Record<string, string> | undefined {
	const names: string[] = [];
	const pattern = template.replaceAll(/\{([^}]+)\}|([^{]+)/g, (_match, variable?: string, literal?: string) => {
		if (variable !== undefined) {
			names.push(variable);
			return "([^/]+)";
		}
		return (literal ?? "").replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
	});
	const matched = new RegExp(`^${pattern}$`).exec(uri);
	if (!matched) return undefined;
	const variables: Record<string, string> = {};
	for (const [index, name] of names.entries()) {
		variables[name] = decodeURIComponent(matched[index + 1] ?? "");
	}
	return variables;
}
