import { expect, test } from "bun:test";
import { adapterProof, classify, classifyBuildOutputs } from "./azalee-route-ledger";

test("game, editorial and privileged legacy boundaries remain distinct", () => {
	expect(classify("/chara/[id]", "page").classification).toBe("game");
	expect(classify("/api/characters/:slug", "headless_api").status).toBe("adapter_pending");
	expect(classify("/api/graphql", "next_handler").classification).toBe("game");
	expect(classify("/news/[slug]", "page").owner).toBe("rg");
	expect(classify("/dashboard/news", "page").destination).toBe("rg:/dashboard/news");
	expect(classify("/api/admin/discord/role/[roleId]/members", "next_handler").owner).toBe("rg privileged adapters");
	expect(classify("/api/cpk/file", "headless_api").status).toBe("native_only");
	expect(classify("/health", "headless_api").status).toBe("native_only");
	for (const path of ["/api/save/resolve-roster", "/api/mode-tex/[...p]", "/api/vroid/models/[id]", "/chara/[id]/opengraph-image"]) {
		expect(classify(path, "next_handler").classification).toBe("game");
	}
	expect(classify("/api/vroid/login", "next_handler").classification).toBe("editorial");
	expect(classify("/tools/niers/latest.json", "next_handler").status).toBe("native_only");
});

test("compiled pages and generated metadata remain distinct from source inventory", () => {
	const outputs = classifyBuildOutputs({
		"/chara/(liste)/page": "/chara",
		"/_not-found/page": "/_not-found",
		"/robots.txt/route": "/robots.txt",
	});
	expect(outputs).toHaveLength(3);
	expect(outputs.find(row => row.path === "/chara")?.classification).toBe("game");
	expect(outputs.find(row => row.path === "/robots.txt")?.classification).toBe("editorial");
	expect(outputs.find(row => row.path === "/_not-found")?.status).toBe("retained_in_rg");
});

test("response proofs never promote a contract into full migration", () => {
	expect(adapterProof("/api/characters/:slug")?.test).toContain("isolated_historical_json");
	expect(adapterProof("/api/gallery")?.intentionalOmissions).toEqual([]);
	expect(adapterProof("/api/cross/stats")?.intentionalOmissions).toHaveLength(1);
	expect(adapterProof("/api/quests")).toBeNull();
	expect(classify("/api/gallery", "headless_api").status).toBe("adapter_pending");
});
