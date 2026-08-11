# Registre des portages inter-langages

> Ce que la doctrine (`docs/ARCHITECTURE-POLYGLOTTE.md`) impose de **déplacer**, dans les deux
> sens, avec le volume réel mesuré le 2026-08-11. Un portage fait ⇒ on retire la ligne et on
> supprime la source. Tant qu'une ligne est là, le code existe en double et c'est assumé,
> pas oublié.

Deux flux, opposés et simultanés :

- **C++ → Rust** : tout ce que le C++ fait *hors* du jeu jouable (CLI, core lib, formats).
- **Rust → C++** : le **jeu `nie` jouable** — la logique de match reversée vit aujourd'hui en
  Rust, elle doit rejoindre l'arbre C++ qui porte le C décompilé.

---

## Flux A — features C++ à porter en Rust

**La bonne nouvelle d'abord** : pour les formats, le portage est déjà fait à ~90 %.
`nie-formats` couvre 38 modules (cfgbin, cpk, crilayla, cri_audio, g4cm, g4la, g4ma, g4md, g4mg,
g4mt, g4pk, g4pkm, g4sk, g4tx + encode/decode, g4vs, lip, mevbin, navm, nxtch, objbin, col, font,
menu, dxbc, vfs, level5…). Ce qui manque n'est donc **pas le décodage, c'est l'exposition** :
les commandes du binaire `iecode` n'ont pas d'équivalent dans `niers`.

| Source C++ | Volume | Cible Rust | Nature du travail | Priorité |
|---|---|---|---|---|
| `src/cli/` (40 commandes) | 43 f. / 11 496 l | `crates/tools/nie-cli` | **câblage** : le décodage existe déjà dans `nie-formats` ; il manque les sous-commandes | **1** |
| `src/modding/` (scanner, conflits, installeur, packager, GameBanana, profils) | 11 f. / 3 485 l | crate `nie-mod` à créer | **réimplémentation** — aucun équivalent Rust | **2** |
| `src/gamedata/loader.cpp` | 5 f. / 4 855 l | `nie-data` (62 181 l) | vérifier la couverture famille par famille, puis supprimer | 3 |
| `src/compression/` (LZ10, Huffman 4/8, RLE, ZLib, LZ4, InazumaLZSS) | 8 f. / 1 305 l | `nie-formats::level5` | Rust n'a que CRILAYLA ; les 6 autres méthodes manquent | 3 |
| `src/converters/texture_*` | 2 f. / ~700 l | `nie-formats::g4tx_encode` **ou** C# | la variante C++ est la moins bonne ; ne subsiste que l'export **WebP** | 3 |
| `src/converters/model_*` | 2 f. / ~1 300 l | `nie-formats::assemble` (GLB) | assimp couvre l'import FBX/DAE : **reste C++** tant qu'aucun équivalent Rust | — |
| `src/services/`, `src/steam/` | 4 f. / 2 137 l | `crates/tools/nie-steam` (2 139 l) | recouper, puis supprimer le C++ | 4 |
| `src/scripting/` (sol2) | 1 f. / 810 l | `nie-lua` (4 925 l) | le Rust est plus avancé (dispatch de menus) | 4 |
| `src/db/`, `src/io/`, `src/memory/`, `src/archive/`, `src/vfs/`, `src/crypto/` | 13 f. / 3 294 l | `nie-formats`, `nie-index` | doublons du core lib Rust | 5 |
| `src/wasm/iecode_wasm.cpp` | 1 f. / 948 l | `nie-wasm` (1 717 l) | wasm est un rôle Rust : le port Emscripten n'a plus de raison d'être | 5 |
| `src/viola/` | 3 f. / 688 l | à qualifier | savoir d'abord ce que « viola » recouvre côté C# (`csharp/IECODE.Core/Viola`) | 6 |

**Reste en C++ (ne pas porter)** : `src/decomp/` (le C décompilé, cœur du rôle), `src/game/` +
`src/engine/` (le jeu jouable — cible du flux B), `src/driver/` (pilote kernel), les wrappers de
bibliothèques sans équivalent (assimp, Bullet).

### Détail du flux A-1 : les commandes à câbler dans `niers`

Commandes de `iecode` sans équivalent `niers` — le décodage existe déjà, il faut la sous-commande :

`archive` · `audio` · `convert` · `format` · `g4cm` · `g4md` · `g4mg` · `g4pk` · `g4ra` · `g4sk` ·
`g4tx` · `lua` · `merge` · `mevbin` · `mod` · `p3lip` · `pack` · `passive` · `pipeline` ·
`prepare_menu` · `render` · `scene` · `usm` · `utf` · `vfx` · `bin` · `config` · `dump_gamedata` ·
`dump_playstyle` · `info` · `benchmark` · `serve` · `search`

Déjà couvertes côté Rust (aucun portage) : `extract`, `dump`, `vfs`, `push`, `crypto`, `nie`.

En attendant, elles restent atteignables : `niers cpp <commande>` (cf.
`crates/tools/nie-cli/src/delegate.rs`).

---

## Flux B — le jeu jouable Rust à porter en C++

La doctrine met le **jeu `nie` jouable en C++**, adossé au C décompilé. Or toute la logique de
match reversée byte-exact vit aujourd'hui dans `crates/engine/nie-core`, et elle n'est
**consommée par personne** (cf. `docs/UNIFICATION.md` : ces modules sont orphelins). Les porter
vers C++ leur donne enfin un consommateur : le jeu.

| Source Rust | Volume | Cible C++ | Ce que c'est | Priorité |
|---|---|---|---|---|
| `nie-core::{ball, action, keeper, tactics, soccer_ctrl, command_effect, aura, play_cmd_manager}` | ~4 500 l | `src/game/soccer/` | physique du ballon, IA gardien, tactiques, effets de commande — **byte-exact, orphelins** | **1** |
| `nie-core::{match_fsm, match_state, match_sim}` | ~2 000 l | `src/game/` | machines à états de match et d'entraînement + résolution statistique | **1** |
| `nie-core::ecs` | ~600 l | `src/engine/ecs/` | l'ECS reversé ; `src/engine/` en a déjà un squelette | 2 |
| `nie-runtime::World` | 1 188 l | `src/game/` | boucle physique (Euler approximé, **non reversée**) — porter *après* que `ball` soit branché, sinon on fige une approximation | 3 |
| `nie-lua` (dispatch `CMD_`, `menu_host`) | 4 925 l | `src/scripting/` + `src/engine/menu/` | ~35/172 commandes de menu implémentées ; le C++ a sol2 pour exécuter | 2 |
| `nie-camera` (g4cm, `CCameraCtrl*`) | 5 265 l | `src/game/camera/` | contrôleurs de caméra reversés, mappés aux classes RTTI `game::CCameraCtrl*` | 3 |
| `nie-app::flow::Screen` | 728 l | `src/game/` | FSM d'écran (Title → Menu → Match → Story) | 3 |

**Question ouverte, à trancher avant le flux B-3** : la doctrine dit « GUI en Rust » **et** « jeu
jouable en C++ ». `nie-game` (8 200 l, host wgpu + winit) est donc à cheval. Lecture retenue tant
qu'elle n'est pas corrigée : la **GUI d'outillage** (explorateur, visionneuses) reste Rust ; le
**host du jeu** suit le jeu en C++ (bgfx/D3D11, comme `nie.exe`). `nie-render3d` (rastériseur CPU)
reste Rust : c'est l'oracle des tests golden, pas un moteur de rendu du jeu.

**Ne pas porter** : `nie-formats`, `nie-data`, `nie-save`, `nie-wiki` (core lib = Rust),
`nie-wasm` (wasm = Rust), `crates/forge/*` (RE = Rust).

---

## Règles de portage

1. **Ne jamais porter une approximation comme si c'était reversé.** `nie-runtime::step_ball`
   n'est pas byte-exact ; le porter tel quel en C++ enshrinerait une formule fausse.
2. **Un portage n'est fini que quand la source est supprimée.** Sinon on a créé un doublon de
   plus, et le prochain lecteur ne sait plus qui fait autorité.
3. **Les golden voyagent avec le code.** Un module byte-exact porté sans ses tests n'est plus
   byte-exact, il est seulement *supposé* tel.
4. **Le sens du flux ne se négocie pas au cas par cas** : c'est la doctrine qui tranche, pas la
   commodité du moment.
