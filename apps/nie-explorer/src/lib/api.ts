// Façade typée au-dessus des commandes Tauri (`invoke`) — miroir 1:1 de
// `src-tauri/src/lib.rs`. Toute la logique de décodage vient de `nie-formats`/`nie-explore`
// (même moteur que `niers vfs cat` en CLI) ; ce module ne fait que sérialiser les appels IPC.
import { invoke } from "@tauri-apps/api/core";

export interface VfsEntry {
  path: string;
  name: string;
  size: number;
  cpk: string;
}

export interface FolderRole {
  role: string;
  status: string;
}

export interface LsResult {
  dirs: string[];
  files: VfsEntry[];
  role: FolderRole | null;
}

export interface VfsStats {
  total: number;
  cpk_count: number;
  extra_count: number;
  loose_count: number;
  top_ext: [string, number][];
}

const gd = (gameDir?: string) => (gameDir && gameDir.trim() ? gameDir : undefined);

export const api = {
  defaultGameDir: () => invoke<string>("default_game_dir"),
  checkGameDir: (game_dir: string) => invoke<boolean>("check_game_dir", { game_dir }),

  ls: (prefix: string, gameDir?: string) => invoke<LsResult>("vfs_ls", { prefix, gameDir: gd(gameDir) }),
  find: (query: string, ext: string | undefined, limit: number, gameDir?: string) =>
    invoke<VfsEntry[]>("vfs_find", { query, ext: ext || undefined, limit, gameDir: gd(gameDir) }),
  stats: (gameDir?: string) => invoke<VfsStats>("vfs_stats", { gameDir: gd(gameDir) }),
  describe: (path: string, gameDir?: string) => invoke<string[]>("vfs_describe", { path, gameDir: gd(gameDir) }),
  readB64: (path: string, gameDir?: string, maxBytes?: number) =>
    invoke<string>("vfs_read_b64", { path, gameDir: gd(gameDir), maxBytes }),
  texturePngB64: (path: string, gameDir?: string) => invoke<string>("vfs_texture_png_b64", { path, gameDir: gd(gameDir) }),
  extractTo: (path: string, dest: string, gameDir?: string) =>
    invoke<number>("vfs_extract_to", { path, dest, gameDir: gd(gameDir) }),
  saveBytesB64: (dest: string, dataB64: string) => invoke<number>("save_bytes_b64", { dest, dataB64 }),
  related: (needle: string, limit: number, gameDir?: string) =>
    invoke<VfsEntry[]>("vfs_related", { needle, limit, gameDir: gd(gameDir) }),
  // Scan complet du VFS (~255 800 entrées) — pour `vfsIndexDb.reindex`, pas d'usage direct UI.
  allEntries: (gameDir?: string) => invoke<VfsEntry[]>("vfs_all_entries", { gameDir: gd(gameDir) }),

  takePendingOpen: () => invoke<string | null>("take_pending_open"),
  describeDiskFile: (path: string) => invoke<string[]>("describe_disk_file", { path }),
  readDiskFileB64: (path: string, maxBytes?: number) => invoke<string>("read_disk_file_b64", { path, maxBytes }),

  openInBlender: (path: string, blenderExe?: string, gameDir?: string) =>
    invoke<string>("open_in_blender", { path, blenderExe: blenderExe || undefined, gameDir: gd(gameDir) }),

  // Résolveur distant azalee — contrat RÉEL confirmé (`https://azalee.rosegriffon.fr`,
  // GraphQL `graphql-yoga` sans auth + REST `/api/cpk`/`/api/save/resolve-roster`), pas une
  // convention devinée. `baseUrl` vide → azalee.rosegriffon.fr (défaut côté Rust).
  remoteSearchChara: (baseUrl: string, query: string) => invoke<RemoteCharaData>("remote_search_chara", { baseUrl, query }),
  remoteSearchWaza: (baseUrl: string, query: string) => invoke<RemoteWazaData>("remote_search_waza", { baseUrl, query }),
  remoteCpkSearch: (baseUrl: string, query: string) =>
    invoke<{ query: string; count: number; files: RemoteCpkFile[] }>("remote_cpk_search", { baseUrl, query }),
  remoteResolveRoster: (baseUrl: string, ids: number[]) =>
    invoke<{ resolved: RemoteRosterEntry[]; matched: number; total: number }>("remote_resolve_roster", { baseUrl, ids }),

  videoPreviewB64: (path: string, gameDir?: string) => invoke<string>("vfs_video_preview_b64", { path, gameDir: gd(gameDir) }),
  audioPreviewB64: (path: string, gameDir?: string) => invoke<string>("vfs_audio_preview_b64", { path, gameDir: gd(gameDir) }),
  glbPreviewPngB64: (path: string, gameDir?: string) => invoke<string>("vfs_glb_preview_png_b64", { path, gameDir: gd(gameDir) }),

  saveOpen: (path: string) => invoke<SaveSummary>("save_open", { path }),
  saveListBlobs: () => invoke<SaveBlobInfo[]>("save_list_blobs"),
  saveBlobHexB64: (index: number) => invoke<string>("save_blob_hex_b64", { index }),
  saveExport: (dest: string) => invoke<number>("save_export", { dest }),
};

export interface SaveBlobInfo {
  filename: string;
  subtype: string;
  size: number;
}

// ─── Types du GraphQL/REST azalee (contrat réel, cf. commentaire Rust `remote_search_*`) ──

interface LocalizedString {
  fr: string | null;
  en: string | null;
  ja: string | null;
}

export interface RemoteCharaVariant {
  charaParamId: string;
  position: string | null;
  element: string | null;
  rarity: string | null;
  image: string | null;
}

export interface RemoteChara {
  id: string;
  internalCode: string | null;
  name: LocalizedString;
  variants: RemoteCharaVariant[];
}

export interface RemoteCharaData {
  characters: RemoteChara[];
}

export interface RemoteWaza {
  id: string;
  name: LocalizedString;
  category: string | null;
  element: string | null;
  power: string | null;
  tension: number | null;
  image: string | null;
}

export interface RemoteWazaData {
  skills: RemoteWaza[];
}

export interface RemoteCpkFile {
  name: string;
  ext: string;
  cpk: string;
  path: string;
}

export interface RemoteRosterEntry {
  id: string;
  name: string | null;
  baseSlug: string | null;
  element: string | null;
  position: string | null;
  rarity: string | null;
}

// Miroir partiel de `nie_save::SaveSummary` (champs affichés par `SaveView`) — le reste du
// JSON (roster/team complets) est accessible tel quel si besoin, non typé ici.
export interface SaveSummary {
  slot_name: string;
  player_name: string;
  level_str: string;
  playtime_secs: number | null;
  unique_id: string;
  used_slots: number | null;
  max_slots: number | null;
  roster: { owned: { id: number; name: string | null }[]; total_slots?: number };
  [key: string]: unknown;
}
