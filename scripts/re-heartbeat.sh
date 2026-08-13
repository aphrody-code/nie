#!/usr/bin/env bash
# re-heartbeat.sh — une passe de rafraichissement de la KB RE, journalisee dans
# var/re-heartbeat.log. Concu pour cron (horaire), pas pour un demon : la version
# precedente etait un `nohup` en boucle, dont le pid mourait au moindre reboot et
# ne laissait qu'un var/re-heartbeat.pid perime (observe : log arrete au 2026-07-08).
#
# Idempotent : `niers rebuild` fait des upserts sur la base.
# Lecture de l'etat : `bash scripts/re-health.sh` (section « Heartbeat RE »).
#
# Toute sortie anormale est journalisee ET renvoyee en code 0 : un cron horaire qui
# echoue arrose la boite mail locale sans rien apprendre de plus que le log.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 0

LOG="var/re-heartbeat.log"
DB="${NIERS_DB:-var/niers.sqlite}"
GAME_DIR="${NIE_GAME_DIR:-${NIERS_GAME_DIR:-/home/ubuntu/.local/share/Steam/iecode/inazuma}}"
EXE="${NIE_EXE:-$GAME_DIR/nie_eacpatched.exe}"
BIN="target/release/niers"
ROUNDS="${NIERS_ROUNDS:-16}"

log() { printf '[%s] %s\n' "$(date -Is)" "$1" >>"$LOG"; }

[ -x "$BIN" ] || { log "ERREUR heartbeat: binaire absent ($BIN) — cargo build --release -p nie-cli"; exit 0; }
[ -f "$EXE" ] || { log "ERREUR heartbeat: cible RE absente ($EXE)"; exit 0; }
# La base peut avoir ete deposee en archive froide (cf. var/niers.sqlite.archive-froid.json,
# ~7,2 Gio) pour tenir le disque du VPS. Le dire clairement plutot que de laisser
# `niers rebuild` echouer sur une erreur sqlite opaque.
[ -f "$DB" ] || {
	log "ERREUR heartbeat: KB absente ($DB) — archive froide, cf. var/niers.sqlite.archive-froid.json ; restaurer via rsync depuis l'hote d'archive, ou reconstruire avec 'just re-seed'"
	exit 0
}

out="$("$BIN" rebuild --db "$DB" --exe "$EXE" --rounds "$ROUNDS" 2>&1)"
line="$(printf '%s\n' "$out" | grep -E '^rebuild roots=' | tail -1)"
if [ -n "$line" ]; then
	log "$line"
else
	log "ERREUR heartbeat: rebuild sans ligne de mesure — $(printf '%s\n' "$out" | tail -1)"
fi
exit 0
