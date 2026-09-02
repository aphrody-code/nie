/**
 * Client typé de l'API VRoid Hub (version `11`).
 *
 * Pourquoi un client dédié plutôt que `fetchJson` de `@rosegriffon/azalee/net` :
 * VRoid Hub impose un en-tête propriétaire (`X-Api-Version`), un `Authorization:
 * Bearer` variable selon l'internaute connecté, distingue `401` (pas de jeton) de
 * `403` (jeton sans le scope) et `429` (quota d'application non approuvée) — trois
 * cas que l'appelant doit pouvoir traiter séparément, là où `fetchJson` réduit
 * tout échec à `null`.
 *
 * Ce qui est **public** (mesuré le 2026-09-02, sans en-tête `Authorization`) :
 *   - `GET /api/staff_picks` → 200
 *   - `GET /api/search/character_models?keyword=…` → 200
 *   - `GET /api/character_models/{id}` → 200
 * Ce qui exige un jeton (`401 COMMON_SIGNED_IN_REQUIRED` sinon) :
 *   - `GET /api/account`, `GET /api/hearts`, `GET /api/account/character_models`
 *   - toute la chaîne `POST /api/download_licenses` → `.vrm`
 *
 * Module **neutre** : la configuration et le jeton lui sont passés en paramètre,
 * il ne lit ni `process.env` ni les cookies. Il reste néanmoins destiné au
 * serveur — c'est `app/api/vroid/**` qui l'appelle, jamais le navigateur.
 *
 * Sources : https://developer.vroid.com/en/api/list-character.html
 *           https://developer.vroid.com/en/api/load-character.html
 */
import { BASE_VROID, VERSION_API_VROID } from "./constantes";
import type {
	CompteVroid,
	DetailModeleVroid,
	EnrobageModele,
	LicenceTelechargement,
	ModeleVroid,
	PageModeles,
	ReponseVroid,
} from "./types";

/** Échec d'un appel à l'API VRoid Hub, statut HTTP conservé. */
export class ErreurVroid extends Error {
	constructor(
		message: string,
		/** Statut HTTP renvoyé (`0` si la requête n'a pas abouti). */
		readonly statut: number,
		/** Code d'erreur applicatif VRoid Hub, ex. `COMMON_SIGNED_IN_REQUIRED`. */
		readonly code?: string
	) {
		super(message);
		this.name = "ErreurVroid";
	}
}

/** L'appel demande une autorisation que l'internaute n'a pas encore donnée. */
export function estNonAutorise(erreur: unknown): boolean {
	return erreur instanceof ErreurVroid && (erreur.statut === 401 || erreur.statut === 403);
}

/** Le quota d'appels de l'application non approuvée est épuisé. */
export function estQuotaDepasse(erreur: unknown): boolean {
	return erreur instanceof ErreurVroid && erreur.statut === 429;
}

/** Options communes à tous les appels. */
export interface OptionsAppel {
	/** Jeton d'accès OAuth ; omis pour les endpoints publics. */
	jeton?: string;
	/** Annulation depuis l'appelant (route Next qui abandonne). */
	signal?: AbortSignal;
}

/** En-têtes obligatoires de tout appel à l'API. */
function enTetes(jeton?: string, extra?: Record<string, string>): Headers {
	const entetes = new Headers({
		"X-Api-Version": VERSION_API_VROID,
		Accept: "application/json",
		...extra,
	});
	if (jeton) entetes.set("Authorization", `Bearer ${jeton}`);
	return entetes;
}

/**
 * Exécute un appel et décode l'enveloppe `{ data, error, _links }`.
 *
 * @throws {ErreurVroid} sur statut non-2xx, sur corps illisible, ou quand
 *   l'enveloppe porte un `error.code` malgré un statut 2xx.
 */
async function appeler<T>(
	chemin: string,
	options: OptionsAppel & { methode?: string; corps?: unknown } = {}
): Promise<ReponseVroid<T>> {
	const url = new URL(chemin, BASE_VROID);
	const aCorps = options.corps !== undefined;

	let reponse: Response;
	try {
		reponse = await fetch(url, {
			method: options.methode ?? "GET",
			headers: enTetes(options.jeton, aCorps ? { "Content-Type": "application/json" } : undefined),
			body: aCorps ? JSON.stringify(options.corps) : undefined,
			signal: options.signal,
			// Les réponses dépendent du jeton : jamais de cache partagé.
			cache: "no-store",
		});
	} catch (cause) {
		throw new ErreurVroid(`VRoid Hub injoignable (${chemin}).`, 0, String(cause));
	}

	let charge: ReponseVroid<T> | null = null;
	try {
		charge = (await reponse.json()) as ReponseVroid<T>;
	} catch {
		charge = null;
	}

	if (!reponse.ok) {
		throw new ErreurVroid(
			charge?.error?.message ?? `VRoid Hub a répondu ${reponse.status} sur ${chemin}.`,
			reponse.status,
			charge?.error?.code
		);
	}
	if (!charge) {
		throw new ErreurVroid(`Réponse illisible de VRoid Hub sur ${chemin}.`, reponse.status);
	}
	// Un 200 peut tout de même porter une erreur applicative dans l'enveloppe.
	if (charge.error?.code) {
		throw new ErreurVroid(charge.error.message ?? charge.error.code, reponse.status, charge.error.code);
	}
	return charge;
}

/**
 * Aplatit `data` : selon l'endpoint, l'API renvoie soit les modèles
 * directement (`/api/search/character_models`), soit un enrobage
 * `{ id, created_at, character_model }` (`/api/staff_picks`, `/api/hearts`).
 *
 * Les deux formes sont acceptées, car la doc annonce la première pour
 * `staff_picks` alors que l'API sert la seconde (mesuré le 2026-09-02).
 *
 * @param data le tableau brut de l'enveloppe.
 * @returns les modèles, dans l'ordre reçu.
 */
export function deballerModeles(data: (ModeleVroid | EnrobageModele)[] | null | undefined): ModeleVroid[] {
	if (!Array.isArray(data)) return [];
	return data
		.map((entree) =>
			entree && typeof entree === "object" && "character_model" in entree
				? (entree as EnrobageModele).character_model
				: (entree as ModeleVroid)
		)
		.filter((modele): modele is ModeleVroid => Boolean(modele?.id));
}

/**
 * Extrait le curseur de page suivante de `_links.next.href`.
 *
 * On garde la **chaîne de requête entière** : la recherche pagine avec
 * plusieurs `search_after[]` qu'un curseur scalaire perdrait.
 *
 * @returns la query sans `?`, ou `null` s'il n'y a pas de page suivante.
 */
export function curseurSuivant(reponse: ReponseVroid<unknown>): string | null {
	const href = reponse._links?.next?.href;
	if (!href) return null;
	const interrogation = href.indexOf("?");
	if (interrogation < 0) return null;
	const query = href.slice(interrogation + 1);
	// L'API termine parfois la query par un `&` orphelin (mesuré sur la recherche).
	const propre = query.replace(/&+$/, "");
	return propre.length > 0 ? propre : null;
}

/** Assemble un chemin et des paramètres, en repartant d'un curseur s'il y en a un. */
function cheminPagine(base: string, curseur: string | null, params: Record<string, string | undefined>): string {
	// Le curseur porte déjà tous les paramètres de la requête d'origine.
	const recherche = new URLSearchParams(curseur ?? "");
	for (const [cle, valeur] of Object.entries(params)) {
		if (valeur !== undefined && !recherche.has(cle)) recherche.set(cle, valeur);
	}
	const query = recherche.toString();
	return query ? `${base}?${query}` : base;
}

/** Transforme une réponse de liste en `PageModeles`. */
function enPage(reponse: ReponseVroid<(ModeleVroid | EnrobageModele)[]>): PageModeles {
	return { modeles: deballerModeles(reponse.data), curseurSuivant: curseurSuivant(reponse) };
}

/**
 * Sélection éditoriale de VRoid Hub — `GET /api/staff_picks`. **Public.**
 *
 * @param curseur curseur renvoyé par l'appel précédent, ou `null` pour la 1re page.
 * @param nombre nombre de modèles par page (1 à 100, défaut 20 côté API).
 */
export async function selectionEditoriale(
	{ curseur = null, nombre = 24 }: { curseur?: string | null; nombre?: number } = {},
	options: OptionsAppel = {}
): Promise<PageModeles> {
	const chemin = cheminPagine("/api/staff_picks", curseur, { count: String(nombre) });
	return enPage(await appeler<(ModeleVroid | EnrobageModele)[]>(chemin, options));
}

/**
 * Recherche de modèles — `GET /api/search/character_models`. **Public.**
 *
 * @param motCle mot-clé obligatoire côté API.
 * @param telechargeablesSeulement restreint aux modèles dont l'auteur autorise
 *   le téléchargement — les seuls chargeables par une application non approuvée.
 * @param tri `_score` (pertinence, défaut) ou `first_published_at` (date de
 *   première publication).
 *
 * ⚠ Le score de pertinence **n'est pas stable d'un appel à l'autre** : mesuré
 * le 2026-09-02, deux recherches identiques à quelques secondes d'écart rendent
 * des bornes `search_after[]` différentes (`10.654884` puis `10.653978` sur le
 * même mot-clé), et trois pages enchaînées en `_score` ont ramené **12
 * identifiants uniques sur 14** — deux modèles vus deux fois. Le même
 * enchaînement en `first_published_at` sort à 10/10.
 *
 * On garde `_score` par défaut (c'est la pertinence qu'attend une recherche),
 * mais **l'appelant doit dédupliquer par `id`** — ce que fait la galerie.
 */
export async function rechercherModeles(
	{
		motCle,
		curseur = null,
		nombre = 24,
		telechargeablesSeulement = false,
		tri = "_score",
	}: {
		motCle: string;
		curseur?: string | null;
		nombre?: number;
		telechargeablesSeulement?: boolean;
		tri?: "_score" | "first_published_at";
	},
	options: OptionsAppel = {}
): Promise<PageModeles> {
	const chemin = cheminPagine("/api/search/character_models", curseur, {
		keyword: motCle,
		count: String(nombre),
		sort: tri,
		is_downloadable: telechargeablesSeulement ? "true" : undefined,
	});
	return enPage(await appeler<(ModeleVroid | EnrobageModele)[]>(chemin, options));
}

/**
 * Fiche détaillée d'un modèle — `GET /api/character_models/{id}`. **Public.**
 *
 * C'est le seul endpoint qui renvoie la description et, pour un modèle
 * VRM 1.0, les métadonnées de licence complètes.
 */
export async function detailModele(id: string, options: OptionsAppel = {}): Promise<DetailModeleVroid> {
	const reponse = await appeler<DetailModeleVroid>(
		`/api/character_models/${encodeURIComponent(id)}`,
		options
	);
	return reponse.data;
}

/**
 * Compte connecté — `GET /api/account`. **Jeton requis.**
 */
export async function compteConnecte(jeton: string, options: OptionsAppel = {}): Promise<CompteVroid> {
	const reponse = await appeler<CompteVroid>("/api/account", { ...options, jeton });
	return reponse.data;
}

/**
 * Modèles déposés par l'internaute connecté —
 * `GET /api/account/character_models`. **Jeton requis.**
 *
 * @param publication `published` (défaut API), `private` ou `all`.
 */
export async function mesModeles(
	jeton: string,
	{
		curseur = null,
		nombre = 24,
		publication,
	}: { curseur?: string | null; nombre?: number; publication?: "published" | "private" | "all" } = {},
	options: OptionsAppel = {}
): Promise<PageModeles> {
	const chemin = cheminPagine("/api/account/character_models", curseur, {
		count: String(nombre),
		publication,
	});
	return enPage(await appeler<(ModeleVroid | EnrobageModele)[]>(chemin, { ...options, jeton }));
}

/**
 * Modèles « likés » par l'internaute — `GET /api/hearts`. **Jeton requis**,
 * scope `heart`, et `application_id` est un paramètre **obligatoire**.
 *
 * L'API ne documente aucun endpoint pour *poser* ou *retirer* un cœur : le
 * scope `heart` n'ouvre que cette lecture.
 * Source : https://developer.vroid.com/en/api/list-character.html
 */
export async function mesCoeurs(
	jeton: string,
	applicationId: string,
	{ curseur = null, nombre = 24 }: { curseur?: string | null; nombre?: number } = {},
	options: OptionsAppel = {}
): Promise<PageModeles> {
	const chemin = cheminPagine("/api/hearts", curseur, {
		application_id: applicationId,
		count: String(nombre),
	});
	return enPage(await appeler<(ModeleVroid | EnrobageModele)[]>(chemin, { ...options, jeton }));
}

/**
 * Émet une licence de téléchargement — `POST /api/download_licenses`.
 * **Jeton requis.**
 *
 * Une application non approuvée n'obtient de licence que pour les modèles
 * déposés par l'internaute lui-même ou marqués téléchargeables par leur auteur.
 * Source : https://developer.vroid.com/en/api/recognize.html
 */
export async function emettreLicenceTelechargement(
	jeton: string,
	idModele: string,
	options: OptionsAppel = {}
): Promise<LicenceTelechargement> {
	const reponse = await appeler<LicenceTelechargement>("/api/download_licenses", {
		...options,
		jeton,
		methode: "POST",
		corps: { character_model_id: idModele },
	});
	return reponse.data;
}

/**
 * Résout l'URL S3 pré-signée du `.vrm` —
 * `GET /api/download_licenses/{id}/download`. **Jeton requis.**
 *
 * L'API répond `302` : la redirection n'est **pas** suivie (`redirect: "manual"`),
 * seule l'en-tête `Location` nous intéresse.
 *
 * @returns l'URL de téléchargement, à usage unique et de courte durée.
 * @throws {ErreurVroid} si la licence est invalide ou l'en-tête `Location` absente.
 */
export async function urlTelechargementVrm(
	jeton: string,
	idLicence: string,
	options: OptionsAppel = {}
): Promise<string> {
	const url = new URL(`/api/download_licenses/${encodeURIComponent(idLicence)}/download`, BASE_VROID);

	const reponse = await fetch(url, {
		method: "GET",
		headers: enTetes(jeton),
		redirect: "manual",
		signal: options.signal,
		cache: "no-store",
	});

	const emplacement = reponse.headers.get("location");
	if (emplacement) return emplacement;

	throw new ErreurVroid(
		`VRoid Hub n'a pas renvoyé d'URL de téléchargement (statut ${reponse.status}).`,
		reponse.status
	);
}

/**
 * Chaîne complète « identifiant de modèle → URL du `.vrm` » :
 * émission de la licence puis résolution de l'URL pré-signée.
 */
export async function resoudreVrm(
	jeton: string,
	idModele: string,
	options: OptionsAppel = {}
): Promise<{ licence: LicenceTelechargement; url: string }> {
	const licence = await emettreLicenceTelechargement(jeton, idModele, options);
	const url = await urlTelechargementVrm(jeton, licence.id, options);
	return { licence, url };
}
