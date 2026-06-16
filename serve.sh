#!/usr/bin/env bash
# niers — sert les modèles GLB IEVR depuis le jeu Steam Windows (lu via /mnt/c)
exec "$HOME/niers/target/release/nie-model-serve" \
  --game-dir "/mnt/c/Program Files (x86)/Steam/steamapps/common/INAZUMA ELEVEN Victory Road" \
  --cache-dir "$HOME/niers/var/model-cache" \
  --port 8790 "$@"
