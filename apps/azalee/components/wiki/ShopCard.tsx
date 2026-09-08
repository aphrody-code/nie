import { ShopCard as SharedShopCard, type ShopCardProps as SharedShopCardProps } from "@niers/inacord-ui/components/wiki/wiki/ShopCard";
import { SHOP_CATEGORY_FR } from "@rosegriffon/azalee/wiki/shops-shared";

export type ShopCardProps = Omit<SharedShopCardProps, "itemCountLabel" | "categoryLabel">;

/** Azalée adapter supplies the localized category table from its data package. */
export function ShopCard(props: ShopCardProps) {
	return <SharedShopCard {...props} itemCountLabel={(count) => `${count} objets`} categoryLabel={(category) => SHOP_CATEGORY_FR[category] || category} />;
}
