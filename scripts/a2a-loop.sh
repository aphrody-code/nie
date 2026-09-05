#!/usr/bin/env bash
# Un tour de la boucle autonome Claude <-> Codex.
#
# Chaque tour : lire l'objectif que le PAIR a fixe, l'executer, rendre le resultat mesure,
# puis fixer au pair l'objectif SUIVANT. Les deux agents s'alimentent ainsi mutuellement
# sans intervention humaine.
#
#   bash scripts/a2a-loop.sh codex   [n]   # fait travailler Codex sur l'objectif de Claude
#   bash scripts/a2a-loop.sh claude  [n]   # fait travailler Claude sur l'objectif de Codex
#
# `n` est le numero d'iteration (defaut : lu dans .coord/iteration, incremente).
#
# Ce que la boucle NE fait jamais, et pourquoi :
#   - elle ne commit pas a la place de l'agent : un seul auteur de commits garde
#     l'historique lisible, et un commit automatique masque ce qui a reellement change ;
#   - elle ne touche ni aux services systemd, ni a /etc, ni au disque hors du depot :
#     18 services de production tournent sur cette machine ;
#   - elle n'utilise pas `pkill -f`, qui tue les sessions d'agent — les PID sont cibles.
set -euo pipefail

RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RACINE"

SIDE="${1:?usage : bash scripts/a2a-loop.sh <claude|codex> [iteration]}"
case "$SIDE" in
  claude) PEER=codex  ;;
  codex)  PEER=claude ;;
  *) echo "cote inconnu : $SIDE (attendu : claude ou codex)" >&2; exit 2 ;;
esac

COORD="$RACINE/.coord"
mkdir -p "$COORD"
ITER_FILE="$COORD/iteration"
if [ $# -ge 2 ]; then
  ITER="$2"
else
  ITER=$(( $(cat "$ITER_FILE" 2>/dev/null || echo 0) + 1 ))
fi
echo "$ITER" > "$ITER_FILE"

INBOX_PEER="$COORD/inbox-from-$PEER.jsonl"
JOURNAL="$COORD/loop-$SIDE.log"

# --- 1. L'objectif fixe par le pair -------------------------------------------------
# On ne prend que le DERNIER message dont le sujet commence par `goal:`. Un `fact` ou un
# `ping` n'est pas un ordre de travail. Sans objectif, l'agent en choisit un lui-meme.
OBJECTIF=""
if [ -s "$INBOX_PEER" ]; then
  OBJECTIF=$(jq -r 'select(.topic | startswith("goal:")) | "\(.topic)\n\(.body)"' \
               "$INBOX_PEER" 2>/dev/null | tail -20 || true)
fi
if [ -z "$OBJECTIF" ]; then
  OBJECTIF="(aucun objectif recu de $PEER — choisis-en un toi-meme : le plus utile au
depot, borne, verifiable, et disjoint de ce que $PEER a annonce dans sa boite.)"
fi

{
  echo "=== iteration $ITER — $SIDE (pair : $PEER) — $(date -Is)"
  echo "--- objectif recu ---"
  echo "$OBJECTIF"
} | tee -a "$JOURNAL"

# --- 2. La consigne commune ----------------------------------------------------------
CONSIGNE=$(cat <<CONSIGNE
Tu es « $SIDE ». Tu codes en parallele de « $PEER » sur /home/ubuntu/niers, en autonomie
complete : personne ne validera tes choix, c'est a toi de decider et d'executer.
Reponds en francais. Lis AGENTS.md, docs/A2A-CODEX.md et CLAUDE.md si tu ne les as pas lus.

OBJECTIF POUR CE TOUR (fixe par $PEER) :
$OBJECTIF

REGLES DE COEXISTENCE (docs/A2A-CODEX.md fait foi) :
- Annonce ton perimetre AVANT d'ecrire, et n'ecris rien en dehors.
- Les fichiers d'arbitrage (CLAUDE.md, AGENTS.md, .gitignore, justfile, manifestes racine)
  appartiennent a Claude : si tu es Codex et qu'il te faut un changement la-dedans, ne le
  fais pas, demande-le par un tick.
- Codex ne commit pas, ne push pas, ne cree pas de branche. Claude commit.
- Rien de destructif ni de production sans accord : pas de rm -rf, pas de git reset --hard,
  pas de redemarrage de service, pas d'ecriture hors du depot. `pkill -f` est interdit
  (il tue les sessions d'agent) : cible un PID.

REGLES DU DEPOT :
- Cherche avec rg, jamais grep -r a la racine (timeout 60 s sur node_modules).
- Modifie avec un vrai outil d'edition, JAMAIS sed -i : il echoue en silence dans les deux
  sens (motif absent = 0 remplacement exit 0 ; motif trop frequent = trop de remplacements).
- Python toujours par uv run, et en FICHIER au-dela de deux lignes.
- Verification = cargo clippy -p <crate> --lib --tests (0 warning) et/ou bun run typecheck.
  JAMAIS cargo build --workspace --all-targets : le disque est a 92 %, ca le sature.
- Une suite qui affiche « 0 passed » n'est pas verte : elle n'a pas tourne.
- Un chemin VFS cite de memoire est presque toujours faux (les fichiers du jeu portent un
  numero de version) : resous-le par niers vfs find avant de l'ecrire.

QUAND TU AS FINI, DEUX TICKS, DANS CET ORDRE. Note bien : --kind n'accepte QUE `fact` et
`ping`, tout le reste retombe sur `ping` en silence — le type se code dans le sujet.

1) Ton resultat, chiffre et mesure :
   aphrody a2a tick --iteration $ITER --side $SIDE --peer $PEER --kind fact \\
     --subject "done: <ce que tu as fait>" \\
     --body "<fichiers touches> ; <resultat exact de la verification>"

2) L'objectif SUIVANT pour $PEER — c'est la partie qui fait tourner la boucle. Choisis-le
   toi-meme : ce qui debloque le plus le depot, borne, verifiable, et DISJOINT de ce que tu
   viens de toucher pour qu'il ne t'ecrase pas.
   aphrody a2a tick --iteration $ITER --side $SIDE --peer $PEER --kind fact \\
     --subject "goal: <objectif en une ligne>" \\
     --body "perimetre: <chemins> | critere de reussite: <comment on saura que c'est fait>"

Termine par un resume en francais : ce que tu as fait, la mesure qui le prouve, et
l'objectif que tu as fixe a $PEER.
CONSIGNE
)

# --- 3. Executer -----------------------------------------------------------------------
case "$SIDE" in
  codex)
    codex exec --cd "$RACINE" -s workspace-write --skip-git-repo-check "$CONSIGNE" \
      2>&1 | tee -a "$JOURNAL"
    ;;
  claude)
    claude -p "$CONSIGNE" --output-format text 2>&1 | tee -a "$JOURNAL"
    ;;
esac

echo "=== iteration $ITER terminee ($SIDE) — $(date -Is)" | tee -a "$JOURNAL"
