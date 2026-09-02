/**
 * Catalogue des banques audio CRI du jeu — la couche qui rend un son **jouable et nommé**.
 *
 * Un `.acb` n'est pas un son : c'est une banque de cues. `waza_stream.acb` en porte 1 512,
 * `bgm.acb` 825. Jusqu'ici seule la piste la plus volumineuse de chaque banque était atteignable,
 * ce qui rendait l'écrasante majorité du corpus sonore inaccessible.
 *
 * `/audio-info/<chemin>` (crate `nie-model-serve`) publie le catalogue d'une banque : nom, durée,
 * codec, fréquence, canaux et identifiant AWB de chaque cue. Il est bâti sur l'ACB **seul** —
 * jamais sur l'AWB, qui pèse 7,49 Gio à l'échelle du jeu contre 0,10 Gio d'ACB. Chaque cue se joue
 * ensuite par `/audio/<chemin>?id=<awbId>`.
 *
 * ⚠ Module **client-safe** : `fetch` seul. Le rattachement d'une banque à un personnage exige le
 * miroir SQLite et vit donc côté serveur.
 *
 * Les deux URL et les deux fiches (`AudioCue`, `AudioBank`) viennent de `@niers/catalog/jeu` : ce
 * que le serveur sérialise n'appartient pas à cette bibliothèque, et le décrire une deuxième fois
 * ici ferait diverger le wiki de l'explorateur sans que rien ne le signale.
 */

import { formatDureeCue, urlAudio, urlBanqueSon } from "@niers/catalog/jeu";
import type { AudioBank } from "@niers/catalog/jeu";

export type { AudioBank, AudioCue } from "@niers/catalog/jeu";

/**
 * URL de lecture d'un cue précis d'une banque → WAV PCM 16 bits décodé live.
 *
 * On adresse par `awbId` (cue-id AFS2) et non par rang : le rang dépend de l'ordre du fichier,
 * l'identifiant est stable. Sans `awbId`, l'URL rend le comportement historique de la route —
 * la piste la plus volumineuse de la banque.
 */
export function cpkAudioCueUrl(path: string, awbId?: number | null): string {
	return urlAudio(path, awbId);
}

/** URL du catalogue d'une banque. */
export function cpkAudioInfoUrl(path: string): string {
	return urlBanqueSon(path);
}

/** Récupère le catalogue d'une banque. Lève si le pont ne répond pas. */
export async function fetchAudioBank(path: string): Promise<AudioBank> {
	const res = await fetch(cpkAudioInfoUrl(path));
	if (!res.ok) throw new Error(`catalogue audio ${res.status} sur ${path}`);
	return (await res.json()) as AudioBank;
}

/** Variante tolérante : `null` au lieu d'une exception. */
export async function fetchAudioBankOrNull(path: string): Promise<AudioBank | null> {
	try {
		return await fetchAudioBank(path);
	} catch {
		return null;
	}
}

/** Famille d'une banque, déduite de son emplacement et de son nom. */
export type AudioBankKind = "voix" | "bgm" | "technique" | "effet" | "systeme" | "autre";

/**
 * Classe une banque par son chemin.
 *
 * Classification STRUCTURELLE (emplacement + préfixe de nom), jamais devinée sur le contenu :
 * les banques de voix sont les `cXXXXXXXX` sous `sound_asset/<langue>/`, le reste porte un nom
 * parlant à la racine de `sound_asset/`.
 */
export function audioBankKind(path: string): AudioBankKind {
	const nom = (path.split("/").pop() ?? "").replace(/\.acb$/i, "").toLowerCase();
	if (/^c\d{8,9}$/.test(nom)) return "voix";
	if (nom.includes("voice")) return "voix";
	if (nom.startsWith("bgm")) return "bgm";
	if (nom.startsWith("waza")) return "technique";
	if (nom.startsWith("effect") || nom.startsWith("se")) return "effet";
	if (nom.startsWith("sys") || nom.startsWith("menu")) return "systeme";
	return "autre";
}

/** Libellé humain d'une famille de banque. */
export function audioBankKindLabel(kind: AudioBankKind): string {
	const labels: Record<AudioBankKind, string> = {
		voix: "Voix",
		bgm: "Musiques",
		technique: "Techniques",
		effet: "Effets",
		systeme: "Système",
		autre: "Autres",
	};
	return labels[kind];
}

/**
 * Code personnage porté par une banque de voix (`c01000010.acb` → `c01000010`), sinon `null`.
 *
 * C'est la clé de jointure vers `inagle_characters.internal_code`, qui est de la forme
 * `<code>_<variante>` (`c01000010_5000`). La résolution du nom exige le miroir : elle vit côté
 * serveur, pas ici.
 */
export function voiceBankCharacterCode(path: string): string | null {
	const nom = (path.split("/").pop() ?? "").replace(/\.acb$/i, "");
	return /^c\d{8,9}$/i.test(nom) ? nom.toLowerCase() : null;
}

/**
 * Formate une durée de cue en `m:ss` (ou `s,d s` sous la minute).
 *
 * Le nom historique reste : c'est celui qu'importent les pages du wiki. La règle, elle, vit
 * dans `@niers/catalog/jeu` sous `formatDureeCue`, à côté de celle des films — dont elle diffère
 * volontairement (une cue de voix dure une seconde et demie, `0:02` en dirait moins).
 */
export function formatDuration(sec: number): string {
	return formatDureeCue(sec);
}
