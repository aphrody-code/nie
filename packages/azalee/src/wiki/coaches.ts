/**
 * Couche données « Entraîneurs / Coachs » (section wiki dédiée).
 *
 * Source : miroir SQLite embarqué (tables `inagle_coordinators` + `inagle_manager_passives`),
 * lu via le client Supabase-compatible (`@/lib/supabase/server`). NE TOUCHE PAS
 * `lib/wiki-service.ts` (partagé entre agents) — tout l'accès données de cette
 * section vit ici.
 *
 * `inagle_coordinators` (102 lignes) = personnages assignables à un poste de banc :
 *   - `role` : Coordinator (31), Manager (68) ou Coach (3)
 *   - `passive_no` : numéro du passif d'équipe accordé (référence `inagle_manager_passives.id`)
 *   - `requirements` / `stat` / `buff` : effet passif résolu pré-calculé dans la feuille source
 *
 * `inagle_manager_passives` (80 lignes) = table de référence des passifs d'équipe :
 *   pour chaque passif (`requirements` + `stat`), la valeur du bonus selon le couple
 *   (rôle Coordinator vs Manager) × (rareté commune vs légendaire).
 *
 * Pièges données réels (vérifiés sur le miroir) :
 *   - Certaines lignes portent une erreur de tableur figée :
 *     `#N/A (Did not find value '' in VLOOKUP evaluation.)` dans stat/buff → nettoyée en null.
 *   - La colonne `game` est décalée pour ~70 lignes (contient « Manager »/« Coach » au lieu
 *     du titre du jeu) → on ne s'y fie pas pour un filtre.
 *   - `element` est en kanji (山 林 火 風) → mappé vers une clé EN pour l'icône.
 *   - Aucune ligne n'a d'`image` non vide → pas d'illustration disponible.
 *     On dérive donc le portrait du `internal_code` du personnage homonyme :
 *     join `name_localised` = `inagle_characters.name_en` → `internal_code`
 *     (84/102 matchent). Le composant client passe ce code à `getCharacterFaceUrl`
 *     (client-safe) ; les 18 NPC sans match gardent le fallback icône.
 */


import { createClient } from "../db/provider";

/** Marqueur d'erreur tableur figé dans certaines cellules (stat/buff). */
const VLOOKUP_ERROR_PREFIX = "#N/A";

/** Rôle d'un membre de banc (valeurs réelles de la colonne `role`). */
export type CoachRole = "Coordinator" | "Manager" | "Coach";

/** Élément en kanji tel que stocké, mappé vers une clé EN pour l'icône. */
const ELEMENT_KANJI_TO_EN: Record<string, string> = {
	山: "mountain",
	林: "forest",
	火: "fire",
	風: "wind",
};

/** Libellé FR de l'élément (pour le texte / l'accessibilité). */
const ELEMENT_KANJI_TO_FR: Record<string, string> = {
	山: "Montagne",
	林: "Forêt",
	火: "Feu",
	風: "Vent",
};

/** Libellé FR du rôle. */
const ROLE_FR: Record<CoachRole, string> = {
	Coach: "Coach",
	Coordinator: "Coordinateur",
	Manager: "Manager",
};

/** Libellé FR du style de jeu (playstyle). */
const PLAYSTYLE_FR: Record<string, string> = {
	Bond: "Lien",
	Breach: "Percée",
	Counter: "Contre",
	Justice: "Justice",
	"Rough Play": "Jeu rugueux",
	Tension: "Tension",
};

/** Ligne brute de `inagle_coordinators`. */
interface RawCoordinator {
	id: number;
	image: string | null;
	name_kanji: string | null;
	name_hiragana: string | null;
	name_romaji: string | null;
	name_localised: string | null;
	gender: string | null;
	role: string | null;
	game: string | null;
	element: string | null;
	playstyle: string | null;
	passive_slot: number | null;
	passive_no: number | null;
	requirements: string | null;
	stat: string | null;
	buff: string | null;
}

/** Ligne brute de `inagle_manager_passives`. */
interface RawManagerPassive {
	id: number;
	playstyle: string | null;
	requirements: string | null;
	stat: string | null;
	coord_common: string | null;
	coord_legendary: string | null;
	manager_common: string | null;
	manager_legendary: string | null;
}

/** Échelle de valeurs d'un passif d'équipe selon rôle × rareté. */
export interface PassiveScaling {
	id: number;
	requirements: string | null;
	stat: string | null;
	coordCommon: string | null;
	coordLegendary: string | null;
	managerCommon: string | null;
	managerLegendary: string | null;
}

/** Coach normalisé exposé à l'UI. */
export interface Coach {
	id: number;
	/** Nom affiché : localisé (EN) en priorité, sinon romaji, sinon kanji. */
	name: string;
	nameLocalised: string | null;
	nameRomaji: string | null;
	nameKanji: string | null;
	role: CoachRole;
	roleFr: string;
	/** Genre brut (女 / 男 / 不明). */
	gender: string | null;
	/** Élément en kanji (源). */
	elementKanji: string | null;
	/** Clé EN de l'élément pour l'icône (mountain/forest/fire/wind), ou null. */
	elementKey: string | null;
	/** Libellé FR de l'élément. */
	elementFr: string | null;
	playstyle: string | null;
	playstyleFr: string | null;
	/** Numéro du passif d'équipe (référence `inagle_manager_passives.id`). */
	passiveNo: number | null;
	/** Condition d'activation du passif (texte source EN). */
	requirements: string | null;
	/** Statistique affectée (texte source EN). */
	stat: string | null;
	/** Valeur du bonus pré-résolue dans la feuille source. */
	buff: string | null;
	image: string | null;
	/**
	 * Code interne du personnage homonyme (`c0xxxxxxx`), dérivé du join
	 * `name_localised` = `inagle_characters.name_en`. Sert au composant client à
	 * résoudre le portrait via `getCharacterFaceUrl`. `null` pour les NPC sans match.
	 */
	internalCode: string | null;
	/** Échelle complète du passif (rôle × rareté) si résolue. */
	scaling: PassiveScaling | null;
}

/** Nettoie une cellule : renvoie null si vide ou si erreur VLOOKUP figée. */
function cleanCell(v: string | null | undefined): string | null {
	if (!v) {
		return null;
	}
	const trimmed = v.trim();
	if (trimmed === "" || trimmed.startsWith(VLOOKUP_ERROR_PREFIX)) {
		return null;
	}
	return trimmed;
}

/** Normalise une valeur de `role` brute vers un `CoachRole` (défaut Coordinator). */
function normalizeRole(role: string | null): CoachRole {
	if (role === "Manager" || role === "Coach") {
		return role;
	}
	return "Coordinator";
}

/** Convertit une ligne brute + son passif résolu en `Coach`. */
function toCoach(
	raw: RawCoordinator,
	scaling: PassiveScaling | null,
	internalCode: string | null
): Coach {
	const role = normalizeRole(raw.role);
	const elementKanji = cleanCell(raw.element);
	const playstyle = cleanCell(raw.playstyle);
	const name =
		cleanCell(raw.name_localised) ||
		cleanCell(raw.name_romaji) ||
		cleanCell(raw.name_kanji) ||
		`#${raw.id}`;

	return {
		buff: cleanCell(raw.buff),
		elementFr: elementKanji ? (ELEMENT_KANJI_TO_FR[elementKanji] ?? null) : null,
		elementKanji,
		elementKey: elementKanji ? (ELEMENT_KANJI_TO_EN[elementKanji] ?? null) : null,
		gender: cleanCell(raw.gender),
		id: raw.id,
		image: cleanCell(raw.image),
		internalCode,
		name,
		nameKanji: cleanCell(raw.name_kanji),
		nameLocalised: cleanCell(raw.name_localised),
		nameRomaji: cleanCell(raw.name_romaji),
		passiveNo: raw.passive_no,
		playstyle,
		playstyleFr: playstyle ? (PLAYSTYLE_FR[playstyle] ?? playstyle) : null,
		requirements: cleanCell(raw.requirements),
		role,
		roleFr: ROLE_FR[role],
		scaling,
		stat: cleanCell(raw.stat),
	};
}

/** Ligne minimale de `inagle_characters` pour la résolution du portrait. */
interface RawCharacterRef {
	name_en: string | null;
	internal_code: string | null;
}

/**
 * Construit l'index `name_en` → `internal_code` depuis `inagle_characters`.
 * Le premier code rencontré est conservé (les homonymes éventuels sont ignorés).
 */
function indexCharacterCodes(rows: RawCharacterRef[]): Map<string, string> {
	const map = new Map<string, string>();
	for (const r of rows) {
		const name = r.name_en?.trim();
		if (!name || !r.internal_code || map.has(name)) {
			continue;
		}
		map.set(name, r.internal_code);
	}
	return map;
}

/** Résout le `internal_code` d'un coach via son nom localisé (sinon null). */
function resolveInternalCode(
	raw: RawCoordinator,
	byName: Map<string, string>
): string | null {
	const name = raw.name_localised?.trim();
	if (!name) {
		return null;
	}
	return byName.get(name) ?? null;
}

/** Construit l'index id → passif d'équipe depuis `inagle_manager_passives`. */
function indexPassives(rows: RawManagerPassive[]): Map<number, PassiveScaling> {
	const map = new Map<number, PassiveScaling>();
	for (const r of rows) {
		map.set(r.id, {
			coordCommon: cleanCell(r.coord_common),
			coordLegendary: cleanCell(r.coord_legendary),
			id: r.id,
			managerCommon: cleanCell(r.manager_common),
			managerLegendary: cleanCell(r.manager_legendary),
			requirements: cleanCell(r.requirements),
			stat: cleanCell(r.stat),
		});
	}
	return map;
}

/** Options de filtrage de la liste des coachs. */
export interface CoachListParams {
	q?: string;
	role?: string;
	element?: string;
	playstyle?: string;
}

/**
 * Liste complète des coachs (normalisée + passif résolu), filtrée en mémoire.
 * Le jeu est petit (102 lignes) → un seul SELECT * + filtrage côté serveur.
 */
export async function getCoachesList(params: CoachListParams = {}): Promise<Coach[]> {
	const supabase = await createClient();

	const [coordRes, passiveRes, charRes] = await Promise.all([
		supabase.from("inagle_coordinators").select("*").order("id", { ascending: true }),
		supabase.from("inagle_manager_passives").select("*"),
		supabase.from("inagle_characters").select("name_en, internal_code"),
	]);

	const rawCoords = (coordRes.data ?? []) as RawCoordinator[];
	const rawPassives = (passiveRes.data ?? []) as RawManagerPassive[];
	const passiveIndex = indexPassives(rawPassives);
	const codeByName = indexCharacterCodes((charRes.data ?? []) as RawCharacterRef[]);

	let coaches = rawCoords.map((raw) => {
		const scaling = raw.passive_no != null ? (passiveIndex.get(raw.passive_no) ?? null) : null;
		return toCoach(raw, scaling, resolveInternalCode(raw, codeByName));
	});

	const q = params.q?.trim().toLowerCase();
	if (q) {
		coaches = coaches.filter((c) => {
			const haystack = [c.name, c.nameRomaji, c.nameKanji, c.nameLocalised, c.stat]
				.filter(Boolean)
				.join(" ")
				.toLowerCase();
			return haystack.includes(q);
		});
	}

	if (params.role) {
		coaches = coaches.filter((c) => c.role === params.role);
	}

	if (params.element) {
		coaches = coaches.filter((c) => c.elementKey === params.element);
	}

	if (params.playstyle) {
		coaches = coaches.filter((c) => c.playstyle === params.playstyle);
	}

	return coaches;
}

/** Récupère un coach unique par id (avec passif résolu). */
export async function getCoach(id: number): Promise<Coach | null> {
	if (!Number.isFinite(id)) {
		return null;
	}
	const supabase = await createClient();

	const [coordRes, passiveRes] = await Promise.all([
		supabase.from("inagle_coordinators").select("*").eq("id", id).maybeSingle(),
		supabase.from("inagle_manager_passives").select("*"),
	]);

	const raw = coordRes.data as RawCoordinator | null;
	if (!raw) {
		return null;
	}
	const passiveIndex = indexPassives((passiveRes.data ?? []) as RawManagerPassive[]);
	const scaling = raw.passive_no != null ? (passiveIndex.get(raw.passive_no) ?? null) : null;

	// Résolution du portrait : 1er personnage homonyme (`name_en` = `name_localised`).
	let internalCode: string | null = null;
	const name = raw.name_localised?.trim();
	if (name) {
		const charRes = await supabase
			.from("inagle_characters")
			.select("internal_code")
			.eq("name_en", name)
			.limit(1)
			.maybeSingle();
		internalCode = (charRes.data as { internal_code: string | null } | null)?.internal_code ?? null;
	}

	return toCoach(raw, scaling, internalCode);
}

/** Options de filtre dérivées des données réelles (pour les puces de filtre). */
export const COACH_ROLE_OPTIONS: ReadonlyArray<{ value: CoachRole; label: string }> = [
	{ label: "Coordinateur", value: "Coordinator" },
	{ label: "Manager", value: "Manager" },
	{ label: "Coach", value: "Coach" },
];

export const COACH_ELEMENT_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
	{ label: "Feu", value: "fire" },
	{ label: "Vent", value: "wind" },
	{ label: "Forêt", value: "forest" },
	{ label: "Montagne", value: "mountain" },
];

export const COACH_PLAYSTYLE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
	{ label: "Percée", value: "Breach" },
	{ label: "Justice", value: "Justice" },
	{ label: "Contre", value: "Counter" },
	{ label: "Lien", value: "Bond" },
	{ label: "Tension", value: "Tension" },
	{ label: "Jeu rugueux", value: "Rough Play" },
];
