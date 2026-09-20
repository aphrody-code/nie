import type { NameResolver } from "../lib/resolved-names";
/** Host-neutral projection of existing VFS and gallery metadata bindings. */
export interface GalleryDirectory {
  name: string;
  count: number;
}

/**
 * Ordre demandé au serveur d'index, pas à la page déjà reçue.
 *
 * Trier localement ne trierait que les 120 lignes chargées, en annonçant un ordre sur un total
 * de 17 085 : `/api/v1/recherche` porte `tri`/`ordre` et les applique avant de paginer. Un hôte
 * qui ne sait pas trier ignore le paramètre — il rend alors son ordre naturel, jamais un ordre faux.
 */
export interface GallerySort {
  by: "name" | "size";
  order: "asc" | "desc";
}

/**
 * Un format de sortie proposé pour UN fichier, tel que l'hôte le déclare.
 *
 * Les champs reprennent un par un ceux de `/api/v1/export/formats/<chemin>` — `available` et
 * `unavailableReason` compris, parce qu'un format refusé doit se lire avec sa raison plutôt que
 * disparaître : une liste qui cache ce qu'elle ne sait pas faire se lit comme une liste complète.
 */
export interface ExportFormat {
  id: string;
  label: string;
  extension: string;
  fileName: string;
  available: boolean;
  lossless: boolean;
  raw: boolean;
  unavailableReason: string | null;
}

export interface GalleryServices {
  resolveNames?: NameResolver;
  /**
   * Formats de sortie du fichier désigné. **Optionnel** : un hôte qui n'a pas de convertisseur
   * ne l'implémente pas, et l'interface l'annonce au lieu de proposer un bouton sans effet.
   */
  exportFormats?(path: string, gameDir?: string): Promise<ExportFormat[]>;
  /** Convertit puis remet le fichier à l'utilisateur, dans le format qu'il a choisi. */
  exportAs?(path: string, format: ExportFormat, gameDir?: string): Promise<void>;
  nameSource?: string;
  ls(prefix: string, gameDir?: string): Promise<{ dirs: GalleryDirectory[] }>;
  /** List one bounded page below an exact VFS prefix. */
  findPaged(prefix: string, ext: string, limit: number, offset: number, gameDir?: string, query?: string, signal?: AbortSignal, sort?: GallerySort): Promise<{
    files: { path: string; size: number }[];
    total: number;
    offset: number;
  }>;
  /** Curated 11-bucket editorial selection. The Rust owner performs search and pagination. */
  editorialPage?(category: string | null, limit: number, offset: number, query?: string, signal?: AbortSignal): Promise<{
    files: { path: string; size: number }[];
    total: number;
    offset: number;
    categories: GalleryDirectory[];
  }>;
  gameDataGallery(gameDir?: string): Promise<{
    img_path: string;
    thumb_path: string;
    unlock_kind: string;
    story_episode: number | null;
  }[]>;
  texturePngB64(path: string, gameDir?: string): Promise<string>;
  /** Host owns the destination picker, native conversion and result notification. */
  exportPng(path: string, gameDir?: string): Promise<void>;
  formatBytes(bytes: number): string;
}
