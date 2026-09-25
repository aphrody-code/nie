import { expect, test } from "bun:test";
import { uniqueNativeText, type NativeTextMatches } from "./native-text";

const matches = (occurrences: NativeTextMatches["occurrences"]): NativeTextMatches => ({
	language: "fr",
	family: "menu_text",
	hash: 42,
	hash_hex: "0x0000002a",
	total: occurrences.length,
	occurrences,
});

test("only a unique VFS text occurrence is safe to render without a native layout selector", () => {
	const unique = { file: "data/common/text/fr/menu_text.cfg.bin", text: "Jouer" };
	expect(uniqueNativeText(matches([unique]))).toEqual(unique);
	expect(uniqueNativeText(matches([unique, { ...unique, file: "data/common/text/fr/system_text.cfg.bin" }]))).toBeUndefined();
	expect(uniqueNativeText(undefined)).toBeUndefined();
});
