/**
 * Pont natif `rg-cron` ↔ `rg-bot`, sur une SOCKET UNIX.
 *
 * ── POURQUOI PAS UN PORT DE PLUS ───────────────────────────────────────────
 * Le démon expose déjà trois surfaces réseau, et deux d'entre elles sont
 * ouvertes sur le monde (mesuré le 12/8/2026) : `:3005` et `:3006` écoutent sur
 * `*`, et `ufw` autorise `3000:3010/tcp` depuis Anywhere. Le TCP IPC `:4001`
 * n'exige, lui, AUCUNE identification — il ne doit donc jamais accueillir de
 * verbe d'écriture, et un autre processus écoute déjà `10.8.0.1:4001` sur le VPN.
 *
 * Une socket UNIX n'a pas de port, pas de secret à faire tourner, et ses
 * permissions sont appliquées par le noyau. `/var/lib/rg` appartient à `ubuntu`
 * et figure déjà dans les `ReadWritePaths` de `rg-cron.service` : aucune
 * modification d'unité systemd n'est nécessaire, ni ici ni côté bot (s'y
 * CONNECTER fonctionne sous `ProtectSystem=strict`, le noyau n'opposant `EROFS`
 * qu'aux fichiers réguliers, dossiers et liens — jamais aux sockets).
 *
 * La surface HTTP existante (`:3005`, `:3006`) n'est PAS touchée : la page
 * d'administration du site s'en sert.
 *
 * ── DEUX SENS SUR UNE SEULE SOCKET ─────────────────────────────────────────
 * Le bot ouvre des connexions courtes pour ses commandes, plus UNE connexion
 * persistante marquée par le verbe `subscribe`. Les poussées cron → bot
 * (`tweets.signal`, `task.done`) descendent par cette connexion-là : le cron n'a
 * donc jamais à se connecter au bot, dont le bac à sable ne lui permettrait pas
 * de créer une socket lisible d'ici.
 */
import { chmodSync, unlinkSync } from "node:fs";
import type { Socket } from "bun";
import { estVerbeScrape, servirVerbeScrape } from "../tasks/ie-crawl/scrape-service";

/** Chemin de la socket. Doit rester identique côté bot (`apps/bot/src/lib/cron-ipc.ts`). */
export const CHEMIN_SOCKET_CRON = Bun.env.RG_CRON_SOCKET ?? "/var/lib/rg/cron.sock";

/**
 * Tâches JAMAIS déclenchables par le pont, quelle que soit l'identité de
 * l'appelant.
 *
 * Cette liste est un DOUBLON VOLONTAIRE de `apps/bot/src/lib/cron-taches.ts` :
 * le bot refuse déjà côté Discord, mais un garde qui ne vit que chez l'appelant
 * n'est pas un garde. Si les deux listes divergent un jour, c'est la plus
 * restrictive qui gagne — et c'est celle-ci, la dernière traversée.
 */
const TACHES_INTERDITES = new Set(["db", "crawl", "github-publish", "discord:backfill"]);

/** Normalisation identique à celle du bot : `discord-backfill` ≡ `discord:backfill`. */
function normaliserNomTache(nom: string): string {
	return nom.trim().toLowerCase().replaceAll("-", ":").replace(/^github:/, "github-");
}

export interface RequeteIpc {
	cmd?: string;
	[clef: string]: unknown;
}

export interface ReponseIpc {
	success: boolean;
	error?: string;
	code?: string;
	[clef: string]: unknown;
}

export interface EvenementIpc {
	event: string;
	[clef: string]: unknown;
}

/** Ce que le démon doit fournir au pont. Aucune de ces fonctions n'est optionnelle par confort. */
export interface DependancesIpc {
	/** Métriques d'exécution (dont `lastExecution` par tâche). */
	metriques: () => unknown;
	/** Télémétrie Discord, ou `null` si la passerelle n'est pas prête. */
	telemetrie: () => unknown;
	/** Catalogue des tâches et leurs planifications. */
	catalogue: () => { taches: string[]; schedules: Record<string, string> };
	/** Lance une tâche. Renvoie `null` si le nom est inconnu du démon. */
	lancerTache: (nom: string) => Promise<{ success: boolean; error?: string }> | null;
	/** Recherche sémantique — repris du TCP IPC existant, à l'identique. */
	queryRag?: (question: string) => Promise<unknown>;
	/** Publication d'une annonce Discord (l'équivalent local de `POST :3006/announce`). */
	annoncer?: (charge: Record<string, unknown>) => Promise<{ ok: boolean; detail?: string }>;
}

export interface PontIpc {
	/** Diffuse un événement à tous les abonnés (le bot). Silencieux s'il n'y en a aucun. */
	diffuser: (evenement: EvenementIpc) => void;
	/** Nombre d'abonnés connectés. */
	abonnes: () => number;
	arreter: () => void;
}

/**
 * Verrou d'unicité par tâche.
 *
 * `executeTask` du démon n'en a AUCUN : deux `POST /tasks/db/run` d'affilée
 * lancent deux exécutions concurrentes. Le dépôt connaît déjà le prix de cette
 * absence (« Another next build process is already running »). Le pont pose donc
 * le sien sur tout ce qu'il lance — un doigt qui glisse sur `/cron lancer` ne
 * peut pas mettre deux exécutions en parallèle.
 *
 * ⚠ Portée honnête : ce verrou couvre les lancements VENUS DU PONT. Une
 * collision avec une exécution programmée par `Bun.cron` reste possible tant que
 * `executeTask` lui-même n'est pas gardé.
 */
const tachesEnCours = new Map<string, number>();

export function tacheEnCours(nom: string): boolean {
	return tachesEnCours.has(normaliserNomTache(nom));
}

export function demarrerIpcUnix(deps: DependancesIpc): PontIpc {
	const abonnes = new Set<Socket<undefined>>();
	const tampons = new WeakMap<Socket<undefined>, string>();

	try {
		unlinkSync(CHEMIN_SOCKET_CRON);
	} catch {
		// Pas de socket résiduelle : c'est le cas nominal au premier démarrage.
	}

	function diffuser(evenement: EvenementIpc): void {
		if (abonnes.size === 0) {
			return;
		}
		const ligne = `${JSON.stringify(evenement)}\n`;
		for (const socket of abonnes) {
			try {
				socket.write(ligne);
			} catch {
				abonnes.delete(socket);
			}
		}
	}

	async function repondreA(requete: RequeteIpc, socket: Socket<undefined>): Promise<ReponseIpc> {
		const verbe = typeof requete.cmd === "string" ? requete.cmd : "";

		switch (verbe) {
			case "health": {
				return { success: true, uptime: process.uptime(), abonnes: abonnes.size };
			}

			case "subscribe": {
				abonnes.add(socket);
				return { success: true, subscribed: true };
			}

			case "tasks.list":
			case "tasks.schedules": {
				return { success: true, ...deps.catalogue() };
			}

			case "metrics": {
				return { success: true, metrics: deps.metriques() };
			}

			case "telemetry.discord": {
				const telemetrie = deps.telemetrie();
				if (!telemetrie) {
					return { success: false, error: "Télémétrie Discord indisponible.", code: "indisponible" };
				}
				return { success: true, telemetry: telemetrie };
			}

			case "task.status": {
				const nom = typeof requete.nom === "string" ? requete.nom : "";
				const metriques = deps.metriques() as { lastExecution?: Record<string, unknown> };
				const derniere = metriques.lastExecution?.[nom] ?? null;
				return { success: true, nom, derniere, enCours: tacheEnCours(nom) };
			}

			case "task.run": {
				return await lancer(requete);
			}

			case "announce": {
				if (!deps.annoncer) {
					return { success: false, error: "Annonce non branchée.", code: "indisponible" };
				}
				const resultat = await deps.annoncer(requete);
				return { success: resultat.ok, error: resultat.ok ? undefined : resultat.detail };
			}

			case "query_rag": {
				if (!deps.queryRag || typeof requete.question !== "string") {
					return { success: false, error: "Question manquante.", code: "requete_invalide" };
				}
				return { success: true, results: await deps.queryRag(requete.question) };
			}

			default: {
				// Verbes de scraping (`scrape.*`, `x.*`) : les moteurs
				// `@aphrody-code/bxc` et `@aphrody-code/x` vivent ici, pas dans le
				// bot, et n'y seront pas installés (le fichier de verrouillage doit
				// rester en version 1). `servirVerbeScrape` ne lève jamais : il
				// porte ses propres délais, ses propres plafonds de débit et rend
				// toujours une réponse — un scraping ne peut donc pas arrêter le
				// démon ni monopoliser la machine. Contrat détaillé en tête de
				// `tasks/ie-crawl/scrape-service.ts`.
				if (estVerbeScrape(verbe)) {
					return await servirVerbeScrape(verbe, requete);
				}
				return { success: false, error: `Commande inconnue : « ${verbe} ».`, code: "verbe_inconnu" };
			}
		}
	}

	async function lancer(requete: RequeteIpc): Promise<ReponseIpc> {
		const demande = typeof requete.nom === "string" ? requete.nom : "";
		const cle = normaliserNomTache(demande);

		if (TACHES_INTERDITES.has(cle)) {
			console.warn(
				`[ipc-unix] refus de « ${demande} » : tâche non déclenchable à distance (demandé par ${
					typeof requete.discordId === "string" ? requete.discordId : "inconnu"
				}).`
			);
			return {
				success: false,
				error: `La tâche « ${demande} » ne peut pas être déclenchée à distance.`,
				code: "interdit",
			};
		}
		if (tachesEnCours.has(cle)) {
			const depuis = Date.now() - (tachesEnCours.get(cle) ?? Date.now());
			return {
				success: false,
				error: `La tâche « ${demande} » tourne déjà (depuis ${Math.round(depuis / 1000)} s).`,
				code: "deja_en_cours",
			};
		}

		const execution = deps.lancerTache(demande);
		if (!execution) {
			return { success: false, error: `Tâche « ${demande} » inconnue.`, code: "inconnue" };
		}

		tachesEnCours.set(cle, Date.now());
		const debut = Date.now();
		console.info(
			`[ipc-unix] lancement de « ${demande} » demandé par ${
				typeof requete.discordId === "string" ? requete.discordId : "inconnu"
			} (profil ${typeof requete.profileId === "string" ? requete.profileId : "inconnu"}).`
		);

		// Volontairement SANS `await` ici : `executeTask` peut durer plusieurs
		// minutes et l'appelant Discord n'a que 15 minutes de jeton d'interaction.
		// Le résultat repart par `task.done` sur la connexion d'abonnement.
		void (async () => {
			let verdict: { success: boolean; error?: string };
			try {
				verdict = await execution;
			} catch (err) {
				verdict = { success: false, error: err instanceof Error ? err.message : String(err) };
			}
			tachesEnCours.delete(cle);
			diffuser({
				event: "task.done",
				nom: demande,
				success: verdict.success,
				durationMs: Date.now() - debut,
				error: verdict.error,
			});
		})();

		return { success: true, demarree: true, nom: demande };
	}

	const serveur = Bun.listen<undefined>({
		unix: CHEMIN_SOCKET_CRON,
		socket: {
			async data(socket, donnees) {
				let tampon = (tampons.get(socket) ?? "") + donnees.toString();
				let coupure = tampon.indexOf("\n");
				while (coupure >= 0) {
					const ligne = tampon.slice(0, coupure).trim();
					tampon = tampon.slice(coupure + 1);
					coupure = tampon.indexOf("\n");
					if (ligne.length === 0) {
						continue;
					}
					let reponse: ReponseIpc;
					try {
						reponse = await repondreA(JSON.parse(ligne) as RequeteIpc, socket);
					} catch (err) {
						reponse = {
							success: false,
							error: err instanceof Error ? err.message : String(err),
							code: "erreur_interne",
						};
					}
					try {
						socket.write(`${JSON.stringify(reponse)}\n`);
					} catch {
						/* connexion déjà fermée par l'appelant */
					}
				}
				tampons.set(socket, tampon);
			},
			close(socket) {
				abonnes.delete(socket);
			},
			error(socket, err) {
				abonnes.delete(socket);
				console.warn("[ipc-unix] connexion en erreur :", err.message);
			},
		},
	});

	try {
		// 0600 : seul `ubuntu` — l'utilisateur des deux démons — peut s'y connecter.
		chmodSync(CHEMIN_SOCKET_CRON, 0o600);
	} catch (err) {
		console.warn("[ipc-unix] chmod de la socket impossible :", err);
	}

	console.info(`🔌 Pont IPC UNIX à l'écoute sur ${CHEMIN_SOCKET_CRON}`);

	return {
		diffuser,
		abonnes: () => abonnes.size,
		arreter: () => {
			serveur.stop(true);
			try {
				unlinkSync(CHEMIN_SOCKET_CRON);
			} catch {
				/* déjà retirée */
			}
		},
	};
}
