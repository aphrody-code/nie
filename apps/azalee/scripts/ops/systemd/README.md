# Industrialisation du miroir SQLite azalee (décision docs/decision-archi-donnees-azalee.md)

- `azalee-mirror-sync.{service,timer}` : refresh quotidien (04:00) du miroir = dump Supabase
  des tables `inagle_*` UNIQUEMENT (pas de PII) → swap atomique du symlink `mirror.sqlite`
  → rétention (2 snapshots) → restart `azalee-web.service`. Wrapper : `../mirror-sync.sh`.
- Épinglage : `/etc/systemd/system/azalee-web.service.d/override.conf` ajoute
  `Environment=SQLITE_DB_PATH=/home/ubuntu/rg/apps/azalee/data/backups/mirror.sqlite`
  (sinon getSqlitePath prend le nom lexico-latest = source silencieuse).
- Installer : `sudo cp *.{service,timer} /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now azalee-mirror-sync.timer`.
