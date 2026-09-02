import { createPublicClient } from "../lib/supabase/public";

async function main() {
	const supabase = createPublicClient();

	// 1. Character
	const { data: charData } = await supabase
		.from("inagle_characters")
		.select("base_slug, slug, id")
		.limit(1)
		.single();

	// 2. Skill
	const { data: skillData } = await supabase
		.from("inagle_skills")
		.select("id")
		.limit(1)
		.single();

	// 3. Item
	const { data: itemData } = await supabase
		.from("inagle_items")
		.select("id")
		.limit(1)
		.single();

	// 4. Tactic
	const { data: tacticData } = await supabase
		.from("inagle_tactics")
		.select("id")
		.limit(1)
		.single();

	// 5. Aura
	const { data: auraData } = await supabase
		.from("inagle_auras")
		.select("id, category")
		.limit(1)
		.single();

	// 6. News
	const { data: newsData } = await supabase
		.from("articles")
		.select("slug")
		.eq("status", "published")
		.eq("app", "azalee")
		.limit(1)
		.single();

	// 7. Patch Note
	const { data: patchData } = await supabase
		.from("patch_notes")
		.select("id")
		.limit(1)
		.single();

	console.log(JSON.stringify({
		character: charData?.base_slug || charData?.slug || charData?.id || "mark-evans",
		skill: skillData?.id || "1",
		item: itemData?.id || "1",
		tactic: tacticData?.id || "1",
		aura: auraData ? { id: auraData.id, category: auraData.category } : { id: "1", category: "keshin" },
		news: newsData?.slug || "welcome",
		patchNote: patchData?.id || "1"
	}, null, 2));
}

main().catch(err => {
	console.error(err);
	process.exit(1);
});
