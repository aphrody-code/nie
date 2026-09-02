#!/usr/bin/env bun
/**
 * `catalogue` — la vue d'ensemble des quatre gisements, en ligne de commande.
 *
 * Sert d'abord au diagnostic : avant de chercher pourquoi le bot ne répond pas ou pourquoi une
 * fiche est vide, on demande à la machine ce qu'elle a sous la main. Un gisement présent mais
 * vide s'y voit immédiatement, là où une requête muette laisserait croire à une absence de
 * données.
 *
 * ```
 * bun --bun packages/nie-catalog/src/cli.ts etat
 * bun --bun packages/nie-catalog/src/cli.ts cherche "Mark Evans"
 * bun --bun packages/nie-catalog/src/cli.ts personnage mark-evans-0x06E25622
 * bun --bun packages/nie-catalog/src/cli.ts film ev01_00050
 * ```
 */
import { catalogue } from "./index.ts";
import { personnageComplet } from "./synergie.ts";

const [commande, ...reste] = process.argv.slice(2);
const argument = reste.join(" ");

/** Sortie JSON si `--json` est passé, sinon un rendu lisible. */
const enJson = process.argv.includes("--json");

function ecrire(valeur: unknown, rendu: () => void): void {
	if (enJson) {
		console.log(JSON.stringify(valeur, null, 2));
	} else {
		rendu();
	}
}

switch (commande) {
	case "etat": {
		const gisements = catalogue.etat();
		ecrire(gisements, () => {
			console.log("Gisements Inazuma Eleven");
			for (const g of gisements) {
				console.log(
					`  ${g.disponible ? "✓" : "✗"} ${g.nom.padEnd(8)} ${g.contenu.padEnd(40)} ${g.emplacement ?? ""}`,
				);
			}
		});
		break;
	}

	case "cherche": {
		const r = catalogue.chercher(argument, 8);
		ecrire(r, () => {
			console.log(`« ${argument} »`);
			console.log(`  personnages (${r.personnages.length})`);
			for (const p of r.personnages) {
				console.log(`    ${p.name_fr ?? p.name_en ?? "?"} — ${p.slug} [${p.internal_code}]`);
			}
			console.log(`  épisodes (${r.episodes.length})`);
			for (const e of r.episodes) {
				console.log(`    S${e.season}E${e.episode} ${e.title}`);
			}
			console.log(`  fonctions (${r.fonctions.length})`);
			for (const f of r.fonctions) {
				console.log(`    0x${f.vaddr.toString(16)} ${f.name}`);
			}
		});
		break;
	}

	case "personnage": {
		const p = await personnageComplet(argument);
		if (!p) {
			console.error(`Aucun personnage « ${argument} » dans le miroir.`);
			process.exit(1);
		}
		ecrire(p, () => {
			console.log(`${p.fiche.name_fr ?? p.fiche.name_en} — ${p.fiche.internal_code}`);
			console.log(`  ${p.fiche.element ?? "?"} · ${p.fiche.position ?? "?"}`);
			const f = p.fichiers.valeur;
			console.log(
				`  fichiers (${p.fichiers.confiance} par ${p.fichiers.par}) : ${f.modeles.length} modèles, ${f.textures.length} textures, ${f.sons.length} sons`,
			);
			console.log(`  code : ${p.code.valeur.length} fonctions citant ${p.code.par}`);
			console.log(`  série (${p.episodes.confiance}) : ${p.episodes.valeur.length} épisodes`);
			for (const e of p.episodes.valeur.slice(0, 5)) {
				console.log(`    S${e.season}E${e.episode} ${e.title}`);
			}
		});
		break;
	}

	case "film": {
		const f = catalogue.film(argument);
		ecrire(f, () => {
			console.log(`${f.nom}`);
			console.log(`  vidéo     : ${f.video}`);
			console.log(`  bande-son : ${f.bandeSon}`);
			console.log(`  événement : ${f.evenement.valeur ? "trouvé" : "aucun"}`);
			console.log(`  répliques : ${f.repliques.valeur.length}`);
			console.log(`  code      : ${f.code.valeur.length} fonctions`);
		});
		break;
	}

	case "technique": {
		const t = catalogue.technique(argument);
		if (!t) {
			console.error(`Aucune technique « ${argument} » dans le miroir.`);
			process.exit(1);
		}
		ecrire(t, () => {
			console.log(`${t.fiche.name_fr ?? t.fiche.name_en} — ${t.fiche.internal_code}`);
			console.log(`  ${t.fiche.element ?? "?"} · ${t.fiche.category ?? "?"}`);
			console.log(`  vidéos : ${t.videos.valeur.length} · télop : ${t.telop.valeur ? "oui" : "non"}`);
			console.log(`  code   : ${t.code.valeur.length} fonctions`);
		});
		break;
	}

	default:
		console.log(`catalogue — les quatre gisements Inazuma Eleven du dépôt

  etat                    ce que cette machine peut répondre
  cherche <texte>         cherche dans les quatre à la fois
  personnage <slug>       la fiche réunie (base, VFS, reverse, série)
  film <nom>              la cinématique, son événement et ses répliques
  technique <id>          la technique, ses vidéos et son télop

  --json                  sortie machine`);
		process.exit(commande === undefined ? 0 : 1);
}
