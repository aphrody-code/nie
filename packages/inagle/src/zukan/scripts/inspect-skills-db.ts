import { createSupabaseServiceClient } from "../../../../db/src/service.js";

const supabase = createSupabaseServiceClient();

async function main() {
    try {
        console.log("Fetching all skills from Supabase...");
        const { data: skills, error } = await supabase.from("inagle_skills").select("*");
        if (error) {
            console.error("Error fetching skills:", error);
            return;
        }

        console.log(`Total skills in DB: ${skills.length}`);

        // 1. Check for duplicates by name
        const seenNames = new Set<string>();
        const nameDuplicates: any[] = [];
        for (const s of skills) {
            const name = s.name_fr || s.name_en || s.name_ja;
            if (name) {
                const key = name.toLowerCase().trim();
                if (seenNames.has(key)) {
                    nameDuplicates.push(s);
                } else {
                    seenNames.add(key);
                }
            }
        }

        console.log(`Duplicate skills by name: ${nameDuplicates.length}`);
        for (const s of nameDuplicates.slice(0, 10)) {
            console.log(`- ID: ${s.id}, Name: ${s.name_fr} (${s.name_en}), Category: ${s.category}`);
        }

        // 2. Check for passive skills (e.g. category = 'Passif' or 'Passive' or is_passive)
        const passives = skills.filter(s => {
            const cat = s.category?.toLowerCase() || "";
            const isPassiveCat = cat.includes("passif") || cat.includes("passive");
            // Check in data object if available
            const dataPassive = s.data && (s.data.category === 6 || s.data.category === "Passive" || s.data.isPassive);
            return isPassiveCat || dataPassive;
        });

        console.log(`Passive skills in DB: ${passives.length}`);
        for (const s of passives.slice(0, 10)) {
            console.log(`- ID: ${s.id}, Name: ${s.name_fr} (${s.name_en}), Category: ${s.category}`);
        }

        // 3. Check for duplicates by ID
        const seenIds = new Set<string>();
        const idDuplicates: any[] = [];
        for (const s of skills) {
            if (seenIds.has(s.id)) {
                idDuplicates.push(s);
            } else {
                seenIds.add(s.id);
            }
        }
        console.log(`Duplicate skills by ID: ${idDuplicates.length}`);

    } catch (e) {
        console.error("Error:", e);
    }
}

main();
