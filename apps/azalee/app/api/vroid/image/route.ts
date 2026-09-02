/**
 * Relais des vignettes de VRoid Hub.
 *
 * Les portraits sont servis par `vroid-hub.pximg.net`, un hôte que la CSP
 * d'azalée n'autorise pas en `img-src` (cf. `next.config.ts`). Plutôt que
 * d'élargir une politique globale pour un seul module, on relaie l'image : la
 * page ne charge que des URLs `'self'`, la CSP reste inchangée, et l'allowlist
 * d'un seul hôte évite de transformer azalée en proxy ouvert.
 *
 * Mesuré le 2026-09-02 : le CDN sert ces images sans exiger de `Referer`
 * (HTTP 200, `image/jpeg`, 39 516 o sur une vignette 300×400).
 */
import { HOTE_IMAGES_VROID } from "@/lib/vroid/constantes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Types d'image acceptés en sortie — le CDN ne sert que ceux-là. */
const TYPES_AUTORISES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export async function GET(requete: Request): Promise<Response> {
	const source = new URL(requete.url).searchParams.get("url");
	if (!source) return new Response("paramètre `url` manquant", { status: 400 });

	let cible: URL;
	try {
		cible = new URL(source);
	} catch {
		return new Response("url invalide", { status: 400 });
	}

	// Allowlist stricte : un seul hôte, en HTTPS. Tout le reste est refusé.
	if (cible.protocol !== "https:" || cible.hostname !== HOTE_IMAGES_VROID) {
		return new Response("hôte non autorisé", { status: 403 });
	}

	let amont: Response;
	try {
		amont = await fetch(cible, {
			headers: { Accept: "image/*" },
			// Les vignettes sont immuables : le cache HTTP en aval fait le travail.
			cache: "no-store",
		});
	} catch {
		return new Response("CDN VRoid Hub injoignable", { status: 502 });
	}

	if (!amont.ok || !amont.body) {
		return new Response("image indisponible", { status: amont.status === 404 ? 404 : 502 });
	}

	const type = amont.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
	if (!TYPES_AUTORISES.has(type)) {
		return new Response("type de contenu inattendu", { status: 415 });
	}

	return new Response(amont.body, {
		headers: {
			"content-type": type,
			// Les URLs du CDN portent l'empreinte du rendu : le contenu ne change pas.
			"cache-control": "public, max-age=86400, immutable",
			"x-content-type-options": "nosniff",
		},
	});
}
