#!/usr/bin/env bash
# nie-wine-setup.sh — prepare, de zero et de facon idempotente, le prefixe Wine qui fait tourner
# le VRAI nie.exe sur ce VPS sans GPU. Contrepartie de scripts/nie-wine-run.sh.
#
# Ce qui a ete etabli en le construisant (chaque point a coute un echec mesure) :
#
#  1. Le Wine a utiliser est celui du Proton livre AVEC le jeu (files/bin/wine, wine-11.0) :
#     il embarque DXVK et vkd3d-proton. Le wine 10.0 d'Ubuntu n'a ni l'un ni l'autre.
#     Il tourne en NATIF, sans pressure-vessel : `ldd files/bin/wine` ne manque rien.
#
#  2. Le prefixe doit etre une copie DEREFERENCEE de files/share/default_pfx (`cp -aL`).
#     Un `wineboot` sur un dossier vide donne un prefixe sans libvkd3d-{1,shader-1,utils-1}.dll,
#     et l'import de d3dcompiler_47 (qui depend de wined3d, qui depend de vkd3d) echoue :
#     « Library D3DCOMPILER_47.dll not found » -> le jeu ne demarre pas du tout.
#     `cp -a` sans -L ne suffit pas : default_pfx est un arbre de liens symboliques RELATIFS
#     vers files/lib/wine, qui pendent des qu'on le copie ailleurs.
#
#  3. default_pfx n'a pas de dosdevices : sans c: et z:, wine ne trouve pas kernel32.dll.
#
#  4. Xvfb rapporte un taux de rafraichissement NUL (xrandr : 0.00Hz, dotclock 0). DXVK divise
#     par ce taux -> « Unhandled division by zero » dans dxgi, avant la premiere image.
#     Le contournement est le bureau virtuel Wine (`explorer /desktop=nie,LxH`), qui fournit
#     son propre mode d'affichage. Xvfb n'accepte pas `xrandr --newmode`.
#
#  5. Un gestionnaire de fenetres est OBLIGATOIRE sur le display : sans lui le jeu cesse de
#     recevoir les evenements de souris apres quelques secondes. openbox suffit.
#
#  6. Le rendu passe par lavapipe (llvmpipe) : ce VPS n'expose aucun GPU. Le jeu tourne, mais
#     a quelques images par seconde -- cf. le piege d'entree dans scripts/nie-wine-run.sh.
set -euo pipefail
GAME="${NIE_GAME_PATH:-$HOME/.local/share/Steam/iecode/inazuma}"
BASE="${NIE_RUNTIME_BASE:-$HOME/.local/share/niers/runtime}"
P="$GAME/files"
PFX="$BASE/proton-prefix/pfx"
DISP="${NIE_DISPLAY:-:99}"
RES="${NIE_RES:-1920x1080}"

[ -x "$P/bin/wine" ] || { echo "wine de Proton introuvable: $P/bin/wine" >&2; exit 1; }
mkdir -p "$BASE/logs" "$BASE/dxvk-cache"

if [ ! -f "$PFX/drive_c/windows/system32/libvkd3d-1.dll" ]; then
  echo "[1/5] prefixe depuis default_pfx (copie derefencee)"
  rm -rf "$PFX"; mkdir -p "$(dirname "$PFX")"
  cp -aL "$P/share/default_pfx" "$PFX"
else
  echo "[1/5] prefixe deja en place"
fi

echo "[2/5] dosdevices"
mkdir -p "$PFX/dosdevices"
ln -sfn ../drive_c "$PFX/dosdevices/c:"
ln -sfn / "$PFX/dosdevices/z:"

echo "[3/5] DXVK + vkd3d-proton"
for d in d3d11 dxgi d3d10core d3d9; do
  cp -f "$P/lib/wine/dxvk/x86_64-windows/$d.dll" "$PFX/drive_c/windows/system32/$d.dll"
  cp -f "$P/lib/wine/dxvk/i386-windows/$d.dll"   "$PFX/drive_c/windows/syswow64/$d.dll"
done
cp -f "$P/lib/wine/vkd3d-proton/x86_64-windows/"*.dll "$PFX/drive_c/windows/system32/"

echo "[4/5] wineboot"
WINEPREFIX="$PFX" WINEARCH=win64 WINEDEBUG=-all DISPLAY="$DISP" \
  LD_LIBRARY_PATH="$P/lib/x86_64-linux-gnu:$P/lib/i386-linux-gnu:${LD_LIBRARY_PATH:-}" \
  "$P/bin/wine" wineboot -u >/dev/null 2>&1 || true

echo "[5/5] display $DISP ($RES) + gestionnaire de fenetres"
if ! DISPLAY="$DISP" xdpyinfo >/dev/null 2>&1; then
  Xvfb "$DISP" -screen 0 "${RES}x24" -nolisten tcp >/dev/null 2>&1 &
  sleep 2
fi
if ! DISPLAY="$DISP" xprop -root _NET_SUPPORTING_WM_CHECK 2>/dev/null | grep -q 'window id'; then
  DISPLAY="$DISP" openbox >/dev/null 2>&1 &
  sleep 2
fi

echo "OK. Lancer le jeu :"
echo "  scripts/nie-wine-run.sh explorer /desktop=nie,$RES ./nie_eacpatched.exe"
