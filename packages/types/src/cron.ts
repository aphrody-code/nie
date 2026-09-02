/**
 * Catalogue des tâches de `rg-cron.service` — contrat PARTAGÉ.
 *
 * ── POURQUOI CE FICHIER VIT ICI ET PLUS DANS LE BOT ────────────────────────
 * Trois surfaces décrivent les mêmes tâches, et jusqu'ici chacune les décrivait
 * dans son coin :
 *
 *   - `packages/cron/src/index.ts` — la vérité d'exécution (`runnerMap` et la
 *     réponse de `GET :3005/tasks`) ;
 *   - `apps/bot/src/lib/cron-taches.ts` — la politique d'accès depuis Discord ;
 *   - l'interface d'administration du site — qui n'existait pas, et qui aurait
 *     recopié la liste une troisième fois.
 *
 * Une liste recopiée est une liste qui diverge : le bot connaissait 18 tâches
 * quand le démon en servait 22 (`noctaly:import`, `campagnes:discord`,
 * `campagnes:instagram`, `campagnes:relais` manquaient), donc `/cron lancer`
 * répondait « tâche inconnue » sur quatre tâches parfaitement réelles. Le
 * catalogue est désormais UNIQUE, et `packages/mcp`/bot/site le lisent tous ici.
 *
 * ── MODULE PUR ─────────────────────────────────────────────────────────────
 * Aucune E/S, aucune dépendance. Il décrit et il classe, rien d'autre : c'est ce
 * qui permet de le couvrir par `bun test` sans démon ni base, et de l'importer
 * aussi bien dans un composant React que dans une commande Discord.
 */

/** Les 23 tâches servies par `GET :3005/tasks`. */
export const TACHES_CRON = [
	"db",
	"zukan:videos",
	"cdn",
	"crawl",
	"rag",
	"publish",
	"github-publish",
	"patreon",
	"reminders",
	"warm",
	"discord",
	"discord:scan",
	"discord:messages",
	"discord:backfill",
	"discord:polls",
	"noctaly:import",
	"x:campagnes",
	"campagnes:discord",
	"campagnes:instagram",
	"campagnes:relais",
	"seo:indexnow",
	"seo:llms-txt",
	"stats:achillea",
] as const;

export type TacheCron = (typeof TACHES_CRON)[number];

/**
 * Niveau requis pour déclencher une tâche depuis une surface d'administration
 * (Discord ou le site — la politique est la même, l'appelant ne change rien).
 *
 *  - `interdit`     : refusée quoi qu'il arrive, même à un administrateur.
 *  - `admin-strict` : rôle `admin` uniquement (pas `staff`).
 *  - `admin`        : `admin` ou `staff`.
 */
export type NiveauTache = "interdit" | "admin-strict" | "admin";

/** Familles d'affichage — sert à grouper le tableau de bord, rien de plus. */
export const FAMILLES_TACHES = [
	"donnees",
	"discord",
	"campagnes",
	"patreon",
	"seo",
	"publication",
	"stats",
] as const;

export type FamilleTache = (typeof FAMILLES_TACHES)[number];

export interface DescriptionTache {
	/** Nom canonique, tel que le démon l'accepte. */
	readonly nom: TacheCron;
	/** Libellé lisible, affiché dans une interface. */
	readonly titre: string;
	/** Ce que la tâche fait vraiment, en une phrase. */
	readonly role: string;
	/** Expression cron, ou `"manuel"` quand aucune planification ne l'appelle. */
	readonly planification: string;
	readonly famille: FamilleTache;
	readonly niveau: NiveauTache;
	/**
	 * Pourquoi la tâche est interdite, quand elle l'est. `null` sinon.
	 *
	 * Une interdiction sans motif finit toujours par être levée « parce qu'on ne
	 * sait plus pourquoi elle était là ».
	 */
	readonly motifInterdiction: string | null;
	/** Durée d'ordre de grandeur, pour prévenir avant un clic. */
	readonly dureeIndicative: string | null;
}

/**
 * Le catalogue, dans l'ordre d'affichage.
 *
 * Les planifications sont celles de `packages/cron/src/index.ts` (les appels
 * `Bun.cron`) et de la réponse `/tasks`. Les niveaux reprennent la décision
 * prise pour Discord : quatre tâches jamais déclenchables, le reste réservé au
 * rôle `admin` sauf les lectures et imports idempotents ouverts au staff.
 */
export const CATALOGUE_TACHES: readonly DescriptionTache[] = Object.freeze([
	{
		nom: "db",
		titre: "Poussée des données de jeu",
		role: "réécrit les tables `inagle_*` de production puis échange le miroir SQLite servi par le wiki",
		planification: "0 2 * * *",
		famille: "donnees",
		niveau: "interdit",
		motifInterdiction:
			"réécrit la production ET échange le miroir servi par azalee-web — une bévue de frappe ne doit pas pouvoir la lancer",
		dureeIndicative: "plusieurs minutes",
	},
	{
		nom: "zukan:videos",
		titre: "Vidéos officielles des techniques",
		role: "relit zukan.inazuma.jp et repose les vidéos, posters et vignettes que la poussée des données efface",
		planification: "0 2 * * *",
		famille: "donnees",
		niveau: "admin",
		motifInterdiction: null,
		dureeIndicative: "moins d'une minute",
	},
	{
		nom: "cdn",
		titre: "Synchronisation du CDN",
		role: "aligne les assets servis par cdn.rosegriffon.fr sur la source",
		planification: "0 4 * * *",
		famille: "donnees",
		niveau: "admin-strict",
		motifInterdiction: null,
		dureeIndicative: "quelques minutes",
	},
	{
		nom: "crawl",
		titre: "Veille officielle Inazuma",
		role: "parcourt les sources officielles et les comptes X suivis",
		planification: "0 5 * * *",
		famille: "campagnes",
		niveau: "interdit",
		motifInterdiction:
			"plusieurs minutes et consommation des quotas X (429 documentés) — le quota ne se rembourse pas",
		dureeIndicative: "plusieurs minutes",
	},
	{
		nom: "rag",
		titre: "Indexation sémantique",
		role: "recalcule les vecteurs du corpus interrogé par la recherche sémantique",
		planification: "manuel",
		famille: "donnees",
		niveau: "admin-strict",
		motifInterdiction: null,
		dureeIndicative: "plusieurs minutes",
	},
	{
		nom: "publish",
		titre: "Publication programmée",
		role: "publie les articles dont la date de parution est atteinte",
		planification: "*/15 * * * *",
		famille: "publication",
		niveau: "admin-strict",
		motifInterdiction: null,
		dureeIndicative: "quelques secondes",
	},
	{
		nom: "github-publish",
		titre: "Publication des paquets",
		role: "déclenche la publication des paquets sur GitHub Packages",
		planification: "30 4 * * *",
		famille: "publication",
		niveau: "interdit",
		motifInterdiction: "publie réellement des paquets — une publication ne se dé-publie pas",
		dureeIndicative: "quelques minutes",
	},
	{
		nom: "patreon",
		titre: "Rafraîchissement Patreon",
		role: "resynchronise les paliers et l'état des patrons",
		planification: "0 3 * * *",
		famille: "patreon",
		niveau: "admin-strict",
		motifInterdiction: null,
		dureeIndicative: "quelques secondes",
	},
	{
		nom: "reminders",
		titre: "Rappels aux patrons",
		role: "envoie les rappels d'échéance aux patrons",
		planification: "0 8 * * *",
		famille: "patreon",
		niveau: "admin-strict",
		motifInterdiction: null,
		dureeIndicative: "quelques secondes",
	},
	{
		nom: "warm",
		titre: "Préchauffage des caches",
		role: "réchauffe les caches du site et du wiki",
		planification: "*/30 * * * *",
		famille: "donnees",
		niveau: "admin",
		motifInterdiction: null,
		dureeIndicative: "quelques secondes",
	},
	{
		nom: "discord",
		titre: "Synchronisation des membres",
		role: "réécrit `discord_members` (membres, rôles, avatars)",
		planification: "*/30 * * * *",
		famille: "discord",
		niveau: "admin-strict",
		motifInterdiction: null,
		dureeIndicative: "moins d'une minute",
	},
	{
		nom: "discord:scan",
		titre: "Inventaire des salons",
		role: "réécrit `discord_channels` à partir de l'arbre du serveur",
		planification: "manuel",
		famille: "discord",
		niveau: "admin-strict",
		motifInterdiction: null,
		dureeIndicative: "quelques secondes",
	},
	{
		nom: "discord:messages",
		titre: "Veille des messages",
		role: "archive les nouveaux messages des salons armés",
		planification: "*/5 * * * *",
		famille: "discord",
		niveau: "admin",
		motifInterdiction: null,
		dureeIndicative: "quelques secondes",
	},
	{
		nom: "discord:backfill",
		titre: "Rattrapage d'historique",
		role: "réécrit en masse l'historique des messages archivés",
		planification: "manuel",
		famille: "discord",
		niveau: "interdit",
		motifInterdiction: "réécrit l'historique complet en masse — irréversible et très long",
		dureeIndicative: "des heures",
	},
	{
		nom: "discord:polls",
		titre: "Import des sondages",
		role: "importe les sondages Discord et leurs résultats",
		planification: "10 * * * *",
		famille: "discord",
		niveau: "admin",
		motifInterdiction: null,
		dureeIndicative: "quelques secondes",
	},
	{
		nom: "noctaly:import",
		titre: "Import Noctaly",
		role: "importe les niveaux et l'économie de l'ancien bot Noctaly",
		planification: "manuel",
		famille: "discord",
		niveau: "admin-strict",
		motifInterdiction: null,
		dureeIndicative: "quelques minutes",
	},
	{
		nom: "x:campagnes",
		titre: "Récolte des hashtags",
		role: "récolte les publications X des campagnes à hashtag",
		planification: "20 * * * *",
		famille: "campagnes",
		niveau: "admin-strict",
		motifInterdiction: null,
		dureeIndicative: "moins d'une minute",
	},
	{
		nom: "campagnes:discord",
		titre: "Récolte Discord",
		role: "récolte les créations postées dans les salons de campagne",
		planification: "25 * * * *",
		famille: "campagnes",
		niveau: "admin",
		motifInterdiction: null,
		dureeIndicative: "quelques secondes",
	},
	{
		nom: "campagnes:instagram",
		titre: "Revalidation Instagram",
		role: "revalide les créations Instagram déjà récoltées",
		planification: "35 * * * *",
		famille: "campagnes",
		niveau: "admin",
		motifInterdiction: null,
		dureeIndicative: "quelques secondes",
	},
	{
		nom: "campagnes:relais",
		titre: "Relais des campagnes",
		role: "relaie les créations validées dans les salons de mise en avant",
		planification: "*/15 * * * *",
		famille: "campagnes",
		niveau: "admin",
		motifInterdiction: null,
		dureeIndicative: "quelques secondes",
	},
	{
		nom: "seo:indexnow",
		titre: "Soumission IndexNow",
		role: "soumet les sitemaps à Bing, Yandex et Seznam",
		planification: "0 6 * * *",
		famille: "seo",
		niveau: "admin-strict",
		motifInterdiction: null,
		dureeIndicative: "quelques secondes",
	},
	{
		nom: "seo:llms-txt",
		titre: "Régénération llms.txt",
		role: "regénère `llms.txt` et `llm.txt` dans le dépôt local",
		planification: "45 5 * * *",
		famille: "seo",
		niveau: "admin",
		motifInterdiction: null,
		dureeIndicative: "quelques secondes",
	},
	{
		nom: "stats:achillea",
		titre: "Audience du second serveur",
		role: "rapatrie l'audience d'achillea et ranked depuis l'autre VPS",
		planification: "*/15 * * * *",
		famille: "stats",
		niveau: "admin",
		motifInterdiction: null,
		dureeIndicative: "quelques secondes",
	},
] as const satisfies readonly DescriptionTache[]);

/** Index par nom canonique, pour éviter un `find` à chaque affichage. */
const PAR_NOM = new Map<string, DescriptionTache>(
	CATALOGUE_TACHES.map((tache) => [tache.nom, tache])
);

/**
 * Normalise un nom de tâche.
 *
 * Le démon accepte les deux écritures (`discord:scan` et `discord-scan` sont
 * mappées sur la même fonction dans `runnerMap`). Sans normalisation, la liste
 * noire serait contournable en écrivant `discord-backfill`.
 */
export function normaliserNomTache(nom: string): string {
	return nom
		.trim()
		.toLowerCase()
		.replaceAll("-", ":")
		.replace(/^github:/, "github-");
}

/** Nom canonique du catalogue, ou `null` si la tâche n'existe pas. */
export function resoudreTache(nom: string | null | undefined): TacheCron | null {
	if (!nom) {
		return null;
	}
	const cible = normaliserNomTache(nom);
	return TACHES_CRON.find((tache) => normaliserNomTache(tache) === cible) ?? null;
}

/** Description complète d'une tâche, ou `null` si le nom est inconnu. */
export function decrireTache(nom: string | null | undefined): DescriptionTache | null {
	const canonique = resoudreTache(nom);
	return canonique ? (PAR_NOM.get(canonique) ?? null) : null;
}

/**
 * Niveau d'accès d'une tâche. Une tâche inconnue est traitée comme `interdit` :
 * on ne relaie pas vers le cron un nom qu'on ne sait pas classer.
 */
export function niveauTache(nom: string | null | undefined): NiveauTache {
	return decrireTache(nom)?.niveau ?? "interdit";
}

/** Le rôle passé suffit-il à déclencher cette tâche ? */
export function peutDeclencher(
	nom: string | null | undefined,
	role: string | null | undefined
): boolean {
	const niveau = niveauTache(nom);
	if (niveau === "interdit") {
		return false;
	}
	if (niveau === "admin-strict") {
		return role === "admin" || role === "superadmin";
	}
	return role === "admin" || role === "superadmin" || role === "staff";
}

/** Les tâches jamais déclenchables à distance, quelle que soit la personne. */
export const TACHES_INTERDITES: readonly TacheCron[] = Object.freeze(
	CATALOGUE_TACHES.filter((t) => t.niveau === "interdit").map((t) => t.nom)
);

/** Réservées au rôle `admin` strict. */
export const TACHES_ADMIN_STRICT: readonly TacheCron[] = Object.freeze(
	CATALOGUE_TACHES.filter((t) => t.niveau === "admin-strict").map((t) => t.nom)
);

/** Ouvertes au staff : lecture, préchauffage, imports idempotents. */
export const TACHES_ADMIN: readonly TacheCron[] = Object.freeze(
	CATALOGUE_TACHES.filter((t) => t.niveau === "admin").map((t) => t.nom)
);

/** Planifications indexées par nom — la forme rendue par `GET /tasks`. */
export const PLANIFICATIONS: Readonly<Record<TacheCron, string>> = Object.freeze(
	Object.fromEntries(CATALOGUE_TACHES.map((t) => [t.nom, t.planification])) as Record<
		TacheCron,
		string
	>
);

/**
 * Propositions d'autocomplétion pour un nom de tâche.
 *
 * `exclureInterdites` retire les tâches jamais déclenchables : ne pas les
 * proposer évite de faire miroiter une action qui sera refusée deux fois.
 */
export function suggererTaches(
	saisie: string | null | undefined,
	options: { exclureInterdites?: boolean } = {}
): string[] {
	const aiguille = normaliserNomTache(saisie ?? "");
	return TACHES_CRON.filter((tache) => {
		if (options.exclureInterdites && niveauTache(tache) === "interdit") {
			return false;
		}
		return aiguille.length === 0 || normaliserNomTache(tache).includes(aiguille);
	}).slice(0, 25);
}

/** Verbes de LECTURE du pont IPC : ouverts au staff, jamais destructeurs. */
export const VERBES_LECTURE = [
	"health",
	"tasks.list",
	"tasks.schedules",
	"metrics",
	"telemetry.discord",
	"task.status",
] as const;

export type VerbeLecture = (typeof VERBES_LECTURE)[number];

/** Phrase de refus, affichable telle quelle dans Discord ou dans le site. */
export function raisonRefus(nom: string): string {
	const tache = decrireTache(nom);
	if (!tache) {
		return `Tâche « ${nom} » inconnue. Voir \`/cron taches\`.`;
	}
	if (tache.niveau === "interdit") {
		return (
			`La tâche « ${tache.nom} » ne peut pas être déclenchée à distance : ${tache.motifInterdiction}. ` +
			`Elle reste lançable en SSH : \`bun packages/cron/src/index.ts --run ${tache.nom}\`.`
		);
	}
	return `La tâche « ${tache.nom} » exige le rôle ${tache.niveau === "admin-strict" ? "admin" : "admin ou staff"}.`;
}

// ─── Exécutions ─────────────────────────────────────────────────────────────

/** Issue d'une exécution, telle que le démon la consigne. */
export type EtatExecution = "succes" | "echec" | "en-cours";

/** D'où venait le déclenchement. */
export type OrigineExecution = "planification" | "manuel" | "discord" | "site" | "cli";

export interface ExecutionTache {
	readonly id: string;
	readonly tache: string;
	readonly etat: EtatExecution;
	readonly origine: OrigineExecution;
	/** ISO 8601. */
	readonly demarreLe: string;
	/** ISO 8601, `null` tant que la tâche tourne. */
	readonly termineLe: string | null;
	readonly dureeMs: number | null;
	readonly erreur: string | null;
	/** Charge utile rendue par la tâche, quand elle en rend une. */
	readonly resultat: unknown;
}

/** Réponse de `GET :3005/tasks`. */
export interface ReponseListeTaches {
	readonly tasks: readonly string[];
	readonly schedules: Readonly<Record<string, string>>;
}

/** Réponse de `GET :3005/health`. */
export interface SanteCron {
	readonly status: string;
	readonly uptime: number;
	readonly memory: Readonly<Record<string, number>>;
	readonly time: string;
	readonly wsConnections: number;
}
