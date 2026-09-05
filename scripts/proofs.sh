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
    out=$(timeout "$timeout_s" uv run "$f" 2>&1)
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
