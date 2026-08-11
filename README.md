# nie

![version](https://img.shields.io/badge/version-0.4.0-blue)
![rust](https://img.shields.io/badge/rust-nightly--2026--05--17-orange)

**Réécriture pixel-perfect d'*Inazuma Eleven: Victory Road* (moteur « Lives ») en Rust pur** —
headless, WebAssembly et GUI native, sans le binaire Windows ni le moteur propriétaire.

Le dépôt porte le nom de sa cible : `nie.exe`. Quatre implémentations y convergent (Rust, C++,
C#, TypeScript) — voir [`docs/ARCHITECTURE-POLYGLOTTE.md`](docs/ARCHITECTURE-POLYGLOTTE.md).
La CLI, elle, reste `niers` : `nie` seul désignerait le binaire du jeu.

🎮 **Jouable en navigateur** (100 % Rust → wasm, clavier/souris/manette) : **https://azalee.rosegriffon.fr/jeu**
📥 **Télécharger l'app desktop** (explorateur VFS + extension Blender) : **https://azalee.rosegriffon.fr/tools/niers**

---

## Aperçu

Un moteur de jeu **et** un IDE tout-en-un : reverse-engineering de `nie.exe`, réimplémentation
headless/wasm/native, outils de modding (textures, modèles, saves, lecture mémoire live). Créé par
Rose Griffon.

État détaillé et à jour : [`docs/PLAN.md`](docs/PLAN.md) (plan maître) ·
[`docs/ROADMAP-100.md`](docs/ROADMAP-100.md) (trajectoire pixel-perfect) ·
[`apps/nie-explorer/ROADMAP.md`](apps/nie-explorer/ROADMAP.md) (app desktop). Ce README indexe le
monorepo — pour l'état réel du projet, se référer à ces fichiers.

## Stack technique

| Domaine | Techno |
|---|---|
| Langage cœur | Rust (`nightly-2026-05-17`, edition 2024), workspace Cargo — 26 crates (25 compilées) |
| Rendu | `wgpu` 22 + `winit` (GUI native), `wasm-bindgen` (navigateur), rasterisation CPU (golden/headless) |
| Scripting jeu | `mlua` (VM Lua 5.2 vendored) — exécute les vrais `.lua.bin` du jeu |
| App desktop | Tauri v2 + React 19 (`nie-explorer`), IPC via `tauri-specta` |
| Outillage TS | Bun (workspace `apps/` + `packages/`), pas de Node/npm |
| Données | SQLite (miroir jeu + base RE `var/niers.sqlite`), Redis (file BFS RE) |
| Reverse-engineering | `goblin` + `iced-x86` (désassemblage pur-Rust), RTTI MSVC, Ghidra en appoint |
| Écosystème live | `azalee.rosegriffon.fr` (catalogue web + jeu wasm) via `cdn.rosegriffon.fr` |

## Structure du monorepo

Deux workspaces coexistent dans ce même dépôt :

- **Cargo** (racine `Cargo.toml`, `members = ["crates/*"]`) — le cœur Rust : jeu, formats, moteur RE, outillage.
- **Bun** (racine `package.json`, `workspaces: ["packages/*", "apps/*"]`) — bindings FFI, plugins de formats, CLI et app desktop TypeScript.

```
crates/    # crates Rust (jeu + données + moteur + RE + outils) — dont la CLI unique `niers`
src/       # arbre C++ iecode (jeu jouable, C décompilé, libs natives)
csharp/    # IECODE.Core / IECODE.CLI / tests (.NET 10)
apps/      # nie-explorer (app desktop Tauri), nie-mcp (serveur MCP)
packages/  # nie (FFI Rust + C++), nie-bridge, nie-catalog, nie-plugin, nie-util (Bun)
docs/      # plan maître, roadmap 100 %, architecture, design, inventaires
scripts/   # outillage RE (Ghidra/Python/uv), packaging, exports
var/       # base de connaissance RE (niers.sqlite), artefacts régénérables (gitignored)
data/      # copie locale des assets du jeu (gitignored)
```

### Crates (`crates/*`)

| Crate | Rôle |
|---|---|
| `nie-formats` | Parsers Criware/propriétaires (CPK/@UTF/CRILAYLA, g4tx/g4md/g4mg/g4sk/g4mt/g4pk, cfg.bin RDBN/T2B, audio ADX/HCA/ACB/AWB/USM, DXBC, PXCL, NAVM…), `no_std`-friendly. |
| `nie-data` | Modèles `no_std` des données de jeu (chara_param, skill, item, aura, passive, growth, exp, quêtes, conditions…). |
| `nie-core` | Logique de jeu reversée en Rust pur (FSM de match, ballon, IA tactique, gardien, stats, skills, auras). |
| `nie-geom` | Types géométriques POD partagés (Vec2/Vec3) + math scalaire. |
| `nie-app` | Cœur du jeu : machine à états (`GameState`) + rendu abstrait (`trait Renderer`). |
| `nie-runtime` | Boucle intégrée monde + physique + rendu top-down → frames/MP4, headless déterministe. |
| `nie-play` | Front-end headless/golden : `nie-app` via flow scripté → PNG/MP4 déterministes. |
| `nie-game` | Hôte GUI natif `wgpu`/`winit` — rend les vrais assets IEVR. |
| `nie-render3d` | Charge un GLB réel et le rend en perspective (rasterisation CPU z-buffer). |
| `nie-lua` | VM Lua 5.2 réelle — exécute les vrais scripts `.lua.bin` du jeu (menus/scènes). |
| `nie-save` | Déchiffrement/lecture/édition des saves IEVR (XOR position-based, clé CRC32). |
| `nie-headless` | Runner CLI headless : détecte un format et affiche un résumé JSON. |
| `nie-wasm` | Bindings `wasm-bindgen` : formats, stats/FSM, lookup skill/aura/item, exposés au navigateur. |

**Outils dérivés** : `nie-explore` (moteur d'aperçu VFS partagé CLI/desktop), `nie-model-serve`
(serveur HTTP live d'assemblage GLB), `nie-zukan` (ingesteur encyclopédie officielle du jeu),
`nie-wiki` (exploration game-data), `nie-steam` (acquisition Steam native), `nie-trace` (RE en
direct, lecture mémoire), `nie-ffi` (frontière C-ABI pour Bun).

**Échafaudage RE** : `nie-index` (base de connaissance sqlite), `nie-seed` (import du savoir
fusionné), `nie-re` (moteur RE : RTTI, `.pdata`, désassemblage), `nie-queue` (file BFS Redis),
`nie-cli` (binaire `niers`), `nie-engine` *(exclue du build, référence RE lecture seule)*.

### Apps & packages (Bun)

| Nom | Rôle |
|---|---|
| `nie-explorer` | App desktop Tauri v2 + React 19 — explorateur VFS (254 202 fichiers), éditeur Monaco, aperçus texture/audio/vidéo/3D, gestion de mods, save manager, onglets RE et Game Data. Détail : [`apps/nie-explorer/ROADMAP.md`](apps/nie-explorer/ROADMAP.md). |
| `nie` / `nie-catalog` / `nie-plugin` / `nie-util` | Bindings FFI (Rust `nie_ffi` + C++ `iecode_ffi`), catalogue SQLite du VFS, plugin d'import de formats, utilitaires Bun partagés. |

Le décodage en lot n'est plus une app Bun : c'est `niers decode <fichier|dossier>` (Rust direct,
parallélisé par rayon, même table de dispatch que la FFI).

## Build

### Rust

```
cargo build --workspace
cargo test --workspace
cargo clippy -p <crate> --lib --tests   # 0 warning exigé avant tout commit

niers seed --db var/niers.sqlite --json refs/iecode-re/research/nie-index.json --exe nie_eacpatched.exe
niers rebuild --db var/niers.sqlite --exe nie_eacpatched.exe   # refonde sur .pdata (vérité terrain)
niers coverage --db var/niers.sqlite
```

### Bun

```
bun install
bun test packages/nie
bun run --filter '*' typecheck
cargo build -p nie-ffi   # requis avant les tests FFI de packages/nie

bun run tauri dev        # depuis apps/nie-explorer — lance l'app desktop
```

## Données du jeu

`data/` contient les vraies copies locales (gitignored, jamais committées). Variable
d'environnement `NIE_GAME_DIR` pour pointer vers une install Steam. Détail : [`CLAUDE.md`](CLAUDE.md).

## Mises à jour

L'app desktop embarque `tauri-plugin-updater` (binaires signés minisign). Endpoints
(`apps/nie-explorer/src-tauri/tauri.conf.json`) : `azalee.rosegriffon.fr/tools/niers/latest.json`
(proxy dynamique des releases GitHub) puis, en repli, `releases/latest/download/latest.json`.

Publier une nouvelle version (bump + build signé + tag + GitHub Release, en une commande) :

```
TAURI_SIGNING_PRIVATE_KEY_PATH=~/.tauri/niers.key ./scripts/release-desktop.sh 0.5.0
```

La page de download et l'endpoint updater se mettent à jour tout seuls (azalee lit la dernière
release GitHub en direct, cache 1h) — aucun redéploiement azalee requis pour une release standard.
