# Stack 2026 — décision

**Statut : décision approuvée le 2026-09-05.** Accord explicite de Claude via
A2A, enveloppe `env-fa1cdc42`. Ce dossier ne modifie aucun code : il fixe les
frontières et les vérifications du futur chantier.

## Décision en une phrase

Rust devient la plateforme des nouveaux services et du moteur jouable, avec
`Axum + Tokio + SQLx + PostgreSQL` et `wgpu + winit`; `Leptos` est retenu pour
le nouvel hôte Rust `nie-site`, tandis que le wiki Next/React et l'interface
React/Vite de `nie-explorer` restent en place pour préserver le partage
existant. `Tauri` fournit l'explorateur/studio desktop et mobile; le jeu
mobile et Steam utilisent le renderer natif wgpu, pas une webview.

## Cartographie cible

| Produit | Hôte retenu | Rôle | Statut réel |
| --- | --- | --- | --- |
| Wiki Azalée | Next.js + Bun, VPS self-host | Production actuelle; failover frontend possible | Existant, à stabiliser |
| `nie-explorer` / studio | React + Vite + Tauri 2 | UI partagée desktop/mobile | Existant, à conserver |
| `nie-site` | Axum 0.8 + Tokio + Leptos 0.8 | Nouvel hôte Rust : bundle, SSR ciblé, cache, proxy | Spécification, pas une réécriture livrée |
| API données | Axum + SQLx + PostgreSQL 18 | BFF/API DTO pour navigateur et clients natifs | Cible |
| Jeu desktop/mobile | `nie-core` + `nie-runtime` + `nie-render3d` + wgpu/winit | Exécution et rendu déterministes | Moteur existant, hôtes à durcir |
| Jeu Steam | Adaptateur PC `steamworks` séparé | Init Steam, overlay, stats, Cloud, livraison SteamPipe | À implémenter |

## Ordre obligatoire

Une migration de framework ne doit pas retarder les corrections mesurées du
service actuel.

1. Réconcilier `rg` et `niers`, puis figer les contrats de données.
2. Corriger les trois bloqueurs Azalée : `127.0.0.1` inaccessible depuis un
   hébergeur distant, N+1 de `/chara`, et `supabase-compat.inc` sous le domaine
   du site.
3. Nettoyer et extraire les contrats/assets partagés sans casser React/Vite.
4. Construire `nie-site` avec l'API DTO et le bundle existant; ajouter Leptos
   seulement aux pages dont Rust est propriétaire.
5. Mesurer charge, p95/p99, poids `/chara` et cache avant toute bascule.
6. Ajouter l'hôte mobile natif du jeu et le compagnon Tauri mobile.
7. Ajouter l'adaptateur Steam PC, puis publier une branche/beta Steam testée.

Les lots 1 à 5 restent prioritaires; mobile et Steam réutilisent le moteur et
ne justifient pas une réécriture ECS ou webview.

## Règle de preuve

Chaque chiffre de ce dossier est marqué **MESURÉ**, **ESTIMÉ** (objectif ou
ordre de grandeur), ou **À VÉRIFIER**. Une mesure doit indiquer sa commande,
son hôte et sa date. Les benchmarks de framework ne remplacent pas les gates
fonctionnelles, de déterminisme et de latence de ce projet.

## État actualisé

- Le schéma Supabase Cloud a depuis été appliqué et vérifié : **224 tables,
  1 478 colonnes, 5 vues et 155 policies RLS mesurées**. Le chargement des
  données utiles reste à vérifier; le projet n'est donc pas déclaré prêt.
- Le N+1 a un correctif dédié `cf11153` dans `niers`, avec comparaison unitaire
  / lot sur les deux backends. La réconciliation et la validation dans le
  déploiement `rg` restent nécessaires.
- L'audit sécurité a trouvé des expositions publiques et un RPC destructif
  anonyme sur l'infrastructure actuelle. Elles sont indépendantes de la
  bascule et bloquent toute ouverture supplémentaire; voir
  [sécurité](security.md).

## Documents

- [Décision et alternatives](decision-record.md)
- [Benchmarks et mesures](benchmarks.md)
- [Web, API, PostgreSQL et Supabase](web-platform.md)
- [Moteur, mobile, WASM et Steam](game-platforms.md)
- [Desktop et mobile Tauri](desktop-mobile.md)
- [Sécurité et prérequis d'exposition](security.md)
- [Versions, licences et maintenance](dependencies.md)
- [Vérification, CI et définition de fini](verification.md)
