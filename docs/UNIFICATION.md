# niers — PLAN D'UNIFICATION ET DE CONSOLIDATION

> Issu du workflow multi-agents `unify-niers` (5 agents d'inventaire + 1 de synthèse, 2026-06-20).
> But : transformer les briques RE éparses de niers en **UN vrai jeu jouable** (IEVR complet).

## Diagnostic (vérifié sur le terrain)

niers est **l'inverse d'un jeu** : énormément de code reversé et validé byte-exact, mais **épars et
non câblé en boucle**. La SEULE logique de jeu réellement branchée est
`nie_core::match_sim::simulate_match` (`match_sim.rs:473`) — une FSM **statistique** (tirage CRand
agrégé) qui **ignore les modules les plus reversés**.

**Deux fractures à combler en priorité :**
1. **Logique reversée orpheline** — `ball/action/keeper/tactics/soccer_ctrl/command_effect/play_cmd_manager/ecs`
   sont byte-exact mais `grep crate:: = NONE`. Le « match jouable » n'est pas un déroulé terrain.
2. **Pont données absent** — `nie-data` (95 modules) est riche et 100 % consommé… mais seulement par
   le serving/menu, **jamais par un loop de match**. `simulate_match` tourne sur des `StatBlock` codés
   en dur. `nie-play` déclare `nie-data` sans l'importer.

**Constats clés :** `nie-engine` (~600 Ko) et `nie-runtime` ne sont consommés par personne (seuls
leurs propres `Cargo.toml` les référencent). `nie-game` possède déjà le host GPU (wgpu 29 + winit 0.30)
mais **hors de toute boucle de jeu**. `nie-lua`/menu reliés par des fichiers JSON one-shot, aucune
boucle `input → dispatch → transition`.

## Architecture cible

**CŒUR = une crate-bibliothèque `nie-app`** (à créer) qui possède la machine à états du jeu —
aujourd'hui enfermée dans le binaire `nie-play` (`main.rs:139`). On l'extrait en lib réutilisable,
on découple le rendu derrière un trait, et `nie-play`/`nie-game` deviennent deux **front-ends**.

```
nie-app (lib, cœur) ── possède :
  - enum GameState { Title, MainMenu, TeamSelect, Match, Story, KizunaTown, AvatarEdit, … }
  - trait Frontend { poll_input() -> Vec<Input>; present(&Screen) }  + trait Renderer
  - fn update(state, input, dt) -> state   (boucle event-driven, dt réel)
  - orchestration partagée (VFS police/assets, transitions)
  consomme : nie-core (logique), nie-data (tables), nie-formats (assets),
             nie-lua (menus), nie-wiki (data), nie-save (continuer)

front-ends :
  - nie-game  = INTERACTIF (wgpu + winit) — le runner de jeu réel, 60 fps clavier/manette
  - nie-play  = HEADLESS/GOLDEN (flow scripté + Renderer CPU nie-render3d) — PNG/MP4 déterministes
  - nie-wasm  = (à terme) 3e front exposant la même GameState à azalee
```

**Décisions :** (a) `nie-engine` = **décommissionner** comme runtime (garder en référence de portage) ;
(b) `nie-runtime` = promouvoir `World::step` en branchant les modules `nie-core` reversés, ou acter
qu'il est jetable ; (c) le temps-réel passe par **wgpu dans nie-game** ; `nie-render3d` CPU reste le
fallback headless/golden.

## Roadmap (phases ordonnées)

- **Phase 0 — Fondation** : extraire `nie-app` (lib) de `nie-play` derrière `Frontend`/`Renderer` ;
  `nie-play` refactoré en front headless ; non-régression du playthrough PNG/MP4.
- **Phase 1 — Match reversé jouable (fracture #1)** : `nie_core::match_live` (boucle tick) orchestrant
  ball/soccer_ctrl/tactics/action/keeper ; `play_cmd_manager::MatchScoring` comme agrégateur ;
  hissatsu/aura/skill appliqués ; `match_sim` reste le mode « résultat rapide ».
- **Phase 2 — Pont données (fracture #2)** : `nie-app::roster` charge chara_param/growth/formation/skill
  → `TeamSetup::from_chara_params_and_levels` ; fin des `StatBlock` en dur ; TeamSelect via nie-wiki.
- **Phase 3 — Menus interactifs fidèles** : contrôleur stateful extrait de nie-lua
  (drive_menu → pump input → dispatch_menu_command → transition) ; couche données pré-remplie ;
  compositeur unifié sprites + TEXTE ; table de dispatch complétée (>35/172).
- **Phase 4 — Front GPU interactif** : `nie-game` implémente `Frontend`(winit) + `Renderer`(wgpu) ;
  écrans 2D en wgpu ; Match 3D temps-réel (port `nie-render3d::scene` → wgpu).
- **Phase 5 — Mode histoire** : état Story via `nie-wiki search_dialogues` (inagle_event_subtitles,
  2093 lignes) ; bulle de dialogue (port `compose_story_png`) ; avancement de scène.
- **Phase 6 — Continuer/Save + piliers RPG** : décodage section équipe opaque de la save ; écran
  Continuer (SaveSummary+Roster → TeamSetup) ; états Kizuna Town, AvatarEdit, overworld, inventaire.
- **Phase 7 — Animation, maps, parité wasm** : skinning par frame (`g4mt::parse_animation` +
  JOINTS/WEIGHTS dans `to_glb`) ; layout vertex des maps ; `nie-wasm` expose la GameState ;
  décommission `nie-engine`, hygiène des chemins VPS.

## Capacités orphelines à brancher (l'inventaire de la dette)

- `nie-core` : ball.rs, action.rs, keeper.rs, tactics.rs, soccer_ctrl.rs, command_effect.rs, aura.rs,
  play_cmd_manager.rs (MatchScoring), ecs.rs — **tous reversés, consommés par PERSONNE**.
- `nie-engine` ENTIER (~600 Ko : render D3D11, physics, CMenuRender, EOS+Lua, CRI, gmdCAnimation).
- `nie-runtime` ENTIER (World physique propriétaire + bin nie-match3d).
- `nie-formats::g4mt::parse_animation` (byte-exact, non consommé) ; `to_glb` sans JOINTS/WEIGHTS.
- `nie-wiki` : interpolate_stats / random_team / get_team / search_dialogues — non câblés au jeu.
- `nie-save` : Roster + SaveSummary + section équipe (Team::unresolved toujours vide) — lecture seule.
- `nie-lua` : ~35/172 commandes CMD_ implémentées ; drive_menu one-shot (pas de boucle interactive).
- Modules nie-data gameplay (command, rpg_battle, special_tactics, passive, override_skill) — non bouclés.

## Fichiers clés

`crates/engine/nie-play/src/main.rs` (FSM à extraire, l.139/149/243/246) ·
`crates/engine/nie-core/src/match_sim.rs` (l.284/473) · `crates/engine/nie-core/src/{ball,action,keeper,tactics,soccer_ctrl,play_cmd_manager}.rs`
(orphelins) · `crates/engine/nie-runtime/src/lib.rs` (physique à arbitrer) · `crates/engine/nie-game/src/main.rs`
(host wgpu l.799/2571) · `crates/engine/nie-lua/src/menu_host.rs` (driver l.655/1261) ·
`crates/tools/nie-model-serve/src/menu.rs` (compositeur à partager) · `crates/engine/nie-formats/src/{g4mt.rs:107,assemble.rs:54}`.
