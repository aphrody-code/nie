#!/usr/bin/env bash
# regen-var.sh — regenere les artefacts var/ derives du jeu/exe.
# Idempotent (upserts DB / reecriture manifestes). Voir var/README.md pour l'inventaire.
# Usage : bash scripts/regen-var.sh [--kb] [--models] [--textures] [--all]
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1

GAME_DIR="${NIERS_GAME_DIR:-/home/ubuntu/.local/share/Steam/iecode/inazuma}"
EXE="$GAME_DIR/nie_eacpatched.exe"
DB="var/niers.sqlite"
BIN="target/release/niers"
SEED_JSON="refs/iecode-re/research/nie-index.json"

step(){ printf '\n>>> %s\n' "$1"; }
[ -x "$BIN" ] || { echo 'niers absent — cargo build --release -p nie-cli'; exit 1; }
[ -f "$EXE" ] || { echo "exe absent: $EXE"; exit 1; }

do_kb=false; do_models=false; do_textures=false
for a in "${@:-}"; do
  case "$a" in
    --kb) do_kb=true;; --models) do_models=true;; --textures) do_textures=true;;
    --all) do_kb=true; do_models=true; do_textures=true;;
    "") ;; *) echo "option inconnue: $a"; exit 2;;
  esac
done
# Defaut : tout.
if ! $do_kb && ! $do_models && ! $do_textures; then do_kb=true; do_models=true; do_textures=true; fi

if $do_kb; then
  step "KB sqlite ($DB) — seed + rebuild (verite terrain .pdata)"
  time "$BIN" seed --db "$DB" --json "$SEED_JSON" --exe "$EXE"
  time "$BIN" rebuild --db "$DB" --exe "$EXE" --rounds 16
  "$BIN" coverage --db "$DB"
fi

if $do_models; then
  step "Manifeste modeles (var/model-crc-manifest.ndjson)"
  time "$BIN" uniform-map --game-dir "$GAME_DIR" --out var/model-crc-manifest.ndjson
  wc -l var/model-crc-manifest.ndjson
fi

if $do_textures; then
  step "Manifeste textures g4tx (var/g4tx-manifest.ndjson) + push redis db3"
  time "$BIN" textures --game-dir "$GAME_DIR" --manifest var/g4tx-manifest.ndjson --redis --redis-url redis://127.0.0.1/3
  wc -l var/g4tx-manifest.ndjson
fi

echo; echo 'regen-var=OK'
