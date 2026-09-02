/**
 * Fiche détaillée d'un modèle VRoid Hub — `GET /api/character_models/{id}`.
 *
 * Endpoint public (mesuré le 2026-09-02 : 200 sans en-tête `Authorization`),
 * mais relayé quand même : c'est le seul appel qui renvoie la description et,
 * pour un modèle VRM 1.0, les métadonnées de licence complètes — indispensables
 * pour afficher les conditions d'utilisation imposées par pixiv avant tout
 * chargement du `.vrm`.
 */
import { NextResponse } from "next/server";
import { detailModele, ErreurVroid, estQuotaDepasse } from "@/lib/vroid/client";
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

	try {
		// Le jeton est facultatif : il n'ajoute que `is_hearted` pour l'internaute
		// connecté. Son absence ne doit pas priver un visiteur de la fiche.
		const jeton = (await jetonValide()) ?? undefined;
		return NextResponse.json(await detailModele(id, { jeton }));
	} catch (erreur) {
		if (estQuotaDepasse(erreur)) {
			return NextResponse.json(
				{ erreur: "Quota d'appels VRoid Hub atteint, réessayez dans quelques minutes." },
				{ status: 429 }
			);
		}
		const statut = erreur instanceof ErreurVroid && erreur.statut >= 400 ? erreur.statut : 502;
		return NextResponse.json(
			{ erreur: erreur instanceof Error ? erreur.message : "Appel VRoid Hub en échec." },
			{ status: statut }
		);
	}
}
