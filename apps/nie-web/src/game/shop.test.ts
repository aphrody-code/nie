import { describe, expect, test } from "bun:test";
import {
	filterStock,
	shopStock,
	stockCategories,
	stockPrice,
	stockTotal,
	type ItemRow,
	type ShopRow,
} from "./shop";

const ITEMS: ItemRow[] = [
	{ item_id: "0x5F0F1EAC", internal_code: "btl_re000001", name: "Guts Gear", description: "Boisson en gelée.", category: "Consume", price: null },
	{ item_id: "0x26EA0F62", internal_code: "tk_hr000001", name: "Crampons simples", description: "Des crampons d'entrée de jeu.", category: "Shoes", price: 201 },
	{ item_id: "0xBFE35ED8", internal_code: "tk_hr000002", name: "Bracelet coloré", description: "Un bracelet tressé.", category: "Misanga", price: 202 },
];

const SHOPS: ShopRow[] = [
	{ shop_id: "0x61245112", name: null, item_count: 3, items: ["Crampons simples", "Bracelet coloré", "0x274411D7"] },
	{ shop_id: "0xB13B2BD5", name: "Boutique Kizuna", item_count: 1, items: ["Guts Gear"] },
];

describe("shop stock", () => {
	test("joins each shop line to the item table by name, and keeps the ones it cannot name", () => {
		const [first] = shopStock(SHOPS, ITEMS, null);
		expect(first?.items.map((entry) => entry.resolved)).toEqual([true, true, false]);
		// L'identifiant brut du stock reste affiché : l'effacer masquerait une partie du stock.
		expect(first?.items[2]).toMatchObject({ name: "0x274411D7", item: null });
		expect(first?.declared).toBe(3);
	});

	test("an unnamed shop falls back to its identifier and says so", () => {
		const [first, second] = shopStock(SHOPS, ITEMS, null);
		expect(first).toMatchObject({ label: "0x61245112", unnamed: true });
		expect(second).toMatchObject({ label: "Boutique Kizuna", unnamed: false });
	});

	test("the typed fallback stocks everything; the profile owns it when it answers", () => {
		expect(shopStock(SHOPS, ITEMS, null).every((shop) => shop.origin === "game-data")).toBe(true);
		expect(stockTotal(shopStock(SHOPS, ITEMS, null))).toBe(4);
		const withProfile = shopStock(SHOPS, ITEMS, [
			{ items: [{ name: "Crampons simples", in_stock: true }, { name: "Bracelet coloré", in_stock: false }, { name: "0x274411D7", in_stock: true }] },
			{ items: [{ name: "Guts Gear", in_stock: true }] },
		]);
		expect(withProfile[0]?.origin).toBe("profile");
		expect(withProfile[0]?.items.map((entry) => entry.inStock)).toEqual([true, false, true]);
		expect(stockTotal(withProfile)).toBe(3);
	});

	test("categories come from the resolved items only, counted and ordered", () => {
		const [first] = shopStock(SHOPS, ITEMS, null);
		expect(stockCategories(first?.items ?? [])).toEqual([
			{ value: "Misanga", count: 1 },
			{ value: "Shoes", count: 1 },
		]);
	});

	test("the filter combines the category tab and the name search", () => {
		const [first] = shopStock(SHOPS, ITEMS, null);
		const stock = first?.items ?? [];
		expect(filterStock(stock, "Shoes", "").map((entry) => entry.name)).toEqual(["Crampons simples"]);
		expect(filterStock(stock, null, "bracelet").map((entry) => entry.name)).toEqual(["Bracelet coloré"]);
		expect(filterStock(stock, null, "tresse").map((entry) => entry.name)).toEqual(["Bracelet coloré"]);
		expect(filterStock(stock, null, "")).toHaveLength(3);
	});

	test("a price the data does not carry stays absent", () => {
		const [, second] = shopStock(SHOPS, ITEMS, null);
		const [first] = shopStock(SHOPS, ITEMS, null);
		expect(stockPrice(first?.items[0] as never)).toBe(201);
		expect(stockPrice(second?.items[0] as never)).toBeNull();
	});
});
