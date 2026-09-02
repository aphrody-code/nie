/**
 * Le seul service interne que ce bot appelle, et rien de plus.
 *
 * ── CE QUI A ÉTÉ RETIRÉ, ET POURQUOI ───────────────────────────────────────
 * Le bot d'origine portait un CATALOGUE de dix services (`lib/services.ts`) :
 * ports en boucle locale, chemins de sonde, et surtout le nom de l'unité
 * systemd de chacun — repris tel quel dans les messages d'erreur montrés au
 * membre (« API Azalée est injoignable (unité `azalee-api.service`) »).
 *
 * C'était juste pour un bot de staff sur un serveur unique : la personne qui
 * lit le message est celle qui peut relancer l'unité. Ce bot-ci est PUBLIC.
 * Sur un serveur tiers, ou en message privé, ces noms ne servent à personne et
 * décrivent l'intérieur d'une machine à qui les lit. Ils ne partent pas.
 *
 * Ce qui reste : un appelant HTTP avec délai d'expiration et réessais, un seul
 * service déclaré, et un message d'erreur qui dit ce que la personne peut
 * faire — réessayer — sans dire où ça tourne.
 */

/** Base du moteur de recherche sémantique, en boucle locale. */
export const BASE_RAG = (Bun.env.RAG_API_URL ?? "http://127.0.0.1:8806").replace(/\/+$/, "");

/**
 * Panne d'un service interne.
 *
 * `messageLisible` est ce que voit le membre : aucune unité systemd, aucun
 * port, aucun hôte. Le détail technique reste dans `message`, qui part au
 * journal du service et nulle part ailleurs.
 */
export class ServiceIndisponibleError extends Error {
	constructor(
		message: string,
		readonly statut?: number
	) {
		super(message);
		this.name = "ServiceIndisponibleError";
	}

	/** Phrase prête à poser dans un embed, montrable à n'importe qui. */
	get messageLisible(): string {
		return this.statut !== undefined
			? `Le moteur de recherche a répondu ${this.statut}. Réessaie dans un instant.`
			: "Le moteur de recherche est momentanément injoignable. Réessaie dans un instant.";
	}
}

/** Options d'un appel. */
export interface OptionsAppel {
	/** Corps JSON. Pose `content-type` tout seul et bascule la méthode en POST. */
	corps?: unknown;
	/** Délai d'expiration par tentative. 8 s par défaut. */
	delaiMs?: number;
	/** Nombre total de tentatives, la première comprise. 3 par défaut. */
	tentatives?: number;
}

const DELAI_DEFAUT_MS = 8_000;
const TENTATIVES_DEFAUT = 3;

/** Un 5xx ou une coupure réseau se réessaient ; un 4xx est une réponse, pas une panne. */
function reessayable(statut: number): boolean {
	return statut >= 500 || statut === 429;
}

/**
 * Appelle le moteur de recherche et renvoie sa réponse JSON.
 *
 * Le délai d'expiration n'est pas une précaution de style : sans lui, un
 * service qui accepte la connexion sans jamais répondre fige la commande
 * jusqu'à l'expiration du jeton d'interaction, et le membre ne voit qu'un
 * « réfléchit… » éternel. Ici l'appel abandonne, et la commande peut dire
 * pourquoi.
 */
export async function appelRag<T>(chemin: string, options: OptionsAppel = {}): Promise<T> {
	const url = new URL(chemin.startsWith("/") ? chemin : `/${chemin}`, `${BASE_RAG}/`).toString();
	const tentatives = Math.max(1, options.tentatives ?? TENTATIVES_DEFAUT);
	const delaiMs = options.delaiMs ?? DELAI_DEFAUT_MS;

	const entetes = new Headers({ accept: "application/json" });
	let corps: string | undefined;
	if (options.corps !== undefined) {
		corps = JSON.stringify(options.corps);
		entetes.set("content-type", "application/json");
	}

	let derniere: unknown;
	for (let essai = 1; essai <= tentatives; essai++) {
		try {
			const reponse = await fetch(url, {
				method: corps === undefined ? "GET" : "POST",
				headers: entetes,
				body: corps,
				signal: AbortSignal.timeout(delaiMs),
			});

			if (!reponse.ok) {
				if (reessayable(reponse.status) && essai < tentatives) {
					derniere = new ServiceIndisponibleError(`HTTP ${reponse.status}`, reponse.status);
					await Bun.sleep(200 * 2 ** (essai - 1));
					continue;
				}
				throw new ServiceIndisponibleError(`HTTP ${reponse.status}`, reponse.status);
			}

			const texte = await reponse.text();
			if (texte.length === 0) {
				return null as T;
			}
			try {
				return JSON.parse(texte) as T;
			} catch {
				throw new ServiceIndisponibleError("réponse illisible (JSON attendu)");
			}
		} catch (err) {
			if (err instanceof ServiceIndisponibleError && err.statut !== undefined) {
				throw err;
			}
			derniere = err;
			if (essai < tentatives) {
				await Bun.sleep(200 * 2 ** (essai - 1));
			}
		}
	}

	const raison =
		derniere instanceof Error
			? derniere.name === "TimeoutError"
				? `aucune réponse en ${delaiMs} ms`
				: derniere.message
			: String(derniere);
	throw new ServiceIndisponibleError(raison);
}
