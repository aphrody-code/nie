import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import * as cheerio from "cheerio";
import { CDN_URL } from "../core/paths.js";

/**
 * Loads skill video URLs from scraped Zukan HTML files in the data directory.
 * Returns a map of English Skill Name -> Video URL (WebM).
 */
export function loadSkillVideos(dataDir: string): Map<string, string> {
	const videoMap = new Map<string, string>();

	// Directories to search for skill pages
	// 1. Root data dir (legacy/flat structure)
	// 2. zukan/skill (new structure from wget/mirror)
	const searchDirs = [dataDir, join(dataDir, "zukan", "skill")];

	try {
		let _totalFiles = 0;

		for (const dir of searchDirs) {
			if (!existsSync(dir)) continue;

			// Find all HTML files that look like skill pages
			// - skills_page*.html (Legacy)
			// - index.html* (Zukan Mirror)
			const files = readdirSync(dir).filter((f) => {
				return (f.startsWith("skills_page") && f.endsWith(".html")) || f.startsWith("index.html");
			});

			for (const file of files) {
				const filePath = join(dir, file);
				if (statSync(filePath).isDirectory()) continue;

				_totalFiles++;
				const html = readFileSync(filePath, "utf-8");
				const $ = cheerio.load(html);

				$("ul.skillListBox > li").each((_, li) => {
					const nameEl = $(li).find(".nameBox .name");

					// Refined name extraction: get text node of ruby or span
					let cleanName = "";

					if (nameEl.find("ruby").length > 0) {
						// Standard, safer fallback: clone and remove RT
						const cloned = nameEl.find("ruby").clone();
						cloned.find("rt").remove();
						cloned.find("rp").remove();
						cleanName = cloned.text().trim();
					} else {
						cleanName = nameEl.text().trim();
					}

					const videoLink = $(li).find("a[data-movie-url]");
					let videoUrl = videoLink.attr("data-movie-url");

					if (cleanName && videoUrl) {
						// Resolve relative URLs to our CDN assets
						// The HTML usually has "../../k/..." or similar
						const CDN_BASE = `${CDN_URL}/zukan-assets-mirror`;

						if (videoUrl.startsWith("../..")) {
							videoUrl = videoUrl.replace("../..", CDN_BASE);
						} else if (videoUrl.startsWith("..")) {
							videoUrl = videoUrl.replace("..", CDN_BASE);
						} else if (videoUrl.startsWith("/")) {
							videoUrl = `${CDN_BASE}${videoUrl}`;
						}

						// Convert WMV to WebM (Verified: CloudFront hosts both at same hash)
						if (videoUrl.endsWith(".wmv")) {
							videoUrl = videoUrl.replace(".wmv", ".webm");
						}

						// specific hack for "???" or placeholders
						if (cleanName === "???") return;

						videoMap.set(cleanName.toLowerCase(), videoUrl);
					}
				});
			}
		}

		// if (totalFiles > 0) {
		// 	console.log(
		// 		`[VideoLoader] Loaded ${videoMap.size} skill videos from ${totalFiles} pages.`,
		// 	);
		// }
	} catch (error) {
		console.error("[VideoLoader] Error loading skill videos:", error);
	}

	return videoMap;
}
