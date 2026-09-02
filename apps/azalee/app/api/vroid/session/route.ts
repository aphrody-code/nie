/**
 * État de la liaison VRoid Hub, pour l'îlot client de la galerie.
 *
 * `GET`  : renvoie si un compte est lié et, le cas échéant, son nom et son
 *          icône — jamais le jeton, qui reste dans un cookie `httpOnly`.
 * `DELETE` : délie le compte (révoque le jeton auprès de VRoid Hub, puis
 *          efface le cookie).
 */
import { NextResponse } from "next/server";
import { compteConnecte, estNonAutorise } from "@/lib/vroid/client";
import { lireConfigVroid } from "@/lib/vroid/config";
import { revoquerJeton } from "@/lib/vroid/oauth";
import { effacerSession, jetonValide } from "@/lib/vroid/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
	if (!lireConfigVroid()) {
		return NextResponse.json({ configure: false, connecte: false });
	}

	const jeton = await jetonValide();
	if (!jeton) return NextResponse.json({ configure: true, connecte: false });

	try {
		const compte = await compteConnecte(jeton);
		return NextResponse.json({
			configure: true,
			connecte: true,
			utilisateur: {
				id: compte.user_detail.user.id,
				nom: compte.user_detail.user.name,
				icone: compte.user_detail.user.icon.sq50?.url ?? null,
			},
		});
	} catch (erreur) {
		// Autorisation retirée depuis hub.vroid.com : on nettoie plutôt que de
		// prétendre à une session qui n'ouvre plus rien.
		if (estNonAutorise(erreur)) {
			await effacerSession();
			return NextResponse.json({ configure: true, connecte: false });
		}
		return NextResponse.json({ configure: true, connecte: true, utilisateur: null });
	}
}

export async function DELETE(): Promise<Response> {
	const config = lireConfigVroid();
	const jeton = await jetonValide();
	if (config && jeton) await revoquerJeton(config, jeton);
	await effacerSession();
	return NextResponse.json({ connecte: false });
}
