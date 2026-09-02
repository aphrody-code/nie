#!/usr/bin/env bash
# PreToolUse(Bash) — garde-fous des pieges REELS de ce depot, sur CETTE machine (Linux).
# Principe : ne bloquer que ce qui est faux a coup sur ou irreversible, avec la correction
# dans le message. Aucun blocage sur un piege propre a Windows : il n'y en a pas ici.
# Toujours exit 0 : un hook casse ne doit jamais casser la session.

set -u
command -v jq >/dev/null 2>&1 || exit 0
cmd=$(jq -r '.tool_input.command // empty' 2>/dev/null) || exit 0
[ -z "$cmd" ] && exit 0

# N'analyser QUE la partie executable. Un corps de heredoc ou un message de commit est du
# TEXTE : y voir une commande a deja bloque a tort un commit dont le message citait « pkill -f ».
cmd=${cmd%%<<*}
case "$cmd" in
  *"git commit"*|*"git tag"*|*"gh pr "*|*"gh issue "*|*"gh release "*)
    cmd=${cmd%%-m*}; cmd=${cmd%%--message*}; cmd=${cmd%%-F*}; cmd=${cmd%%--body*} ;;
esac

refus() { # $1 = decision (deny|ask), $2 = raison
  jq -nc --arg d "$1" --arg r "$2" \
    '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:$d,permissionDecisionReason:$r}}'
  exit 0
}

# Un « mot de commande » : en debut de ligne ou apres ; && || | ( &
mot() { printf '%s' "$cmd" | grep -qE "(^|[;&|(]|&&|\|\|)[[:space:]]*$1([[:space:]]|$)"; }

# --- irreversible / externe : demander ---------------------------------------
mot 'git[[:space:]]+push' && refus ask \
  "git push est externe et irreversible. La regle du depot : committer sur main librement, POUSSER SUR DEMANDE. Confirme avec l'utilisateur d'abord."

printf '%s' "$cmd" | grep -qE 'git[[:space:]]+(add|commit).*(-f|--force).*(^|[[:space:]/])(data/|nie\.exe|nie_eacpatched\.exe)' && refus deny \
  "Ces chemins sont des assets (c) LEVEL-5, gitignores exprès. Ne jamais les forcer dans un commit."

printf '%s' "$cmd" | grep -qE 'pkill[[:space:]]+(-[a-zA-Z]+[[:space:]]+)*-f' && refus deny \
  "pkill -f tue la session Claude elle-meme (son argv contient le motif). Cible un PID explicite : pgrep -a <motif> puis kill <PID>."

printf '%s' "$cmd" | grep -qE 'rm[[:space:]]+-[a-zA-Z]*r[a-zA-Z]*[[:space:]]+.*target/release([[:space:]]|/|$)' && refus deny \
  "target/release/ contient 20 binaires deja construits (niers, nie-forge, nie-game, nie-play…) qui evitent des rebuilds de plusieurs minutes. Supprime un binaire precis, ou nettoie target/debug/{incremental,examples}."

# --- faux a coup sur : la commande n'aurait pas marche -----------------------
mot 'python3?' && refus deny \
  "Sur ce depot, Python passe TOUJOURS par uv : 'uv run script.py' ou 'uv run python -c \"...\"'. Ajoute --with <paquet> pour une dependance absente du venv (ex. numpy)."

mot 'node' && refus deny \
  "node est interdit ici : tout passe par Bun, et 'bun run' ne suffit pas (le shebang '#!/usr/bin/env node' est honore). Utilise 'bun --bun <script>'."

printf '%s' "$cmd" | grep -qE 'bun[[:space:]]+install' && ! printf '%s' "$cmd" | grep -qE '(cd[[:space:]]+/home/ubuntu/niers[[:space:]]*(;|&&)|^[[:space:]]*bun[[:space:]]+install)' && refus deny \
  "bun install se lance depuis la RACINE du depot, jamais dans un sous-paquet : un seul lockfile, et les versions sont partagees par catalogue."

# --- couteux : proposer la forme qui tient dans le budget --------------------
printf '%s' "$cmd" | grep -qE 'cargo[[:space:]]+(test|build)[[:space:]].*--workspace' \
  && ! printf '%s' "$cmd" | grep -qE '(>[[:space:]]*[^[:space:]]+|run_in_background)' && refus deny \
  "cargo (test|build) --workspace depasse le timeout de 600 s sur ce depot (34 crates). Deux issues : (1) le lancer en arriere-plan AVEC redirection vers un fichier — une sortie filtree par un pipe est perdue ; (2) pour une simple verification, 'cargo clippy --all-targets' (check, sans edition de liens) suffit et ne sature pas le disque."

exit 0
