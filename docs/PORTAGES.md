# Registre des portages

Ce que la doctrine ([`ARCHITECTURE-POLYGLOTTE.md`](ARCHITECTURE-POLYGLOTTE.md)) impose de
déplacer. Une ligne présente = le code existe en double, sciemment. Un portage n'est fini que
quand la source est supprimée.

## C++ → Rust

Les formats sont déjà portés à ~90 % : `nie-formats` couvre 38 modules. Ce qui manque n'est pas
le décodage mais **l'exposition** — les commandes de `iecode` n'ont pas de sous-commande `niers`.

| Source | Volume | Cible | Travail | Prio |
|---|---|---|---|---|
| `src/cli/` (40 commandes) | 11 496 l | `crates/tools/nie-cli` | câblage de sous-commandes | 1 |
| `src/modding/` | 3 485 l | crate `nie-mod` à créer | réimplémentation (aucun équivalent) | 2 |
| `src/gamedata/loader.cpp` | 4 855 l | `nie-data` | vérifier la couverture, puis supprimer | 3 |
| `src/compression/` | 1 305 l | `nie-formats::level5` | Rust n'a que CRILAYLA ; 6 méthodes manquent | 3 |
| `src/converters/texture_*` | ~700 l | `nie-formats::g4tx_encode` ou C# | seul l'export WebP subsiste | 3 |
| `src/services/`, `src/steam/` | 2 137 l | `crates/tools/nie-steam` | recouper puis supprimer | 4 |
| `src/scripting/` | 810 l | `nie-lua` | le Rust est plus avancé | 4 |
| `src/db/ io/ memory/ archive/ vfs/ crypto/` | 3 294 l | `nie-formats`, `nie-index` | doublons du core lib | 5 |
| `src/wasm/` | 948 l | `nie-wasm` | wasm est un rôle Rust | 5 |
| `src/viola/` | 688 l | à qualifier | comparer d'abord à `csharp/IECODE.Core/Viola` | 6 |

**Reste en C++** : `src/decomp/`, `src/game/`, `src/engine/`, `src/driver/`, `src/converters/model_*`
(assimp).

### Commandes à câbler dans `niers`

`archive` `audio` `convert` `format` `g4cm` `g4md` `g4mg` `g4pk` `g4ra` `g4sk` `g4tx` `lua` `merge`
`mevbin` `mod` `p3lip` `pack` `passive` `pipeline` `prepare_menu` `render` `scene` `usm` `utf` `vfx`
`bin` `config` `dump_gamedata` `dump_playstyle` `info` `benchmark` `serve` `search`

Déjà côté Rust : `extract` `dump` `vfs` `push` `crypto` `nie` `decode`. En attendant : `niers cpp <cmd>`.

## Rust → C++ (jeu jouable)

La logique de match reversée byte-exact vit dans `nie-core` et n'est consommée par personne.
La porter dans `src/game/` lui donne un consommateur.

| Source | Volume | Cible | Contenu | Prio |
|---|---|---|---|---|
| `nie-core::{ball, action, keeper, tactics, soccer_ctrl, command_effect, aura, play_cmd_manager}` | ~4 500 l | `src/game/soccer/` | physique ballon, gardien, tactiques, effets | 1 |
| `nie-core::{match_fsm, match_state, match_sim}` | ~2 000 l | `src/game/` | FSM match + entraînement + résolution statistique | 1 |
| `nie-lua` | 4 925 l | `src/scripting/`, `src/engine/menu/` | dispatch `CMD_` des menus (35/172) | 2 |
| `nie-core::ecs` | ~600 l | `src/engine/ecs/` | ECS reversé | 2 |
| `nie-camera` | 5 265 l | `src/game/camera/` | contrôleurs `game::CCameraCtrl*` | 3 |
| `nie-app::flow::Screen` | 728 l | `src/game/` | FSM d'écran | 3 |
| `nie-runtime::World` | 1 188 l | `src/game/` | physique Euler **non reversée** — après `ball` | 3 |

**Ne pas porter** : `nie-formats`, `nie-data`, `nie-save`, `nie-wiki`, `nie-wasm`, `crates/forge/*`.

**Question ouverte** : `nie-game` (8 200 l, host wgpu + winit) est à cheval entre « GUI en Rust » et
« jeu jouable en C++ ». Lecture retenue : GUI d'outillage = Rust, host du jeu = C++.
`nie-render3d` reste Rust (oracle des tests golden).

## Règles

1. Ne jamais porter une approximation comme si elle était reversée (`nie-runtime::step_ball`).
2. Les golden voyagent avec le code : un module byte-exact porté sans ses tests ne l'est plus.
3. Le sens du flux est fixé par la doctrine, pas par la commodité.
