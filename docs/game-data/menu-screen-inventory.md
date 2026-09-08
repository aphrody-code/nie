# Menu screen inventory and OBJBIN reference audit

Measured on 2026-09-08 against the VFS mounted from `NIE_GAME_DIR=/home/ubuntu/niers`.

## Reproduce

```sh
mkdir -p var/outputs/menu-inventory
niers vfs find "data/" -n 400000 --json > var/outputs/menu-inventory/vfs-paths.json
niers vfs extract data/common/gamedata/menu/cfg --out var/outputs/menu-inventory/cfg
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
  from the PLAN.md reference table and each token resolves in the VFS.

Console and trial variants (`_nx_`, `_ps_`, `_xbox_`, `_trial_`, `_tgs*`) are excluded from
the PC pairings: the START screen resolves to `title_menu_setting.cfg.bin` /
`title_menu_0.06.41.lua.bin`, the loading screen to `loading_menu_setting.cfg.bin`.

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
