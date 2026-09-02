/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tâche `zukan:videos` — rafraîchit les vidéos officielles des techniques.
 *
 * Source : `zukan.inazuma.jp`, deux `fetch()` statiques par locale (le catalogue
 * des techniques est rendu côté serveur — aucun navigateur headless requis, à la
 * différence de `chara_param`). Toute la logique vit dans
 * `@rosegriffon/inagle/zukan/sync-skill-videos` ; cette tâche n'est que le point
 * d'entrée cron et son rapport.
 *
 * Écrit `inagle_skills.video_url` / `poster_url` / `thumbnail_url` et la table
 * `inagle_skill_videos` (une ligne par variante). Le miroir SQLite servi par
 * azalée est rafraîchi par `nie-miroir.timer` (dépôt `niers`), pas ici.
 *
 * Planifiée à 2h00 UTC, ENTRE `db:sync` et `db:sqlite-backup` (cf. `index.ts`).
 * Ce n'est pas une question de fraîcheur — le catalogue upstream ne bouge qu'aux
 * mises à jour du jeu — mais de réparation : `db:sync` vide `inagle_skills`, et
 * la clé étrangère `on delete cascade` emporte `inagle_skill_videos` avec elle.
 * Le push préserve maintenant ce qu'il trouvait en base ; cette tâche est la
 * seule qui sache le reconstruire depuis zukan si la préservation a échoué.
 * Toujours joignable à la demande : `bun packages/cron/src/index.ts --run zukan:videos`.
 */
import { syncZukanSkillVideos } from "@rosegriffon/inagle/zukan/sync-skill-videos";

export async function rafraichirVideosTechniques(): Promise<{
	success: boolean;
	stats: {
		techniques: number;
		examinees: number;
		zukanTechniques: number;
		zukanDeuxVideos: number;
		planifiees: number;
		videos: number;
		techniquesEcrites: number;
		videosEcrites: number;
		sansCorrespondance: number;
	};
}> {
	const res = await syncZukanSkillVideos({ apply: true });
	const videos = res.plans.reduce((n, p) => n + p.videos.length, 0);

	console.log(
		`[zukan:videos] ${res.skillsUpdated} techniques et ${res.videosUpserted} vidéos écrites ` +
			`(${res.unresolved.length} sans correspondance upstream, laissées NULL).`
	);

	return {
		success: true,
		stats: {
			examinees: res.examined,
			planifiees: res.plans.length,
			sansCorrespondance: res.unresolved.length,
			techniques: res.skillsTotal,
			techniquesEcrites: res.skillsUpdated,
			videos,
			videosEcrites: res.videosUpserted,
			zukanDeuxVideos: res.zukanMulti,
			zukanTechniques: res.zukanSkills,
		},
	};
}
