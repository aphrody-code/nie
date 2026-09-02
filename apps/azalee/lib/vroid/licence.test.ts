/// <reference types="bun" />
/**
 * Vérifie la traduction des conditions d'utilisation d'un modèle.
 *
 * Le tableau de correspondance vient des guidelines d'affichage de pixiv
 * (https://developer.vroid.com/en/guidelines/conditions_of_use.html) : une
 * valeur mal traduite ferait afficher « Autorisé » sur un modèle qui interdit
 * l'usage, ce qui est une violation de licence — d'où des cas explicites pour
 * chaque valeur limite plutôt qu'un test de forme.
 *
 * Le jeu d'essai VRM 0.0 reprend la licence réellement renvoyée par
 * `/api/staff_picks` le 2026-09-02 (tout à `disallow`, crédit `necessary`).
 */
import { describe, expect, test } from "bun:test";
import { conditionsDuModele, creditRequis, estChargeable, nomModele } from "./licence";
import type { LicenceVrm0, MetaVrm1, ModeleVroid } from "./types";

/** Assemble un modèle minimal portant la licence ou les métadonnées voulues. */
function modele(parties: Partial<ModeleVroid>): ModeleVroid {
	return { id: "1", tags: [], character_model_booth_items: [], ...parties } as unknown as ModeleVroid;
}

/** Retrouve le verdict d'une condition par sa clé. */
function verdict(cible: ModeleVroid, cle: string): string | undefined {
	return conditionsDuModele(cible).conditions.find((condition) => condition.cle === cle)?.verdict;
}

const LICENCE_MESUREE: LicenceVrm0 = {
	modification: "disallow",
	redistribution: "disallow",
	credit: "necessary",
	characterization_allowed_user: "author",
	sexual_expression: "disallow",
	violent_expression: "disallow",
	corporate_commercial_use: "disallow",
	personal_commercial_use: "disallow",
};

describe("conditions VRM 0.0", () => {
	const sujet = modele({ license: LICENCE_MESUREE });

	test("est reconnu comme du VRM 0.0", () => {
		expect(conditionsDuModele(sujet).specification).toBe("vrm0");
	});

	test("traduit chaque interdiction sans l'adoucir", () => {
		expect(verdict(sujet, "avatar")).toBe("interdit");
		expect(verdict(sujet, "violence")).toBe("interdit");
		expect(verdict(sujet, "sexuel")).toBe("interdit");
		expect(verdict(sujet, "entreprise")).toBe("interdit");
		expect(verdict(sujet, "commercial-perso")).toBe("interdit");
		expect(verdict(sujet, "redistribution")).toBe("interdit");
		expect(verdict(sujet, "modification")).toBe("interdit");
		expect(verdict(sujet, "credit")).toBe("requis");
	});

	test("`default` vaut « non renseigné », jamais « autorisé »", () => {
		const flou = modele({
			license: { ...LICENCE_MESUREE, violent_expression: "default", characterization_allowed_user: "default" },
		});
		expect(verdict(flou, "violence")).toBe("inconnu");
		expect(verdict(flou, "avatar")).toBe("inconnu");
	});

	test("distingue l'usage personnel non lucratif de l'interdiction", () => {
		const lucratif = modele({ license: { ...LICENCE_MESUREE, personal_commercial_use: "profit" } });
		const nonLucratif = modele({ license: { ...LICENCE_MESUREE, personal_commercial_use: "nonprofit" } });
		expect(verdict(lucratif, "commercial-perso")).toBe("autorise");
		expect(verdict(nonLucratif, "commercial-perso")).toBe("non-lucratif");
	});

	test("`everyone` est la seule valeur qui autorise l'usage en avatar", () => {
		const ouvert = modele({ license: { ...LICENCE_MESUREE, characterization_allowed_user: "everyone" } });
		expect(verdict(ouvert, "avatar")).toBe("autorise");
	});
});

describe("conditions VRM 1.0", () => {
	const META: MetaVrm1 = {
		avatarPermission: "everyone",
		allowExcessivelyViolentUsage: false,
		allowExcessivelySexualUsage: false,
		allowPoliticalOrReligiousUsage: true,
		allowAntisocialOrHateUsage: false,
		commercialUsage: "personalProfit",
		creditNotation: "required",
		allowRedistribution: false,
		modification: "allowModification",
	};
	const sujet = modele({
		latest_character_model_version: { vrm_meta: META } as ModeleVroid["latest_character_model_version"],
	});

	test("prime sur `license` quand `vrm_meta` est présent", () => {
		const mixte = modele({
			license: LICENCE_MESUREE,
			latest_character_model_version: {
				vrm_meta: META,
			} as ModeleVroid["latest_character_model_version"],
		});
		expect(conditionsDuModele(mixte).specification).toBe("vrm1");
		// La licence VRM 0.0 interdit l'avatar, les métadonnées VRM 1.0 l'autorisent.
		expect(verdict(mixte, "avatar")).toBe("autorise");
	});

	test("ajoute les deux conditions absentes du VRM 0.0", () => {
		expect(verdict(sujet, "politique")).toBe("autorise");
		expect(verdict(sujet, "haine")).toBe("interdit");
		expect(verdict(sujet, "redistribution-modifiee")).toBe("interdit");
	});

	test("dérive les deux usages commerciaux d'un seul champ", () => {
		expect(verdict(sujet, "entreprise")).toBe("interdit");
		expect(verdict(sujet, "commercial-perso")).toBe("autorise");

		const entreprise = modele({
			latest_character_model_version: {
				vrm_meta: { ...META, commercialUsage: "corporation" },
			} as ModeleVroid["latest_character_model_version"],
		});
		expect(verdict(entreprise, "entreprise")).toBe("autorise");
		expect(verdict(entreprise, "commercial-perso")).toBe("autorise");

		const nonLucratif = modele({
			latest_character_model_version: {
				vrm_meta: { ...META, commercialUsage: "personalNonProfit" },
			} as ModeleVroid["latest_character_model_version"],
		});
		expect(verdict(nonLucratif, "entreprise")).toBe("interdit");
		expect(verdict(nonLucratif, "commercial-perso")).toBe("interdit");
	});

	test("`allowModificationRedistribution` autorise les deux conditions liées", () => {
		const ouvert = modele({
			latest_character_model_version: {
				vrm_meta: { ...META, modification: "allowModificationRedistribution" },
			} as ModeleVroid["latest_character_model_version"],
		});
		expect(verdict(ouvert, "modification")).toBe("autorise");
		expect(verdict(ouvert, "redistribution-modifiee")).toBe("autorise");
	});

	test("un champ absent reste « non renseigné »", () => {
		const vide = modele({
			latest_character_model_version: {
				vrm_meta: { avatarPermission: "everyone" },
			} as ModeleVroid["latest_character_model_version"],
		});
		expect(verdict(vide, "violence")).toBe("inconnu");
		expect(verdict(vide, "credit")).toBe("inconnu");
	});
});

describe("cas sans condition connue", () => {
	// C'est le cas réel de `/api/search/character_models`, qui ne renvoie
	// ni `license` ni `vrm_meta` (mesuré le 2026-09-02).
	const sujet = modele({});

	test("ne fabrique aucune condition", () => {
		expect(conditionsDuModele(sujet).specification).toBe("inconnue");
		expect(conditionsDuModele(sujet).conditions).toHaveLength(0);
	});

	test("le crédit est présumé requis par prudence", () => {
		expect(creditRequis(sujet)).toBe(true);
	});
});

describe("creditRequis", () => {
	test("n'est faux que si l'auteur l'a explicitement dispensé", () => {
		expect(creditRequis(modele({ license: { ...LICENCE_MESUREE, credit: "unnecessary" } }))).toBe(false);
		expect(creditRequis(modele({ license: { ...LICENCE_MESUREE, credit: "necessary" } }))).toBe(true);
		expect(creditRequis(modele({ license: { ...LICENCE_MESUREE, credit: "default" } }))).toBe(true);
	});
});

describe("estChargeable", () => {
	test("suit strictement `is_downloadable`", () => {
		expect(estChargeable(modele({ is_downloadable: true }))).toBe(true);
		expect(estChargeable(modele({ is_downloadable: false }))).toBe(false);
		expect(estChargeable(modele({}))).toBe(false);
	});
});

describe("nomModele", () => {
	test("retombe sur le nom du personnage puis sur un libellé neutre", () => {
		expect(nomModele(modele({ name: "Aphrodi" }))).toBe("Aphrodi");
		expect(
			nomModele(modele({ name: null, character: { name: "Personnage" } as ModeleVroid["character"] }))
		).toBe("Personnage");
		expect(nomModele(modele({ name: "   " }))).toBe("Modèle sans titre");
	});
});
