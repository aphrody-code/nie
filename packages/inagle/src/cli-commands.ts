import type { Command } from "commander";
import pc from "picocolors";
import { ITEM_CATEGORY_NAMES } from "./items/api.js";
import { createInagleService } from "./service.js";

// === STATS COMMAND ===
export function registerStatsCommand(program: Command) {
	program
		.command("stats")
		.description("Show database statistics")
		.action(async () => {
			console.log(pc.cyan("Loading Inagle Service..."));
			const service = await createInagleService();

			console.log(pc.bold("\n📊 Database Statistics"));
			console.log(pc.dim("--------------------------------"));

			const chars = service.characters.meta;
			console.log(pc.blue("Characters:"), pc.bold(chars.totalCharacters));
			console.log(pc.dim(`  - With Stats: ${chars.stats.withNameFR}`));

			const skills = service.skills.all();
			console.log(pc.green("Skills:"), pc.bold(skills.length));

			const items = service.items.allItems();
			console.log(pc.yellow("Items:"), pc.bold(items.length));

			const teams = service.teams.allTeams();
			console.log(pc.magenta("Teams:"), pc.bold(teams.length));
		});
}

// === SEARCH COMMAND ===
export function registerSearchCommand(program: Command) {
	program
		.command("search <query>")
		.description("Search across all databases")
		.option("-l, --limit <number>", "Limit results", "5")
		.action(async (query, options) => {
			const service = await createInagleService();
			const results = service.search.global(query, { limit: parseInt(options.limit, 10) });

			if (results.length === 0) {
				console.log(pc.red("No results found."));
				return;
			}

			const characters = results.filter((r) => r.type === "character");
			const skills = results.filter((r) => r.type === "skill");
			const items = results.filter((r) => r.type === "item");

			if (characters.length > 0) {
				console.log(pc.bold(pc.blue("\nCharacters")));
				characters.forEach((r) => {
					const c = r.data as any;
					console.log(
						`  ${pc.bold(c.names?.fr || c.names?.en || "???")} ${pc.dim(`(${c.rarity})`)} - ${c.position} ${c.element}`
					);
				});
			}

			if (skills.length > 0) {
				console.log(pc.bold(pc.green("\nSkills")));
				skills.forEach((r) => {
					const s = r.data as any;
					// For GlobalSearch result 's', it might be different structure.
					// But usually it matches EnrichedSkill or similar.
					// Let's use generic access or assume it's EnrichedSkill-like.
					const name = s.name_FR || s.displayName || s.names?.fr || "???";
					const cost = s.consumeTp ?? s.stats?.tensionCost ?? "?";
					console.log(`  ${pc.bold(name)} ${pc.dim(`(${cost} TP)`)}`);
				});
			}

			if (items.length > 0) {
				console.log(pc.bold(pc.yellow("\nItems")));
				items.forEach((r) => {
					const i = r.data as any;
					console.log(`  ${pc.bold(i.names?.fr || i.names?.en || "???")}`);
				});
			}
		});
}

// === CHARACTER COMMAND ===
export function registerCharacterCommand(program: Command) {
	program
		.command("character <name>")
		.alias("char")
		.description("Find a character by name")
		.action(async (name) => {
			const service = await createInagleService();
			const results = service.characters.search(name, { limit: 5 });

			if (results.length === 0) {
				console.log(pc.red("Character not found."));
				return;
			}

			results.forEach((char) => {
				console.log(pc.dim("--------------------------------"));
				console.log(pc.bold(pc.cyan(char.names.fr || char.names.en || "Unknown Name")));
				console.log(`ID: ${pc.dim(char.charaId)} / ParamID: ${pc.dim(char.charaParamId)}`);
				console.log(`Rarity: ${pc.yellow(char.rarity)} (Code: ${char.rarityCode})`);
				console.log(`Position: ${char.position} / Element: ${char.element}`);

				// Images
				const face = service.images.face(char.charaId);
				if (face) console.log(`Image: ${pc.dim(face)}`);

				if (char.teams && char.teams.length > 0) {
					console.log(`Team: ${char.teams[0].names.fr || "None"}`);
				}

				if (char.stats?.lv99) {
					const s = char.stats.lv99;
					console.log(
						`Stats (Lv99): K${s.kick} C${s.control} T${s.technique} P${s.physical} S${s.agility} G${s.intelligence}`
					);
				}
				if (char.series) console.log(`Series: ${char.series}`);
			});
		});
}

// === ITEMS COMMAND ===
export function registerItemsCommand(program: Command) {
	const items = program.command("items").description("Explore items database");

	items
		.command("list")
		.description("List items (optional filter by category)")
		.option("-c, --category <category>", "Filter by category (e.g. shoes, consume)")
		.option("-l, --limit <number>", "Limit results", "20")
		.action(async (options) => {
			const service = await createInagleService();
			let results = service.items.allItems();

			if (options.category) {
				results = service.items.byCategory(options.category as any);
				if (results.length === 0) {
					console.log(pc.red(`Invalid category or no items found for '${options.category}'.`));
					console.log("Valid categories:", Object.keys(ITEM_CATEGORY_NAMES).join(", "));
					return;
				}
			}

			console.log(pc.bold(`\nFound ${results.length} items`));
			const limit = parseInt(options.limit, 10);

			results.slice(0, limit).forEach((item) => {
				const name = item.names?.fr || item.names?.en || "???";
				const cat = item.category;
				console.log(`  ${pc.yellow(item.itemId)}: ${pc.bold(name)} ${pc.dim(`(${cat})`)}`);
			});

			if (results.length > limit) {
				console.log(pc.dim(`... and ${results.length - limit} more.`));
			}
		});

	items
		.command("find <query>")
		.description("Search items by name")
		.action(async (query) => {
			const service = await createInagleService();
			const results = service.items.searchItems(query);

			if (results.length === 0) {
				console.log(pc.red("No items found."));
				return;
			}

			results.forEach((item) => {
				const name = item.names?.fr || item.names?.en || "???";
				const desc = item.descriptions?.fr || item.descriptions?.en || "";

				console.log(pc.dim("--------------------------------"));
				console.log(`${pc.bold(pc.yellow(name))} ${pc.dim(`(${item.itemId})`)}`);
				console.log(`Category: ${item.category}`);
				if (desc) console.log(pc.italic(desc));

				const imgId = item.internalCode || item.itemId;
				const img = service.images.item(imgId);
				if (img) console.log(`Image: ${pc.dim(img)}`);
			});
		});
}

// === SKILLS COMMAND ===
export function registerSkillsCommand(program: Command) {
	const skills = program.command("skills").description("Explore skills database");

	skills
		.command("find <query>")
		.description("Search skills by name")
		.action(async (query) => {
			const service = await createInagleService();
			const results = service.skills.search(query);

			if (results.length === 0) {
				console.log(pc.red("No skills found."));
				return;
			}

			results.forEach((skill) => {
				const name = skill.name_FR || skill.displayName || "???";
				console.log(pc.dim("--------------------------------"));
				const code = skill.internalCode || skill.skillIDStr || "???";
				console.log(`${pc.bold(pc.green(name))} ${pc.dim(`(${code})`)}`);

				// Use flat properties from EnrichedSkill (SkillInfo)
				const cost = skill.consumeTp || 0;
				const min = skill.power_min || 0;
				const max = skill.power_max || 0;
				console.log(`Cost: ${cost} TP / Power: ${min}-${max}`);

				// Use elementName object
				console.log(`Element: ${skill.elementName?.fr || skill.elementName?.en || "???"}`);

				if (skill.desc_FR) console.log(pc.italic(skill.desc_FR));

				if (code && code !== "???") {
					const img = service.images.skill(code);
					if (img) console.log(`Image: ${pc.dim(img)}`);
				}
			});
		});
}

// === TEAMS COMMAND ===
export function registerTeamsCommand(program: Command) {
	const teams = program.command("teams").description("Explore teams database");

	teams
		.command("list")
		.description("List all teams")
		.action(async () => {
			const service = await createInagleService();
			const all = service.teams.allTeams();

			console.log(pc.bold(`\nFound ${all.length} teams`));
			all.forEach((team) => {
				const name = team.name || team.displayName || "???";
				console.log(`  ${pc.magenta(team.teamIdStr)}: ${pc.bold(name)}`);
			});
		});

	teams
		.command("get <id>")
		.description("Get team details by ID")
		.action(async (id) => {
			const service = await createInagleService();
			const team = service.teams.getTeam(id);

			if (!team) {
				console.log(pc.red("Team not found."));
				return;
			}

			const name = team.name || team.displayName || "???";
			console.log(pc.bold(`\n${name} (${team.teamIdStr})`));
			if (team.emblemId) {
				const img = service.images.emblem(team.emblemId.toString());
				if (img) console.log(`Emblem: ${pc.dim(img)}`);
			}
		});
}
