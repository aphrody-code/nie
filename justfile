# justfile — orchestrateur de la stack RE niers.
# Requiert `just` (cargo install just). Toolchain nightly-2026-05-17 (cf rust-toolchain.toml).
# Variables surchargeables : `just exe=/autre/nie.exe re-all`, ou via env NIERS_GAME_DIR.

set shell := ["bash", "-uc"]
set positional-arguments

# Cible RE (binaire PE), base KB, binaire niers.
game_dir := env_var_or_default("NIERS_GAME_DIR", "/home/ubuntu/.local/share/Steam/iecode/inazuma")
exe      := game_dir / "nie_eacpatched.exe"
db       := "var/niers.sqlite"
bin      := "target/release/niers"
seed_json := "refs/iecode-re/research/nie-index.json"
rounds   := "16"

# Atlas : index unique des surfaces RE (cf. docs/ATLAS.md).
atlas_db    := "var/nie-atlas.sqlite"
atlas_redis := env_var_or_default("NIERS_ATLAS_REDIS", "redis://127.0.0.1/4")

# Liste les recettes (defaut).
default:
    @just --list

# --- Build -------------------------------------------------------------------

# Compile le binaire niers en release. Ni mold ni target-cpu=native : .cargo/config.toml les
# écarte volontairement (un `native` change l'ordre des flottants et casse les goldens byte-exacts).
build:
    cargo build --release -p nie-cli

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

# Tests + golden adosses aux vrais fragments du jeu (local VPS uniquement).
test-real:
    cargo test -p nie-formats --features real-fixtures
    cargo test -p nie-save --features real-saves

# Gate qualite complet (= job CI).
check: fmt-check clippy test
    @echo "check=OK"

# --- TypeScript / Bun ---------------------------------------------------------
# `build:ffi` d'abord : bunfig.toml precharge nie-plugin, qui charge nie_ffi.dll.
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
verify:
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/verify-monorepo.ps1
