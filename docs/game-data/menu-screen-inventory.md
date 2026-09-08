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

Two corrections against `data/menu/manifest.json`:

- `main_menu_alt.png` is **`title02` / `title_menu_2_setting.cfg.bin`**, not `main_menu`.
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
