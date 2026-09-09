#!/usr/bin/env bash
# Republish a verified local `inagle_*` SQLite snapshot inside niers.
#
# The mirror lives in this repository's `var/` directory. The source must be an
# already verified `inagle-*.sqlite` materialization; this script never contacts
# a cloud database and never creates game data from a remote service.
#
# The switch happens only after validation. A reader opening the database during
# the operation keeps the previous target until the atomic symlink replacement.
set -euo pipefail

RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SORTIE="$RACINE/var/miroir"

mkdir -p "$SORTIE"
cd "$RACINE"

HORODATAGE=$(date -u +%Y-%m-%dT%H-%M-%S)
FICHIER="$SORTIE/inagle-${HORODATAGE}.sqlite"

SOURCE="${NIE_INAGLE_MIRROR:-}"
if [ -z "$SOURCE" ]; then
	SOURCE=$(find "$SORTIE" -maxdepth 1 -type f -name 'inagle-*.sqlite' -printf '%T@ %p\n' 2>/dev/null |
		sort -nr | awk 'NR == 1 { sub(/^[^ ]+ /, ""); print }')
fi
[ -n "$SOURCE" ] && [ -f "$SOURCE" ] || {
	echo "[mirror] no verified inagle snapshot found; set NIE_INAGLE_MIRROR" >&2
	exit 1
}
case "$SOURCE" in
	"$RACINE"/*) ;;
	*) echo "[mirror] source must be inside the repository: $SOURCE" >&2; exit 2 ;;
esac

echo "[mirror] verified inagle snapshot $SOURCE -> $FICHIER"
cp --reflink=auto -- "$SOURCE" "$FICHIER"

# Validation: the file must be larger than 1 MiB and contain characters.
if [ ! -f "$FICHIER" ]; then
		echo "[mirror] abort: snapshot copy is missing"
	exit 1
fi
TAILLE=$(stat -c%s "$FICHIER")
PERSONNAGES=$(sqlite3 "$FICHIER" "SELECT count(*) FROM inagle_characters" 2>/dev/null || echo 0)
if [ "$TAILLE" -lt 1000000 ] || [ "${PERSONNAGES:-0}" -lt 1000 ]; then
		echo "[mirror] abort: invalid snapshot (size=$TAILLE characters=$PERSONNAGES)"
	rm -f "$FICHIER"
	exit 1
fi
echo "[mirror] verified snapshot (size=$TAILLE characters=$PERSONNAGES)"

# Bascule atomique : `ln -sfn` remplace le lien sans jamais laisser `var/mirror.sqlite` absent.
ln -sfn "miroir/$(basename "$FICHIER")" "$RACINE/var/mirror.sqlite"
echo "[miroir] var/mirror.sqlite -> $(basename "$FICHIER")"

# Rétention : les deux plus récents suffisent — un pour servir, un pour revenir en arrière.
#
# Chaque instantané part avec ses fichiers annexes `-wal` et `-shm`. Sans cette précaution, un
# lecteur qui a ouvert la base en WAL laisse derrière lui un `-shm` et un `-wal` que le glob
# `inagle-*.sqlite` ne voit pas : la base est purgée, ses annexes restent, et le dossier
# accumulates orphan files over time.
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

# Optional final read-only validation through the native catalog binary.
if command -v nie-catalog >/dev/null 2>&1; then
	nie-catalog etat
fi
