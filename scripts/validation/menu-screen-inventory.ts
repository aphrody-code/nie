#!/usr/bin/env bun
/**
 * Builds `data/menu/screen-inventory.json`: every capture in `data/menu` paired with the
 * VFS resources that own it (setting cfg.bin, menu Lua, menu objbin, scene package, movie).
 *
 * Pairings are literal path resolutions against the mounted VFS dump - never interpretation.
 * A capture whose tokens resolve nothing is reported as `missing`, not silently dropped.
 *
 * Refresh the dump with:
 *   niers vfs find "data/" -n 400000 --json > var/outputs/menu-inventory/vfs-paths.json
 */
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";

const REPO = new URL("../../", import.meta.url).pathname;
const MENU_DIR = `${REPO}data/menu`;
const VFS_DUMP = `${REPO}var/outputs/menu-inventory/vfs-paths.json`;
const OUT = `${MENU_DIR}/screen-inventory.json`;

const CFG_DIR = "data/common/gamedata/menu/cfg/";
const OBJ_DIR = "data/common/gamedata/menu/obj/";
const LUA_DIR = "data/common/script/lua/menu/";
const SCENE_DIR = "data/common/menu/";

type VfsEntry = { path: string; size: number; cpk: string };

/** Screen identity per capture. `screen` names the native screen; `tokens` are the VFS
 *  path substrings that own it. Sources are recorded so a pairing can be re-argued. */
type Identity = {
  screen: string;
  tokens: string[];
  movies?: string[];
  source: string;
  clientCrop?: { x: number; y: number; w: number; h: number };
};

/** PLAN.md "Corrected screen identity" table - user-confirmed PC references. */
const OPENING_CROP = { x: 1, y: 32, w: 1920, h: 1080 };
const IDENTITIES: Record<string, Identity> = {
  "Capture d'écran 2026-09-08 124431.png": {
    screen: "loading01",
    // The PC loading screen is the non-trial `loading_menu_setting`; trial/TGS variants are excluded.
    tokens: ["loading01", "loading_menu_setting"],
    source: "PLAN.md corrected screen identity: black loading, football and French label",
    clientCrop: OPENING_CROP,
  },
  "Capture d'écran 2026-09-08 124446.png": {
    screen: "movie_ie_15th",
    tokens: [],
    movies: ["data/common/movie/IE_15th.usm"],
    source: "PLAN.md corrected screen identity: franchise emblem movie",
    clientCrop: OPENING_CROP,
  },
  "Capture d'écran 2026-09-08 124451.png": {
    screen: "movie_l5logo",
    tokens: [],
    movies: ["data/common/movie/L5logo.usm"],
    source: "PLAN.md corrected screen identity: LEVEL5 symbol and wordmark movie",
    clientCrop: OPENING_CROP,
  },
  "Capture d'écran 2026-09-08 124504.png": {
    screen: "title_auto_save_info_menu",
    tokens: ["title_auto_save_info"],
    source: "PLAN.md corrected screen identity: autosave notice and textured OK control",
    clientCrop: OPENING_CROP,
  },
  "Capture d'écran 2026-09-08 124519.png": {
    screen: "title00",
    // `title_menu_setting` / `title_menu_0.` are the PC entries; nx/ps/xbox/trial variants are excluded.
    tokens: ["title00_01_st", "title00_03_02", "title00_", "title_menu_setting", "title_menu_0."],
    source: "PLAN.md corrected screen identity: START, field and two foreground characters",
    clientCrop: OPENING_CROP,
  },
  // PLAN.md: the front selection reference is title02, NOT mainmenu01/main_menu.
  "main_menu_alt.png": {
    screen: "title_menu_2",
    tokens: ["title_menu_2", "title02", "title00_07"],
    source: "PLAN.md corrected screen identity: front selection menu, title02 + title_menu_2_setting",
  },
};

/** Manifest canonical screens that are not literal VFS tokens get an explicit token set. */
const TOKEN_OVERRIDES: Record<string, string[]> = {
  gallery_menu: ["gallery_menu", "medal"],
  pause_menu: ["pause_menu", "virtual_pad"],
  story_mode_top_menu: ["story_mode", "chapter_menu"],
  kizuna_town_avatar_menu: ["kizuna_town_avatar", "chara_edit"],
  players_universe_menu: ["players_universe", "player_universe"],
  camera_option_menu_shortcut: ["camera_option_menu_shortcut"],
};

/** Sub-screens whose own setting file is narrower than the family root. */
const SUBSCREEN_TOKENS: Record<string, string[]> = {
  filter_elements: ["chara_bank_filter_menu", "chara_filter_menu"],
  filter_position: ["chara_bank_filter_menu", "chara_filter_menu"],
  filter_rarity: ["chara_bank_filter_menu", "chara_filter_menu"],
  filter_appearance: ["chara_bank_filter_menu", "chara_filter_menu"],
  filter_foot: ["chara_bank_filter_menu", "chara_filter_menu"],
  filter_bonus: ["chara_bank_filter_menu", "chara_filter_menu"],
  filter_team_role: ["chara_bank_filter_menu", "chara_filter_menu"],
  filter_team: ["chara_bank_filter_menu", "chara_filter_menu"],
  character_detail: ["chara_status_menu", "chara_model_menu"],
  character_roster: ["chara_bank_menu"],
  formation_preset_selector: ["menu_preset_config", "soccer_formation"],
  chronicle_map: ["chronicle_mode_top_menu"],
  chronicle_shop: ["shop_menu"],
  avatar_edit_root: ["chara_edit_menu", "chara_edit_list_menu"],
  chara_edit_style: ["chara_edit_parts_menu", "chara_edit_model_menu"],
  chara_edit_hair: ["chara_edit_parts_menu_hair", "chara_edit_color_menu_13x5_hair"],
  chara_edit_clothes: ["chara_edit_recipe_menu", "chara_uniform"],
  chara_edit_stats: ["chara_edit_parts_menu_status"],
  chara_edit_name: ["chara_edit_menu", "name_entry"],
  controller_settings: ["camera_option_menu_shortcut", "virtual_pad"],
};

function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

const vfs: VfsEntry[] = JSON.parse(await Bun.file(VFS_DUMP).text());
const manifest = JSON.parse(await Bun.file(`${MENU_DIR}/manifest.json`).text());
const byFile = new Map<string, any>(manifest.entries.map((e: any) => [e.file, e]));

const pick = (dir: string, tokens: string[], exts?: string[]) =>
  vfs
    .filter(
      (e) =>
        e.path.startsWith(dir) &&
        tokens.some((t) => e.path.slice(dir.length).includes(t)) &&
        (!exts || exts.some((x) => e.path.endsWith(x))),
    )
    .map((e) => ({ path: e.path, size: e.size, cpk: e.cpk }));

const captures = readdirSync(MENU_DIR)
  .filter((f) => f.toLowerCase().endsWith(".png"))
  .sort();

const entries = [];
for (const file of captures) {
  const bytes = new Uint8Array(await Bun.file(`${MENU_DIR}/${file}`).arrayBuffer());
  const { width, height } = pngSize(bytes);
  const manifestEntry = byFile.get(file);
  const identity = IDENTITIES[file];

  let screen: string;
  let tokens: string[];
  let source: string;
  if (identity) {
    ({ screen, source } = identity);
    tokens = identity.tokens;
  } else if (manifestEntry) {
    screen = manifestEntry.canonical_screen;
    const sub = manifestEntry.visual_subscreen;
    tokens = [
      ...(TOKEN_OVERRIDES[screen] ?? [screen]),
      ...((sub && SUBSCREEN_TOKENS[sub]) ?? []),
    ];
    source = `data/menu/manifest.json (${manifestEntry.confidence})`;
  } else {
    screen = "";
    tokens = [];
    source = "unpaired: absent from manifest and from the corrected identity table";
  }

  const movies = (identity?.movies ?? []).flatMap((p) => {
    const hit = vfs.find((e) => e.path === p);
    return hit ? [{ path: hit.path, size: hit.size, cpk: hit.cpk }] : [];
  });
  const resources = {
    setting_cfg: tokens.length ? pick(CFG_DIR, tokens, ["_setting.cfg.bin"]) : [],
    menu_cfg: tokens.length ? pick(CFG_DIR, tokens) : [],
    objbin: tokens.length ? pick(OBJ_DIR, tokens) : [],
    lua: tokens.length ? pick(LUA_DIR, tokens) : [],
    scene: tokens.length ? pick(SCENE_DIR, tokens, [".g4pkm", ".g4mg"]) : [],
    movie: movies,
  };
  const total = Object.values(resources).reduce((n, r) => n + r.length, 0);
  const status =
    total === 0 ? "missing" : resources.setting_cfg.length || movies.length ? "resolved" : "partial";

  entries.push({
    file,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    width,
    height,
    client_crop: identity?.clientCrop ?? null,
    screen,
    visual_subscreen: manifestEntry?.visual_subscreen ?? null,
    identity_source: source,
    screen_tokens: tokens,
    pairing_status: status,
    resource_counts: Object.fromEntries(
      Object.entries(resources).map(([k, v]) => [k, v.length]),
    ),
    resources,
  });
}

const summary = {
  schema_version: 1,
  generated_by: "scripts/validation/menu-screen-inventory.ts",
  vfs_dump: "var/outputs/menu-inventory/vfs-paths.json",
  vfs_entries: vfs.length,
  capture_count: entries.length,
  pairing_status_counts: entries.reduce<Record<string, number>>((acc, e) => {
    acc[e.pairing_status] = (acc[e.pairing_status] ?? 0) + 1;
    return acc;
  }, {}),
  corrections: [
    "main_menu_alt.png is title02 / title_menu_2_setting.cfg.bin, not main_menu (PLAN.md).",
    "The five 2026-09-08 opening captures are absent from manifest.json; their identity comes from the PLAN.md table.",
  ],
  entries,
};
await Bun.write(OUT, `${JSON.stringify(summary, null, 2)}\n`);

for (const e of entries) {
  console.log(
    `${e.pairing_status.padEnd(8)} ${e.file.padEnd(42)} ${e.screen || "(unpaired)"} ` +
      `cfg=${e.resource_counts.setting_cfg} obj=${e.resource_counts.objbin} ` +
      `lua=${e.resource_counts.lua} scene=${e.resource_counts.scene} movie=${e.resource_counts.movie}`,
  );
}
console.log(JSON.stringify(summary.pairing_status_counts));
