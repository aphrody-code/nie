/**
 * Poussées `rg-cron` → `rg-bot` et branchement du pont IPC UNIX.
 *
 * Deux responsabilités, une seule porte d'entrée pour `index.ts` :
 *
 *  1. `demarrerPontBot()` monte la socket UNIX (`./ipc-unix.ts`) avec le
 *     catalogue des 18 tâches et l'exécuteur du démon ;
 *  2. il démarre la VEILLE DES TWEETS, qui pousse `tweets.signal` au bot quand
 *     la récolte a écrit du nouveau.
 *
 * ⚠ Ce module ne publie RIEN sur Discord et n'écrit aucun curseur. Le signal est
 * une optimisation de réactivité ; la source de vérité de « qu'a-t-on annoncé »
 * est le curseur Postgres du bot. Un cron qui publierait « parce que le bot est
 * injoignable » recréerait le doublon au retour du bot.
 *
 * Le catalogue des tâches est un doublon assumé de celui servi par
 * `GET :3005/tasks` : la surface HTTP existante devait rester INTACTE (la page
 * d'administration du site s'en sert), donc on ne la refactorise pas pour
 * mutualiser. Le test de non-dérive, c'est la liste `/cron taches` côté bot.
 */
import { syncCdnAssets } from "../tasks/cdn";
import { runIeCrawl } from "../tasks/ie-crawl";
import { crawlHashtagCampaigns } from "../tasks/ie-crawl/hashtag-harvest";
import { runRagSync } from "../tasks/ie-crawl/rag-index";
import { runInaglePush } from "../tasks/db";
import { runDiscordSync, runDiscordChannelScan } from "../tasks/discord";
import { runDiscordMessagesSync, runDiscordMessagesBackfill } from "../tasks/discord-messages";
import { runDiscordPollsImport } from "../tasks/discord-polls";
import { runSeoIndexNow } from "../tasks/seo/indexnow";
import { runSeoLlmsTxt } from "../tasks/seo/llms-txt";
import { collecterAudienceAchillea } from "../tasks/stats/achillea";
import {
	triggerGithubPublishWorkflow,
	triggerPatreonRefresh,
	triggerPatreonReminders,
	triggerPublishScheduled,
	warmCaches,
} from "../tasks/api";
import { sql } from "./db";
import { demarrerIpcUnix, type PontIpc } from "./ipc-unix";

/**
 * Cadence de la veille.
 *
 * Un `max(created_at)` sur `tweets` coûtait 4,6 ms en Seq Scan avant l'index
 * `tweets_created_at_desc_idx` (migration `20260812_tweets_notifications.sql`),
 * et O(log n) après. Toutes les 60 s, c'est gratuit — et c'est le seul moyen
 * honnête : un déclencheur `AFTER … FOR EACH ROW` sur `tweets` produirait 629
 * notifications pour un simple rafraîchissement de compteurs (lot mesuré du
 * 12/8/2026 à 05:01, zéro tweet réellement neuf dedans).
 */
export const INTERVALLE_VEILLE_TWEETS_MS = 60_000;

/** Fonctions exécutables du démon, nom canonique → tâche. */
function catalogueTaches(): Record<string, () => Promise<unknown>> {
	return {
		db: runInaglePush,
		cdn: syncCdnAssets,
		crawl: runIeCrawl,
		rag: runRagSync,
		publish: triggerPublishScheduled,
		"github-publish": triggerGithubPublishWorkflow,
		patreon: triggerPatreonRefresh,
		reminders: () => triggerPatreonReminders("announce"),
		warm: warmCaches,
		discord: runDiscordSync,
		"discord:scan": runDiscordChannelScan,
		"discord:messages": runDiscordMessagesSync,
		"discord:backfill": runDiscordMessagesBackfill,
		"discord:polls": () => runDiscordPollsImport(),
		"x:campagnes": () => crawlHashtagCampaigns(),
		"seo:indexnow": runSeoIndexNow,
		"seo:llms-txt": runSeoLlmsTxt,
		"stats:achillea": collecterAudienceAchillea,
	};
}

/** Planifications, telles qu'annoncées par `GET :3005/tasks`. */
const PLANIFICATIONS: Record<string, string> = {
	publish: "*/15 * * * *",
	warm: "*/30 * * * *",
	db: "0 2 * * *",
	patreon: "0 3 * * *",
	cdn: "0 4 * * *",
	"github-publish": "30 4 * * *",
	crawl: "0 5 * * *",
	"seo:llms-txt": "45 5 * * *",
	"stats:achillea": "*/15 * * * *",
	"seo:indexnow": "0 6 * * *",
	reminders: "0 8 * * *",
	discord: "*/30 * * * *",
	"discord:scan": "manuel",
	"discord:messages": "*/5 * * * *",
	"discord:backfill": "manuel",
	"discord:polls": "10 * * * *",
	"x:campagnes": "20 * * * *",
	rag: "manuel",
};

export interface OptionsPontBot {
	/** Objet `metrics` du démon, lu à chaque requête (jamais copié). */
	metriques: () => unknown;
	/** Télémétrie Discord courante, ou `null`. */
	telemetrie: () => unknown;
	/**
	 * `executeTask` du démon : c'est LUI qui alimente `metrics.lastExecution`.
	 * Passer par une autre voie rendrait `/cron statut` faux.
	 */
	executer: (nom: string, fn: () => Promise<unknown>) => Promise<{ success: boolean; error?: string }>;
	/** Recherche sémantique, reprise du TCP IPC `:4001` existant. */
	queryRag?: (question: string) => Promise<unknown>;
}

/**
 * Monte le pont et la veille. Renvoie le pont (utile aux tests et à l'arrêt).
 *
 * ⚠ Ne lève JAMAIS. Le démon planifie 18 tâches de production : une socket
 * impossible à créer (dossier absent, `ReadWritePaths` mal réglé après une
 * modification d'unité) doit dégrader le pont, pas tuer le cron. Le bot, lui,
 * garde son rattrapage périodique et continue de fonctionner sans signal.
 */
export function demarrerPontBot(options: OptionsPontBot): PontIpc {
	try {
		return monterPontBot(options);
	} catch (err) {
		console.error(
			"[bot-signal] pont IPC indisponible, le cron continue sans lui :",
			err instanceof Error ? err.message : err
		);
		return { diffuser: () => undefined, abonnes: () => 0, arreter: () => undefined };
	}
}

function monterPontBot(options: OptionsPontBot): PontIpc {
	const taches = catalogueTaches();

	const pont = demarrerIpcUnix({
		metriques: options.metriques,
		telemetrie: options.telemetrie,
		catalogue: () => ({ taches: Object.keys(taches), schedules: PLANIFICATIONS }),
		lancerTache: (nom) => {
			const fn = taches[nom] ?? taches[nom.replace(/-/g, ":")];
			return fn ? options.executer(nom, fn) : null;
		},
		queryRag: options.queryRag,
	});

	demarrerVeilleTweets(pont);
	return pont;
}

/**
 * Veille des tweets : pousse `tweets.signal` quand l'archive avance.
 *
 * L'état est purement en mémoire — c'est un INDICE, pas un curseur. Un
 * redémarrage du cron le perd, et cela n'a aucune conséquence : le bot draine de
 * toute façon toutes les 5 minutes, et son curseur à lui est en base.
 */
export function demarrerVeilleTweets(pont: PontIpc): () => void {
	let dernierVu: string | null = null;
	let total = -1;

	const sonder = async (): Promise<void> => {
		try {
			const [ligne] = await sql<{ dernier: Date | null; n: number }[]>`
				SELECT max(created_at) AS dernier, count(*)::int AS n FROM public.tweets
			`;
			if (!ligne) {
				return;
			}
			const empreinte = ligne.dernier ? ligne.dernier.toISOString() : null;
			const premierTour = total < 0;
			const change = empreinte !== dernierVu || ligne.n !== total;
			dernierVu = empreinte;
			total = ligne.n;
			// Le premier tour n'annonce rien : il ne fait qu'établir la référence.
			if (!premierTour && change && pont.abonnes() > 0) {
				pont.diffuser({ event: "tweets.signal", dernier: empreinte, total: ligne.n });
			}
		} catch (err) {
			console.warn("[bot-signal] veille des tweets en échec :", err instanceof Error ? err.message : err);
		}
	};

	void sonder();
	const minuteur = setInterval(() => void sonder(), INTERVALLE_VEILLE_TWEETS_MS);
	return () => clearInterval(minuteur);
}
