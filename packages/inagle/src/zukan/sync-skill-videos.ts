/**
 * Peuplement des vidéos officielles de techniques dans Postgres.
 *
 * Cœur réutilisable : le CLI (`map-missing-skill-videos.ts`) et la tâche cron
 * (`zukan:videos`) appellent tous deux `syncZukanSkillVideos`.
 *
 * MATCHING, dans cet ordre :
 *  1. nom EN normalisé ;
 *  2. nom JA normalisé (secours pour les libellés EN divergents) ;
 *  3. variantes « Dreamscape » (夢限定 / « Rêve : ») = reskins qui réutilisent
 *     l'animation du move de base — on recopie ses vidéos.
 * Rien d'autre : une technique sans correspondance reste NULL. On ne fabrique
 * pas de correspondance approximative.
 *
 * ÉCRITURE :
 *  - `inagle_skills.video_url` / `poster_url` = vidéo PRINCIPALE (position 0) ;
 *  - `inagle_skills.thumbnail_url` = vignette webp de la liste (~6 Ko) ;
 *  - `inagle_skill_videos` = TOUTES les variantes (236 techniques en ont deux,
 *    ce qu'une colonne scalaire ne peut pas porter).
 *    Cf. apps/website/sql/migrations/20260813_inagle_skill_videos.sql
 *
 * Module SERVEUR (ouvre une connexion Postgres) : il n'est pas ré-exporté par le
 * barrel `zukan/index.ts`, on l'importe en leaf.
 */
import { SQL } from "bun";
import { fetchZukanSkillIndex, normalizeSkillName } from "./skill-videos.js";
import type { ZukanSkill, ZukanSkillVideo } from "./types.js";

/** Dreamscape (夢限定) reskins -> move de base dont on réutilise l'animation. */
export const DREAMSCAPE_BASE: Record<string, string> = {
	whd00011: "whd00010", // Rêve : Le Mur         <- The Wall
	whk00011: "whk00010", // Rêve : Main céleste   <- God Hand
	whs00061: "whs00060", // Rêve : Choc du dragon <- Dragon Crash
};

interface SkillRow {
	id: string;
	internal_code: string | null;
	name_en: string | null;
	name_fr: string | null;
	name_ja: string | null;
	video_url: string | null;
	poster_url: string | null;
}

export interface SkillVideoPlan {
	id: string;
	internalCode: string | null;
	/** Comment la correspondance a été établie : `name_en`, `name_ja`, `dreamscape<-code`. */
	via: string;
	videos: ZukanSkillVideo[];
	thumbnailUrl: string | null;
	source: "zukan" | "dreamscape";
}

export interface SyncZukanSkillVideosOptions {
	/** Chaîne de connexion Postgres (défaut : `DATABASE_URL`). */
	databaseUrl?: string;
	/** Écrire réellement (défaut : `false` = audit seul). */
	apply?: boolean;
	/** Ne traiter que les techniques sans `video_url` (défaut : `false` = toutes). */
	onlyMissing?: boolean;
}

export interface SyncZukanSkillVideosResult {
	/** Techniques réelles en base (`wh%` / `rh%`). */
	skillsTotal: number;
	/** Techniques examinées lors de cette passe. */
	examined: number;
	/** Techniques publiées par zukan (page EN). */
	zukanSkills: number;
	/** Techniques zukan exposant deux vidéos. */
	zukanMulti: number;
	/** Plans de peuplement retenus. */
	plans: SkillVideoPlan[];
	/** Techniques sans correspondance upstream — laissées NULL. */
	unresolved: Array<{ internalCode: string | null; nameFr: string | null; nameEn: string | null }>;
	/** Lignes `inagle_skills` écrites (0 en audit). */
	skillsUpdated: number;
	/** Lignes `inagle_skill_videos` écrites (0 en audit). */
	videosUpserted: number;
	applied: boolean;
}

function planFor(
	row: SkillRow,
	skill: ZukanSkill,
	via: string,
	source: "zukan" | "dreamscape"
): SkillVideoPlan | null {
	if (skill.videos.length === 0) return null;
	return {
		id: row.id,
		internalCode: row.internal_code,
		source,
		thumbnailUrl: skill.thumbnailUrl,
		via,
		videos: skill.videos,
	};
}

export async function syncZukanSkillVideos(
	options: SyncZukanSkillVideosOptions = {}
): Promise<SyncZukanSkillVideosResult> {
	const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
	if (!databaseUrl) {
		throw new Error("DATABASE_URL manquante : impossible de peupler les vidéos de techniques.");
	}
	const apply = options.apply ?? false;
	const sql = new SQL(databaseUrl);

	try {
		// Les techniques réelles du jeu : `wh%` (hissatsu) et `rh%` (moves de base).
		// Les `swap_skill_waza_*` sont des emplacements techniques, pas des techniques.
		const rows = (await sql`
			select id, internal_code, name_en, name_fr, name_ja, video_url, poster_url
			from inagle_skills
			where internal_code like 'wh%' or internal_code like 'rh%'
			order by internal_code
		`) as unknown as SkillRow[];

		const targets = options.onlyMissing ? rows.filter((r) => !r.video_url) : rows;
		const index = await fetchZukanSkillIndex();

		const plans: SkillVideoPlan[] = [];
		const planById = new Map<string, SkillVideoPlan>();
		const byCode = new Map(rows.map((r) => [r.internal_code ?? "", r]));
		const pendingDreamscape: SkillRow[] = [];
		const unresolved: SyncZukanSkillVideosResult["unresolved"] = [];

		for (const row of targets) {
			// 1) nom EN
			const en = row.name_en ? index.byNameEn.get(normalizeSkillName(row.name_en)) : undefined;
			const planEn = en ? planFor(row, en, "name_en", "zukan") : null;
			if (planEn) {
				plans.push(planEn);
				planById.set(row.id, planEn);
				continue;
			}
			// 2) nom JA
			const ja = row.name_ja ? index.byNameJa.get(normalizeSkillName(row.name_ja)) : undefined;
			const planJa = ja ? planFor(row, ja, "name_ja", "zukan") : null;
			if (planJa) {
				plans.push(planJa);
				planById.set(row.id, planJa);
				continue;
			}
			pendingDreamscape.push(row);
		}

		// 3) Dreamscape : reskins qui empruntent l'animation de leur move parent.
		for (const row of pendingDreamscape) {
			const baseCode = row.internal_code ? DREAMSCAPE_BASE[row.internal_code] : undefined;
			const base = baseCode ? byCode.get(baseCode) : undefined;
			const basePlan = base ? planById.get(base.id) : undefined;
			const baseEn =
				!basePlan && base?.name_en
					? index.byNameEn.get(normalizeSkillName(base.name_en))
					: undefined;
			const inherited = basePlan ?? (baseEn?.videos.length ? baseEn : undefined);
			if (!inherited) {
				unresolved.push({
					internalCode: row.internal_code,
					nameEn: row.name_en,
					nameFr: row.name_fr,
				});
				continue;
			}
			plans.push({
				id: row.id,
				internalCode: row.internal_code,
				source: "dreamscape",
				thumbnailUrl: inherited.thumbnailUrl,
				via: `dreamscape<-${baseCode}`,
				videos: inherited.videos,
			});
		}

		let skillsUpdated = 0;
		let videosUpserted = 0;

		if (apply) {
			for (const p of plans) {
				const primary = p.videos[0];
				if (!primary?.videoUrl) continue;
				await sql`
					update inagle_skills
					   set video_url = ${primary.videoUrl},
					       poster_url = ${primary.posterUrl},
					       thumbnail_url = ${p.thumbnailUrl},
					       updated_at = now()
					 where id = ${p.id}
				`;
				skillsUpdated++;
				for (const v of p.videos) {
					if (!v.videoUrl) continue;
					await sql`
						insert into inagle_skill_videos
							(skill_id, position, label, video_url, poster_url, source)
						values (${p.id}, ${v.position}, ${v.label}, ${v.videoUrl}, ${v.posterUrl}, ${p.source})
						on conflict (skill_id, position) do update
							set label = excluded.label,
							    video_url = excluded.video_url,
							    poster_url = excluded.poster_url,
							    source = excluded.source,
							    updated_at = now()
					`;
					videosUpserted++;
				}
			}
		}

		return {
			applied: apply,
			examined: targets.length,
			plans,
			skillsTotal: rows.length,
			skillsUpdated,
			unresolved,
			videosUpserted,
			zukanMulti: index.en.filter((s) => s.videos.length > 1).length,
			zukanSkills: index.en.length,
		};
	} finally {
		await sql.end();
	}
}
