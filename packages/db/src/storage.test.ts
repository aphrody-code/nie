import { beforeEach, describe, expect, it } from "bun:test";
import { getAssetUrl } from "./storage";

describe("getAssetUrl", () => {
	const envOrigine = { ...process.env };

	beforeEach(() => {
		process.env = { ...envOrigine };
		process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
	});

	it("rend une chaîne vide quand le chemin est vide", () => {
		expect(getAssetUrl("")).toBe("");
	});

	it("laisse passer les URL absolues telles quelles", () => {
		const url = "https://example.com/image.png";
		expect(getAssetUrl(url)).toBe(url);
	});

	it("laisse passer les URL `data:` telles quelles", () => {
		const url = "data:image/png;base64,123";
		expect(getAssetUrl(url)).toBe(url);
	});

	it("construit l'URL de stockage pour un chemin relatif", () => {
		expect(getAssetUrl("logo.png")).toBe(
			"https://test.supabase.co/storage/v1/object/public/assets/logo.png"
		);
	});

	it("absorbe le slash de tête d'un chemin relatif", () => {
		expect(getAssetUrl("/avatars/user.png")).toBe(
			"https://test.supabase.co/storage/v1/object/public/assets/avatars/user.png"
		);
	});

	it("rend le chemin inchangé quand NEXT_PUBLIC_SUPABASE_URL manque", () => {
		delete process.env.NEXT_PUBLIC_SUPABASE_URL;
		expect(getAssetUrl("logo.png")).toBe("logo.png");
	});
});
