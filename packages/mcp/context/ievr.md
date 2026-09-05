# Glossaire — Inazuma Eleven: Victory Road

Vocabulaire nécessaire pour lire les données sans contresens. Le jeu est un
RPG de football japonais de Level-5 ; le wiki Azalée en documente le contenu.

## Entités de jeu

- **Personnage** — un joueur. Décliné en **variantes** : formes alternatives,
  tenues, versions événementielles. Chacune a ses statistiques propres.
- **Technique** (*waza*) — action spéciale : tir, dribble, blocage, parade.
  Porte un **élément** (feu, bois, terre, vent) et une puissance.
- **Aura** — terme générique du wiki pour les transformations. Quatre types :
  - **Keshin** — avatar géant invoqué derrière le joueur ;
  - **Armure** (*armed*) — armure de keshin portée par le joueur ;
  - **Miximax** — fusion de deux personnages ;
  - **Totem** — esprit lié.
- **Passive** — effet permanent, hors action.
- **Tactique** — effet d'équipe déclenché en match.
- **Formation** — disposition des onze joueurs sur le terrain.
- **Coordinateur** — coach ou manager, distinct d'un joueur.
- **Capsule / gacha** — tirage aléatoire ; les **taux d'invocation** sont
  documentés (`azalee_dataset` avec `invocation`).
- **Drop** — objet obtenu après un match ou un coffre, avec son taux.

## Formats de fichiers du jeu

- **CPK** — archive Level-5 qui contient tous les assets. 250 800 fichiers
  indexés, décodés **à la volée** par le CDN (aucun dump complet sur disque).
- **`.g4tx`** — texture. Servie en PNG par `cdn.rosegriffon.fr/dx11/…`.
- **`.g4md` / `.g4mg`** — modèle 3D. Servi en GLB texturé complet (corps,
  visage, uniforme) par `cdn.rosegriffon.fr/model-full/<code>.glb`.
- **`cfg.bin`** — table de configuration binaire, servie en JSON.
- **gaiji** — glyphes propriétaires insérés dans les textes du jeu ; ils ne
  correspondent à aucun caractère Unicode standard et sont rendus par des
  images.

## Codes et identifiants

- `c0xxxxxxx` — code de modèle de personnage.
- `k*`, `ka*` — keshins et armures.
- Les identifiants de texte sont des **hash** (`0x3055CF22`) : les résoudre
  avec la collection `text` ou `game_text_search` plutôt que les afficher
  bruts.

## Projets voisins

- **Inazuma Eleven Cross** — jeu mobile sorti le 9 juin 2026, moteur Unity
  (IL2CPP + Addressables). **Distinct de Victory Road** : ni le même moteur,
  ni les mêmes archives. `azalee_dataset` avec `cross_tables` / `cross_stats`
  donne son catalogue.
- **niers** — réécriture en Rust du moteur du jeu ; alimente le décodage des
  assets et l'assemblage des modèles 3D.
- **iecode** — outillage C#/.NET de rétro-ingénierie et de téléchargement des
  dépôts Steam (l'app IEVR porte l'identifiant Steam **2799860**).
