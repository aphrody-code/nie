/**
 * Ancien point d'entrée des embeds — conservé comme FAÇADE de `lib/ui`.
 *
 * Les appels à `rgEmbed()` répartis dans les commandes rendent l'embed de la
 * trousse : couleur de la marque, pied portant le domaine ET son icône,
 * horodatage. Le nom est conservé tel quel — le renommer aurait touché plus de
 * cent points d'appel dans du code par ailleurs porté à l'identique, et c'est
 * exactement le genre de diff qui cache une vraie régression.
 *
 * ⚠ POUR TOUT NOUVEAU CODE : importer `lib/ui` directement. On y trouve
 * `fiche()` (budget des 6 000 caractères tenu à l'ajout), `piedDeCommande()`
 * (provenance `/agenda semaine` dans le pied), les charges de réponse
 * (`succes`, `echec`, `vide`) et la pagination normalisée. Ce fichier ne
 * garde que ce qui était déjà appelé ailleurs.
 */
import type { EmbedBuilder } from "discord.js";

import { BOT_BASE_URL } from "./config";
import { borner, creerEmbed, pied } from "./ui";

/** Embed nu à la marque du bot, pied et horodatage compris. */
export function rgEmbed(): EmbedBuilder {
	return pied(creerEmbed());
}

/** @deprecated Utiliser `borner` de `lib/ui` — même comportement, nom français. */
export function truncate(text: string | null | undefined, max = 200): string {
	return borner(text, max);
}

/** Lien absolu vers le wiki. */
export function rgUrl(path: string): string {
	return `${BOT_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Date en toutes lettres, dans le fuseau du SERVEUR.
 *
 * @deprecated Préférer `ilYA()` / `leJour()` de `lib/ui` : ces horodatages
 * natifs sont recalculés dans le fuseau du LECTEUR et ne vieillissent pas dans
 * l'historique du salon.
 */
export function fmtDate(d: Date | string | null): string {
	if (!d) return "—";
	const date = typeof d === "string" ? new Date(d) : d;
	return date.toLocaleDateString("fr-FR", {
		day: "2-digit",
		month: "long",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

export const DAYS_FR = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
