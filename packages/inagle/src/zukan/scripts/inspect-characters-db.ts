import { createSupabaseServiceClient } from "../../../../db/src/service.js";

const supabase = createSupabaseServiceClient();

async function main() {
    try {
        console.log("Fetching characters from Supabase...");
        // Let's find some characters that have variants
        const { data: chars, error } = await supabase
            .from("inagle_characters")
            .select("id, chara_id, name_fr, internal_code, rarity_label, image_url, zukan_hash, hero_type, zukan_order");
            
        if (error) {
            console.error("Error fetching characters:", error);
            return;
        }

        console.log(`Total character rows in DB: ${chars.length}`);

        // Group by chara_id to find characters with multiple variants
        const byCharaId = new Map<string, any[]>();
        for (const c of chars) {
            const key = c.chara_id || "";
            if (!byCharaId.has(key)) byCharaId.set(key, []);
            byCharaId.get(key)!.push(c);
        }

        // Print characters with variants (normal, hero, basara)
        let count = 0;
        for (const [charaId, list] of byCharaId.entries()) {
            if (list.length > 1) {
                const name = list[0].name_fr || list[0].name_en || charaId;
                // Check if has hero or basara
                const hasHeroOrBasara = list.some(c => c.rarity_label === "Héros" || c.rarity_label === "BASARA");
                if (hasHeroOrBasara) {
                    count++;
                    if (count <= 5) {
                        console.log(`\nCharacter: ${name} (chara_id: ${charaId})`);
                        for (const c of list) {
                            console.log(`  - ParamID: ${c.id}`);
                            console.log(`    Code: ${c.internal_code}, Rarity: ${c.rarity_label}, HeroType: ${c.hero_type}`);
                            console.log(`    ImageUrl: ${c.image_url}, ZukanHash: ${c.zukan_hash}, Order: ${c.zukan_order}`);
                        }
                    }
                }
            }
        }
    } catch (e) {
        console.error("Error:", e);
    }
}

main();
