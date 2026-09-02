/**
 * Chargement d'un `.vrm` pour la visionneuse 3D — **relais, pas hébergement**.
 *
 * La chaîne imposée par VRoid Hub est en trois temps :
 *   1. `POST /api/download_licenses` → une licence de téléchargement à usage
 *      unique, avec une date d'expiration ;
 *   2. `GET /api/download_licenses/{id}/download` → une `302` vers une URL S3
 *      pré-signée ;
 *   3. le téléchargement du fichier proprement dit.
 * Source : https://developer.vroid.com/en/api/load-character.html
 *
 * Trois décisions volontaires :
 *
 * - **Rien n'est stocké.** Le flux S3 est retransmis tel quel au navigateur qui
 *   l'a demandé, avec `Cache-Control: no-store`. Un modèle VRoid Hub n'est pas
 *   redistribuable : le mettre en cache sur azalée en ferait un miroir.
 * - **L'URL pré-signée n'est jamais renvoyée au navigateur.** Elle vaut accès
 *   au fichier sans jeton ; la relayer serait publier un lien de téléchargement.
 * - **`is_downloadable` est vérifié avant d'émettre la licence.** Azalée est une
 *   application non approuvée : elle ne peut légitimement charger que les
 *   modèles déposés par l'internaute lui-même ou autorisés au téléchargement par
 *   leur auteur (https://developer.vroid.com/en/api/recognize.html). La
 *   vérification côté API existe, mais un refus explicite ici donne un message
 *   compréhensible au lieu d'un 403 opaque.
 */
import { NextResponse } from "next/server";
import { detailModele, ErreurVroid, estNonAutorise, estQuotaDepasse, resoudreVrm } from "@/lib/vroid/client";
import { jetonValide } from "@/lib/vroid/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
	_requete: Request,
	{ params }: { params: Promise<{ id: string }> }
): Promise<Response> {
	const { id } = await params;
	if (!/^\d+$/.test(id)) {
		return NextResponse.json({ erreur: "Identifiant de modèle invalide." }, { status: 400 });
	}

	const jeton = await jetonValide();
	if (!jeton) {
		return NextResponse.json(
			{
				erreur: "Le chargement d'un modèle VRoid Hub exige d'avoir lié son compte.",
				connexionRequise: true,
			},
			{ status: 401 }
		);
	}

	try {
		const detail = await detailModele(id, { jeton });
		const modele = detail.character_model;

		// Un modèle déposé par l'internaute lui-même reste chargeable même sans
		// autorisation publique de téléchargement.
		if (!modele.is_downloadable) {
			return NextResponse.json(
				{
					erreur:
						"L'auteur de ce modèle n'en autorise pas le téléchargement. Azalée n'est pas une application approuvée par VRoid Hub et ne peut donc pas le charger.",
					motif: "non-telechargeable",
				},
				{ status: 403 }
			);
		}

		const { url } = await resoudreVrm(jeton, id);

		const amont = await fetch(url, { cache: "no-store" });
		if (!amont.ok || !amont.body) {
			return NextResponse.json(
				{ erreur: `Le fichier n'a pas pu être récupéré (statut ${amont.status}).` },
				{ status: 502 }
			);
		}

		const longueur = amont.headers.get("content-length");

		return new Response(amont.body, {
			headers: {
				// Type officiel d'un VRM (glTF binaire) ; `three-vrm` lit le flux brut.
				"content-type": "model/gltf-binary",
				...(longueur ? { "content-length": longueur } : {}),
				// Aucun cache, nulle part : ni navigateur, ni CDN, ni proxy.
				"cache-control": "no-store, private",
				"x-content-type-options": "nosniff",
			},
		});
	} catch (erreur) {
		if (estNonAutorise(erreur)) {
			return NextResponse.json(
				{
					erreur:
						"VRoid Hub a refusé la licence de téléchargement pour ce modèle (application non approuvée, ou autorisation retirée).",
					motif: "licence-refusee",
				},
				{ status: 403 }
			);
		}
		if (estQuotaDepasse(erreur)) {
			return NextResponse.json(
				{ erreur: "Quota d'appels VRoid Hub atteint, réessayez dans quelques minutes." },
				{ status: 429 }
			);
		}
		const statut = erreur instanceof ErreurVroid && erreur.statut >= 400 ? erreur.statut : 502;
		return NextResponse.json(
			{ erreur: erreur instanceof Error ? erreur.message : "Chargement du modèle en échec." },
			{ status: statut }
		);
	}
}
