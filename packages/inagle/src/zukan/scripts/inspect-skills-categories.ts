import { createInagleService } from "../../index.js";

async function main() {
    try {
        const service = await createInagleService();
        const skills = service.skills.all();
        console.log(`Total raw skills: ${skills.length}`);

        const categories = new Map<any, number>();
        for (const s of skills) {
            categories.set(s.category, (categories.get(s.category) || 0) + 1);
        }

        console.log("\nRaw skill count by category ID/Name:");
        for (const [cat, count] of categories.entries()) {
            console.log(`- Category: ${cat}, Count: ${count}`);
        }
    } catch (e) {
        console.error("Error:", e);
    }
}

main();
