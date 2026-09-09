/** Native MCP bindings for the Rust-owned IEVR wiki. */

import { z } from "zod";
import { structured, toolError } from "../protocol/types.ts";
import { defineTool, type RegisteredTool } from "../registry.ts";
import { nativeWiki, nativeWikiSearch, resolveMirrorPath } from "../wiki-native.ts";

const COLLECTIONS = [
	"characters", "skills", "items", "teams", "auras", "tactics", "passives", "quests", "shops",
	"capsules", "costumes", "stadiums", "trophies", "coaches",
] as const;
const AURA_TYPES = ["armure", "keshin", "miximax", "totem"] as const;

const searchInput = z.object({ q: z.string().min(1), limit: z.int().min(1).max(50).default(10) });
const listInput = z.object({
	collection: z.enum(COLLECTIONS),
	q: z.string().optional(),
	page: z.int().min(1).default(1),
	limit: z.int().min(1).max(200).default(25),
	auraType: z.enum(AURA_TYPES).optional(),
	category: z.string().optional(),
});
const getInput = z.object({
	collection: z.enum([...COLLECTIONS, "text"] as const),
	id: z.string().min(1),
	auraType: z.enum(AURA_TYPES).optional(),
});

function listCollection(input: z.output<typeof listInput>): unknown {
	if (input.collection === "auras" && !input.auraType) throw new Error("auraType is required for aura lists.");
	const searchable = input.collection === "characters" || ["skills", "items", "teams"].includes(input.collection);
	const result = searchable
		? nativeWikiSearch(input.q ?? "", Math.min(50, input.page * input.limit))
		: nativeWiki({
				op: input.collection,
				query: input.q,
				type_slug: input.auraType,
				category: input.category,
				page: input.page,
				limit: input.limit,
			});
	if (!Array.isArray(result)) return result;
	const start = (input.page - 1) * input.limit;
	return { data: result.slice(start, start + input.limit), total: result.length, page: input.page, limit: input.limit };
}

function getEntity(input: z.output<typeof getInput>): unknown {
	if (input.collection === "text") throw new Error("Game-text lookup belongs to the Rust VFS text service.");
	const op = input.collection === "characters" ? "character" : input.collection.slice(0, -1);
	return nativeWiki({ op, id: input.id, query: input.id, type_slug: input.auraType });
}

export function azaleeTools(): RegisteredTool[] {
	return [
		defineTool({
			name: "azalee_search",
			title: "Search the native IEVR wiki",
			description: "Search characters, skills, items, teams, and auras in the verified read-only game mirror through Rust.",
			inputSchema: searchInput,
			annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
			handler: ({ q, limit }) => structured({ q, results: nativeWikiSearch(q, limit) }),
		}),
		defineTool({
			name: "azalee_list",
			title: "List native IEVR wiki records",
			description: "List a bounded collection from the Rust wiki owner and the verified local game mirror.",
			inputSchema: listInput,
			annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
			handler: (input) => structured(listCollection(input)),
		}),
		defineTool({
			name: "azalee_get",
			title: "Read a native IEVR wiki record",
			description: "Read one character, skill, item, team, aura, tactic, passive, quest, shop, or auxiliary record through Rust.",
			inputSchema: getInput,
			annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
			handler: (input) => {
				try {
					const entity = getEntity(input);
					return entity == null ? toolError(`No record found for ${input.id}.`) : structured(entity);
				} catch (error) {
					return toolError(error instanceof Error ? error.message : String(error));
				}
			},
		}),
		defineTool({
			name: "azalee_dataset",
			title: "Inspect native wiki source health",
			description: "Return the verified local mirror selected for the Rust wiki; no cloud or external game-data source is consulted.",
			inputSchema: z.object({ dataset: z.literal("health") }),
			annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
			handler: () => structured({ mirror: resolveMirrorPath() ?? null, source: "rust-wiki-read-only-mirror" }),
		}),
	];
}
