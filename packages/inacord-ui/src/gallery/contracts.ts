import type { NameResolver } from "../lib/resolved-names";
/** Host-neutral projection of existing VFS and gallery metadata bindings. */
export interface GalleryDirectory {
  name: string;
  count: number;
}

export interface GalleryServices {
  resolveNames?: NameResolver;
  nameSource?: string;
  ls(prefix: string, gameDir?: string): Promise<{ dirs: GalleryDirectory[] }>;
  findPaged(query: string, ext: string, limit: number, offset: number, gameDir?: string): Promise<{
    files: { path: string; size: number }[];
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
