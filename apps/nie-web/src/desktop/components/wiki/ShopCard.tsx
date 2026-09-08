import { ShopCard as SharedShopCard, type ShopCardProps as SharedShopCardProps } from "@niers/inacord-ui/components/wiki/wiki/ShopCard";
import { SHOP_CATEGORY_FR } from "@/lib/wikiTypes";

export type ShopCardProps = Omit<SharedShopCardProps, "itemCountLabel" | "categoryLabel">;

/** Desktop adapter supplies labels from its VFS-derived data contract. */
export function ShopCard(props: ShopCardProps) {
	return <SharedShopCard {...props} itemCountLabel={(count) => `${count} objets`} categoryLabel={(category) => SHOP_CATEGORY_FR[category] || category} />;
}
