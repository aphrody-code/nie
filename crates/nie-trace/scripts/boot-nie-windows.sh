#!/usr/bin/env bash
# boot-nie-windows.sh — lance le VRAI nie.exe Windows natif (Steam) et prépare l'inspection
# mémoire depuis WSL via nie-mem.exe (ReadProcessMemory).
#
# Pourquoi pas le VPS/Wine : le jeu plante en headless lavapipe. Le build Windows natif tourne.
# WSL2 est une VM distincte → ses /proc ne voient PAS les process Windows → on lit via l'API
# Windows (nie-mem.exe, cross-compilé depuis WSL et lancé par l'interop).
#
# Conditions pour que la mémoire soit LISIBLE (RE single-player offline, jeu possédé) :
#   1. Steam doit tourner (DRM steam_api64) — sinon nie.exe quitte aussitôt.
#   2. Lancer nie.exe DIRECTEMENT (pas EACLauncher.exe) → driver EAC kernel non chargé →
#      ReadProcessMemory autorisé. EACLauncher = EAC actif = lectures bloquées.
#   3. Si nie.exe affiche la modale fatale d'init EAC et quitte, il faut le patch EAC — mais
#      l'offset iecode (0x114DE02) ne matche PAS ce build Steam (vérifié). Reverser l'offset de
#      la modale fatale sur CE nie.exe (xref de la chaîne "Failed to load game files" via
#      `nie-mem.exe scan wstr:"Failed to load game files"`), puis `nie-mem.exe patch-eac`.
#
# Usage: boot-nie-windows.sh        # lance, puis suit les instructions affichées
set -uo pipefail
GAME="${NIE_GAME_PATH:-/mnt/c/Program Files (x86)/Steam/steamapps/common/INAZUMA ELEVEN Victory Road}"
GAME_WIN="$(wslpath -w "$GAME" 2>/dev/null || echo "$GAME")"
EXE_NAME="${NIE_EXE:-nie.exe}"   # nie.exe, ou nie_eacpatched.exe si l'offset de ce build est patché

[ -f "$GAME/$EXE_NAME" ] || { echo "ERREUR: introuvable: $GAME/$EXE_NAME (poser NIE_GAME_PATH)" >&2; exit 1; }

if ! tasklist.exe 2>/dev/null | tr -d '\r' | grep -qiE "^steam"; then
  echo "ATTENTION: Steam ne tourne pas — le DRM fera quitter nie.exe. Lance Steam d'abord." >&2
fi

echo "Lancement direct (sans EACLauncher) : $GAME_WIN\\$EXE_NAME"
cmd.exe /c start "" /D "$GAME_WIN" "$GAME_WIN\\$EXE_NAME" 2>/dev/null

cat <<EOF

Lancé. Inspecter depuis WSL (cross-compiler une fois, puis interop) :
  cargo build -p nie-trace --bin nie-mem --target x86_64-pc-windows-gnu --release
  EXE=./target/x86_64-pc-windows-gnu/release/nie-mem.exe
  \$EXE find-pid nie.exe
  \$EXE base    --module nie.exe
  \$EXE maps    --module nie.exe
  \$EXE scan    wstr:"un texte du jeu" --all
  \$EXE read    nie.exe+0xF600CA -n 64
  \$EXE dump    --all -o ./memdump

Si "ERROR_ACCESS_DENIED" : EAC actif → lancé via EACLauncher ? relancer nie.exe DIRECTEMENT.
EOF
