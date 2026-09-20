import { expect, test } from "bun:test";
import { TOOL_IDS, toolFromSearch, toolSearch } from "./tool-navigation";

test("all tool identities reopen while preserving unrelated shared state", () => {
	for (const [key, value] of Object.entries(TOOL_IDS)) {
		expect(toolFromSearch(`?tool=${key}`)).toBe(value);
		const search = toolSearch("?q=Byron&level=99&tool=unknown", value);
		expect(toolFromSearch(search)).toBe(value);
		expect(new URLSearchParams(search).get("q")).toBe("Byron");
		expect(new URLSearchParams(search).get("level")).toBe("99");
	}
	expect(toolFromSearch("?tool=__proto__")).toBe("traducteur");
	expect(toolFromSearch("")).toBe("traducteur");
});
