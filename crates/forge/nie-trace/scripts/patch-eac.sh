#!/usr/bin/env bash
# patch-eac.sh — rend l'échec d'init EOS EasyAntiCheat NON-FATAL pour le boot headless de niers.
#
# Le vrai jeu, lancé headless, échoue à `EOS_Platform_GetAntiCheatClientInterface` (renvoie NULL
# sans backend EAC) et affiche la modale fatale « ERROR CODE E-02000200 / Failed to load game
# files » (E-02000200 == décimal 2000200 == ErrorCode_Init_EasyAntiCheat — texte trompeur).
# Correctif chirurgical : NOP le `call` @ VA 0x14114ea02 (file offset 0x114DE02) vers le
# constructeur de modale fatale ; l'exécution retombe sur l'épilogue « EAC errors suppressed »
# du binaire lui-même. C'est de la RE single-player offline (jeu possédé) — aucun rapport avec
# l'anti-cheat serveur de l'online.
#
# Opère sur une COPIE dans le dossier du jeu (DLL voisines — Goldberg steam_api64, proxy EOSSDK
# — résolues). NE touche JAMAIS l'original. Vérifie les 5 octets avant d'écrire.
#
# Équivalent natif : `niers mem patch-eac --src <nie.exe> --dst <nie_eacpatched.exe>`
# (cf. nie_trace::patch_eac) — ce script reste utile sans build Rust.
#
# Usage: NIE_GAME_PATH=/chemin/du/jeu patch-eac.sh
#        -> crée <game>/nie_eacpatched.exe
set -euo pipefail
GAME="${NIE_GAME_PATH:-/home/ubuntu/.local/share/Steam/iecode/inazuma}"
SRC="$GAME/nie.exe"
DST="$GAME/nie_eacpatched.exe"
OFF=$((0x114DE02))
ORIG="e899b79aff"   # call 0x140afa1a0
NOP="9090909090"

[ -f "$SRC" ] || { echo "ERREUR: introuvable: $SRC (poser NIE_GAME_PATH)" >&2; exit 1; }
cp -f "$SRC" "$DST"
python3 - "$DST" "$OFF" "$ORIG" "$NOP" <<'PY'
import sys
dst, off, orig, nop = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4]
with open(dst, 'r+b') as f:
    f.seek(off); got = f.read(5).hex()
    if got != orig:
        sys.exit(f"ERREUR: octets @0x{off:X} = {got}, attendu {orig} — build différent, abandon.")
    f.seek(off); f.write(bytes.fromhex(nop))
    f.seek(off); new = f.read(5).hex()
print(f"OK  offset 0x{off:X}: {orig} -> {new}  ({dst})")
PY
echo "Lancer: NIE_GAME_PATH=\"$GAME\" bash $(dirname "$0")/boot-nie-direct.sh 0 \"$DST\""
