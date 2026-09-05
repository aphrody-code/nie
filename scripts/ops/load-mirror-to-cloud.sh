#!/usr/bin/env bash
# Charge les tables `inagle_*` du miroir SQLite vers un projet Supabase Cloud.
#
# POURQUOI CE SCRIPT PLUTOT QUE CEUX QUI EXISTAIENT
# `scripts/ops/load-game-data-to-cloud.ts` n'implemente rien : sa branche de chargement
# affiche « Would proceed » puis « Next: Implement ». Et la voie qu'il declarait impossible
# — psql en direct — fonctionne : `db.<ref>.supabase.co:5432` repond, c'est le POOLER
# (`aws-0-*.pooler.supabase.com`) qui refuse la connexion, pas la base.
#
# CE QU'IL FAIT
# Pour chaque table `inagle_*` presente des DEUX cotes et dont les colonnes concordent
# exactement : TRUNCATE puis COPY depuis un CSV genere par sqlite3. Les tables dont les
# colonnes divergent sont SAUTEES et listees — jamais chargees partiellement, une table a
# moitie remplie est pire qu'une table vide.
#
# IDEMPOTENT : le TRUNCATE precede chaque COPY, donc un rejeu donne le meme etat final.
# REPRENABLE : chaque table est independante ; une coupure se rattrape en relancant.
#
# NULL vs CHAINE VIDE : sqlite3 emet `\N` pour NULL (`.nullvalue`), et COPY est appele avec
# `NULL '\N'`. Sans cela, toute chaine vide deviendrait NULL et l'inverse — une corruption
# silencieuse qu'aucun comptage de lignes ne revelerait.
#
# Usage :
#   scripts/ops/load-mirror-to-cloud.sh [--dry-run] [--table <nom>]
set -euo pipefail

racine="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$racine"

DRY_RUN=0
SEULE=""
while [ $# -gt 0 ]; do
	case "$1" in
		--dry-run) DRY_RUN=1 ;;
		--table) SEULE="${2:-}"; shift ;;
		*) echo "argument inconnu : $1" >&2; exit 2 ;;
	esac
	shift
done

# --- Acces ---------------------------------------------------------------------------
if [ -z "${SUPABASE_DB_PASSWORD:-}" ]; then
	# shellcheck disable=SC1090
	set -a; . "$HOME/.config/niers/supabase.env"; set +a
fi
REF="${SUPABASE_PROJECT_REF:-kvnlbhatjqqmhhxaxlbi}"
export PGPASSWORD="$SUPABASE_DB_PASSWORD"
PG="postgresql://postgres@db.${REF}.supabase.co:5432/postgres?sslmode=require"

MIROIR="${SQLITE_DB_PATH:-$racine/var/mirror.sqlite}"
[ -e "$MIROIR" ] || { echo "miroir introuvable : $MIROIR" >&2; exit 1; }

echo "miroir : $MIROIR"
echo "cible  : db.${REF}.supabase.co"
[ "$DRY_RUN" = 1 ] && echo "MODE : dry-run, aucune ecriture"
echo

# --- Tables presentes des deux cotes -------------------------------------------------
sqlite3 "$MIROIR" "select name from sqlite_master where type='table' and name like 'inagle_%' order by name" | LC_ALL=C sort > /tmp/lmc-sqlite.txt
psql "$PG" -tAc "select table_name from information_schema.tables where table_schema='public' and table_name like 'inagle\_%' order by table_name" | LC_ALL=C sort > /tmp/lmc-pg.txt
LC_ALL=C comm -12 /tmp/lmc-sqlite.txt /tmp/lmc-pg.txt > /tmp/lmc-communes.txt

echo "tables : $(wc -l < /tmp/lmc-sqlite.txt) dans le miroir, $(wc -l < /tmp/lmc-pg.txt) dans le Cloud, $(wc -l < /tmp/lmc-communes.txt) communes"
echo

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

charge=0; saute=0; vide=0; lignes_total=0
: > /tmp/lmc-sautees.txt

while read -r t; do
	[ -n "$SEULE" ] && [ "$t" != "$SEULE" ] && continue

	n=$(sqlite3 "$MIROIR" "select count(*) from \"$t\"")
	if [ "$n" -eq 0 ]; then vide=$((vide + 1)); continue; fi

	cs=$(sqlite3 "$MIROIR" "select group_concat(name,',') from pragma_table_info('$t')")
	cp=$(psql "$PG" -tAc "select string_agg(column_name,',' order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='$t'")
	if [ "$cs" != "$cp" ]; then
		printf '%s\n' "$t" >> /tmp/lmc-sautees.txt
		saute=$((saute + 1))
		continue
	fi

	if [ "$DRY_RUN" = 1 ]; then
		printf "  %-40s %8s lignes  (dry-run)\n" "$t" "$n"
		charge=$((charge + 1)); lignes_total=$((lignes_total + n))
		continue
	fi

	csv="$tmpdir/$t.csv"
	sqlite3 -csv -cmd ".nullvalue \\N" "$MIROIR" "select * from \"$t\"" > "$csv"
	psql "$PG" -q -c "truncate table public.\"$t\" cascade" \
		-c "\\copy public.\"$t\" from '$csv' with (format csv, null '\\N')"
	apres=$(psql "$PG" -tAc "select count(*) from public.\"$t\"")
	statut=$([ "$apres" = "$n" ] && echo "ok" || echo "ECART")
	printf "  %-40s %8s -> %-8s %s\n" "$t" "$n" "$apres" "$statut"
	charge=$((charge + 1)); lignes_total=$((lignes_total + apres))
done < /tmp/lmc-communes.txt

echo
echo "chargees : $charge tables, $lignes_total lignes"
echo "vides    : $vide tables (rien a charger)"
echo "sautees  : $saute tables aux colonnes divergentes"
[ "$saute" -gt 0 ] && { echo "  --- a traiter a la main ---"; head -20 /tmp/lmc-sautees.txt | sed 's/^/  /'; }
exit 0
