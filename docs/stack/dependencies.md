# Versions, licences et maintenance

Pins **gelés le 2026-09-05**. `Cargo.lock` et les manifestes sont l'autorité dès que le code
existe ; ce tableau dit ce qu'on y écrit, et ce qu'on refuse d'y écrire.

## `nie-site` — ce qui entre dans le workspace

| Crate | Version | Licence | Déjà dans `Cargo.lock` ? | Décision |
|---|---|---|---|---|
| `axum` | 0.8.9 | MIT | **non — seul vrai ajout** | serveur HTTP ; `actix-web` rejeté (hors continuité Tokio/Tower) |
| `tokio` | 1.53.1 | MIT | oui | runtime, `rt-multi-thread`, `macros`, `signal` |
| `tower` | 0.5.3 | MIT | oui | `limit`, `timeout`, `buffer` |
| `tower-http` | 0.6.11 | MIT | oui | `compression-br`, `compression-zstd`, `fs`, `trace`, `set-header`, `limit` ; 0.7.1 attendra le bump du workspace — pas deux copies |
| `hyper` | 1.11.0 | MIT | oui | transitif via Axum |
| `askama` | 0.14 | MIT OR Apache-2.0 | non | templates compilés ; `tera`/`minijinja` rejetés (parsing runtime), `maud` rejeté (DSL macro) |
| `moka` | 0.12 | MIT OR Apache-2.0 | non | cache concurrent TTL/poids ; `lru` rejeté (mono-thread, sans TTL) |
| `blake3` | 1.5 | CC0-1.0 OR Apache-2.0 | non | ETag ; `sha2` possible mais 3× plus lent sur gros corps |
| `rusqlite` | 0.37.0, feature `bundled` | MIT | oui | lecture seule des gisements ; `sqlx` rejeté (un saut réseau de trop, divergence avec l'explorateur) |
| `reqwest` | 0.13.4, `rustls-tls` | MIT OR Apache-2.0 | oui | client vers `nie-model-serve` ; `native-tls` interdit |
| `zstd` | 0.13.3 | MIT | oui | pré-compression |
| `tracing` / `tracing-subscriber` | 0.1 / **0.3.22** | MIT | oui | 0.3.23+ exclu (bug de packaging documenté) |
| `clap` | 4.6.6, `derive` | MIT OR Apache-2.0 | oui | options du binaire |
| `thiserror` | 2.0.20 | MIT OR Apache-2.0 | oui | erreurs typées ; `anyhow` seulement dans `main` |
| `parking_lot` | 0.12.5 | MIT OR Apache-2.0 | oui | verrous non-async (handle rusqlite) |
| `criterion` | 0.5 | MIT OR Apache-2.0 | non (dev) | benches `benches/routing.rs` |
| `insta` | 1.40 | MIT OR Apache-2.0 | non (dev) | snapshots des réponses |

## `nie-db` — la couche SQL native (amendement A2, hors semaine)

| Crate | Version | Licence | Dans `Cargo.lock` ? | Décision |
|---|---|---|---|---|
| `rusqlite` | 0.37.0, `bundled` | MIT | oui | back-end SQLite du trait `DataAdapter` ; 12 crates l'utilisent déjà |
| `sqlx` | 0.8, `postgres,runtime-tokio,tls-rustls,macros` | MIT OR Apache-2.0 | **non** | back-end PostgreSQL ; `query!` vérifie le SQL à la compilation. Rejetés : `tokio-postgres` seul (pas de vérification), `diesel` (modèle bloquant), `@supabase/supabase-js` (PostgREST en HTTP — une couche réseau à supprimer, pas à reproduire) |

Ce n'est pas une contradiction du refus de `sqlx` pour `nie-site` : celui-ci **lit** des
fichiers locaux (`rusqlite` plus direct), `nie-db` **écrit** vers un Postgres distant. Le
client suit la distance à la donnée. `nie-data` ne gagne aucune de ces dépendances : elle
reste le lecteur typé, sans `tokio` ni client SQL.

Toutes compatibles avec la licence du workspace ; aucune GPL/AGPL. `[workspace.lints]`
s'applique : `todo!`, `unimplemented!`, `dbg!` interdits — **aucun squelette non implémenté**,
une route existe quand elle répond et qu'un test compte sa réponse.

## Le wiki — ce qui est gelé côté Bun/Next

| Brique | Version (catalogue racine) | Décision |
|---|---|---|
| Next.js | 16.3.0-canary.37 | conservé ; runtime **Node** sur Vercel |
| React | 19 (catalogue) | conservé, `reactCompiler: true` |
| Bun | 1.4.0 | outil de build local et de scripts ; **jamais le runtime servi** |
| `@supabase/supabase-js` | catalogue | client anon ; Drizzle SQLite de Codex **écarté** du rendu web |
| `better-auth` | catalogue | auth ; tables dans le Postgres Cloud |

## Le moteur et les clients — gelés, hors semaine

| Brique | Version | Décision |
|---|---|---|
| `wgpu` | **29.0.3** (réel) | 30.0.1 = lot ultérieur, compilé et golden-testé sur D3D12/Vulkan/Metal/WASM |
| `winit` | 0.30.13 | inchangé |
| Tauri | 2.x du dépôt | enveloppe d'**Inacord** (ex `nie-explorer`) ; `productName` → `Inacord`, identifiant `dev.niers.explorer` conservé ; mobile plus tard |
| `steamworks` | 0.13.1 | **absent** du lock, et le reste : feature/crate PC isolée, revue de licence Valve d'abord |
| Leptos, Dioxus, SQLx | — | **n'entrent pas** ; voir l'ADR |

## Maintenance et sécurité Rust

- Edition 2024, toolchain `nightly-2026-05-17` épinglée par `niers` : inchangée par la semaine.
- Cargo ≥ 1.94.1 (CVE-2026-33056) ; `tar` ≥ 0.4.45 pour tout ce qui touche des archives.
- `cargo deny` refuse les licences incompatibles et les advisories ouvertes sur la crate.
- Tokio : les lectures `rusqlite` et les décodages passent par `spawn_blocking` ; rien de
  bloquant sur le chemin HTTP ; toute tâche est annulable par timeout.
- WASM : l'audit des symboles indéfinis Rust 1.96 précède toute promotion de `nie-wasm`.

## Sources primaires

- [Axum](https://github.com/tokio-rs/axum) · [tower-http](https://github.com/tower-rs/tower-http)
- [askama](https://github.com/askama-rs/askama) · [moka](https://github.com/moka-rs/moka) ·
  [blake3](https://github.com/BLAKE3-team/BLAKE3) · [rusqlite](https://github.com/rusqlite/rusqlite)
- [Next.js — Vercel runtime Node](https://nextjs.org/docs) · [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Tauri 2](https://github.com/tauri-apps/tauri) · [wgpu](https://github.com/gfx-rs/wgpu)
- [Steamworks](https://partner.steamgames.com/doc/api) · [steamworks-rs](https://github.com/Noxime/steamworks-rs)
