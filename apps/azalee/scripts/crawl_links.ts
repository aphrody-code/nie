import * as cheerio from "cheerio";

const BASE_URL = "http://127.0.0.1:3003";

async function crawl() {
	const visited = new Set<string>();
	const queue: string[] = [BASE_URL];

	console.log("Starting recursive crawl of Azalée...");

	while (queue.length > 0) {
		const url = queue.shift()!;
		if (visited.has(url)) continue;
		visited.add(url);

		console.log(`Fetching: ${url}`);
		try {
			const res = await fetch(url);
			if (!res.ok) {
				console.log(`Failed to fetch ${url} (status ${res.status})`);
				continue;
			}
			const html = await res.text();
			const $ = cheerio.load(html);

			$("a").each((i, el) => {
				const href = $(el).attr("href");
				if (href) {
					// Resolve relative links
					let resolvedUrl = href;
					if (href.startsWith("/")) {
						resolvedUrl = BASE_URL + href;
					}

					// Only crawl links on the same host
					if (resolvedUrl.startsWith(BASE_URL)) {
						// Clean URL (remove hash and query params)
						const cleanUrl = resolvedUrl.split("#")[0].split("?")[0].replace(/\/$/, "");
						if (cleanUrl && !visited.has(cleanUrl) && !queue.includes(cleanUrl)) {
							// Avoid crawling dynamic items deeply (like 1000s of charas or skills)
							// We only want directory-level pages and some examples
							const isDeepChara = cleanUrl.includes("/chara/") && cleanUrl.split("/chara/")[1]?.includes("-");
							const isDeepSkill = cleanUrl.includes("/skill/") && cleanUrl.split("/skill/")[1]?.length > 5;
							const isDeepItem = cleanUrl.includes("/item/") && cleanUrl.split("/item/")[1]?.length > 5;
							const isDeepAura = cleanUrl.includes("/aura/") && cleanUrl.split("/aura/")[1]?.length > 5;
							const isDeepTactic = cleanUrl.includes("/tactic/") && cleanUrl.split("/tactic/")[1]?.length > 5;
							const isDeepQuest = cleanUrl.includes("/quete/") && cleanUrl.split("/quete/")[1]?.length > 5;
							const isDeepTrophy = cleanUrl.includes("/succes/") && cleanUrl.split("/succes/")[1]?.length > 5;
							const isDeepStade = cleanUrl.includes("/stade/") && cleanUrl.split("/stade/")[1]?.length > 5;
							const isDeepShop = cleanUrl.includes("/boutique/") && cleanUrl.split("/boutique/")[1]?.length > 5;
							const isDeepPassive = cleanUrl.includes("/passive/") && cleanUrl.split("/passive/")[1]?.length > 5;
							const isDeepCoach = cleanUrl.includes("/entraineur/") && cleanUrl.split("/entraineur/")[1]?.length > 0;

							if (isDeepChara && !cleanUrl.includes("mark-evans")) return;
							if (isDeepSkill && !cleanUrl.includes("whd00010")) return;
							if (isDeepItem && !cleanUrl.includes("0x5F0F1EAC")) return;
							if (isDeepAura && !cleanUrl.includes("keshin_0x8CEAA470")) return;
							if (isDeepTactic && !cleanUrl.includes("0x790F3F39")) return;
							if (isDeepQuest && !cleanUrl.includes("0x8933A62B")) return;
							if (isDeepTrophy && !cleanUrl.includes("activity_story_miniquest_006")) return;
							if (isDeepStade && !cleanUrl.includes("0x2FF907D4")) return;
							if (isDeepShop && !cleanUrl.includes("1526934762")) return;
							if (isDeepPassive && !cleanUrl.includes("0xE0BC6774")) return;
							if (isDeepCoach && !cleanUrl.includes("1")) return;

							// Avoid static files or API routes
							if (cleanUrl.includes("/api/") || cleanUrl.endsWith(".png") || cleanUrl.endsWith(".jpg") || cleanUrl.endsWith(".webp")) {
								return;
							}

							queue.push(cleanUrl);
						}
					}
				}
			});
		} catch (error) {
			console.error(`Error fetching ${url}:`, error);
		}
	}

	console.log("\n--- Crawl completed! ---");
	console.log(`Found ${visited.size} unique URL paths:`);
	const sorted = Array.from(visited).sort();
	for (const url of sorted) {
		console.log(url);
	}
}

crawl().catch(console.error);
