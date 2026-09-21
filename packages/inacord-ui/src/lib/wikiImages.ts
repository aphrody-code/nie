// Images des composants du wiki, résolues **dans le VFS local** — remplace
// `la couche images du wiki` pour les composants portés dans `components/wiki/`.
//
// ## Pourquoi ne pas importer le module du wiki
//
// Deux raisons, l'une de fond, l'autre mesurée :
//
//  1. le module du wiki rendait des URL CDN : l'application de bureau doit fonctionner
//     **hors ligne**, sur les fichiers du jeu qu'elle a déjà montés. C'est toute sa raison d'être ;
//  2. The former image adapter imported generated manifests that are not part of the runtime
//     et absents du dépôt : l'importer ici casse `tsc` (`Cannot find module`) et le build Vite.
//
// ## Ce qui est résolu, et ce qui ne peut pas l'être
//
// Nommage RELEVÉ sur l'installation Steam (`niers vfs ls`, 2026-09-03), pas supposé :
//
// | Famille    | Chemin VFS                                                     | Forme         |
// |------------|----------------------------------------------------------------|---------------|
// | visages    | `…/200_icon/10_icon_chr/face/<code>_l.g4tx`                     | un par code   |
// | entraîneurs| `…/200_icon/10_icon_chr/coach/coach<NN>_l.g4tx`                 | un par numéro |
// | écussons   | `…/200_icon/01_icon_emblem/<em####>.g4tx` (+ `_s` en petit)     | un par code   |
//
// Les objets, les techniques et les tactiques n'ont **pas** d'icône par entité : ce sont des
// ATLAS (`02_icon_item/icon_item01.g4tx` — 3 Mo, plusieurs centaines d'icônes ; `13_icon_tactics/
// icon_tactics.g4tx`). Sans index de découpe, une icône par objet n'est pas résolvable — ces
// fonctions rendent donc une chaîne vide, et les cartes affichent leur repli. Inventer un chemin
// « probable » produirait des images muettes que rien ne signalerait.

/** Racine des icônes de menu (rendu DX11) — commune à toutes les familles ci-dessous. */
const ICONES = "data/dx11/menu/200_icon";

/** Chemin VFS d'un visage de personnage. `code` = code interne (`c01000010`). */
export function getCharacterFaceUrl(code: string | undefined | null): string {
  if (!code) return "";
  // Les variantes de tenue (`c01000010_5000`) n'ont pas de visage propre : seul le code de base
  // en a un — même règle que le module du wiki.
  const base = code.replace(/_\d{4}$/, "");
  return `${ICONES}/10_icon_chr/face/${base}_l.g4tx`;
}

/** Chemin VFS d'un portrait d'entraîneur (`coach01`…). */
export function getCoachFaceUrl(code: string | undefined | null): string {
  if (!code) return "";
  const n = /^\d+$/.test(code) ? code.padStart(2, "0") : code.replace(/^coach/, "");
  return `${ICONES}/10_icon_chr/coach/coach${n}_l.g4tx`;
}

/** Chemin VFS d'un écusson d'équipe. `petit` rend la variante `_s` (65 ko au lieu de 262 ko). */
export function getEmblemUrl(code: string | undefined | null, petit = false): string {
  if (!code) return "";
  return `${ICONES}/01_icon_emblem/${code}${petit ? "_s" : ""}.g4tx`;
}

/** Atlas non indexé : aucune icône par objet n'est résolvable (cf. l'en-tête). */
export function getItemIconUrl(_id?: string | null): string {
  return "";
}

/** Atlas non indexé, cf. [`getItemIconUrl`]. */
export function getSkillIconUrl(_element?: string | null): string {
  return "";
}

/** Atlas non indexé, cf. [`getItemIconUrl`]. */
export function getSkillImageUrl(_skillId?: string | null): string {
  return "";
}

/** Les icônes d'aura sont indexées par un numéro de famille (`aura_fs/k000010_l.g4tx`).
 * Résout le code d'asset (ex: wks00120) vers le chemin VFS correspondant. */
export function getAuraImageUrl(assetCode?: string | null, _subType?: string | null): string {
  if (!assetCode) return "";
  if (assetCode.startsWith("wks") || assetCode.startsWith("wad") || assetCode.startsWith("wkd")) {
    const num = assetCode.slice(3);
    return `${ICONES}/10_icon_chr/aura_fs/k${num.padStart(6, "0")}_l.g4tx`;
  }
  return "";
}

/**
 * Transforme un chemin d'image hérité du miroir en chemin VFS local,
 * ou retourne null si le chemin n'est pas résolvable (évite les 404 sur les URL relatives invalides).
 */
export function resolveAssetUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const trimmed = path.trim();
  if (!trimmed || trimmed === "\\N" || trimmed === "\\\\N") return null;

  // Normalise un préfixe hérité tel que "/menu/", "menu/" ou "#/menu/"
  const cleaned = trimmed.replace(/^(?:#\/|\/)?menu\//, "");

  // URL absolue distante (HTTP, data:, blob:)
  if (
    cleaned.startsWith("http://") ||
    cleaned.startsWith("https://") ||
    cleaned.startsWith("data:") ||
    cleaned.startsWith("blob:")
  ) {
    return cleaned;
  }

  // URL déjà absolue et servie par nie-site (/assets, /f, /static)
  if (
    cleaned.startsWith("/assets/") ||
    cleaned.startsWith("/f/") ||
    cleaned.startsWith("/static/")
  ) {
    return cleaned;
  }

  // Déjà un chemin VFS
  if (cleaned.startsWith("data/")) {
    return cleaned;
  }

  // Les chemins du miroir commençant par "200_icon/"
  if (cleaned.startsWith("200_icon/")) {
    return `data/dx11/menu/${cleaned}`
      .replace(/([a-z]\d{6}_l)(?:_\d{5}_l\d{2})?\.webp$/, "$1.g4tx")
      .replace(/\.webp$/, ".g4tx");
  }

  // Les bannières / telop commençant par "220_img/"
  if (cleaned.startsWith("220_img/")) {
    return `data/dx11/menu/${cleaned}`.replace(/\.webp$/, ".g4tx");
  }

  // Chemin relatif inconnu / non monté : retourner null pour déclencher le repli UI sans émettre de 404
  return null;
}

/** Repli des cartes — vide : l'application n'embarque pas les visuels du site. */
export const PLACEHOLDERS = {
  character: "",
  item: "",
  skill: "",
} as const;

/** `true` si `src` désigne un fichier du VFS que `ui/image.tsx` doit décoder lui-même. */
export function estCheminVfs(src: string): boolean {
  return src.startsWith("data/") && src.includes(".");
}
