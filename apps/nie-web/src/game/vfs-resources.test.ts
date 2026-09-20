import { describe, expect, test } from "bun:test";
import { VfsResources, type VfsMount } from "./vfs-resources";

function fixture(path: string, value: number): VfsMount & { freed: number } {
	return { freed: 0, has: key => key === path, read: () => new Uint8Array([value]), free() { this.freed++; } };
}

describe("shared verified VFS mounts", () => {
	test("hot and cold archives share exact paths without inventing missing data", () => {
		const store = new VfsResources();
		store.mount("menu", fixture("data/menu", 1));
		store.mount("tables", fixture("data/table", 2));
		expect(store.read("data/menu")).toEqual(new Uint8Array([1]));
		expect(store.read("data/table")).toEqual(new Uint8Array([2]));
		expect(store.read("data/missing")).toBeNull();
		expect(store.read("/data/menu")).toBeNull();
	});
	test("replacement and unmount release each Rust allocation exactly once", () => {
		const store = new VfsResources();
		const first = fixture("data/menu", 1);
		const second = fixture("data/menu", 2);
		store.mount("menu", first);
		store.mount("menu", first);
		expect(() => store.mount("alias", first)).toThrow("already mounted");
		expect(first.freed).toBe(0);
		store.mount("menu", second);
		expect(first.freed).toBe(1);
		expect(store.read("data/menu")?.[0]).toBe(2);
		store.unmount("menu");
		store.unmount("menu");
		expect(second.freed).toBe(1);
		expect(store.read("data/menu")).toBeNull();
	});
});
