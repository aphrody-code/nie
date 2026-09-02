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
 */

const CDN_BASE = "https://cdn.rosegriffon.fr";

/** Un cue d'une banque, résolu jusqu'à sa forme d'onde. */
export interface AudioCue {
	/** Rang du cue dans la `CueTable` de la banque. */
	index: number;
	/** Identifiant du cue (`CueTable.CueId`). */
	cueId: number;
	/** Nom du cue, ex. `ev60_00010_me`. `null` si la banque n'en donne pas. */
	name: string | null;
	/** Codec de la forme d'onde : `hca`, `adx`, `autre` ou `inconnu`. */
	codec: string;
	/** Nombre de canaux, `null` si non résolu. */
	channels: number | null;
	/** Fréquence d'échantillonnage en Hz, `null` si non résolue. */
	sampleRate: number | null;
	/** Nombre d'échantillons, `null` si non résolu. */
	numSamples: number | null;
	/** Durée en secondes. */
	durationSec: number;
	/** La forme d'onde boucle (typique des BGM). */
	looped: boolean;
	/** La forme d'onde vit dans l'AWB externe plutôt qu'en mémoire. */
	streaming: boolean;
	/** Identifiant AWB — c'est LUI qu'on passe à `?id=`, pas `index`. */
	awbId: number | null;
	/** Rang de l'entrée dans l'AWB, quand l'en-tête AFS2 embarqué permet de le résoudre. */
	awbIndex: number | null;
}

/** Catalogue complet d'une banque audio. */
export interface AudioBank {
	/** Chemin VFS de l'ACB. */
	path: string;
	/** Type de conteneur (`acb`, `hca`, `adx`). */
	container: string;
	/** Nom de la cue sheet déclaré par la banque. */
	name: string | null;
	/** Version de l'outil CRI ayant produit la banque. */
	version: number | null;
	/** Nombre de cues. */
	cueCount: number;
	/** Nombre d'entrées dans l'AWB, `null` si l'en-tête n'est pas embarqué. */
	awbEntryCount: number | null;
	/** La banque porte son AWB en interne. */
	embeddedAwb: boolean;
	/** Chemin VFS de l'AWB frère, `null` si le conteneur n'est pas un ACB. */
	externalAwb: string | null;
	/** Les cues, dans l'ordre de la `CueTable`. */
	cues: AudioCue[];
}

/**
 * URL de lecture d'un cue précis d'une banque → WAV PCM 16 bits décodé live.
 *
 * On adresse par `awbId` (cue-id AFS2) et non par rang : le rang dépend de l'ordre du fichier,
 * l'identifiant est stable. Sans `awbId`, l'URL rend le comportement historique de la route —
 * la piste la plus volumineuse de la banque.
 */
export function cpkAudioCueUrl(path: string, awbId?: number | null): string {
	const base = `${CDN_BASE}/audio/${path}`;
	return awbId == null ? base : `${base}?id=${awbId}`;
}

/** URL du catalogue d'une banque. */
export function cpkAudioInfoUrl(path: string): string {
	return `${CDN_BASE}/audio-info/${path}`;
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

/** Formate une durée en `m:ss` (ou `s,d s` sous la seconde). */
export function formatDuration(sec: number): string {
	if (!Number.isFinite(sec) || sec <= 0) return "—";
	if (sec < 1) return `${sec.toFixed(2).replace(".", ",")} s`;
	const m = Math.floor(sec / 60);
	const s = Math.round(sec % 60);
	return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${sec.toFixed(1).replace(".", ",")} s`;
}
