import { describe, expect, test } from "bun:test";
import { exportFileUrl, exportFormatsUrl } from "./export-formats";

describe("routes d’export de nie-site", () => {
	test("le chemin VFS reste des SEGMENTS, jamais un paramètre encodé d’un bloc", () => {
		// Mesuré le 2026-09-20 sur 127.0.0.1:8085 : cette adresse rend les dix formats du fichier.
		expect(exportFormatsUrl("data/dx11/menu/220_img/activity_photo/activity_note_001.g4tx")).toBe(
			"/api/v1/export/formats/data/dx11/menu/220_img/activity_photo/activity_note_001.g4tx",
		);
	});

	test("`raw` ne demande AUCUN format : c’est ainsi que la route rend le fichier d’origine", () => {
		expect(exportFileUrl("data/a/b.g4tx", "raw")).toBe("/api/v1/export/file/data/a/b.g4tx");
		expect(exportFileUrl("data/a/b.g4tx")).toBe("/api/v1/export/file/data/a/b.g4tx");
		expect(exportFileUrl("data/a/b.g4tx", "png")).toBe("/api/v1/export/file/data/a/b.g4tx?format=png");
	});

	test("un caractère réservé dans un nom est encodé, mais pas les séparateurs du VFS", () => {
		expect(exportFileUrl("data/a b/c?d.g4tx", "png")).toBe(
			"/api/v1/export/file/data/a%20b/c%3Fd.g4tx?format=png",
		);
	});
});
