/**
 * Hono adapter with OpenAPI documentation
 *
 * Provides a universal HTTP API that can run on:
 * - Node.js / Bun / Deno
 * - Cloudflare Workers / AWS Lambda / Vercel Edge
 * - Next.js Route Handlers
 */

import type { ItemCategory } from "../parsers/item-config.js";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createInagleService } from "../service.js";

/**
 * Create Hono app with game data API
 */
export async function createInagleAppAsync() {
	const app = new Hono();

	// Initialize Service (Async)
	const service = await createInagleService();
	const { basara, characters, skills, teams, items, quests, drops, search } = service;

	// CORS
	app.use("*", cors());

	// Root / Info
	app.get("/", (c) => {
		return c.json({
			name: "@rosegriffon/inagle",
			version: "0.3.0",
			description: "Universal Game Data API for Inazuma Eleven: Victory Road",
			stats: {
				basara: basara.meta.totalCount,
				characters: characters.meta.totalCharacters,
				skills: skills.meta.totalSkills,
				teams: teams.allTeams().length,
				items: items.meta.stats.totalItems,
				quests: quests.meta.totalQuests,
			},
		});
	});

	// BASARA
	app.get("/basara", (c) => c.json({ data: basara.all() }));
	app.get("/basara/:id", (c) => {
		const id = c.req.param("id");
		const char = basara.get(id) || basara.getByCode(id);
		return char ? c.json(char) : c.json({ error: "Not found" }, 404);
	});

	// CHARACTERS
	app.get("/characters", (c) => {
		const limit = Math.min(Number(c.req.query("limit")) || 50, 500);
		const offset = Number(c.req.query("offset")) || 0;
		const chars = characters.all();
		return c.json({
			total: chars.length,
			data: chars.slice(offset, offset + limit),
		});
	});

	app.get("/characters/:id", (c) => {
		const id = c.req.param("id");
		const char = characters.get(id) || characters.getByCode(id);
		return char ? c.json(char) : c.json({ error: "Not found" }, 404);
	});

	// SKILLS
	app.get("/skills", (c) => {
		const limit = Math.min(Number(c.req.query("limit")) || 50, 500);
		const offset = Number(c.req.query("offset")) || 0;
		const all = skills.all();
		return c.json({
			total: all.length,
			data: all.slice(offset, offset + limit),
		});
	});

	// SEARCH
	app.get("/search", (c) => {
		const q = c.req.query("q");
		if (!q) return c.json({ error: "Missing query param q" }, 400);
		const results = search.global(q);
		return c.json({ data: results });
	});

	// ITEMS
	app.get("/items", (c) => {
		const limit = Math.min(Number(c.req.query("limit")) || 50, 500);
		const offset = Number(c.req.query("offset")) || 0;
		const cat = c.req.query("category");
		const data = cat ? items.byCategory(cat as ItemCategory) : items.allItems();
		return c.json({
			total: data.length,
			data: data.slice(offset, offset + limit),
		});
	});
	app.get("/items/:id", (c) => {
		const id = c.req.param("id");
		const item = items.getItem(id);
		return item ? c.json(item) : c.json({ error: "Not found" }, 404);
	});

	// QUESTS
	app.get("/quests", (c) => {
		const limit = Math.min(Number(c.req.query("limit")) || 50, 500);
		const offset = Number(c.req.query("offset")) || 0;
		const phase = c.req.query("phase");
		const data = phase ? quests.byPhase(Number(phase)) : quests.all();
		return c.json({
			total: data.length,
			data: data.slice(offset, offset + limit),
		});
	});
	app.get("/quests/:id", (c) => {
		const id = c.req.param("id");
		const quest = quests.get(id);
		return quest ? c.json(quest) : c.json({ error: "Not found" }, 404);
	});

	// DROPS
	app.get("/drops/:itemId", (c) => {
		const id = c.req.param("itemId");
		const sources = drops.getSources(id);
		return c.json({ data: sources });
	});

	return app;
}

export type InagleApp = Awaited<ReturnType<typeof createInagleAppAsync>>;
