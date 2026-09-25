# Menu screen inventory and OBJBIN reference audit

Measured on 2026-09-08 against the VFS mounted from `NIE_GAME_DIR=/home/ubuntu/nie`.

## Reproduce

```sh
mkdir -p var/outputs/menu-inventory
nie vfs find "data/" -n 400000 --json > var/outputs/menu-inventory/vfs-paths.json
nie vfs extract data/common/gamedata/menu/cfg --out var/outputs/menu-inventory/cfg
bun --bun scripts/validation/menu-screen-inventory.ts
python3 scripts/validation/menu-objbin-reference-audit.py
```

## Capture pairing — `data/menu/screen-inventory.json`

All 38 captures in `data/menu` are paired with the VFS resources that own them: setting
`cfg.bin`, menu `cfg.bin`, `objbin`, menu Lua, scene package (`g4pkm`/`g4mg`) and movie.
Each entry carries the capture's sha256, its pixel dimensions and, for the five opening
captures, the game-client crop `x=1 y=32 w=1920 h=1080` inside the 1922×1113 Windows frame.

Four corrections against `data/menu/manifest.json`, each proven by the setting's own OBJBIN list:

- `main_menu_alt.png` is **`title02` / `title_menu_2_setting.cfg.bin`**, not `main_menu`.
- `options.png` is **`setting_menu_setting.cfg.bin`**, not `camera_option_menu`. It owns the tab
  strip (`cmn06_02_list_tab_attach`, `cmn06_20_list_tab_item`, `icon_list_tab.g4tx`), the option
  row list (`option01_01/02`) and the guide band (`option01_05`). `camera_option_menu` is the
  in-match camera panel built from `soccer06_10/11`.
- `controls.png` ("Configuration des touches") is **`keyconfig_setting_menu_setting.cfg.bin`**,
  which owns `option01_21/22/23_keyconfig_setting_list_*` and `cmn01_22_keyconfig_edit_icon`.
- The five `2026-09-08` opening captures were absent from the manifest. Their identity comes
  from the [corrected screen identity](#corrected-screen-identity) table below and each token
  resolves in the VFS.

Console and trial variants (`_nx_`, `_ps_`, `_xbox_`, `_trial_`, `_tgs*`) are excluded from
the PC pairings: the START screen resolves to `title_menu_setting.cfg.bin` /
`title_menu_0.06.41.lua.bin`, the loading screen to `loading_menu_setting.cfg.bin`.

## Corrected screen identity

User-confirmed on 2026-09-08 and first recorded in that day's root plan (commit `38e40625`,
which is not on `main`'s history); this section is now the table's only copy in the tree. The
images attached at the time were website captures with browser chrome; the original PC screens
are the files in `data/menu`.

| PC reference | Actual screen | Required source |
|---|---|---|
| `Capture d'écran 2026-09-08 124431.png` | Black loading, bottom-right football and French label | Loading regions, native font and motion |
| `Capture d'écran 2026-09-08 124446.png` | Franchise emblem on white | `data/common/movie/IE_15th.usm` |
| `Capture d'écran 2026-09-08 124451.png` | LEVEL5 symbol and wordmark | `data/common/movie/L5logo.usm` |
| `Capture d'écran 2026-09-08 124504.png` | Autosave notice and textured OK control | Current background, save symbol, localized text and button resources |
| `Capture d'écran 2026-09-08 124519.png` | START, field and two foreground characters | `title00_01_st` regions and final `title00_03_02` logo |
| `main_menu_alt.png` | Front selection menu, eight upper and three lower tiles | **`title02` and `title_menu_2_setting.cfg.bin`** |
| `options.png` | Original Options | Native settings state and layout |
| `avatar_edit_*.png` | Avatar creation steps | Native editor layout, model state and navigation |
| Remaining named PNGs | Individual game screens and filters | Pair by identity before implementation or scoring |

The front selection reference had been wrongly associated with `mainmenu01` / `main_menu`, and
the public renderer drew a `mainmenu90` background, a Switch 2 logo and four generic website
controls. Native `title02_10_my_team_banner`, `title02_11_avatar_banner`,
`title02_07_victory_counter` and `title00_07` match the actual reference. `main_menu` work stays
valid for its own screen; its gates do not establish front-menu fidelity.

The opening screenshots are 1922×1113 including Windows chrome; the game client is
`x=1,y=32,w=1920,h=1080` (the `clientCrop` of each inventory entry). The 2560×1440 main-menu
reference is normalised proportionally to 1920×1080. Never distort game content or silently
exclude a mismatch, and keep the unmasked score even when a second report masks a capture-tool
notification.

`scripts/validation/menu-screen-inventory.ts` still emits
`identity_source: "PLAN.md corrected screen identity: …"` for these entries. The label is kept
verbatim because `data/menu/screen-inventory.json` is embedded in `crates/engine/nie-wasm` with
`include_str!`, so rewording it would change the published module; read "PLAN.md" there as this
section.

## Frozen references and the visual gate

- **The 38 captures in `data/menu` are frozen byte for byte.** Each must match the `sha256` of its
  entry in `data/menu/screen-inventory.json`; do not recompress them, not even losslessly.
  Commit `8bf226b` had recompressed all 38 losslessly (0 differing pixels by
  `magick compare -metric AE`) and every hash stopped matching; the original blobs were restored
  from `fcdc0ea` on 2026-09-23 (`b1bf9e40`). Re-measured 2026-09-25: 38 of 38 hashes match.
- **The gate is `just ecrans`**: it starts a local `nie-site` on `127.0.0.1:18099` and runs
  `scripts/validation/gate-screens.ts`, which scores every composed screen against its capture
  (grayscale SSIM at 1280×720) and fails on a drop below the floors in
  `data/menu/screen-ssim-baseline.json` (tolerance 0.02). SSIM there is a regression floor, not a
  conformity score.
- **It needs ImageMagick** (`magick`) on the host: `gate-screens.ts` decodes both PNGs through it.
- `crates/engine/nie-render3d/tests/fixtures/menu-oracles.json`, cited by the 2026-09-13
  `just ecrans` measurement in the archived plan, no longer exists; `screen-ssim-baseline.json`
  replaced it.

## OBJBIN references — `var/outputs/menu-inventory/objbin-reference-audit.json`

| Measure | Value |
|---|---:|
| `*_setting.cfg.bin` with OBJBIN references | 475 |
| Settings where **every** referenced OBJBIN is absent | 89 |
| Settings where some are absent | 2 |
| Distinct referenced OBJBIN names absent from the whole VFS | 427 |
| OBJBIN files shipped under `menu/obj/` | 3373 |
| Shipped OBJBIN files no `cfg.bin` references at all | 1549 |

None of the 427 absent names exists anywhere else in the VFS under any directory or version
suffix — they are not moved, they do not ship.

`title_auto_save_info_menu_setting.cfg.bin` is one of the 89. Its five layers point at
`cmn05_01_common`, `settings01_00_bg_title_menu`, `title00_04_auto_save_info_menu`,
`topmenu01_06_title_menu` and `win04_01_general_win_title_menu`, all absent. Rendering that
setting yields zero objects — a stale recipe, not a screen without objects. The autosave
capture must therefore be composed from objects the Lua layer creates at runtime over the
OBJBIN files that do ship, not by replaying this setting's layer list.

Because the pattern covers 89 settings and 1549 unreferenced shipped objects, "the setting
exports zero objects" is a corpus-wide property of this build, not a per-screen defect. Any
screen reconstruction that reads only `*_setting.cfg.bin` layers will silently render nothing
for those 89 screens.

## Stale recipes among the paired captures

`screen-inventory.json` carries `setting_recipes` per capture, so a screen whose setting cannot
render is visible before implementation starts:

| Capture | Stale setting |
|---|---|
| `Capture d'écran 2026-09-08 124431.png` | `loading_menu_setting.cfg.bin` |
| `Capture d'écran 2026-09-08 124504.png` | `title_auto_save_info_menu_setting.cfg.bin` |
| `main_menu.png` | `main_menu_bg_setting.cfg.bin` |
| `pause_controls.png` | `pause_menu_setting.cfg.bin` |
| `story_mode.png` | `chapter_menu_setting.cfg.bin` |
| `bank_character_detail.png`, `character_detail_hamano.png` | `chara_status_menu_setting.cfg.bin` |
| `trophy_gallery.png` | 7 `medal_*` / `equip_medalset` settings |

`options.png`, `controls.png` and `main_menu_alt.png` reference only OBJBIN files that ship, so
those three screens can be rebuilt from their setting layers directly.

## RE anchors

Knowledge base (`var/nie.sqlite`) tables:
- `hash_name` — CRC32 and string hashes for screen names, objbins and layers
- `function` — menu setup and screen lifecycle functions in `nie.exe`
- `coverage` — menu screen coverage stats
- `rtti_class` — `lives::CMenuAnimation`, `lives::CMenuRenderComponent`
- `pdata_func` — function entrypoints for menu handlers

Key binary reference addresses:
- `0x1405410d0` — Menu list view update
- `0x140567cc0` — Menu layout coordinate transform
