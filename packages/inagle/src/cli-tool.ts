import { createInagleService } from "./service.js";

async function main() {
	const args = process.argv.slice(2);
	const command = args[0];
	const query = args.slice(1).join(" ");

	if (!command || !query) {
		console.log("Usage: tsx cli-tool.ts <search|character|skill|item> <query>");
		process.exit(1);
	}

	const service = await createInagleService();

	try {
		switch (command) {
			case "search": {
				const results = service.search.global(query, { limit: 5 });
				console.log(JSON.stringify(results, null, 2));
				break;
			}
			case "character": {
				const results = service.characters.search(query, { limit: 1 });
				if (results.length > 0) {
					console.log(JSON.stringify(results[0], null, 2));
				} else {
					console.log("No character found.");
				}
				break;
			}
			case "skill": {
				const results = service.skills.search(query, { limit: 1 });
				if (results.length > 0) {
					console.log(JSON.stringify(results[0], null, 2));
				} else {
					console.log("No skill found.");
				}
				break;
			}
			case "item": {
				const results = service.items.searchItems(query, { limit: 1 });
				if (results.length > 0) {
					console.log(JSON.stringify(results[0], null, 2));
				} else {
					console.log("No item found.");
				}
				break;
			}
			default:
				console.log(`Unknown command: ${command}`);
				process.exit(1);
		}
	} catch (error) {
		console.error("Error executing command:", error);
		process.exit(1);
	}
}

main();
