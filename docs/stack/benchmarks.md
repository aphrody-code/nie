# Benchmarks et preuves

## Règles de lecture

Un benchmark de framework mesure une charge synthétique. Il ne mesure pas la
réussite d'Azalée, la compatibilité Supabase, le rendu GPU, le déterminisme ou
le coût d'une migration. Les valeurs ci-dessous ne sont comparées qu'à
méthodologie et environnement indiqués.

## HTTP et base de données

Le benchmark public [Rullst/Benchmarks](https://github.com/Rullst/Benchmarks)
est une suite de fournisseur, mise à jour le 2026-06-22. Elle utilise
PostgreSQL 15, Ryzen 7 5700U 8C/16T, 8 Gio et Docker/WSL2. **MESURÉ par cette
suite, non reproduit dans ce dépôt.**

| Framework | JSON RPS | DB single RPS | p99 | RAM | Efficacité annoncée |
| --- | ---: | ---: | ---: | ---: | ---: |
| Actix | 128 654,31 | 12 366,90 | 2,34 ms | 18,98 MiB | 6,778 |
| Axum | 100 620,33 | 18 033,16 | 2,61 ms | 21,97 MiB | 4,580 |
| Dioxus | 87 638,05 | 9 431,99 | 2,79 ms | 25,42 MiB | 3,448 |
| Leptos | 77 135,01 | 8 009,00 | 2,94 ms | 25,51 MiB | 3,024 |

La valeur DB d'Axum est intéressante pour le profil API, mais elle ne prouve
pas le p95 de `nie-site`. Les résultats restent directionnels : suite
non-neutre, machine unique, versions et réglages de chaque implémentation.

[TechEmpower Round 23](https://www.techempower.com/benchmarks/) couvre texte,
JSON, base, templates et XSS. L'issue officielle
[#9589](https://github.com/TechEmpower/FrameworkBenchmarks/issues/9589) signale
un échec de build Actix dans cette ronde; il n'y a donc pas ici de comparaison
Axum/Actix propre à transformer en décision.

Le [JS Framework Benchmark](https://krausest.github.io/js-framework-benchmark/current.html)
mesure DOM, CPU, mémoire, démarrage et taille navigateur. Il contient des
versions de Leptos, Dioxus, Sycamore et Yew, mais ne mesure ni SSR Axum, ni
SQLx, ni auth, ni Supabase. La variance navigateur/machine est documentée dans
la [discussion Chrome 150](https://github.com/krausest/js-framework-benchmark/discussions/2044).

## Mesures internes `niers`

**MESURÉ le 2026-08-11** par `bench/run-all.ps1`, Windows 11 x86-64, machine
au repos, trois échauffements et sept mesures médianes; les commandes sont
reproduites dans `/home/ubuntu/niers/docs/BENCHMARKS.md`.

| Noyau (débit en Mio/s) | Rust | C++ | C# JIT | C# AOT |
| --- | ---: | ---: | ---: | ---: |
| CRC32, 64 Mio | 2 312 | **2 943** | 606 | 600 |
| CRILAYLA, 14,6 → 28,9 Kio | 626 | 553 | **817** | 711 |
| G4TX → PNG, 2640×1200 BC7 | **659 ms** | n/a | 7 169 ms | — |

Le pipeline complet G4TX → PNG favorise Rust dans cette campagne; l'algorithme
et les flags comptent davantage que le langage. La comparaison de pixels Rust
et C# sur `story01_00.g4tx` a mesuré un écart maximal nul; cela valide la
conversion, pas le rendu du jeu.

Commandes de référence :

```bash
cargo build --release -p nie-bench
pwsh bench/cpp/build.ps1
dotnet build bench/cs/Bench.csproj -c Release
target/release/nie-bench crc32 --mib 64
bench/cpp/bench.exe crc32-slice8 64
```

## Gate serverless Azalée — trois runs le 2026-09-05, VPS

| Run | Origine réellement visée | Résultat | Ce qu'il prouvait |
|---|---|---|---|
| 1 — `EXIT_REEL=1`, 14 250 lignes de log | PostgREST du VPS (`:8811`), avant `cf11153` | 776 replis, 599 requêtes `inagle_skills`, fiches en échec après 3 tentatives | le N+1, et que le repli SQLite → Postgres fonctionne |
| 2 — « faux vert », `EXIT_REEL=0`, 70/70 pages | **PostgREST du VPS**, alors que le Cloud était annoncé | `/chara` 200 en 87 ms, 136 921 o, **0 lien** | rien : `SUPABASE_INTERNAL_URL=http://127.0.0.1:8811` de `.env.local` passait avant l'URL Cloud dans `pickUrl()` |
| 3 — `scripts/ops/gate-serverless.sh`, `EXIT_REEL=0`, 120/120 | **Supabase Cloud**, miroir `/nonexistent`, 1 114 replis `SQLITE_CANTOPEN` | `/chara` **200 liens**, `/skill` 60, `/item` 48, `/equipe` 208, `/chara/mark-evans` 200 ; TTFB `/` 17 ms, `/chara` 52 ms, fiche 6 ms | **le wiki rend ses données sans fichier local** |

Le run 2 est la mesure la plus importante des trois : il montre qu'un code de sortie, un
nombre de pages et un code HTTP peuvent tous être verts sur un site vide. Le run 3 ne vaut
que par ses **comptes**. Aucune latence Vercel → eu-west-3 n'existe encore : elle se mesure
sur la preview de J2, pas depuis le VPS.

### Validation du correctif N+1

**MESURÉ le 2026-09-05** dans le commit `cf11153` de `niers` :
`getSkillsByIds` reproduit les deux branches d'identification de `getSkill` et
son post-traitement. La comparaison stricte unitaire/lot a donné 10 tests,
0 échec et 954 assertions sur SQLite et Postgres via `rg-postgrest` local.
Pour la fiche `fei`, le nombre est passé de 4 à 1 requête SQLite et de 6 à 1
Postgres; le cas le plus lourd mesuré est passé d'environ 245 à 2 requêtes.
Cette mesure valide le patch, pas encore le déploiement de la branche `rg` ni
la latence de production.

### État de la base distante

**MESURÉ le 2026-09-05** via l'API de gestion Supabase : le projet Cloud est
passé de 0 table à 224 tables, 1 478 colonnes, 5 vues et 155 policies RLS;
les cinq migrations ont été rejouées avec succès et l'idempotence contrôlée.
Le chargement complet a ensuite rendu 65 tables, 165 277 lignes et 0 écart
exact. `skill_videos` a été rejouée après correction de l'ordre FK (1 211 →
1 211). L'ancien inventaire local 66/165 244 doit être rapproché du manifeste
du loader (`11ee9e0`); aucun chiffre de latence Vercel n'est disponible.

## Mesures à obtenir avant bascule

Les objectifs suivants sont **ESTIMÉS**, pas des résultats.

- **Page fiche** — mesurer le p95 sans miroir local; conserver URL, corpus,
  nombre de requêtes et p50/p95/p99.
- **`/chara`** — mesurer le budget de poids mobile par breakpoint; conserver
  trace réseau et poids compressé.
- **API `nie-site`** — mesurer le p95 sous charge représentative; conserver
  outil, concurrence, payload et version.
- **Postgres/Supabase** — mesurer la latence régionale réelle sur un
  déploiement actif; conserver timestamp et séries.
- **Client Tauri mobile** — mesurer démarrage et mémoire sur appareils Android
  et iOS nommés.
- **Jeu** — conserver hash de replay et captures RGBA8 avec corpus,
  GPU/backend et logs.

Ne pas annoncer une latence « Vercel → eu-west-3 » avant d'avoir un projet
Vercel actif et une mesure horodatée; aucune latence de ce type n'était
disponible lors de la décision.
