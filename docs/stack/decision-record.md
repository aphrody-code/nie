# ADR — plateforme Rust multi-client

- **Date :** 2026-09-05
- **Décision :** approuvée
- **Accord A2A :** Claude, `env-fa1cdc42`
- **Périmètre :** documentation dans `rg`; aucun changement de code dans cet
  ADR

## Contexte

Azalée combine un wiki éditorial, un studio d'outils, un explorateur Tauri et
un moteur qui doit rester fidèle aux formats et aux sorties du jeu. Le dépôt
contient déjà deux réalités : le monorepo web `/home/ubuntu/rg` et le moteur
Rust `/home/ubuntu/niers`.

La contrainte produit est de partager le code de `nie-explorer` avec le studio
web. L'explorateur est une SPA React/Vite de **37 975 lignes TS/TSX mesurées**
(158 fichiers, dont 124 sans dépendance Tauri) et son hôte Tauri contient
**10 922 lignes Rust mesurées**. Une conversion totale en Leptos serait donc
un chantier de portage, pas une optimisation locale.

## Choix

### Web et données

- `Axum 0.8.9` sur `Tokio 1.53.1` pour `nie-site` et les services Rust.
- `Leptos 0.8.19` + `leptos_axum 0.8.10` pour les pages SSR/hydratées dont
  `nie-site` est propriétaire; le bundle React/Vite reste servi ou intégré
  quand le partage existant l'exige.
- `SQLx 0.9.0` avec PostgreSQL 18 comme interface SQL typée côté serveur.
- PostgreSQL/Supabase reste une capacité d'infrastructure, pas une base
  directement exposée aux clients.

### Clients

- `Tauri 2.11.5` pour l'explorateur/studio desktop et mobile, avec le frontend
  statique React/Vite actuel.
- `wgpu 30.0.1` + `winit 0.30.13` pour le renderer natif desktop/mobile/web;
  le cœur `nie-core` reste hors ECS et byte-exact.
- `steamworks 0.13.1` uniquement dans un adaptateur PC optionnel. Le crate
  actuel `nie-steam` est un outil d'acquisition de dépôts IEVR et ne publie
  pas le jeu.

## Ce qui n'est pas décidé

- Aucun remplacement immédiat du wiki Next/React.
- Aucun remplacement immédiat de l'UI React/Vite de `nie-explorer`.
- Aucun déplacement de données vers Supabase Cloud sans migration dry-run,
  vérification de schéma, mesure de latence et accord concernant les données
  personnelles.
- Aucun ajout de Steamworks dans les builds web, Android ou iOS.
- Aucun changement de `wgpu 29.0.3` dans `niers` par la seule création de ces
  documents; le passage à 30.0.1 doit être un changement compilé et testé.

## Bloqueurs qui précèdent la réécriture

Ils ont été reproduits pendant le débat A2A et ne sont pas corrigés par un
changement de framework.

1. **Réseau :** `DATABASE_URL` vise `127.0.0.1:5432/rg`; depuis Vercel,
   `127.0.0.1` désigne la machine Vercel. `NEXT_PUBLIC_SUPABASE_URL` vise par
   ailleurs le domaine Azalée, qui sert la compatibilité REST/Realtime/Storage
   sous le même hôte.
2. **N+1 :** `apps/azalee/app/chara/[id]/page.tsx:410` lançait une requête par
   technique; le gate a compté 599 requêtes sur `inagle_skills`. Le correctif
   `cf11153` est **MESURÉ comme correctif commité dans `niers`** : 1 à 2
   requêtes au lieu de N, 10 tests/0 échec/954 assertions avec les deux
   backends, cas maximal mesuré 245 techniques → 2 requêtes. Sa
   réconciliation dans `rg` et son déploiement restent à faire.
3. **Charge :** le fallback SQLite → Postgres fonctionne, mais le build forcé
   sans miroir accessible a échoué sur plusieurs fiches après trois tentatives.
   Le regroupement réduit le N+1; il ne remplace ni la mesure de charge ni la
   correction des limites de `nie-model-serve`.
4. **Exposition :** l'audit compagnon a confirmé PostgREST/Storage/Realtime
   publics, des écritures `anon` et un RPC destructif anonyme. Ce durcissement
   est un prérequis indépendant, détaillé dans [security.md](security.md).

## Historique Vercel vérifié

| Commit | Fait établi |
| --- | --- |
| `abcfb69f` | Le build Bun + Next 16 échouait au prerender de `/_global-error` (`useContext null`); un build standalone sous Node avec `node:sqlite` a été essayé. |
| `3c01c323` | Correction de la recherche de Node sur Vercel Node 24 (`exit 127`). |
| `6fe2a626` | Découpage explicite : website Vercel, Azalée VPS. |
| `2cf27f1c` | Vercel retiré du monorepo; Azalée devient VPS-first. |
| `9594ba0d` | Préparation d'un failover frontend; les services stateful restent requis sur VPS. |

**Conclusion :** ces expériences justifient la séparation des responsabilités,
pas une réécriture du wiki. Une future cible Vercel ne sera acceptable qu'avec
une base et des services réellement joignables, un N+1 validé et une API
durcie; un build vert avec le miroir SQLite local ne prouve pas la compatibilité
serverless.

## Alternatives rejetées

| Alternative | Rejet dans ce contexte |
| --- | --- |
| Actix | Très bon débit brut, mais pas le choix greenfield retenu par `best-stack-2026`; Axum offre la continuité Tokio/Tower et s'aligne sur les spécifications existantes. |
| Topcoat | Le README officiel le décrit encore comme « early-stage and experimental »; impossible de le prendre comme socle de production. |
| Dioxus | Alternative sérieuse full-stack desktop/mobile/web, mais elle ne préserve pas l'UI React/Vite exigée; à réévaluer pour un futur produit Rust-first. |
| Sycamore/Perseus/Yew | Solutions WASM valables, mais moins adaptées au contrat Axum/Leptos retenu ou à la fraîcheur/maintenance exigée. |
| Bevy / `bevy-steamworks` | ECS et abstractions de moteur incompatibles avec les structs/layouts et l'ordre byte-exact du cœur; éventuellement prototype isolé, jamais chemin canonique. |
| Tauri pour le jeu | Une webview convient à l'outil, pas au renderer et à la boucle native wgpu du jeu. |
| SQLite comme source distante | Le miroir est un cache/offline; il ne résout ni l'accès Vercel à PostgreSQL ni la charge N+1. |

## Risques et déclencheurs de révision

- **Leptos :** le projet est feature-complete mais sa maintenance est légère
  selon son mainteneur (issue officielle #4707). Revoir le choix si les mises
  à jour de sécurité, Rust ou WASM prennent du retard.
- **Tauri mobile :** valider les permissions/capabilities et le cycle de vie
  Android/iOS sur appareils réels avant promesse produit.
- **wgpu 30 :** bump séparé, avec vérification des goldens sur D3D12, Vulkan,
  Metal et WASM.
- **Steamworks :** revue juridique avant distribution; le SDK Valve n'est
  pas une dépendance open source libre et le binding peut embarquer des
  fichiers régis par les conditions Valve.
- **Données :** le projet Supabase Cloud contrôlé `kvnlbhatjqqmhhxaxlbi` était
  d'abord mesuré à 0 table. Après application vérifiée des cinq migrations, il
  contient **224 tables, 1 478 colonnes, 5 vues et 155 policies mesurées**;
  le chargement des 66 tables de données utiles n'est pas encore validé. Les
  1 931 lignes mesurées dans `auth.users` sont des données personnelles et ne
  doivent pas être migrées sans consentement et procédure de minimisation.
