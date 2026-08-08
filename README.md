# niers

**Réécriture intégrale d'*Inazuma Eleven: Victory Road* (IEVR, moteur Level-5 « Lives ») en Rust pur —
jouable en headless + WebAssembly + GUI native, sans le binaire Windows ni le moteur propriétaire.**

Le jeu tourne déjà **en navigateur** (`https://azalee.rosegriffon.fr/jeu`, 100 % Rust→wasm, interactif :
clavier/souris/manette). Ce dépôt contient aussi les outils de dev de mods, d'édition de textures/modèles,
de lecture mémoire et de conversion de fichiers — un véritable moteur de jeu + IDE tout-en-un, créé par
Rose Griffon en accord avec LEVEL-5 (`LICENSE` = Accord Commercial Officiel d'Exploitation
N° RG-L5-VR-2026-001).

État détaillé et à jour : `docs/PLAN.md` (plan maître, FAIT/INCOMPLET/NON_FAIT par pilier) +
`docs/ROADMAP-100.md` (trajectoire pixel-perfect) + `apps/nie-explorer/ROADMAP.md` (app desktop).
Ce README ne fait qu'indexer le monorepo — pour l'état réel, se référer à ces fichiers.

## Structure du monorepo

Deux workspaces coexistent dans ce même dépôt :

- **Workspace Cargo** (racine `Cargo.toml`, `members = ["crates/*"]`) — le cœur Rust : jeu, formats,
  moteur RE, outillage. 26 crates, 25 compilées (`nie-engine` exclue, gardée en référence RE lecture
  seule, cf. `docs/PLAN.md` §3quinquies).
- **Workspace Bun** (racine `package.json`, `workspaces: ["packages/*", "apps/*"]`) — bindings FFI,
  plugins d'import de formats, CLI et app desktop côté TypeScript/Bun.

```
crates/    # 26 crates Rust (jeu + données + moteur + RE + outils)
apps/      # nie-decode (CLI TS), nie-explorer (app desktop Tauri)
packages/  # nie, nie-catalog, nie-plugin, nie-util (Bun)
docs/      # plan maître, roadmap 100%, architecture, design, inventaires
scripts/   # outillage RE (Ghidra/Python/uv), packaging, exports
var/       # base de connaissance RE (niers.sqlite), artefacts régénérables (gitignored)
data/      # copie locale des assets du jeu (© Level-5, gitignored)
```

## Crates (`crates/*`)

### Le jeu (la fin)

| Crate | Rôle |
|---|---|
| `nie-formats` | Parsers Level-5/Criware (CPK/@UTF/CRILAYLA, g4tx/g4md/g4mg/g4sk/g4mt/g4pk, cfg.bin RDBN/T2B, audio ADX/HCA/ACB/AWB/USM, DXBC, PXCL, NAVM…), `no_std`-friendly. |
| `nie-data` | Modèles `no_std` des données de jeu (port inagle : chara_param, skill, item, aura, passive, growth, exp, quêtes, conditions…). |
| `nie-core` | Logique de jeu reversée en Rust pur (FSM de match, ballon, IA tactique, gardien, stats, skills, auras). |
| `nie-geom` | Types géométriques POD partagés (Vec2/Vec3) + math scalaire — source unique du workspace. |
| `nie-app` | Cœur du jeu : machine à états (`GameState`) + rendu abstrait (`trait Renderer`), câble match/dialogues/police/perso 3D. Front-ends : `nie-play` et `nie-game`. |
| `nie-runtime` | Boucle intégrée monde + physique + rendu top-down → frames/MP4, headless déterministe. |
| `nie-play` | Front-end headless/golden : exécute `nie-app` via un flow scripté + Renderer CPU → PNG/MP4 déterministes. |
| `nie-game` | Hôte GUI natif wgpu 22 + winit — rend les vrais assets IEVR (pilier D1/C4 pixel-perfect). |
| `nie-render3d` | Charge un GLB réel et le rend en perspective (rasterisation CPU z-buffer + éclairage) → PNG/MP4 turntable. |
| `nie-lua` | VM Lua 5.2 réelle (mlua vendored) — exécute les vrais scripts `.lua.bin` du jeu (menus/scènes). |
| `nie-save` | Déchiffrement/lecture/édition des saves IEVR (XOR position-based, clé CRC32). |
| `nie-headless` | Runner CLI headless : détecte un format et affiche un résumé JSON. |
| `nie-wasm` | Bindings `wasm-bindgen` : formats, stats/FSM, lookup skill/aura/item, exposés au navigateur. |

### Outils dérivés du jeu (RE au service de mods/exploration)

| Crate | Rôle |
|---|---|
| `nie-explore` | Moteur partagé d'aperçu/description des entrées VFS par format — utilisé par `niers vfs cat` (`nie-cli`) **et** l'app desktop `nie-explorer` (Tauri), une seule source pour les deux façades. |
| `nie-model-serve` | Serveur HTTP live d'assemblage GLB (corps+face+uniforme depuis CPK, cache disque) — sert `cdn.rosegriffon.fr/model-full/`. |
| `nie-zukan` | Ingesteur de l'encyclopédie officielle Level-5 (zukan.inazuma.jp), 3 langues, croisement avec le miroir inagle. |
| `nie-wiki` | Exploration game-data (personnages/skills/items/équipes) depuis le miroir SQLite. |
| `nie-steam` | Acquisition Steam native (download/dump des depots IEVR) sur `steamroom`, port du `Steam/` C# d'iecode. |
| `nie-trace` | RE en direct (runtime) : lecture mémoire d'un `nie.exe` en cours d'exécution (`process_vm_readv`/`ReadProcessMemory`), résolution de module, dump, scan. |
| `nie-ffi` | Frontière FFI C-ABI : expose CRC32/CRand MT19937/décodage formats/VFS à Bun et autres runtimes. |

### L'échafaudage RE (le moyen)

| Crate | Rôle |
|---|---|
| `nie-index` | Base de connaissance sqlite (`var/niers.sqlite`) : savoir fusionné iecode/inagle + RE de `nie.exe`. |
| `nie-seed` | Import du savoir fusionné (index Ghidra, RTTI, formats iecode, hash→nom inagle) comme ancres. |
| `nie-re` | Moteur RE : RTTI MSVC, refondation `.pdata`, désassemblage iced-x86, propagation de labels auto-ML. Inclut `nie-re::dump` (lecture de minidumps, scan AOB). |
| `nie-queue` | Frontière BFS dédupliquée (Redis) : workers parallèles sur les fonctions non résolues. |
| `nie-cli` | Binaire `niers` : pilote seed/rtti/rebuild/disasm/propagate/coverage/queue/textures/vfs/save/wiki/steam. |
| `nie-engine` *(exclue du build)* | Portage RE des sous-systèmes moteur (render/animation/audio/physics/menu/network/scripting) — conservée en lecture seule comme carte RE, décommissionnée comme runtime (dédup Phase 0, cf. `docs/DEDUP-PLAN.md`). |

## Apps (`apps/*`, Bun workspace)

| App | Rôle |
|---|---|
| `nie-explorer` | **App desktop Tauri v2 + React 19** — explorateur VFS complet (254 202 fichiers), éditeur Monaco (T2B/RDBN éditables+réencodables), aperçus texture/audio/vidéo/3D, gestion de mods (export `.cpk` réel), save manager Steam Cloud, onglet RE (labels/RTTI/xrefs), onglet Game Data (stats/techniques/objets/succès/quêtes), recherche perso/technique, palette de commandes. 57 commandes Rust IPC via `tauri-specta`. Détail exhaustif : `apps/nie-explorer/ROADMAP.md`. |
| `nie-decode` | CLI TS (`bun run`) : décode un fichier, un dossier ou tous les scripts Lua vers `.png`/`.json`. |

## Packages (`packages/*`, Bun workspace)

| Package | Rôle |
|---|---|
| `nie` | Bindings FFI Bun pour `libnie_ffi` — CRC32, MT19937, detect/decode/g4tx/vfs. |
| `nie-catalog` | Catalogue SQLite du VFS IEVR — index des ~250k assets via `bun:sqlite`, requêtes byExt/search/stats. |
| `nie-plugin` | Plugin Bun — importe les formats de jeu IEVR (`.g4tx`/`.cfg.bin`/`.objbin`/`.g4pkm`/`.lip`/`.mev`/`.g4md`) et expose `nie:re/*` (artefacts RE + Lua décompilé). |
| `nie-util` | Utilitaires partagés sur APIs natives Bun : compression, largeur textuelle, formatage, semver, `readConfig`. |

## Build

### Rust (workspace principal)

Toolchain : `nightly-2026-05-17` (wasm via la même toolchain, seule avec la std `wasm32`).

```
cargo build --workspace
cargo test --workspace
cargo clippy -p <crate> --lib --tests   # 0 warning exigé avant tout commit

niers seed --db var/niers.sqlite --json refs/iecode-re/research/nie-index.json --exe nie_eacpatched.exe
niers rebuild --db var/niers.sqlite --exe nie_eacpatched.exe   # refonde sur .pdata (vérité terrain)
niers coverage --db var/niers.sqlite
```

### Bun (apps/ + packages/)

Toujours `bun`/`uv run` — jamais `npm`/`python` directement (cf. `CLAUDE.md`).

```
bun install
bun test packages/nie apps/nie-decode
bun run --filter '*' typecheck
cargo build -p nie-ffi   # requis avant les tests FFI de packages/nie
```

L'app desktop (`apps/nie-explorer`) se lance avec `bun run tauri dev` depuis son dossier.

## Données du jeu

`data/` contient les vraies copies locales (© Level-5, gitignored, jamais committées). Variable
d'environnement `NIE_GAME_DIR` pour pointer vers une install Steam. Détail : `CLAUDE.md`.

## Licence

Projet réalisé dans le cadre de l'**Accord Commercial Officiel d'Exploitation N° RG-L5-VR-2026-001**
du 8 août 2026 entre Rose Griffon (Level 5 France) et LEVEL-5 Inc. — droits exclusifs de
reverse-engineering, développement de mods, portage et outils associés explicitement concédés.
Cf. `LICENSE` et `public/ACCORD_COMMERCIAL_RG-L5-VR-2026-001.pdf`.
