/**
 * Moisson du catalogue et MESURE de sa couverture — programme exécutable.
 *
 * ```bash
 * bun packages/ietv/src/moisson.ts --db data/anime/episodes.db          # mesure seule
 * bun packages/ietv/src/moisson.ts --db data/anime/episodes.db --collecter
 * ```
 *
 * ── POURQUOI UN FICHIER, ET PAS UNE COMMANDE À RALLONGE ────────────────────
 * La couverture est une mesure qu'on rejoue : avant une moisson, après, et
 * après la suivante pour savoir si elle a servi. Une mesure qui se retape à
 * chaque fois n'est pas comparable à celle d'hier. Celle-ci se rejoue à
 * l'identique et se cite en `chemin:ligne`.
 *
 * Sans `--collecter`, le programme ne touche pas au réseau et n'écrit rien : il
 * ouvre la base — donc il applique la migration, qui est idempotente — et
 * imprime ce qu'elle contient. C'est la forme à utiliser pour l'AVANT.
 */

import { IETVCache } from "./cache.ts";
import IETVScraper from "./index.ts";
import { LANGUES_OFFICIELLES } from "./plateformes.ts";

interface Options {
	db: string;
	collecter: boolean;
	/** Codes de langue à moissonner ; vide = toutes celles qui sont réelles. */
	langues: string[];
	/** Inclure les flux Atom des chaînes officielles (dont la VO). */
	chaines: boolean;
}

function lireOptions(argv: readonly string[]): Options {
	const o: Options = { db: "data/anime/episodes.db", collecter: false, langues: [], chaines: true };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i]!;
		if (a === "--db") o.db = argv[++i] ?? o.db;
		else if (a === "--collecter") o.collecter = true;
		else if (a === "--sans-chaines") o.chaines = false;
		else if (a === "--langues") o.langues = (argv[++i] ?? "").split(",").filter(Boolean);
	}
	return o;
}

/** Nom d'une saison tel que la base le porte, pour un tableau lisible. */
function nomsDeSaison(cache: IETVCache): Map<number, string> {
	const noms = new Map<number, string>();
	for (const c of cache.getAllChannels()) {
		for (const s of c.seasons) {
			if (s.name && !noms.has(s.season)) noms.set(s.season, s.name);
		}
	}
	return noms;
}

/** Le tableau de couverture, saison × langue, avec les plateformes en pied. */
function imprimerCouverture(cache: IETVCache, titre: string) {
	const c = cache.couverture();
	const noms = nomsDeSaison(cache);
	const langues = [...new Set(c.parSaisonLangue.map((r) => r.langue))].sort();
	const saisons = [...new Set(c.parSaisonLangue.map((r) => r.saison))].sort((a, b) => a - b);

	console.log(`\n=== ${titre} ===`);
	if (saisons.length === 0) {
		console.log("(aucune source en base)");
	} else {
		const cle = (s: number, l: string) => `${s}|${l}`;
		const par = new Map(c.parSaisonLangue.map((r) => [cle(r.saison, r.langue), r]));
		const enTete = ["saison".padEnd(16), ...langues.map((l) => l.padStart(8))].join(" ");
		console.log(enTete);
		console.log("-".repeat(enTete.length));
		for (const s of saisons) {
			const cellules = langues.map((l) => String(par.get(cle(s, l))?.episodes ?? 0).padStart(8));
			console.log([`${s} ${noms.get(s) ?? ""}`.trim().padEnd(16), ...cellules].join(" "));
		}
	}

	console.log(`\nepisodes distincts (saison, numero) : ${c.episodesDistincts}`);
	console.log(`sources au total                    : ${c.sourcesTotal}`);
	console.log(
		`sources par episode                 : min ${c.sourcesParEpisode.min}, ` +
			`max ${c.sourcesParEpisode.max}, moyenne ${c.sourcesParEpisode.moyenne}`
	);
	console.log("plateformes :");
	for (const p of c.parPlateforme) {
		console.log(`  ${p.plateforme.padEnd(12)} ${String(p.sources).padStart(5)} sources`);
	}
	// La mesure qui compte : « au catalogue » n'est pas « regardable ».
	console.log(`episodes SANS aucune source integrable : ${c.sansSourceLisible.length}`);
	if (c.sansSourceLisible.length > 0) {
		const apercu = c.sansSourceLisible
			.slice(0, 20)
			.map((e) => `S${e.saison}E${e.episode ?? "?"}`)
			.join(" ");
		console.log(`  ${apercu}${c.sansSourceLisible.length > 20 ? " …" : ""}`);
	}
}

const o = lireOptions(process.argv.slice(2));
const cache = new IETVCache(o.db);

imprimerCouverture(cache, `AVANT — ${o.db}`);

if (o.collecter) {
	const scraper = new IETVScraper();
	const langues =
		o.langues.length > 0
			? LANGUES_OFFICIELLES.filter((l) => o.langues.includes(l.code))
			: LANGUES_OFFICIELLES;

	console.log(`\n… plateforme officielle, langues : ${langues.map((l) => l.code).join(", ")}`);
	const officiels = await scraper.scrapeOfficialSiteToutesLangues(langues);
	for (const ch of officiels) {
		console.log(`  ${ch.channel} : ${ch.totalEpisodes} episodes, ${ch.seasons.length} saisons`);
		cache.saveChannel(ch);
	}

	// Dailymotion AVANT les flux Atom : c'est la seule source `vostfr` du
	// catalogue, et la seule dont l'API rend un objet vidéo complet.
	console.log("\n… comptes Dailymotion officiels (API de donnees publique)");
	const dailymotion = await scraper.scrapeDailymotionOfficiel();
	for (const ch of dailymotion) {
		console.log(`  ${ch.channel} : ${ch.totalEpisodes} episodes`);
		cache.saveChannel(ch);
	}

	if (o.chaines) {
		console.log("\n… flux Atom des chaines officielles");
		const chaines = await scraper.scrapeChainesOfficielles();
		for (const ch of chaines) {
			console.log(`  ${ch.channel} : ${ch.totalEpisodes} episodes`);
			cache.saveChannel(ch);
		}
	}

	await scraper.close();
	imprimerCouverture(cache, `APRES — ${o.db}`);
}

cache.close();
