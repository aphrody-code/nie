#!/usr/bin/env bash
# Rejoue les preuves uemu et rend un compte MESURE : N ✓ / N ✗ / N ⧗.
#
# Une preuve (`scripts/validate_*.py`) émule sous Unicorn la fonction RÉELLE de nie.exe et
# compare le portage bit à bit ; elle sort en 1 dès qu'une comparaison tombe. C'est l'oracle
# du dépôt : ce que Rust ne sait pas produire seul. Mais une preuve qui ne rejoue jamais dérive
# en silence — c'est le « golden muet = faux vert » que ce dépôt proscrit ailleurs.
#
# Usage :
#   bash scripts/proofs.sh              # les 47
#   bash scripts/proofs.sh parabola     # celles dont le nom contient « parabola »
#   PREUVES_TIMEOUT=30 bash scripts/proofs.sh
#
# PIÈGE PAYÉ (2026-09-02) : ne jamais lire `$?` à travers un pipe. `uv run x.py | tail` rend le
# code de `tail`, donc 0, et toute preuve en échec passe pour verte. Capturer, PUIS lire $?.
set -u
cd "$(dirname "$0")/.." || exit 1

filtre=${1:-}
timeout_s=${PREUVES_TIMEOUT:-90}

ok=0
ko=0
to=0
echecs=()

for f in scripts/validate_*"$filtre"*.py; do
    [ -e "$f" ] || { echo "aucune preuve ne correspond à « $filtre »"; exit 1; }
    nom=$(basename "$f" .py)
    # Sur QUEL binaire cette preuve est-elle ancrée ? Deux builds coexistent sur cette machine
    # et leurs adresses ne coïncident pas :
    #
    #   nie.exe                                            33 918 464 o  b1fa04ea…  ← la CIBLE RE
    #   ~/.local/share/iecode/patched/nie.exe.patched      31 468 032 o  4c2b91fb…  ← build hérité
    #
    # Ce choix était IMPLICITE et il coûtait cher : tout ce qui n'était pas `validate_listview_*`
    # partait sur le build hérité, y compris une preuve écrite contre la cible. Le symptôme n'est
    # pas un écart de valeurs mais un TIMEOUT — l'adresse tombe sur d'autres octets, l'émulation
    # part en boucle — donc il se lit comme « preuve trop lente » et non comme « mauvais binaire ».
    # Mesuré le 2026-09-19 sur validate_g4_component_decode : 1,3 s ✓ sur la cible, ⧗ 60 s sur
    # l'hérité. Une preuve DÉCLARE donc désormais son ancrage, en tête de fichier :
    #
    #     # uemu-anchor: target     → nie.exe (la cible RE)
    #     # uemu-anchor: legacy     → le build hérité patché
    #
    # Sans déclaration, le comportement historique est conservé : les 49 preuves antérieures ont
    # été écrites contre l'hérité, les basculer en bloc serait un changement non mesuré.
    exe_env=""
    if [ -z "${NIE_EXE:-}" ]; then
        ancrage=$(grep -m1 -oE '^# uemu-anchor: *(target|legacy)' "$f" | awk '{print $3}')
        case "${ancrage:-}" in
            target) exe_env="NIE_EXE=nie.exe" ;;
            legacy) exe_env="NIE_EXE=/home/ubuntu/.local/share/iecode/patched/nie.exe.patched" ;;
            *)
                case "$nom" in
                    validate_listview_*)
                        exe_env="NIE_EXE=nie.exe"
                        ;;
                    *)
                        if [ -f "/home/ubuntu/.local/share/iecode/patched/nie.exe.patched" ]; then
                            exe_env="NIE_EXE=/home/ubuntu/.local/share/iecode/patched/nie.exe.patched"
                        fi
                        ;;
                esac
                ;;
        esac
    fi
    out=$(timeout "$timeout_s" env $exe_env uv run "$f" 2>&1)
    rc=$?
    case $rc in
        0)
            ok=$((ok + 1))
            printf '  ✓ %s\n' "$nom"
            ;;
        124)
            to=$((to + 1))
            echecs+=("$nom — timeout ${timeout_s}s")
            printf '  ⧗ %s — timeout %ss\n' "$nom" "$timeout_s"
            ;;
        *)
            ko=$((ko + 1))
            # Le motif dit POURQUOI : un UC_ERR_* est un problème d'oracle (mapping, instruction
            # non émulée), un écart de valeurs est un problème de portage. Ne pas les confondre.
            motif=$(printf '%s' "$out" \
                | grep -oE 'UC_ERR_[A-Z_]+|Invalid memory mapping|invalid instruction|ModuleNotFoundError|Traceback' \
                | head -1)
            echecs+=("$nom — ${motif:-exit=$rc}")
            printf '  ✗ %s — %s\n' "$nom" "${motif:-exit=$rc}"
            ;;
    esac
done

total=$((ok + ko + to))
echo
printf 'preuves uemu : %d ✓ / %d ✗ / %d ⧗   (sur %d)\n' "$ok" "$ko" "$to" "$total"

if [ ${#echecs[@]} -gt 0 ]; then
    echo
    echo "à reprendre :"
    printf '  %s\n' "${echecs[@]}"
    echo
    echo "un UC_ERR_* accuse l'oracle (adresse ou mapping périmé, instruction non émulée par le TCG),"
    echo "un écart de valeurs accuse le portage. Ne jamais « corriger » la preuve pour la faire passer."
fi

[ $((ko + to)) -eq 0 ]
