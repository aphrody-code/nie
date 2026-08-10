#!/usr/bin/env bash
# Post-traitement après une MAJ Steam en place de l'install IEVR.
#
# Le download Steam a réécrit les fichiers du manifest par-dessus l'install :
#   - nie.exe (nouveau build)                → nie_eacpatched.exe à re-dériver
#   - steam_api64.dll → vraie DLL Valve      → émulation gbe_fork à restaurer
#   - EOSSDK-Win64-Shipping.dll → vrai SDK   → proxy EOS à restaurer
# Ce script restaure l'émulation, re-dérive le patch EAC, et rapporte l'état
# de la base RE (qui reste ancrée sur l'ANCIEN binaire tant que non régénérée).
set -euo pipefail

GAME=/home/ubuntu/.local/share/Steam/iecode/inazuma
BK=/home/ubuntu/ievr-backup-manifest-1147708054852059036
REPO=/home/ubuntu/niers

echo "== identité du binaire =="
new_sha=$(sha256sum "$GAME/nie.exe" | cut -d' ' -f1)
old_sha=$(sha256sum "$BK/nie.exe"  | cut -d' ' -f1)
echo "nie.exe ancien = $old_sha"
echo "nie.exe courant = $new_sha"
if [[ "$new_sha" == "$old_sha" ]]; then
  echo "→ binaire INCHANGÉ (MAJ content-only) : base RE toujours valide."
else
  echo "→ binaire CHANGÉ : base RE (niers.sqlite, ancres VA) à régénérer/re-ancrer."
fi

echo "== restauration émulation Steam/EOS (écrasée par le download) =="
# Le download a remis les vraies DLL Valve/Epic sous les noms du manifest.
# On remet l'émulation gbe_fork + proxy EOS (irrécupérables hors sauvegarde).
for f in steam_api64.dll EOSSDK-Win64-Shipping.dll; do
  cp -f "$BK/$f" "$GAME/$f"
  echo "restauré émulation: $f ($(stat -c%s "$GAME/$f") o)"
done
# Fichiers annexes de chaînage EOS (absents du manifest, mais on garantit leur présence).
for f in EOSSDK_o.dll EOSSDK-Win64-Shipping.dll.orig steam_api64.dll.orig steam_appid.txt; do
  [[ -f "$GAME/$f" ]] || { cp -f "$BK/$f" "$GAME/$f"; echo "restauré annexe: $f"; }
done
[[ -d "$GAME/steam_settings" ]] || { cp -rf "$BK/steam_settings" "$GAME/"; echo "restauré: steam_settings/"; }

echo "== re-dérivation nie_eacpatched.exe =="
if NIE_GAME_PATH="$GAME" bash "$REPO/crates/forge/nie-trace/scripts/patch-eac.sh"; then
  echo "→ patch EAC re-appliqué (signature 5 octets inchangée dans le nouveau build)."
else
  echo "→ ÉCHEC patch EAC : la signature a bougé dans le nouveau build."
  echo "   Re-localiser le call de la modale fatale EOS/EAC et mettre à jour"
  echo "   EAC_PATCH_OFFSET/ORIG dans crates/forge/nie-trace/src/lib.rs puis patch-eac.sh."
fi

echo
echo "== RESTE À FAIRE (manuel, si binaire changé) =="
echo " • Base RE : bash $REPO/scripts/regen-var.sh --kb   (seed+rebuild sur le nouvel exe, long)"
echo " • Oracle byte-exact : re-ancrer les ~85 VA de scripts/uemu.py + validate_re.py"
echo " • Constantes gelées à re-vérifier : clé AES CPK (nie-formats/src/cpk.rs:284), patch EAC"
echo " • Artefacts CPK (si contenu changé) : niers textures (model-crc-manifest), index redis"
echo " • Sauvegarde ancien build conservée : $BK"
