# Architecture

Une implémentation maintenue d'IEVR sous une racine. Ce document dit **qui fait quoi** et
**ce qu'il ne faut jamais fusionner**. Le détail de l'absorption historique est dans
[`IECODE-MIGRATION.md`](IECODE-MIGRATION.md).

## Les arbres maintenus

| Arbre | Racine | Volume | Build |
|---|---|---|---|
| Rust — moteur, forge et outils | `crates/`, `forge/` | workspace Cargo | `cargo` |
| TypeScript/Bun | `packages/`, `apps/` | workspaces Bun | `bun` |

`just all-build` · `just all-test` · `just all-check` pilotent ces deux chaînes.

## Doctrine — un rôle, un langage

| Langage | Rôles |
|---|---|
| **Rust** | la seule CLI, GUI, core lib, wasm, RE, byte-exact et runtime |
| **Bun/TS** | types, contrats WebView et UI |

Règles qui en découlent :

- `nie-formats::g4tx_decode` reste Rust : sans lui, wasm n'a pas d'images.
- Porter une capacité se justifie par la doctrine ou par une contrainte technique (byte-exact,
  wasm, dépendance native) — jamais par le goût du langage.

## La CLI unique

```bash
niers decode <src>    # fichier ou arborescence → JSON / PNG (rayon)
niers viola dump ...  # extraction VFS native
niers steam sync ...  # acquisition Steam native
```

Il n'existe plus de délégation vers un binaire C++, une assembly .NET, CMake ou vcpkg.

## Les crates Rust

**41 membres** (`cargo metadata --no-deps --format-version 1 | jq '.packages | length'`, mesuré
2026-09-08 : 10 forge + 19 engine + 12 tools), rangés par rôle ci-dessous, colonne `tests` =
`rg -c '#\[test\]' <dossier>` le même jour. `crates/archive/*` (2 crates, hors des 38) est **hors
du workspace** : `nie-engine` en est exclu explicitement (`exclude = […]` dans le `Cargo.toml`
racine — ~15 000 lignes portées des fichiers C décompilés, 434 marqueurs `// EXTERN:`, consommées
par aucune crate vivante) ; `nie-rs` n'a jamais figuré dans `members` (son propre `Cargo.lock`
autonome, origine dans l'outil externe `iecode-re`, pas un livrable niers). Les deux restent en
lecture seule, référence de portage, jamais compilées par `cargo build --workspace`.

### `crates/forge/*` — produire le binaire (10)

| Crate | Rôle | Tests |
|---|---|---:|
| `aphrody-re` | Triage PE/ELF/Mach-O pur Rust (sections, entropie, empreintes) + extraction de chaînes + désassemblage x86 | 0 |
| `nie-pe` | Lecture/écriture byte-exacte du PE64 + découpage du fichier en unités de forge | 24 |
| `nie-asm` | Encodeur x86-64 dialecte MSVC — réassemble les corps depuis `forge/asm/*.s` | 23 |
| `nie-forge` | Boucle `split`/`lift`/`cc`/`build`/`verify`/`report`, mesure la part produite | 33 |
| `nie-re` | RTTI MSVC, indexation goblin/iced-x86, propagation de labels sur le call-graph | 73 |
| `nie-index` | Base de connaissance SQLite (`var/niers.sqlite`) | 4 |
| `nie-seed` | Import du savoir fusionné (index Ghidra, RTTI, formats iecode, hash→nom inagle) | 24 |
| `nie-queue` | Frontière BFS dédupliquée (redis), workers parallèles sur fonctions non résolues | 0 |
| `nie-dump` | Lecture/scan AOB d'un minidump Windows de `nie.exe` | 6 |
| `nie-trace` | RE en direct : lecture de la mémoire d'un `nie.exe` en cours d'exécution | 93 |

### `crates/engine/*` — le moteur (19)

| Crate | Rôle | Tests |
|---|---|---:|
| `nie-formats` | Parsers Level-5 (CPK, cfg.bin, G4*, CriLayla, Criware), `no_std`-friendly | 386 |
| `nie-data` | Modèles de données du jeu (skills, auras, chara_param, items, growth) | 1445 |
| `nie-core` | Logique reversée (ballon, IA tactique, FSM de match, gardien, stats, CRand) | 311 |
| `nie-geom` | Types géométriques POD partagés — source unique `Vec2`/`Vec3` | 9 |
| `nie-lua` | VM Lua 5.2 réelle (mlua, PUC-Rio 5.2.4 vendored) + analyse statique tree-sitter | 107 |
| `nie-camera` | Modèle et contrôleurs de caméra portés (`CCameraCtrl*`), codec G4CM, pilotage live | 33 |
| `nie-app` | Machine à états d'écran (`GameState`) + rendu abstrait (trait `Renderer`) | 17 |
| `nie-game` | Hôte GUI natif wgpu — rend les vrais assets | 24 |
| `nie-render3d` | Renderer 3D : charge un GLB réel et le rend en perspective | 17 |
| `nie-runtime` | Boucle intégrée monde + physique + rendu top-down → frames/MP4 | 6 |
| `nie-play` | Front headless/golden : rejoue `nie-app`, écrit PNG/MP4 déterministes | 0 |
| `nie-headless` | Front headless sans fenêtre, résumé JSON par format | 18 |
| `nie-save` | Déchiffrement, lecture et édition des saves (XOR clé CRC32) | 57 |
| `nie-explore` | Aperçu/description des entrées VFS par format | 41 |
| `nie-viola` | Modding Level-5 (dump/pack/merge/crypto Criware), périmètre outil « Viola » | 51 |
| `nie-ui` | Source unique typée des jetons de design du jeu (OKLCH, géométrie, mouvement) → CSS | 35 |
| `nie-aphrody` | Runtime typé du pet « Codex Aphrody v2 » (atlas RGBA, animations, directions) | 56 |
| `nie-ffi` | Frontière C-ABI — **seul natif chargé côté TS** | 13 |
| `nie-wasm` | Bindings WebAssembly du savoir vérifié | 32 |

### `crates/tools/*` — outillage (12)

| Crate | Rôle | Tests |
|---|---|---:|
| `nie-cli` | Binaire `niers` — la seule CLI utilisateur, pilote aussi la boucle RE et la frontière redis | 24 |
| `nie-mcp` | Binding MCP Rust natif (`rmcp`) des commandes partagées de `niers` | 7 |
| `nie-site` | Serveur HTTP nie (Axum 0.8) : le jeu wasm en `/`, bundle `nie-web`, `/api/v1`, VFS `/f` `/b`, proxy `nie-model-serve` | 275 |
| `nie-model-serve` | Serveur HTTP live d'assemblage GLB IEVR (corps+face+uniforme depuis CPK, cache disque) | 13 |
| `ievr-tools` | Binding historique d'outils IEVR ; son inspecteur PE est fourni par `aphrody-re` via ré-export compatible | 8 |
| `nie-computer-use` | Capture et inspection locale bornée des images utilisées par les workflows d'observation | 6 |
| `nie-steam` | Acquisition Steam native (download/dump de dépôts IEVR), remplace SteamKit2 | 35 |
| `nie-zukan` | Ingesteur de l'encyclopédie officielle Level-5 Inagle (JP/FR/EN) | 53 |
| `nie-wiki` | Exploration game-data IEVR depuis le miroir SQLite (personnages, skills, items, équipes) | 0 |
| `nie-editor` | Éditeur 3D NIE natif, viewport GPU partagé DirectX 12/Vulkan/OpenGL | 1 |
| `nie-bench` | Banc de mesure des hot paths Rust et des contrats de format | 2 |
| `nie-tasks` | Orchestration de jobs asynchrones annulables/pausables avec progression | 0 |

## Les ponts

| Pont | Sens | Point d'entrée |
|---|---|---|
| `packages/nie` | Rust → TS | `nie_ffi` via `bun:ffi` (préchargé par `bunfig.toml`) — **seul** natif chargé côté TS |
| `scripts/sync-gamedata.ts` | TS → Rust | `niers steam` puis `niers viola` |
| `packages/nie-bridge` | Rust ↔ TS | contrat WebSocket entre le serveur Rust `nie-mcp` et le client WebView Inacord |

`crates/archive/nie-rs` est du décompilé porté en Rust, hors workspace et compilé
par personne : matière de RE, pas un pont.

## Fusions interdites

Quatre duplications sont **volontaires**. Les collapser corrompt le byte-exact en silence, avec
des tests qui restent verts.

1. **`crc32` vs `crc32_nie`** — deux fonctions distinctes. `crc32` (complément final : noms
   `cfg.bin`, clés de fichier CPK, type-id ECS, CRC de save) ≠ `crc32_nie` (accumulateur brut
   sans complément : model-id CPK, lookup g4tx). Les fusionner corrompt silencieusement l'un des
   deux chemins.
2. **`g4sk::mat_mul`** reste scalaire local, jamais glam/FMA : il est validé golden sur fixtures
   réelles (skinning), un réordonnancement f32 casse le golden.
3. **`StatBlock` de `nie-wiki`** (2 segments f64) diverge volontairement de celui de `nie-core`
   (3 segments f32) : le miroir SQLite n'a pas le palier lv30.
4. **Conventions d'axe vertical opposées** — `nie-core` traite `y` comme hauteur, `nie-runtime`
   traite `z` comme hauteur. `nie-geom::Vec3` unifie le *type* mais **pas** la sémantique : chaque
   crate garde sa convention dans son code. Ne jamais convertir implicitement d'un système vers
   l'autre — la similarité de layout ne vaut pas équivalence sémantique. Idem `Vec2` :
   `g4mg::{u,v}` (UV) ≠ `{x,y}` (terrain).

## Contraintes de structure

- Bun ne charge **que** `nie_ffi` (Rust). C'est délibéré : `bunfig.toml` précharge `nie-plugin`,
  donc tout natif joint à cette chaîne ferait échouer n'importe quelle commande `bun` du dépôt dès
  qu'il n'est pas construit.
