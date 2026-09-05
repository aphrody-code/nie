#!/usr/bin/env bash
# PreToolUse(Bash) — garde-fous des pieges REELS de ce depot, sur CETTE machine (Linux).
#
# Doctrine, revisee le 2026-09-05 pour ne plus entraver l'autonomie :
#
#   deny   = uniquement l'IRREVERSIBLE et le DESTRUCTEUR. Trois cas, pas un de plus.
#   ask    = uniquement l'EXTERNE (ce qui sort de la machine).
#   allow+ = tout le reste. Le conseil est transmis, la commande PASSE.
#
# La version precedente refusait cinq pieges de STYLE (`python`, `node`, `bun install`,
# python multi-lignes, `cargo --workspace`). Ils sont reels, mais aucun n'est destructeur :
# au pire la commande echoue, et l'agent lit l'erreur. Les refuser coutait un aller-retour
# a chaque fois, y compris sur des formes parfaitement valides — un `python3 - <<'EOF'`
# avec heredoc QUOTE ne subit aucune substitution shell, et etait bloque quand meme.
# Un garde-fou qui se trompe apprend a l'agent a le contourner, pas a s'en servir.
#
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

decision() { # $1 = allow|ask|deny, $2 = raison
  jq -nc --arg d "$1" --arg r "$2" \
    '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:$d,permissionDecisionReason:$r}}'
  exit 0
}

# Un « mot de commande » : en debut de ligne ou apres ; && || | ( &
mot() { printf '%s' "$cmd" | grep -qE "(^|[;&|(]|&&|\|\|)[[:space:]]*$1([[:space:]]|$)"; }

# =============================================================================
# deny — irreversible ou destructeur. Ces trois-la seulement.
# =============================================================================

printf '%s' "$cmd" | grep -qE 'pkill[[:space:]]+(-[a-zA-Z]+[[:space:]]+)*-f' && decision deny \
  "pkill -f tue la session Claude elle-meme (son argv contient le motif). Cible un PID explicite : pgrep -a <motif> puis kill <PID>."

# Le `[^;&|]*` est essentiel : avec `.*`, la regex traversait les separateurs et un
# `rm -rf target/debug/x ; du -sh target/release` etait refuse a tort (vecu le 2026-09-02).
printf '%s' "$cmd" | grep -qE 'rm[[:space:]]+-[a-zA-Z]*r[a-zA-Z]*[[:space:]]+[^;&|]*target/release([[:space:]]|/|$)' && decision deny \
  "target/release/ contient 20 binaires deja construits (niers, nie-forge, nie-game, nie-play…) qui evitent des rebuilds de plusieurs minutes. Supprime un binaire precis, ou nettoie target/debug/{incremental,examples}."

printf '%s' "$cmd" | grep -qE 'git[[:space:]]+(add|commit).*(-f|--force).*(^|[[:space:]/])(data/|nie\.exe|nie_eacpatched\.exe)' && decision deny \
  "Ces chemins sont des assets (c) LEVEL-5, gitignores expres. Ne jamais les forcer dans un commit."

# =============================================================================
# ask — sort de la machine. Le seul cas.
# =============================================================================

mot 'git[[:space:]]+push' && decision ask \
  "git push est externe et irreversible. La regle du depot : committer sur main librement, POUSSER SUR DEMANDE."

# =============================================================================
# allow + conseil — la commande passe, l'agent est prevenu.
# =============================================================================

mot 'python3?' && decision allow \
  "Rappel : sur ce depot Python passe par uv ('uv run script.py'), sinon le .venv du projet (capstone, pefile, unicorn…) est absent. Si ta commande echoue en ModuleNotFoundError, c'est ca."

mot 'node' && decision allow \
  "Rappel : ici tout passe par Bun. 'bun run' ne suffit pas — le shebang '#!/usr/bin/env node' est honore et relance node. Utilise 'bun --bun <script>'."

printf '%s' "$cmd" | grep -qE 'bun[[:space:]]+install' && ! printf '%s' "$cmd" | grep -qE '(cd[[:space:]]+/home/ubuntu/niers[[:space:]]*(;|&&)|^[[:space:]]*bun[[:space:]]+install)' && decision allow \
  "Rappel : 'bun install' se lance depuis la RACINE, jamais dans un sous-paquet — un seul lockfile, et les versions sont partagees par catalogue. Lance ailleurs, il desynchronise l'arbre."

printf '%s' "$cmd" | grep -qE "(^|[;&|(]|&&|\|\|)[[:space:]]*(uv[[:space:]]+run[[:space:]]+)?(--with[[:space:]]+[^[:space:]]+[[:space:]]+)?python3?[[:space:]]+-c[[:space:]]*[\"'][[:space:]]*$" \
  && decision allow \
  "Rappel : le corps d'un 'python -c' multi-lignes traverse bash AVANT python (\$VAR substitue, \$(...) EXECUTE, \\\\ reduit a \\ — cause reelle de 'SyntaxError: unterminated string literal'). Un fichier + 'uv run <fichier>' evite ces deux couches de quoting. Un heredoc QUOTE (<<'EOF') n'a pas ce probleme."

printf '%s' "$cmd" | grep -qE 'cargo[[:space:]]+(test|build)[[:space:]].*--workspace' \
  && ! printf '%s' "$cmd" | grep -qE '(>[[:space:]]*[^[:space:]]+|run_in_background)' && decision allow \
  "Rappel : 'cargo (test|build) --workspace' depasse les 600 s sur ce depot (34 crates) et sature un disque deja a 92 %. Prefere 'cargo clippy --all-targets' (check, sans edition de liens), ou lance-le en arriere-plan AVEC redirection vers un fichier — une sortie filtree par un pipe est perdue."

exit 0
