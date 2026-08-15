#!/usr/bin/env bash
# MAJ en place de l'install IEVR depuis Steam (depot 2799861), via nie-steam.
#
# Sépare l'auth (courte, consomme le code Steam Guard une seule fois) du
# téléchargement (long, token-only, relançable sans Guard). Le refresh token
# est mis en cache dans ~/.local/share/niers/steam-tokens.json au 1er login.
#
# Secrets attendus dans l'environnement (jamais écrits sur disque par ce script) :
#   STEAM_USER        (requis)
#   STEAM_PASSWORD    (requis au 1er login ; ignoré si token en cache)
#   STEAM_GUARD_CODE  (code 2FA frais ; requis au 1er login uniquement)
#
# Usage :
#   STEAM_USER=... STEAM_PASSWORD=... STEAM_GUARD_CODE=... scripts/steam-update.sh
set -euo pipefail

REPO=/home/ubuntu/niers
BIN="$REPO/target/release/nie-steam"
DEST=/home/ubuntu/.local/share/Steam/iecode/inazuma
LOG=/home/ubuntu/steam-update-$(date +%Y%m%d-%H%M%S).log
APPID=2799860
# Depot de CONTENU du jeu. Les depots redistribuables Steamworks (228989/228990/
# 229000/229007 — DirectX, runtime VC++) sont volontairement exclus : ils ne
# servent pas ici, et leur manifest fait échouer le download sur
# « Is a directory (os error 21) » (entrée taille 0 sans chunk dont le chemin
# local est déjà un répertoire) — ce qui avortait TOUTE la synchro.
DEPOT=2799861

[[ -x "$BIN" ]] || { echo "erreur: $BIN absent (cargo build --release -p nie-steam)"; exit 1; }
[[ -d "$DEST" ]] || { echo "erreur: dossier install $DEST absent"; exit 1; }
: "${STEAM_USER:?export STEAM_USER=<compte Steam possedant IEVR>}"

echo "== 1/2 auth =="
# Login réel : établit le refresh token en cache. Rapide. Consomme le Guard.
# 'list' n'écrit rien sur disque, sert juste à authentifier + valider l'accès depot.
if "$BIN" -u "$STEAM_USER" --depot "$DEPOT" list "$APPID"; then
  echo "auth ok — token mis en cache"
else
  echo "erreur: auth/list a échoué (identifiants ? Guard expiré ? accès depot ?)"
  exit 1
fi

echo "== 2/2 sync (background) =="
# Token-only désormais : plus besoin de Guard. verify=on → saute les fichiers
# déjà à jour (MAJ delta au niveau fichier), écrit en place, atomique.
nohup "$BIN" -u "$STEAM_USER" --depot "$DEPOT" sync -o "$DEST" > "$LOG" 2>&1 &
PID=$!
echo "pid=$PID log=$LOG"
echo "surveille: tail -f $LOG   |   df -BG $DEST"
