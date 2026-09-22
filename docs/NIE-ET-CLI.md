# Manuel de Référence : nie.exe et la CLI `nie`

Ce document présente l'architecture de **`nie.exe`** (le binaire cible original d'Inazuma Eleven: Victory Road) et le guide d'utilisation opérationnel complet de la CLI **`nie`** (le binaire Rust unique unifié).

---

## 1. Comprendre `nie.exe`

`nie.exe` est l'exécutable 64 bits (PE64) du jeu *Inazuma Eleven: Victory Road* (Level-5), mesurant 33 918 464 octets et contenant 117 068 fonctions répertoriées via ses tables d'unwind `.pdata`.

### 1.1 Architecture Interne
Le moteur original repose sur une architecture modulaire en C++ (compilateur MSVC) couplée à des sous-systèmes spécialisés :
- **Système de Fichiers Virtuel (VFS)** : Utilise le middleware **CriWare CRI File System** (`#/` et packs `.cpk`). Les archives sont chiffrées par masque XOR avec une clé dérivée du CRC32 des noms de fichiers.
- **Formats de Données Propriétaires Level-5** :
  - `cfg.bin` : Deux formats coexistent sous cette même extension : **RDBN** (tables relationnelles à colonnes typées) et **T2B** (arbres hiérarchiques de configuration clé-valeur avec table de chaînes interne).
  - `G4TX` : Conteneur de textures multi-surfaces encapsulant des blocs `NXTCH` encodés en formats compressés Direct3D/DDS (BC1 à BC7) ou RGBA8 avec swizzle.
  - `G4MD` / `G4MG` : Représentation 3D scindée. Le `.g4md` contient les métadonnées (hiérarchie d'os, sous-maillages, slots de matériaux). Le `.g4mg` frère contient les tampons binaires bruts de sommets (vertex buffers) et d'indices (index buffers).
  - `G4PK` / `G4PKM` : Packages d'assets et d'animations regroupant squelettes (`G4SK`), caméras cinématiques (`G4CM`) et pistes d'interpolation de mouvement.
  - `G4CM` : Contrôleurs de caméras cinématiques et cutscenes.
- **Logique de Script** : Machine virtuelle **Lua 5.2.4** standard. Les scripts sont précompilés en bytecode (`.lua.bin`) et pilotent les événements, quêtes et comportements d'interface.
- **Audio & Vidéo** : Moteur CriWare Sofdec2 (vidéos `.usm` contenant des flux vidéo VP9 `@SFV` et audio HCA `@SFA`) et CriWare Atom Ex (`.acb` / `.awb`).
- **Moteur Physique & Rendu** : Rendu DirectX 11 / DXBC shaders (`.vfxo`, `.pfxo`, `.cfxo`), couplé à une simulation physique pour le ballon et les collisions de terrain (PXCL / `.col`).

---

## 2. La CLI `nie` : Principe et Fonctionnement

La CLI `nie` (fournie par le crate `crates/tools/nie-cli`) est **le point d'entrée unique** de l'outillage Rust. Elle unifie l'exploration du jeu réel, l'analyse statique et dynamique, le décodage de formats et la boucle de reverse-engineering.

### 2.1 Emplacement du Jeu (`NIE_GAME_DIR`)
Pour fonctionner sur les données réelles du jeu sans copie superflue, la CLI utilise la variable d'environnement `NIE_GAME_DIR` :
```bash
export NIE_GAME_DIR=/home/ubuntu/.local/share/Steam/iecode/inazuma
```
Sur une installation Windows Steam par défaut, `nie` détecte automatiquement le VFS dans le répertoire courant si `data/cpk_list.cfg.bin` est présent.

---

## 3. Guide des Commandes de la CLI `nie`

### 3.1 Exploration et Extraction du VFS (`nie vfs`)
Le sous-système VFS permet d'inspecter les 255 342 fichiers répartis dans les 936 CPKs du jeu sans devoir décompresser l'intégralité du stockage.

- **Statistiques globales du VFS** :
  ```bash
  nie vfs stats
  ```
  Affiche le nombre total de fichiers répertoriés, les CPKs montés, et les métriques d'intégrité.

- **Recherche de fichiers dans les CPKs** :
  ```bash
  nie vfs find "menu_text" --limit 10
  nie vfs find "c01001900"
  ```
  Recherche par motif de nom de fichier à travers tous les conteneurs d'archives.

- **Audit et couverture des formats** :
  ```bash
  nie vfs formats --limit 1000
  ```
  Analyse un échantillon de fichiers réels et quantifie le taux de reconnaissance des formats (plus de 82 % reconnus et décodables en direct).

- **Inspection et décodage structuré à la volée (`cat`)** :
  ```bash
  # Inspection d'un fichier de configuration texte (T2B / RDBN)
  nie vfs cat data/common/text/fr/menu_text.cfg.bin

  # Inspection des métadonnées d'un modèle 3D (G4MD)
  nie vfs cat data/common/chr/_animal/an000100/an000100.g4md

  # Décodage direct d'une texture G4TX vers un PNG
  nie vfs cat data/dx11/menu/200_icon/10_icon_chr/face/c01001900_l.g4tx --png-out /tmp/aphrody.png
  ```

- **Recherche transversale d'un Personnage (`chara`)** :
  ```bash
  nie vfs chara Byron
  ```
  Résout instantanément tous les conteneurs VFS associés à un joueur (modèles `.g4md`, géométries `.g4mg`, textures `.g4tx`, voix `.awb` / `.acb` et icônes).

- **Recherche transversale d'une Technique (`waza`)** :
  ```bash
  nie vfs waza "God Hand"
  ```
  Localise les scripts, animations et textures d'effets de la technique demandée.

- **Extraction de fichiers individuels** :
  ```bash
  nie vfs extract data/common/text/fr/menu_text.cfg.bin -o /tmp/menu_text.bin
  ```

---

### 3.2 Décodage et Conversion Universels

- **Détection de format (`format`)** :
  ```bash
  nie format data/common/text/fr/menu_text.cfg.bin
  ```
  Identifie le type exact d'un fichier (magic, structure interne, codec).

- **Décodage en masse vers JSON / PNG (`decode`)** :
  ```bash
  nie decode chemin/fichier.g4tx -o destination/
  nie decode chemin/fichier.cfg.bin
  ```
  Convertit automatiquement les textures en PNG et les structures binaires Level-5 en représentations JSON exploitables.

- **Conversion d'assets (`convert`)** :
  ```bash
  nie convert model.g4md -o model.glb
  ```
  Assemble géométrie, squelette et textures pour produire un modèle 3D standardisé (GLTF / GLB).

---

### 3.3 Diagnostic et État du Jeu

- **Informations d'installation (`info`)** :
  ```bash
  nie info
  ```
  Vérifie la validité de l'installation du jeu, la présence de `nie.exe`, l'état de Steam / Proton, et l'accessibilité du VFS.

- **Audit des langues et textes (`locales`)** :
  ```bash
  nie locales
  ```
  Inventorie les 9 langues présentes dans les données du jeu (de, en, es, fr, it, ja, pt, zh_hans, zh_hant) et le volume de lignes associées.

---

### 3.4 Environnement de Script Lua

- **Analyse statique de scripts (`lua`)** :
  ```bash
  nie lua chemin/vers/script.lua
  ```
  Contrôle la syntaxe et l'arbre syntaxique (AST tree-sitter) sans exécuter de code.

- **Exécution isolée d'un binaire Lua (`lua-run`)** :
  ```bash
  nie lua-run data/common/script/event/ev0101.lua.bin
  ```
  Instancie la machine virtuelle Lua 5.2 native et exécute le bytecode avec résolution automatique des directives `INCLUDE` depuis le VFS.

---

### 3.5 Pilotage du Savoir Reverse-Engineering (`nie atlas`)

L'Atlas est le moteur de suivi du projet, unifiant dans une base de données SQLite unique (`var/nie-atlas.sqlite`) les symboles, fonctions décompilées, adresses machines (`0x14...`), tests de conformité et fichiers du dépôt.

- **Interrogation unifiée de l'Atlas (`search`)** :
  ```bash
  nie atlas search "CCameraCtrl"
  nie atlas search "0x1404ecd60"
  ```
  Recherche instantanée à travers la base de connaissance, le code source Rust, les tests et la documentation.

- **État global et métriques d'avancement (`status`)** :
  ```bash
  nie atlas status
  ```
  Affiche le taux de couverture global de décompilation et de réimplémentation.

- **Visualisation des gaps prioritaires (`gaps`)** :
  ```bash
  nie atlas gaps
  ```
  Liste par ordre de priorité mathématique les sous-systèmes nécessitant un portage ou une consolidation de tests.

---

### 3.6 Sous-système Réseau & Mode En Ligne (`nie net`)

Le sous-système réseau (`crates/engine/nie-net`) unifie l'ingénierie inversée du protocole Level-5 / EOS, l'émulateur P2P rollback 64-frames et la suite e-sport Achillea :

- **Lancement du serveur de session / hub multijoueur (`server`)** :
  ```bash
  nie net server --addr 0.0.0.0:8085 --tick-rate 60
  ```
  Démarre le hub multijoueur synchrone cadencé à 60 Hz avec gestionnaire de lobbys Inacode et file d'attente ELO.

- **Création d'une salle Inacode (`room create`)** :
  ```bash
  nie net room create --mode 1v1 --name "Tournoi FR" --slots 2
  ```
  Génère une salle privée sécurisée avec son Inacode canonique `INA-XXXX` (alphabet base-32 sans ambiguïté).

- **Simulation de match déterministe avec contrôle de désynchronisation (`sim-match`)** :
  ```bash
  nie net sim-match --ticks 120
  ```
  Simule un match à 60 Hz avec échange d'entrées `PlayerTickInput`, vérification continue des condensats FNV-1a et preuve formelle du zéro-desync.

- **Génération de code de défi compétitif (`challenge create`)** :
  ```bash
  nie net challenge create player_alpha player_beta
  ```
  Émet un code de défi direct à usage unique de 8 caractères Base-32 avec un TTL strict de 30 minutes.

- **Consultation du ladder e-sport officiel (`ladder`)** :
  ```bash
  nie net ladder --limit 10
  ```
  Affiche le classement des joueurs par Activity Points (AP), rang (Fer à Légendaire) et statistiques de match (victoires, défaites, nuls).

- **Consultation du classement des clans (`clans`)** :
  ```bash
  nie net clans
  ```
  Affiche les clubs enregistrés, leurs tags `[TAG]`, leurs effectifs et leur score saisonnier agrégé.

- **Calculatrice d'arbitrage et de projection ELO (`calc-elo`)** :
  ```bash
  nie net calc-elo 1250 1180 win
  ```
  Calcule l'espérance mathématique $E_A$, applique le facteur $K$ asymétrique du palier et affiche les nouveaux scores AP et deltas ($\Delta\mathrm{AP}$).

---

## 4. Synthèse d'Exploitation

La CLI `nie` est un outil autonome compilé en Rust natif, ne nécessitant aucune dépendance externe lourde (ni Python, ni .NET, ni scripts ad-hoc). Elle garantit une exploration fidèle, rapide et non destructive du jeu original `nie.exe`.

## RE anchors

Knowledge base (`var/nie.sqlite`) tables:
- `function` — 117 068 functions of `nie.exe`
- `hash_name` — 62 125 CRC32 entries for VFS paths
- `pdata_func` — 55 351 authoritative unwind boundaries
- `rtti_class` — MSVC RTTI classes

Key binary addresses:
- `0x1406d5840` — Main game loop tick
- `0x1404ecd60` — Character movement controller
