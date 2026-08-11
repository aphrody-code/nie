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

# --- Monorepo polyglotte ------------------------------------------------------
# Quatre chaines sous une racine : Rust (crates/), C++ (src/, tout l'arbre),
# C# (csharp/, IECODE.sln), TypeScript/Bun (packages/ apps/). Aucune ne depend
# d'une autre pour compiler ; les ponts sont documentes dans PROVENANCE.md et
# docs/ARCHITECTURE-POLYGLOTTE.md.

# `cmake` n'est pas dans le PATH sur la machine de dev Windows : il vit dans les
# BuildTools 2022. Surchargeable : `just cmake_exe=/usr/bin/cmake cpp-build`.
vs_cmake  := "C:/Program Files (x86)/Microsoft Visual Studio/2022/BuildTools/Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe"
cmake_exe := env_var_or_default("CMAKE", if path_exists(vs_cmake) == "true" { vs_cmake } else { "cmake" })
# Sous Windows on vise le generateur « Visual Studio 17 2022 » (preset `msvc`) :
# les presets Ninja supposent ninja dans le PATH, ce que l'install BuildTools
# seule ne fournit pas. Ailleurs, presets Ninja habituels.
cmake_preset       := env_var_or_default("IECODE_PRESET", if os_family() == "windows" { "msvc" } else { "debug" })
cmake_build_preset := env_var_or_default("IECODE_BUILD_PRESET", if os_family() == "windows" { "msvc-debug" } else { "debug" })
vcpkg_root         := env_var_or_default("VCPKG_ROOT", "")
dotnet_cfg         := env_var_or_default("DOTNET_CONFIG", "Debug")

# --- C++ (toolkit iecode) -----------------------------------------------------
# Requiert vcpkg (VCPKG_ROOT) : ~15 find_package obligatoires (CLI11, fmt, spdlog,
# bgfx, assimp, directxtex, capstone, sol2, …). Sans lui, `configure` echoue au
# premier find_package — c'est l'environnement, pas le depot.

# Installe vcpkg dans var/vcpkg (hors arbre source, deja gitignore) et l'amorce.
# A lancer UNE fois ; les ~15 ports de vcpkg.json (bgfx, assimp, capstone,
# directxtex, sol2, httplib, …) se compilent ensuite au premier configure —
# comptez une bonne heure. NE PAS cloner dans third_party/ : ce dossier contient
# des sources vendorisees du depot, un clone rate y ferait des degats.
cpp-bootstrap:
    @if [ -n "{{vcpkg_root}}" ]; then echo "VCPKG_ROOT deja defini: {{vcpkg_root}}"; exit 0; fi; \
     mkdir -p var; \
     [ -d var/vcpkg ] || git clone --depth 1 https://github.com/microsoft/vcpkg var/vcpkg; \
     ( cd var/vcpkg && ( ./bootstrap-vcpkg.sh -disableMetrics || ./bootstrap-vcpkg.bat -disableMetrics ) ); \
     baseline=$(grep -o '"builtin-baseline": *"[0-9a-f]*"' vcpkg.json | grep -o '[0-9a-f]\{40\}'); \
     if [ -n "$baseline" ]; then \
       echo "fetch du baseline $baseline (le clone --depth 1 ne le contient pas)"; \
       git -C var/vcpkg fetch --depth 1 origin "$baseline"; \
     fi; \
     echo "Exporte VCPKG_ROOT=$PWD/var/vcpkg puis relance just cpp-configure"

# Configure la chaine CMake (preset `msvc` sous Windows, `debug` ailleurs).
cpp-configure:
    @if [ -z "{{vcpkg_root}}" ]; then echo "VCPKG_ROOT absent — lance just cpp-bootstrap (cf. PROVENANCE.md)" >&2; exit 1; fi
    "{{cmake_exe}}" --preset {{cmake_preset}}

# Compile le toolkit C++ (binaire `iecode`, libs, ffi).
cpp-build: cpp-configure
    "{{cmake_exe}}" --build --preset {{cmake_build_preset}}

# Suite GTest (828+ cas).
cpp-test: cpp-build
    ctest --preset {{cmake_build_preset}} --output-on-failure

# --- C# (IECODE.Core / IECODE.CLI) -------------------------------------------

cs-build:
    dotnet build IECODE.sln -c {{dotnet_cfg}} --nologo

cs-test:
    dotnet test IECODE.sln -c {{dotnet_cfg}} --nologo

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

# --- Agregats des quatre chaines ---------------------------------------------
# `-` : la recette continue si la chaine echoue (typiquement C++ sans vcpkg sur
# une machine de dev). Le detail de chaque echec reste lisible dans la sortie.

all-build:
    cargo build --workspace
    -just cs-build
    -just cpp-build
    -just ts-install

all-test:
    cargo test --workspace
    -just cs-test
    -just cpp-test
    -just ts-test

all-check: fmt-check clippy
    cargo test --workspace
    -just cs-test
    -just ts-check
    @echo "all-check=OK (C++ hors gate : requiert vcpkg)"
