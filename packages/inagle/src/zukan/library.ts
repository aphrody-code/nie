import fs from "node:fs";
import { join } from "node:path";
import { PATHS } from "../core/paths.js";
import type { ZukanCharacter, ZukanFormation, ZukanItem, ZukanSkill, ZukanTeam } from "./types.js";

const ZUKAN_DATA_ROOT = join(PATHS.root, "zukan");
const DB_PATH = join(ZUKAN_DATA_ROOT, "db_consolidated.json");

export class ZukanLibrary {
	private characters: ZukanCharacter[] = [];
	private skills: ZukanSkill[] = [];
	private items: ZukanItem[] = [];
	private formations: ZukanFormation[] = [];
	private teams: ZukanTeam[] = [];

	constructor() {
		this.loadData();
	}

	private loadData() {
		if (fs.existsSync(DB_PATH)) {
			this.characters = JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
			// Automatically extract zukanHash if missing
			for (const char of this.characters) {
				if (!char.zukanHash && char.detailUrl) {
					const qPart = char.detailUrl.split("q=")[1];
					if (qPart) {
						char.zukanHash = decodeURIComponent(qPart.split("&")[0]);
					}
				}
			}
		}
		const SKILLS_PATH = join(ZUKAN_DATA_ROOT, "db_skills.json");
		if (fs.existsSync(SKILLS_PATH)) {
			this.skills = JSON.parse(fs.readFileSync(SKILLS_PATH, "utf-8"));
		}
		const ITEMS_PATH = join(ZUKAN_DATA_ROOT, "db_items.json");
		if (fs.existsSync(ITEMS_PATH)) {
			this.items = JSON.parse(fs.readFileSync(ITEMS_PATH, "utf-8"));
		}
		const FORMS_PATH = join(ZUKAN_DATA_ROOT, "db_formations.json");
		if (fs.existsSync(FORMS_PATH)) {
			this.formations = JSON.parse(fs.readFileSync(FORMS_PATH, "utf-8"));
		}
		const TEAMS_PATH = join(ZUKAN_DATA_ROOT, "db_teams.json");
		if (fs.existsSync(TEAMS_PATH)) {
			this.teams = JSON.parse(fs.readFileSync(TEAMS_PATH, "utf-8"));
		}
	}

	public search(query: string, filters: Record<string, string[]> = {}): ZukanCharacter[] {
		return this.characters.filter((char) => {
			// Search by name/nickname
			const matchesQuery =
				!query ||
				char.name.toLowerCase().includes(query.toLowerCase()) ||
				char.nickname?.toLowerCase().includes(query.toLowerCase());

			if (!matchesQuery) return false;

			// Apply filters
			for (const [key, values] of Object.entries(filters)) {
				if (!values.length) continue;
				const charValue = (char as any)[key];
				if (!values.includes(charValue)) return false;
			}

			return true;
		});
	}

	public getById(id: string): ZukanCharacter | undefined {
		return this.characters.find((c) => c.id === id);
	}

	public getSkills(): ZukanSkill[] {
		return this.skills;
	}

	public searchSkills(query: string): ZukanSkill[] {
		return this.skills.filter(
			(s) =>
				s.name.toLowerCase().includes(query.toLowerCase()) ||
				s.description?.toLowerCase().includes(query.toLowerCase())
		);
	}

	public getSkillById(id: string): ZukanSkill | undefined {
		return this.skills.find((s) => s.id === id);
	}

	public getItems(category?: string): ZukanItem[] {
		if (category) {
			return this.items.filter((i) => i.category.toLowerCase() === category.toLowerCase());
		}
		return this.items;
	}

	public searchItems(query: string): ZukanItem[] {
		return this.items.filter((i) => i.name.toLowerCase().includes(query.toLowerCase()));
	}

	public getFormations(): ZukanFormation[] {
		return this.formations;
	}

	public getTeams(): ZukanTeam[] {
		return this.teams;
	}
}

export const zukanLib = new ZukanLibrary();
