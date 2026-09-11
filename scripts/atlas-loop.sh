#!/usr/bin/env bash
# atlas-loop.sh — la boucle autonome qui vise les 100 %.
#
# Un tick = MESURER -> INDEXER -> CLASSER -> AGIR -> RE-MESURER, et tout ce qui est mesuré
# atterrit dans `var/nie-atlas.sqlite` (table `atlas_metric`) avec la commande qui l'a produit.
# Rien n'est affirmé sans mesure : une étape qui échoue écrit son échec, elle n'écrit pas un
# chiffre d'avant.
#
# Usage :
#   bash scripts/atlas-loop.sh               # un tick complet (mesure + index + action)
#   bash scripts/atlas-loop.sh --no-act      # mesure et index seuls, aucune action
#   bash scripts/atlas-loop.sh --ticks 5     # cinq ticks d'affilée
#   ATLAS_PROOFS=1 bash scripts/atlas-loop.sh   # rejoue aussi les preuves uemu (lent)
#   ATLAS_RE_REAL=1 bash scripts/atlas-loop.sh  # rejoue le test RE réel sur le serveur MCP
#
# Bornes tenues :
#   - aucune action irréversible : ni push, ni suppression, ni service, ni /etc ;
#   - aucun `pkill` (les PID d'agents vivent sur cette machine) ;
#   - garde-disque : les étapes qui écrivent (lift 105 Mio, build 34 Mio) sont sautées
#     sous ATLAS_MIN_FREE_MIB libre, le disque du VPS tenant 91 % plein.
#
# PIÈGE PAYÉ (2026-09-02, cf. scripts/proofs.sh) : ne jamais lire `$?` à travers un pipe.
# Chaque commande est capturée d'abord, son code lu ensuite.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

ATLAS_DB="${ATLAS_DB:-var/nie-atlas.sqlite}"
KB_DB="${NIERS_DB:-var/niers.sqlite}"
REDIS_URL="${NIERS_ATLAS_REDIS:-redis://127.0.0.1/4}"
LOG="${ATLAS_LOG:-var/atlas-loop.ndjson}"
MIN_FREE_MIB="${ATLAS_MIN_FREE_MIB:-2048}"
# Plafond de temps d'une action : une etape qui part en vrille est coupee, pas laissee
# a tourner jusqu'au prochain tick (`niers propagate` sur une KB de 19 Go, par exemple).
ACT_TIMEOUT="${ATLAS_ACT_TIMEOUT:-1800}"
REF_EXE="${NIE_EXE:-nie.exe}"

act=1
ticks=1
while [ $# -gt 0 ]; do
	case "$1" in
	--no-act) act=0 ;;
	--ticks)
		shift
		ticks="${1:-1}"
		;;
	--help | -h)
		sed -n '2,26p' "$0"
		exit 0
		;;
	*)
		echo "option inconnue : $1" >&2
		exit 2
		;;
	esac
	shift
done

# Un seul tick à la fois : deux boucles concurrentes écriraient la même base et se
# disputeraient le WAL de la KB de 19 Go. Le heartbeat RE horaire, lui, n'est pas verrouillé
# par ce fichier — si les deux se croisent, SQLite rendra SQLITE_BUSY et l'échec sera journalisé.
exec 9>var/atlas-loop.lock
if ! flock -n 9; then
	echo "atlas-loop: un tick est déjà en cours (var/atlas-loop.lock)" >&2
	exit 0
fi

# --- outils ------------------------------------------------------------------

niers_bin=""
for candidate in target/release/niers target/debug/niers "$HOME/.local/bin/niers"; do
	[ -x "$candidate" ] && {
		niers_bin="$candidate"
		break
	}
done
[ -n "$niers_bin" ] || {
	echo "atlas-loop: binaire niers absent — cargo build --release -p nie-cli" >&2
	exit 1
}

# `nie-forge` release peut être antérieur au format courant de var/forge/cover.json
# (variant `inline_data` ajouté le 2026-09-06) : on préfère le plus récent des deux.
forge_bin=""
newest=0
for candidate in target/release/nie-forge target/debug/nie-forge; do
	[ -x "$candidate" ] || continue
	stamp=$(stat -c %Y "$candidate" 2>/dev/null || echo 0)
	if [ "$stamp" -gt "$newest" ]; then
		newest=$stamp
		forge_bin="$candidate"
	fi
done

json_escape() { printf '%s' "${1:-}" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/ /g' | tr -d '\n'; }

emit() { # emit <step> <ok> <ms> <detail>
	printf '{"ts":"%s","step":"%s","ok":%s,"ms":%s,"detail":"%s"}\n' \
		"$(date -Is)" "$1" "$2" "$3" "$(json_escape "$4")" >>"$LOG"
	printf '%-22s ok=%s %sms %s\n' "$1" "$2" "$3" "$4"
}

record_run() { # record_run <step> <area> <ok:0|1> <ms> <detail>
	local flag=""
	[ "$3" = "true" ] && flag="--ok"
	"$niers_bin" atlas run "$1" --db "$ATLAS_DB" --area "${2:-none}" $flag --ms "$4" \
		--log "$(printf '%.400s' "${5:-}")" >/dev/null 2>&1
}

record_metric() { # record_metric <name> <value> <total|-> <source>
	if [ "$3" = "-" ]; then
		"$niers_bin" atlas metric "$1" "$2" --db "$ATLAS_DB" --source "$4" >/dev/null
	else
		"$niers_bin" atlas metric "$1" "$2" --db "$ATLAS_DB" --total "$3" --source "$4" >/dev/null
	fi
}

free_mib() { df -Pm . | awk 'NR==2 {print $4}'; }

# `date +%s%3N` n'est pas honoré partout (ce VPS rend 19 chiffres, soit des nanosecondes) :
# on lit les nanosecondes et on divise, ce qui est vrai sur toutes les implémentations.
now_ms() { echo $(( $(date +%s%N) / 1000000 )); }

# --- étapes -------------------------------------------------------------------

# 1. La forge : part du binaire réellement produite par le dépôt.
#
# La ligne terse de `nie-forge report` porte déjà les deux pourcentages
# (`produced=…% code_rust=…%`) : on la lit telle quelle plutôt que de recalculer un ratio
# depuis le JSON, ce qui ferait diverger la mesure de l'outil qui la définit.
mesure_forge() {
	[ -n "$forge_bin" ] || {
		emit forge.report false 0 "nie-forge absent"
		return
	}
	local t0 out rc ms produced code_rust
	t0=$(now_ms)
	out=$("$forge_bin" report 2>&1)
	rc=$?
	ms=$(($(now_ms) - t0))
	if [ "$rc" -ne 0 ]; then
		emit forge.report false "$ms" "rc=$rc $(printf '%s' "$out" | tail -1)"
		record_run forge.report forge.produced false "$ms" "$out"
		return
	fi
	produced=$(printf '%s' "$out" | grep -oE 'produced=[0-9.]+' | tail -1 | cut -d= -f2)
	code_rust=$(printf '%s' "$out" | grep -oE 'code_rust=[0-9.]+' | tail -1 | cut -d= -f2)
	if [ -z "$produced" ] || [ -z "$code_rust" ]; then
		emit forge.report false "$ms" "rapport sans pourcentage lisible : $(printf '%s' "$out" | tail -1)"
		record_run forge.report forge.produced false "$ms" "$out"
		return
	fi
	record_metric forge.produced "$produced" 100 "$forge_bin report"
	record_metric forge.code_rust "$code_rust" 100 "$forge_bin report"
	emit forge.report true "$ms" "produced=${produced}% code_rust=${code_rust}%"
	record_run forge.report forge.produced true "$ms" "produced=$produced code_rust=$code_rust"
}

# 2. L'identité : le binaire produit est-il celui du jeu, octet pour octet.
mesure_identite() {
	local t0 ms
	t0=$(now_ms)
	if [ -f dist/nie.exe ] && [ -f "$REF_EXE" ] && cmp -s dist/nie.exe "$REF_EXE"; then
		ms=$(($(now_ms) - t0))
		record_metric forge.identity 100 100 "cmp dist/nie.exe $REF_EXE"
		emit forge.identity true "$ms" "byte-identique"
	else
		ms=$(($(now_ms) - t0))
		record_metric forge.identity 0 100 "cmp dist/nie.exe $REF_EXE"
		emit forge.identity false "$ms" "dist/nie.exe absent ou divergent"
	fi
}

# 3. Les preuves uemu : l'oracle byte-exact du dépôt (lent, donc opt-in).
mesure_preuves() {
	[ "${ATLAS_PROOFS:-0}" = "1" ] || return
	local t0 out ok total ms
	t0=$(now_ms)
	out=$(bash scripts/proofs.sh 2>&1)
	ms=$(($(now_ms) - t0))
	ok=$(printf '%s' "$out" | grep -oE '[0-9]+ ✓' | tail -1 | tr -d ' ✓')
	total=$(ls scripts/validate_*.py 2>/dev/null | wc -l)
	if [ -n "$ok" ] && [ "$total" -gt 0 ]; then
		record_metric proofs.ok "$ok" "$total" "bash scripts/proofs.sh"
		emit proofs.uemu true "$ms" "$ok/$total"
		record_run proofs.uemu proofs.uemu true "$ms" "$ok/$total"
	else
		emit proofs.uemu false "$ms" "sortie sans compte lisible"
		record_run proofs.uemu proofs.uemu false "$ms" "$out"
	fi
}

# 3 bis. Le test RE réel : le serveur MCP interrogé pour de vrai, et ses réponses corroborées
# contre la table `.pdata` du binaire de référence. Opt-in : il compile nie-mcp.
mesure_re_real() {
	[ "${ATLAS_RE_REAL:-0}" = "1" ] || return
	local t0 out rc ms pct
	t0=$(now_ms)
	out=$(timeout "$ACT_TIMEOUT" cargo test -p nie-mcp --test re_real -- --nocapture 2>&1)
	rc=$?
	ms=$(($(now_ms) - t0))
	pct=$(printf '%s' "$out" | grep -oE '\(([0-9.]+) %\)' | head -1 | tr -d '() %')
	if [ "$rc" -eq 0 ] && [ -n "$pct" ]; then
		record_metric re.pdata_corroboration "$pct" 100 "cargo test -p nie-mcp --test re_real"
		emit re.real true "$ms" "corroboration .pdata = ${pct} %"
		record_run re.real re.anchoring true "$ms" "$pct"
	else
		emit re.real false "$ms" "rc=$rc $(printf '%s' "$out" | tail -1)"
		record_run re.real re.anchoring false "$ms" "$out"
	fi
}

# 4. L'index : tout le dépôt dans une seule base, plus le miroir redis.
indexer() {
	local t0 out rc ms kb_flag=()
	[ -f "$KB_DB" ] || kb_flag=(--no-kb)
	t0=$(now_ms)
	out=$("$niers_bin" atlas build --db "$ATLAS_DB" --kb "$KB_DB" --redis "$REDIS_URL" "${kb_flag[@]}" 2>&1)
	rc=$?
	ms=$(($(now_ms) - t0))
	if [ "$rc" -eq 0 ]; then
		emit atlas.build true "$ms" "$(printf '%s' "$out" | tail -1)"
	else
		emit atlas.build false "$ms" "rc=$rc $(printf '%s' "$out" | tail -1)"
	fi
}

# 5. L'action : un pas borné sur l'écart le mieux classé.
agir() {
	[ "$act" = "1" ] || return
	local gap area t0 out rc ms free
	gap=$("$niers_bin" atlas next --db "$ATLAS_DB" 2>/dev/null)
	area=$(printf '%s' "$gap" | jq -r '.area // empty' 2>/dev/null)
	[ -n "$area" ] || {
		emit atlas.next true 0 "aucun écart ouvert"
		return
	}
	free=$(free_mib)
	t0=$(now_ms)
	case "$area" in
	forge.produced | forge.code | forge.identity | forge.units)
		if [ -z "$forge_bin" ]; then
			emit "act:$area" false 0 "nie-forge absent"
			return
		fi
		if [ "$free" -lt "$MIN_FREE_MIB" ]; then
			emit "act:$area" false 0 "disque ${free} Mio < ${MIN_FREE_MIB} — étape d'écriture sautée"
			return
		fi
		out=$(timeout "$ACT_TIMEOUT" "$forge_bin" build --exe "$REF_EXE" --out dist/nie.exe 2>&1)
		rc=$?
		ms=$(($(now_ms) - t0))
		if [ "$rc" -eq 0 ]; then
			out=$("$forge_bin" verify --reference "$REF_EXE" --got dist/nie.exe 2>&1)
			rc=$?
			ms=$(($(now_ms) - t0))
		fi
		[ "$rc" -eq 0 ] && emit "act:$area" true "$ms" "build+verify" ||
			emit "act:$area" false "$ms" "$(printf '%s' "$out" | tail -1)"
		record_run "forge.build" "$area" "$([ "$rc" -eq 0 ] && echo true || echo false)" "$ms" "$out"
		mesure_identite
		;;
	re.classified | re.named | re.pdata-text)
		local exe="${NIE_EXE_RE:-${NIERS_GAME_DIR:-/home/ubuntu/.local/share/Steam/iecode/inazuma}/nie_eacpatched.exe}"
		if [ ! -f "$exe" ] || [ ! -f "$KB_DB" ]; then
			emit "act:$area" false 0 "cible RE ou KB absente"
			return
		fi
		# `rebuild` et pas `propagate` : docs/RE.md est explicite — lancer les sous-étapes
		# à la main (disasm avant rtti) produit un résultat incomplet SANS erreur.
		out=$(timeout "$ACT_TIMEOUT" "$niers_bin" rebuild --db "$KB_DB" --exe "$exe" --rounds "${NIERS_ROUNDS:-16}" 2>&1)
		rc=$?
		ms=$(($(now_ms) - t0))
		[ "$rc" -eq 0 ] && emit "act:$area" true "$ms" "$(printf '%s' "$out" | tail -1)" ||
			emit "act:$area" false "$ms" "$(printf '%s' "$out" | tail -1)"
		record_run "niers.rebuild" "$area" "$([ "$rc" -eq 0 ] && echo true || echo false)" "$ms" "$out"
		;;
	proofs.uemu)
		ATLAS_PROOFS=1 mesure_preuves
		;;
	docs.anchored)
		out=$("$niers_bin" atlas docs --db "$ATLAS_DB" --orphans --limit 10 2>&1)
		ms=$(($(now_ms) - t0))
		emit "act:$area" true "$ms" "$(printf '%s' "$out" | tail -1) — documents sans ancrage listés"
		record_run "atlas.docs" "$area" true "$ms" "$out"
		;;
	*)
		ms=$(($(now_ms) - t0))
		emit "act:$area" true "$ms" "aucune action automatique : décision humaine ou agent"
		record_run "atlas.noop" "$area" true "$ms" "$gap"
		;;
	esac
}

# --- boucle -------------------------------------------------------------------

mkdir -p "$(dirname "$LOG")"
for tick in $(seq 1 "$ticks"); do
	echo "--- atlas-loop tick $tick/$ticks $(date -Is) libre=$(free_mib)Mio ---"
	mesure_forge
	mesure_identite
	mesure_preuves
	mesure_re_real
	indexer
	agir
	"$niers_bin" atlas status --db "$ATLAS_DB"
	"$niers_bin" atlas gaps --db "$ATLAS_DB" --limit 8
done
exit 0
