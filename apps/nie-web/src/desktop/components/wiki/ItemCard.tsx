"use client";

import { ItemCard as SharedItemCard, type ItemCardProps as SharedItemCardProps } from "@niers/inacord-ui/components/wiki/wiki/ItemCard";
import { Image } from "@niers/inacord-ui/components/ui/image";
import { getItemIconUrl, PLACEHOLDERS, resolveAssetUrl } from "@niers/inacord-ui/lib/wikiImages";

export type ItemCardProps = Omit<SharedItemCardProps, "resolveImage" | "renderImage" | "locationLabel">;

const LOCATION_FR: Record<string, string> = {
	Chronicle: "Chronique",
	"G-Mart (Arcade Branch)": "G-Mart (Arcade)",
	"G-Mart (Odaiba)": "G-Mart (Odaiba)",
	"Kool Kit (Odaiba Branch)": "Kool Kit (Odaiba)",
	"Special Training Booth": "Entraînement",
	Spirit: "Esprits",
	VS: "VS",
};

/** Desktop adapter: VFS-aware image decoding remains local to the desktop host. */
export function ItemCard(props: ItemCardProps) {
	return <SharedItemCard {...props} resolveImage={(icon, internalCode) => {
		const source = resolveAssetUrl(icon) || (internalCode ? getItemIconUrl(internalCode) : null);
		return source === PLACEHOLDERS.item ? null : source;
	}} renderImage={({ src, alt, width, height, className, onError }) => <Image src={src} alt={alt} width={width} height={height} className={className} unoptimized onError={onError} />} locationLabel={(location) => LOCATION_FR[location] || location} />;
}
