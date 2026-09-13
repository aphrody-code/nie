/**
 * La banque du joueur — la liste, ses filtres et sa pagination, en fonctions pures.
 *
 * ## Pourquoi un module à part
 *
 * L'écran (`screens/PlayerBank.tsx`) dessine ; ici on ne fait que trier, retenir et découper.
 * Un filtre écrit dans le composant ne se teste qu'en montant un DOM, et c'est exactement la
 * partie qu'on veut vérifier sur les 6 101 personnages sans rien afficher.
 *
 * ## Ce qui vient du jeu
 *
 * Les familles de filtres ne sont PAS une liste écrite à la main : elles sont relevées sur les
 * valeurs présentes dans `/api/v1/game-data/charas` (élément, poste, série, équipe). Une valeur
 * que la donnée ne porte pas ne s'affiche donc jamais — et une valeur ajoutée par une mise à
 * jour du jeu apparaît sans toucher au code.
 */
import { fold } from "./list-page";

/** Un personnage de la banque, tel que `/api/v1/game-data/charas` le sert. */
export interface RosterChara {
	chara_param_id: string;
	chara_base_id: string;
	internal_code: string;
	name: string;
	description: string | null;
	element: string;
	main_position: string;
	sub_position: string;
	series: string | null;
	team: string | null;
	gender: number | null;
	skills: string[];
	stats: RosterStats;
}

/** Les sept attributs, aux clés du moteur (`nie_core::growth::calculate_stats`). */
export interface RosterStats {
	kc: number;
	cr: number;
	tc: number;
	pr: number;
	ps: number;
	ag: number;
	it: number;
	total: number;
}

/**
 * Un exemplaire possédé de la banque : le personnage, son niveau et ses stats à ce niveau.
 *
 * Le profil complet (`GET /api/v1/profile/complete`) est la source ; quand il n'est pas servi,
 * [`rosterFromCharas`] construit le même objet depuis `game-data/charas`, dont les stats sont
 * déjà celles du **niveau 99, rang UR** (cf. `CharaDto::stats`). Le repli n'invente donc rien :
 * il lit la même mesure par l'autre route.
 */
export interface RosterEntry {
	chara: RosterChara;
	level: number;
	stats: RosterStats;
	/** Techniques apprises, `« Nv N — nom »` telles que la donnée les écrit. */
	skills: readonly string[];
	/** `"profile"` quand le profil a répondu, `"game-data"` quand c'est le repli. */
	origin: "profile" | "game-data";
}

/** Le niveau du profil complet : tout le monde est au maximum. */
export const PROFILE_LEVEL = 99;

/** Les sept attributs dans l'ordre de l'heptagone du jeu, avec leur libellé de l'écran. */
export const ROSTER_STATS: readonly { key: keyof Omit<RosterStats, "total">; label: string }[] = [
	{ key: "kc", label: "Frappe" },
	{ key: "cr", label: "Contrôle" },
	{ key: "tc", label: "Technique" },
	{ key: "pr", label: "Pression" },
	{ key: "ps", label: "Physique" },
	{ key: "ag", label: "Agilité" },
	{ key: "it", label: "Intelligence" },
];

/** Le repli typé : chaque personnage possédé, au niveau 99, avec ses stats et ses techniques. */
export function rosterFromCharas(charas: readonly RosterChara[]): RosterEntry[] {
	return charas.map((chara) => ({
		chara,
		level: PROFILE_LEVEL,
		stats: chara.stats,
		skills: chara.skills,
		origin: "game-data" as const,
	}));
}

/** Les valeurs retenues par famille — la forme de `GameFilterValue`. */
export type RosterFilter = Record<string, readonly string[]>;

/** Une famille de filtre relevée sur la donnée : son identité, son libellé, ses valeurs comptées. */
export interface RosterFamily {
	id: RosterFamilyId;
	label: string;
	options: readonly { value: string; count: number }[];
}

/** Les familles que la banque sait filtrer, et le champ de `RosterChara` que chacune lit. */
export const ROSTER_FAMILIES = [
	{ id: "element", label: "Élément", of: (c: RosterChara) => c.element },
	{ id: "position", label: "Poste", of: (c: RosterChara) => c.main_position },
	{ id: "series", label: "Série", of: (c: RosterChara) => c.series },
	{ id: "team", label: "Équipe", of: (c: RosterChara) => c.team },
] as const;

export type RosterFamilyId = typeof ROSTER_FAMILIES[number]["id"];

/**
 * Les familles de filtre, relevées sur les personnages réellement possédés.
 *
 * Les valeurs sont triées par nombre décroissant puis par ordre alphabétique : la liste des
 * équipes compte plusieurs centaines d'entrées, et un ordre d'apparition y serait illisible.
 */
export function rosterFamilies(entries: readonly RosterEntry[]): RosterFamily[] {
	return ROSTER_FAMILIES.map((family) => {
		const counts = new Map<string, number>();
		for (const entry of entries) {
			const value = family.of(entry.chara);
			if (!value) continue;
			counts.set(value, (counts.get(value) ?? 0) + 1);
		}
		const options = [...counts].map(([value, count]) => ({ value, count }));
		options.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, "fr"));
		return { id: family.id, label: family.label, options };
	}).filter((family) => family.options.length > 1);
}

/** Une famille vide ou absente vaut « Tout », comme dans le dialogue du jeu. */
function retains(entry: RosterEntry, filter: RosterFilter): boolean {
	for (const family of ROSTER_FAMILIES) {
		const selected = filter[family.id];
		if (!selected || selected.length === 0) continue;
		const value = family.of(entry.chara);
		if (!value || !selected.includes(value)) return false;
	}
	return true;
}

/**
 * Les personnages retenus par le filtre et la recherche par nom (touche `X` du jeu).
 *
 * La recherche est insensible à la casse et aux accents : « leon » retient « Léon ».
 */
export function filterRoster(
	entries: readonly RosterEntry[],
	filter: RosterFilter,
	search = "",
): RosterEntry[] {
	const needle = fold(search);
	return entries.filter((entry) =>
		retains(entry, filter) && (needle === "" || fold(entry.chara.name).includes(needle)),
	);
}

// --- Ce qui a quitté ce fichier le 2026-09-13 ------------------------------------------------
//
// `rosterPage`, `moveCursor` et `fold` vivaient ici en DOUBLE : leurs corps étaient identiques,
// au caractère près, à `listPage`, `stepCursor` et `fold` de `./list-page`, que `gallery.ts` et
// `shop.ts` importaient déjà. Le module d'en face déclarait pourtant exister « plutôt que
// recopiée dans chaque écran » — la copie qu'il voulait éviter était ici. `PlayerBank` appelle
// désormais la version partagée, comme les deux autres écrans.
//
// La copie affirmait aussi, comme l'originale, que « le curseur ne défile pas d'une ligne, il
// change de page quand il sort de la page courante ». Le binaire dit le contraire
// (`nie_core::list_view::step_row`, prouvé byte-exact). Ne corriger qu'un exemplaire aurait
// laissé la règle fausse se propager depuis l'autre.
