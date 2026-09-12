# Game screens plan — every page becomes a real screen of nie.exe

Decided by the user on 2026-09-12. Every Azalée wiki page and every Inacord view that shows game
data must be reached from the **main menu** and drawn with the **game's own screens** (layouts,
sprites, Lua runtime), fed by a single **completed profile**: level 99, 100 % achievements,
story / chronicle / extended story finished, shop fully stocked, player bank and constellations
complete. Nothing is invented: a screen shows what `data/menu/*_setting.cfg.bin`, the Lua
scripts and the game data say, and the profile is derived from the game's own tables.

## What already exists (do not rebuild)

| Layer | Owner | Surface |
|---|---|---|
| Screen catalogue (475) | `nie-site` | `GET /api/v1/menu/screens[/{stem}]` |
| Static layout + resolved sprites | `nie-site` | `GET /api/v1/menu/layout/{screen}` (`canvas 1280×720`) |
| Lua runtime scene (layers, objects, callbacks) | `nie-lua::menu_host` via `nie-site` | `GET/POST /api/v1/menu/runtime/{screen}` (`events`, `itemCounts`, `observedNative`) |
| Compiled presentation (title, options row, avatar) | `nie-wasm` | `menu_presentation_json(id)` |
| Game data, one call per family (26) | `nie-app::game_data` via `nie-site` | `GET /api/v1/game-data/{family}`, `POST …/calculate_stats` |
| Wiki tables | `nie-site` | `/api/v1/wiki/*`, `/api/v1/entites/{table}` |
| Renderers | `@niers/inacord-ui` | `LayoutRender`, `GameCanvas`, `NativeSceneLayers`, `NativeSprite`, `NativeText` |
| Main menu bindings | `apps/nie-web/src/pages/MainMenu.tsx` | `title_menu_2` runtime, `bindMenuActions` |
| Captures (33, 2560×1440) + manifest | `data/menu/` | `manifest.json` → `canonical_screen` per capture |

## The completed profile

`GET /api/v1/profile/complete` (nie-site, pure function of the VFS, cached) — the save-like state
every screen reads. Derived, never typed by hand:

- `charas`: every entry of `game_data/charas` owned, level 99, stats from `calculate_stats` at 99,
  every skill of the character learnt, every ability-board node lit.
- `trophies`: every `game_data/trophies` entry unlocked (100 %).
- `shops`: every `game_data/shops` item in stock, purchasable.
- `story`, `chronicle`, `extend`: every chapter / episode / map node cleared.
- `formations`, `uniforms`, `emblems`, `special_tactics`, `gallery`, `movies`, `musics`: all
  unlocked.
- `constellations` (players universe): every node of every constellation filled.

The profile is what `observedNative` / `itemCounts` of the runtime route are built from, so the
Lua scripts see a finished game.

## Screen map — Azalée / Inacord page → game screen

| Page today | Game screen (`canonical_screen`) | Capture | Data | Route | Status |
|---|---|---|---|---|---|
| `/chara`, Inacord roster | `chara_bank_menu` (bank, detail, filters) | `player_roster`, `bank_character_detail`, `filters_*` | charas, skills, calculate_stats | `/bank` | in progress |
| `/skill` | `chara_bank_menu` › character detail › skills | `character_detail_hamano` | skills | `/bank/{id}` | after bank |
| `/succes`, `/gallery` | `gallery_menu` | `trophy_gallery` | trophies, gallery, movies, musics | `/gallery` | next |
| `/boutique` | `shop_menu` | `shop`, `chronicle_shop` | shops, items | `/shop` | next |
| `/mode` (story) | `story_mode_top_menu` | `story_mode` | quests, activities | `/story` | planned |
| `/mode` (chronicle) | `chronicle_mode_top_menu` | `chronicle_mode`, `chronicle_map` | quests, stadiums, opponent_teams | `/chronicle` | planned |
| `/niveau`, `/tactic`, `/equipe` | `soccer_formation_menu` | `formation_select`, `formation_presets` | formations, special_tactics, uniforms, emblems | `/formation` | planned |
| `/keshin`, constellations | `players_universe_menu` | `player_universe` | belong_teams, charas | `/universe` | planned |
| `/passive`, skill tree | `ability_learning_board_menu` | `player_skill_tree` | passives, exp_table | `/board` | planned |
| `/avatar`, `/vroid` | `kizuna_town_avatar_menu` | `avatar_edit_*` | chara_edit | `/avatar` | **done** |
| `/settings` | `camera_option_menu` | `options`, `controls` | — | `/settings` | **done** |
| `/item`, `/drops`, `/capsule`, `/invocation` | `shop_menu` › item detail, `gallery_menu` | `shop` | items, drops, capsule_rates | `/shop/items` | planned |
| `/stade`, `/entraineur`, `/aura`, `/quete` | wiki tables inside the matching screen (stadium in chronicle map, coach in formation, aura in bank detail, quests in story) | — | stadiums, coaches, auras, quests | — | planned |
| `/textures`, `/modeles`, `/sons`, `/videos` | `gallery_menu` (movies / musics rows) + Inacord explorer | `trophy_gallery` | movies, musics | `/medias` | partial |

## How a screen is built (the contract every agent follows)

1. `apps/nie-web/src/screens/<screen>.tsx` renders `LayoutRender` from `/api/v1/menu/layout/{screen}`
   and overlays the runtime scene from `/api/v1/menu/runtime/{screen}` (`createMenuRuntime`).
2. Data comes from `/api/v1/game-data/*` and `/api/v1/profile/complete`, bound to the screen's
   list layers through `itemCounts` and text objects; lists paginate the way the Lua does.
3. Filters use `GameFilterPanel` (already the game's FILTRES dialog); navigation, W/C tabs and
   Escape follow `menu-interaction.ts`. Every drawn affordance is wired.
4. The screen is registered in `apps/nie-web/src/entries.ts` (route, label, glyph) and bound to a
   main-menu item in `pages/Game.tsx`; `nie-site` `routes/pages.rs` gets the page (title,
   description, three languages) and the sitemap/robots counters follow.
5. No claim of pixel parity: the layout is the game's, the pixels are not proven (see
   `pixel-perfect` memory). What is proven is stated as measured counts.

## Order of work

1. Profile route (Rust) — everything else reads it.
2. `chara_bank_menu` (bank + detail + filters) — the largest page family, the reference implementation.
3. `gallery_menu` (achievements 100 %, gallery), `shop_menu` (full stock).
4. `story_mode_top_menu`, `chronicle_mode_top_menu` (finished), `soccer_formation_menu`.
5. `players_universe_menu` (constellations complete), `ability_learning_board_menu`.
6. Retire the corresponding Azalée pages by redirecting them to the screen route.
