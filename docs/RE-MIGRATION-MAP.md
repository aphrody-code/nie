# Cartographie & Plan de Consolidation RE pour la Migration vers Rust

Ce document fournit la synthèse exhaustive, classifiée et mesurée de tout le savoir reverse-engineering (RE) de `nie.exe` (Inazuma Eleven: Victory Road, référence PE64 `b1fa04ea3658`, 33 918 464 octets, 117 068 fonctions `.pdata`). Il organise le découpage par sous-système, dresse l'état des lieux de l'existant, et définit la feuille de route pour le portage de tout le code non-porté vers les crates Rust du workspace.

---

## 1. Classification Globale de `nie.exe` (117 068 fonctions)

Mesure extraite directement de la base de connaissance canonique (`var/nie.sqlite`, binaire #2 `nie.exe#pdata`) :

| Sous-système | Fonctions Total | Nommées (PDB/RTTI/Str/Lua) | Confiance >= 0.3 | Crate Rust Cible / Propriétaire | Statut de Portage Rust |
|---|---:|---:|---:|---|---|
| **Menu / UI** | 19 876 | 10 163 | 8 587 | `nie-formats::menu`, `nie-core::list_view`, `nie-app` | Avancé (menus statiques & navigation 100%, list_view porté) |
| **Chara / Joueurs** | 17 786 | 5 948 | 5 679 | `nie-data`, `nie-formats::assemble`, `nie-formats::g4*` | Avancé (stats, croissance, skills, assemblage 3D GLB) |
| **Physics / Collisions** | 16 679 | 5 598 | 5 650 | `nie-core::ball`, `nie-geom`, `nie-formats::col` | Partiel (ballon FSM & gravité portés, PhysX bridge à consolider) |
| **Gameplay / Match** | 15 530 | 4 092 | 5 703 | `nie-core::{match_fsm, keeper, tactics, action}` | Avancé (FSM 11 états, calcul arrêt gardien, IA tactique) |
| **Animation / Effets** | 8 988 | 4 451 | 3 168 | `nie-formats::g4ra`, `nie-formats::g4pkm_motion`, `nie-camera` | Modéré (animations caméras G4CM 100%, motion blending partiel) |
| **Script / Lua 5.2** | 8 773 | 7 933 | 7 922 | `nie-lua` | Très avancé (1197/1197 scripts exécutés sans erreur, VM 5.2) |
| **Audio / CriWare** | 5 626 | 1 488 | 1 633 | `nie-formats::cri_audio`, `cridecoder` | Avancé (décocage HCA/ADX/AWB/ACB, mixeur CRI en cours) |
| **Render / Shaders** | 1 362 | 386 | 421 | `nie-game`, `nie-render3d`, `nie-formats::g4tx*` | Avancé (wgpu multi-backend, G4TX decode/encode, viewer GLB) |
| **Level / Scène / Map** | 1 280 | 311 | 555 | `nie-formats::objbin`, `nie-formats::navm`, `nie-core::scene` | Modéré (objbin & navm décodés, placement de map en cours) |
| **Network / EOS / Steam** | 656 | 319 | 273 | `nie-steam`, `nie-cli steam`, `crates/archive/nie-engine::network` | Modéré (acquisition Steam native 100%, protocole lobby identifié) |
| **VFS / Conteneurs** | 529 | 150 | 77 | `nie-formats::{cpk, cfgbin, crilayla}` | Complet (100% CPK chiffrés, RDBN/T2B, décompression CRILAYLA) |
| **Input / Contrôleurs** | 468 | 130 | 67 | `nie-game`, `nie-core` | Modéré (mapping touches T2B décodé, bindings winit) |
| **Standalone / Feuilles** | 19 515 | 8 189 | 0 | `nie-core`, fonctions utilitaires standard | En cours (fonctions feuilles pures math/string/hash) |
| **TOTAL** | **117 068** | **49 158 (41.99%)** | **97 553 (83.33%)** | Workspace `nie` (46 crates maintenus) | **83.33% classifié structurellement** |

---

## 2. Organisation du Savoir RE Existant dans le Dépôt

Tout le savoir RE du dépôt est désormais consolidé et interconnecté :

1. **La Base de Connaissance Centrale (`var/nie.sqlite`)** :
   - Table `function` : Indexe les 117 068 fonctions de `nie.exe` issues des tables `.pdata` d'unwind PE64.
   - Table `rtti_class` & `rtti_base` : 1 745 classes C++ MSVC avec hiérarchie d'héritage complète (`game::*`, `lives::*`, `physx::*`).
   - Table `xref` : Plus de 400 000 arêtes du graphe d'appel (calls directs, appels indirects de vtables, références de chaînes).
   - Table `hash_name` : 62 125 correspondances CRC32/Hash ↔ Chaîne claire pour toutes les ressources VFS, écrans et commandes.
   - Table `func_str_ref` : 30 000+ liaisons chaîne ↔ fonction décompilée.
   - Table `pdata_func` : 55 351 entrées PE d'autorité.

2. **L'Atlas Global (`var/nie-atlas.sqlite`)** :
   - Index unifié couvrant 6 856 artefacts, 51 crates, 1 078 documents techniques, 15 162 références machines croisées (`0x14...`, fonctions, tables, hashes).
   - Suivi en temps réel des gaps de parité (`nie atlas gaps` & `nie atlas status`).

3. **Le Répertoire de Décompilation & Archives (`crates/archive/nie-engine/`)** :
   - 15 000+ lignes de C/C++ portées en Rust préliminaire, contenant **434 marqueurs `// EXTERN: FUN_140...`**.
   - Sert de catalogue de référence fonction par fonction pour l'implémentation dans les crates maintenus.

---

## 3. Plan de Migration par Phase vers Rust Pur

### Phase 1 : Cœur de Simulation et Logique Métier (`nie-core`)
- **Ballon et Physique de Terrain** :
  - Compléter les contrôleurs dérivés de `game::BallComponent` (`BallMoveNormal`, `BallMoveBezier`, `BallMoveGoalnet`).
  - Consolider les points de collision sol/cage adossés aux constantes extraites (`BALL_GRAVITY = 2.0f/frame²`, collision limit = 5).
- **IA Tactique & Match FSM** :
  - Lier les slots d'état de `game::CSceneSoccer` (`0x1405410d0`) à la machine à états déterministe.
  - Finaliser l'intégration des règles d'évaluation d'arrêt gardien (`game::SoccerCalcKeeperSaveComponent`).

### Phase 2 : Menus Interactifs et Cycle de Vie UI (`nie-app` & `nie-formats::menu`)
- **Contrôleur de Liste (`lives::CMenuListView`)** :
  - L'implémentation portée dans `crates/engine/nie-core/src/list_view.rs` réplique exactement les slots 9, 56 et 73 de `CMenuListView`.
  - Étape suivante : connecter la boucle de transition d'amorti (easing) au moteur de rendu wgpu (`nie-game`).
- **Exécution Dynamique des Menus** :
  - Relier les 102 commandes Lua reconnues (`nie-lua`) aux structures de scènes de `nie-core`.

### Phase 3 : Animation et Rendu Multimédia (`nie-formats`, `nie-render3d`, `nie-game`)
- **Caméras Cinématiques (`G4CM`)** :
  - Les 1 215 fichiers `.g4cm` sont décodés ; brancher le contrôleur `CCameraCtrl*` dans `nie-camera` pour l'interpolation temps-réel.
- **Mixeur Audio CRI Atom Ex** :
  - Remplacer les stubs restants par le synthétiseur PCM natif déjà esquissé dans `nie-engine::audio`.

---

## 4. Portes de Qualité et Vérification de Migration

Chaque brique migrée depuis le pseudo-C Ghidra ou `crates/archive/nie-engine` vers un crate maintenu doit satisfaire les critères suivants :
1. **Zéro Unsafe** : `#![forbid(unsafe_code)]` actif sur tous les crates `engine`.
2. **Déterminisme Binaire** : Pas de fast-math, alignement strict IEEE 754, générateur de nombres pseudo-aléatoires conforme à `lives::CRand` (MT19937 byte-exact).
3. **Clippy Clean** : `cargo clippy -p <crate> --lib --tests -- -D warnings` sans le moindre warning.
4. **Validation Atlas** : Enregistrement de la fonction dans l'Atlas (`port.symbols` incrémenté lors du build atlas).

## RE anchors

Knowledge base (`var/nie.sqlite`) tables:
- `function` — 117 068 functions of `nie.exe`
- `coverage` — binary coverage rate
- `pdata_func` — 55 351 authoritative function start addresses
- `xref` — call topology
- `rtti_class` — RTTI MSVC classes
- `hash_name` — VFS and UI hash tables
- `forge_unit` — unit compilation tracking

Key binary reference addresses:
- `0x1404ecd60` — Core character controller
- `0x1406d5840` — Core game state tick loop
- `0x1405410d0` — Menu list view update
