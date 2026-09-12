/**
 * La Boutique — le stock des 16 boutiques de l'écran `shop_menu`, en fonctions pures.
 *
 * ## Ce qui vient du jeu
 *
 * - Les boutiques sont celles de `/api/v1/game-data/shops` : **16** lignes, chacune avec son
 *   `shop_id`, son nom quand la donnée en porte un (14 sur 16) et la liste des noms d'articles
 *   de son stock (`items`, de 1 à 549 entrées).
 * - Les articles sont ceux de `/api/v1/game-data/items` : **1 820** lignes avec leur catégorie,
 *   leur description et leur prix (1 550 en portent un ; les 270 autres n'en ont pas, et rien
 *   n'est inventé à leur place).
 * - `/api/v1/profile/complete` publie `shops[].items[] = {name, in_stock}` : le profil complet
 *   a tout en stock. Sans lui, le repli typé considère tout le stock disponible — c'est le même
 *   état, mesuré par l'autre route, et il est déclaré par `origin`.
 *
 * ## La jointure se fait par NOM, et elle échoue parfois
 *
 * `shops.items` ne porte pas d'identifiant d'article, seulement le libellé — et certains
 * libellés sont des identifiants bruts (`0x274411D7`) que la table des articles ne nomme pas.
 * Ces lignes restent dans le stock, marquées `resolved: false`, avec le libellé tel quel : les
 * effacer masquerait une partie du stock réel de la boutique.
 */
import { fold } from "./list-page";

/** Une boutique, telle que `/api/v1/game-data/shops` la sert. */
export interface ShopRow {
	shop_id: string;
	name: string | null;
	item_count: number | null;
	items: readonly string[];
}

/** Un article, tel que `/api/v1/game-data/items` le sert. */
export interface ItemRow {
	item_id: string;
	internal_code: string | null;
	name: string | null;
	description: string | null;
	category: string | null;
	price: number | null;
}

/** Une ligne du stock d'une boutique. */
export interface StockItem {
	/** Le libellé du stock — celui de la boutique, qui est aussi la clé de jointure. */
	name: string;
	/** L'article correspondant de la table des articles, `null` quand le nom n'y figure pas. */
	item: ItemRow | null;
	/** Faux quand la table des articles ne connaît pas ce libellé. */
	resolved: boolean;
	/** En stock pour le profil complet. */
	inStock: boolean;
}

/** Une boutique et son stock résolu. */
export interface ShopStock {
	id: string;
	/** Le nom de la boutique, ou son identifiant quand la donnée n'en porte pas. */
	label: string;
	/** Vrai quand `label` est le `shop_id` faute de nom dans la donnée. */
	unnamed: boolean;
	items: readonly StockItem[];
	/** Le compte annoncé par la donnée (`item_count`). */
	declared: number;
	/** `"profile"` quand le profil a répondu, `"game-data"` quand c'est le repli typé. */
	origin: "profile" | "game-data";
}

/** Le stock d'une boutique vu par le profil complet : un libellé, en stock ou non. */
export interface ProfileShop {
	items?: readonly { name?: string | null; in_stock?: boolean | null }[];
}

/** Le titre de l'écran, relevé sur `data/menu/shop.png`. */
export const SHOP_TITLE = "Marché";

/**
 * Le stock des boutiques, articles résolus par leur nom.
 *
 * `profile` est la liste `shops` de `/api/v1/profile/complete`, dans le même ordre que
 * `game-data/shops` ; quand elle manque, tout le stock est disponible.
 */
export function shopStock(
	shops: readonly ShopRow[],
	items: readonly ItemRow[],
	profile: readonly ProfileShop[] | null,
): ShopStock[] {
	const byName = new Map<string, ItemRow>();
	for (const item of items) {
		if (item.name && !byName.has(item.name)) byName.set(item.name, item);
	}
	return shops.map((shop, index) => {
		const owned = profile?.[index]?.items ?? null;
		const stocked = owned
			? new Map(owned.map((entry) => [entry.name ?? "", entry.in_stock !== false]))
			: null;
		return {
			id: shop.shop_id,
			label: shop.name ?? shop.shop_id,
			unnamed: shop.name === null,
			items: shop.items.map((name) => ({
				name,
				item: byName.get(name) ?? null,
				resolved: byName.has(name),
				inStock: stocked ? (stocked.get(name) ?? true) : true,
			})),
			declared: shop.item_count ?? shop.items.length,
			origin: stocked ? "profile" : "game-data",
		};
	});
}

/** Les catégories présentes dans un stock, comptées — les onglets `W`/`C` de la boutique. */
export function stockCategories(stock: readonly StockItem[]): { value: string; count: number }[] {
	const counts = new Map<string, number>();
	for (const entry of stock) {
		const category = entry.item?.category;
		if (!category) continue;
		counts.set(category, (counts.get(category) ?? 0) + 1);
	}
	const options = [...counts].map(([value, count]) => ({ value, count }));
	options.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, "fr"));
	return options;
}

/** Le stock retenu par la catégorie choisie et la recherche par nom (touche `X`). */
export function filterStock(
	stock: readonly StockItem[],
	category: string | null,
	search: string,
): StockItem[] {
	const needle = fold(search);
	return stock.filter((entry) => {
		if (category && entry.item?.category !== category) return false;
		if (needle === "") return true;
		return fold(entry.name).includes(needle) || fold(entry.item?.description ?? "").includes(needle);
	});
}

/** Le prix affichable d'un article — `null` quand la donnée n'en porte pas. */
export function stockPrice(entry: StockItem): number | null {
	const price = entry.item?.price;
	return typeof price === "number" ? price : null;
}

/** Le nombre total d'articles en stock, toutes boutiques confondues. */
export function stockTotal(shops: readonly ShopStock[]): number {
	return shops.reduce((sum, shop) => sum + shop.items.filter((entry) => entry.inStock).length, 0);
}
