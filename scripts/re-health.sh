#!/usr/bin/env bash
# re-health.sh — sante de la stack RE niers. Lecture seule (n'ecrit rien).
# Usage : bash scripts/re-health.sh   (ou `just health`)
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

DB="${NIERS_DB:-var/niers.sqlite}"
BIN="target/release/niers"
GAME_DIR="${NIERS_GAME_DIR:-/home/ubuntu/.local/share/Steam/iecode/inazuma}"
EXE="$GAME_DIR/nie_eacpatched.exe"

ok(){ printf '  \033[32mOK\033[0m  %s\n' "$1"; }
ko(){ printf '  \033[31mKO\033[0m  %s\n' "$1"; }
hdr(){ printf '\n=== %s ===\n' "$1"; }

hdr "Binaire & cible"
[ -x "$BIN" ] && ok "niers build present ($BIN)" || ko "niers ABSENT — cargo build --release -p nie-cli"
[ -f "$EXE" ] && ok "cible RE present ($(du -h "$EXE" | cut -f1))" || ko "exe RE ABSENT: $EXE"
[ -f "$DB" ]  && ok "KB sqlite ($(du -h "$DB" | cut -f1))" || ko "KB ABSENTE: $DB — just re-seed"

hdr "Integrite KB (sqlite3)"
if command -v sqlite3 >/dev/null && [ -f "$DB" ]; then
  for t in binary function xref coverage rtti_class func_str_ref; do
    n=$(sqlite3 "$DB" "SELECT COUNT(*) FROM $t" 2>/dev/null)
    if [ -n "$n" ] && [ "$n" -gt 0 ]; then ok "table $t = $n"; else ko "table $t vide/absente"; fi
  done
  echo "  --- snapshots couverture ---"
  sqlite3 -header -column "$DB" \
    "SELECT ts, total_funcs, classified, printf('%.2f',pct) pct, named FROM coverage ORDER BY ts DESC LIMIT 5" 2>/dev/null \
    | sed 's/^/  /'
else
  ko "sqlite3 absent ou KB absente — saute l'integrite"
fi

hdr "Couverture (niers coverage)"
if [ -x "$BIN" ] && [ -f "$DB" ]; then
  "$BIN" coverage --db "$DB" 2>&1 | sed 's/^/  /'
else
  ko "impossible (binaire ou KB manquant)"
fi

hdr "Dette de portage nie-engine (// EXTERN:)"
total=0
for f in crates/archive/nie-engine/src/*.rs; do
  c=$(grep -c '// EXTERN:' "$f" 2>/dev/null || true)
  c=${c:-0}
  total=$((total + c))
  [ "$c" -gt 0 ] && printf '  %4d  %s\n' "$c" "$(basename "$f")"
done
echo "  ----"
echo "  EXTERN_total=$total (fonctions C non encore portees en Rust)"

hdr "Dette workspace (todo/unimplemented/dbg = deny, doit etre 0)"
debt=$(grep -rnE 'todo!|unimplemented!|dbg!' crates/*/src 2>/dev/null | grep -vc '//') || debt=0
[ "$debt" -eq 0 ] && ok "0 marqueur interdit" || ko "$debt marqueurs (clippy deny)"

hdr "Stores live"
for db in 0 3; do
  if redis-cli -u "redis://127.0.0.1/$db" ping >/dev/null 2>&1; then ok "redis db$db up"; else ko "redis db$db DOWN"; fi
done
if systemctl is-active --quiet nie-model-serve 2>/dev/null; then ok "nie-model-serve actif"; else ko "nie-model-serve inactif (502 possibles)"; fi

hdr "Heartbeat RE"
HB=var/re-heartbeat.log
if [ -f "$HB" ]; then
  last=$(tail -2 "$HB")
  if echo "$last" | grep -q 'No such file'; then ko "heartbeat CASSE (binaire absent) — `just build` puis relancer le cron"; else ok "heartbeat: $(tail -1 "$HB")"; fi
else
  ko "$HB absent"
fi
echo
