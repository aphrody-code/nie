# justfile — orchestrateur de la stack RE nie.
# Requiert `just` (cargo install just). Toolchain stable 1.98.1, pinned by rust-toolchain.toml.
# Variables surchargeables : `just exe=/autre/nie.exe re-all`, ou via env NIE_GAME_DIR.

set shell := ["bash", "-uc"]
set positional-arguments

# Cible RE (binaire PE), base KB, binaire nie.
game_dir := env_var_or_default("NIE_GAME_DIR", "/home/ubuntu/.local/share/Steam/iecode/inazuma")
exe      := game_dir / "nie_eacpatched.exe"
db       := "var/nie.sqlite"
bin      := "target/release/nie"
seed_json := "refs/iecode-re/research/nie-index.json"
rounds   := "16"

# Atlas : index unique des surfaces RE (cf. docs/ATLAS.md).
atlas_db    := "var/nie-atlas.sqlite"
atlas_redis := env_var_or_default("NIE_ATLAS_REDIS", "redis://127.0.0.1/4")

# Liste les recettes (defaut).
default:
    @just --list

# Transfer portable docs/scripts/deployment source with a SHA-256 manifest.
workspace-export output="var/transfers/latest":
    bun scripts/workspace-transfer.ts export --output {{output}}

workspace-import manifest root=".":
    bun scripts/workspace-transfer.ts import --manifest {{manifest}} --root {{root}} --dry-run

# --- Build -------------------------------------------------------------------

# Compile le binaire nie en release. Ni mold ni target-cpu=native : .cargo/config.toml les
# écarte volontairement (un `native` change l'ordre des flottants et casse les goldens byte-exacts).
build:
    cargo build --release -p nie-cli --bin nie

# Compile tout le workspace.
build-all:
    cargo build --workspace

# Cible wasm (verifie la portabilite no_std des crates jeu).
build-wasm:
    cargo build -p nie-wasm --target wasm32-unknown-unknown --release

# --- Forge : produire nie.exe -------------------------------------------------
# L'identite prime : `forge-build` echoue si le fichier produit n'est pas byte-identique.
# Reference = le nie.exe de l'utilisateur (hors depot, (c) LEVEL-5). Cf. docs/FORGE.md.

forge_exe := env_var_or_default("NIE_EXE", "nie.exe")
forge     := "target/release/nie-forge"

# Compile la forge.
forge-build-tool:
    cargo build --release -p nie-forge

# Decoupe le binaire de reference en unites (recouvrement total).
forge-split: forge-build-tool
    {{forge}} split --exe {{forge_exe}}

# Releve les corps regenerables vers la source assembleur du depot.
forge-lift: forge-build-tool
    {{forge}} lift --exe {{forge_exe}}

# Reconstruit dist/nie.exe depuis la source + le registre, et verifie l'identite.
forge-build: forge-build-tool
    {{forge}} build --exe {{forge_exe}}
    {{forge}} verify --reference {{forge_exe}} --got dist/nie.exe

# Part du binaire reellement produite par le depot.
forge-report: forge-build-tool
    {{forge}} report

# Compile les sources C de src/decomp/functions avec MSVC et enregistre les
# fonctions dont le codegen redonne EXACTEMENT les octets du jeu.
forge-cc: forge-build-tool
    {{forge}} cc --exe {{forge_exe}} --register

# Boucle complete : decoupe -> releve asm -> compile C -> reconstruit -> mesure.
forge: forge-split forge-lift forge-cc forge-build forge-report

# --- Pipeline RE (idempotent : upserts DB) -----------------------------------

# 1) Ingestion index Ghidra + RTTI + formats iecode + hash→nom inagle.
re-seed: build
    @test -f "{{seed_json}}" || { echo "ABSENT: {{seed_json}}" >&2; exit 1; }
    @test -f "{{exe}}"       || { echo "ABSENT exe: {{exe}}" >&2; exit 1; }
    time {{bin}} seed --db {{db}} --json {{seed_json}} --exe {{exe}}

# 2) Refonde la carte sur .pdata (verite terrain), re-ancre, disasm, propage.
re-rebuild: build
    @test -f "{{db}}"  || { echo "ABSENT db: {{db}} — lance 'just re-seed'" >&2; exit 1; }
    @test -f "{{exe}}" || { echo "ABSENT exe: {{exe}}" >&2; exit 1; }
    time {{bin}} rebuild --db {{db}} --exe {{exe}} --rounds {{rounds}}

# 3) Couverture honnete (1 ligne cle=val).
re-coverage: build
    {{bin}} coverage --db {{db}}

# Pipeline complet, fail-fast (abandon a la 1re erreur grace a set -e implicite par recette).
re-all: re-seed re-rebuild re-coverage
    @echo "pipeline-RE=OK db={{db}}"

# Verifie l'ordre/integrite sans muter la DB (pré-flight).
re-check: build
    @echo "exe={{exe}} db={{db}}"
    @test -f "{{exe}}" && echo "exe=present" || echo "exe=ABSENT"
    @test -f "{{db}}"  && echo "db=present"  || echo "db=ABSENT"
    @redis-cli -u redis://127.0.0.1/0 ping >/dev/null 2>&1 && echo "redis-db0=up" || echo "redis-db0=DOWN"
    @redis-cli -u redis://127.0.0.1/3 ping >/dev/null 2>&1 && echo "redis-db3=up" || echo "redis-db3=DOWN"

# Rapport de sante RE complet (couverture + KB + EXTERN + heartbeat).
health: build
    bash scripts/re-health.sh

# Rejoue les preuves uemu (scripts/validate_*.py) : N ✓ / N ✗ / N ⧗, sort en 1 si une tombe.
# `just preuves parabola` n'en rejoue qu'une famille ; PREUVES_TIMEOUT=30 raccourcit l'attente.
preuves motif="":
    bash scripts/proofs.sh {{motif}}

# --- Atlas : l'index unique des surfaces RE ------------------------------------
# Une seule base rassemble fichiers, crates, docs, digest de la KB, forge, binaires,
# outils, mesures et ecarts. Cf. docs/ATLAS.md.

# Construit (ou met a jour) l'index complet + le miroir redis db4.
atlas: build
    {{bin}} atlas build --db {{atlas_db}} --kb {{db}} --redis {{atlas_redis}}

# Une ligne d'etat mesuree.
atlas-status:
    {{bin}} atlas status --db {{atlas_db}}

# La route vers les 100 %, classee par travail restant x poids.
atlas-gaps limit="20":
    {{bin}} atlas gaps --db {{atlas_db}} --limit {{limit}}

# Cherche dans tout l'index d'un coup (docs, symboles, outils, fichiers, crates).
atlas-search motif:
    {{bin}} atlas search "{{motif}}" --db {{atlas_db}}

# Fichiers strictement identiques presents a plusieurs chemins.
atlas-dupes limit="20":
    {{bin}} atlas dupes --db {{atlas_db}} --limit {{limit}}

# Boucle autonome : mesure -> index -> classe -> agit -> re-mesure. `just atlas-loop 5` pour 5 ticks.
atlas-loop ticks="1":
    bash scripts/atlas-loop.sh --ticks {{ticks}}

# Boucle autonome sans action (mesure et index seuls).
atlas-watch:
    bash scripts/atlas-loop.sh --no-act

# Publie dans ~/.local/bin les binaires Rust + les CLI Bun, par liens symboliques (aucune copie).
# Refuse d'ecraser un executable etranger deja dans le PATH. `just installer --dry-run` pour voir.
installer *args:
    bash scripts/installer-binaires.sh {{args}}

# Verifie que les commandes du depot sont publiees et que le proprietaire Rust repond.
outils:
    bash scripts/data-pipeline.sh --verif-seule

# Chaine complete des donnees : outils Rust -> wiki -> 4 exports, via le PATH.
donnees:
    bash scripts/data-pipeline.sh

# --- Regen des artefacts var/ ------------------------------------------------

# Manifeste CRC32→chemin des modeles (.g4md/.g4mg) pour resoudre les uniformes.
regen-models: build
    {{bin}} uniform-map --game-dir {{game_dir}} --out var/model-crc-manifest.ndjson

# Manifeste d'en-tetes .g4tx (+ push redis db3 optionnel via `just regen-textures redis=true`).
regen-textures push="false": build
    {{bin}} textures --game-dir {{game_dir}} --manifest var/g4tx-manifest.ndjson {{ if push == "true" { "--redis --redis-url redis://127.0.0.1/3" } else { "" } }}

# Tout regenerer (var/ derive du jeu). NE touche PAS aux caches zukan/model-cache.
regen-var: regen-models regen-textures
    @echo "regen-var=OK"

# --- Qualite (= ce que la CI verifie) ----------------------------------------

fmt:
    cargo fmt --all

fmt-check:
    cargo fmt --all --check

clippy:
    cargo clippy --workspace --all-targets -- -D warnings

# Tests sans fixtures copyright (defaut CI). #[ignore] non lances.
test:
    cargo test --workspace

# Tests ultrarapides en parallèle avec cargo-nextest (2026 fast harness)
test-fast:
    cargo nextest run --workspace

# Tests + golden adosses aux vrais fragments du jeu (local VPS uniquement).
test-real:
    cargo test -p nie-formats --features real-fixtures
    cargo test -p nie-save --features real-saves

# Gate qualite complet (= job CI).
check: fmt-check clippy test
    @echo "check=OK"

# --- TypeScript / Bun ---------------------------------------------------------
# `build:ffi` d'abord : bunfig.toml precharge nie-plugin, qui charge iecode.dll.
# Sans la lib, TOUTE commande bun du depot echoue (cf. CLAUDE.md).

ts-install:
    bun install

ts-check: ts-install
    bun run build:ffi
    bun run typecheck
    bun run lint

ts-test: ts-install
    bun run build:ffi
    bun run test

# --- Agregats des chaines -----------------------------------------------------

all-build:
    cargo build --workspace
    -just ts-install

all-test:
    cargo test --workspace
    -just ts-test

all-check: fmt-check clippy
    cargo test --workspace
    -just ts-check
    @echo "all-check=OK"

# Full local readiness gate; fails at the first red check and prints each gate name.
# Le script est PowerShell et le VPS de production est Linux : appeler `powershell.exe`
# inconditionnellement faisait échouer la recette sur l'hôte où elle sert le plus. On prend le
# chemin PowerShell quand il existe, la porte cadrée sinon — elles vérifient la même chose.
verify:
    #!/usr/bin/env bash
    set -euo pipefail
    if command -v powershell.exe > /dev/null 2>&1; then
        powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/verify-monorepo.ps1
    else
        bun run scripts/surfaces.ts gate
        bun run typecheck:scripts
        bun run docs:check
    fi

# Déploiement concurrent de toutes les cibles par paliers ordonnés en parallèle
deploy-all:
    bun run deploy:target -- --all

# Audit complet du monorepo (dépendances, couches, inventaire, licences) hors du chemin critique
audit:
    bun run audit:monorepo

# --- Usine Autonome & IA / ML 2026 --------------------------------------------

# Lance la boucle d'exécution autonome en arrière-plan (Lead Agent + Auditeur Indépendant)
autopilot *args:
    bash scripts/autopilot.sh {{args}}

# Exécute un tick unique de l'usine autonome (mesure, implémente, vérifie, audite)
autopilot-tick:
    bash scripts/autopilot.sh --once

# Surveille la santé et la disponibilité du serveur d'assemblage 3D & textures ML/Game (port 8790)
model-serve-health:
    curl -fsS http://127.0.0.1:8790/health && echo "nie-model-serve: OK (port 8790)"

# Pré-chauffe le cache de modèles 3D (GLB / textures) pour éliminer les temps de latence
model-serve-prewarm:
    bash scripts/ops/model-serve-prewarm.sh

# --- Surfaces : construire, vérifier et publier UNE surface à la fois -----------------
# cli · mcp · site · desktop · model. Cf. CONTRIBUTING.md § « Shipping ».
# La porte reste UN seul job cadré sur l'union des surfaces touchées : un job par surface
# recompilerait chaque crate partagée une fois par lane (mesuré : 19 638 compilations contre
# 10 026 pour l'union, sur 400 commits).

# Les cinq surfaces et le nombre de crates dont chacune est construite.
surfaces:
    bun run scripts/surfaces.ts list

# Quelles surfaces le diff courant peut-il avoir cassées.
surfaces-plan base="origin/main":
    bun run scripts/surfaces.ts plan --base {{base}}

# La porte, cadrée : `just porte` sur le diff, `just porte site` sur une surface.
porte surface="":
    bun run scripts/surfaces.ts gate {{surface}}

# Construire puis vérifier l'artefact d'une surface.
surface-build surface:
    bun run scripts/surfaces.ts build {{surface}}
    bun run scripts/surfaces.ts smoke {{surface}}

# Les deux portes INTER-HÔTES : le même Rust compilé pour wasm32 et pour l'hôte doit rendre la
# même chose. Aucun test unitaire ne les remplace — ils ont déjà attrapé un module publié plus
# Le seul garde-fou qui demande si l'IMAGE est juste : les autres vérifient que deux
# implémentations s'accordent ou qu'une fonction reproduit des octets, et c'est ainsi que le texte
# des menus a pu sortir en kanji dans les quatre hôtes sans qu'aucune porte ne bronche.
# Référence PAR ÉCRAN dans `data/menu/screen-ssim-baseline.json` ; échoue sur une CHUTE, pas sur
# un absolu — le compositeur ne dessine ni personnages 3D ni fonds animés.
# Compare chaque écran composé à la capture réelle du jeu (SSIM), sur les 8 paires exactes.
ecrans:
    #!/usr/bin/env bash
    set -euo pipefail
    NIE_GAME_DIR="{{game_dir}}" ./target/release/nie-site --listen 127.0.0.1:18099 > /tmp/nie-site-ecrans.log 2>&1 &
    site=$!
    trap 'kill "$site" 2>/dev/null || true' EXIT
    sleep 25
    NIE_SITE_BASE=http://127.0.0.1:18099 bun --bun scripts/validation/gate-screens.ts

# vieux que son code, une comparaison qui rendait « différent » à chaque appel, et une
# régression 10/14 → 3/14. Démarre un `nie-site` LOCAL (jamais celui de production) et l'arrête.
cross-host ecrans="30":
    #!/usr/bin/env bash
    set -euo pipefail
    NIE_GAME_DIR="{{game_dir}}" ./target/release/nie-site --listen 127.0.0.1:18099 > /tmp/nie-site-cross-host.log 2>&1 &
    site=$!
    trap 'kill "$site" 2>/dev/null || true' EXIT
    sleep 25
    NIE_SITE_BASE=http://127.0.0.1:18099 bun --bun scripts/validation/compare-menu-layout.ts --sweep {{ecrans}}
    NIE_SITE_BASE=http://127.0.0.1:18099 NIE_DIFFERENTIAL_SKIP_MISSING=1 bun --bun crates/engine/nie-lua-web/scripts/differential.ts
