import { createInagleService } from "../../index.js";

async function main() {
    try {
        const service = await createInagleService();
        const skills = service.skills.all();
        
        // Filter out categories 6 and 9
        const activeSkills = skills.filter((s: any) => 
            (s.internalCode || s.skillIDStr || s.skillID || s.id) &&
            s.category !== 6 &&
            s.category !== 9
        );

        console.log(`Active skills in JSON dump: ${activeSkills.length}`);

        // Group by ID
        const byId = new Map<string, any[]>();
        for (const s of activeSkills) {
            const id = s.internalCode || s.skillIDStr || s.skillID || s.id;
            if (!byId.has(id)) byId.set(id, []);
            byId.get(id)!.push(s);
        }

        let idDupCount = 0;
        for (const [id, list] of byId.entries()) {
            if (list.length > 1) {
                idDupCount++;
                console.log(`Duplicate ID: ${id} occurs ${list.length} times`);
            }
        }
        console.log(`Total duplicate IDs: ${idDupCount}`);

        // Group by name
        const byName = new Map<string, any[]>();
        for (const s of activeSkills) {
            const name = s.names?.fr || s.names?.en || s.displayName || s.name || "";
            const key = name.toLowerCase().trim();
            if (key) {
                if (!byName.has(key)) byName.set(key, []);
                byName.get(key)!.push(s);
            }
        }

        let nameDupCount = 0;
        for (const [name, list] of byName.entries()) {
            if (list.length > 1) {
                nameDupCount++;
                if (nameDupCount <= 10) {
                    console.log(`Duplicate name: "${name}" occurs ${list.length} times, IDs:`, list.map(x => x.internalCode || x.skillIDStr || x.id));
                }
            }
        }
        console.log(`Total duplicate names: ${nameDupCount}`);

    } catch (e) {
        console.error("Error:", e);
    }
}

main();
