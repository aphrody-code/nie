export type TrophyGallerySurface = "native" | "assets";

export function trophyGalleryHrefForSurface(input: string, surface: TrophyGallerySurface): string {
	const url = new URL(input, "http://localhost");
	if (surface === "assets") url.searchParams.set("display", "gallery");
	else url.searchParams.delete("display");
	return `${url.pathname}${url.search}${url.hash}`;
}

/** Opening is a navigable public extension; closing replaces it so Back cannot reopen it. */
export function trophyGalleryHistoryMode(surface: TrophyGallerySurface): "push" | "replace" {
	return surface === "assets" ? "push" : "replace";
}
