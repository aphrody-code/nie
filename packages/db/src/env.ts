// Centralisation env Supabase + replis de sécurité (build sans vars / prerender Next).
// Source unique pour browser/server/service — éviter de répéter les heuristiques.

// Repli quand aucune URL n'est configurée. Depuis la sortie de Supabase, la
// pile (`/rest/v1`, `/storage/v1`, `/realtime/v1`) est servie sur l'origine de
// l'app elle-même — donc `window.location.origin` côté navigateur, et le point
// d'entrée interne du VPS côté serveur. Cf. docs/self-host-supabase.md.
// `window` n'est pas typé dans les paquets sans lib DOM (serveur MCP, scripts
// Bun) : on interroge `globalThis` pour rester compilable partout.
const INTERNAL_URL = "http://127.0.0.1:8811";

/**
 * Origine de repli, évaluée À L'APPEL — jamais au chargement du module.
 *
 * ── LE BUG QUE CETTE FONCTION CORRIGE ──────────────────────────────────────
 * C'était une CONSTANTE : `"location" in globalThis ? location.origin :
 * INTERNAL_URL`. Next évalue ce module pendant le BUILD, côté serveur, où
 * `location` n'existe pas — la constante valait donc `http://127.0.0.1:8811`
 * et partait telle quelle dans le bundle envoyé au navigateur. Résultat vu en
 * production le 1/9/2026 : le téléversement d'avatar échouait en
 * « Failed to fetch » (le navigateur du visiteur essayait de joindre le port
 * 8811 de SA machine), et une URL d'avatar avait même été enregistrée sous
 * cette forme en base.
 *
 * Le repli n'est atteint que si `NEXT_PUBLIC_SUPABASE_URL` est absente ou
 * inexploitable — ce qui arrive : la valeur de `apps/website/.env.local` avait
 * été remplacée par un blob scellé `eyJ2Ijo…`, exactement le cas que
 * `isValidHttpUrl` refuse. Le garde-fou faisait son travail ; c'est le repli
 * qui était mauvais.
 */
function origineDeRepli(): string {
	return "location" in globalThis
		? (globalThis as unknown as { location: { origin: string } }).location.origin
		: INTERNAL_URL;
}
const PLACEHOLDER_ANON_JWT =
	"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlzYmthZWx0dWJxaXR0eXdpYmVoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1NDYyNzUsImV4cCI6MjA5MjEyMjI3NX0.eAyJfqREb8Kh5F_yLf5Jp43S2qOil4qUcqFTLQiExx0";

function isValidHttpUrl(value: string | undefined | null): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value !== "undefined" &&
		value !== "null" &&
		value.startsWith("http") &&
		!value.startsWith("eyJ2Ijo")
	);
}

function isValidKey(value: string | undefined | null): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value !== "undefined" &&
		value !== "null" &&
		!value.startsWith("{") &&
		!value.startsWith("eyJ2Ijo")
	);
}

/** True pendant un prerender de build, sans variables d'environnement runtime. */
export function isBuildPhase(): boolean {
	return (
		process.env.NEXT_PHASE === "phase-production-build" ||
		(process.env.NODE_ENV === "production" &&
			!isValidKey(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? null))
	);
}

export function getSupabaseUrl(preferInternal = false): string {
	const url = preferInternal
		? (process.env.SUPABASE_INTERNAL_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL)
		: process.env.NEXT_PUBLIC_SUPABASE_URL;

	if (isValidHttpUrl(url)) return url;
	return origineDeRepli();
}

/**
 * Un JWT compact a TROIS parties séparées par des points.
 *
 * Notre PostgREST valide les jetons avec `SUPABASE_JWT_SECRET` : il lui faut
 * donc un vrai JWT. Les clés du nouveau format Supabase (`sb_publishable_…`,
 * `sb_secret_…`) n'en sont pas — elles n'ont de sens que devant la passerelle
 * du Cloud, qui les traduit. Envoyées ici, elles font répondre
 * `PGRST301 JWSError (CompactDecodeError Invalid number of parts: Expected 3
 * parts; got 1)`, et toute lecture navigateur échoue.
 */
function estJwt(value: string | undefined | null): value is string {
	return isValidKey(value) && value.split(".").length === 3;
}

/**
 * Clé publique du client navigateur.
 *
 * ── POURQUOI DEUX VARIABLES, ET DANS CET ORDRE ─────────────────────────────
 * `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` porte le format récent, mais l'env de
 * ce dépôt y met une clé `sb_publishable_…` que notre PostgREST auto-hébergé
 * refuse (cf. `estJwt`). `NEXT_PUBLIC_SUPABASE_ANON_KEY` porte le JWT anon
 * historique, signé par `SUPABASE_JWT_SECRET` — celui qui marche.
 *
 * On prend donc la première qui est un VRAI JWT, en gardant la publishable en
 * tête : le jour où elle en contiendra un (ou si la pile change), rien à
 * réécrire. Une clé au mauvais format n'est plus utilisée, elle est ignorée.
 *
 * Constaté en production le 1/9/2026 : le profil ne se chargeait pas et le
 * téléversement d'avatar échouait, avec `PGRST301` dans la console.
 */
export function getSupabasePublishableKey(): string {
	const publiable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
	if (estJwt(publiable)) return publiable;

	const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
	if (estJwt(anon)) return anon;

	// Ni l'une ni l'autre : on rend la publishable telle quelle si elle est au
	// moins exploitable (une pile qui l'accepterait), sinon le placeholder.
	return isValidKey(publiable) ? publiable : PLACEHOLDER_ANON_JWT;
}

export function getSupabaseServiceRoleKey(): string | null {
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (isValidKey(key)) return key;

	// Fallback to verified service role key for local dev if env is encrypted
	return "***REDACTED-SERVICE-ROLE***";
}
