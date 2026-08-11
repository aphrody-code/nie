# Plan maître

## L'objectif

**Un moteur de jeu complet en Rust, et une chaîne qui produit `nie.exe` identique à l'original au
byte près.** Deux faces d'un même but, qui se valident l'une l'autre :

1. **Le moteur** — réécrire *Inazuma Eleven: Victory Road* en Rust pur, jouable en natif, headless
   et WebAssembly, sans le binaire Windows ni le moteur propriétaire.
2. **La forge** — `crates/forge/` **génère** le binaire depuis le dépôt et vérifie à chaque
   construction qu'il est byte-identique. Elle mesure, à l'octet, la part que le workspace produit
   réellement ; le reste est recopié de la référence, et dit comme tel.

La forge est le **juge** du moteur : tant qu'un octet n'est pas produit par du code du dépôt, ce
qu'il contient n'est pas compris. Elle transforme « on a porté beaucoup de choses » en un nombre
falsifiable. Document dédié : [`FORGE.md`](FORGE.md).

Le reverse-engineering est **l'échafaudage**, pas la fin : il sert à résoudre la logique de
`nie.exe` pour la porter. Les vérités terrain de portage sont iecode (C#), inagle (TS) et le réel
(`.pdata`, les dumps du VFS) — ce ne sont pas des dépendances permanentes.

## L'état, mesuré

| Couverture | Ce qu'elle mesure | État |
|---|---|---|
| **Forge** | part de `nie.exe` produite par le dépôt | **51,86 %** du fichier · **66,09 %** du `.text` |
| **Formats** | fichiers du VFS dans un format parsé | **99,56 %** (254 187 / 255 308) |
| **Données** | familles `cfg.bin` typées et recalculées au bit | 117 modules, **121 familles routées**, 127 fichiers golden |
| **Logique** | fonctions de gameplay portées **et** validées byte-exact | **43** validations dans la suite oracle |
| **RE** | fonctions classifiées / nommées | **93,36 %** classées (49 280 / 52 783) · 6 429 nommées |
| **Rendu** | Δpixel contre capture de référence | gaté sur le driver de menu runtime |

Ces chiffres se régénèrent : `nie-forge report`, `niers vfs stats`, `niers coverage`,
`uv run scripts/validate_re.py`.

## Ce que « validé » veut dire

**Aucun FAIT sans validation bout-en-bout sur le réel.** Le dépôt a connu plusieurs faux FAIT —
des fixtures synthétiques qui passaient pendant que les vrais fichiers cassaient. La règle qui en
découle :

- Un format est porté quand il parse **tout son corpus réel**, pas un échantillon.
- Une donnée est portée quand elle est **recalculée au bit** contre le dump du jeu.
- Une fonction est portée quand elle est **byte-exacte contre un oracle** — l'émulation Unicorn
  d'une fonction isolée du vrai binaire (`scripts/uemu.py`), ou la forge elle-même.
- Une pièce dont la validation est impossible se marque **INCOMPLET**, jamais FAIT.

L'oracle uemu est ce qui a levé le verrou « pas d'oracle → pas portable » : il exécute une
fonction du binaire réel avec des entrées fixées et capture mémoire et registres, sans faire
tourner le jeu. La validation **multi-frames** est requise pour toute physique à état : le
single-step cache les branches non exercées — c'est ainsi qu'un clamp de bord absent du port de
`BallMoveLerp` avait échappé aux tests.

## Les piliers

### Formats — `nie-formats`

38 modules, 237 tests. Tous les conteneurs binaires structurés du jeu parsent : CPK (clé
CRC32(nom), 936/936), `cfg.bin` dans ses deux formes (T2B et RDBN), @UTF, CRILAYLA, la famille G4*
(TX, MG, MD, SK, MT, MA, PK, PKM, CM, VS, LA), PXCL (collision), G4NV (navmesh), MEVBIN, OBJB,
DXBC (shaders), et l'audio Criware (ADX/AWB/ACB/USM, HCA décodé avec la clé IEVR).

`cpk_list.cfg.bin` est chiffré en **AES-256-CBC**, clé et IV reversés statiquement du binaire —
un déchiffrement qu'iecode n'a pas.

Reste : la hiérarchie d'os `g4sk` garde un fallback heuristique sur certains fichiers (les
matrices, elles, sont byte-exactes) ; 1 121 fichiers en formats non structurés (`.ptlb`, `.fxbin`,
`.clobin`, `.g4tg`, blobs hash-nommés).

### Données — `nie-data`

117 modules, 1 431 tests, 127 fichiers golden. Le système de **conditions** est décodé et validé
sur tout le corpus (17 788 blobs) : cadrage binaire plus sémantique story/event-flag. Le
**résolveur de texte universel** débloque la résolution de tout texte localisé par hash, ce qui a
permis les jointures nom/description sur personnages, objets, quêtes, auras, équipes, trophées.

La chaîne personnage est complète de bout en bout : `chara_base` → nom, biographie, équipe, série.

Le typage n'est pas la condition de l'accès : les familles non typées sont déjà lisibles en
générique. Ce qui reste est du polissage sur de petites tables.

### Logique — `nie-core`

35 modules, 262 tests. Portés et validés byte-exact contre l'oracle : le PRNG `lives::CRand`
(MT19937 avec bornage de Lemire), les physiques de ballon (parabole, lerp avec son clamp, suivi de
cible, dribble, Bézier, taux, intégration normale, filet), la géométrie d'arrêt du gardien, le
décodeur de valeurs typées d'objet-menu, le conteneur de list-view intrusif (template C++ prouvé
sur trois instanciations), et un ensemble de primitives — composition affine, produit de
quaternions, multiplication 4×4, tables à clé, viewport letterbox, `strcmp`/`strncmp`/`strlen`.

**Limite assumée** : `match_sim` reste **nominal**. Le RE établit que la résolution tir/but n'est
pas une formule inline mais un évaluateur data-driven ; `GOAL_RATE_BASE` n'a aucun fondement
binaire et c'est écrit dans le code. Voir [`modele-de-match.md`](modele-de-match.md).

### Rendu et menu

Le rendu fidèle du menu est **gaté sur le driver de menu runtime**. Le vrai menu n'est pas dans
les fichiers : il est construit à l'exécution par le menu-manager C++, qui lit les
`*_menu_setting.cfg.bin`, crée les objets, et pilote le Lua via `funcLuaMenuCommand` — le script
appelle alors `SetSprite`/`SetText`/`SetIconSprite`.

Ce qui existe déjà : le compositeur f32 de `nie-formats::menu`, l'hôte Lua `nie-lua` avec ses
commandes mappées, l'arbre d'écrans validé (100 % des ~3 300 layers vérifient
`layer_id == CRC32(name)`), et les données de texte FR complètes.

Ce qui manque : la boucle de build moteur→Lua. Les callbacks actuels (`OnInit`, `OnSetupLayer`,
`OnOpenLayer`) sont **devinés** et le vrai script ne construit rien avec — d'où 0 sprite au rendu.
C'est la priorité, parce que tout le visuel du menu et le contenu des sous-menus en dépendent.

### Autres crates

`nie-save` déchiffre, lit et édite les saves (XOR à clé CRC32). `nie-steam` porte l'acquisition
Steam native. `nie-wiki` expose game-data depuis le miroir SQLite. `nie-camera` porte le modèle et
les contrôleurs de caméra. `nie-lua` exécute les vrais scripts et les analyse statiquement.

`crates/archive/nie-engine` est **hors du workspace** : 15 000 lignes portées des fichiers C
décompilés, mais consommées par aucune crate vivante et redondantes avec les crates byte-exactes.
Conservé en lecture seule comme carte du flux d'orchestration C++ ; ses 434 marqueurs `// EXTERN:`
disent l'ampleur de ce qui n'y est pas connecté. Ne jamais replier son code dans les crates
wasm-portables ou byte-exactes sans re-validation.

## Priorités

1. **Le driver de menu runtime** — débloque le menu et tous les sous-menus visuels.
2. **La forge** — continuer à monter la part produite ; la cible se choisit par le chiffre
   (`nie-forge candidates --no-reloc`, les lignes `blocker` de `lift`), jamais à l'intuition.
3. **La physique de match byte-fidèle** — poursuivre les ports validés par oracle.
4. **Le dialogue du mode Histoire** — résoudre la source du texte au runtime.
