#!/usr/bin/env bash
# Bundle la police réelle du jeu (gzippée) pour le jeu web `/jeu` (azalee).
#
# L'atlas g4tx est un 4096×2048 RGBA8 NON compressé (44 Mo) → fetch CDN flaky ("Failed to fetch").
# On le sert gzippé SAME-ORIGIN depuis azalee (5,75 Mo, fiable + caché ; gunzip client via
# DecompressionStream dans lib/nie-game.ts).
#
# Asset Level-5 → DESTINATION GITIGNORÉE (jamais committée). Relancer si la police change.
set -euo pipefail

SERVE="${NIE_SERVE:-http://127.0.0.1:8790}"
AZALEE="${AZALEE_DIR:-$HOME/rg/apps/azalee}"
DEST="$AZALEE/public/assets/font"
mkdir -p "$DEST"

curl -fsS "$SERVE/raw/common/font/font/font_def/font.cfg.bin" | gzip -9 >"$DEST/font.cfg.bin.gz"
curl -fsS "$SERVE/raw/dx11/font/font_def/font.g4tx" | gzip -9 >"$DEST/font.g4tx.gz"

echo "OK — police web gzippée :"
ls -lh "$DEST"/*.gz | awk '{print "  " $5, $9}'
