# Versions, licences et maintenance

Versions stables relevées le **2026-09-05**. Les numéros sont des pins de
planification; Cargo.lock et les manifests sont l'autorité lorsque le code sera
modifié.

## Pins principaux

| Brique | Version | Licence déclarée / régime | Décision |
| --- | --- | --- | --- |
| Leptos | 0.8.19 | MIT | pages Rust-first; maintenance légère à surveiller |
| `leptos_axum` | 0.8.10 | MIT | SSR Axum |
| Axum | 0.8.9 | MIT | API et `nie-site` |
| Tokio | 1.53.1 | MIT | I/O et runtime |
| SQLx | 0.9.0 | MIT OR Apache-2.0 | PostgreSQL côté serveur |
| PostgreSQL | 18 | PostgreSQL License | source relationnelle |
| Tauri | 2.11.5 | Apache-2.0 OR MIT | wrapper studio/explorer |
| wgpu | 30.0.1 cible; 29.0.3 existant | MIT OR Apache-2.0 | GPU cross-platform |
| winit | 0.30.13 | Apache-2.0 | fenêtre/input |
| `steamworks-rs` | 0.13.1 | MIT OR Apache-2.0 pour le binding; SDK Valve séparé | adaptateur PC optionnel |
| `tower-http` | 0.7.1 | MIT OR Apache-2.0 | middleware HTTP |
| `reqwest` | 0.13.4 | MIT OR Apache-2.0 | HTTP sortant contrôlé |
| `serde` / `serde_json` | 1.x | MIT OR Apache-2.0 | DTO hors chemin byte-exact |

Les licences Supabase varient selon les composants auto-hébergés; la version
déployée doit être inventoriée et validée séparément.

## SDK Steamworks

Le binding Rust ne transforme pas le SDK Valve en logiciel libre. Le SDK et ses
binaires sont distribués sous les conditions Steamworks; le dépôt de binding
contient aussi les fichiers/conditions associés. **MESURÉ lors du débat :**
`steamworks` est absent du `Cargo.lock` actuel et aucune dépendance de
publication Steam n'est déclarée. Il faut donc une feature/crate PC isolée et
une revue de licence avant ajout.

Sources : [Steamworks API](https://partner.steamgames.com/doc/api),
[initialisation](https://partner.steamgames.com/doc/sdk/api?l=english),
[SteamPipe](https://partner.steamgames.com/doc/sdk/uploading?language=en) et
[steamworks-rs](https://github.com/Noxime/steamworks-rs).

## Écart entre le skill et le fact-check

Le skill `best-stack-2026` donne un baseline utile mais antérieur aux versions
stables relevées aujourd'hui. La décision conserve sa méthode (version exacte,
alternative, raison, licence, maintenance) et actualise les pins :

| Baseline du skill | Fact-check actuel | Règle |
| --- | --- | --- |
| Leptos 0.7 | Leptos 0.8.19 | stable uniquement; 0.9 beta exclu |
| wgpu 25 | wgpu 30.0.1 | upgrade contrôlé depuis 29.0.3 |
| Dioxus 0.6 | Dioxus 0.7.10 | alternative documentée, non retenue |
| Axum 0.8 | Axum 0.8.9 | retenu |

## Maintenance et sécurité Rust

- Edition 2024 et toolchain `nightly-2026-05-17` sont actuellement épinglées
  par `niers`; ne pas les changer par ce document.
- Les builds WASM doivent faire l'audit du changement de symboles indéfinis
  Rust 1.96 avant promotion.
- Utiliser Cargo corrigé pour CVE-2026-33056 (Cargo >= 1.94.1 selon le skill)
  et vérifier le lockfile en CI.
- `cargo deny` doit utiliser un `tar` corrigé (>= 0.4.45 selon le skill) et
  refuser les licences incompatibles avec le workspace.
- Tokio blocking : isoler les opérations CPU/fichiers lourdes; rendre les
  tâches annulables et ne pas bloquer l'executor sur le chemin HTTP.

## Alternatives de maintenance

Topcoat 0.6.2 est actif mais son README officiel le qualifie encore
« early-stage and experimental » : rejet production. Leptos est plus mûr pour
le besoin SSR retenu, mais son maintien léger est un risque explicite. Dioxus
0.7.10 reste le plan B si le produit devient réellement Rust-first sur toutes
les plateformes et si le coût de portage React est accepté.

## Sources primaires

- [Leptos Book — SSR](https://book.leptos.dev/ssr/index.html) et
  [dépôt Leptos](https://github.com/leptos-rs/leptos)
- [Axum](https://github.com/tokio-rs/axum) et
  [Topcoat](https://github.com/tokio-rs/topcoat)
- [Tauri](https://github.com/tauri-apps/tauri) et
  [documentation mobile](https://v2.tauri.app/start/prerequisites/)
- [wgpu](https://github.com/gfx-rs/wgpu) et sa matrice de backends
- [Bevy 0.19](https://bevy.org/news/bevy-0-19/)
- [API Steamworks](https://partner.steamgames.com/doc/api),
  [initialisation](https://partner.steamgames.com/doc/sdk/api?l=english) et
  [SteamPipe](https://partner.steamgames.com/doc/sdk/uploading?language=en)
- [TechEmpower](https://www.techempower.com/benchmarks/) et
  [JS Framework Benchmark](https://krausest.github.io/js-framework-benchmark/)
