/**
 * Accès données SECTION ÉQUIPES (`/equipe`).
 *
 * Lit directement le miroir SQLite embarqué via le client Supabase proxifié
 * (`@/lib/supabase/server` → `createSqliteClient` pour les tables `inagle_*`).
 *
 * Tables sources (vérité terrain miroir) :
 *   - `inagle_teams`    (208) : nom multi-langue, emblèmes (CRC/série), kits (CRC/série),
 *                               emblem_url (icône résolue), data.seasons (apparitions jeux),
 *                               data.binderTeamOrderType (ordre naturel d'affichage).
 *   - `inagle_uniforms` (384) : keyés par `name_id` (= CRC référencé dans team.kits).
 *                               `models` = liste {typeId 0=domicile / 1=extérieur}
 *                               avec les CRC modèle joueur/gardien.
 *   - `inagle_emblems`  (2)   : table template (default + em010001), pas un index complet.
 *
 * Roster : `inagle_characters.team_id` pointe vers `inagle_teams.id`. Les personnages
 * sont dédupliqués par `chara_id` (la table contient plusieurs lignes par perso).
 *
 * AUCUNE donnée inventée : tout dérive des colonnes réelles ci-dessus.
 */


import { createClient } from "../db/provider";
import { getCharacterFaceUrl, getEmblemImageUrl } from "../images";
// Table CRC → nom d'emblème (`emNNNNNN`), générée depuis l'index CPK
// (crc32 standard de chaque `emNNNNNN`). Couvre 206/208 emblèmes réels.
import emblemCrcMap from "../data/emblem-crc-map.json";
import {
	SERIES_LABELS,
	type TeamDetail,
	type TeamEmblem,
	type TeamKit,
	type TeamKitModel,
	type TeamListItem,
	type TeamRosterMember,
} from "./teams-shared";

// Ré-export des types + constantes depuis le module client-safe (compat imports existants).
export {
	SEASON_LABELS,
	SERIES_LABELS,
	type TeamDetail,
	type TeamEmblem,
	type TeamKit,
	type TeamKitModel,
	type TeamListItem,
	type TeamRosterMember,
} from "./teams-shared";

interface RawTeamRow {
	id: string;
	name_fr: string | null;
	name_en: string | null;
	name_ja: string | null;
	emblem_url: string | null;
	emblems: string | null;
	kits: string | null;
	data: string | null;
	description_fr: string | null;
	description_en: string | null;
}

interface RawUniformRow {
	name_id: string;
	models: string | null;
	data: string | null;
}

interface RawCharaRow {
	chara_id: string;
	name_fr: string | null;
	name_ja: string | null;
	base_slug: string | null;
	slug: string | null;
	internal_code: string | null;
	position: string | null;
	element: string | null;
	rarity: string | null;
}

/** Parse JSON-or-object en sécurité (les colonnes TEXT peuvent déjà être désérialisées). */
function parseJson<T>(value: unknown): T | null {
	if (value == null) return null;
	if (typeof value === "object") return value as T;
	if (typeof value !== "string" || value === "") return null;
	try {
		return JSON.parse(value) as T;
	} catch {
		return null;
	}
}

function teamSeasons(dataRaw: string | null): Record<string, number> {
	const data = parseJson<{ seasons?: Record<string, number> }>(dataRaw);
	return data?.seasons ?? {};
}

function teamOrder(dataRaw: string | null): number {
	const data = parseJson<{ binderTeamOrderType?: number }>(dataRaw);
	const v = data?.binderTeamOrderType;
	return typeof v === "number" ? v : 9999;
}

// Ordre de préférence des séries (la « vraie » identité visuelle de l'équipe
// dans Victory Road > Inazuma Eleven original > GO > Ares/Orion).
const EMBLEM_SERIES_ORDER = ["v", "ie", "go", "aresOrion"] as const;

// Normalise un CRC en clé du map : `0x` minuscule + hex MAJUSCULE.
// Piège : `crc.toUpperCase()` transformerait aussi le `x` → `0X…` (clé absente).
function normalizeCrcKey(crc: string): string {
	return `0x${crc.replace(/^0x/i, "").toUpperCase()}`;
}

const EMBLEM_CRC_MAP = emblemCrcMap as Record<string, string>;

function resolveTeamEmblem(row: RawTeamRow): string | null {
	// 1) Vrai emblème : `emblems` = { série: CRC }. On choisit la série la plus
	// représentative dispo, on mappe son CRC → `emNNNNNN` → URL CDN (sert 200).
	const emblems = parseJson<Record<string, string>>(row.emblems);
	if (emblems) {
		let crc: string | null = null;
		for (const series of EMBLEM_SERIES_ORDER) {
			if (emblems[series]) {
				crc = emblems[series];
				break;
			}
		}
		if (!crc) crc = Object.values(emblems).find(Boolean) ?? null;
		if (crc) {
			const emName = EMBLEM_CRC_MAP[normalizeCrcKey(crc)];
			if (emName) {
				const url = getEmblemImageUrl(emName);
				if (url) return url;
			}
		}
	}
	// 2) PAS de repli sur `emblem_url` brut : `resolveAssetUrl` renvoie une URL `http…`
	// telle quelle SANS la vérifier contre le manifeste (son seul gate porte sur les formes
	// `/storage/…`/`/menu/…`, pas sur une URL déjà absolue) — `emblem_url` en base est ce
	// même genre d'URL forgée, jamais confrontée aux 542 emblèmes réels. Mesuré : ~20/208
	// équipes (le CRC de step 1 n'a pas de correspondance dans `emblem-crc-map.json`, ex.
	// `0x86D317FE` série `aresOrion`) obtenaient ainsi une URL garantie 404 plutôt que le
	// placeholder que le composant sait déjà afficher (`TeamCard`/`hasEmblem`).
	return null;
}

/**
 * Liste complète des équipes triée par ordre naturel du jeu (binder order).
 * 208 lignes — chargées d'un coup, filtrage/recherche côté client.
 */
export async function getTeamsList(): Promise<TeamListItem[]> {
	const supabase = await createClient();
	const { data: teamsRaw } = await supabase
		.from("inagle_teams")
		.select("id, name_fr, name_en, name_ja, emblem_url, emblems, kits, data");

	const rows = (teamsRaw ?? []) as RawTeamRow[];

	// Compte roster (personnages distincts) par team_id en une passe.
	const { data: charaRaw } = await supabase
		.from("inagle_characters")
		.select("chara_id, team_id");
	const rosterByTeam = new Map<string, Set<string>>();
	for (const c of (charaRaw ?? []) as Array<{ chara_id: string; team_id: string | null }>) {
		if (!c.team_id) continue;
		let set = rosterByTeam.get(c.team_id);
		if (!set) {
			set = new Set();
			rosterByTeam.set(c.team_id, set);
		}
		if (c.chara_id) set.add(c.chara_id);
	}

	const list: TeamListItem[] = rows.map((row) => {
		const kits = parseJson<Record<string, string>>(row.kits) ?? {};
		return {
			id: row.id,
			name: row.name_fr || row.name_en || row.name_ja || row.id,
			nameJa: row.name_ja || null,
			nameEn: row.name_en || null,
			emblemUrl: resolveTeamEmblem(row),
			seasons: teamSeasons(row.data),
			seriesKeys: Object.keys(kits),
			rosterCount: rosterByTeam.get(row.id)?.size ?? 0,
			order: teamOrder(row.data),
		};
	});

	list.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "fr"));
	return list;
}

function mapUniformModels(modelsRaw: string | null): TeamKitModel[] {
	const models = parseJson<
		Array<{
			typeId?: number;
			uniformFielderModelIdCrc?: string;
			uniformKeeperModelIdCrc?: string;
			shoesFielderModelIdCrc?: string;
			gloveModelIdCrc?: string;
		}>
	>(modelsRaw);
	if (!Array.isArray(models)) return [];
	return models.map((m) => ({
		typeId: typeof m.typeId === "number" ? m.typeId : 0,
		uniformFielderModelIdCrc: m.uniformFielderModelIdCrc ?? "0x00000000",
		uniformKeeperModelIdCrc: m.uniformKeeperModelIdCrc ?? "0x00000000",
		shoesFielderModelIdCrc: m.shoesFielderModelIdCrc ?? "0x00000000",
		gloveModelIdCrc: m.gloveModelIdCrc ?? "0x00000000",
	}));
}

/** Détail d'une équipe : emblèmes, kits (uniformes résolus), roster lié. */
export async function getTeamDetail(id: string): Promise<TeamDetail | null> {
	const supabase = await createClient();
	const { data: row } = await supabase
		.from("inagle_teams")
		.select(
			"id, name_fr, name_en, name_ja, emblem_url, emblems, kits, data, description_fr, description_en"
		)
		.eq("id", id)
		.maybeSingle();

	if (!row) return null;
	const team = row as RawTeamRow;

	const emblemsObj = parseJson<Record<string, string>>(team.emblems) ?? {};
	const emblems: TeamEmblem[] = Object.entries(emblemsObj).map(([series, crc]) => ({
		series,
		seriesLabel: SERIES_LABELS[series] ?? series,
		crc,
	}));

	const kitsObj = parseJson<Record<string, string>>(team.kits) ?? {};
	const kitNameIds = Object.values(kitsObj).filter(Boolean);

	// Résout les uniformes référencés par les CRC de kit.
	const uniformsById = new Map<string, RawUniformRow>();
	if (kitNameIds.length > 0) {
		const { data: uniformsRaw } = await supabase
			.from("inagle_uniforms")
			.select("name_id, models")
			.in("name_id", kitNameIds);
		for (const u of (uniformsRaw ?? []) as RawUniformRow[]) {
			uniformsById.set(u.name_id, u);
		}
	}

	const kits: TeamKit[] = Object.entries(kitsObj)
		.filter(([, nameId]) => Boolean(nameId))
		.map(([series, nameId]) => ({
			series,
			seriesLabel: SERIES_LABELS[series] ?? series,
			nameId,
			models: mapUniformModels(uniformsById.get(nameId)?.models ?? null),
		}));

	// Roster : personnages liés (dédup par chara_id, image via internal_code).
	const { data: charaRaw } = await supabase
		.from("inagle_characters")
		.select(
			"chara_id, name_fr, name_ja, base_slug, slug, internal_code, position, element, rarity"
		)
		.eq("team_id", id);

	const seen = new Set<string>();
	const roster: TeamRosterMember[] = [];
	for (const c of (charaRaw ?? []) as RawCharaRow[]) {
		if (!c.chara_id || seen.has(c.chara_id)) continue;
		seen.add(c.chara_id);
		roster.push({
			charaId: c.chara_id,
			name: c.name_fr || c.name_ja || c.chara_id,
			nameJa: c.name_ja || null,
			slug: c.base_slug || c.slug || null,
			position: c.position || null,
			element: c.element || null,
			rarity: c.rarity || null,
			imageUrl: getCharacterFaceUrl(c.internal_code || c.chara_id),
		});
	}
	roster.sort((a, b) => a.name.localeCompare(b.name, "fr"));

	return {
		id: team.id,
		name: team.name_fr || team.name_en || team.name_ja || team.id,
		nameEn: team.name_en || null,
		nameJa: team.name_ja || null,
		descriptionFr: team.description_fr || null,
		descriptionEn: team.description_en || null,
		emblemUrl: resolveTeamEmblem(team),
		emblems,
		kits,
		seasons: teamSeasons(team.data),
		roster,
	};
}

/** IDs de toutes les équipes (pour `generateStaticParams`). */
export async function getAllTeamIds(): Promise<string[]> {
	const supabase = await createClient();
	const { data } = await supabase.from("inagle_teams").select("id");
	return ((data ?? []) as Array<{ id: string }>).map((r) => r.id).filter(Boolean);
}
