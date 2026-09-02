/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

// Modération des publications de campagne affichées sur /iergday.
//
// POURQUOI CET OUTIL EXISTE
// La page republie les créations de TIERS. Le récolteur garantit qu'un post
// masqué le reste (les colonnes `masque`, `motif_masquage` et `mis_en_avant` sont
// absentes de sa clause `do update`), mais rien ne permettait de POSER ce
// masquage : honorer une demande de retrait exigeait d'ouvrir psql. Pour une
// galerie publique de contenus tiers, le retrait doit être une commande, pas une
// requête SQL improvisée dans l'urgence.
//
// PORTÉE VOLONTAIREMENT ÉTROITE
//  - `masque` cache le post de la galerie ET du flux public (la policy RLS
//    `Lecture publique des posts de campagne` porte `not masque`).
//  - `motif_masquage` est un texte de modération INTERNE. Il n'est lu par aucune
//    surface publique, et aucun déclencheur temps réel n'est posé sur ces tables
//    (le flux SSE `rg-realtime` n'est pas authentifié — cf. la section 5 de
//    `apps/website/supabase/migrations/20260812_01_campagnes_x.sql`).
//  - Les fichiers déjà ré-hébergés dans le Storage ne sont PAS supprimés : ils
//    sont partagés avec les autres consommateurs de `public.tweets`. La commande
//    affiche leur chemin pour qu'un retrait complet reste possible à la main.
//
// Usage :
//   bun packages/cron/src/tasks/ie-crawl/hashtag-moderation.ts --lister [--campagne <slug>] [--masques]
//   bun packages/cron/src/tasks/ie-crawl/hashtag-moderation.ts --masquer <tweetId> --motif "<raison>"
//   bun packages/cron/src/tasks/ie-crawl/hashtag-moderation.ts --demasquer <tweetId>
//   bun packages/cron/src/tasks/ie-crawl/hashtag-moderation.ts --avant <tweetId> | --retirer-avant <tweetId>

import { SQL } from "bun";
import { urlTweet } from "./tweet-row";

/** Ligne de modération telle qu'affichée par `--lister` et par les confirmations. */
export interface PostModere {
	campagne_slug: string;
	tweet_id: string;
	masque: boolean;
	motif_masquage: string | null;
	mis_en_avant: boolean;
	nb_images: number;
	author_username: string | null;
	publie_le: Date | null;
}

function sql(): SQL {
	return new SQL(Bun.env.DATABASE_URL);
}

/** Résumé d'une ligne pour la sortie console. */
function ligne(p: PostModere): string {
	const etat = p.masque ? "MASQUÉ " : p.mis_en_avant ? "À LA UNE" : "visible ";
	const auteur = p.author_username ? `@${p.author_username}` : "(auteur inconnu)";
	const url = p.author_username ? urlTweet(p.author_username, p.tweet_id) : p.tweet_id;
	const motif = p.motif_masquage ? ` — ${p.motif_masquage}` : "";
	return `  ${etat} ${p.campagne_slug.padEnd(18)} ${auteur.padEnd(20)} ${url}${motif}`;
}

/**
 * Change l'état de modération d'un post.
 *
 * Le `tweet_id` suffit : un même post peut appartenir à plusieurs campagnes, et
 * une demande de retrait porte sur la PUBLICATION, pas sur l'une de ses
 * apparitions. Sans `slug`, toutes les occurrences sont traitées — c'est le
 * comportement attendu d'un retrait.
 */
export async function changerModeration(
	db: SQL,
	tweetId: string,
	champs: { masque?: boolean; motif?: string | null; misEnAvant?: boolean },
	slug?: string
): Promise<PostModere[]> {
	const lignes = (await db`
		update public.x_campagne_posts p
		   set masque         = coalesce(${champs.masque ?? null}::boolean, p.masque),
		       motif_masquage = case
		                          when ${champs.masque ?? null}::boolean is false then null
		                          when ${champs.motif ?? null}::text is not null then ${champs.motif ?? null}::text
		                          else p.motif_masquage
		                        end,
		       mis_en_avant   = coalesce(${champs.misEnAvant ?? null}::boolean, p.mis_en_avant)
		 where p.tweet_id = ${tweetId}
		   and (${slug ?? null}::text is null or p.campagne_slug = ${slug ?? null}::text)
		returning p.campagne_slug, p.tweet_id, p.masque, p.motif_masquage, p.mis_en_avant,
		          p.nb_images, p.publie_le,
		          (select t.author_username from public.tweets t where t.id = p.tweet_id) as author_username`) as PostModere[];
	return lignes;
}

/** Liste les posts d'une campagne (ou seulement les masqués). */
export async function listerPosts(
	db: SQL,
	slug?: string,
	seulementMasques = false,
	limite = 50
): Promise<PostModere[]> {
	return (await db`
		select p.campagne_slug, p.tweet_id, p.masque, p.motif_masquage, p.mis_en_avant,
		       p.nb_images, p.publie_le, t.author_username
		  from public.x_campagne_posts p
		  left join public.tweets t on t.id = p.tweet_id
		 where (${slug ?? null}::text is null or p.campagne_slug = ${slug ?? null}::text)
		   and (${seulementMasques} = false or p.masque)
		 order by p.masque desc, p.mis_en_avant desc, p.publie_le desc
		 limit ${limite}`) as PostModere[];
}

/** Chemins des fichiers ré-hébergés d'un post, pour un retrait complet à la main. */
async function fichiersDuPost(db: SQL, tweetId: string): Promise<string[]> {
	const lignes = (await db`
		select name from storage.objects
		 where bucket_id = 'tweets' and name like ${`${tweetId}/%`}
		 order by name`) as Array<{ name: string }>;
	return lignes.map((l) => l.name);
}

// ─────────────────────────────────────────────────────────────────────────────
// Interface en ligne de commande
// ─────────────────────────────────────────────────────────────────────────────

function valeur(argv: readonly string[], nom: string): string | undefined {
	const i = argv.indexOf(nom);
	return i === -1 ? undefined : argv[i + 1];
}

const AIDE = [
	"Modération des publications de campagne X (page /iergday).",
	"",
	"  --lister                    liste les publications (50 max)",
	"    --campagne <slug>         restreint à une campagne",
	"    --masques                 n'affiche que les publications masquées",
	"",
	"  --masquer <tweetId> --motif \"<raison>\"   retire la publication du site",
	"  --demasquer <tweetId>                     la remet en ligne (efface le motif)",
	"  --avant <tweetId>                         la met « à la une »",
	"  --retirer-avant <tweetId>                 la retire de « à la une »",
	"",
	"Le motif est OBLIGATOIRE au masquage : il trace la demande de retrait.",
	"Il reste interne (aucune surface publique, aucun flux temps réel ne le lit).",
].join("\n");

async function principal(argv: readonly string[]): Promise<number> {
	const db = sql();
	try {
		const slug = valeur(argv, "--campagne");

		if (argv.includes("--lister")) {
			const posts = await listerPosts(db, slug, argv.includes("--masques"));
			if (posts.length === 0) {
				console.log("[Modération X] Aucune publication ne correspond.");
				return 0;
			}
			console.log(`[Modération X] ${posts.length} publication(s) :`);
			for (const p of posts) console.log(ligne(p));
			return 0;
		}

		const aMasquer = valeur(argv, "--masquer");
		const aDemasquer = valeur(argv, "--demasquer");
		const aPromouvoir = valeur(argv, "--avant");
		const aRetrograder = valeur(argv, "--retirer-avant");

		const cible = aMasquer ?? aDemasquer ?? aPromouvoir ?? aRetrograder;
		if (!cible) {
			console.log(AIDE);
			return 0;
		}

		let champs: Parameters<typeof changerModeration>[2];
		if (aMasquer) {
			const motif = valeur(argv, "--motif");
			if (!motif?.trim()) {
				console.error(
					"[Modération X] --motif est obligatoire avec --masquer (trace de la demande de retrait)."
				);
				return 1;
			}
			champs = { masque: true, motif: motif.trim() };
		} else if (aDemasquer) {
			champs = { masque: false };
		} else if (aPromouvoir) {
			champs = { misEnAvant: true };
		} else {
			champs = { misEnAvant: false };
		}

		const touches = await changerModeration(db, cible, champs, slug);
		if (touches.length === 0) {
			console.error(
				`[Modération X] Aucune publication ${cible}${slug ? ` dans la campagne ${slug}` : ""}.`
			);
			return 1;
		}
		console.log(`[Modération X] ${touches.length} ligne(s) mise(s) à jour :`);
		for (const p of touches) console.log(ligne(p));

		if (aMasquer) {
			const fichiers = await fichiersDuPost(db, cible);
			if (fichiers.length > 0) {
				console.log(
					`[Modération X] ${fichiers.length} fichier(s) restent dans le Storage (partagés avec public.tweets, NON supprimés) :`
				);
				for (const f of fichiers) console.log(`  tweets/${f}`);
				console.log(
					"[Modération X] Pour un retrait complet (demande RGPD), les supprimer explicitement du disque ET de storage.objects."
				);
			}
		}
		return 0;
	} catch (err) {
		console.error("[Modération X] Échec :", err instanceof Error ? err.message : String(err));
		return 1;
	} finally {
		await db.end();
	}
}

if (import.meta.main) {
	const argv = Bun.argv.slice(2);
	if (argv.includes("--help") || argv.includes("-h") || argv.length === 0) {
		console.log(AIDE);
		process.exit(0);
	}
	process.exit(await principal(argv));
}
