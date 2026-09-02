import fs from "node:fs";
import * as cheerio from "cheerio";
import type {
	GameKey,
	ZukanCharacter,
	ZukanCharacterRole,
	ZukanElementType,
	ZukanFormation,
	ZukanGenderType,
	ZukanItem,
	ZukanPositionType,
	ZukanSkill,
	ZukanSkillVideo,
	ZukanTeam,
} from "./types.js";
import { GAME_KEYS, GAME_TO_SERIES } from "./types.js";

const _DATA_ROOT = "data/zukan";

/**
 * Maps Zukan Japanese/English terms to our internal types
 */
const MAPS = {
	element: {
		風: "Wind",
		Wind: "Wind",
		林: "Forest",
		Forest: "Forest",
		火: "Fire",
		Fire: "Fire",
		山: "Mountain",
		Mountain: "Mountain",
		無: "Void",
		Void: "Void",
	} as Record<string, ZukanElementType>,
	position: {
		GK: "GK",
		DF: "DF",
		MF: "MF",
		FW: "FW",
	} as Record<string, ZukanPositionType>,
	gender: {
		男: "Male",
		Male: "Male",
		女: "Female",
		Female: "Female",
		不明: "Unknown",
		Unknown: "Unknown",
		両性: "Neutral",
		Neutral: "Neutral",
	} as Record<string, ZukanGenderType>,
	role: {
		Player: "Player",
		選手: "Player",
		Coordinator: "Coordinator",
		Manager: "Manager",
		Coach: "Coach",
		監督: "Coach",
	} as Record<string, ZukanCharacterRole>,
};

/**
 * Normalizes an image path to absolute URL or assets path
 */
const CDN_ROOT = "https://dxi4wb638ujep.cloudfront.net/1";

/**
 * Normalise un chemin d'asset zukan en URL absolue.
 *
 * L'extension `.wmv` annoncée par le site est SYSTÉMATIQUEMENT servie en 403 par
 * CloudFront. Le même hash existe en `.webm` (200 sur 100 % du catalogue mesuré)
 * et pèse la moitié du `.mp4` : c'est donc `.webm` qu'on stocke et qu'on sert.
 */
/** `.wmv` -> `.webm` : même chemin/hash, seule extension réellement servie. */
function swapWmv(url: string): string {
	return url.endsWith(".wmv") ? `${url.slice(0, -4)}.webm` : url;
}

export function normalizeImagePath(src: string | null): string | null {
	if (!src) return null;

	if (src.startsWith("http")) return swapWmv(src);

	// Cleanup path
	const normalized = swapWmv(src.replace(/^(\.\.\/)+/, ""));

	return `${CDN_ROOT}/${normalized}`;
}

/**
 * Parses a character list page (chara_list)
 */
export async function parseCharacterListPage(filePath: string): Promise<ZukanCharacter[]> {
	const html = fs.readFileSync(filePath, "utf-8");
	const $ = cheerio.load(html);
	const characters: ZukanCharacter[] = [];

	$("tbody").each((_, tbody) => {
		const row = $(tbody).find("tr").first();
		const checkbox = row.find("input.my-team-checkbox");

		if (!checkbox.length) return;

		const name = checkbox.attr("data-chara-name") || "";
		const nickname = checkbox.attr("data-nickname") || null;

		const cells = row.find("td");

		// Position/Element/Gender are often in specific cell indexes
		// Note: zukan.inazuma.jp uses a large table with many hidden columns
		const genderNode = cells.eq(5).text().trim();
		const elementNode = cells.eq(6).text().trim();
		const positionNode = cells.eq(7).text().trim();
		const roleNode = cells.eq(8).text().trim();
		const ageGroupNode = cells.eq(9).text().trim();
		const schoolYearNode = cells.eq(10).text().trim();
		const teamNode = cells.eq(11).text().trim();

		// Higher fidelity image extraction
		const picture = row.find("picture");
		let imageSource = null;
		if (picture.length) {
			imageSource =
				picture.find('source[type="image/webp"]').attr("srcset") || picture.find("img").attr("src");
		}

		if (!imageSource) {
			imageSource =
				row.find('img[src*="/k/"]').attr("src") || row.find('img[src*="prd/assets"]').attr("src");
		}

		const image = normalizeImagePath(imageSource || null);

		const link = row.find('a[href*="chara_param"]');
		const detailUrl = link.attr("href") || null;

		let id = checkbox.attr("data-chara-id") || "";
		if (!id && detailUrl) {
			// Fallback to q parameter if data-chara-id is missing
			const match = detailUrl.match(/[?&]q=([^&]+)/);
			if (match) {
				id = `q:${match[1]}`;
			}
		}

		// Game appearances — 9 columns (ie1..vic) in second <tr> or colspan=9
		const _allRows = $(tbody).find("tr");
		const gameAppearances: GameKey[] = [];

		// Check across all rows for appeared works
		const colspanCell = $(tbody).find("td[colspan='9']");
		if (colspanCell.length > 0) {
			// Single-game character — td colspan="9" contains the game title
			const gameLabel = colspanCell.text().trim();
			const key = (Object.entries(GAME_TO_SERIES) as [GameKey, string][]).find(([, v]) => {
				if (v === "Inazuma Eleven" && gameLabel === "Inazuma Eleven") return true;
				if (v === "Inazuma Eleven 2" && gameLabel.startsWith("Inazuma Eleven 2")) return true;
				if (v === "Inazuma Eleven 3" && gameLabel.startsWith("Inazuma Eleven 3")) return true;
				if (v === "Inazuma Eleven GO" && gameLabel.startsWith("Inazuma Eleven GO: Light"))
					return true;
				if (v === "Chrono Stone" && gameLabel.includes("Chrono Stone")) return true;
				if (v === "Galaxy" && gameLabel.includes("Galaxy")) return true;
				if (v === "Ares" && gameLabel.includes("Ares")) return true;
				if (v === "Orion" && gameLabel.includes("Orion")) return true;
				if (v === "Victory Road" && gameLabel.includes("Victory Road")) return true;
				return false;
			})?.[0];
			if (key) gameAppearances.push(key);
		} else {
			// Multi-game character — 9 td.appearedWorks cells with ○/×
			$(tbody)
				.find("td.appearedWorks")
				.each((i, cell) => {
					if ($(cell).text().trim() === "○" && i < GAME_KEYS.length) {
						gameAppearances.push(GAME_KEYS[i]);
					}
				});
		}

		characters.push({
			id,
			name,
			nickname,
			image,
			detailUrl,
			gender: MAPS.gender[genderNode] || "Unknown",
			element: MAPS.element[elementNode] || "Unknown",
			position: MAPS.position[positionNode] || null,
			rarity: null,
			schoolYear: schoolYearNode || null,
			ageGroup: ageGroupNode || null,
			team: teamNode || null,
			role: MAPS.role[roleNode] || "Player",
			gameAppearances: gameAppearances.length > 0 ? gameAppearances : undefined,
		});
	});

	return characters;
}

/**
 * Parses a character detail page (chara_param)
 */
export async function parseCharacterDetailPage(filePath: string): Promise<Partial<ZukanCharacter>> {
	if (!fs.existsSync(filePath)) return {};
	const html = fs.readFileSync(filePath, "utf-8");
	const $ = cheerio.load(html);

	const stats: any = {};
	$(".param li").each((_, li) => {
		const label = $(li).find("dt").text().trim().toLowerCase();
		const valueText = $(li).find("td").text().trim();
		const value = parseInt(valueText, 10);

		if (Number.isNaN(value)) return;

		if (label.includes("kick")) stats.kick = value;
		if (label.includes("control")) stats.control = value;
		if (label.includes("technique")) stats.technique = value;
		if (label.includes("pressure")) stats.pressure = value;
		if (label.includes("physical")) stats.physical = value;
		if (label.includes("agility")) stats.agility = value;
		if (label.includes("intelligence")) stats.intelligence = value;
	});

	const basicInfo: any = {};

	// Extract from basic info list
	$(".basic dl").each((_, dl) => {
		const label = $(dl).find("dt").text().trim().toLowerCase();
		const value = $(dl).find("dd").text().trim();

		if (label.includes("age group")) basicInfo.ageGroup = value;
		if (label.includes("school year")) basicInfo.schoolYear = value;
		if (label.includes("gender")) basicInfo.gender = value;
		if (label.includes("character role")) basicInfo.role = value;
	});

	// Extract from params list (including Position/Element)
	$(".param dl").each((_, dl) => {
		const label = $(dl).find("dt").text().trim().toLowerCase();
		const value = $(dl).find("dd").text().trim();

		if (label === "position") basicInfo.position = MAPS.position[value] || value;
		if (label === "element") basicInfo.element = MAPS.element[value] || value;

		// Victory Road Stats
		const statsValue = parseInt($(dl).find("td").text().trim(), 10);
		if (!Number.isNaN(statsValue)) {
			if (label.includes("kick")) stats.kick = statsValue;
			if (label.includes("control")) stats.control = statsValue;
			if (label.includes("technique")) stats.technique = statsValue;
			if (label.includes("pressure")) stats.pressure = statsValue;
			if (label.includes("physical")) stats.physical = statsValue;
			if (label.includes("agility")) stats.agility = statsValue;
			if (label.includes("intelligence")) stats.intelligence = statsValue;
		}
	});

	const modelViewerUrl = $(".verLink").attr("href") || undefined;
	const description = $(".description").first().text().trim();
	const howToObtain = $(".getTxt .question").text().trim();

	return {
		stats: Object.keys(stats).length ? stats : undefined,
		description: description || undefined,
		howToObtain: howToObtain || undefined,
		modelViewerUrl,
		...basicInfo,
	};
}

/**
 * Parses a character model viewer page (chara_model_view) to get the modelId
 */
export async function parseCharacterModelPage(filePath: string): Promise<{ modelId?: string }> {
	if (!fs.existsSync(filePath)) return {};
	const html = fs.readFileSync(filePath, "utf-8");
	const $ = cheerio.load(html);

	const selectedOption = $("#character-select option[selected]");
	const modelId = selectedOption.attr("value");

	return { modelId };
}

/**
 * Parse le HTML d'une page de liste de techniques (`/{locale}/skill/`).
 *
 * Le HTML est rendu côté serveur : un `fetch()` statique suffit, aucun navigateur
 * headless n'est nécessaire ici (contrairement à `chara_param`).
 *
 * Une technique peut exposer PLUSIEURS vidéos dans son `.btnBox` (236 sur 895
 * en ont deux) : on les collecte TOUTES, avec le libellé du bouton comme
 * variante. `figure.movie` ne sert que de repli — son lien duplique la première
 * entrée du `.btnBox`.
 */
export function parseSkillListHtml(html: string): ZukanSkill[] {
	const $ = cheerio.load(html);
	const skills: ZukanSkill[] = [];

	$(".skillListBox > li").each((_, li) => {
		const name = $(li).find(".nameBox .name").text().trim();
		const lBox = $(li).find(".lBox.skillLbox");

		// Toutes les variantes vidéo du `.btnBox` (1 ou 2), repli sur `figure.movie`.
		const btnLinks = lBox.find(".btnBox a[data-movie-url]");
		const movieLinks = btnLinks.length ? btnLinks : lBox.find("figure.movie a[data-movie-url]");

		const videos: ZukanSkillVideo[] = [];
		movieLinks.each((position, a) => {
			const el = $(a);
			const videoUrl = normalizeImagePath(el.attr("data-movie-url") || null);
			if (!videoUrl) return;
			videos.push({
				label: el.text().trim() || "Movie",
				position,
				posterUrl: normalizeImagePath(el.attr("data-poster-url") || null),
				videoUrl,
			});
		});

		const primary = videos[0] ?? null;
		const videoUrl = primary?.videoUrl ?? null;
		const posterUrl = primary?.posterUrl ?? null;

		// Type (libellé du premier bouton, ex. "Defence")
		const type = primary?.label ?? "Unknown";

		// Image/Thumbnail
		const picture = lBox.find("picture");
		const thumbnailUrl = normalizeImagePath(
			picture.find('source[type="image/webp"]').attr("srcset") ||
				picture.find("img").attr("src") ||
				null
		);

		// Description
		const description = $(li).find(".rBox .description").text().trim();

		// ID Generation
		// Use video filename if available (it acts as a unique ID from AWS/CloudFront), otherwise name slug
		let id = "";
		if (videoUrl) {
			const parts = videoUrl.split("/");
			const filename = parts[parts.length - 1];
			if (filename) {
				id = filename.split(".")[0] || "unknown";
			} else {
				id = name.toLowerCase().replace(/[^a-z0-9]/g, "_");
			}
		} else {
			id = name.toLowerCase().replace(/[^a-z0-9]/g, "_");
		}

		if (name && name !== "???") {
			skills.push({
				id,
				name,
				type,
				description,
				element: null,
				videoUrl,
				posterUrl,
				thumbnailUrl,
				videos,
			});
		}
	});

	return skills;
}

/**
 * Parses a skill list page
 */
export async function parseSkillListPage(filePath: string): Promise<ZukanSkill[]> {
	return parseSkillListHtml(fs.readFileSync(filePath, "utf-8"));
}

/**
 * Parses an item list page
 */
export async function parseItemPage(filePath: string): Promise<ZukanItem[]> {
	const html = fs.readFileSync(filePath, "utf-8");
	const $ = cheerio.load(html);
	const items: ZukanItem[] = [];

	// Try to determine category from the header
	const category = $(".searchParamBox h4").text().trim() || "Unknown";

	$(".itemListBox > li").each((_, li) => {
		// Name is inside .detailBox > .name, not .nameBox
		const name =
			$(li).find(".detailBox .name ruby").text().trim() ||
			$(li).find(".detailBox .name").text().trim();
		if (!name) return;

		const picture = $(li).find("figure.item picture");
		let imageUrl =
			picture.find('source[type="image/webp"]').attr("srcset") ||
			picture.find("img").attr("src") ||
			null;

		imageUrl = normalizeImagePath(imageUrl);

		const id = name.toLowerCase().replace(/[^a-z0-9]/g, "_");

		items.push({
			id,
			name,
			category,
			imageUrl,
		});
	});

	return items;
}

/**
 * Parses a formation page
 */
export async function parseFormationPage(filePath: string): Promise<ZukanFormation[]> {
	const html = fs.readFileSync(filePath, "utf-8");
	const $ = cheerio.load(html);
	const formations: ZukanFormation[] = [];

	$(".formationList > li").each((_, li) => {
		const name = $(li).find("dl > dt").text().trim();
		if (!name) return;

		const positions: { left: string; top: string }[] = [];
		$(li)
			.find(".position-marker-wrapper")
			.each((_, marker) => {
				const style = $(marker).attr("style") || "";
				// Extract left: X%; top: Y%;
				const leftMatch = style.match(/left:\s*([\d.]+%?)/);
				const topMatch = style.match(/top:\s*([\d.]+%?)/);

				if (leftMatch?.[1] && topMatch?.[1]) {
					positions.push({
						left: leftMatch[1],
						top: topMatch[1],
					});
				}
			});

		const id = name.toLowerCase().replace(/[^a-z0-9]/g, "_");

		formations.push({
			id,
			name,
			positions,
		});
	});

	return formations;
}

/**
 * Parses a team info page (mostly for the filter list)
 */
export async function parseTeamPage(filePath: string): Promise<ZukanTeam[]> {
	const html = fs.readFileSync(filePath, "utf-8");
	const $ = cheerio.load(html);
	const teams: ZukanTeam[] = [];

	$('select[name="team_filter"] option').each((_, option) => {
		const jpName = $(option).attr("value");
		const enName = $(option).text().trim();

		if (jpName && enName) {
			teams.push({
				id: jpName, // Use Japanese name as ID since it seems consistent across regions? Or parsing artifact.
				name: enName,
				emblemUrl: null,
			});
		}
	});

	return teams;
}
