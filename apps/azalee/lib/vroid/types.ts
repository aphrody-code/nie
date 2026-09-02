/**
 * Types de l'API VRoid Hub (version d'API `11`).
 *
 * Transcription des sérialiseurs documentés sur
 * https://developer.vroid.com/en/api/list-character.html et
 * https://developer.vroid.com/en/api/load-character.html.
 *
 * ⚠ Module **client-safe** : aucun import serveur ici (ni `server-only`, ni
 * `next/headers`, ni secret). Les composants `"use client"` de la galerie
 * importent ces types ET les helpers de `./licence`.
 */

/** Enveloppe commune à toutes les réponses de l'API VRoid Hub. */
export interface ReponseVroid<T> {
	data: T;
	error?: {
		code?: string;
		message?: string;
		details?: Record<string, unknown>;
	};
	/** Lien de pagination : sa présence indique qu'une page suivante existe. */
	_links?: {
		next?: { href: string };
	};
	rand?: string;
}

/** Une déclinaison d'image (URL + dimensions). */
export interface ImageVroid {
	url: string;
	url2x: string | null;
	width: number;
	height: number;
}

/** Portrait d'un modèle, décliné en plusieurs tailles. */
export interface ImagePortrait {
	is_default_image: boolean;
	original: ImageVroid;
	w600: ImageVroid;
	w300: ImageVroid;
	sq600: ImageVroid;
	sq300: ImageVroid;
	sq150: ImageVroid;
}

/** Vue en pied d'un modèle, déclinée en plusieurs tailles. */
export interface ImageCorpsEntier {
	is_default_image: boolean;
	original: ImageVroid;
	w600: ImageVroid;
	w300: ImageVroid;
}

/** Icône d'un compte utilisateur. */
export interface IconeUtilisateur {
	is_default_image: boolean;
	sq170: ImageVroid;
	sq50: ImageVroid;
}

/** Auteur d'un modèle sur VRoid Hub. */
export interface UtilisateurVroid {
	id: string;
	pixiv_user_id: string;
	name: string;
	icon: IconeUtilisateur;
}

/** Le personnage (l'identité) auquel un modèle est rattaché. */
export interface PersonnageVroid {
	user: UtilisateurVroid;
	id: string;
	name: string;
	is_private: boolean;
	created_at: string;
	published_at: string | null;
}

/** Étiquette libre posée par l'auteur. */
export interface EtiquetteVroid {
	name: string;
	locale: string | null;
	en_name: string | null;
	ja_name: string | null;
}

/** Restriction d'âge déclarée sur un modèle. */
export interface LimiteAge {
	is_r18: boolean;
	is_r15: boolean;
	is_adult: boolean;
}

/**
 * Conditions d'utilisation d'un modèle, forme VRM 0.0.
 *
 * Source des libellés à afficher :
 * https://developer.vroid.com/en/guidelines/conditions_of_use.html
 */
export interface LicenceVrm0 {
	modification: "default" | "disallow" | "allow";
	redistribution: "default" | "disallow" | "allow";
	credit: "default" | "necessary" | "unnecessary";
	characterization_allowed_user: "default" | "author" | "everyone";
	sexual_expression: "default" | "disallow" | "allow";
	violent_expression: "default" | "disallow" | "allow";
	corporate_commercial_use: "default" | "disallow" | "allow";
	personal_commercial_use: "default" | "disallow" | "profit" | "nonprofit";
}

/**
 * Métadonnées VRM 1.0 telles que renvoyées dans
 * `latest_character_model_version.vrm_meta`.
 *
 * L'API documente ce champ en `any` ; seules les clés effectivement utilisées
 * par les guidelines d'affichage sont typées ici, et toutes en optionnel :
 * `undefined` a le sens documenté « non renseigné ».
 */
export interface MetaVrm1 {
	name?: string;
	version?: string;
	authors?: string[];
	copyrightInformation?: string;
	contactInformation?: string;
	licenseUrl?: string;
	thirdPartyLicenses?: string;
	avatarPermission?: "onlyAuthor" | "onlySeparatelyLicensedPerson" | "everyone";
	allowExcessivelyViolentUsage?: boolean;
	allowExcessivelySexualUsage?: boolean;
	allowPoliticalOrReligiousUsage?: boolean;
	allowAntisocialOrHateUsage?: boolean;
	commercialUsage?: "personalNonProfit" | "personalProfit" | "corporation";
	creditNotation?: "required" | "unnecessary";
	allowRedistribution?: boolean;
	modification?: "prohibited" | "allowModification" | "allowModificationRedistribution";
	[cle: string]: unknown;
}

/** État de la conversion du fichier côté VRoid Hub. */
export interface EtatConversion {
	current_state: "pending" | "processing" | "completed" | "failed";
}

/** Version de fichier d'un modèle (le `.vrm` proprement dit). */
export interface VersionModele {
	id: string;
	created_at: string;
	spec_version: string | null;
	exporter_version: string | null;
	triangle_count: number;
	mesh_count: number;
	mesh_primitive_count: number;
	mesh_primitive_morph_count: number;
	material_count: number;
	texture_count: number;
	joint_count: number;
	is_vendor_forbidden_use_by_others: boolean;
	is_vendor_protected_download: boolean;
	is_vendor_forbidden_other_users_preview: boolean;
	original_file_size: number | null;
	original_compressed_file_size: number | null;
	vrm_meta?: MetaVrm1 | null;
	conversion_state?: EtatConversion;
	vendor_specified_license?: LicenceVrm0;
}

/** Article BOOTH lié à une pièce du modèle. */
export interface ArticleBooth {
	booth_item_id: number;
	part_category: string | null;
}

/** Un modèle de personnage, tel que listé par l'API. */
export interface ModeleVroid {
	id: string;
	name: string | null;
	is_private: boolean;
	/** Le contributeur autorise le téléchargement du `.vrm`. */
	is_downloadable: boolean;
	is_comment_off: boolean;
	is_other_users_available: boolean;
	is_other_users_allow_viewer_preview: boolean;
	is_hearted: boolean;
	/**
	 * Champs présents dans les réponses réelles mais absents de la doc
	 * (mesurés le 2026-09-02 sur `/api/staff_picks` et
	 * `/api/search/character_models`) : typés en optionnel pour ne rien
	 * affirmer que l'API ne garantisse.
	 */
	viewer_preview_usage_level?: string;
	publication_level?: string;
	badges?: unknown[];
	portrait_image: ImagePortrait;
	full_body_image: ImageCorpsEntier;
	license?: LicenceVrm0;
	created_at: string;
	heart_count: number;
	download_count: number;
	usage_count: number;
	view_count: number;
	published_at: string | null;
	tags: EtiquetteVroid[];
	age_limit: LimiteAge;
	character: PersonnageVroid;
	latest_character_model_version?: VersionModele;
	character_model_booth_items: ArticleBooth[];
}

/** Fragment de description (texte brut, lien ou étiquette). */
export interface FragmentTexte {
	type: "plain" | "url" | "tag";
	body: string;
	normalized_body: string;
}

/** Fiche détaillée d'un modèle. */
export interface DetailModeleVroid {
	character_model: ModeleVroid;
	description_fragments: FragmentTexte[];
	reply_count: number;
	status_id: string;
	description: string;
	ogp_image_url: string;
}

/**
 * Élément renvoyé par `/api/staff_picks` et `/api/hearts` : un enrobage
 * `{ id, created_at, character_model }` autour du modèle lui-même.
 *
 * ⚠ Mesuré, pas déduit de la doc : la doc annonce `CharacterModelSerializer[]`
 * pour `/api/staff_picks`, mais l'API renvoie en réalité cet enrobage
 * (appel du 2026-09-02 : `GET /api/staff_picks?count=2` → `data[0]` porte
 * les clés `id`, `created_at`, `character_model`). `deballerModeles()` accepte
 * les deux formes.
 */
export interface EnrobageModele {
	id: string;
	created_at: string;
	character_model: ModeleVroid;
}

/** Compte connecté (`GET /api/account`). */
export interface CompteVroid {
	locale: string;
	account_sub_avatar_id: string;
	is_pixiv_status_complete: boolean;
	is_showable_on_pixiv: boolean;
	is_developer: boolean;
	is_user_privacy_policy_accepted: boolean;
	user_detail: {
		user: UtilisateurVroid;
		description: string;
		description_fragments: FragmentTexte[];
		following_count: number;
		follower_count: number;
	};
	age_limit: LimiteAge;
}

/** Licence de téléchargement à usage unique (`POST /api/download_licenses`). */
export interface LicenceTelechargement {
	id: string;
	character_model_id: string;
	character_model_version_id: string;
	is_public_visibility: boolean;
	is_private_visibility: boolean;
	expires_at: string;
}

/** Une page de modèles, aplatie et accompagnée de son curseur de pagination. */
export interface PageModeles {
	modeles: ModeleVroid[];
	/**
	 * Curseur de la page suivante : la **chaîne de requête brute** de
	 * `_links.next.href`, sans le `?` initial. `null` quand la dernière page
	 * est atteinte.
	 *
	 * On conserve la query entière plutôt qu'un `max_id` : la recherche pagine
	 * avec **plusieurs** `search_after[]` (mesuré : `search_after[]=11.53335&
	 * search_after[]=1954231`), qu'un curseur scalaire perdrait.
	 */
	curseurSuivant: string | null;
}

/** Les quatre sources de modèles exposées par l'intégration. */
export type SourceModeles = "staff_picks" | "recherche" | "compte" | "coeurs";

/** Jeton OAuth 2.0 renvoyé par `POST /oauth/token`. */
export interface JetonVroid {
	access_token: string;
	token_type: string;
	expires_in: number;
	refresh_token: string;
}
