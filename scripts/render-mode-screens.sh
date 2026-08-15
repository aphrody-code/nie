#!/usr/bin/env bash
# Reconstruit en PNG les écrans d'un mode de jeu, pour la fiche `/mode/<slug>` d'azalée.
#
# Deux passes par écran, toutes deux assurées par `nie-game` :
#   1. `--from-setting --runtime --export-layout` : lit le layout STATIQUE de l'écran
#      (`<écran>_setting.cfg.bin` → calques → `.objbin` → `.g4tx`), puis exécute les VRAIS
#      scripts Lua du mode dans la VM Lua 5.2 réelle et applique au layout l'état qu'ils
#      produisent (visibilité, texture, texte). La position vient des points d'attache
#      déclarés par les écrans (`CMenuAttachLocator`, cf. `nie_formats::menu::attach_slots`).
#   2. `--compose-layout --capture` : compose le PNG 1280×720 depuis ce layout.
#
# Le JSON de layout est conservé à côté du PNG : la fiche azalée s'en sert pour classer les
# écrans par richesse de rendu (sprites réellement posés). Ne pas le supprimer « pour faire
# propre » — la galerie retomberait sur l'ordre alphabétique, qui met les écrans vides devant.
#
# Ce que ce rendu N'EST PAS : une capture vérifiée du jeu. Aucune référence pixel n'existe
# pour ces écrans ; ce qui ne déclare pas de point d'attache retombe au centre du canvas.
#
#   scripts/render-mode-screens.sh <slug>…      # un ou plusieurs modes
#   scripts/render-mode-screens.sh --tous       # les modes de data/modes.json qui ont des écrans
set -uo pipefail

RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RACINE"

JEU="${NIE_GAME:-target/release/nie-game}"
[ -x "$JEU" ] || { echo "binaire absent : $JEU — cargo build -p nie-game --release" >&2; exit 1; }
[ -f data/modes.json ] || { echo "data/modes.json absent — niers mode export -o data/modes.json" >&2; exit 1; }

# Les écrans d'un mode viennent du catalogue, jamais d'une liste recopiée ici : une liste en
# dur se périme au premier `niers mode index` et personne ne s'en aperçoit.
ecrans_du_mode() {
    python3 -c "
import json, sys
d = json.load(open('data/modes.json'))
for m in d['modes']:
    if m['slug'] == sys.argv[1]:
        for s in m['screens']:
            print(s['screen'])
" "$1"
}

modes_avec_ecrans() {
    python3 -c "
import json
d = json.load(open('data/modes.json'))
for m in d['modes']:
    if m['counts']['screens'] > 0:
        print(m['slug'])
"
}

if [ "${1:-}" = "--tous" ]; then
    mapfile -t MODES < <(modes_avec_ecrans)
else
    [ $# -ge 1 ] || { sed -n '2,20p' "$0"; exit 2; }
    MODES=("$@")
fi

total_ok=0 total_vide=0 total_ko=0
for slug in "${MODES[@]}"; do
    out="data/mode-tex/$slug/screens"
    mkdir -p "$out"
    echo "── $slug ──"
    while IFS= read -r ecran; do
        [ -n "$ecran" ] || continue
        layout="$out/$ecran.layout.json"
        png="$out/$ecran.png"
        if ! timeout 120 "$JEU" --menu "$ecran" --from-setting --runtime \
            --export-layout "$layout" >"$out/$ecran.export.log" 2>&1 || [ ! -s "$layout" ]; then
            echo "  ✗ $ecran — export-layout : $(tail -1 "$out/$ecran.export.log")"
            total_ko=$((total_ko + 1))
            continue
        fi
        if ! timeout 180 "$JEU" --compose-layout "$layout" --capture "$png" \
            >"$out/$ecran.compose.log" 2>&1; then
            echo "  ✗ $ecran — compose"
            total_ko=$((total_ko + 1))
            continue
        fi
        # Un écran dont aucun sprite ne se résout compose un PNG transparent. Ce n'est pas un
        # échec (le fichier est valide) mais ce n'est pas montrable : on le distingue, la fiche
        # azalée le compte sans l'afficher.
        n=$(grep -oE '^compose-layout : [0-9]+' "$out/$ecran.compose.log" | grep -oE '[0-9]+$')
        if [ "${n:-0}" -eq 0 ]; then
            echo "  ○ $ecran — aucun sprite résolu (PNG transparent)"
            total_vide=$((total_vide + 1))
        else
            echo "  ✓ $ecran — ${n} éléments"
            total_ok=$((total_ok + 1))
        fi
    done < <(ecrans_du_mode "$slug")
done

echo
echo "rendu : $total_ok écran(s) composé(s), $total_vide vide(s), $total_ko en échec"
