#!/usr/bin/env bash
# Gate serverless du wiki : le site rend-il ses DONNEES sans aucun fichier local ?
#
# POURQUOI CE SCRIPT EXISTE
# Un `bun run build` qui rend 0 et des pages qui rendent 200 ne prouvent RIEN ici. Mesure du
# 2026-09-05 : build vert, 70/70 pages, /chara servi en 87 ms et pesant 136 921 octets — et
# ZERO lien de personnage dedans. La page etait une coquille : nav, CSS, payload RSC, aucune
# donnee. Deux causes distinctes ont produit ce meme symptome dans la meme journee :
#
#   1. RLS active sans policy    -> PostgREST rend 200 avec un tableau vide
#   2. SUPABASE_INTERNAL_URL     -> teste AVANT NEXT_PUBLIC_SUPABASE_URL par pickUrl()
#      (lib/supabase/server.ts:42), donc un .env.local detourne silencieusement l'origine
#
# D'ou la regle que ce script applique : on n'affirme rien sur un code de sortie ni sur un
# code HTTP, on COMPTE les elements attendus dans la reponse.
#
# Usage :
#   scripts/ops/gate-serverless.sh                    # build + serveur + assertions
#   scripts/ops/gate-serverless.sh --no-build         # reutilise le .next existant
#   SUPABASE_URL=... ANON_KEY=... scripts/ops/gate-serverless.sh
set -uo pipefail

racine="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
app="$racine/apps/azalee"
PORT="${PORT:-3099}"
BUILD=1
[ "${1:-}" = "--no-build" ] && BUILD=0

SUPABASE_URL="${SUPABASE_URL:-https://kvnlbhatjqqmhhxaxlbi.supabase.co}"
ANON_KEY="${ANON_KEY:-$(cat "${ANON_KEY_FILE:-/tmp/anon.key}" 2>/dev/null)}"
[ -n "$ANON_KEY" ] || { echo "cle anon absente (ANON_KEY ou ANON_KEY_FILE)" >&2; exit 2; }

# Le miroir doit etre INTROUVABLE : c'est tout l'objet du gate. Un chemin qui existe encore
# et le repli Postgres ne s'exercerait jamais.
env_gate=(
	"SQLITE_DB_PATH=/nonexistent/mirror.sqlite"
	"SUPABASE_INTERNAL_URL=$SUPABASE_URL"
	"NEXT_PUBLIC_SUPABASE_URL=$SUPABASE_URL"
	"NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY"
)

cd "$app" || exit 2

if [ "$BUILD" = 1 ]; then
	echo "== build (miroir absent, origine $SUPABASE_URL)"
	env "${env_gate[@]}" bun run build > /tmp/gate-serverless-build.log 2>&1
	code=$?
	echo "   build exit=$code  ($(grep -c 'Fallback to Postgres' /tmp/gate-serverless-build.log) replis SQLite->Postgres)"
	[ "$code" -eq 0 ] || { tail -30 /tmp/gate-serverless-build.log; exit 1; }
fi

echo "== serveur sur :$PORT"
env "${env_gate[@]}" PORT="$PORT" bun --bun run start > /tmp/gate-serverless-serve.log 2>&1 &
srv=$!
trap 'kill "$srv" 2>/dev/null' EXIT
for _ in $(seq 1 90); do
	curl -sf -o /dev/null "http://127.0.0.1:$PORT/" && break
	sleep 1
done

B="http://127.0.0.1:$PORT"
echecs=0

# --- Assertions de CONTENU ------------------------------------------------------------
# Chaque ligne compte des elements reels. Un seuil a 0 serait satisfait par une coquille.
verifie() {
	local nom="$1" url="$2" motif="$3" mini="$4"
	local n
	n=$(curl -s "$B$url" | grep -oE "$motif" | sort -u | wc -l)
	if [ "$n" -ge "$mini" ]; then
		printf '  OK    %-22s %5s elements (>= %s)\n' "$nom" "$n" "$mini"
	else
		printf '  VIDE  %-22s %5s elements (attendu >= %s)\n' "$nom" "$n" "$mini"
		echecs=$((echecs + 1))
	fi
}

echo "== contenu"
verifie "/chara"  /chara  'href="/chara/[^"]+'  50
verifie "/skill"  /skill  'href="/skill/[^"]+'  50
verifie "/item"   /item   'href="/item/[^"]+'   20
verifie "/equipe" /equipe 'href="/equipe/[^"]+' 5

# La fiche detail est le point dur : c'est elle qui portait le N+1 et qui rendait 404 quand
# l'origine etait mauvaise. On prend un slug REEL depuis l'origine visee, jamais en dur.
slug=$(curl -s "$SUPABASE_URL/rest/v1/inagle_characters?select=base_slug&is_primary=eq.true&limit=1" \
	-H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" | grep -oE '"base_slug":"[^"]+' | cut -d'"' -f4)
if [ -z "$slug" ]; then
	echo "  VIDE  origine ne rend aucun base_slug — RLS fermee ou table vide ?"
	echecs=$((echecs + 1))
else
	code=$(curl -s -o /tmp/gate-fiche.html -w '%{http_code}' "$B/chara/$slug")
	n=$(grep -coE 'stat|niveau|technique' /tmp/gate-fiche.html)
	if [ "$code" = 200 ] && [ "$n" -ge 1 ]; then
		printf '  OK    /chara/%-15s HTTP %s\n' "$slug" "$code"
	else
		printf '  ECHEC /chara/%-15s HTTP %s\n' "$slug" "$code"
		echecs=$((echecs + 1))
	fi
fi

# --- Latence --------------------------------------------------------------------------
# Accept-Encoding explicite : sans lui, la taille mesuree est celle du non-compresse (piege
# paye le 2026-09-05 : /chara annonce a 2,36 Mo au lieu de 104 Ko).
echo "== latence (cible du plan : fiche perso < 800 ms)"
for u in / /chara "/chara/$slug"; do
	read -r c t s < <(curl -s -o /dev/null -H 'Accept-Encoding: br, gzip' \
		-w '%{http_code} %{time_starttransfer} %{size_download}\n' "$B$u")
	printf '  %-32s %3s  %7.3fs  %8s o\n' "$u" "$c" "$t" "$s"
done

echo
if [ "$echecs" -eq 0 ]; then
	echo "GATE OK — le wiki rend ses donnees sans miroir local."
	exit 0
fi
echo "GATE ECHEC — $echecs assertion(s) de contenu non satisfaite(s)."
exit 1
