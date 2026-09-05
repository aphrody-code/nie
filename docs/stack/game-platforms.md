# Moteur, mobile, WASM et Steam

> **Gelé le 2026-09-05 — hors semaine.** Rien de ce document n'est exécuté par
> [`/PLAN.md`](../../PLAN.md) : `wgpu` reste en 29.0.3, aucun hôte mobile ni adaptateur
> Steam n'est commencé. Les spécifications ci-dessous restent la référence quand leur lot
> s'ouvrira ; d'ici là, elles ne changent que par amendement daté de l'ADR.

## Principe

Le jeu ne sera pas réécrit pour satisfaire les plateformes. Les hôtes
réutilisent le moteur déjà présent et gardent la séparation : logique pure,
données/formats, runtime, rendu, plateforme.

**MESURÉ dans `niers` :** environ 23 000 lignes Rust réparties entre
`nie-core` (10 117), `nie-game` (4 671), `nie-render3d` (3 353), `nie-wasm`
(1 937), `nie-app` (1 623), `nie-runtime` (910), `nie-headless` (285) et
`nie-play` (206). Les chiffres proviennent de l'inventaire A2A du 2026-09-05;
ils devront être régénérés par `rg --files`/outil de comptage au moment du
lot de code.

## Composition

- **Logique** — `nie-core`; structs/layouts et ordre d'itération préservés.
- **Données** — `nie-formats`, `nie-data`; formats propriétaires, VFS et
  fixtures.
- **Runtime** — `nie-runtime`, `nie-app`; boucle sans règle GPU.
- **Fenêtre/input** — `winit 0.30.13`; adaptateur par plateforme.
- **GPU** — `wgpu 30.0.1` cible; bump contrôlé depuis 29.0.3.
- **Buffer/layout** — `bytemuck 1.25`; uniquement si le layout est vérifié.
- **Async utilitaire** — Tokio `rt` current-thread sur le chemin de jeu; aucun
  réordonnancement caché.
- **Web** — `nie-wasm` + WebGPU/WebGL2; cible distincte de la parité native.

Le `wgpu 29.0.3` est la version réellement déclarée dans le workspace
`niers`; `30.0.1` est la version stable retenue par fact-check pour le prochain
bump. Ce dossier ne fait pas le bump.

## Plateformes

- **Windows** — D3D12 puis Vulkan; chemin Steam principal.
- **Linux** — Vulkan, lavapipe en fallback; serveur et distribution Linux.
- **macOS** — Metal; build natif à valider.
- **Android** — Vulkan/GLES selon l'appareil; jeu wgpu, Tauri séparé.
- **iOS/iPadOS** — Metal; permissions et cycle de vie à valider.
- **Web** — WebGPU, WebGL2 best effort; `nie-wasm` et limites documentées.

Cette matrice est une cible de support; **À VÉRIFIER** signifie qu'une build et
un smoke test sur appareil/driver sont encore nécessaires.

## Version mobile de `nie`

Il y a deux produits mobiles complémentaires :

1. **Jeu jouable mobile :** hôte natif wgpu/winit, même `nie-core` et mêmes
   fixtures de replay; adaptation tactile, pause/reprise, rotation, perte et
   recréation de surface GPU, taille mémoire et audio mobile.
2. **Explorateur/studio mobile :** Tauri 2 Android/iOS avec le frontend
   React/Vite partagé, API HTTPS et cache offline contrôlé. Il n'est pas le
   renderer du jeu.

Les pages web du studio sont celles de `nie-web` (React/Vite partagé, servi par
`nie-site`), mais une webview Tauri ne devient pas le chemin de rendu du match. Toute fonctionnalité indisponible
offline doit être signalée dans l'UI; les données lourdes restent paginées et
les fichiers passent par URLs signées.

## Jeu Steam jouable

Le dépôt contient déjà `nie-game --play`, décrit comme une séquence titre →
menu → match avec clavier. **MESURÉ :** ce chemin existe. **À VÉRIFIER :** il
n'est pas encore un build Steam publié, ni un contrat de démarrage/overlay/cloud
validé.

Le crate `nie-steam` actuel utilise `steamroom`/`steamroom-client` pour
l'acquisition et le dump de dépôts IEVR. Il ne faut pas le confondre avec la
publication d'un jeu.

Le plan est un adaptateur PC isolé, par exemple un module/crate de plateforme
avec feature `steam` :

1. appeler `SteamAPI_RestartAppIfNecessary` avant l'initialisation;
2. appeler `SteamAPI_Init` et refuser un état Steam incohérent;
3. pomper les callbacks depuis le thread autorisé et sérialiser les appels non
   thread-safe;
4. brancher overlay, identité, achievements/stats et Steam Cloud/RemoteStorage
   derrière un trait afin que le jeu reste testable sans Steam;
5. fournir `steam_appid.txt` uniquement en développement local et le retirer
   de l'artefact distribué;
6. construire les dépôts SteamPipe avec branches beta, validation, rollback et
   contenu séparé par plateforme.

La publication dépend des droits Steamworks et de la licence Valve. Le binding
Rust `steamworks 0.13.1` est sous MIT/Apache-2 selon ses fichiers, mais le SDK
Valve n'est pas libre : l'approbation juridique et les binaires autorisés sont
des prérequis. Aucun secret ou identifiant privé ne figure dans ce dossier.

## Déterminisme et rendu

Les gates du moteur sont plus importantes que le choix de framework :

- timestep fixe et RNG du jeu (`CRand`), jamais l'horloge pour la logique;
- replay headless répété avec hash identique;
- captures RGBA8 dé-paddées comparées par hash avant toute tolérance SSIM;
- vérification D3D12/Vulkan/Metal et fallback logiciel quand le corpus le
  permet;
- aucune physique/ECS/rasteriseur qui réordonne les opérations du chemin
  byte-exact.

Bevy 0.19.1 peut rester un outil ou un prototype isolé, mais
`bevy_ecs`/`bevy-steamworks` ne doivent pas entrer dans le cœur canonique.
