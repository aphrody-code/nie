#!/usr/bin/env bash
# nie-wine-run.sh — lance un exe Windows dans le prefixe niers avec le Wine de Proton
# (wine-11.0 + DXVK + vkd3d-proton) en NATIF, sans pressure-vessel ni script `proton`.
#
# Complement de crates/forge/nie-trace/scripts/boot-nie-direct.sh : ce dernier passe par
# `python3 proton runinprefix`, qui exige les variables STEAM_COMPAT_* et ne survit pas a
# l'absence de client Steam. Ici on appelle le wine du Proton directement — le prefixe
# est le meme (~/.local/share/niers/runtime/proton-prefix/pfx).
#
# Le prefixe se prepare avec scripts/nie-wine-setup.sh (idempotent).
#
# Usage: scripts/nie-wine-run.sh <exe> [args...]
set -uo pipefail
GAME="${NIE_GAME_PATH:-$HOME/.local/share/Steam/iecode/inazuma}"
BASE="${NIE_RUNTIME_BASE:-$HOME/.local/share/niers/runtime}"
P="$GAME/files"

export WINEPREFIX="$BASE/proton-prefix/pfx"
export WINEARCH=win64
export LD_LIBRARY_PATH="$P/lib/x86_64-linux-gnu:$P/lib/i386-linux-gnu:${LD_LIBRARY_PATH:-}"
export WINEDEBUG="${WINEDEBUG:-fixme-all,err+module}"
export WINEESYNC=1 WINEFSYNC=1
export DISPLAY="${DISPLAY:-:99}"

# Rendu logiciel : ce VPS n'a pas de GPU, seul lavapipe (llvmpipe) expose Vulkan.
export VK_DRIVER_FILES=/usr/share/vulkan/icd.d/lvp_icd.json
export VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json
export DXVK_FILTER_DEVICE_NAME=llvmpipe
export MESA_VK_DEVICE_SELECT=llvmpipe
export DXVK_STATE_CACHE_PATH="$BASE/dxvk-cache"
export DXVK_LOG_PATH="$BASE/logs"
export DXVK_LOG_LEVEL="${DXVK_LOG_LEVEL:-info}"
export DXVK_ENABLE_NVAPI=0
export LP_NUM_THREADS="${LP_NUM_THREADS:-10}"

# DXVK natif (copie dans le prefixe), d3dcompiler builtin, NVAPI desactive.
export WINEDLLOVERRIDES="${WINEDLLOVERRIDES:-d3d11,dxgi,d3d10core,d3d9=n;nvapi64,nvapi=b;winemenubuilder.exe=d}"
export SteamAppId=2799860 SteamGameId=2799860

mkdir -p "$BASE/logs" "$BASE/dxvk-cache"
# CWD = repertoire du jeu : nie.exe charge data/ en relatif tres tot.
cd "$GAME"
exec "$P/bin/wine" "$@"
