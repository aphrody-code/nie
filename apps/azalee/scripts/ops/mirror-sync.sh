#!/usr/bin/env bash
# Refresh atomique du miroir SQLite servi par azalee.
# Dump Supabase (tables inagle_* uniquement = pas de PII) -> nouveau snapshot daté ->
# validation -> swap atomique du symlink mirror.sqlite -> rétention (garde 2) -> restart.
# Lancé par azalee-mirror-sync.service (timer). Idempotent, ne swappe QUE si le dump est valide.
set -euo pipefail

APP=/home/ubuntu/rg/apps/azalee
BACKUPS="$APP/data/backups"
BUN=/home/ubuntu/.bun/bin/bun
cd "$APP"

# DATABASE_URL vient de l'EnvironmentFile (.env) du service.
STAMP=$(date -u +%Y-%m-%dT%H-%M-%S)
OUT="$BACKUPS/supabase-${STAMP}.sqlite"

echo "[mirror-sync] dump inagle_* -> $OUT"
"$BUN" scripts/ops/backup-supabase-to-sqlite.ts --prefix=inagle_ --output="$OUT"

# Validation : le snapshot doit exister, peser > 1 Mo et contenir inagle_characters peuplée.
if [ ! -f "$OUT" ]; then echo "[mirror-sync] ABORT: dump absent"; exit 1; fi
SIZE=$(stat -c%s "$OUT")
CHARS=$("$BUN" -e "import{Database}from'bun:sqlite';const d=new Database(process.argv[1],{readonly:true});console.log(d.prepare('SELECT count(*) c FROM inagle_characters').get().c)" "$OUT" 2>/dev/null || echo 0)
if [ "$SIZE" -lt 1000000 ] || [ "${CHARS:-0}" -lt 1000 ]; then
  echo "[mirror-sync] ABORT: dump invalide (size=$SIZE chars=$CHARS) — on garde l'ancien miroir"
  rm -f "$OUT"
  exit 1
fi
echo "[mirror-sync] dump OK (size=$SIZE chars=$CHARS)"

# Swap atomique du symlink.
ln -sfn "$(basename "$OUT")" "$BACKUPS/mirror.sqlite"
echo "[mirror-sync] mirror.sqlite -> $(basename "$OUT")"

# Rétention : garder les 2 snapshots les plus récents (+ le symlink), purger le reste.
ls -1t "$BACKUPS"/supabase-*.sqlite 2>/dev/null | tail -n +3 | xargs -r rm -f
echo "[mirror-sync] rétention OK ; restants: $(ls -1 "$BACKUPS"/supabase-*.sqlite | wc -l)"

# Republication sans coupure pour que le singleton readonly rouvre le nouveau miroir.
# `reload` rejoue la bascule bleu/vert sur la version déjà en production : le nouveau
# processus est démarré et sondé à côté de l'ancien, nginx ne bascule qu'ensuite. Un
# `systemctl restart` rendait le wiki injoignable chaque nuit le temps du démarrage.
/home/ubuntu/.bun/bin/bun /home/ubuntu/rg/scripts/ops/deploy.ts reload azalee

# Les autres consommateurs du miroir détectent désormais le swap tout seuls
# (vérification d'inode dans `packages/azalee/src/db/sqlite-client.ts`), mais un
# redémarrage leur évite d'attendre l'intervalle de fraîcheur et repart sur un
# descripteur propre. Ils sont sans état : l'interruption est imperceptible.
#
# `nie-model-serve` est un consommateur depuis qu'on lui passe `--db` (il sert
# /story-scene depuis le miroir). Étant en Rust, il n'a PAS la vérification
# d'inode ci-dessus : sans redémarrage il garderait un descripteur ouvert sur le
# dump précédent, que la rétention (garde 2) finit par délier — /story-scene se
# figerait alors sur des données mortes sans rien signaler.
for unite in azalee-api.service rg-mcp.service nie-model-serve.service; do
  systemctl is-active --quiet "$unite" && sudo systemctl restart "$unite" && echo "[mirror-sync] $unite redémarré"
done

# Next met parfois plus de quatre secondes à répondre après un redémarrage :
# une sonde unique renvoyait alors 503 et faisait échouer l'unité alors que la
# synchronisation, elle, avait réussi. On attend jusqu'à 60 s.
HC=000
for _ in $(seq 1 30); do
  sleep 2
  HC=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3003/api/health || echo 000)
  [ "$HC" = "200" ] && break
done
echo "[mirror-sync] restart OK, health=$HC"
[ "$HC" = "200" ] || { echo "[mirror-sync] WARN health!=200 après 60 s"; exit 1; }
