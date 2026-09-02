/**
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Ré-hébergement d'un fichier Discord dans le Storage self-host.
 *
 * POURQUOI CE FICHIER EXISTE
 * Toute image venue de Discord doit être RECOPIÉE avant d'être publiée : les URL
 * `cdn.discordapp.com` sont signées (`?ex=…&is=…&hm=…`) et expirent en moins de
 * 24 h — la même URL privée de sa query répond 404. Republier ce lien, c'est
 * publier une page qui casse le lendemain. La règle est déjà appliquée côté site
 * (`apps/website/src/lib/discord/url.ts` : `estUrlDiscordExpirante`,
 * `urlPubliableOuNull`), qui préfère ne rien montrer plutôt qu'un lien mort.
 *
 * La recopie était écrite en privé dans `tasks/discord-polls.ts` (visuels de
 * sondage). Elle sert désormais aussi aux créations de campagne : elle vit donc
 * ici, où n'importe quelle tâche peut la prendre, plutôt qu'en deux copies qui
 * finiraient par diverger sur le traitement d'une URL périmée.
 */

import { resignerPiecesJointes } from "./discord-rest.js";

/** Base du service Storage self-host — JAMAIS l'origine publique côté serveur. */
export function baseStorage(): string {
	const brut = Bun.env.SUPABASE_INTERNAL_URL || "http://127.0.0.1:8811";
	return brut.replace(/\/+$/, "");
}

/** Résultat d'un téléchargement : les octets, ou le motif de l'échec. */
export type TelechargementDiscord =
	| { ok: true; octets: ArrayBuffer; typeMime: string; urlUtilisee: string }
	| { ok: false; motif: string };

/**
 * Télécharge une pièce jointe Discord, en re-signant son URL si elle a expiré.
 *
 * Sur 403/404 l'URL signée est simplement périmée : Discord sait la re-signer
 * (`POST /channels/{id}/attachments/refresh-urls`), on retente UNE fois avant
 * d'abandonner. `tailleMax` protège la mémoire du démon comme le bucket.
 */
export async function telechargerPieceJointeDiscord(
	salonId: string,
	url: string,
	tailleMax: number,
	typeMimeAttendu?: string | null,
	/**
	 * Familles de types MIME acceptées, en préfixe.
	 *
	 * Défaut `image/` : c'est ce qu'attendent les visuels de sondage et tous les
	 * appelants historiques. `campagnes-discord.ts` y ajoute `video/` — une
	 * participation à une campagne peut être une vidéo, et la refuser ici la
	 * faisait disparaître sans qu'aucun compteur ne bouge.
	 */
	prefixesAutorises: readonly string[] = ["image/"]
): Promise<TelechargementDiscord> {
	let urlUtilisee = url;
	let reponse = await fetch(urlUtilisee).catch(() => null);

	if (!reponse || reponse.status === 403 || reponse.status === 404) {
		const fraiches = await resignerPiecesJointes(salonId, [urlUtilisee]);
		const fraiche = fraiches?.[0];
		if (!fraiche) return { ok: false, motif: "URL Discord périmée et non re-signable" };
		urlUtilisee = fraiche;
		reponse = await fetch(urlUtilisee).catch(() => null);
	}

	if (!reponse?.ok) {
		return { ok: false, motif: `téléchargement Discord ${reponse?.status ?? "injoignable"}` };
	}

	const typeMime = reponse.headers.get("content-type") ?? typeMimeAttendu ?? "";
	if (!prefixesAutorises.some((prefixe) => typeMime.startsWith(prefixe))) {
		return {
			ok: false,
			motif: `type refusé (${typeMime || "inconnu"} ; attendu ${prefixesAutorises.join(" ou ")})`,
		};
	}

	const octets = await reponse.arrayBuffer();
	if (octets.byteLength > tailleMax) {
		return { ok: false, motif: `fichier trop lourd (${octets.byteLength} o)` };
	}

	return { ok: true, octets, typeMime, urlUtilisee };
}

/**
 * Écrit un objet dans un bucket du Storage self-host.
 *
 * `x-upsert: true` rend l'opération rejouable à l'infini sur un chemin
 * déterministe : une seconde passe réécrit le même octet au même endroit plutôt
 * que de créer un doublon horodaté.
 */
export async function televerserObjet(
	bucket: string,
	chemin: string,
	octets: ArrayBuffer,
	typeMime: string
): Promise<{ ok: boolean; motif?: string }> {
	const cle = Bun.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!cle) return { ok: false, motif: "SUPABASE_SERVICE_ROLE_KEY absente" };

	const envoi = await fetch(`${baseStorage()}/storage/v1/object/${bucket}/${chemin}`, {
		method: "POST",
		headers: {
			authorization: `Bearer ${cle}`,
			apikey: cle,
			"content-type": typeMime,
			"x-upsert": "true",
		},
		body: octets,
	}).catch(() => null);

	if (!envoi?.ok) {
		const texte = await envoi?.text().catch(() => "");
		return {
			ok: false,
			motif: `Storage ${envoi?.status ?? "injoignable"} ${(texte ?? "").slice(0, 120)}`,
		};
	}
	return { ok: true };
}

/**
 * URL d'origine DÉBARRASSÉE de sa signature.
 *
 * Conservée comme trace de provenance (« ce fichier vient bien de ce message »),
 * jamais servie au navigateur : `ex`/`is`/`hm` sont des jetons temporaires, les
 * garder en base donnerait l'illusion d'un lien utilisable.
 */
export function urlSansSignature(url: string): string {
	try {
		const analysee = new URL(url);
		analysee.search = "";
		return analysee.toString();
	} catch {
		return url;
	}
}
