import { describe, expect, test } from "bun:test";
import { OfflineVfs } from "./offline-vfs";

describe("OfflineVfs", () => {
	test("normalizes paths and stores files in memory", () => {
		const vfs = new OfflineVfs();
		const data = new Uint8Array([1, 2, 3, 4]);

		vfs.registerFile("data\\common\\text\\fr\\menu_text.cfg.bin", data);

		expect(vfs.hasFile("data/common/text/fr/menu_text.cfg.bin")).toBe(true);
		expect(vfs.getFile("data/common/text/fr/menu_text.cfg.bin")).toBe(data);
		expect(vfs.getFile("common/nonexistent.bin")).toBeNull();
		expect(vfs.count).toBe(1);
	});

	test("notifies subscribers when files are added", () => {
		const vfs = new OfflineVfs();
		let notified = 0;
		const unsubscribe = vfs.subscribe(() => {
			notified++;
		});

		vfs.registerFile("test.bin", new Uint8Array([10, 20]));
		expect(notified).toBe(1);

		unsubscribe();
		vfs.registerFile("test2.bin", new Uint8Array([30]));
		expect(notified).toBe(1);
	});
});
