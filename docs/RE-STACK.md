# RE-STACK — runbook de l'echafaudage de reverse-engineering niers

La stack RE est **le moyen** (resoudre nie.exe pour porter la logique en Rust), pas la fin.
Verite terrain de couverture : `docs/PLAN.md`. Architecture : `docs/ARCHITECTURE.md`.

## 1. Pre-requis (ce VPS uniquement)

- Toolchain `nightly-2026-05-17` (pin `rust-toolchain.toml` ; rustup la resout).
- Linker **mold** (impose par `.cargo/config.toml`, `target-cpu=native`).
- **redis-server** : db0 (frontiere RE + wiki), db3 (index fichiers CPK + textures).
- **sqlite3** (CLI, pour le health check) ; KB bundled via rusqlite.
- Dep path **`../aphrody`** (doit exister et compiler).
- Cible RE : `~/.local/share/Steam/iecode/inazuma/nie_eacpatched.exe` (PE x64, ~31 Mo).
- Index seed : `refs/iecode-re/research/nie-index.json` (miroir iecode, gitignore).
- Fixtures copyright (gitignore, local) : `--features real-fixtures` (nie-formats), `--features real-saves` (nie-save).

## 2. Pipeline (orchestre par `justfile`)

```
seed  →  rebuild (interne: pdata → vtable → disasm → propagate)  →  coverage
```

| Etape | Recette | Commande sous-jacente |
|---|---|---|
| Ingestion | `just re-seed` | `niers seed --db var/niers.sqlite --json refs/iecode-re/research/nie-index.json --exe <exe>` |
| Refonte .pdata | `just re-rebuild` | `niers rebuild --db var/niers.sqlite --exe <exe> --rounds 16` |
| Couverture | `just re-coverage` | `niers coverage --db var/niers.sqlite` |
| Tout | `just re-all` | les 3 ci-dessus, fail-fast |

Sortie couverture : `cov <classified>/<total> (<pct>%) named=<n> | <subsystem=count ...>`.
Couverture courante : **93,36 %** (49 280 / 52 783) — verite terrain `.pdata` (50 674 racines) + 2 109 feuilles vtable.

> L'ordre compte : `disasm` avant `rtti` produit un resultat incomplet SANS erreur. Toujours
> passer par `just re-rebuild` (qui orchestre les 4 sous-etapes en interne) plutot que les CLI brutes.

## 3. Stores

- **`var/niers.sqlite`** (~237 Mo) : KB RE. Tables clfor : `function` (52 783), `xref` (~189 k), `coverage` (snapshots), `rtti_class`, `func_str_ref`. Voir `crates/forge/nie-index/src/schema.sql`.
- **Redis db0** : frontiere BFS (`nie-queue`) + wiki. **db3** : `iev:file:index` (~250 k fichiers CPK) + `iev:tex:*`.
  - Piege : `NIERS_REDIS` surcharge TOUTES les commandes → ne pas l'exporter pour `textures`/`menu-predecode` (db3).
- **`var/*.ndjson`** : manifestes derives (cf. `var/README.md`).

## 4. Regen des artefacts (`scripts/regen-var.sh`)

Apres une MAJ du jeu ou de l'exe :
```
bash scripts/regen-var.sh --all     # KB + model-crc + g4tx
# puis purger var/model-cache/ et redemarrer nie-model-serve
```
Granulaire : `--kb`, `--models`, `--textures`.

## 5. Qualite (= job CI)

```
just check        # fmt-check + clippy -D warnings + test (sans #[ignore])
just test-real    # golden adosses aux vrais fragments (VPS uniquement)
```
Invariants : **0 warning clippy** sur tout le workspace ; `todo!`/`unimplemented!`/`dbg!` = deny ; crates jeu `#![forbid(unsafe_code)]`.
CI : `.github/workflows/ci.yml` sur runner **self-hosted** (le repo ne build pas ailleurs).

## 6. Sante & depannage

```
just health       # scripts/re-health.sh : couverture + integrite KB + EXTERN + redis + heartbeat
```

| Symptome | Cause probable | Fix |
|---|---|---|
| heartbeat `var/re-heartbeat.log` = `No such file` | `target/release/niers` absent depuis le pin 2026-05-17 | `just build` puis relancer le cron `/tmp/niers-re-heartbeat.sh` |
| `niers coverage` → « aucun binaire indexe » | seed jamais lance | `just re-seed` |
| model-serve 502 « decodage indisponible » | cache CPK RAM sature → exit | `systemctl is-active nie-model-serve` ; `Restart=always` + budget 8 GiB |
| `niers textures` ecrit dans db0 | `NIERS_REDIS` exporte | unset `NIERS_REDIS`, passer `--redis-url redis://127.0.0.1/3` |
| `/tex/...g4tx.png` 404 | double extension | URL = `/tex/<chemin-SANS-.g4tx>.png` |
| dette de portage | nie-engine = squelette | `// EXTERN:` non portes (cf. health, ~492 marqueurs) |

## 7. Sous-commandes niers (binaire `target/release/niers`)

`seed`, `rtti`, `index`, `pdata`, `rebuild`, `disasm`, `propagate`, `coverage`, `queue`,
`textures`, `uniform-map`, `menu-predecode`, `save`, `wiki`, `mem` (runtime, nie-trace).
Non sur le PATH : invoquer a nu `target/release/niers`.
