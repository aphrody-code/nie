/**
 * Liste de modèles VRoid Hub, relayée par le serveur.
 *
 * Le navigateur n'appelle jamais `hub.vroid.com` en direct : la CSP d'azalée
 * limite `connect-src` à `'self'`, et surtout le jeton d'accès ne doit pas
 * quitter le serveur. Cette route porte les quatre sources exposées par
 * l'intégration :
 *
 * | `source`       | Endpoint VRoid Hub                | Jeton |
 * |----------------|-----------------------------------|-------|
 * | `staff_picks`  | `/api/staff_picks`                | non   |
 * | `recherche`    | `/api/search/character_models`     | non   |
 * | `compte`       | `/api/account/character_models`    | oui   |
 * | `coeurs`       | `/api/hearts`                     | oui   |
 *
 * Le curseur de pagination est opaque pour l'appelant : c'est la chaîne de
 * requête du `_links.next.href` renvoyé par VRoid Hub, réinjectée telle quelle.
 */
import { NextResponse } from "next/server";
import {
	ErreurVroid,
	estQuotaDepasse,
	mesCoeurs,
	mesModeles,
	rechercherModeles,
	selectionEditoriale,
} from "@/lib/vroid/client";
import { lireConfigVroid } from "@/lib/vroid/config";
import { jetonValide } from "@/lib/vroid/session";
import type { PageModeles, SourceModeles } from "@/lib/vroid/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Sources acceptées, pour ne pas laisser un paramètre libre atteindre l'API. */
const SOURCES = new Set<SourceModeles>(["staff_picks", "recherche", "compte", "coeurs"]);

/** Borne le nombre d'éléments demandés à ce que l'API accepte (1 à 100). */
function borner(brut: string | null, defaut: number): number {
	const valeur = Number.parseInt(brut ?? "", 10);
	if (!Number.isFinite(valeur)) return defaut;
	return Math.min(100, Math.max(1, valeur));
}

export async function GET(requete: Request): Promise<Response> {
	const url = new URL(requete.url);
	const demandee = url.searchParams.get("source") ?? "staff_picks";
	const source = SOURCES.has(demandee as SourceModeles) ? (demandee as SourceModeles) : "staff_picks";
	const curseur = url.searchParams.get("curseur");
	const nombre = borner(url.searchParams.get("nombre"), 24);
	const telechargeablesSeulement = url.searchParams.get("telechargeables") === "1";

	try {
		let page: PageModeles;

		switch (source) {
			case "recherche": {
				const motCle = url.searchParams.get("q")?.trim();
				if (!motCle) {
					return NextResponse.json(
						{ erreur: "La recherche VRoid Hub exige un mot-clé." },
						{ status: 400 }
					);
				}
				page = await rechercherModeles({ motCle, curseur, nombre, telechargeablesSeulement });
				break;
			}
			case "compte":
			case "coeurs": {
				const jeton = await jetonValide();
				if (!jeton) {
					return NextResponse.json(
						{ erreur: "Compte VRoid Hub non lié.", connexionRequise: true },
						{ status: 401 }
					);
				}
				if (source === "compte") {
					page = await mesModeles(jeton, { curseur, nombre });
				} else {
					const config = lireConfigVroid();
					if (!config) {
						return NextResponse.json({ erreur: "VRoid Hub n'est pas configuré." }, { status: 503 });
					}
					// `/api/hearts` exige `application_id` en plus du jeton.
					page = await mesCoeurs(jeton, config.applicationId, { curseur, nombre });
				}
				break;
			}
			default:
				page = await selectionEditoriale({ curseur, nombre });
		}

		return NextResponse.json({ source, ...page });
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
