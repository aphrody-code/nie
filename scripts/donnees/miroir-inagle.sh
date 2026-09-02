#!/usr/bin/env bash
# Republication du miroir SQLite des tables `inagle_*` — dans niers, pas ailleurs.
#
# Le miroir vivait sous `rg/apps/azalee/data/backups/`, et tout ce qui n'était pas le site web
# devait aller le chercher là-bas par un chemin absolu. Il vit maintenant dans `var/` du dépôt,
# où `@niers/catalog` le résout en premier : le site continue de servir le sien, et le catalogue,
# le bot et la CLI n'ont plus de dépendance de chemin vers un autre dépôt.
#
# Idempotent, et ne bascule QUE si le nouveau dump est valide : un dump vide ou tronqué laisse
# l'ancien miroir en place. La bascule est un renommage de lien symbolique, donc atomique — un
# lecteur qui ouvre la base pendant l'opération lit l'ancien fichier jusqu'au bout.
set -euo pipefail

RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SORTIE="$RACINE/var/miroir"
BUN="${BUN:-$HOME/.bun/bin/bun}"

mkdir -p "$SORTIE"
cd "$RACINE"

# DATABASE_URL vient de l'environnement du service (jamais du dépôt).
HORODATAGE=$(date -u +%Y-%m-%dT%H-%M-%S)
FICHIER="$SORTIE/inagle-${HORODATAGE}.sqlite"

echo "[miroir] dump inagle_* -> $FICHIER"
"$BUN" --bun scripts/donnees/dump-inagle-sqlite.ts --prefix=inagle_ --output="$FICHIER"

# Validation : le fichier doit exister, peser plus d'1 Mo et porter des personnages.
# Sans ce garde-fou, un dump raté remplacerait un miroir sain par une base vide, et toutes les
# pages du site répondraient « aucun résultat » au lieu d'une erreur.
if [ ! -f "$FICHIER" ]; then
	echo "[miroir] ABANDON : dump absent"
	exit 1
fi
TAILLE=$(stat -c%s "$FICHIER")
PERSONNAGES=$("$BUN" -e "import{Database}from'bun:sqlite';const d=new Database(process.argv[1],{readonly:true});console.log(d.prepare('SELECT count(*) c FROM inagle_characters').get().c)" "$FICHIER" 2>/dev/null || echo 0)
if [ "$TAILLE" -lt 1000000 ] || [ "${PERSONNAGES:-0}" -lt 1000 ]; then
	echo "[miroir] ABANDON : dump invalide (taille=$TAILLE personnages=$PERSONNAGES) — l'ancien miroir reste en place"
	rm -f "$FICHIER"
	exit 1
fi
echo "[miroir] dump valide (taille=$TAILLE personnages=$PERSONNAGES)"

# Bascule atomique : `ln -sfn` remplace le lien sans jamais laisser `var/mirror.sqlite` absent.
ln -sfn "miroir/$(basename "$FICHIER")" "$RACINE/var/mirror.sqlite"
echo "[miroir] var/mirror.sqlite -> $(basename "$FICHIER")"

# Rétention : les deux plus récents suffisent — un pour servir, un pour revenir en arrière.
#
# Chaque instantané part avec ses fichiers annexes `-wal` et `-shm`. Sans cette précaution, un
# lecteur qui a ouvert la base en WAL laisse derrière lui un `-shm` et un `-wal` que le glob
# `inagle-*.sqlite` ne voit pas : la base est purgée, ses annexes restent, et le dossier
# accumule des orphelins nuit après nuit. Le cas est observable dans le dossier de l'ancienne
# synchronisation (`rg/apps/azalee/data/backups/`), qui porte encore les `-shm`/`-wal` d'un
# instantané supprimé le 2026-09-01.
ls -1t "$SORTIE"/inagle-*.sqlite 2>/dev/null | tail -n +3 | while read -r vieux; do
	rm -f "$vieux" "$vieux-wal" "$vieux-shm"
done
# Balayage des annexes déjà orphelines — celles dont la base a disparu lors d'un passage
# antérieur, avant que la ligne ci-dessus n'existe.
for annexe in "$SORTIE"/inagle-*.sqlite-wal "$SORTIE"/inagle-*.sqlite-shm; do
	[ -e "$annexe" ] || continue
	[ -e "${annexe%-*}" ] || rm -f "$annexe"
done
echo "[miroir] rétention : $(ls -1 "$SORTIE"/inagle-*.sqlite | wc -l) instantané(s) conservé(s)"

# Contrôle final par la façade elle-même : si le catalogue ne voit pas le nouveau miroir, la
# bascule n'a servi à rien, et il vaut mieux le savoir ici que dans une page vide.
"$BUN" --bun packages/nie-catalog/src/cli.ts etat
