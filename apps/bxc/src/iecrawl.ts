/**
 * `iecrawl` — le balayage des sites officiels Inazuma Eleven de LEVEL-5.
 *
 * ── CE QUE C'EST, ET CE QUE CE N'EST PAS ───────────────────────────────────
 * `iecrawl` n'a jamais été une commande : c'est le NOM du balayage dont les
 * comptes rendus vivent dans `data/ie-crawl/` (`inazuma_analysis.md`,
 * `bxc_features.md`), fait à la main avec le moteur `@aphrody/bxc`. Ce module
 * n'invente donc rien : il rejoue ce balayage, mais en le rendant rejouable et
 * en écrivant un état machine à côté des comptes rendus.
 *
 * Deux surfaces, deux moteurs — c'est la cartographie de
 * `data/ie-crawl/inazuma_analysis.md` qui les distingue :
 *
 *   • `www.inazuma.jp` — portail LEVEL-5, HTML rendu côté serveur derrière le
 *     CDN IIJ. Le profil `static` suffit : pas de JavaScript à exécuter, donc
 *     pas de navigateur à lancer.
 *   • `zukan.inazuma.jp` — le codex des joueurs, PHP 8 derrière un ALB AWS.
 *     C'est `@aphrody/zukan` qui le lit, avec SON profil à lui (`fast`), et il
 *     lui faut un moteur de rendu.
 *
 * ── UN ÉCHEC N'ARRÊTE PAS LE WORKFLOW ──────────────────────────────────────
 * Les deux sites sont HORS de notre contrôle et le codex demande un navigateur
 * qui peut manquer sur la machine. Le balayage rapporte donc ses échecs au lieu
 * de lever : le workflow qui l'enchaîne doit pouvoir passer à l'étape suivante
 * — le catalogue d'épisodes ne dépend pas du codex.
 */

import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/** Profils de transport de `@aphrody/bxc`, dans l'ordre de coût croissant. */
export type ProfilBxc = "static" | "http" | "fast" | "stealth" | "max";

/** Une page du portail officiel, telle que le balayage la voit. */
export interface PageOfficielle {
	url: string;
	/** Code HTTP, `0` quand la requête n'a même pas abouti. */
	statut: number;
	/** `<title>` de la page, `null` s'il n'y en a pas. */
	titre: string | null;
	/** Taille du HTML servi, en octets. */
	octets: number;
	/** Liens sortants distincts, bornés — sert à repérer une refonte du site. */
	liens: string[];
	/** Message d'échec, `null` quand la page a répondu. */
	erreur: string | null;
}

/** Ce que le codex a rendu, ou pourquoi il n'a rien rendu. */
export interface ResultatCodex {
	/** Nombre de fiches de personnages listées. */
	personnages: number;
	/** Les premières fiches, pour qu'un rapport dise autre chose qu'un nombre. */
	echantillon: { id: string; nom: string }[];
	erreur: string | null;
}

export interface ResultatIeCrawl {
	/** Horodatage ISO du balayage. */
	date: string;
	portail: PageOfficielle[];
	codex: ResultatCodex;
	/** Fichier d'état écrit, `null` en `--dry-run`. */
	fichier: string | null;
	dureeMs: number;
}

export interface OptionsIeCrawl {
	/** Répertoire d'état. Défaut : `data/ie-crawl` sous la racine du dépôt. */
	repertoire?: string;
	/** Profil de transport du portail. Défaut : `static`. */
	profil?: ProfilBxc;
	/** Balayer le codex `zukan.inazuma.jp`. Défaut : vrai. */
	codex?: boolean;
	/** Ne rien écrire sur le disque. */
	dryRun?: boolean;
	/** Trace de progression. */
	journaliser?: (message: string) => void;
}

/**
 * Les pages du portail relevées par `data/ie-crawl/inazuma_analysis.md`.
 *
 * La racine `inazuma.jp` est là VOLONTAIREMENT bien qu'elle réponde 301 : sa
 * redirection vers `/victory-road/` fait partie de ce qu'on surveille.
 */
export const PAGES_PORTAIL: readonly string[] = [
	"https://inazuma.jp/",
	"https://www.inazuma.jp/victory-road/",
	"https://zukan.inazuma.jp/",
];

/** Nom du fichier d'état, à côté des comptes rendus rédigés à la main. */
export const FICHIER_ETAT = "iecrawl.json";

/** Au-delà, on ne décrit plus une page : on la recopie. */
const PLAFOND_LIENS = 50;

/** `<title>` de la page, sans entités ni espaces superflus. */
export function titreDuHtml(html: string): string | null {
	const trouve = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
	if (!trouve?.[1]) return null;
	const titre = trouve[1]
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#0*39;|&apos;/g, "'")
		.replace(/\s+/g, " ")
		.trim();
	return titre === "" ? null : titre;
}

/**
 * Liens sortants absolus, dédoublonnés et bornés.
 *
 * Les `href` relatifs sont résolus contre la page : un lien `../zukan/` n'a
 * aucun sens conservé tel quel, et une URL invalide est simplement ignorée
 * plutôt que fatale.
 */
export function liensDuHtml(html: string, base: string): string[] {
	const liens = new Set<string>();
	for (const trouve of html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)) {
		const brut = trouve[1];
		if (!brut || brut.startsWith("#") || brut.startsWith("javascript:")) continue;
		try {
			liens.add(new URL(brut, base).toString());
		} catch {
			// Un href illisible ne doit pas faire perdre les autres.
		}
		if (liens.size >= PLAFOND_LIENS) break;
	}
	return [...liens];
}

/** Racine du dépôt niers, déduite de l'emplacement de ce fichier. */
export function racineDepot(): string {
	return resolve(import.meta.dir, "../../..");
}

/**
 * Répertoire d'état par défaut.
 *
 * `IE_CRAWL_DIR` a le dernier mot : le service systemd tourne sous
 * `ProtectHome=`, et écrire dans le dépôt n'y est pas toujours permis.
 */
export function repertoireParDefaut(env: Record<string, string | undefined> = Bun.env): string {
	const impose = (env.IE_CRAWL_DIR ?? "").trim();
	return impose !== "" ? impose : join(racineDepot(), "data", "ie-crawl");
}

/** Relève une page du portail. Ne lève jamais : l'échec est une donnée. */
async function releverPage(
	page: { goto: (url: string) => Promise<unknown>; content: () => Promise<string> },
	url: string
): Promise<PageOfficielle> {
	try {
		const reponse = (await page.goto(url)) as { status?: () => number } | null;
		const html = await page.content();
		// `goto` rend une réponse dont la forme varie selon le profil bxc : un
		// profil sans CDP n'expose pas `status()`. Du HTML reçu vaut 200.
		const statut =
			typeof reponse?.status === "function" ? reponse.status() : html.length > 0 ? 200 : 0;
		return {
			url,
			statut,
			titre: titreDuHtml(html),
			octets: Buffer.byteLength(html),
			liens: liensDuHtml(html, url),
			erreur: null,
		};
	} catch (erreur) {
		return {
			url,
			statut: 0,
			titre: null,
			octets: 0,
			liens: [],
			erreur: erreur instanceof Error ? erreur.message : String(erreur),
		};
	}
}

/** Balaye le portail officiel. Séquentiel : trois pages, aucun intérêt à paralléliser. */
async function balayerPortail(
	profil: ProfilBxc,
	journaliser: (message: string) => void
): Promise<PageOfficielle[]> {
	const { Browser } = await import("@aphrody/bxc");
	const page = await Browser.newPage({ profile: profil, insecure: true });
	try {
		const pages: PageOfficielle[] = [];
		for (const url of PAGES_PORTAIL) {
			// Séquentiel à dessein : les trois relevés partagent le MÊME onglet
			// bxc. Les paralléliser ferait que le second `goto` écraserait le
			// document que le premier n'a pas fini de lire.
			// oxlint-disable-next-line no-await-in-loop
			const releve = await releverPage(page, url);
			pages.push(releve);
			journaliser(
				releve.erreur === null
					? `  ${url} → ${releve.statut} · ${releve.octets} o · ${releve.liens.length} lien(s)`
					: `  ${url} → échec : ${releve.erreur}`
			);
		}
		return pages;
	} finally {
		await page.close();
	}
}

/** Balaye le codex des joueurs. Un échec est rapporté, jamais levé. */
async function balayerCodex(journaliser: (message: string) => void): Promise<ResultatCodex> {
	try {
		const { ZukanScraper } = await import("@aphrody/zukan");
		const scraper = new ZukanScraper();
		const personnages = await scraper.getCharacterList("ja");
		journaliser(`  zukan.inazuma.jp → ${personnages.length} fiche(s)`);
		return {
			personnages: personnages.length,
			echantillon: personnages.slice(0, 5).map((fiche) => ({ id: fiche.id, nom: fiche.name })),
			erreur: null,
		};
	} catch (erreur) {
		const message = erreur instanceof Error ? erreur.message : String(erreur);
		journaliser(`  zukan.inazuma.jp → échec : ${message}`);
		return { personnages: 0, echantillon: [], erreur: message };
	}
}

/**
 * Rejoue le balayage `iecrawl` et écrit son état.
 *
 * L'écriture est atomique par remplacement : `Bun.write` réécrit le fichier en
 * entier, un balayage interrompu ne laisse donc pas d'état à moitié valide.
 */
export async function iecrawl(options: OptionsIeCrawl = {}): Promise<ResultatIeCrawl> {
	const journaliser = options.journaliser ?? (() => {});
	const profil = options.profil ?? "static";
	const debut = Date.now();

	journaliser(`portail officiel (profil ${profil}) :`);
	const portail = await balayerPortail(profil, journaliser);

	const codex =
		options.codex === false
			? { personnages: 0, echantillon: [], erreur: "balayage du codex désactivé" }
			: await balayerCodex(journaliser);

	const resultat: ResultatIeCrawl = {
		date: new Date().toISOString(),
		portail,
		codex,
		fichier: null,
		dureeMs: Date.now() - debut,
	};

	if (options.dryRun !== true) {
		const fichier = join(options.repertoire ?? repertoireParDefaut(), FICHIER_ETAT);
		await mkdir(dirname(fichier), { recursive: true });
		await Bun.write(fichier, `${JSON.stringify(resultat, null, 2)}\n`);
		resultat.fichier = fichier;
	}

	return resultat;
}
