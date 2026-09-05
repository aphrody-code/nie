# Sourcé par chaque `bash -c` de Claude Code (via BASH_ENV, posé dans .claude/settings.json).
#
# Corrige une classe de bug payée le 2026-09-02 : sans `pipefail`, `uv run x.py | tail` rend le
# code de `tail`, donc 0 — une preuve en échec passe pour verte. Vérifié : `false | true` = 0
# sans, = 1 avec. Vérifié aussi que `rg … | head` reste à 0, y compris sur 410 Mo (ripgrep gère
# SIGPIPE) : le risque de faux échec ne se matérialise pas avec l'outillage d'ici.
#
# CONTREPARTIE MESURÉE — `<producteur> | head` peut désormais rendre un code non nul, parce que
# le producteur meurt de SIGPIPE quand `head` ferme le tuyau. Mesuré ici : `jq|head` = 141,
# `seq|head` = 141, `sort|head` = 2, alors que `rg|head` = 0 et `cat|head` = 0 (eux gèrent SIGPIPE).
# Un 141 après un `| head` est une COUPURE, pas un échec : ne pas partir en diagnostic. Quand le
# code retour compte vraiment, limiter à la source plutôt qu'avec `head` — `rg -m5`,
# `jq 'limit(5; …)'`, `sqlite3 … LIMIT 5`.
#
# GARDE-FOU DE PROFONDEUR : seul le shell de premier niveau est modifié. Les scripts du dépôt,
# les build-scripts cargo et les recettes cmake gardent leur sémantique — changer la leur ferait
# échouer des builds pour une raison sans rapport avec leur code.
if [ -z "${NIERS_SHELL_INIT:-}" ]; then
    export NIERS_SHELL_INIT=1
    set -o pipefail
fi
