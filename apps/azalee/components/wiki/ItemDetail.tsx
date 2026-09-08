"use client";

import type { Item } from "@rosegriffon/inagle";
import Image from "next/image";
import {
	ItemDetail as SharedItemDetail,
	type ItemDetailProps as SharedItemDetailProps,
} from "@niers/inacord-ui/components/wiki/wiki/ItemDetail";
import { PLACEHOLDERS, resolveAssetUrl } from "@rosegriffon/azalee/images";
import { japaneseToRomaji } from "@rosegriffon/azalee/text/japanese-romaji";

interface ItemDetailProps {
	item: Item;
	itemName: string;
	itemDesc: string;
}

/** Azalée adapter: it keeps Inagle/Supabase data and Next/CDN media ownership. */
export function ItemDetail({ item, itemName, itemDesc }: ItemDetailProps) {
	const data = item as Item & {
		rarity?: string | number;
		price?: number;
		maxStack?: number;
		description_JA?: string;
		sheetData?: { location?: string; stats?: Record<string, number> };
		exchangeRecipes?: SharedItemDetailProps["exchangeRecipes"];
		bonuses?: Record<string, number>;
	};
	const resolvedImage = resolveAssetUrl(item.imageUrl || item.image);

	return (
		<SharedItemDetail
			itemName={itemName}
			itemDescription={itemDesc}
			imageSource={resolvedImage && resolvedImage !== PLACEHOLDERS.item ? resolvedImage : null}
			renderImage={({ src, alt, className, onError }) => (
				<Image src={src} alt={alt} width={128} height={128} className={className} unoptimized onError={onError} />
			)}
			category={String(item.category)}
			rarity={data.rarity}
			price={data.price}
			maxStack={data.maxStack}
			alternateNames={{ en: item.names?.en, ja: item.names?.ja }}
			japaneseDescription={item.descriptions?.ja || data.description_JA}
			japaneseRomanization={item.names?.ja ? japaneseToRomaji(item.names.ja) || undefined : undefined}
			bonuses={data.bonuses}
			communityLocation={data.sheetData?.location}
			communityStats={data.sheetData?.stats}
			shops={item.shops?.fr}
			exchangeRecipes={data.exchangeRecipes}
		/>
	);
}
