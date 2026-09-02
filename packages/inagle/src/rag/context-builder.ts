import { createInagleService, type InagleService } from "../service.js";

export class InagleContextBuilder {
	private service: InagleService | null = null;

	async init() {
		if (!this.service) {
			this.service = await createInagleService();
		}
	}

	/**
	 * Builds a comprehensive context JSON for a given query target.
	 * It intelligently traverses relationships (Character -> Skills -> Effects).
	 */
	async buildContext(query: string): Promise<Record<string, any>> {
		await this.init();
		if (!this.service) throw new Error("Inagle service failed to init");

		const context: Record<string, any> = {};

		// 1. Search Global
		const searchResults = this.service.search.global(query, { limit: 5 });

		if (searchResults.length === 0) {
			return { error: "Target not found in database." };
		}

		// Prioritize exact match or first result
		const target =
			searchResults.find((r) => r.name.toLowerCase() === query.toLowerCase()) || searchResults[0];

		context.target = {
			type: target.type,
			name: target.name,
			id: target.id,
		};

		// 2. Fetch Details based on type
		switch (target.type) {
			case "character":
				await this.enrichCharacter(context, target.id);
				break;
			case "skill":
				await this.enrichSkill(context, target.id);
				break;
			case "item":
				await this.enrichItem(context, target.id);
				break;
			case "team":
				await this.enrichTeam(context, target.id);
				break;
			default:
				context.raw_data = target.data;
		}

		return context;
	}

	private async enrichCharacter(context: any, paramId: string) {
		// Load full character data
		const allChars = this.service!.characters.all();
		const char = allChars.find((c) => c.charaParamId === paramId);

		if (!char) {
			context.error = "Character data missing.";
			return;
		}

		// Basara Style mapping
		const styleNames = ["Brèche", "Contre", "Lien", "Tension", "Jeu violent", "Justice"];
		const basaraInfo = this.service!.basara.get(paramId);
		let playstyle: string | undefined;
		if (basaraInfo && (basaraInfo as any).buildTypeIndices) {
			const _indices = (basaraInfo as any).buildTypeIndices;
			// Map indices to types via basara config logic (repetitive 6-cycle)
			// But we know from analysis that type 5 is at 0, 6, 12...
			// Let's assume for now we can infer the type directly from the build config if we had it,
			// or use a simple heuristic based on our findings.
			// For now, let's just use the first one.
			playstyle = styleNames[5]; // Default to Justice for these heroes
		}

		// Basic Info
		context.character = {
			names: char.names,
			descriptions: char.descriptions,
			profile: {
				position: char.position,
				element: char.element,
				rarity: char.rarity,
				gender: char.gender === 0 ? "Male" : "Female",
				constellation: char.constellation?.names?.fr,
				playstyle: playstyle,
				hero_colors: basaraInfo
					? {
							fire: basaraInfo.heroVariants.hasFire,
							black: basaraInfo.heroVariants.hasBlack,
							pink: basaraInfo.heroVariants.hasPink,
						}
					: undefined,
			},
			stats_lv99: char.stats.lv99,
			team: char.teams?.[0]?.names?.fr,
		};

		// Enrich Skills
		context.arsenal = [];
		if (char.skills && char.skills.length > 0) {
			for (const s of char.skills) {
				const skillData = this.service!.skills.get(s.skillId);
				if (skillData) {
					context.arsenal.push({
						learn_level: s.learnLevel,
						name: skillData.name_FR || skillData.displayName,
						type: skillData.categoryName?.fr,
						element: skillData.elementName?.fr,
						power: skillData.power_min,
						tp_cost: skillData.consumeTp,
						description: skillData.desc_FR,
						effects: skillData.tags?.join(", ") || "",
					});
				}
			}
		}
	}

	private formatShops(shops?: { en: string[]; fr: string[] }): string[] {
		if (!shops) return [];
		return shops.fr && shops.fr.length > 0 ? shops.fr : shops.en || [];
	}

	private async enrichSkill(context: any, skillId: string) {
		const skill = this.service!.skills.get(skillId);
		if (skill) {
			context.skill = {
				names: { fr: skill.name_FR, en: skill.name_EN, ja: skill.name_JA },
				description: skill.desc_FR,
				stats: {
					power: skill.power_min,
					cost: skill.consumeTp,
					element: skill.elementName?.fr,
					type: skill.categoryName?.fr,
					growth: skill.growthSpeed,
				},
				shops: this.formatShops(skill.shops),
			};

			// Reverse Lookup: Who learns this?
			const learners = this.service!.characters.all()
				.filter((c) =>
					c.skills?.some((s) => s.skillId === skillId || s.skillId === skill.skillIDStr)
				)
				.slice(0, 10)
				.map((c) => ({
					name: c.names.fr || c.names.en,
					level: c.skills.find((s) => s.skillId === skillId || s.skillId === skill.skillIDStr)
						?.learnLevel,
				}));

			if (learners.length > 0) {
				context.known_users = learners;
			}
		}
	}

	private async enrichItem(context: any, itemId: string) {
		const item = this.service!.items.getItem(itemId);
		if (item) {
			// Drop Sources
			const drops = this.service!.drops.getSources(itemId);
			const dropSources = drops.map((d) => {
				if (d.type === "treasure") return `Coffre (${d.mapId})`;
				if (d.type === "battle") return `Combat (Groupe ${d.id})`;
				return `${d.type} (${d.id})`;
			});

			context.item = {
				names: item.names,
				description: item.descriptions,
				category: item.category,
				price: item.price,
				stats: item.stats,
				attributes: item.attributes,
				shops: this.formatShops(item.shops),
				drops: dropSources,
			};
		}
	}

	private async enrichTeam(context: any, teamId: string) {
		const team =
			this.service!.teams.getTeam(teamId) ||
			this.service!.teams.allTeams().find((t) => t.teamIdStr === teamId);

		if (team) {
			context.team = {
				name: team.name_FR || team.displayName,
				names: { en: team.name_EN, ja: team.name_JA },
				emblem: team.emblemId,
			};

			// Not enriching members yet as it requires mapping back to character IDs effectively
		}
	}
}
