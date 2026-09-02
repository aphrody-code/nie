/**
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * REVALIDATION DES CRÉATIONS INSTAGRAM d'une campagne
 * (`public.campagne_creations_instagram`).
 *
 * ── CE QU'ELLE FAIT, ET POURQUOI ELLE DOIT EXISTER ─────────────────────────
 * Les deux autres sources d'une campagne se corrigent toutes seules : un tweet
 * supprimé disparaît de `tweets`, un message Discord effacé porte un
 * `deleted_at` que la galerie filtre. Instagram, lui, ne nous dit RIEN. La
 * publication vit chez Meta, et notre ligne n'est qu'une photographie prise au
 * moment du dépôt. Son auteur peut ensuite la supprimer, passer son compte en
 * privé, ou l'archiver — la galerie de /iergday continuerait d'afficher une
 * carte qui renvoie vers un 404, et le staff n'aurait aucun moyen de le savoir
 * autrement qu'en cliquant sur chaque vignette.
 *
 * Cette tâche repose donc LA question au seul point d'entrée Instagram qui
 * réponde encore sans compte (`instagram_oembed`, mesuré le 13/8/2026), et en
 * tire une décision de modération. Elle ne récolte rien : il n'existe aucun
 * collecteur de hashtag Instagram (`docs/insta.md`), c'est le formulaire de
 * /iergday qui remplit la table.
 *
 * ── LES TROIS RÈGLES QUI COMPTENT ──────────────────────────────────────────
 *  1. UNE PANNE DE META N'EST PAS UNE SUPPRESSION. Le verdict `indeterminee`
 *     (5xx, réseau coupé, quota) ne masque RIEN et n'écrit même pas
 *     `verifie_le` : la ligne sera reprise à la passe suivante. Traiter une
 *     coupure comme un retrait viderait la galerie entière en une passe, et
 *     personne ne saurait dire pourquoi.
 *  2. ON NE DÉFAIT JAMAIS UNE DÉCISION HUMAINE. Une création masquée par le
 *     staff porte SON motif ; redevenue publique chez Instagram, elle reste
 *     masquée. Seules les lignes masquées par CETTE tâche (motif exact
 *     `MOTIF_AUTOMATIQUE`) sont restaurées — un auteur qui repasse son compte en
 *     public retrouve sa place sans écrire à personne.
 *  3. `a_media` VEUT DIRE « une image SERVABLE », pas « la publication a une
 *     photo ». Si l'objet a disparu du bucket, la ligne est corrigée à
 *     `a_media = false` : mieux vaut une création absente de la galerie qu'une
 *     vignette cassée qui promet une image inexistante.
 *
 * ── CE QU'ELLE NE FAIT PAS, ET POURQUOI ────────────────────────────────────
 * Elle ne RÉ-HÉBERGE rien. Pour une ligne d'origine `formulaire` — les seules
 * qui existent à ce jour — l'unique copie de l'image était l'envoi du membre :
 * `images[].url_origine` porte le PERMALIEN (une page HTML), pas une URL de
 * média. Il n'y a littéralement rien à retélécharger, et écrire un
 * téléchargeur pour l'`origine = 'graph_api'` (zéro ligne, API non accordée)
 * reviendrait à livrer du code que rien n'a jamais exercé. La tâche constate,
 * corrige le compteur, et le dit dans son journal.
 *
 * Usage :
 *   bun packages/cron/src/tasks/campagnes-instagram.ts [--campagne <slug>]
 *                                     [--limite N] [--fraicheur H] [--tout] [--dry]
 */

import {
	permalienCanonique,
	verifierPublication,
	type VerdictPublication,
} from "@rosegriffon/types/instagram";

import { sql } from "../lib/db.js";
import { baseStorage } from "../lib/storage-assets.js";

const PREFIXE = "[Campagnes Instagram]";

/** Bucket public où les créations ont été recopiées au dépôt. */
const BUCKET = "assets";

/**
 * Motif écrit par CETTE tâche, et par elle seule.
 *
 * C'est la clé de la règle 2 : il sert de signature. Une ligne qui porte ce
 * motif exact a été masquée automatiquement et peut donc être restaurée
 * automatiquement ; tout autre motif est la décision d'un humain, qu'aucune
 * passe de cron ne doit défaire. Ne PAS le reformuler sans migrer les lignes
 * existantes — elles cesseraient d'être restaurables.
 */
export const MOTIF_AUTOMATIQUE = "post retiré par son auteur, ou compte passé en privé";

/** Lignes revalidées par passe. Plafond de politesse envers Meta. */
const MAX_PAR_PASSE = 60;

/** On ne repose pas la question à Meta plus d'une fois par demi-journée. */
const FRAICHEUR_HEURES = 12;

/** Petite pause entre deux appels : politesse, et rien ne presse. */
const PAUSE_MS = 250;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface OptionsRevalidationInstagram {
	/** Restreint la passe à une seule campagne. */
	slug?: string;
	/** Plafond de lignes revalidées. */
	limite?: number;
	/** Ne repasse pas sur ce qui a été vérifié depuis moins de N heures. */
	fraicheurH?: number;
	/** Ignore la fraîcheur : tout est revérifié (diagnostic manuel). */
	tout?: boolean;
	/** Simulation : interroge Meta et le Storage, n'écrit pas en base. */
	dry?: boolean;
}

export interface StatsRevalidationInstagram {
	success: boolean;
	/** Lignes effectivement interrogées. */
	examinees: number;
	/** Publications toujours en ligne et publiques. */
	publiques: number;
	/** Publications disparues → masquées par cette passe. */
	masquees: number;
	/** Publications revenues → démasquées (motif automatique uniquement). */
	restaurees: number;
	/** Verdict non concluant (panne Meta) : ni masquage, ni `verifie_le`. */
	indeterminees: number;
	/** Lignes dont au moins une image a disparu du bucket. */
	imagesManquantes: number;
	/** Lignes dont `a_media`/`nb_images` ont été corrigés. */
	compteursCorriges: number;
	/** Lignes restant à voir après le plafond de la passe. */
	reportees: number;
	dry: boolean;
	error?: string;
}

interface LigneCreation {
	campagne_slug: string;
	shortcode: string;
	permalink: string | null;
	images: unknown;
	a_media: boolean;
	nb_images: number;
	masque: boolean;
	motif_masquage: string | null;
	origine: string;
}

/** Une image telle qu'elle est stockée dans `images` (jsonb). */
interface ImageDeposee {
	chemin?: string | null;
	url_origine?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Décision — PURE, donc testable sans réseau ni base
// ─────────────────────────────────────────────────────────────────────────────

/** Ce que la passe fait d'une ligne, une fois Meta interrogé. */
export type ActionModeration = "masquer" | "restaurer" | "rien";

/**
 * Que faire de cette ligne au vu du verdict d'Instagram ?
 *
 * Toute la prudence de la tâche tient dans ces six lignes, et chacune répare un
 * dégât précis :
 *   * `indeterminee` -> RIEN. Une coupure de Meta masquerait sinon toute la
 *     galerie d'un coup, et rien dans l'interface ne dirait que c'est une panne.
 *   * déjà masquée -> RIEN à masquer. Réécrire le motif effacerait celui d'un
 *     modérateur (« signalement », « hors sujet ») par un motif générique.
 *   * publique + masquée par NOUS -> RESTAURER. L'auteur a remis son compte en
 *     public : il n'a pas à écrire à l'équipe pour retrouver sa place.
 *   * publique + masquée par un HUMAIN -> RIEN. Une décision de modération ne se
 *     défait pas parce qu'Instagram répond 200.
 */
export function decisionModeration(
	verdict: VerdictPublication,
	ligne: { masque: boolean; motif_masquage: string | null }
): ActionModeration {
	if (verdict === "indeterminee") return "rien";
	if (verdict === "introuvable") return ligne.masque ? "rien" : "masquer";
	return ligne.masque && ligne.motif_masquage === MOTIF_AUTOMATIQUE ? "restaurer" : "rien";
}

// ─────────────────────────────────────────────────────────────────────────────
// Lecture défensive du jsonb (même précaution que la récolte Discord : selon le
// pilote, une colonne jsonb peut revenir déjà sérialisée)
// ─────────────────────────────────────────────────────────────────────────────

function tableau(valeur: unknown): unknown[] {
	if (Array.isArray(valeur)) return valeur;
	if (typeof valeur === "string") {
		try {
			const analyse: unknown = JSON.parse(valeur);
			return Array.isArray(analyse) ? analyse : [];
		} catch {
			return [];
		}
	}
	return [];
}

function message(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/**
 * Cet objet est-il TOUJOURS dans le bucket ?
 *
 * `HEAD` et non `GET` : on ne veut pas rapatrier une image de plusieurs mégas
 * pour apprendre qu'elle existe. En cas de doute (Storage injoignable, clé
 * absente) on répond `true` — comme pour Meta, une panne de NOTRE côté ne doit
 * pas retirer la création d'un membre.
 */
async function objetPresent(chemin: string): Promise<boolean> {
	const cle = Bun.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!cle) return true;
	try {
		const reponse = await fetch(`${baseStorage()}/storage/v1/object/${BUCKET}/${chemin}`, {
			headers: { apikey: cle, authorization: `Bearer ${cle}` },
			method: "HEAD",
		});
		// 404 = l'objet n'est plus là. Tout autre échec est le nôtre, pas le sien.
		return reponse.status !== 404;
	} catch {
		return true;
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Passe
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Revalide les créations Instagram déposées : le lien pointe-t-il encore une
 * publication publique, et son image est-elle encore servable ?
 */
export async function revaliderCreationsInstagram(
	options: OptionsRevalidationInstagram = {}
): Promise<StatsRevalidationInstagram> {
	const {
		slug,
		limite = MAX_PAR_PASSE,
		fraicheurH = FRAICHEUR_HEURES,
		tout = false,
		dry = false,
	} = options;

	const stats: StatsRevalidationInstagram = {
		success: true,
		examinees: 0,
		publiques: 0,
		masquees: 0,
		restaurees: 0,
		indeterminees: 0,
		imagesManquantes: 0,
		compteursCorriges: 0,
		reportees: 0,
		dry,
	};

	try {
		/*
		 * ⚠ ON NE FILTRE PAS SUR `actif` NI SUR `publiee`, et c'est volontaire —
		 * même raison que la récolte Discord. Une campagne archivée garde sa
		 * galerie en ligne ; un post supprimé y laisse exactement la même carte
		 * morte que sur la campagne en cours. La revalidation ne coûte qu'un appel
		 * oEmbed par création, sans quota connu.
		 *
		 * L'ordre `verifie_le nulls first` fait passer les dépôts jamais contrôlés
		 * devant, puis les plus anciennement vus : sur une table plus grande que le
		 * plafond de la passe, la rotation couvre tout sans mémoire d'état.
		 */
		const lignes = (await sql`
			select campagne_slug, shortcode, permalink, images, a_media, nb_images,
			       masque, motif_masquage, origine
			  from public.campagne_creations_instagram
			 where (${slug ?? null}::text is null or campagne_slug = ${slug ?? null}::text)
			   and (${tout}::boolean
			        or verifie_le is null
			        or verifie_le < now() - make_interval(hours => ${fraicheurH}::int))
			 order by verifie_le asc nulls first, collecte_le asc
			 limit ${limite + 1}`) as LigneCreation[];

		if (lignes.length === 0) {
			const quoi = slug ? `la campagne « ${slug} »` : "aucune campagne";
			console.log(`${PREFIXE} Rien à revalider : ${quoi} n'a de création Instagram à revoir.`);
			return stats;
		}

		// La ligne excédentaire ne sert qu'à savoir s'il en reste : on ne l'examine
		// pas. Annoncer « 60 traitées » sans dire qu'il en restait 200 laisserait
		// croire la table entière contrôlée.
		if (lignes.length > limite) {
			stats.reportees = lignes.length - limite;
			lignes.length = limite;
		}

		console.log(
			`${PREFIXE} ${lignes.length} création(s) à revalider${stats.reportees > 0 ? ` (+ au moins ${stats.reportees} reportée(s))` : ""}${dry ? " — MODE SIMULATION, aucune écriture" : ""}.`
		);

		for (const ligne of lignes) {
			stats.examinees++;

			// Le permalien stocké fait foi ; s'il manque, on le reconstruit depuis le
			// shortcode — la même URL canonique que celle vérifiée au dépôt.
			const permalien = ligne.permalink || permalienCanonique(ligne.shortcode);
			const verification = await verifierPublication(permalien, {
				base: Bun.env.INSTAGRAM_OEMBED_URL,
			});

			if (verification.verdict === "publique") stats.publiques++;
			if (verification.verdict === "indeterminee") stats.indeterminees++;

			const action = decisionModeration(verification.verdict, ligne);

			// Les images sont contrôlées MÊME quand la publication a disparu : la
			// galerie du staff (`/admin/iergday`) lit ces compteurs, et une ligne
			// masquée reste consultable.
			const images = tableau(ligne.images) as ImageDeposee[];
			let servables = 0;
			let manquante = false;
			for (const image of images) {
				const chemin = typeof image?.chemin === "string" ? image.chemin : null;
				if (!chemin) continue;
				if (await objetPresent(chemin)) servables++;
				else manquante = true;
			}
			if (manquante) {
				stats.imagesManquantes++;
				console.warn(
					`${PREFIXE} ${ligne.campagne_slug}/${ligne.shortcode} (origine « ${ligne.origine} ») : ` +
						`image absente du bucket ${BUCKET}. Rien à retélécharger — ` +
						`\`images[].url_origine\` porte le permalien, pas une URL de média. ` +
						`La ligne est marquée non servable ; il faut la re-déposer.`
				);
			}

			const servable = servables > 0;
			const compteursACorriger = ligne.a_media !== servable || ligne.nb_images !== servables;

			if (action === "rien" && !compteursACorriger && verification.verdict === "indeterminee") {
				await Bun.sleep(PAUSE_MS);
				continue;
			}

			if (action === "masquer") stats.masquees++;
			if (action === "restaurer") stats.restaurees++;
			if (compteursACorriger) stats.compteursCorriges++;

			if (dry) {
				if (action !== "rien" || compteursACorriger) {
					console.log(
						`${PREFIXE} SIMULATION — ${ligne.campagne_slug}/${ligne.shortcode} : ${action}` +
							`${compteursACorriger ? `, compteurs → a_media=${servable} nb_images=${servables}` : ""}.`
					);
				}
				await Bun.sleep(PAUSE_MS);
				continue;
			}

			/*
			 * ⚠ `verifie_le` N'EST ÉCRIT QUE SUR UN VERDICT CONCLUANT. Le poser sur
			 * un `indeterminee` mettrait la ligne en sommeil pour douze heures à
			 * cause d'une panne de Meta de trente secondes ; la laisser telle quelle
			 * la fait reprendre à la passe suivante.
			 *
			 * `masque`/`motif_masquage` ne sont touchés QUE par la branche
			 * correspondante : hors masquage automatique, la décision du modérateur
			 * traverse toutes les passes sans être relue.
			 */
			await sql`
				update public.campagne_creations_instagram
				   set a_media   = ${servable},
				       nb_images = ${servables},
				       masque = case when ${action === "masquer"}::boolean then true
				                     when ${action === "restaurer"}::boolean then false
				                     else masque end,
				       motif_masquage = case when ${action === "masquer"}::boolean then ${MOTIF_AUTOMATIQUE}::text
				                             when ${action === "restaurer"}::boolean then null
				                             else motif_masquage end,
				       verifie_le = case when ${verification.verdict === "indeterminee"}::boolean then verifie_le
				                         else now() end
				 where campagne_slug = ${ligne.campagne_slug}
				   and shortcode = ${ligne.shortcode}`;

			if (action !== "rien") {
				console.log(
					`${PREFIXE} ${ligne.campagne_slug}/${ligne.shortcode} : ${action === "masquer" ? "masquée — " + MOTIF_AUTOMATIQUE : "restaurée, la publication est revenue"}.`
				);
			}

			await Bun.sleep(PAUSE_MS);
		}

		console.log(
			`${PREFIXE} ${stats.examinees} revalidée(s) : ${stats.publiques} en ligne, ` +
				`${stats.masquees} masquée(s), ${stats.restaurees} restaurée(s), ` +
				`${stats.indeterminees} sans réponse de Meta (reprise à la prochaine passe)` +
				`${stats.imagesManquantes > 0 ? `, ${stats.imagesManquantes} image(s) disparue(s) du bucket` : ""}.`
		);

		return stats;
	} catch (err) {
		console.error(`${PREFIXE} Échec global :`, message(err));
		return { ...stats, success: false, error: message(err) };
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Interface en ligne de commande
// ─────────────────────────────────────────────────────────────────────────────

function lireOptions(argv: readonly string[]): OptionsRevalidationInstagram {
	const valeur = (nom: string): string | undefined => {
		const position = argv.indexOf(nom);
		return position === -1 ? undefined : argv[position + 1];
	};
	const nombre = (nom: string): number | undefined => {
		const brut = Number(valeur(nom));
		return Number.isFinite(brut) && brut > 0 ? brut : undefined;
	};
	return {
		slug: valeur("--campagne"),
		limite: nombre("--limite"),
		fraicheurH: nombre("--fraicheur"),
		tout: argv.includes("--tout"),
		dry: argv.includes("--dry"),
	};
}

if (import.meta.main) {
	const argv = Bun.argv.slice(2);
	if (argv.includes("--help") || argv.includes("-h")) {
		console.log(
			[
				"Revalide les créations Instagram déposées (public.campagne_creations_instagram).",
				"",
				"  bun packages/cron/src/tasks/campagnes-instagram.ts [options]",
				"",
				"  --campagne <slug>  ne traite que cette campagne (défaut : toutes)",
				"  --limite <n>       plafond de lignes revalidées (défaut : 60)",
				"  --fraicheur <h>    ne repasse pas sur ce qui date de moins de h heures (défaut : 12)",
				"  --tout             ignore la fraîcheur et revérifie tout",
				"  --dry              simulation : interroge Meta, n'écrit pas en base",
			].join("\n")
		);
		process.exit(0);
	}

	const resultat = await revaliderCreationsInstagram(lireOptions(argv));
	console.log(
		`\n${PREFIXE} ── Résumé ── examinees=${resultat.examinees} publiques=${resultat.publiques} ` +
			`masquees=${resultat.masquees} restaurees=${resultat.restaurees} ` +
			`indeterminees=${resultat.indeterminees} images_manquantes=${resultat.imagesManquantes} ` +
			`compteurs_corriges=${resultat.compteursCorriges} reportees=${resultat.reportees}` +
			`${resultat.dry ? " (simulation)" : ""}`
	);
	if (resultat.error) console.error(`  ERREUR : ${resultat.error}`);
	process.exit(resultat.success ? 0 : 1);
}
