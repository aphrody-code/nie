# Desktop et mobile — Tauri, React/Vite et Leptos

## Décision

`nie-explorer` reste une application React/Vite. `Tauri 2.11.5` l'emballe pour
desktop et Android/iOS; `nie-site` peut servir ce bundle ou un frontend web
équivalent. Leptos est ajouté uniquement aux pages Rust-first, sans supprimer
le code React partagé.

Tauri utilise les webviews système : WKWebView sur macOS/iOS, WebView2 sur
Windows, WebKitGTK sur Linux et WebView système sur Android. Cette propriété
est adaptée à un studio/outillage, pas à la boucle de rendu du jeu.

## Matrice de livraison

| Surface | Frontend | Backend | Offline |
| --- | --- | --- | --- |
| Web studio | bundle React/Vite partagé; pages Leptos ciblées | API `nie-site` HTTPS | cache explicite |
| Desktop explorer | React/Vite dans Tauri | API distante + fonctionnalités locales | oui, selon écran |
| Android/iOS explorer | même frontend, capabilities mobiles | API distante | cache limité et sécurisé |
| Jeu desktop/mobile | wgpu/winit natif | runtime local | oui pour le cœur |

## Règles de sécurité Tauri

- capabilities minimales par fenêtre et par plateforme;
- CSP et origines explicites; pas de `allow-all` en production;
- commandes Tauri limitées à des DTO validés, sans exécuter un chemin fourni
  par l'UI;
- tokens dans le keychain/Keystore/Keychain via stockage sécurisé, jamais dans
  `localStorage` exportable si un secret long terme est en jeu;
- aucune clé Supabase service-role, mot de passe PostgreSQL ou clé Steamworks
  dans le frontend;
- sidecars et accès fichiers autorisés uniquement aux répertoires nécessaires;
- téléchargement de CPK/asset avec contrôle de taille, chemin canonique et
  destination non traversable.

## Commandes de validation Tauri

Les commandes officielles à activer dans le package de l'explorer sont :

```bash
bun tauri dev
bun tauri android dev
bun tauri ios dev
```

Elles constituent des gates à exécuter sur les toolchains natives présentes;
ce dossier ne prétend pas qu'une build Android/iOS est déjà verte. Ajouter
ensuite une build release par architecture et un smoke test sur appareil réel.

## Relation avec `nie-site`

Le serveur Rust doit exposer une API stable et des assets contrôlés. Il ne doit
pas forcer le studio à réimplémenter ses composants React. Les pages Leptos
peuvent cohabiter via un shell distinct, un routage documenté ou une migration
écran par écran, mais le contrat de partage est prioritaire.

Les uploads, previews 3D et gros fichiers doivent être streamés/paginés; une
page mobile ne doit pas charger le catalogue complet des 250 000+ fichiers.

