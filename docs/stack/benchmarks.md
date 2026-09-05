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

| Noyau | Rust | C++ | C# JIT | C# AOT |
| --- | ---: | ---: | ---: | ---: |
| CRC32 slicing-by-8, 64 Mio | 2 312 Mio/s | **2 943 Mio/s** | 606 Mio/s | 600 Mio/s |
| CRILAYLA, 14,6 Kio → 28,9 Kio | 626 Mio/s | 553 Mio/s | **817 Mio/s** | 711 Mio/s |
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

## Gate serverless Azalée

**MESURÉ pendant le débat A2A le 2026-09-05.** Le gate correct a été lancé
depuis `apps/azalee` avec `SQLITE_DB_PATH=/nonexistent/mirror.sqlite`; le log
`/tmp/gate-vercel.log` indiquait `EXIT_REEL=1` sur 14 250 lignes.

- 776 replis vers Postgres;
- 599 requêtes `inagle_skills` et 125 `inagle_characters` attribuées au
  chargement des fiches;
- échec de `/chara/<slug>` après trois tentatives pour plusieurs fiches,
  dont `astro-lor`, `fei`, `kevin`, `maxwell-carson` et `nathan-swift`;
- le repli n'est pas structurellement cassé : `createSqliteClient()` construit
  un objet paresseux et `getSqliteDb()` est appelé dans le `try` de
  `apps/azalee/lib/supabase/server.ts`; le log des replis le démontre.

Le build avec `SQLITE_DB_PATH` vide n'est pas une preuve serverless : les
replis 3 et 4 peuvent retrouver le miroir local. Une campagne fiable doit
forcer une base distante joignable, enregistrer le code de sortie réel et
séparer build de données de build de frontend.

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
Le chargement des données (66 tables utiles, environ 165 244 lignes et 110 Mo)
reste un lot distinct; aucun chiffre de latence Vercel n'est disponible.

## Mesures à obtenir avant bascule

Les objectifs suivants sont **ESTIMÉS**, pas des résultats.

| Gate | Cible à définir puis mesurer | Preuve attendue |
| --- | --- | --- |
| Page fiche | p95 acceptable sans miroir local | URL, corpus, nombre de requêtes, p50/p95/p99 |
| `/chara` | budget de poids mobile par breakpoint | trace réseau et poids compressé |
| API `nie-site` | p95 sous charge représentative | outil, concurrence, payload et version |
| Postgres/Supabase | latence régionale réelle | déploiement réel, timestamp, plusieurs séries |
| Client Tauri mobile | démarrage et mémoire | appareils Android/iOS nommés |
| Jeu | hash de replay et captures RGBA8 | corpus, GPU/backend, hash et logs |

Ne pas annoncer une latence « Vercel → eu-west-3 » avant d'avoir un projet
Vercel actif et une mesure horodatée; aucune latence de ce type n'était
disponible lors de la décision.
