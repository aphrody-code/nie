import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Logo Azalée inliné en data URI pour les `opengraph-image.tsx`.
 *
 * Pourquoi : `next/og` (Satori) résout les `<img src>` en les FETCHANT. Pointer
 * sur `https://azalee.rosegriffon.fr/logo-og.png` faisait échouer la génération
 * OG au build ("Unsupported image type: unknown") quand le domaine de prod n'est
 * pas joignable / ne renvoie pas l'image depuis le serveur de build (VPS).
 * On lit le fichier local `public/logo-og.png` et on le sert en base64 — aucun
 * accès réseau, déterministe au build comme au runtime standalone.
 */
let _cached: string | null = null;

export function getOgLogoDataUri(): string {
	if (_cached) {
		return _cached;
	}
	const file = path.join(process.cwd(), "public", "logo-og.png");
	const b64 = readFileSync(file).toString("base64");
	_cached = `data:image/png;base64,${b64}`;
	return _cached;
}
