import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { localizedName, nameWithId, resolvedKindLabel, useResolvedNames, type NameResolver, type ResolvedName } from "./resolved-names";
import type { Locale } from "./settings";

let root: Root;
let container: HTMLDivElement;
const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const previous = environment.IS_REACT_ACT_ENVIRONMENT;
beforeEach(() => {
	environment.IS_REACT_ACT_ENVIRONMENT = true;
	container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount()); container.remove(); environment.IS_REACT_ACT_ENVIRONMENT = previous;
});

function Consumer({ resolver, source = "game-a", locale = "fr", slot = "one", codes = ["ch001"] }: {
	resolver?: NameResolver; source?: string; locale?: Locale; slot?: string; codes?: string[];
}) {
	const names = useResolvedNames(resolver, source, locale, codes);
	return <output data-slot={slot}>{names.get("ch001")?.name ?? "unresolved"}</output>;
}
const record = (name: string): ResolvedName => ({ name, id: "0x1234", kind: "chara", extra: null });
const output = (slot = "one") => container.querySelector(`[data-slot="${slot}"]`)!.textContent;

test("locale and source cache identities stay separate and reuse only the matching result", async () => {
	const resolver = mock(async (source: string, _codes: string[], locale: Locale) => new Map([["ch001", record(`${source}-${locale}`)]]));
	for (const [source, locale] of [["game-a", "fr"], ["game-a", "en"], ["game-b", "en"], ["game-a", "fr"]] as const) {
		await act(async () => root.render(<Consumer resolver={resolver} source={source} locale={locale} />));
		expect(output()).toBe(`${source}-${locale}`);
	}
	expect(resolver).toHaveBeenCalledTimes(3);
});

test("resolver instances cannot share cached names even with identical source locale and code", async () => {
	const first: NameResolver = async () => new Map([["ch001", record("First")]]);
	const second: NameResolver = async () => new Map([["ch001", record("Second")]]);
	await act(async () => root.render(<Consumer resolver={first} />));
	expect(output()).toBe("First");
	await act(async () => root.render(<Consumer resolver={second} />));
	expect(output()).toBe("Second");
});

test("two subscribers share one in-flight batch and both receive its resolved name", async () => {
	let resolve!: (names: Map<string, ResolvedName>) => void;
	const promise = new Promise<Map<string, ResolvedName>>(accept => { resolve = accept; });
	const resolver = mock(() => promise);
	await act(async () => root.render(<><Consumer resolver={resolver} codes={["ch001", "ch001", ""]} /><Consumer resolver={resolver} slot="two" /></>));
	expect(resolver).toHaveBeenCalledTimes(1);
	expect(resolver.mock.calls[0]).toEqual(["game-a", ["ch001"], "fr"]);
	expect(output()).toBe("unresolved"); expect(output("two")).toBe("unresolved");
	await act(async () => resolve(new Map([["ch001", record("Resolved")]])));
	expect(output()).toBe("Resolved"); expect(output("two")).toBe("Resolved");
	expect(resolver).toHaveBeenCalledTimes(1);
});

test("an optional resolver or blank source issues no query and can become available later", async () => {
	const resolver = mock(async () => new Map([["ch001", record("Available")]]));
	await act(async () => root.render(<Consumer />));
	expect(output()).toBe("unresolved");
	await act(async () => root.render(<Consumer resolver={resolver} source="  " />));
	expect(resolver).not.toHaveBeenCalled();
	await act(async () => root.render(<Consumer resolver={resolver} />));
	expect(output()).toBe("Available");
	expect(resolver).toHaveBeenCalledTimes(1);
});

test("a late response for the previous locale never replaces the current locale", async () => {
	let resolve!: (names: Map<string, ResolvedName>) => void;
	const french = new Promise<Map<string, ResolvedName>>(accept => { resolve = accept; });
	const resolver: NameResolver = async (_source, _codes, locale) => locale === "fr" ? french : new Map([["ch001", record("English")]]);
	await act(async () => root.render(<Consumer resolver={resolver} />));
	await act(async () => root.render(<Consumer resolver={resolver} locale="en" />));
	expect(output()).toBe("English");
	await act(async () => resolve(new Map([["ch001", record("Français")]])));
	expect(output()).toBe("English");
});

test("localized names prefer the requested language and fall back through English French Japanese then exact ID", () => {
	const row = { name_fr: " Français ", name_en: "English", name_ja: "日本語" };
	expect(localizedName(row, "fr", "0x1234")).toBe("Français");
	expect(localizedName(row, "ja", "0x1234")).toBe("日本語");
	expect(localizedName({ ...row, name_ja: " " }, "ja", "0x1234")).toBe("English");
	expect(localizedName({ ...row, name_ja: null, name_en: null }, "en", "0x1234")).toBe("Français");
	expect(localizedName({ ...row, name_fr: null, name_en: null }, "fr", "0x1234")).toBe("日本語");
	expect(localizedName({ name_fr: null, name_en: " ", name_ja: null }, "fr", "0x1234")).toBe("0x1234");
});

test("display helpers retain exact identity without duplicating an unresolved name", () => {
	expect(nameWithId(" Endou ", "0x1234")).toBe("Endou · 0x1234");
	expect(nameWithId("0x1234", "0x1234")).toBe("0x1234");
	expect(nameWithId(undefined, "ch001")).toBe("ch001");
	expect(nameWithId("  ", "0x1234")).toBe("0x1234");
	expect(resolvedKindLabel("skill", "en")).toBe("skill");
	expect(resolvedKindLabel("chara", "fr")).toBe("personnage");
});
