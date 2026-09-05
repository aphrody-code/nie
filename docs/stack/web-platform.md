# Web, API, PostgreSQL et Supabase

## Architecture cible

```text
React/Vite + Tauri desktop/mobile ─┐
Navigateur / pages Leptos ─────────┼─ HTTPS ─> nie-site (Axum/Tokio)
Jeu natif / WASM ──────────────────┘              │
                                      DTO + auth + cache/proxy
                                                   │
                              SQLx ─────> PostgreSQL 18
                              Storage/Realt. -> Supabase self-host ou managé
```

`nie-site` est un BFF/API Rust. Les clients ne reçoivent jamais une URL de
base PostgreSQL, une clé service ou une connexion PostgREST privilégiée.

## Versions retenues

| Couche | Version stable fact-checkée le 2026-09-05 | Utilisation |
| --- | --- | --- |
| Axum | 0.8.9 | routes, extracteurs, état applicatif |
| Tokio | 1.53.1 | runtime et I/O; pas de multi-thread sur la boucle déterministe |
| Leptos | 0.8.19 | pages Rust SSR/hydratées et composants nouveaux |
| `leptos_axum` | 0.8.10 | intégration SSR Axum |
| `leptos_meta` | 0.8.6 | titres, métadonnées, SEO |
| `server_fn` | 0.8.12 | fonctions serveur seulement si leur contrat est explicite |
| SQLx | 0.9.0 | PostgreSQL, requêtes compilées/préparées |
| PostgreSQL | 18 | source relationnelle cible |
| `tower-http` | 0.7.1 | compression, cache-control, tracing et limite de requêtes |
| `reqwest` | 0.13.4 | appels sortants contrôlés, TLS rustls par défaut |

Les versions 0.9 beta de Leptos et les autres prereleases ne sont pas admises
en production dans cette décision.

## Frontend et partage

Le studio web doit partager l'UI de `nie-explorer` : le premier chemin est donc
de construire le bundle React/Vite existant et de le servir depuis `nie-site`
ou depuis un hôte frontend séparé. Leptos ne remplace pas ce bundle dans le
lot initial.

Leptos sert à :

- pages SSR Rust nouvelles (documentation technique, état, diagnostics ou
  écrans explicitement Rust-first);
- shell et liens qui doivent être rendus sur le serveur;
- appels serveur dont le DTO est stable et réutilisable par React/Tauri.

Un portage total de l'UI resterait une décision ultérieure : **37 975 lignes
TS/TSX et 10 922 lignes Rust mesurées** devraient être revalidées, pas promises
comme partage gratuit.

## Contrat API

- DTO versionnés et sérialisables avec `serde`;
- erreurs HTTP stables et sans fuite de détails SQL;
- pagination obligatoire pour listes lourdes;
- chargements groupés (`getSkillsByIds`) plutôt que requête par item;
- cache public seulement pour données immuables ou explicitement publiables;
- ETags/`Cache-Control` et compression après mesure du poids réel;
- uploads/downloads lourds par URL signée Storage ou endpoint contrôlé, jamais
  par le serveur SSR sans limite.

Le port spécifié pour le nouvel hôte est `127.0.0.1:8085` en local. En
production, le reverse proxy doit publier une adresse TLS et conserver les
services stateful sur le réseau privé/VPS.

## SQLx et migrations

Le schéma doit avoir une seule source de vérité compatible avec PostgreSQL et
le pipeline de migration retenu. Le flux prévu est :

```bash
cargo sqlx prepare --workspace
SQLX_OFFLINE=true cargo check --workspace
cargo test --workspace
```

Ces commandes sont un protocole cible à activer quand le crate `nie-site` sera
présent; elles ne prétendent pas que ce crate existe déjà dans `rg`.

Les requêtes de production utilisent SQLx côté serveur. Le miroir SQLite est
un mode offline/cache et doit être testé séparément; il ne doit pas masquer
une dépendance à `127.0.0.1`.

## Supabase : choix de déploiement

PostgreSQL est le contrat canonique. Deux déploiements restent compatibles :

1. Supabase self-host sur le VPS actuel : PostgreSQL, PostgREST, Storage et
   Realtime derrière le reverse proxy privé/public nécessaire.
2. Supabase Cloud, seulement après création/vérification réelle du schéma,
   test de latence et validation RGPD.

Le projet Cloud contrôlé `kvnlbhatjqqmhhxaxlbi` était **MESURÉ vide (0 table)**
au premier contrôle. Après application vérifiée des cinq migrations via l'API
de gestion, il contient **224 tables, 1 478 colonnes, 5 vues et 155 policies
RLS mesurées**, avec idempotence contrôlée. L'inventaire local reste de 66
tables utiles, 165 244 lignes et environ 110 Mo; le chargement de ces données
est un lot séparé et n'est pas déclaré terminé. Les 1 931 lignes mesurées dans
`auth.users` sont des données personnelles; aucun script ne doit les transférer
silencieusement.

Auth : validation JWT/JWKS côté API, rotation et expiration appliquées. Les
  tokens natifs sont stockés dans le stockage sécurisé de la plateforme, jamais
  dans un fichier SQLite exportable ou dans le bundle.

Storage : URLs signées de durée courte et contrôle du chemin. Realtime :
WebSocket/SSE derrière l'API selon le besoin réel; pas de clé service côté
client. Les routes de compatibilité `/rest/v1`, `/realtime/v1` et `/storage/v1`
doivent avoir un hôte et une politique CORS explicites, pas être implicitement
servies par le domaine du wiki.

## Précondition sécurité

L'audit du 2026-09-05 a confirmé que l'infrastructure actuelle expose déjà
PostgREST, Storage et Realtime sur Internet, depuis les domaines Azalée et
Supabase. Un GET anonyme a retourné 2 105 lignes nominatives de
`discord_members`; un RPC `SECURITY DEFINER` destructif était exécutable par
`anon`, et `anon` possédait des droits d'écriture sur 129 tables. Le secret JWT
Supabase permettant de forger un rôle `service_role` a aussi été trouvé dans
des fichiers d'environnement du serveur. Aucun de ces points ne doit être
répliqué vers Vercel, Tauri ou mobile; les actions et preuves sont dans
[security.md](security.md).

## Déploiement

Le VPS reste la référence tant que la base et les services ne sont pas
externalisés. Vercel peut héberger un frontend stateless futur, mais aucun
code ne doit supposer que `127.0.0.1` est le VPS. Chaque environnement doit
exposer séparément :

- URL publique du frontend;
- URL TLS de l'API `nie-site`;
- URL privée ou signée du Storage;
- origine Realtime autorisée;
- secrets injectés au runtime serveur uniquement.
