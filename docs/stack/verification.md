# Vérification, CI et définition de fini

Ce document décrit les gates; il ne transforme pas une cible en fonctionnalité
livrée.

## Gate immédiat Azalée

Avant tout déploiement :

1. confirmer le commit et les fichiers réellement modifiés;
2. corriger le N+1 avec un test SQLite et Postgres;
3. lancer un seul build Next à la fois avec un chemin SQLite explicitement
   inexistant pour tester le fallback réel;
4. vérifier que PostgreSQL distant est joignable depuis l'environnement visé;
5. vérifier séparément les routes REST/Realtime/Storage et leur CORS;
6. mesurer les fiches les plus lourdes et publier p50/p95/p99.

Le build Vercel historique ne doit pas être relancé en parallèle d'un autre
processus Next. Un build vert avec une variable SQLite vide n'est pas une gate
serverless valide.

## Gate Rust web

Quand `nie-site` sera présent :

```bash
cargo fmt --all -- --check
cargo check --workspace
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo sqlx prepare --workspace
SQLX_OFFLINE=true cargo check --workspace
```

Compléter par une campagne HTTP versionnée : payloads réels, pagination,
compression, cache, auth, erreurs et p95/p99. Tester au moins le chemin avec
Postgres distant; le miroir SQLite est une campagne distincte.

## Gate WASM et plateformes

```bash
rustup target add wasm32-unknown-unknown
cargo build --target wasm32-unknown-unknown
cargo test -p nie-wasm
```

Puis, sur les toolchains natives disponibles :

```bash
bun tauri android dev
bun tauri ios dev
```

Pour chaque cible, conserver l'OS, l'architecture, le driver, la version Rust,
la version wgpu et le hash de l'artefact. Android/iOS nécessitent un smoke test
sur appareil réel; une compilation d'édition ne suffit pas.

## Gate moteur

- `cargo test` des formats, data, core et runtime;
- replay headless identique sur deux exécutions;
- captures RGBA8 et hash identiques sur chaque backend accepté;
- test de perte/recréation de surface mobile;
- absence d'ECS/physique/rasteriseur ajouté au chemin byte-exact;
- validation du bump wgpu 29 → 30 avant modification du lockfile de référence.

`nie-game --play` est un point de départ déjà présent. La définition « jouable »
exige au minimum titre, menu, match, entrée, pause/reprise, sortie propre et
replay contrôlé. **ESTIMÉ/à implémenter :** tactile, cycle mobile et tests
multi-GPU.

## Gate Steam

Sur un build PC sans secret dans le dépôt :

- démarrage depuis Steam et démarrage local avec `steam_appid.txt` dev-only;
- `SteamAPI_RestartAppIfNecessary` puis `SteamAPI_Init` vérifiés;
- overlay, identité, callbacks, achievements/stats et Cloud testés;
- appels Steam sérialisés selon les contraintes SDK;
- build sans Steam (tests/headless) toujours compilable;
- dépôt SteamPipe installé dans une branche beta, manifeste et tailles
  vérifiés, rollback exercé;
- `steam_appid.txt` absent de l'artefact final;
- revue de licence et validation partenaire effectuées.

Les identifiants d'acquisition existants dans `nie-steam` ne sont pas des
identifiants de publication; ne pas les réutiliser sans preuve.

## Gate données et confidentialité

- inventaire schéma/volume et dry-run restaurable;
- migration réversible et checksum des tables;
- aucune migration de `auth.users` sans base légale/consentement et minimisation;
- secrets uniquement variables runtime/secret manager;
- rôles Postgres minimaux, rotation et journaux sans token;
- URLs Storage signées et expiration testée;
- CORS/CSP/capabilities Tauri testés;
- chemins `/vfs`, `/raw`, `/export` et `/depot` testés contre traversal et
  dépassement de taille.

## Définition de fini

La cible n'est « jouable mobile et Steam » que lorsque les gates concernées
sont vertes et archivées avec leurs commandes, versions, artefacts, appareils,
hashes et logs. Tant que ces preuves ne sont pas produites, l'état est
**planifié**, même si le code compile ou si `--play` ouvre déjà un match.

