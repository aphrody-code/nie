# Plan de déduplication & d'unification de niers

> Plan vivant. Synthèse d'une cartographie multi-agents des duplications **réelles** du
> workspace (preuves `file:line`, 2026-06-21). Maintenir le statut par phase à jour.
> Apparenté : `docs/UNIFICATION.md` (couvre spécifiquement l'unification de la boucle de match,
> = Phase 4 ici). Ce document est le plan **transverse** de dédup/hygiène.

## Règle cardinale

La dédup ne doit **jamais** casser la discipline byte-exact du projet ni les frontières de portabilité.
En pratique, **la dédup *renforce* presque toujours le byte-exact** (un décodeur/compositeur unique au
lieu de N divergents). Les ~60 tests IEEE-754/golden sont le filet : **toute fusion qui les garde verts
préserve l'ancrage RE**. Contraintes à respecter dans chaque action :

- **byte-exact** : ne jamais réécrire l'ordre des ops f32 (`mul_add`/SSE) d'un module validé ; on **enrobe**, on ne réécrit pas.
- **no_std** : `nie-data` est `#![no_std]` strict (wasm). Ne rien y remonter qui tire `std`.
- **wasm-portable** : `nie-formats`/`nie-core`/`nie-wasm` sans `std::fs`/`println!`.
- **`#![forbid(unsafe_code)]`** : intact sur les crates jeu ; la dédup est du câblage sûr.

## Les 3 fusions INTERDITES (landmines)

1. **CRC32 finalisé vs brut** = **deux fonctions distinctes**. `crc32` (`!crc`, noms cfg.bin, clés de
   fichier CPK, type-id ECS, CRC de save) ≠ `crc32_nie` (accumulateur brut sans complément, model-id CPK
   `nie-formats/src/cpk.rs:144`, lookup g4tx). Les collapser corrompt silencieusement l'un des deux chemins.
2. **`g4sk::mat_mul` (col-major)** reste **scalaire local** (`nie-formats/src/g4sk.rs:452`) — jamais glam/FMA :
   il est validé golden `real-fixtures` (skinning), un réordonnancement f32 casse le golden.
3. **`StatBlock` de `nie-wiki`** (2 segments f64, `model.rs:97`/`query.rs:236`) diverge **volontairement**
   de `nie-core` (3 segments f32) : le miroir SQLite n'a pas le palier lv30. Ne pas fusionner.

## Constat : 3 strates de risque

La duplication n'est pas homogène. Elle se range en 3 strates au risque très différent, et **plusieurs
duplications causent déjà des bugs réels** (pas cosmétiques) :

| Bug réel observé | Cause (duplication) | Axe |
|---|---|---|
| `nie-play` produit **2 scores divergents** par match (statistique affiché + physique jeté) | triple modèle de but | A |
| **56 familles cfg.bin** décodées structuré côté serveur mais « generic » dans le navigateur | table de dispatch `typed` recopiée+divergée | D |
| Textures **visibles sur le CDN, invisibles en wasm** | 4 décodeurs DDS divergents (wasm/ffi = DX10 seul) | E |
| Le **CDN rend les menus** avec un compositeur f64 ≠ la référence pixel-perfect f32 | 2 compositeurs de menu | F |
| **15k LOC + 271 tests morts** compilés à chaque `cargo build --workspace` | `nie-engine` orphelin | B |

## Architecture cible (le « après »)

```
nie-geom (no_std, 0 dep)  ← Vec2/3/4 + Mat4 + math scalaire            [NOUVEAU, Phase 2]
   ↑ nie-core, nie-runtime, nie-render3d, g4mg
nie-formats  ← devient vraiment no_std (thiserror gated std)           [Phase 3]
   ├─ cfgbin::crc32 / crc32_nie          = SOURCE UNIQUE du hash       [Phase 1d]
   ├─ g4tx_decode (feature "textures")   = SOURCE UNIQUE décodage DDS  [NOUVEAU, Phase 1b]
   └─ raster2d / menu::compose (f32)     = SOURCE UNIQUE compositing 2D [NOUVEAU, Phase 2]
nie-data::typed  = SOURCE UNIQUE dispatch des familles cfg.bin         [Phase 1a]
nie-core::match_live = SOURCE UNIQUE boucle de match (orchestre ball/keeper/…) [NOUVEAU, Phase 4]
nie-app::GameState   = SOURCE UNIQUE FSM d'écran (fronts = adaptateurs I/O)     [Phase 5]
nie-engine           = exclu des members → référence RE lecture seule  [FAIT, Phase 0]
```

---

## Phases

### Phase 0 — Nettoyage byte-neutre — **FAIT (2026-06-21, commit `a9b0c27`)**
- **`nie-engine` exclu** des membres compilés (`exclude` dans `Cargo.toml`) → cesse de builder/tester
  ~15k LOC + 271 tests morts ; conservé comme référence (cf. `PLAN.md §3quinquies`).
- **7 deps mortes retirées** (grep 0 usage) : `nie-model-serve→nie-wiki`, `nie-wiki→nie-core`,
  `nie-re→serde+serde_json+petgraph`, `nie-zukan→tokio+tokio-util`, + `petgraph` racine.
- Divergences volontaires documentées en place (StatBlock nie-wiki, PropagationGraph nie-re).
- **Reste (non fait) sous Phase 0** : factoring intra-crate `nie-render3d` (helpers `V3/sub/cross/dot/normv`
  copiés verbatim entre `scene.rs:9` et `render.rs:15` ; dégradé vertical ×3 ; `fill_triangle`↔`fill_tex`) ;
  installer `cargo-machete` en garde-fou CI (absent du VPS).
- *Garde : `cargo build/test --workspace` + clippy verts.* ✅

### Phase 1 — Tuer les bugs de divergence — **NON_FAIT** (effort M, risque faible, gardé golden)

| # | Action | file:line clés | Bug corrigé |
|---|---|---|---|
| **1a** | Rapatrier les **56 arms** de `model-serve::typed_decode` → `nie-data::typed::decode_by_key` ; supprimer `cfg_family_key`+`typed_decode` de model-serve (qui deviennent des appels à `nie_data::typed`). | `nie-data/src/typed.rs:18,36` (37 fam.) · `nie-model-serve/src/main.rs:613,635,2130` (93 fam.) · `nie-wasm/src/lib.rs:739` (consommateur correct) | wasm gagne 56 familles **gratis** → fin incohérence serveur/navigateur |
| **1b** | Nouveau **`nie-formats::g4tx_decode`** (feature `textures`, off par défaut, `image_dds` en `default-features=false` → wasm-OK), reprenant la variante **la plus complète** (model-serve : DX10 + FourCC + legacy). 5 crates l'appellent ; réutilise `g4tx::select_main_texture` (déjà l'unique sélecteur anti-dummy). | `nie-game/src/main.rs:282,302` · `nie-wasm/src/lib.rs:765,785,836` · `nie-ffi/src/lib.rs:614,633` · `nie-model-serve/src/main.rs:339,369,796` · `nie-formats/src/g4tx.rs:182` | textures invisibles en wasm (4 décodeurs divergents) |
| **1c** | `model-serve` compositeur de menu **f64 → `nie-formats::menu::compose` f32** (la référence pixel-perfect). | `nie-model-serve/src/menu.rs:107,191` (f64, prod /menu-render) · `nie-formats/src/menu.rs:218,282` (f32, réf) | CDN aligné sur le pixel-perfect |
| **1d** | **CRC32 source unique** : `nie-save`/`nie-ffi` (qui dépendent déjà de nie-formats) importent `nie_formats::cfgbin::crc32` et suppriment leur copie ; `nie-core::ecs`/`nie-data::unlock_condition` (no_std) gardent leur copie + test croisé. Extraire **clé HCA `0x00D2997C0DC5EE72` + decode** dans un module std-gated partagé par wasm/model-serve. | `nie-formats/src/cfgbin.rs:625` (source) · `nie-save/src/lib.rs:528` · `nie-ffi/src/lib.rs:85` · `nie-model-serve/src/main.rs:1520` · `nie-wasm/src/lib.rs:939` | dérive silencieuse hash/audio |

*Garde : déménager les golden `typed` avec les arms ; **comparer `bcdec_rs`↔`image_dds` sur une vraie texture BC7
avant** de retirer le décodeur de `nie-app::character.rs:18` ; la comparaison GPU↔CPU de nie-game reste verte.*

### Phase 2 — Brique géométrie + raster — **NON_FAIT** (effort M, soin no_std)
- **Crate feuille `nie-geom`** (`#![no_std]` + alloc, 0 dep, **pas glam** ; sqrt/normalize derrière feature
  `std`/`libm`) : PODs `Vec2/Vec3/Vec4/Mat4`. Migrer `nie-core/src/lib.rs:169`, `nie-runtime/src/lib.rs:23,69`,
  `nie-render3d` (`scene.rs:9`+`render.rs:15`), `nie-formats/src/g4mg.rs:39,51`. **`g4sk::mat_mul` reste local** (landmine 2).
- **`nie-formats::raster2d`** : `blend_over`/`blit_over`/`crop`/`scale_nearest`/`sample_bilinear` uniques ;
  converger les **≥6 blends à arrondis divergents** (`nie-game/src/main.rs:972`, `nie-formats/src/menu.rs:261`+`font.rs:497`,
  `nie-model-serve/src/menu.rs:170`, `nie-runtime/src/render.rs:52`, `nie-app/src/render.rs:84`) sur le canon f32 du compositeur
  (byte-exact imposé seulement au chemin menu déjà testé). `crop_rgba`/`scale_nearest` de `nie-game/src/main.rs:724,953` → raster2d.

### Phase 3 — `nie-formats` vraiment no_std — **NON_FAIT** (effort L, *enabler*)
Gater `thiserror` derrière feature `std` (Display manuel `core::fmt` + `impl std::error::Error` sous `cfg(std)`) ;
vérifier que `aes` compile en no_std. **Débloque** : `nie-data` consomme enfin le **vrai parseur binaire**
`nie_formats::cfgbin::CfgEntry/RdbnList` au lieu du JSON inagle → effondre la représentation cfg.bin parallèle
(`nie-data/src/cfgbin.rs` `Node/Var/walk_named` devient un adaptateur transitoire tant qu'azalee ingère du JSON).

### Phase 4 — Unification des moteurs de match — **NON_FAIT** (effort L, **risque byte-exact max — le vrai prix**)
= *Phase 1 de `docs/UNIFICATION.md`*, déjà actée. Aujourd'hui **3 moteurs coexistent sans se parler** : `match_sim`
(statistique nominal), `nie-runtime::World` (physique Euler approximée), et tout le code byte-exact **orphelin**.
- Créer **`nie-core::match_live`** (boucle tick) orchestrant les modules byte-exact **aujourd'hui orphelins** :
  `ball::BallMover` (`ball.rs:341,477`), `keeper` (`keeper.rs:151`), `soccer_ctrl`, `tactics`, `action`,
  `play_cmd_manager` + `match_fsm::final_score`.
- `nie-runtime::World` **délègue** la physique du ballon à `nie-core::ball` ; supprimer `step_ball`/`RESTITUTION`/`GROUND_FRICTION`
  (approximations non reversées, `lib.rs:146,276`) + le détecteur de but géométrique.
- **Fusionner `match_state.rs` → `match_fsm.rs`** (une enum `MatchState`, une `final_score`). `match_sim` reste mode « résultat rapide ».
- *Garde : enrober sans réécrire ; **re-baseliner** les golden de déterminisme du World (`nie-runtime/src/lib.rs:517`, figés sur l'ancienne approximation).*

### Phase 5 — Fronts sur `nie-app` — **NON_FAIT** (effort M)
- Remonter la **FSM interactive prisonnière de `nie-wasm`** (`Screen` + `input`/`update`, `nie-wasm/src/lib.rs:1304`) dans
  `nie-app::GameState` (`lib.rs:26` — ajouter `ModeSelect`/`Info`) ; `nie-wasm` ne garde que clavier→`Cmd`.
- **`nie-game` dépend de `nie-app`** au moins pour `MENU`/`MODES` (aujourd'hui CLI Lua autonome de 3992 LOC, 0 dép nie-app).
- Renommer `nie-app::render::Screen`→`Frame` (`render.rs:54`, collision de nom avec la FSM) ; corriger la doc de `nie-app/src/lib.rs:5` qui ment sur ses consommateurs.

### Ordre & rationale
Phase 0 (gratuit, **fait**) → Phase 1 (corrige des bugs **utilisateur**, fort ROI) → Phase 2 (briques partagées) →
**Phase 3 est le verrou** : `nie-formats` no_std conditionne la dédup cfg.bin la plus profonde → Phase 4 (le cœur,
risqué, gardé) → Phase 5 (fronts). **Les phases 0-2 sont livrables indépendamment.**

---

## Annexe — Cartographie complète par axe (preuves `file:line`)

### A. Moteurs de match (gravité haute)
- **Triple modèle de but** : probabiliste (`match_sim.rs:499,503`) · géométrique (`nie-runtime/src/lib.rs:404,165`) ·
  byte-exact reversé orphelin (`play_cmd_manager.rs:60`, `match_fsm.rs:206`). Smoking gun : `nie-play/src/main.rs:106` vs `:150` (2 scores).
- **Triple physique de ballon** : `nie-core/src/ball.rs:231,477` (byte-exact, orphelin) · `nie-engine/src/physics.rs:1197,1426` (copie, crate orpheline) · `nie-runtime/src/lib.rs:146,276` (Euler approximé, seul exécuté).
- **Double FSM 11 états** : `match_fsm.rs:26,206` (branché) vs `match_state.rs:136,109` (orphelin, même switch `FUN_1412aa4a0`).
- **Modules reversés byte-exact tous orphelins** : `soccer_ctrl.rs:121`, `keeper.rs:151`, `tactics.rs:219`, `action.rs:236`, `command_effect.rs:175`.

### B. `nie-engine` orphelin — **traité Phase 0**
Duplique le domaine de 5 crates vivantes : ball (`physics.rs:1197` vs `nie-core/ball.rs:138`), Vec3 (×3), CPK/CRILAYLA
(`cpk.rs:244` vs `nie-formats/cpk.rs`+`crilayla.rs`), cfgbin (`cfgbin.rs:399` vs `nie-formats/cfgbin.rs:252`), G4
(`g4.rs:97` vs g4tx/g4md/g4sk/g4mg), audio (`audio.rs:34`, 74 EXTERN, vs `cri_audio.rs:150`), animation
(`animation.rs:66` vs `g4mt.rs:107`), Lua menu (`menu.rs:206`/`scripting.rs:9` vs `nie-lua/menu_host.rs:220`),
rendu (`render.rs:76` D3D11 vs `nie-render3d`+`nie-game`).

### C. Parsing cfg.bin / CRC32
- 2 représentations cfg.bin parallèles : `nie-formats/cfgbin.rs:654,661,846,377` (binaire) vs `nie-data/cfgbin.rs:21,58,126,144` (JSON inagle).
- CRC32 finalisé réimplémenté ≥6× : `nie-formats/cfgbin.rs:625` · `nie-data/unlock_condition.rs:309` · `nie-core/ecs.rs:21` · `nie-save/lib.rs:528` · `nie-formats/cpk.rs:163` (+ variante brute `cpk.rs:144` à NE PAS confondre) · `nie-engine/g4.rs:602`. `nie-ffi/lib.rs:107` réutilise déjà nie-formats (modèle à suivre).

### D. Dispatch `typed` (gravité haute) — **Phase 1a**
`family_key` byte-identique (`nie-data/typed.rs:18` vs `nie-model-serve/main.rs:613`) ; table de dispatch divergée
37 (`nie-data/typed.rs:36`) vs 93 (`nie-model-serve/main.rs:635`) ; consommateur correct `nie-wasm/lib.rs:739` (hérite des 37 seulement).

### E. Décodage texture (gravité haute) — **Phase 1b**
`dxgi_to_image_format` recopié verbatim ×4 (`nie-game:282`, `nie-wasm:765`, `nie-ffi:614`, `nie-model-serve:339`) ;
décodeur Surface→RGBA8 ×4 à couvertures divergentes ; sélecteur « plus grande texture » ré-inventé ×4 alors que
`g4tx::select_main_texture` (`g4tx.rs:182`) existe ; encodage PNG ×3 ; 2e décodeur BC7 parallèle via `bcdec_rs`
(`nie-app/character.rs:18`). GLB **déjà centralisé** (`assemble.rs:511/524/546`) — rien à faire côté GLB.

### F. Rastériseurs / compositeurs CPU — **Phase 2**
2 compositeurs de menu (f64 prod `nie-model-serve/menu.rs:107` vs f32 réf `nie-formats/menu.rs:218`) ; rastériseur
triangle 3D dupliqué (`nie-render3d/render.rs:156` vs `scene.rs:334,292`) ; blend « over » ≥6× à arrondis divergents ;
type image RGBA8 redéfini 4× (`glb.rs:11`, `nie-runtime/render.rs:31`, `nie-app/render.rs:54`, `nie-model-serve/menu.rs:61`).

### G. Hygiène deps — **traité Phase 0** (deps mortes) + Phase 1d (helpers HCA/CRC32 copiés)

### H. Fronts + géométrie — **Phase 5 (fronts) + Phase 2 (géométrie)**
FSM écran divergente (`nie-app/lib.rs:26` vs `nie-wasm/lib.rs:1304`) ; `nie-game` ne dépend pas de `nie-app` ;
Vec3 ×4, Vec2/V2 ×3 (noms incompatibles), `mat_mul` 2 conventions (row-major `scene.rs:55` vs col-major byte-exact `g4sk.rs:452`).
