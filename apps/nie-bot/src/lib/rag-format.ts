/**
 * Mise en forme des réponses du corpus RAG pour Discord.
 *
 * ── POURQUOI UN MODULE À PART ──────────────────────────────────────────────
 * Un résultat du moteur de recherche sémantique n'est pas un objet que l'on
 * pose tel quel dans un embed :
 *
 *  1. Son `content` COMMENCE par un en-tête technique reconstruit à
 *     l'indexation (`[<type>] <titre> :: <symbole>`, cf.
 *     `packages/cron/src/tasks/ie-crawl/rag-chunkers.ts`). Affiché tel quel, le
 *     titre apparaît DEUX fois — une fois dans le nom du champ, une fois au
 *     début de l'extrait. Pire, pour le type `text` cet en-tête est
 *     MULTILIGNE, parce que le titre l'est.
 *  2. Un fragment peut peser plusieurs milliers de caractères. Discord refuse
 *     l'envoi ENTIER du message si un seul champ dépasse 1 024 caractères, ou
 *     si la somme de l'embed dépasse 6 000. Une réponse à 25 résultats non
 *     bornée ne part jamais : le membre voit « L'application ne répond pas ».
 *  3. La moitié du corpus est du code (lua, ts, json, cfg.bin). Du code hors
 *     bloc de code est illisible sur Discord : les `*`, `_` et `~` y sont
 *     interprétés comme du Markdown et mangent des caractères.
 *
 * Tout ce qui suit est donc PUR : aucune entrée/sortie, aucun accès réseau,
 * aucune dépendance à `discord.js`. C'est ce qui rend le fichier testable
 * (`rag-format.test.ts`) sans bot ni service en marche.
 */

/**
 * Les onze types de source acceptés par `rag-api` (`apps/rag-api/server.ts`,
 * `KNOWN_KINDS`). Un type hors de cette liste est silencieusement ignoré par le
 * service : on le refuse ici pour pouvoir le dire au membre.
 */
export const TYPES_RAG = [
	"lua",
	"cfg",
	"json",
	"ts",
	"sqlite",
	"code",
	"web",
	"tweet",
	"doc",
	"asset",
	"text",
] as const;

export type TypeRag = (typeof TYPES_RAG)[number];

/** Libellés français des types, pour ne pas afficher un jargon d'indexation. */
export const LIBELLE_TYPE: Readonly<Record<TypeRag, string>> = {
	lua: "script Lua",
	cfg: "config du jeu",
	json: "export JSON",
	ts: "code TypeScript",
	sqlite: "fiche du wiki",
	code: "code source",
	web: "page web",
	tweet: "publication X",
	doc: "documentation",
	asset: "ressource",
	text: "texte du jeu",
} as const;

/**
 * Langage du bloc de code, quand le fragment EN EST un.
 *
 * `cfg` vaut `json` : les `cfg.bin` sont indexés après conversion en JSON
 * (`chunkBySource` traite `cfg` et `json` par le même découpeur). `null` = de
 * la prose, à laisser hors bloc pour rester lisible et cliquable.
 */
export const LANGAGE_BLOC: Readonly<Record<TypeRag, string | null>> = {
	lua: "lua",
	cfg: "json",
	json: "json",
	ts: "ts",
	sqlite: null,
	code: "c",
	web: null,
	tweet: null,
	doc: "md",
	asset: null,
	text: null,
} as const;

/** Limites DURES de l'API Discord. Un dépassement fait échouer tout l'envoi. */
export const LIMITES_EMBED = {
	titre: 256,
	description: 4096,
	nomChamp: 256,
	valeurChamp: 1024,
	champs: 25,
	total: 6000,
} as const;

/** Plafond de `k` imposé par `rag-api` (`Math.min(..., 50)`). */
export const K_MAX_RAG = 50;

/** Nombre de résultats affichables dans un embed, à un par champ. */
export const NOMBRE_MAX_RESULTATS = 25;

/** Forme d'un résultat renvoyé par `GET|POST /search` de `rag-api`. */
export interface ResultatRag {
	id: string;
	source_id: string;
	source_kind: string;
	title: string | null;
	url: string | null;
	lang: string | null;
	content: string;
	meta: Record<string, unknown>;
	score: number;
}

/** Enveloppe de la réponse de `/search`. */
export interface ReponseRag {
	query: string;
	count: number;
	results: ResultatRag[];
}

/** Réponse de `/health` de `rag-api`. */
export interface SanteRag {
	ok: boolean;
	store: string;
	chunks: number;
}

/** Un champ d'embed, réduit au strict nécessaire (pas de dépendance discord.js). */
export interface ChampEmbed {
	name: string;
	value: string;
	inline?: boolean;
}

// ── Utilitaires de base ────────────────────────────────────────────────────

/**
 * Tronque en gardant la limite EXACTE, ellipse comprise.
 *
 * `truncate` de `lib/embeds.ts` fait la même chose, mais l'importer tirerait
 * `lib/config.ts`, qui lève à l'import si `DISCORD_TOKEN` manque — donc aucun
 * test unitaire possible. On garde le module autonome.
 */
export function tronquer(texte: string, max: number): string {
	if (max <= 0) {
		return "";
	}
	if (texte.length <= max) {
		return texte;
	}
	return `${texte.slice(0, max - 1).trimEnd()}…`;
}

/** Réduit un texte à une seule ligne (nom de champ, titre d'embed). */
export function surUneLigne(texte: string): string {
	return texte.replaceAll(/\s+/g, " ").trim();
}

/** Formatage français des grands nombres (espaces fines insécables). */
export function nombreFr(valeur: number): string {
	return valeur.toLocaleString("fr-FR");
}

/**
 * Normalise la question posée : Discord laisse passer les retours à la ligne et
 * les espaces multiples, `rag-api` compte les caractères bruts.
 */
export function normaliserRequete(brut: string): string {
	return surUneLigne(brut);
}

/** Contrat de `rag-api` : une requête de moins de 2 caractères est refusée (400). */
export function requeteValide(requete: string): boolean {
	return requete.length >= 2;
}

/** Ramène un entier dans un intervalle, avec repli sur le défaut si non fini. */
export function bornerEntier(
	valeur: number | null | undefined,
	min: number,
	max: number,
	defaut: number
): number {
	if (valeur === null || valeur === undefined || !Number.isFinite(valeur)) {
		return defaut;
	}
	return Math.min(Math.max(Math.trunc(valeur), min), max);
}

/** Vrai si la chaîne est l'un des onze types connus du corpus. */
export function estTypeRag(valeur: string | null | undefined): valeur is TypeRag {
	return typeof valeur === "string" && (TYPES_RAG as readonly string[]).includes(valeur);
}

/** Libellé d'un type, même inconnu (le service pourrait en indexer un nouveau). */
export function libelleType(type: string): string {
	return estTypeRag(type) ? LIBELLE_TYPE[type] : type;
}

// ── Extraction du contenu ──────────────────────────────────────────────────

/**
 * Retire l'en-tête d'indexation du contenu.
 *
 * Les fragments sont stockés préfixés de `[<type>] <titre>` — et de
 * ` :: <symbole>` quand `meta.symbol` existe. Le titre pouvant contenir des
 * retours à la ligne (constaté sur le type `text`), on ne peut PAS se contenter
 * de supprimer la première ligne : on reconstruit l'en-tête attendu et on ne le
 * retire que s'il correspond réellement. Sinon on n'y touche pas — mieux vaut un
 * doublon de titre qu'un extrait amputé.
 */
export function retirerEntete(resultat: ResultatRag): string {
	const contenu = resultat.content ?? "";
	const titre = resultat.title ?? "";
	const symbole = typeof resultat.meta?.symbol === "string" ? resultat.meta.symbol : null;

	const candidats = [
		symbole ? `[${resultat.source_kind}] ${titre} :: ${symbole}` : null,
		`[${resultat.source_kind}] ${titre}`,
		`[${resultat.source_kind}]`,
	].filter((c): c is string => c !== null);

	for (const entete of candidats) {
		if (contenu.startsWith(entete)) {
			return contenu.slice(entete.length).replace(/^\n+/, "");
		}
	}
	return contenu;
}

/** Compresse les lignes vides en série : trois retours à la ligne n'apportent rien. */
export function compacterLignes(texte: string): string {
	return texte
		.replaceAll("\r\n", "\n")
		.replaceAll(/[ \t]+$/gm, "")
		.replaceAll(/\n{3,}/g, "\n\n")
		.trim();
}

/**
 * Encadre du code sans jamais casser le bloc.
 *
 * Un fragment de code peut contenir lui-même des accents graves (un
 * `cfg.bin.json` en contient, du Markdown indexé en contient forcément). Une
 * clôture à trois accents serait alors fermée trop tôt et le reste de l'extrait
 * s'échapperait dans le message. On ouvre donc avec une clôture STRICTEMENT
 * plus longue que la plus longue série présente dans le texte.
 */
export function blocCode(texte: string, langage: string | null): string {
	const series = texte.match(/`+/g) ?? [];
	const plusLongue = series.reduce((max, s) => Math.max(max, s.length), 0);
	const cloture = "`".repeat(Math.max(3, plusLongue + 1));
	return `${cloture}${langage ?? ""}\n${texte}\n${cloture}`;
}

/**
 * Longueur d'extrait allouée à chaque résultat.
 *
 * L'embed entier tient dans 6 000 caractères. Plus on demande de résultats,
 * plus la part de chacun se réduit — sans jamais descendre sous un seuil où
 * l'extrait ne dirait plus rien.
 */
export function longueurExtrait(nombre: number): number {
	const n = Math.max(1, nombre);
	return Math.min(700, Math.max(140, Math.floor(4400 / n)));
}

/** Le lien cliquable d'un résultat, quand il en a un. */
export function lienResultat(resultat: ResultatRag): string | null {
	const url = typeof resultat.url === "string" ? resultat.url.trim() : "";
	return url.startsWith("https://") || url.startsWith("http://") ? url : null;
}

/**
 * D'où vient le fragment, en une ligne.
 *
 * `meta.file` est renseigné pour tout ce qui a été indexé depuis le disque
 * (lua, cfg, json, ts, doc) ; les fiches du wiki et les publications X portent
 * une `url` ; il reste `source_id`, toujours présent, en dernier recours.
 */
export function sourceLisible(resultat: ResultatRag, max = 120): string {
	const fichier = typeof resultat.meta?.file === "string" ? resultat.meta.file : null;
	if (fichier) {
		return tronquer(fichier, max);
	}
	const lien = lienResultat(resultat);
	if (lien) {
		return tronquer(lien, max);
	}
	return tronquer(resultat.source_id ?? resultat.id ?? "source inconnue", max);
}

/**
 * Score de fusion RRF, tel que le moteur le renvoie.
 *
 * Ce n'est PAS un pourcentage de pertinence : c'est la somme des inverses de
 * rang (`1 / (60 + rang)`) des deux moteurs fusionnés, donc un nombre petit,
 * comparable entre résultats d'UNE MÊME recherche et d'elle seule. On l'affiche
 * brut plutôt que maquillé en pourcentage, qui serait faux.
 */
export function formaterScore(score: number): string {
	return Number.isFinite(score) ? score.toFixed(4) : "—";
}

/** Titre affichable d'un résultat, jamais vide. */
export function titreResultat(resultat: ResultatRag): string {
	const titre = surUneLigne(resultat.title ?? "");
	return titre.length > 0 ? titre : surUneLigne(resultat.source_id ?? resultat.id ?? "sans titre");
}

/** Nom du champ d'un résultat : rang, type, titre. */
export function nomChampResultat(resultat: ResultatRag, rang: number): string {
	return tronquer(
		`${rang}. [${libelleType(resultat.source_kind)}] ${titreResultat(resultat)}`,
		LIMITES_EMBED.nomChamp
	);
}

/**
 * Corps du champ d'un résultat : extrait, provenance, score.
 *
 * L'ordre compte : l'extrait d'abord (c'est ce qu'on est venu lire), la
 * provenance ensuite (pour vérifier), le score en dernier (une métadonnée).
 */
export function valeurChampResultat(resultat: ResultatRag, taille: number): string {
	const langage = estTypeRag(resultat.source_kind) ? LANGAGE_BLOC[resultat.source_kind] : null;
	const brut = compacterLignes(retirerEntete(resultat));
	const extrait = tronquer(brut, taille);

	const lignes: string[] = [];
	if (extrait.length > 0) {
		lignes.push(langage === null ? extrait : blocCode(extrait, langage));
	}

	const lien = lienResultat(resultat);
	lignes.push(lien ? `🔗 ${lien}` : `📄 \`${sourceLisible(resultat)}\``);

	const langue =
		typeof resultat.lang === "string" && resultat.lang.length > 0
			? ` · langue ${resultat.lang}`
			: "";
	lignes.push(`score ${formaterScore(resultat.score)}${langue}`);

	return tronquer(lignes.join("\n"), LIMITES_EMBED.valeurChamp);
}

export interface ChampsResultats {
	champs: ChampEmbed[];
	/** Nombre de résultats réellement rendus. */
	affiches: number;
	/** Résultats écartés faute de place dans l'embed. */
	ignores: number;
}

/**
 * Construit les champs d'un embed de résultats en respectant les trois limites
 * à la fois : 25 champs, 1 024 caractères par champ, 6 000 au total.
 *
 * Le budget est consommé au fur et à mesure : dès qu'un résultat ne rentre plus,
 * on s'arrête et on le compte comme ignoré, plutôt que de laisser Discord
 * refuser tout le message.
 */
export function construireChampsResultats(
	resultats: readonly ResultatRag[],
	budgetRestant: number,
	taille = longueurExtrait(resultats.length)
): ChampsResultats {
	const champs: ChampEmbed[] = [];
	let budget = budgetRestant;

	for (const resultat of resultats) {
		if (champs.length >= LIMITES_EMBED.champs) {
			break;
		}
		const name = nomChampResultat(resultat, champs.length + 1);
		const value = valeurChampResultat(resultat, taille);
		const cout = name.length + value.length;
		if (cout > budget) {
			break;
		}
		budget -= cout;
		champs.push({ name, value });
	}

	return { champs, affiches: champs.length, ignores: resultats.length - champs.length };
}

/** Ligne de contexte sous le titre : ce qui a été cherché, et où. */
export function descriptionRecherche(reponse: ReponseRag, type: TypeRag | null): string {
	const portee = type ? `type **${LIBELLE_TYPE[type]}**` : "tous types confondus";
	if (reponse.count === 0) {
		return `Aucun fragment ne ressort pour cette question (${portee}).`;
	}
	const pluriel = reponse.count > 1 ? "s" : "";
	// « extraits rapportés » et non « fragments du corpus » : `count` est le
	// nombre de résultats RENDUS, plafonné par `k`. Écrire « 25 fragments du
	// corpus » laisserait croire que le corpus n'en contient que 25.
	return `**${nombreFr(reponse.count)}** extrait${pluriel} rapporté${pluriel}, ${portee}, classé${pluriel} par fusion RRF (dense + lexical).`;
}

// ── Texte du jeu (index de l'API Azalée) ───────────────────────────────────

/** Une ligne de `/api/text` : un texte localisé et sa catégorie. */
export interface EntreeTexte {
	hashId: string;
	locale: string;
	category: string;
	value: string;
}

/** Une entrée résolue dans les trois langues par `/api/text/:hash`. */
export interface TexteMultilingue {
	hashId: string;
	category?: string;
	fr?: string;
	en?: string;
	ja?: string;
}

/** Une ligne de `/api/text/stats` : nombre d'entrées FRANÇAISES par catégorie. */
export interface StatCategorieTexte {
	category: string;
	count: number;
}

export const LANGUES_TEXTE = ["fr", "en", "ja"] as const;
export type LangueTexte = (typeof LANGUES_TEXTE)[number];

export const LIBELLE_LANGUE: Readonly<Record<LangueTexte, string>> = {
	fr: "français",
	en: "anglais",
	ja: "japonais",
} as const;

/**
 * Reconnaît un identifiant de texte plutôt qu'une recherche.
 *
 * `/api/text/:hash` normalise lui-même la saisie (`0x` optionnel, complété à 8
 * chiffres, décimal signé accepté — `normalizeHashId`). On se contente donc de
 * distinguer ce qui EST un identifiant : du `0x…` explicite, ou 4 à 8 chiffres
 * hexadécimaux. En dessous de 4, trop de vrais mots seraient capturés (« face »,
 * « bed »…) et une recherche légitime partirait sur une fiche.
 */
export function estIdentifiantTexte(saisie: string): boolean {
	const propre = saisie.trim();
	if (/^0x[0-9a-f]{1,8}$/i.test(propre)) {
		return true;
	}
	return /^[0-9a-f]{4,8}$/i.test(propre) && /[0-9]/.test(propre);
}

/** Rend un identifiant sous la forme canonique de l'index (`0xXXXXXXXX`). */
export function normaliserIdentifiantTexte(saisie: string): string {
	const hex = saisie.trim().replace(/^0x/i, "").toUpperCase().padStart(8, "0");
	return `0x${hex}`;
}

/** Champs d'une entrée résolue : une ligne par langue disponible. */
export function champsTexteMultilingue(entree: TexteMultilingue): ChampEmbed[] {
	const champs: ChampEmbed[] = [];
	for (const langue of LANGUES_TEXTE) {
		const valeur = entree[langue];
		if (typeof valeur === "string" && valeur.trim().length > 0) {
			champs.push({
				name: LIBELLE_LANGUE[langue],
				value: tronquer(compacterLignes(valeur), LIMITES_EMBED.valeurChamp),
			});
		}
	}
	return champs;
}

/**
 * Champs d'une liste de résultats de recherche textuelle.
 *
 * Le nom du champ porte l'identifiant et la catégorie : ce sont les deux clés
 * qui permettent d'aller plus loin (`/rag texte 0x…` pour les trois langues).
 */
export function champsRechercheTexte(
	entrees: readonly EntreeTexte[],
	budgetRestant: number
): ChampsResultats {
	const champs: ChampEmbed[] = [];
	let budget = budgetRestant;
	const taille = longueurExtrait(entrees.length);

	for (const entree of entrees) {
		if (champs.length >= LIMITES_EMBED.champs) {
			break;
		}
		const name = tronquer(`${entree.hashId} · ${entree.category}`, LIMITES_EMBED.nomChamp);
		const value =
			tronquer(compacterLignes(entree.value ?? ""), Math.min(taille, LIMITES_EMBED.valeurChamp)) ||
			"—";
		const cout = name.length + value.length;
		if (cout > budget) {
			break;
		}
		budget -= cout;
		champs.push({ name, value });
	}

	return { champs, affiches: champs.length, ignores: entrees.length - champs.length };
}

// ── État du corpus ─────────────────────────────────────────────────────────

/**
 * Sondage d'un type de source.
 *
 * `rag-api` n'expose AUCUN décompte par type : ni `/health` (qui ne rend que le
 * total) ni `/search`. Le seul fait mesurable par HTTP est celui-ci : le moteur
 * dense parcourt TOUS les fragments du type demandé avant de tronquer à `k`
 * (`hybridSearch` → `denseScored` filtré par `kinds`, puis `.slice(0, k)`).
 * Donc, pour une recherche à `k = 50` :
 *
 *   - 0 résultat  ⇒ le type ne contient AUCUN fragment (certitude) ;
 *   - n < 50      ⇒ le type contient EXACTEMENT n fragments (certitude) ;
 *   - n = 50      ⇒ le type en contient au moins 50 (le plafond de `k` empêche
 *                   d'en dire plus, et il n'y a pas d'autre route pour le savoir).
 *
 * On rapporte donc ces trois cas tels quels, sans jamais extrapoler un total.
 */
export interface SondeType {
	type: TypeRag;
	/** Résultats renvoyés par le sondage, ou `null` si le sondage a échoué. */
	renvoyes: number | null;
	/** Plafond utilisé pour le sondage (`k`). */
	plafond: number;
}

/** Rend une sonde en une ligne honnête sur ce qu'elle prouve. */
export function ligneSonde(sonde: SondeType): string {
	const libelle = LIBELLE_TYPE[sonde.type];
	if (sonde.renvoyes === null) {
		return `\`${sonde.type}\` ${libelle} — sondage en échec`;
	}
	if (sonde.renvoyes === 0) {
		return `\`${sonde.type}\` ${libelle} — aucun fragment`;
	}
	if (sonde.renvoyes >= sonde.plafond) {
		return `\`${sonde.type}\` ${libelle} — ≥ ${nombreFr(sonde.plafond)} fragments`;
	}
	return `\`${sonde.type}\` ${libelle} — ${nombreFr(sonde.renvoyes)} fragment${sonde.renvoyes > 1 ? "s" : ""}`;
}

/** Bloc « répartition par type », borné à la taille d'un champ. */
export function blocSondes(sondes: readonly SondeType[]): string {
	const lignes = sondes.map(ligneSonde);
	const complet = lignes.join("\n");
	if (complet.length <= LIMITES_EMBED.valeurChamp) {
		return complet;
	}
	// Priorité aux types PEUPLÉS : un type vide n'apprend rien qui vaille une ligne.
	const peuples = sondes.filter((s) => (s.renvoyes ?? 0) > 0).map(ligneSonde);
	return tronquer(peuples.join("\n"), LIMITES_EMBED.valeurChamp);
}

/** Horodatage français d'une date, ou tiret. */
export function dateFr(valeur: Date | number | null): string {
	if (valeur === null) {
		return "—";
	}
	const date = typeof valeur === "number" ? new Date(valeur) : valeur;
	if (Number.isNaN(date.getTime())) {
		return "—";
	}
	return date.toLocaleString("fr-FR", {
		day: "2-digit",
		month: "long",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		timeZone: "Europe/Paris",
	});
}

/**
 * Résumé de l'index de texte du jeu.
 *
 * ⚠ `/api/text/stats` compte les entrées de la SEULE langue française
 * (`categoryStats` → `WHERE locale = 'fr'`). Le dire est la différence entre une
 * information et un chiffre inventé : le total n'est pas celui de l'index toutes
 * langues confondues.
 */
export function resumerCategoriesTexte(
	stats: readonly StatCategorieTexte[],
	nombre = 8
): {
	total: number;
	categories: number;
	tete: string;
} {
	const total = stats.reduce((somme, s) => somme + (Number.isFinite(s.count) ? s.count : 0), 0);
	const triees = [...stats].toSorted((a, b) => b.count - a.count).slice(0, Math.max(1, nombre));
	const tete = triees.map((s) => `\`${s.category}\` ${nombreFr(s.count)}`).join(" · ");
	return { total, categories: stats.length, tete: tronquer(tete, LIMITES_EMBED.valeurChamp) };
}
