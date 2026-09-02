import { XClient, XSession } from "@aphrody-code/x";

async function main() {
	try {
		const session = XSession.loadOrEnv();
		const client = new XClient(session);
		const tweetId = "2061064712393982247";
		console.log(`Fetching entire thread for head tweet ${tweetId}...`);
		const threadData = await client.thread(tweetId);
		console.log(`Fetched ${threadData.tweets.length} tweets in thread.`);

		await Bun.write("scratch/test-thread-raw.json", JSON.stringify(threadData, null, 2));
		console.log("Saved raw thread data to scratch/test-thread-raw.json");

		threadData.tweets.forEach((t: any, idx: number) => {
			console.log(`\n--- Tweet #${idx + 1} (ID: ${t.id}) ---`);
			console.log(`Author: @${t.author?.username}`);
			console.log(`Text: ${t.text}`);
			console.log(`Media:`, JSON.stringify(t.media, null, 2));
		});
	} catch (e) {
		console.error("Error fetching thread:", e);
	}
}

main();
