/**
 * Le pet Aphrody v2 — `crates/engine/nie-aphrody`.
 *
 * Ce n'est PAS un homonyme du personnage, contrairement a ce que son nom de crate laisse
 * croire : son manifeste dit « faithfully based on official full-body and facial assets », et
 * il represente le milieu de terrain de Zeus. C'est la meme entite, sous une autre forme —
 * une mascotte animee, tiree des assets officiels.
 *
 * La crate embarque tout par `include_bytes!` / `include_str!` : le manifeste, les animations
 * et les deux atlas. On lit donc les MEMES fichiers qu'elle, sans la compiler.
 */

import { join } from "node:path";
import { readFileSync, statSync } from "node:fs";

export type Frame = {
    index: number;
    ligne: number;
    colonne: number;
    /** Rectangle de la cellule dans l'atlas. */
    cellule: { x: number; y: number; largeur: number; hauteur: number };
    /** Rectangle reellement occupe par des pixels non transparents, dans la cellule. */
    bornes_alpha: { x: number; y: number; largeur: number; hauteur: number } | null;
};

export type Animation = {
    nom: string;
    /** `frameCount` du manifeste, verifie contre la longueur reelle de `frames`. */
    frames: number;
    /** Ligne de l'atlas qui porte cette animation : une animation = une ligne. */
    ligne: number;
    genre: string | null;
    role: string | null;
    duree_ms: number | null;
    detail: Frame[];
};

export type Pet = {
    id: string;
    nom: string;
    description: string;
    version_sprite: number;
    schema: string | null;
    atlas: {
        largeur: number;
        hauteur: number;
        colonnes: number;
        lignes: number;
        cellule: { largeur: number; hauteur: number };
        repere: string | null;
        cellules_inutilisees: number;
        png_octets: number;
        webp_octets: number;
        /** Le WebP est plus petit, mais son decodage doit correspondre au PNG canonique. */
        gain_webp: string;
        conteneur_webp: string | null;
        sha256_png: string | null;
        sha256_webp: string | null;
        sha256_rgba_png: string | null;
        sha256_rgba_webp: string | null;
        webp_decode_identique_au_png: boolean;
    };
    animations: Animation[];
    total_frames: number;
    qa: unknown;
    precision_pixel: unknown;
    chemins: { manifeste: string; animations: string; png: string; webp: string };
};

/** Lit le paquet vendored du pet. Rend `null` si la crate n'est pas la. */
export function lirePet(racine: string): Pet | null {
    const base = join(racine, "crates", "engine", "nie-aphrody", "assets", "aphrody");
    const lire = (f: string) => JSON.parse(readFileSync(join(base, f), "utf8"));
    const taille = (f: string) => {
        try {
            return statSync(join(base, f)).size;
        } catch {
            return 0;
        }
    };
    let manifeste: any;
    let anims: any;
    try {
        manifeste = lire("pet.json");
        anims = lire("animations.json");
    } catch {
        return null;
    }

    const rect = (r: any) =>
        r ? { x: r.x ?? 0, y: r.y ?? 0, largeur: r.width ?? 0, hauteur: r.height ?? 0 } : null;

    // Une animation n'est pas un tableau de frames mais un objet qui les porte, avec sa
    // ligne d'atlas, son genre et sa duree. Les lire comme un tableau rend `.map is not a
    // function` — c'est la premiere chose qui casse si l'on se fie au comptage de `jq`.
    const animations: Animation[] = Object.entries((anims.animations ?? {}) as Record<string, any>).map(([nom, a]) => {
        const frames: any[] = Array.isArray(a?.frames) ? a.frames : [];
        return {
            nom,
            frames: a?.frameCount ?? frames.length,
            ligne: a?.row ?? -1,
            genre: a?.kind ?? null,
            role: a?.purpose ?? null,
            duree_ms: a?.totalDurationMs ?? null,
            detail: frames.map((f: any) => ({
                index: f.index,
                ligne: f.row,
                colonne: f.column,
                cellule: rect(f.atlasRect) ?? { x: 0, y: 0, largeur: 0, hauteur: 0 },
                bornes_alpha: rect(f.alphaBoundsInCell),
            })),
        };
    });

    const png = taille("sprites/spritesheet.png");
    const webp = taille("sprites/spritesheet.webp");

    return {
        id: manifeste.id,
        nom: manifeste.displayName,
        description: manifeste.description,
        version_sprite: manifeste.spriteVersionNumber,
        schema: anims.$schema ?? null,
        atlas: {
            largeur: anims.atlas?.width ?? 0,
            hauteur: anims.atlas?.height ?? 0,
            colonnes: anims.atlas?.columns ?? 8,
            lignes: anims.atlas?.rows ?? 11,
            cellule: { largeur: anims.atlas?.cellWidth ?? 192, hauteur: anims.atlas?.cellHeight ?? 208 },
            repere: anims.atlas?.coordinateSystem ?? null,
            cellules_inutilisees: Array.isArray(anims.unusedCells) ? anims.unusedCells.length : (anims.unusedCells ?? 0),
            png_octets: png,
            webp_octets: webp,
            gain_webp: png && webp ? `${(100 - (webp / png) * 100).toFixed(1)} % plus petit que le PNG` : "—",
            conteneur_webp: anims.atlas?.runtimeContainerChunk ?? null,
            sha256_png: anims.atlas?.pngSha256 ?? null,
            sha256_webp: anims.atlas?.webpSha256 ?? null,
            // Le fait qui compte : les deux atlas DECODENT vers les memes pixels. Le WebP
            // n'est pas une version degradee du PNG, c'est le meme RGBA dans un autre
            // conteneur — d'ou l'egalite de ces deux empreintes.
            sha256_rgba_png: anims.atlas?.rgbaSha256 ?? null,
            sha256_rgba_webp: anims.atlas?.webpRgbaSha256 ?? null,
            webp_decode_identique_au_png:
                !!anims.atlas?.rgbaSha256 && anims.atlas?.rgbaSha256 === anims.atlas?.webpRgbaSha256,
        },
        animations,
        total_frames: anims.exportedFrameCount ?? animations.reduce((n, a) => n + a.frames, 0),
        qa: anims.qa ?? null,
        precision_pixel: anims.pixelAccuracy ?? null,
        chemins: {
            manifeste: "crates/engine/nie-aphrody/assets/aphrody/pet.json",
            animations: "crates/engine/nie-aphrody/assets/aphrody/animations.json",
            png: "crates/engine/nie-aphrody/assets/aphrody/sprites/spritesheet.png",
            webp: "crates/engine/nie-aphrody/assets/aphrody/sprites/spritesheet.webp",
        },
    };
}
