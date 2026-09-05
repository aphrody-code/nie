#!/usr/bin/env bash
# Synchronise le poste Windows et le VPS Linux en donnant à chacun ce qu'il fait le mieux.
#
# ## Pourquoi deux machines, et qui fait quoi
#
# Ce dépôt vit sur deux machines aux forces opposées, et jusqu'ici chacune refaisait le travail
# de l'autre :
#
# | | poste Windows | VPS Linux |
# |---|---|---|
# | atouts | GPU, écran, RAM, l'installation Steam du jeu | lien réseau, disponibilité permanente |
# | lui revient | build de l'application, rendu, VFS, vérification À L'ÉCRAN | moisson réseau, scraping, les 18 services |
#
# La moisson des épisodes sort sur le réseau des centaines de fois : c'est au VPS de la faire.
# Le build de l'application et toute vérification visuelle exigent un écran et le GPU : c'est au
# poste Windows. Ce script fait circuler le résultat entre les deux, dans ce sens-là.
#
# ## Les six pièges que ce script évite, tous rencontrés le 2026-09-03
#
# 1. **`ovh-vps` passe par le VPN et expire** : on vise TOUJOURS l'alias `-direct`.
# 2. **Le dépôt du VPS appartient à `ubuntu`, la session SSH est `root`** : git refuse pour
#    « dubious ownership ». On passe `-c safe.directory` à chaque appel plutôt que de modifier
#    la configuration globale de la machine.
# 3. **Le VPS porte le travail non commité d'une autre session** (`CLAUDE.md` l'interdit d'ailleurs
#    au `git pull`). On ne tire donc JAMAIS sans avoir mis ce travail de côté : `stash`, pull,
#    `stash pop`. Si le `pop` échoue, le stash reste — rien n'est perdu, et le script s'arrête.
# 4. **Écrire en `root` dans le dépôt d'`ubuntu`** laisse des fichiers (dont les `-wal` SQLite) que
#    les services, qui tournent en `ubuntu`, ne peuvent plus ouvrir. Tout passe par `sudo -u ubuntu`.
# 5. **`bun` n'est pas dans le PATH d'une session SSH non interactive**, et les scripts du dépôt
#    le rappellent par son nom : on impose un PATH complet, sinon `bun: command not found`.
# 6. **Le bot ne lit PAS la base du dépôt** mais `~/.cache/ietv/episodes.db`. Moissonner sans
#    recopier là laisse le bot sur un catalogue périmé — vu : 412 sources contre 1 770.
#
# ## Copier une base SQLite
#
# Toujours `sqlite3 … ".backup"`, jamais `cp` : une base ouverte en WAL perd ses écritures
# récentes si on copie le seul fichier principal.
#
# Usage : scripts/ops/sync-machines.sh [--sans-moisson] [--sans-rapatriement]
#
# Ce script ne synchronise que les données Niers (moisson + SQLite). Pour le
# code des deux dépôts, utiliser rg/scripts/ops/repo-sync.ts ; garder deux
# implémentations Git ferait réapparaître les divergences de l'ancien audit.
set -euo pipefail

VPS="${NIE_VPS:-${REPO_SYNC_VPS:-}}"
RACINE_VPS="${NIE_REMOTE_NIERS_ROOT:-/home/ubuntu/niers}"
BUN_VPS="/home/ubuntu/.bun/bin/bun"
PATH_VPS="/home/ubuntu/.bun/bin:/usr/local/bin:/usr/bin:/bin"
GIT_VPS="git -c safe.directory=${RACINE_VPS}"

if [ -z "$VPS" ]; then
    echo "NIE_VPS/REPO_SYNC_VPS est absent : configurez l'alias SSH du poste avant la synchronisation." >&2
    exit 2
fi

MOISSON=1
RAPATRIER=1
for a in "$@"; do
    case "$a" in
        --sans-moisson) MOISSON=0 ;;
        --sans-rapatriement) RAPATRIER=0 ;;
        *) echo "option inconnue : $a" >&2; exit 2 ;;
    esac
done

racine_locale() { git rev-parse --show-toplevel; }
cd "$(racine_locale)"

etape() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
sur_vps() { ssh -o ConnectTimeout=15 "$VPS" "$1"; }

# ── 1. Le local pousse ────────────────────────────────────────────────────────
etape "1/5 · poste Windows → GitHub"
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    echo "  arbre local modifié — commite avant de synchroniser." >&2
    git status --short --untracked-files=no >&2
    exit 1
fi
git push origin "$(git rev-parse --abbrev-ref HEAD)"

# ── 2. Le VPS tire, sans perdre le travail d'une autre session ────────────────
etape "2/5 · GitHub → VPS (le travail non commité est mis de côté)"
sur_vps "cd ${RACINE_VPS} && \
    modifs=\$(${GIT_VPS} status --porcelain | wc -l) && \
    echo \"  \${modifs} fichier(s) non commité(s) sur le VPS\" && \
    if [ \"\${modifs}\" -gt 0 ]; then ${GIT_VPS} stash push -u -m \"sync-\$(date +%Y%m%d-%H%M)\"; fi && \
    ${GIT_VPS} pull --no-rebase origin main && \
    if [ \"\${modifs}\" -gt 0 ]; then \
        ${GIT_VPS} stash pop || { echo '  CONFLIT au dépaquetage — le stash est conservé, rien n a été perdu.' >&2; exit 1; }; \
    fi && \
    ${GIT_VPS} log --oneline -1"

# ── 3. Les dépendances, puis la moisson — là où le débit est ──────────────────
etape "3/5 · VPS · dépendances"
sur_vps "cd ${RACINE_VPS} && sudo -u ubuntu env PATH=${PATH_VPS} ${BUN_VPS} install"

if [ "$MOISSON" -eq 1 ]; then
    etape "4/5 · VPS · moisson des épisodes (réseau)"
    sur_vps "cd ${RACINE_VPS} && sudo -u ubuntu env PATH=${PATH_VPS} ${BUN_VPS} --bun packages/ietv/src/moisson.ts --collecter"

    # Le bot lit sa propre copie : sans cette recopie, il reste sur un catalogue périmé.
    etape "    VPS · base du bot ← base du dépôt, puis relance"
    sur_vps "sudo -u ubuntu sqlite3 ${RACINE_VPS}/data/anime/episodes.db \".backup /home/ubuntu/.cache/ietv/episodes.db\" && \
        systemctl restart niers-wonderbot.service && sleep 5 && systemctl is-active niers-wonderbot.service"
else
    etape "4/5 · moisson sautée (--sans-moisson)"
fi

# ── 5. Le résultat revient sur la machine qui a l'écran ───────────────────────
if [ "$RAPATRIER" -eq 1 ]; then
    etape "5/5 · VPS → poste Windows (base des épisodes)"
    # `.backup` côté VPS vers un fichier temporaire : `scp` sur une base ouverte en WAL
    # rapatrierait un instantané incomplet.
    sur_vps "sudo -u ubuntu sqlite3 ${RACINE_VPS}/data/anime/episodes.db \".backup /tmp/episodes-sync.db\""
    scp -q "${VPS}:/tmp/episodes-sync.db" data/anime/episodes.db
    echo "  data/anime/episodes.db mis à jour :"
    sqlite3 data/anime/episodes.db \
        "SELECT (SELECT COUNT(*) FROM episode_sources) || ' sources, ' || \
                (SELECT COUNT(DISTINCT season || ':' || COALESCE(episode,-1)) FROM episodes) || ' épisodes';"
    echo "  → l'explorateur lit la base d'%APPDATA%, pas celle-ci : lance"
    echo "    scripts/packager-bases-explorer.sh avant la prochaine release."
else
    etape "5/5 · rapatriement sauté (--sans-rapatriement)"
fi

printf '\n\033[1mSynchronisation terminée.\033[0m Le build de l application reste au poste Windows.\n'
