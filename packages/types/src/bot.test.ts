import { describe, expect, test } from "bun:test";

import {
	fusionnerReglages,
	GAIN_XP_DEFAUT,
	lireReglages,
	manquesParSection,
	manquesTickets,
	PROFILS_BOT,
	REGLAGES_DEFAUT,
	SchemaModificationReglages,
	SECTIONS_REGLAGES,
	TOUS_LES_PROFILS_BOT,
	validerReglages,
	type ModificationReglages,
} from "./bot";

const SALON = "123456789012345678";
const AUTRE_SALON = "987654321098765432";
const ROLE = "111111111111111111";

describe("défauts", () => {
	/**
	 * La règle d'activation manuelle, vérifiée sur le document lui-même : un bot
	 * fraîchement installé ne publie RIEN tant que le staff n'a pas dit où.
	 */
	test("un serveur qui n'a rien réglé ne publie nulle part", () => {
		expect(REGLAGES_DEFAUT.niveaux.annonce).toBe("aucune");
		expect(REGLAGES_DEFAUT.accueil.lieu).toBe("aucune");
		expect(REGLAGES_DEFAUT.suggestions.salon).toBeNull();
		expect(REGLAGES_DEFAUT.kizuna.salonAnnonce).toBeNull();
	});

	test("le gain par défaut est celui de `GAIN_XP_DEFAUT`", () => {
		expect(REGLAGES_DEFAUT.niveaux.gain).toEqual({
			minimum: GAIN_XP_DEFAUT.minimum,
			maximum: GAIN_XP_DEFAUT.maximum,
			delaiSecondes: GAIN_XP_DEFAUT.delaiSecondes,
		});
	});
});

describe("lecture tolérante, écriture stricte", () => {
	test("un document corrompu retombe sur les défauts sans lever", () => {
		expect(lireReglages("n'importe quoi")).toEqual(REGLAGES_DEFAUT);
		expect(lireReglages(null)).toEqual(REGLAGES_DEFAUT);
		expect(lireReglages({ niveaux: "oui" })).toEqual(REGLAGES_DEFAUT);
	});

	test("une écriture aberrante est refusée en disant pourquoi", () => {
		expect(() => validerReglages({ niveaux: { annonce: "ailleurs" } })).toThrow();
		expect(() => validerReglages({ tickets: { salonPanneau: "pas-un-flocon" } })).toThrow();
	});

	test("les listes de flocons sont dédoublonnées", () => {
		const doc = validerReglages({ niveaux: { salonsExclus: [SALON, SALON, AUTRE_SALON] } });
		expect(doc.niveaux.salonsExclus).toEqual([SALON, AUTRE_SALON]);
	});
});

/**
 * ── LE TEST QUI JUSTIFIE `partielSansDefauts` ──────────────────────────────
 * Avec un simple `.partial()`, `{ niveaux: { actif: false } }` ressort avec
 * `palierAnnonce: 5`, `annonce: "aucune"` et `salonAnnonce: null` — c'est-à-dire
 * qu'un basculement d'interrupteur EFFACE le salon d'annonce configuré. Ces
 * deux tests sont le filet qui empêche d'y revenir.
 */
describe("modification partielle", () => {
	const configure = fusionnerReglages(REGLAGES_DEFAUT, {
		niveaux: {
			annonce: "salon",
			salonAnnonce: SALON,
			palierAnnonce: 10,
			salonsExclus: [AUTRE_SALON],
			gain: { minimum: 5, maximum: 7 },
		},
		tickets: { salonPanneau: SALON, rolesStaff: [ROLE] },
	});

	test("un patch ne porte QUE ce qu'il a reçu", () => {
		expect(SchemaModificationReglages.parse({ niveaux: { actif: false } })).toEqual({
			niveaux: { actif: false },
		});
	});

	test("couper les niveaux ne perd ni le salon ni le palier", () => {
		const apres = fusionnerReglages(
			configure,
			SchemaModificationReglages.parse({ niveaux: { actif: false } }) as ModificationReglages
		);
		expect(apres.niveaux.actif).toBe(false);
		expect(apres.niveaux.salonAnnonce).toBe(SALON);
		expect(apres.niveaux.palierAnnonce).toBe(10);
		expect(apres.niveaux.salonsExclus).toEqual([AUTRE_SALON]);
	});

	test("régler le délai anti-spam ne remet pas la fourchette d'XP aux défauts", () => {
		const apres = fusionnerReglages(
			configure,
			SchemaModificationReglages.parse({
				niveaux: { gain: { delaiSecondes: 90 } },
			}) as ModificationReglages
		);
		expect(apres.niveaux.gain).toEqual({ minimum: 5, maximum: 7, delaiSecondes: 90 });
	});

	test("remplacer une liste la remplace, ne l'additionne pas", () => {
		const apres = fusionnerReglages(configure, { niveaux: { salonsExclus: [SALON] } });
		expect(apres.niveaux.salonsExclus).toEqual([SALON]);
	});

	test("une section absente du patch n'est pas touchée", () => {
		const apres = fusionnerReglages(configure, { accueil: { actif: false } });
		expect(apres.tickets.salonPanneau).toBe(SALON);
		expect(apres.tickets.rolesStaff).toEqual([ROLE]);
	});

	test("un champ inconnu est une erreur, pas un silence", () => {
		expect(() => SchemaModificationReglages.parse({ niveaux: { inconnu: 1 } })).toThrow();
		expect(() => SchemaModificationReglages.parse({ inexistant: {} })).toThrow();
	});
});

describe("manques", () => {
	test("les tickets disent CE QU'IL RESTE à poser", () => {
		const manques = manquesTickets(REGLAGES_DEFAUT);
		expect(manques).toHaveLength(3);
		expect(manques.join(" ")).toContain("salon-panneau");
	});

	test("le mode salon réclame en plus la catégorie", () => {
		const doc = fusionnerReglages(REGLAGES_DEFAUT, {
			tickets: {
				mode: "salon",
				salonPanneau: SALON,
				salonHistorique: AUTRE_SALON,
				rolesStaff: [ROLE],
			},
		});
		expect(manquesTickets(doc)).toEqual([
			"la catégorie Support (`categorie`), obligatoire en mode salon",
		]);
	});

	test("une section désactivée ne réclame rien", () => {
		const doc = fusionnerReglages(REGLAGES_DEFAUT, {
			tickets: { actif: false },
			suggestions: { actif: false },
		});
		const manques = manquesParSection(doc);
		expect(manques.tickets).toEqual([]);
		expect(manques.suggestions).toEqual([]);
	});

	test("une annonce « salon » sans salon est un manque", () => {
		const doc = fusionnerReglages(REGLAGES_DEFAUT, { niveaux: { annonce: "salon" } });
		expect(manquesParSection(doc).niveaux).toHaveLength(1);
	});

	test("le journal de modération réclame son salon tant qu'il n'en a pas", () => {
		expect(manquesParSection(REGLAGES_DEFAUT).moderation).toEqual([
			"le salon du journal de modération",
		]);
		const branche = fusionnerReglages(REGLAGES_DEFAUT, {
			moderation: { salonJournal: "1073752409387573339" },
		});
		expect(manquesParSection(branche).moderation).toEqual([]);
		// Coupé volontairement, il ne réclame plus rien : ce n'est pas une panne.
		const coupe = fusionnerReglages(REGLAGES_DEFAUT, { moderation: { actif: false } });
		expect(manquesParSection(coupe).moderation).toEqual([]);
	});

	test("enregistrer une autre section n'efface pas le salon du journal", () => {
		// Le piège du `.prefault({})` : une section absente de `fusionnerReglages`
		// est RECRÉÉE aux défauts à chaque parse — donc effacée en silence.
		const branche = fusionnerReglages(REGLAGES_DEFAUT, {
			moderation: { salonJournal: "1073752409387573339" },
		});
		const apres = fusionnerReglages(branche, { niveaux: { actif: false } });
		expect(apres.moderation.salonJournal).toBe("1073752409387573339");
	});

	test("toutes les sections ont une entrée, même vide", () => {
		const manques = manquesParSection(REGLAGES_DEFAUT);
		for (const section of SECTIONS_REGLAGES) {
			expect(Array.isArray(manques[section])).toBe(true);
		}
	});
});

describe("profils", () => {
	test("les deux profils ont des ports d'administration distincts", () => {
		const ports = TOUS_LES_PROFILS_BOT.map((p) => p.portAdmin);
		expect(new Set(ports).size).toBe(ports.length);
	});

	test("chaque profil nomme son unité systemd", () => {
		expect(PROFILS_BOT.rg.unite).toBe("rg-bot.service");
		expect(PROFILS_BOT.azalee.unite).toBe("azalee-bot.service");
	});
});
