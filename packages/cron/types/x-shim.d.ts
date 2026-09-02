/**
 * Déclarations de types de `@aphrody-code/x` — utilisées UNIQUEMENT à la compilation.
 *
 * POURQUOI CE FICHIER EXISTE
 * `@aphrody-code/x` (alias local de `@aphrody/x`, cf. `node_modules/@aphrody-code/x`
 * → `.bun/@aphrody+x@1.0.10`) publie sa SOURCE `.ts` brute (`main`/`types` →
 * `./src/index.ts`) sans aucun `.d.ts`. Laisser tsc lire cette source le fait
 * échouer sur les réglages stricts du dépôt (`strictNullChecks`,
 * `noImplicitAny`) : `bunx tsc --noEmit -p packages/cron` remonte alors une
 * quinzaine d'erreurs dans `src/config/query-ids.ts`, `src/core/client.ts`,
 * `src/services/{crawler,media,news}.ts` — du code tiers qui n'est pas le nôtre.
 * `skipLibCheck` ne couvre PAS ce cas : il ne s'applique qu'aux `.d.ts`.
 * Les `paths` de `tsconfig.typecheck.json` redirigent donc `@aphrody-code/x`
 * vers ce fichier. Les `paths` n'affectent QUE la résolution des types : l'import
 * émis reste `@aphrody-code/x` et le vrai paquet est bien chargé à l'exécution.
 *
 * CE FICHIER N'EST PAS UN STUB `any`
 * Chaque déclaration ci-dessous a été relevée dans la source réelle du paquet
 * (chemins indiqués en commentaire). Elles sont volontairement PLUS PRÉCISES que
 * le paquet lui-même sur un point : `TweetSchema` y est typé
 * `z.ZodType<any>` (`src/core/schemas.ts`), donc son `Tweet` inféré vaut `any` et
 * ne protège de rien. On redonne ici à `Tweet` la forme réellement produite par
 * `parseTweetResult` (`src/core/parse.ts`).
 *
 * Ne sont déclarés que les symboles consommés par `packages/cron`. Ajouter un
 * import du paquet impose d'ajouter sa déclaration ici, en la relevant dans la
 * source du paquet — jamais en la devinant.
 */

// ── Session (src/core/session.ts) ────────────────────────────────────────────

export interface XSessionData {
	auth_token: string;
	ct0: string;
	handle?: string;
	transaction_id?: string;
}

export class XSession implements XSessionData {
	auth_token: string;
	ct0: string;
	handle?: string;
	transaction_id?: string;
	/** Renseigné uniquement par `XSession.load()` ; requis par `save()`. */
	filePath?: string;

	constructor(data: XSessionData);

	/** Lit `~/.aphrody/x-session.json`. Lève si le fichier est absent ou invalide. */
	static load(): XSession;
	/** Lit `X_AUTH_TOKEN` / `X_CT0` (+ `X_HANDLE`, `X_TRANSACTION_ID`). Lève si absents. */
	static fromEnv(): XSession;
	/** `load()` puis repli sur `fromEnv()`. Lève si les deux échouent. */
	static loadOrEnv(): XSession;
	/** Analyse « auth_token=…; ct0=… ». Lève si l'un des deux manque. */
	static fromCookieString(str: string): XSession;

	save(): Promise<void>;
	cookieHeader(): string;
}

// ── Identifiants d'opérations GraphQL (src/config/query-ids.ts) ──────────────

export interface QueryIdSnapshot {
	fetched_at: number;
	ttl_secs: number;
	ids: Record<string, string>;
	bundles: string[];
}

export class QueryIdStore {
	constructor(cachePath?: string, ttlSecs?: number);
	get(operation: string): string | undefined;
	snapshot(): QueryIdSnapshot | null;
	isFresh(snap: QueryIdSnapshot): boolean;
	refresh(targets: string[], force?: boolean): Promise<QueryIdSnapshot>;
}

// ── Erreurs et quotas (src/core/parse.ts, src/core/client.ts) ────────────────

/**
 * Erreur émise par le client. `status` porte le code HTTP (429 sur rate-limit),
 * `code` le code d'erreur X (88 = « Rate limit exceeded »), `-1` si inconnu.
 */
export class XError extends Error {
	code: number;
	status?: number;
	constructor(message: string, code: number, status?: number);
}

export interface RateLimit {
	limit: number;
	remaining: number;
	/** Époque UNIX en SECONDES à laquelle la fenêtre de quota se réarme. */
	reset_epoch: number;
}

// ── Modèle de données (src/core/schemas.ts, src/core/parse.ts) ───────────────

export interface Author {
	username: string;
	name: string;
}

/** Média tel que construit par `parseTweetResult` depuis `extended_entities`. */
export interface TweetMedia {
	id?: string;
	/** `photo` | `video` | `animated_gif`. */
	type?: string;
	/** MP4 de plus haut débit pour une vidéo, sinon l'image d'aperçu. */
	url?: string;
	preview_url?: string;
	video_url?: string;
	width?: number;
	height?: number;
	expanded_url?: string;
}

export interface Tweet {
	id: string;
	text: string;
	author: Author;
	/** `legacy.user_id_str` — absent des tweets dont l'auteur n'est pas hydraté. */
	author_id?: string;
	/** Format X (« Wed Oct 10 20:19:24 +0000 2018 »), pas ISO 8601. */
	created_at?: string;
	reply_count: number;
	retweet_count: number;
	like_count: number;
	quote_count: number;
	view_count?: number;
	conversation_id?: string;
	in_reply_to_status_id?: string;
	lang?: string;
	is_note_tweet: boolean;
	/** Rempli seulement si `quoteDepth > 0` à l'appel. */
	quoted_tweet?: Tweet | null;
	media?: TweetMedia[];
}

export interface TweetPage {
	tweets: Tweet[];
	next_cursor?: string;
}

export interface User {
	id: string;
	username: string;
	name: string;
	description?: string;
	followers_count?: number;
	following_count?: number;
	is_blue_verified?: boolean;
	profile_image_url?: string;
	created_at?: string;
}

export interface UserPage {
	users: User[];
	next_cursor?: string;
}

export interface UserInfo {
	id: string;
	name: string;
	screen_name: string;
	followers_count?: number;
	friends_count?: number;
}

export interface TweetResult {
	id: string;
	text: string;
}

// ── Client (src/core/client.ts) ──────────────────────────────────────────────

export class XClient {
	session: XSession;
	clientUuid: string;
	clientDeviceId: string;
	queryIds: QueryIdStore;
	/** Dernier quota lu dans les en-têtes `x-rate-limit-*`, `null` avant tout appel. */
	lastRateLimit: RateLimit | null;

	constructor(session: XSession, queryIds?: QueryIdStore);

	/**
	 * Appel GraphQL brut qui ATTEND la fin de la fenêtre de quota quand le
	 * dernier appel a renvoyé `remaining: 0` (jusqu'à `maxWaitMs`, 15 min par
	 * défaut). Un 429 renvoyé par X reste levé en `XError` (`status: 429`) :
	 * l'attente ne couvre que le quota déjà connu, pas le refus en cours.
	 */
	graphqlWaiting(
		opName: string,
		variables: unknown,
		extraFeatures?: unknown,
		maxWaitMs?: number
	): Promise<unknown>;

	/** `product` : « Latest » (chronologique) ou « Top » (engagement). */
	search(
		query: string,
		count: number,
		cursor?: string,
		product?: string,
		quoteDepth?: number
	): Promise<TweetPage>;

	userTweets(
		userId: string,
		count: number,
		cursor?: string,
		quoteDepth?: number
	): Promise<TweetPage>;

	/** Lève une `XError` si X ne renvoie pas `data.user.result`. */
	userByScreenName(handle: string): Promise<UserInfo>;
	userIdFor(handle: string): Promise<string>;

	/** `null` quand le post est supprimé, protégé ou remplacé par une pierre tombale. */
	getTweet(tweetId: string, quoteDepth?: number): Promise<Tweet | null>;
	thread(tweetId: string, cursor?: string, quoteDepth?: number): Promise<TweetPage>;

	whoami(): Promise<UserInfo>;
	createTweet(text: string, replyTo?: string): Promise<TweetResult>;
}

// ── Radar (src/services/radar.ts, src/config/radar-surface.ts) ───────────────

export type RadarSearchProduct = "Latest" | "Top";

export interface RadarSearchOptions {
	/** 40 par défaut. */
	count?: number;
	cursor?: string;
	/** « Latest » par défaut. */
	product?: RadarSearchProduct;
	/** 0 par défaut ici (contrairement à `XClient.search`). */
	quoteDepth?: number;
	/** Remplace `querySource` (« radar » par défaut). */
	querySource?: string;
}

/**
 * `SearchTimeline` avec `querySource: "radar"` — la recherche telle que la lance
 * l'interface X Radar. Passe par `graphqlWaiting` : même comportement de quota.
 */
export function radarSearch(
	client: XClient,
	rawQuery: string,
	opts?: RadarSearchOptions
): Promise<TweetPage>;
