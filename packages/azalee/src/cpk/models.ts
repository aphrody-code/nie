/**
 * Le corpus 3D du jeu, en une seule carte.
 *
 * Les modèles vivaient dans deux pages qui n'en couvraient qu'une fraction : `/modeles` servait
 * les techniques, objets et animaux **filtrés par un manifeste statique** (509 codes), `/keshin`
 * les esprits et armures depuis le miroir. Le corpus réel, mesuré sur le VFS et le miroir, est
 * de 6 236 modèles.
 *
 * Ce module dit où chaque famille vit dans le VFS, quelle route l'assemble, et où sont ses
 * textures. Aucun gate statique : ce qui existe dans le jeu est listé, et la route
 * d'assemblage répond 404 pour ce qu'elle ne sait pas produire — on n'enferme pas le corpus
 * dans une liste écrite à la main.
 *
 * ⚠ Module **client-safe** : constantes et construction d'URL, rien d'autre.
 */

const CDN_BASE = "https://cdn.rosegriffon.fr";

/** Identifiant d'une famille de modèles. */
export type ModelFamily = "chara" | "waza" | "item" | "keshin" | "armd" | "animal";

/** Ce qui définit une famille : son nom, sa source, sa route d'assemblage. */
export interface ModelFamilyDef {
	/** Identifiant d'URL. */
	id: ModelFamily;
	/** Libellé humain. */
	label: string;
	/** Une phrase sur ce que la famille contient. */
	hint: string;
	/**
	 * Dossier VFS qui énumère les codes, ou `null` pour les personnages — ceux-là viennent du
	 * miroir SQLite, parce qu'eux seuls ont un nom affichable.
	 */
	vfsDir: string | null;
	/** Nombre de codes mesuré le 14 août 2026 sur le VFS complet (indicatif, pour l'aperçu). */
	count: number;
}

/**
 * Les six familles du corpus.
 *
 * `_face` et `_uniform` n'y figurent pas : ce sont des COMPOSANTS (12 482 et 5 255 fichiers)
 * que `/model-full` assemble dans un personnage, pas des modèles autonomes — vérifié, la route
 * `/model-chr/uniform/<code>` répond 404.
 */
export const MODEL_FAMILIES: ModelFamilyDef[] = [
	{
		id: "chara",
		label: "Personnages",
		hint: "corps + visage + uniforme assemblés",
		vfsDir: null,
		count: 5526,
	},
	{
		id: "waza",
		label: "Techniques",
		hint: "modèles d'effets de tir et de dribble",
		vfsDir: "data/common/chr/_waza",
		count: 272,
	},
	{ id: "item", label: "Objets", hint: "ballons, accessoires, décors", vfsDir: "data/common/chr/_item", count: 247 },
	{
		id: "keshin",
		label: "Esprits Guerriers",
		hint: "keshin invocables",
		vfsDir: "data/common/chr/_keshin",
		count: 100,
	},
	{ id: "armd", label: "Armures", hint: "armures d'esprit", vfsDir: "data/common/chr/_armd", count: 89 },
	{ id: "animal", label: "Animaux", hint: "créatures", vfsDir: "data/common/chr/_animal", count: 2 },
];

/** La définition d'une famille, ou `undefined` si l'identifiant est inconnu. */
export function modelFamily(id: string): ModelFamilyDef | undefined {
	return MODEL_FAMILIES.find((f) => f.id === id);
}

/**
 * URL du GLB assemblé d'un modèle.
 *
 * Deux routes distinctes : les personnages passent par `/model-full` (qui compose corps, visage
 * et uniforme), le reste par `/model-chr/<sous-domaine>/<code>`. Le sous-domaine s'écrit SANS le
 * tiret bas du dossier VFS — `waza`, pas `_waza` : c'est ce que la route attend, et l'écrire
 * autrement rend un 404 « sous-domaine chr non servable ».
 */
export function modelGlbUrl(famille: ModelFamily, code: string): string {
	return famille === "chara"
		? `${CDN_BASE}/model-full/${code}.glb`
		: `${CDN_BASE}/model-chr/${famille}/${code}.glb`;
}

/**
 * Dossier VFS des textures d'un modèle (`.g4tx`), ou `null` pour un personnage — dont les
 * textures sont éclatées entre visage, uniforme et corps, et n'ont pas de dossier unique.
 */
export function modelTextureDir(famille: ModelFamily, code: string): string | null {
	return famille === "chara" ? null : `data/dx11/chr/_${famille}/${code}`;
}

/** Chemin de la fiche d'un modèle. */
export function modelHref(famille: ModelFamily, code: string): string {
	return `/modeles/${famille}/${code}`;
}
