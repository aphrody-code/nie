import { describe, expect, test } from "bun:test";
import { allowedArtifactPath, decideRelation } from "./sync-main";

describe("sync-main decisions", () => {
	test("classifies equality, fast-forwards, and divergence", () => {
		expect(decideRelation("a", "a", true, true)).toBe("equal");
		expect(decideRelation("local", "origin", true, false)).toBe("local-ahead");
		expect(decideRelation("local", "origin", false, true)).toBe("remote-ahead");
		expect(decideRelation("local", "origin", false, false)).toBe("diverged");
	});
});

describe("artifact allowlist", () => {
	test("allows release-owned files only", () => {
		expect(allowedArtifactPath("bin/nie-site")).toBeTrue();
		expect(allowedArtifactPath("bin/niers")).toBeTrue();
		expect(allowedArtifactPath("bin/nie-model-serve")).toBeTrue();
		expect(allowedArtifactPath("bundle/static/app.js.br")).toBeTrue();
		expect(allowedArtifactPath("nie-site")).toBeFalse();
		expect(allowedArtifactPath("target/release/nie-site")).toBeFalse();
		expect(allowedArtifactPath("bundle/../../Cargo.toml")).toBeFalse();
		expect(allowedArtifactPath("/etc/passwd")).toBeFalse();
		expect(allowedArtifactPath("bundle\\evil")).toBeFalse();
	});
});
