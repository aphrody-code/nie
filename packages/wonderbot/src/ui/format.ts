/**
 * Mise en forme des données IETV — module PUR.
 *
 * Tout le calcul d'affichage vit ici et se teste sans bot, sans base et sans
 * réseau. Les fichiers de commande ne font que lire puis appeler ces fonctions.
 */

import type { LanguageVersion, VideoRef } from "@aphrody/ietv";

import { ICONES, LIMITES } from "./theme.ts";

/** Épisode tel que le cache le rend : la chaîne d'origine en plus. */
export type EpisodeCatalogue = VideoRef & { channel?: string };

/** `🇫🇷 VF`, `💬 VOSTFR`, `❔ inconnue`. */
export function libelleLangue(langue: LanguageVersion): string {
	switch (langue) {
		case "vf":
			return `${ICONES.vf} VF`;
		case "vostfr":
			return `${ICONES.vostfr} VOSTFR`;
		default:
			return `${ICONES.inconnu} langue inconnue`;
	}
}

/**
 * `S01E05`, ou `S01` / `E05` quand une seule des deux valeurs est connue, ou
 * `hors série` quand aucune ne l'est. Un titre YouTube ne porte pas toujours
 * les deux.
 */
export function codeEpisode(saison: number | null, episode: number | null): string {
	const s = saison !== null ? `S${String(saison).padStart(2, "0")}` : "";
	const e = episode !== null ? `E${String(episode).padStart(2, "0")}` : "";
	if (s === "" && e === "") return "hors série";
	return `${s}${e}`;
}

/** `24 min`, `1 h 30`, `—` si la durée est inconnue. */
export function formaterDuree(secondes: number | null): string {
	if (secondes === null || !Number.isFinite(secondes) || secondes <= 0) return "—";
	const minutes = Math.round(secondes / 60);
	if (minutes < 60) return `${minutes} min`;
	const heures = Math.floor(minutes / 60);
	const reste = minutes % 60;
	return reste === 0 ? `${heures} h` : `${heures} h ${String(reste).padStart(2, "0")}`;
}

/**
 * Coupe sans jamais couper au milieu d'un lien Markdown : Discord afficherait
 * un `[texte](http` orphelin, illisible. On rend la chaîne entière quand elle
 * tient, sinon on tronque au dernier saut de ligne utile.
 */
export function bornerTexte(texte: string, limite: number): string {
	if (texte.length <= limite) return texte;
	const coupe = texte.slice(0, limite - 1);
	const dernierSaut = coupe.lastIndexOf("\n");
	return `${(dernierSaut > limite * 0.5 ? coupe.slice(0, dernierSaut) : coupe).trimEnd()}…`;
}

/** Échappe les marqueurs Markdown d'un titre venu d'une source externe. */
export function echapperMarkdown(texte: string): string {
	return texte.replace(/([*_`~|\\[\]()>])/g, "\\$1");
}

/**
 * Le titre seul, débarrassé du préfixe que les sources y collent.
 *
 * ── LE PRÉFIXE NE DIT PAS LA MÊME CHOSE QUE LE CODE ────────────────────────
 * Les sources préfixent leur titre de l'arc et d'un numéro : « Saison 3 —
 * Épisode 68 - La Sélection Japonaise ». Or ce 68 est le numéro ABSOLU dans la
 * série, tandis que le catalogue range cet épisode en S03E01. Affiché tel quel
 * à côté du code, il donne deux numéros différents pour le même épisode —
 * mesuré sur les 355 épisodes du catalogue, où les trois premiers arcs sont
 * numérotés en absolu et les suivants en relatif.
 *
 * On ne garde donc que le titre. Le numéro fait foi ailleurs : c'est le code
 * `S03E01` qui le porte, une fois.
 *
 * Rien n'est retiré quand le motif n'est pas reconnu, ni quand il ne resterait
 * rien : un titre non préfixé vaut mieux qu'un titre vide.
 */
export function titreCourt(titre: string): string {
	// Étiquettes de tête : « [VOSTFR] », « [VF] », posées par les chaînes.
	let reste = titre.trim().replace(/^(?:\[[^\]]{1,12}\]\s*)+/i, "");

	// Le préfixe, sous ses trois formes rencontrées dans le catalogue :
	//   « Saison 3 — Épisode 68 - »   (site officiel)
	//   « Épisode 12 : »              (sans nom d'arc)
	//   « Inazuma Eleven 69 - »       (chaîne YouTube, numéro nu)
	// Le troisième motif EXIGE un nom devant le nombre : sans cela, un titre
	// qui commence légitimement par un chiffre (« 11 Amis ») serait décapité.
	for (const motif of [
		/^.{0,60}?[-–—]\s*(?:épisode|episode|ép\.?|ep\.?)\s*\d+\s*(?:[-–—:]\s*)?/i,
		/^(?:épisode|episode|ép\.?|ep\.?)\s*\d+\s*[-–—:]\s*/i,
		/^[^\d\n]{2,60}?\s*\d{1,4}\s*[-–—:]\s*/,
	]) {
		const coupe = reste.replace(motif, "");
		if (coupe !== reste && coupe.trim() !== "") {
			reste = coupe;
			break;
		}
	}

	// Marqueurs de queue : « {V2} », « (v1) » — des numéros de version d'upload.
	reste = reste.replace(/\s*[{([]\s*v(?:ersion)?\s*\.?\s*\d+\s*[)\]}]\s*$/i, "");

	// Les chaînes citent le titre : « … Épisode 127 "Le coup d'envoi" ».
	reste = reste
		.trim()
		.replace(/^["“«]\s*/, "")
		.replace(/\s*["”»]$/, "")
		.trim();

	return reste === "" ? titre.trim() : reste;
}

/**
 * Le titre le moins bruité parmi les versions d'un même épisode.
 *
 * ── LA PREMIÈRE VERSION N'EST PAS LA MEILLEURE ─────────────────────────────
 * Un épisode existe sur plusieurs sources, et elles ne se valent pas : le site
 * officiel écrit « La Naissance d'Inazuma Japon », une chaîne écrit
 * « [VOSTFR] Inazuma Eleven 69 - "La Naissance d'Inazuma Japan !" {V2} ».
 * Prendre la première version rendue par le tri affichait la seconde.
 *
 * On classe donc par BRUIT — crochets, accolades, guillemets et chiffres
 * résiduels — puis par longueur. Aucune source n'est privilégiée par son nom :
 * le classement porte sur le texte, il vaudra encore pour une source future.
 */
export function meilleurTitre(versions: readonly EpisodeCatalogue[]): string {
	let meilleur: string | null = null;
	let meilleurScore = Number.POSITIVE_INFINITY;

	for (const version of versions) {
		const candidat = titreCourt(version.title ?? "");
		if (candidat === "") continue;
		const bruit = (candidat.match(/[[\]{}"«»<>|_]|\d/g) ?? []).length;
		const score = bruit * 8 + candidat.length;
		if (score < meilleurScore) {
			meilleurScore = score;
			meilleur = candidat;
		}
	}

	return meilleur ?? "";
}

/**
 * `2009-04-08` → `<t:…:D>`, l'horodatage natif de Discord.
 *
 * Il s'affiche dans le fuseau et la langue de chaque lecteur, là où une date
 * écrite en dur impose le format de celui qui l'a produite. Une date illisible
 * est rendue telle quelle plutôt que perdue.
 */
export function dateLisible(iso: string): string {
	const instant = Date.parse(`${iso}T12:00:00Z`);
	return Number.isFinite(instant) ? `<t:${Math.floor(instant / 1000)}:D>` : iso;
}

/** `サッカーやろうぜ! · Sakkā Yarō Ze!`, ou `null` si la source n'en donne pas. */
export function titreOriginal(episode: EpisodeCatalogue): string | null {
	const parts = [episode.titleJp, episode.romaji].filter(
		(part): part is string => typeof part === "string" && part.trim() !== ""
	);
	return parts.length === 0 ? null : parts.join(" · ");
}

/**
 * Vignette à poser sur un embed de liste : la première réellement fournie.
 *
 * Une liste sans image est plate, et toutes les sources n'en donnent pas —
 * prendre la première disponible plutôt que celle du premier épisode évite un
 * embed sans image parce qu'un seul épisode n'en a pas.
 */
export function premiereVignette(episodes: readonly EpisodeCatalogue[]): string | null {
	for (const episode of episodes) {
		if (typeof episode.thumbnail === "string" && episode.thumbnail.trim() !== "") {
			return episode.thumbnail;
		}
	}
	return null;
}

/**
 * Une ligne de résultat : `**S01E05** · titre`, puis langue, date, durée et
 * titre original — chaque métadonnée seulement si la source la donne.
 *
 * ── PAS DE CHAMP VIDE ──────────────────────────────────────────────────────
 * La version précédente affichait toujours `· —` pour la durée. Or aucune des
 * sources du catalogue ne donne de durée : les 355 épisodes portaient donc un
 * tiret, qui occupait la place d'une information au lieu d'en être une. Une
 * métadonnée absente ne s'affiche pas.
 */
export function ligneEpisode(episode: EpisodeCatalogue): string {
	const code = codeEpisode(episode.season, episode.episode);
	const titre = echapperMarkdown(titreCourt(episode.title));

	const details = [libelleLangue(episode.language)];
	if (episode.publishDate) details.push(dateLisible(episode.publishDate));
	if (episode.duration !== null && episode.duration > 0) {
		details.push(formaterDuree(episode.duration));
	}

	const original = titreOriginal(episode);
	const ligneOriginale = original ? `\n-# ${echapperMarkdown(original)}` : "";

	return `**${code}** · ${titre}\n${details.join(" · ")}${ligneOriginale}`;
}

/**
 * Assemble autant de lignes que le budget de description le permet et dit
 * combien ont été laissées de côté — un « et 12 autres » vaut mieux qu'une
 * liste tronquée en silence.
 */
export function listerEpisodes(
	episodes: readonly EpisodeCatalogue[],
	options: { limite?: number; budget?: number } = {}
): { texte: string; affiches: number; restants: number } {
	const limite = options.limite ?? 10;
	const budget = options.budget ?? LIMITES.description;

	const lignes: string[] = [];
	let taille = 0;

	for (const episode of episodes.slice(0, limite)) {
		const ligne = ligneEpisode(episode);
		// +2 pour le séparateur de paragraphe, +40 de marge pour la mention
		// « et N autres » qui sera peut-être ajoutée en dessous.
		if (taille + ligne.length + 2 > budget - 40) break;
		lignes.push(ligne);
		taille += ligne.length + 2;
	}

	const restants = episodes.length - lignes.length;
	const texte =
		lignes.length === 0
			? ""
			: lignes.join("\n\n") + (restants > 0 ? `\n\n*…et ${restants} autre(s).*` : "");

	return { texte, affiches: lignes.length, restants: Math.max(0, restants) };
}

/** Répartition `VF 412 · VOSTFR 388 · inconnue 12`, dans un ordre stable. */
export function repartitionLangues(parLangue: Readonly<Record<string, number>>): string {
	const ordre: LanguageVersion[] = ["vf", "vostfr", "unknown"];
	const parts = ordre
		.filter((langue) => (parLangue[langue] ?? 0) > 0)
		.map((langue) => `${libelleLangue(langue)} ${parLangue[langue]}`);
	return parts.length === 0 ? "aucun épisode" : parts.join(" · ");
}

/**
 * Horodatage relatif natif de Discord (`<t:…:R>` → « il y a 3 heures »), qui
 * s'affiche dans le fuseau de chaque lecteur. `jamais` quand le catalogue n'a
 * pas encore été rafraîchi.
 */
export function horodatageRelatif(millisecondes: number): string {
	if (!Number.isFinite(millisecondes) || millisecondes <= 0) return "jamais";
	return `<t:${Math.floor(millisecondes / 1000)}:R>`;
}

/** Tri de présentation : saison puis épisode croissants, inconnus en dernier. */
export function trierEpisodes<T extends EpisodeCatalogue>(episodes: readonly T[]): T[] {
	return [...episodes].sort((a, b) => {
		const sa = a.season ?? Number.MAX_SAFE_INTEGER;
		const sb = b.season ?? Number.MAX_SAFE_INTEGER;
		if (sa !== sb) return sa - sb;
		const ea = a.episode ?? Number.MAX_SAFE_INTEGER;
		const eb = b.episode ?? Number.MAX_SAFE_INTEGER;
		if (ea !== eb) return ea - eb;
		return a.title.localeCompare(b.title, "fr");
	});
}

/**
 * Regroupe les versions d'un même épisode. Le catalogue tient une entrée par
 * source ET par langue : présentées à plat, la saison 1 affiche cent lignes
 * pour cinquante épisodes.
 */
export function grouperParEpisode(
	episodes: readonly EpisodeCatalogue[]
): { numero: number | null; versions: EpisodeCatalogue[] }[] {
	const groupes = new Map<number | null, EpisodeCatalogue[]>();
	for (const episode of trierEpisodes(episodes)) {
		const cle = episode.episode;
		groupes.set(cle, [...(groupes.get(cle) ?? []), episode]);
	}
	return [...groupes.entries()]
		.map(([numero, versions]) => ({ numero, versions }))
		.sort((a, b) => (a.numero ?? Number.MAX_SAFE_INTEGER) - (b.numero ?? Number.MAX_SAFE_INTEGER));
}

/**
 * Une ligne par épisode, SANS lien sortant :
 * `**E05** · Le Pouvoir de Siméon · 🇫🇷 VF · 💬 VOSTFR`.
 *
 * ── POURQUOI PAS DE LIEN ───────────────────────────────────────────────────
 * Un lien Markdown ne produit aucun lecteur dans Discord : il ne fait que
 * sortir le membre du serveur, vers un site tiers. La lecture passe donc par le
 * menu déroulant du fil, qui fait répondre le bot avec le lecteur intégré —
 * personne ne quitte Discord.
 *
 * ── LE TITRE, LUI, EST REVENU ──────────────────────────────────────────────
 * Il en avait été retiré pour tenir le budget. Une liste de soixante lignes
 * `E01 · VF` ne dit pourtant rien de ce qu'on regarde, et le catalogue porte le
 * titre de chacun de ses 355 épisodes. `budgetTitre` borne sa longueur :
 * {@link listerSaison} le resserre tant que la saison ne tient pas, plutôt que
 * de laisser tomber des épisodes. `null` le retire entièrement — dernier
 * recours, avant de tronquer la liste.
 */
export function ligneSaison(
	numero: number | null,
	versions: readonly EpisodeCatalogue[],
	options: { budgetTitre?: number | null } = {}
): string {
	const code = numero !== null ? `E${String(numero).padStart(2, "0")}` : "—";
	const langues = [...new Set(versions.map((version) => libelleLangue(version.language)))];

	const budgetTitre = options.budgetTitre === undefined ? null : options.budgetTitre;
	let titre = "";
	if (budgetTitre !== null) {
		const brut = meilleurTitre(versions);
		const borne =
			brut.length > budgetTitre ? `${brut.slice(0, budgetTitre - 1).trimEnd()}…` : brut;
		if (borne !== "") titre = `${echapperMarkdown(borne)} · `;
	}

	return `**${code}** · ${titre}${langues.join(" · ")}`;
}

/**
 * Découpe la liste d'une saison en PAGES tenant chacune dans une description
 * d'embed, sans dépasser le budget total d'un message.
 *
 * Un message Discord accepte dix embeds mais 6 000 caractères en tout : une
 * saison complète ne rentre pas dans une seule description (4 096) et doit donc
 * déborder, sans jamais franchir le total.
 */
export function listerSaison(
	episodes: readonly EpisodeCatalogue[],
	options: { budgetPage?: number; budgetTotal?: number } = {}
): { pages: string[]; episodes: number; omis: number; budgetTitre: number | null } {
	const budgetPage = options.budgetPage ?? LIMITES.description;
	const budgetTotal = options.budgetTotal ?? LIMITES.totalEmbed;
	const groupes = grouperParEpisode(episodes);

	// ── ON RESSERRE LE TITRE AVANT DE PERDRE UN ÉPISODE ─────────────────────
	// Une saison de soixante épisodes en deux langues déborde du budget si
	// chaque ligne porte un titre complet. Plutôt que d'écarter les derniers
	// épisodes — ce que faisait la version sans titre, et qui rend la liste
	// fausse — on rogne le titre jusqu'à ce que la saison ENTIÈRE tienne, et
	// on ne le retire (`null`) qu'en dernier recours.
	const paliers: (number | null)[] = [72, 48, 32, 20, null];
	let dernier = rendreSaison(groupes, paliers[paliers.length - 1]!, budgetPage, budgetTotal);
	for (const budgetTitre of paliers) {
		const essai = rendreSaison(groupes, budgetTitre, budgetPage, budgetTotal);
		if (essai.omis === 0) return { ...essai, episodes: groupes.length, budgetTitre };
		dernier = essai;
	}

	// Même sans titre la saison déborde : la liste est tronquée et le dit.
	if (dernier.omis > 0 && dernier.pages.length > 0) {
		dernier.pages[dernier.pages.length - 1] += `\n\n*…et ${dernier.omis} épisode(s) de plus.*`;
	}
	return { ...dernier, episodes: groupes.length, budgetTitre: null };
}

/** Un passage de {@link listerSaison} à budget de titre fixé. */
function rendreSaison(
	groupes: readonly { numero: number | null; versions: EpisodeCatalogue[] }[],
	budgetTitre: number | null,
	budgetPage: number,
	budgetTotal: number
): { pages: string[]; omis: number } {
	const pages: string[] = [];
	let courante: string[] = [];
	let taillePage = 0;
	let tailleTotale = 0;
	let poses = 0;

	// Réserve pour le titre, les compteurs et le pied de page, qui comptent eux
	// aussi dans le total du message.
	const reserve = 400;

	for (const groupe of groupes) {
		const ligne = ligneSaison(groupe.numero, groupe.versions, { budgetTitre });
		const cout = ligne.length + 1;

		if (tailleTotale + cout > budgetTotal - reserve) break;

		if (taillePage + cout > budgetPage) {
			pages.push(courante.join("\n"));
			courante = [];
			taillePage = 0;
		}

		courante.push(ligne);
		taillePage += cout;
		tailleTotale += cout;
		poses++;
	}

	if (courante.length > 0) pages.push(courante.join("\n"));
	return { pages, omis: Math.max(0, groupes.length - poses) };
}
