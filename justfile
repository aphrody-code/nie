# justfile — orchestrateur de la stack RE niers.
# Requiert `just` (cargo install just). Toolchain nightly-2026-05-17 + mold (cf .cargo/config.toml).
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

# Liste les recettes (defaut).
default:
    @just --list

# --- Build -------------------------------------------------------------------

# Compile le binaire niers en release (mold + target-cpu=native).
build:
    cargo build --release -p nie-cli

# Compile tout le workspace.
build-all:
    cargo build --workspace

# Cible wasm (verifie la portabilite no_std des crates jeu).
build-wasm:
    cargo build -p nie-wasm --target wasm32-unknown-unknown --release

# --- Pipeline RE (idempotent : upserts DB) -----------------------------------

# 1) Ingestion index Ghidra + RTTI + formats iecode + hash→nom inagle.
re-seed: build
    @test -f "{{seed_json}}" || { echo "ABSENT: {{seed_json}}" >&2; exit 1; }
    @test -f "{{exe}}"       || { echo "ABSENT exe: {{exe}}" >&2; exit 1; }
    time {{bin}} seed --db {{db}} --json {{seed_json}} --exe {{exe}}

# 2) Refonde la carte sur .pdata (verite terrain), re-ancre, disasm, propage.
re-rebuild: build
    @test -f "{{db}}"  || { echo "ABSENT db: {{db}} — lance `just re-seed`" >&2; exit 1; }
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
