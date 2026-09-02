/**
 * Helper pour obtenir l'URL d'un asset stocké sur Supabase Storage.
 * Si le chemin commence par http, il est retourné tel quel.
 * Sinon, il est concaténé avec l'URL du bucket 'assets'.
 *
 * @param path Chemin relatif de l'asset (ex: "logo.png" ou "/logo.png")
 * @returns URL complète de l'asset
 */
export function getAssetUrl(path: string): string {
	if (!path) return "";
	if (path.startsWith("http") || path.startsWith("data:") || path.startsWith("blob:")) return path;

	const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
	if (!supabaseUrl) return path;

	const ASSETS_BUCKET_URL = `${supabaseUrl}/storage/v1/object/public/assets`;

	// Nettoyer le chemin (enlever le slash initial si présent)
	const cleanPath = path.startsWith("/") ? path.substring(1) : path;

	return `${ASSETS_BUCKET_URL}/${cleanPath}`;
}
