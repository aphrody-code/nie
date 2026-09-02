import { XClient, XSession } from "@aphrody-code/x";

async function main() {
	try {
		const session = XSession.loadOrEnv();
		const client = new XClient(session);
		const tweetId = "2061064712393982247";
		console.log(`Fetching tweet ${tweetId}...`);
		const tweet = await client.getTweet(tweetId);
		console.log("Tweet fetched successfully!");
		await Bun.write("scratch/test-tweet-raw.json", JSON.stringify(tweet, null, 2));
		console.log("Saved raw tweet to scratch/test-tweet-raw.json");
	} catch (e) {
		console.error("Error fetching tweet:", e);
	}
}

main();
