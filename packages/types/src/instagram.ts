/**
 * INSTAGRAM — analyse d'un permalien et vérification d'une publication.
 *
 * ── POURQUOI CE MODULE VIT DANS `@rosegriffon/types` ───────────────────────
 * Deux surfaces ont besoin des MÊMES règles, et se tromper d'un côté seulement
 * casserait l'autre en silence :
 *   * le site (`apps/website/src/app/iergday/actions.ts`) accepte le dépôt d'un
 *     membre — il analyse le lien collé et vérifie qu'il pointe une publication
 *     publique ;
 *   * le cron (`packages/cron/src/tasks/campagnes-instagram.ts`) REVALIDE ces
 *     mêmes liens plus tard, et masque ceux dont la publication a disparu.
 * Si le second n'employait pas le verdict du premier, un post supprimé pourrait
 * rester affiché, ou — pire — une panne de Meta ferait disparaître la galerie
 * entière. La règle est donc écrite UNE fois, ici.
 *
 * Tout est PUR ou web-standard (`fetch`, `URL`, `AbortSignal`) : aucune API
 * Node, aucun `server-only`, donc importable des deux côtés comme du navigateur.
 * L'URL du point d'entrée est un PARAMÈTRE et non une lecture d'environnement —
 * même choix que `resolveGuildId(env)` : un module partagé ne devine pas dans
 * quel processus il tourne.
 *
 * ── CE QU'INSTAGRAM LAISSE ENCORE FAIRE ────────────────────────────────────
 * `graph.facebook.com/v23.0/instagram_oembed` — celui qu'interroge
 * `verifierPublication()` ci-dessous — a été vidé : il ne rend plus que
 * `version, provider_name, provider_url, type, width, html`, et ce `html` est un
 * `<blockquote>` dont le seul texte visible est « View this post on Instagram ».
 * Ni auteur, ni miniature, ni légende (re-mesuré le 22/8/2026 : toujours ces 6
 * champs). Il ne sert donc PAS à récolter — il répond à UNE question, et il y
 * répond gratuitement et sans jeton : **cette publication existe-t-elle et
 * est-elle publique ?**
 *
 * ⚠ CE N'EST PAS LE SEUL oEMBED PUBLIC, et l'avoir cru l'a été longtemps.
 * `https://www.instagram.com/api/v1/oembed/?url=<permalien>&omitscript=true`
 * répond 200 SANS jeton lui aussi, mais rend SEIZE champs : `title` (la légende
 * entière), `author_name`, `author_url`, `author_id`, `media_id`,
 * `thumbnail_url` (640 px, signée et périssable), `thumbnail_width/height`.
 * Mesuré le 22/8/2026 en interrogeant les deux points d'entrée côte à côte sur
 * le même permalien. C'est lui qui a permis de saisir à la main les deux
 * participations Instagram d'IERG Day
 * (`apps/website/sql/migrations/20260822_iergday_participations_instagram.sql`),
 * légende et auteur compris, sans rien demander à l'autrice.
 *
 * `verifierPublication()` reste néanmoins sur `graph.facebook.com`, et ce n'est
 * pas un oubli : c'est un point d'entrée DOCUMENTÉ, dont les codes d'erreur
 * (`error.code = 24`) sont ceux que lit `verdictDepuisReponse()` — le verdict
 * d'un dépôt ne doit pas dépendre d'une route interne non contractuelle. Le
 * riche sert à LIRE (saisie manuelle, outillage), le documenté à DÉCIDER.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Permalien
// ─────────────────────────────────────────────────────────────────────────────

/** Les segments de chemin qui précèdent un shortcode chez Instagram. */
const TYPES_PUBLICATION = new Set(["p", "reel", "reels", "tv"]);

/** Un shortcode : base64url, 5 à 30 caractères (contrainte reprise en base). */
const SHORTCODE = /^[A-Za-z0-9_-]{5,30}$/;

export interface PermalienInstagram {
	/** L'identifiant de la publication chez Instagram — la clé de déduplication. */
	shortcode: string;
	/** Le permalien CANONIQUE, sans pseudo ni paramètre de traçage. */
	permalien: string;
	/** Le pseudo lu dans l'URL quand elle en porte un, sinon `null`. */
	pseudo: string | null;
}

/**
 * Analyse un permalien Instagram collé par un membre.
 *
 * C'est la partie qui décide de la DÉDUPLICATION : le shortcode est la clé
 * primaire de `campagne_creations_instagram`, et deux écritures du même post
 * doivent produire la même clé. Un participant colle son lien depuis l'appli
 * mobile, depuis le bouton « partager », depuis la barre d'adresse : les trois
 * formes diffèrent.
 *
 * Formes rencontrées, toutes vues en vrai :
 *   https://www.instagram.com/p/Db_AxXAlywQ/
 *   https://www.instagram.com/rose_griffonfr/p/Db_AxXAlywQ/
 *   https://instagram.com/p/Db_AxXAlywQ/?igsh=MzRlODBiNWFlZA==
 *   https://www.instagram.com/reel/Db_AxXAlywQ/
 *   instagram.com/p/Db_AxXAlywQ            (collé sans le protocole)
 *
 * ⚠ LE PARAMÈTRE `igsh` EST UN JETON DE TRAÇAGE. Il identifie le partageur, pas
 * la publication : le conserver reviendrait à stocker une donnée de pistage sans
 * raison, et deux membres partageant le même post créeraient deux lignes. Il est
 * retiré, comme tous les autres paramètres.
 *
 * Rend `null` sur tout ce qui n'est pas une publication : profil, story, autre
 * domaine, texte quelconque. Ne devine JAMAIS — mieux vaut refuser un lien
 * exotique que d'enregistrer un shortcode inventé qui donnera un 400 à la
 * vérification, puis une carte vide dans la galerie.
 */
export function analyserPermalien(brut: string): PermalienInstagram | null {
	const texte = (brut || "").trim();
	if (!texte) return null;

	let url: URL;
	try {
		// Un lien collé sans protocole reste un lien valide pour un humain.
		url = new URL(/^https?:\/\//i.test(texte) ? texte : `https://${texte}`);
	} catch {
		return null;
	}

	const hote = url.hostname.toLowerCase().replace(/^www\./, "");
	if (hote !== "instagram.com" && !hote.endsWith(".instagram.com")) return null;

	const segments = url.pathname.split("/").filter(Boolean);
	// `p/<code>` ou `<pseudo>/p/<code>` : on cherche le marqueur de type, où
	// qu'il soit, plutôt que de tester deux gabarits de longueur.
	const position = segments.findIndex((s) => TYPES_PUBLICATION.has(s.toLowerCase()));
	if (position === -1) return null;

	const shortcode = segments[position + 1];
	if (!shortcode || !SHORTCODE.test(shortcode)) return null;

	const pseudo = position > 0 ? (segments[position - 1] ?? null) : null;

	return {
		permalien: permalienCanonique(shortcode),
		pseudo: pseudo && /^[A-Za-z0-9._]{1,30}$/.test(pseudo) ? pseudo : null,
		shortcode,
	};
}

/**
 * Le permalien canonique d'un shortcode.
 *
 * Une seule écriture possible, partout : la base ne stocke que celle-ci, et la
 * revalidation du cron doit interroger Meta sur exactement la même URL que le
 * dépôt — sinon un lien accepté un jour serait « introuvable » le lendemain.
 */
export function permalienCanonique(shortcode: string): string {
	return `https://www.instagram.com/p/${shortcode}/`;
}

/**
 * Normalise un pseudo Instagram saisi à la main.
 *
 * Le membre écrit « @rose_griffonfr », « rose_griffonfr » ou colle l'URL de son
 * profil ; les trois désignent le même compte. Rend `null` si rien
 * d'exploitable n'en sort — un pseudo vide vaut mieux qu'un pseudo faux, la
 * galerie sait afficher « auteur inconnu ».
 */
export function normaliserPseudo(brut: string | null | undefined): string | null {
	if (typeof brut !== "string") return null;
	const propre = brut
		.trim()
		.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
		.replace(/\/.*$/, "")
		.replace(/^@+/, "");
	return /^[A-Za-z0-9._]{1,30}$/.test(propre) ? propre : null;
}

/**
 * Le hashtag de la campagne écrit dans une légende ?
 *
 * On réutilise volontairement la MÊME tolérance aux fautes que la récolte X :
 * un participant qui écrit `#IERGDya` sur Instagram fait la même faute que sur
 * X, et rien ne justifierait de l'accepter d'un côté et pas de l'autre. La
 * fonction en reprend la règle, pas le code, et se limite à l'appariement EXACT
 * après normalisation. La tolérance fine reste côté récolte, là où elle est
 * testée.
 */
export function hashtagDansLegende(
	legende: string,
	hashtags: readonly string[]
): string | null {
	const normalise = (v: string) =>
		v
			.replace(/^#+/, "")
			.normalize("NFD")
			.replace(/\p{Diacritic}/gu, "")
			.toLowerCase()
			.replace(/[^a-z0-9]/g, "");

	const ecrits = new Set(
		[...(legende || "").matchAll(/#([\p{L}\p{N}_]+)/gu)].map((m) => normalise(m[1] ?? ""))
	);
	for (const h of hashtags) {
		const cible = normalise(h);
		if (cible && ecrits.has(cible)) return h;
	}
	return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Vérification oEmbed
// ─────────────────────────────────────────────────────────────────────────────

/** Verdict de la vérification d'une publication. */
export type VerdictPublication = "publique" | "introuvable" | "indeterminee";

export interface VerificationInstagram {
	verdict: VerdictPublication;
	/** Message destiné au déposant, en français, sans jargon d'API. */
	message: string;
}

/** Point d'entrée oEmbed public de Meta — surchargeable (miroir, bouchon de test). */
export const OEMBED_INSTAGRAM = "https://graph.facebook.com/v23.0/instagram_oembed";

/**
 * Traduit une réponse oEmbed en verdict.
 *
 * PURE et exportée pour être testée sans réseau : c'est la fonction qui décide
 * si le dépôt d'un membre est accepté, et se tromper de sens ici refuserait des
 * créations légitimes en silence.
 *
 * ⚠ UN ÉCHEC RÉSEAU N'EST PAS UN REFUS. Si Meta est injoignable ou rend un 5xx,
 * le verdict est `indeterminee` et le dépôt PASSE : refuser une création parce
 * que notre vérification est en panne ferait payer au participant une panne qui
 * n'est pas la sienne. Le staff voit la ligne arriver dans son salon de suivi et
 * tranche — c'est à ça que sert le relais. Côté cron, `indeterminee` ne masque
 * rien non plus : une coupure de Meta viderait sinon la galerie d'un coup.
 */
export function verdictDepuisReponse(statut: number, corps: unknown): VerificationInstagram {
	if (statut === 200) {
		return { message: "Publication vérifiée.", verdict: "publique" };
	}

	// Meta encode la cause dans `error.code` / `error.error_subcode`. Le 400 seul
	// ne suffit pas : il couvre aussi une URL mal formée de notre côté.
	const erreur =
		typeof corps === "object" && corps !== null
			? ((corps as { error?: { code?: number; error_subcode?: number } }).error ?? {})
			: {};

	if (statut === 400 && (erreur.code === 24 || erreur.error_subcode === 2207045)) {
		return {
			message:
				"Instagram ne trouve pas cette publication. Vérifie le lien, et que ton compte n'est pas en privé.",
			verdict: "introuvable",
		};
	}

	if (statut === 400 || statut === 404) {
		return { message: "Ce lien n'est pas une publication Instagram valide.", verdict: "introuvable" };
	}

	return {
		message: "Instagram n'a pas répondu ; ta création est enregistrée et sera vérifiée par l'équipe.",
		verdict: "indeterminee",
	};
}

export interface OptionsVerification {
	/** Point d'entrée oEmbed. Défaut : `OEMBED_INSTAGRAM`. */
	base?: string;
	/** Au-delà, on ne bloque pas : on conclut « indéterminée ». Défaut : 5 s. */
	delaiMs?: number;
}

/**
 * Cette publication existe-t-elle et est-elle publique ?
 *
 * Ne lève JAMAIS : une panne réseau rend `indeterminee`, pas une exception. Les
 * deux appelants comptent là-dessus — l'un accepte quand même le dépôt, l'autre
 * s'abstient de masquer.
 */
export async function verifierPublication(
	permalien: string,
	options: OptionsVerification = {}
): Promise<VerificationInstagram> {
	const url = new URL(options.base || OEMBED_INSTAGRAM);
	url.searchParams.set("url", permalien);
	// `omitscript` allège la réponse : on ne rend jamais le `html` de Meta au
	// navigateur (il embarquerait un script tiers dans nos pages).
	url.searchParams.set("omitscript", "true");

	try {
		const reponse = await fetch(url, { signal: AbortSignal.timeout(options.delaiMs ?? 5000) });
		const corps = await reponse.json().catch(() => null);
		return verdictDepuisReponse(reponse.status, corps);
	} catch {
		return {
			message:
				"Instagram n'a pas répondu ; ta création est enregistrée et sera vérifiée par l'équipe.",
			verdict: "indeterminee",
		};
	}
}
