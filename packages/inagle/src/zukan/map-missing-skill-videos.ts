/**
 * map-missing-skill-videos.ts — CLI d'audit/peuplement des vidéos de techniques.
 *
 * SOURCE : deux `fetch()` statiques (`/{en,ja}/skill/?per_page=500&page={1,2}`).
 * Le catalogue est rendu côté serveur — l'ancien répertoire scrappé
 * `/tmp/zukan/**` n'existe plus et n'est plus nécessaire.
 *
 * Toute la logique (matching, Dreamscape, écriture) vit dans `sync-skill-videos.ts`,
 * partagée avec la tâche cron `zukan:videos`. Ce fichier n'est que l'interface
 * en ligne de commande et son rapport.
 *
 * Usage : bun packages/inagle/src/zukan/map-missing-skill-videos.ts [--apply] [--missing]
 *   sans --apply  : dry-run (audit + plan, aucune écriture).
 *   --missing     : ne traite que les techniques sans `video_url`.
 */
import { syncZukanSkillVideos } from "./sync-skill-videos.js";

async function main() {
	const apply = process.argv.includes("--apply");
	const onlyMissing = process.argv.includes("--missing");

	const res = await syncZukanSkillVideos({ apply, onlyMissing });

	console.log(`Techniques réelles: ${res.skillsTotal} — examinées: ${res.examined}`);
	console.log(
		`zukan: ${res.zukanSkills} techniques publiées — ${res.zukanMulti} avec deux vidéos`
	);

	const totalVideos = res.plans.reduce((n, p) => n + p.videos.length, 0);
	const multi = res.plans.filter((p) => p.videos.length > 1).length;
	console.log(
		`\nPlanifié: ${res.plans.length} techniques, ${totalVideos} vidéos (${multi} à deux vidéos)`
	);

	const viaCount = new Map<string, number>();
	for (const p of res.plans) {
		const key = p.via.startsWith("dreamscape") ? "dreamscape" : p.via;
		viaCount.set(key, (viaCount.get(key) ?? 0) + 1);
	}
	for (const [k, v] of viaCount) {
		console.log(`  via ${k}: ${v}`);
	}

	console.log(`\nSans vidéo upstream (${res.unresolved.length}) — laissés NULL:`);
	for (const s of res.unresolved) {
		console.log(`  ${s.internalCode}  ${s.nameFr ?? ""} (${s.nameEn ?? ""})`);
	}

	if (!res.applied) {
		console.log("\n[dry-run] relancer avec --apply pour écrire.");
		return;
	}
	console.log(`\ninagle_skills mis à jour: ${res.skillsUpdated}`);
	console.log(`inagle_skill_videos écrits: ${res.videosUpserted}`);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
