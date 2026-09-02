import { Browser, Page } from "@aphrody-code/bxc";
import fs from "node:fs";
import { join } from "node:path";

async function main() {
	console.log("[Scrape Skills] Starting browser...");
	const page = (await Browser.newPage({
		profile: "stealth",
	})) as Page;

	const destDir = "/home/ubuntu/rg/packages/inagle/data/zukan/skill";
	if (!fs.existsSync(destDir)) {
		fs.mkdirSync(destDir, { recursive: true });
	}

	for (let pageNum = 1; pageNum <= 5; pageNum++) {
		const url = `https://zukan.inazuma.jp/en/skill/?page=${pageNum}&per_page=200`;
		console.log(`[Scrape Skills] Navigating to page ${pageNum} : ${url}`);
		
		try {
			await page.goto(url);
			// Wait for the skillListBox to render
			await page.waitForSelector("ul.skillListBox", 15000).catch(() => {});
			
			// Wait a bit for the content to fully load/render
			await new Promise((r) => setTimeout(r, 4000));
			
			const content = await page.content();
			const filePath = join(destDir, `page-${pageNum}.html`);
			fs.writeFileSync(filePath, content, "utf-8");
			console.log(`[Scrape Skills] Successfully saved ${filePath} (${content.length} bytes)`);
		} catch (e) {
			console.error(`[Scrape Skills] Failed to scrape page ${pageNum}:`, e);
		}
	}

	await page.close();
	console.log("[Scrape Skills] Done!");
}

main().catch(console.error);
