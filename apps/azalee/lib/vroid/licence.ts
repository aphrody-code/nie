/**
 * Conditions d'utilisation d'un modèle VRoid Hub, traduites pour l'affichage.
 *
 * pixiv impose un format d'affichage précis : un bloc intitulé « Model Data
 * Conditions of Use » listant chaque autorisation, avec des libellés et des
 * valeurs imposés par condition, et des sources de données qui diffèrent selon
 * que le modèle est en VRM 1.0 (`latest_character_model_version.vrm_meta.*`)
 * ou en VRM 0.0 (`license.*`).
 * Source : https://developer.vroid.com/en/guidelines/conditions_of_use.html
 *
 * Ce module rend ces conditions **telles que déclarées par l'auteur**, sans
 * jamais en inventer : une donnée absente s'affiche « Non renseigné », pas
 * « Autorisé ».
 *
 * Module **client-safe** (aucun import serveur) : la galerie et la fiche
 * l'importent depuis des composants `"use client"`.
 */
import type { LicenceVrm0, MetaVrm1, ModeleVroid } from "./types";

/** Verdict affiché pour une condition. */
export type Verdict = "autorise" | "interdit" | "non-lucratif" | "requis" | "non-requis" | "inconnu";

/** Une ligne du bloc de conditions d'utilisation. */
export interface ConditionUtilisation {
	/** Clé stable, utilisable comme `key` React. */
	cle: string;
	/** Libellé français de la condition. */
	libelle: string;
	verdict: Verdict;
}

/** Bloc complet de conditions, avec la version de spécification employée. */
export interface ConditionsModele {
	/** `"vrm1"` si les métadonnées VRM 1.0 sont présentes, `"vrm0"` sinon. */
	specification: "vrm1" | "vrm0" | "inconnue";
	conditions: ConditionUtilisation[];
}

/** Titre imposé par les guidelines pixiv, en français. */
export const TITRE_CONDITIONS = "Conditions d'utilisation des données du modèle";

/** Texte affiché pour chaque verdict. */
export const TEXTE_VERDICT: Record<Verdict, string> = {
	autorise: "Autorisé",
	interdit: "Non autorisé",
	"non-lucratif": "Activités à but non lucratif uniquement",
	requis: "Requise",
	"non-requis": "Non requise",
	inconnu: "Non renseigné",
};

/** Traduit un booléen VRM 1.0, `undefined` valant « non renseigné ». */
function depuisBooleen(valeur: boolean | undefined): Verdict {
	if (valeur === undefined) return "inconnu";
	return valeur ? "autorise" : "interdit";
}

/** Traduit un triplet VRM 0.0 `default | allow | disallow`. */
function depuisTriplet(valeur: "default" | "allow" | "disallow" | undefined): Verdict {
	if (valeur === "allow") return "autorise";
	if (valeur === "disallow") return "interdit";
	return "inconnu";
}

/**
 * Conditions d'un modèle **VRM 1.0**, lues dans `vrm_meta`.
 *
 * Correspondance des valeurs reprise des guidelines : `avatarPermission`
 * n'autorise qu'avec `"everyone"` ; `commercialUsage` distingue l'usage par
 * une entreprise (`"corporation"`) de l'usage commercial personnel
 * (`"personalProfit"`), `"personalNonProfit"` interdisant les deux.
 */
function conditionsVrm1(meta: MetaVrm1): ConditionUtilisation[] {
	const commercial = meta.commercialUsage;
	const modification = meta.modification;

	return [
		{
			cle: "avatar",
			libelle: "Utilisation en avatar",
			verdict:
				meta.avatarPermission === undefined
					? "inconnu"
					: meta.avatarPermission === "everyone"
						? "autorise"
						: "interdit",
		},
		{
			cle: "violence",
			libelle: "Représentations violentes",
			verdict: depuisBooleen(meta.allowExcessivelyViolentUsage),
		},
		{
			cle: "sexuel",
			libelle: "Représentations sexuelles",
			verdict: depuisBooleen(meta.allowExcessivelySexualUsage),
		},
		{
			cle: "politique",
			libelle: "Représentations politiques ou religieuses",
			verdict: depuisBooleen(meta.allowPoliticalOrReligiousUsage),
		},
		{
			cle: "haine",
			libelle: "Représentations antisociales ou haineuses",
			verdict: depuisBooleen(meta.allowAntisocialOrHateUsage),
		},
		{
			cle: "entreprise",
			libelle: "Usage par une entreprise",
			verdict: commercial === undefined ? "inconnu" : commercial === "corporation" ? "autorise" : "interdit",
		},
		{
			cle: "commercial-perso",
			libelle: "Usage commercial personnel",
			verdict:
				commercial === undefined
					? "inconnu"
					: commercial === "personalProfit" || commercial === "corporation"
						? "autorise"
						: "interdit",
		},
		{
			cle: "redistribution",
			libelle: "Redistribution",
			verdict: depuisBooleen(meta.allowRedistribution),
		},
		{
			cle: "modification",
			libelle: "Modifications",
			verdict:
				modification === undefined
					? "inconnu"
					: modification === "prohibited"
						? "interdit"
						: "autorise",
		},
		{
			cle: "redistribution-modifiee",
			libelle: "Redistribution du modèle modifié",
			verdict:
				modification === undefined
					? "inconnu"
					: modification === "allowModificationRedistribution"
						? "autorise"
						: "interdit",
		},
		{
			cle: "credit",
			libelle: "Mention de l'auteur",
			verdict:
				meta.creditNotation === undefined
					? "inconnu"
					: meta.creditNotation === "required"
						? "requis"
						: "non-requis",
		},
	];
}

/** Conditions d'un modèle **VRM 0.0**, lues dans `license`. */
function conditionsVrm0(licence: LicenceVrm0): ConditionUtilisation[] {
	return [
		{
			cle: "avatar",
			libelle: "Utilisation en avatar",
			verdict:
				licence.characterization_allowed_user === "everyone"
					? "autorise"
					: licence.characterization_allowed_user === "author"
						? "interdit"
						: "inconnu",
		},
		{
			cle: "violence",
			libelle: "Représentations violentes",
			verdict: depuisTriplet(licence.violent_expression),
		},
		{
			cle: "sexuel",
			libelle: "Représentations sexuelles",
			verdict: depuisTriplet(licence.sexual_expression),
		},
		{
			cle: "entreprise",
			libelle: "Usage par une entreprise",
			verdict: depuisTriplet(licence.corporate_commercial_use),
		},
		{
			cle: "commercial-perso",
			libelle: "Usage commercial personnel",
			verdict:
				licence.personal_commercial_use === "profit"
					? "autorise"
					: licence.personal_commercial_use === "nonprofit"
						? "non-lucratif"
						: licence.personal_commercial_use === "disallow"
							? "interdit"
							: "inconnu",
		},
		{
			cle: "redistribution",
			libelle: "Redistribution",
			verdict: depuisTriplet(licence.redistribution),
		},
		{
			cle: "modification",
			libelle: "Modifications",
			verdict: depuisTriplet(licence.modification),
		},
		{
			cle: "credit",
			libelle: "Mention de l'auteur",
			verdict:
				licence.credit === "necessary"
					? "requis"
					: licence.credit === "unnecessary"
						? "non-requis"
						: "inconnu",
		},
	];
}

/**
 * Construit le bloc de conditions d'utilisation d'un modèle.
 *
 * VRM 1.0 prime : si `latest_character_model_version.vrm_meta` est présent, on
 * lit ces métadonnées ; sinon on retombe sur `license` (VRM 0.0). Sans ni l'un
 * ni l'autre — cas réel de `/api/search/character_models`, qui ne renvoie pas
 * `license` (mesuré le 2026-09-02) — la liste est vide et l'appelant doit
 * charger la fiche détaillée avant d'afficher quoi que ce soit.
 */
export function conditionsDuModele(modele: ModeleVroid): ConditionsModele {
	const meta = modele.latest_character_model_version?.vrm_meta;
	if (meta && Object.keys(meta).length > 0) {
		return { specification: "vrm1", conditions: conditionsVrm1(meta) };
	}
	if (modele.license) {
		return { specification: "vrm0", conditions: conditionsVrm0(modele.license) };
	}
	return { specification: "inconnue", conditions: [] };
}

/**
 * Le modèle exige-t-il que l'auteur soit crédité à l'affichage ?
 *
 * Par prudence, `true` dès que la mention est requise **ou** que la condition
 * n'est pas renseignée : créditer un auteur qui ne l'exigeait pas ne coûte rien,
 * l'inverse est une violation de licence.
 */
export function creditRequis(modele: ModeleVroid): boolean {
	const { conditions } = conditionsDuModele(modele);
	const credit = conditions.find((condition) => condition.cle === "credit");
	return credit?.verdict !== "non-requis";
}

/**
 * Le `.vrm` est-il chargeable par cette application ?
 *
 * Azalée est une application **non approuvée** au sens de VRoid Hub : elle ne
 * peut charger que les modèles déposés par l'internaute lui-même et ceux dont
 * l'auteur a autorisé le téléchargement.
 * Source : https://developer.vroid.com/en/api/recognize.html
 */
export function estChargeable(modele: ModeleVroid): boolean {
	return modele.is_downloadable === true;
}

/** Nom affichable d'un modèle — l'API laisse `name` à `null` très souvent. */
export function nomModele(modele: ModeleVroid): string {
	return modele.name?.trim() || modele.character?.name?.trim() || "Modèle sans titre";
}
