import { crawlTwitter } from "./twitter";
import { processTweets } from "./process-tweets";

async function main() {
	try {
		console.log("=== Running Manual Twitter Sync ===");
		const crawlRes = await crawlTwitter();
		console.log("Crawl Result:", crawlRes);
		if (crawlRes.success) {
			console.log("=== Running Tweet Processing ===");
			await processTweets();
			console.log("Tweet processing completed successfully!");
		} else {
			console.error("Crawl failed:", crawlRes.error);
		}
	} catch (e) {
		console.error("Error in sync script:", e);
	}
}

main();
