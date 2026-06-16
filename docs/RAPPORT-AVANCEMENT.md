# niers — Rapport d'avancement complet

> **Date** : 2026-06-16
> **Projet** : réimplémentation **intégrale, pixel-perfect et byte-perfect** en Rust pur du jeu
> *Inazuma Eleven: Victory Road* (`nie.exe`, Level-5 / Criware).
> **Statut global** : socle massif livré et validé ; la **pointe active** (rendu pixel-perfect des
> menus) vient de franchir son verrou le plus dur. Le plan global reste un effort pluriannuel
> **incomplet** — ce rapport est honnête sur le restant.

---

## 1. L'objectif (la fin, pas le moyen)

Le seul but est une **réimplémentation identique** de `nie.exe` en Rust : mêmes octets en sortie,
mêmes pixels à l'écran, même logique de jeu — **sans démo, sans triche, sans stub**. Tout le reste
(CLI, wiki, ponts web) n'est qu'outillage au service de cette fin.

La cible « 100 % » est décomposée de façon **mesurable** (cf. `docs/ROADMAP-100.md`) :
chaque fichier doit être lisible **et** décodé correctement ; chaque famille de données doit se
recalculer **au bit** ; chaque écran doit converger en **SSIM → 0,99** contre une capture du vrai
jeu ; chaque sous-système moteur doit reproduire la logique reversée.

---

## 2. État global en chiffres

| Métrique | Valeur |
|---|---|
| Crates Rust | **19** |
| Lignes de Rust (workspace) | **≈ 124 500** |
| Tests (`#[test]`) | **≈ 2 180** |
| Commits | **144** |
| Modules de données parsés (`nie-data`) | **91** |
| Assets indexés via le VFS CPK | **254 202** |
| Dictionnaire de noms CRC32 (corpus Lua) | **160 513** entrées |

Répartition par crate (LOC / tests) :

| Crate | Rôle | LOC | Tests |
|---|---|---:|---:|
| `nie-data` | Modèles de données du jeu (no_std) | 29 242 | 1 309 |
| `nie-engine` | Portage des fonctions C de `nie.exe` | 15 070 | 271 |
| `nie-formats` | Lecture pure-Rust des conteneurs Level-5/Criware | 13 065 | 159 |
| `nie-core` | Logique moteur / gameplay reversée | 6 102 | 166 |
| `nie-save` | Déchiffrement / lecture / édition des sauvegardes | 3 503 | 57 |
| `nie-re` | Échafaudage de rétro-ingénierie | 3 236 | 40 |
| `nie-game` | **Host de rendu natif (pilier D1, chemin vers le jeu jouable)** | 3 024 | 12 |
| `nie-wiki` | Exploration des game-data | 2 997 | 0 |
| `nie-model-serve` | Serveur HTTP d'assemblage 3D | 2 484 | 2 |
| `nie-lua` | VM Lua 5.2 réelle + host des commandes de menu | 2 377 | 33 |
| `nie-zukan` | Ingesteur de l'encyclopédie web | 2 262 | 16 |
| `nie-steam` | Download natif des dépôts Steam | 2 124 | 32 |
| `nie-cli` | Frontal CLI | 2 071 | 0 |
| `nie-wasm` | Cible WebAssembly | 1 806 | 30 |
| `nie-seed` | Amorçage RE | 1 589 | 24 |
| `nie-trace` | Lecture mémoire live d'un `nie.exe` Windows | 1 193 | 12 |
| `nie-index` | Index des fichiers CPK | 418 | 3 |
| `nie-headless` | Runtime sans tête | 285 | 16 |
| `nie-queue` | File de tâches RE | 90 | 0 |

---

## 3. Les cinq piliers — état réel

### Pilier A — Formats (`nie-formats`) — **avancé**
Lecture pure-Rust des conteneurs Level-5/Criware :
- **VFS CPK débloqué** : `cpk_list.cfg.bin` était chiffré (**AES-256-CBC**, clé/IV reversés de
  `nie.exe` et portés) ; `Vfs::init()` monte désormais les **254 202** fichiers.
- Conteneurs parsés au byte près : `g4tx` (textures + **régions d'atlas nommées**), `g4pkm`/`G4SK`
  (placement 2D / transforms), `objbin` (arbre d'objets de menu), `cfgbin`/T2B, `g4tx`, menus.
- Golden tests byte-exact (ex. atlas `gaiji_game` : 117 régions vérifiées).

### Pilier B — Données (`nie-data`) — **avancé**
**91 modules** de données du jeu portés en `no_std`, chacun avec son **golden test** (recalcul au
bit) : personnages, compétences, équipes, boutiques, capsules, stades, quêtes, emblèmes, costumes,
tactiques, etc. 1 309 tests verrouillent la conformité.

### Pilier C — Logique moteur (`nie-core`, `nie-engine`) — **partiel, longue traîne**
Portage progressif des fonctions C décompilées de `nie.exe` (15 000+ LOC dans `nie-engine`). La
nature « longue traîne » du moteur fait que ce pilier progresse sous-système par sous-système :
formules de stats, IA, etc. Reste le gros du runtime de match.

### Pilier D — Rendu (`nie-game`) — **LA POINTE ACTIVE**
C'est le chemin central vers « voir le jeu ». Mesuré en SSIM contre les captures réelles :
- `title02` (écran-titre) : SSIM **0,2511**
- `main_menu` (via `menu_setting`) : SSIM **0,4180**
- **9 onglets de navigation** du menu principal énumérés par le **vrai driver Lua** (pas un stub).
- Gate de rendu : **9 tests** (déterminisme byte-exact + planchers SSIM de non-régression).

### Pilier E — RE / échafaudage (`nie-re`, `nie-trace`, `nie-index`, `nie-seed`) — **outillé**
- `nie-trace` lit la **mémoire live** d'un `nie.exe` Windows natif depuis WSL (`ReadProcessMemory`,
  binaire `nie-mem.exe` cross-compilé + interop).
- Dictionnaire CRC32 (160 513 noms) issu du corpus Lua décompilé.

---

## 4. Le tournant de la session : le rendu « render-from-runtime » débloqué

C'était le **mur le plus dur** du pilier D. Un écran de menu se compose de trois données
(« trilogie ») : `objbin` (quoi), `g4pkm`/`G4SK` (où), `g4tx` (pixels). Mais **quel** sprite va sur
**quel** objet est décidé **au runtime** par les scripts Lua via des commandes
`funcLuaMenuCommand`, qui désignent les textures par des **hash** opaques. Sans résoudre ces hash,
impossible de savoir quelle texture afficher.

### Les déblocages enchaînés
1. **Récupération du corpus Lua décompilé du VPS** (677 fichiers `.lua` + analyses) — apporte les
   **noms** derrière les hash.
2. **Découverte clé** : les hash de menu sont des **CRC32 de noms** (vérifié `CRC32("Focus")` =
   `0xA30165ED`). Le **dictionnaire de 160 513 entrées** les résout tous — ce qui **supprime** un
   chantier de rétro-ingénierie binaire de plusieurs sessions (reverser le loader de registre).
3. **Signature réelle de `SetIconSprite`** reconstituée depuis les sites d'appel Lua :
   ```lua
   funcLuaMenuCommand(558735651, objId,
      CRC32("#/menu/200_icon/05_icon_rarity/<LG>/icon_rarity.g4tx"),  -- arg1 = chemin g4tx EXACT
      regionName,                                                      -- arg2 = nom de région d'atlas
      CRC32("gtxt_rarity_dmy01"), 0, layer)
   ```
   Le **chemin g4tx complet** est directement donné en arg1 → résolu par le dictionnaire. **Aucun
   scan d'index nécessaire** : le runtime fournit `(chemin g4tx, nom de région)` clé-en-main.

### La preuve end-to-end (sur données RÉELLES)
La chaîne complète a été **exécutée et validée** contre les vrais fichiers du jeu :

```
SetIconSprite(obj, CRC32("#/menu/.../icon_rarity.g4tx"), CRC32("gtxt_rarity01_05"), …)
  → arg1 CRC → dico → chemin exact → VFS(locale fr) → data/dx11/.../icon_rarity.g4tx
  → parse g4tx → texture « icon_rarity » 1604×1052 DDS, 15 régions d'atlas nommées
  → arg2 CRC → dico → « gtxt_rarity01_05 » → region_rect = (x=0, y=264, 800×128)  ← pixels réels
```

Le rectangle de crop `(0, 264, 800×128)` est une **vraie sous-texture** de l'atlas réel. Et le
pipeline va désormais **jusqu'aux pixels** : décodage de la texture DDS + rognage de la région
donne un sprite réel et reconnaissable — le bandeau de rareté or **« JOUEUR LÉGENDAIRE »**
(800×128, 60 183/102 400 pixels opaques). Reproductible (sans committer d'asset du jeu) :

```sh
nie-game --g4tx icon_rarity.g4tx --g4tx-region gtxt_rarity01_05 --capture /tmp/rarity05.png
```

Le chaînon manquant du rendu — *de la commande runtime aux pixels exacts d'un sprite* — est
désormais **fermé, produit et prouvé** (visuellement et verrouillé par gate).

**Et la boucle est fermée jusqu'à l'ÉCRAN COMPOSÉ.** Le mode `--compose-layout` dessine les sprites
statiques de base (fond + widgets) **et** les régions résolues au runtime, **z-ordonnés par
`drawPriority`**, chacun posé à son `transform` (ancre + échelle, alpha-over) sur un canevas
1280×720. Sur l'écran `shop` réel : **18 sprites composés** (17 statiques + 1 région runtime) →
un écran de boutique **reconnaissable** (fond dégradé + 5 barres de liste colorées + le bandeau de
rareté **« BASARA »** sur sa barre). C'est le passage de « 1 sprite rendu » à
**« un écran entier composé depuis le layout runtime »**. Reproductible :

```sh
nie-game --menu shop --runtime --export-layout /tmp/shop.json   # données runtime → layout
nie-game --compose-layout /tmp/shop.json --capture /tmp/shop.png # layout → écran composé
```

### Code livré cette session
- `nie-formats/g4tx.rs` : primitive `find_sub_texture` + méthodes `G4tx::region` /
  `G4tx::region_rect` (résolution `nom de région → texture porteuse + rect`), avec tests unitaires.
- `nie-lua/menu_host.rs` : `SetIconSprite` capture désormais **la paire** `(chemin g4tx, région)` ;
  champs `sprite_texture_hash` + `sprite_region_hash` sur `MenuObjectState`.
- `nie-formats/g4tx.rs` : primitive `find_sub_texture` + `G4tx::region` / `region_rect`
  (nom de région → texture porteuse + rect), avec tests unitaires.
- `nie-game/main.rs` : chargement du dictionnaire CRC32 + résolution des noms à l'export du layout ;
  `crop_rgba` (rognage d'un rect RGBA, 2 tests) ; diagnostics `--g4tx-regions` (liste les régions
  d'un g4tx réel) et `--g4tx-region <nom> --capture <png>` (**décode la DDS + rogne → pixels réels**).
- **Index `région → g4tx`** : `data/re/menu-icon-atlases.txt` (24 atlas d'icônes extraits du corpus
  Lua) + cmd `--build-region-index` → `data/re/menu-region-index.json` (**410 régions**) ; câblé dans
  l'export runtime → chaque objet à `spriteRegion` émet `spriteRegionG4tx` + **`spriteRect {x,y,w,h}`**
  (layout JSON render-ready : ex. les 2 bandeaux de rareté du `shop` → `icon_rarity.g4tx` + rects exacts).
- **Compositeur** : primitives `scale_nearest` (resampling NN) + `blit_over` (straight alpha-over) +
  mode `--compose-layout <json> --capture <png>` qui dessine les sprites statiques + les régions
  runtime, **z-ordonnés par `drawPriority`**, chacun posé à son transform → **écran complet composé**
  (le `shop` : 18 sprites, fond + barres + bandeau « BASARA »).
- `nie-game` gates : `icon_rarity_atlas_regions_resolve` (10 niveaux + 15 régions) +
  `icon_rarity_region_crops_to_real_pixels` (crop → PNG 800×128 non vide) +
  `shop_runtime_resolves_region_to_g4tx_rect` (chaîne région→g4tx→rect sur le vrai écran) +
  **`shop_runtime_composes_to_image`** (export→compose chaînés → image composée non vide).
- Reversal de commandes Lua : `RegisterItemListCount` (débloque la boucle `SetupItemButton` →
  29 items de liste dans la boutique), `SetSelectedIndex`, drapeaux d'items → boutique **399**
  commandes connues.

**Validation** : `nie-formats` +1 test (région), `nie-lua` 33 tests, `nie-game` gate **13 tests**
(9 → 13) + 4 tests unitaires compositeur (`crop_rgba`/`scale_nearest`/`blit_over`), **clippy 0
warning** sur les trois crates.

---

## 5. Ce qui reste (honnêteté)

Le plan global est un effort **pluriannuel** et reste **incomplet**. Restent notamment :

- **Rendu (D)** : finir le pipeline texture render-from-runtime (crop de la région → composition au
  transform de l'objet), les UV d'atlas, le rendu des maillages (bind-pose/motion), le texte, et la
  montée du SSIM de ~0,25–0,42 vers ≥ 0,99 sur chaque écran.
- **Moteur (C)** : système d'événements du modèle de but, bonus d'équipe, runtime de match complet —
  la longue traîne des sous-systèmes gameplay.
- **Sauvegarde / progression** : couche d'état complète câblée au moteur.
- Des **dizaines** d'autres composants de RE profonde répartis sur les cinq piliers.

### Pourquoi c'est désormais plus rapide
Le corpus Lua décompilé + le dictionnaire CRC32 transforment la suite du chantier menu : on
**résout des noms** et on **reverse les `cmdId` en lisant le Lua**, au lieu de désassembler
`nie.exe`. Le verrou structurel le plus dur de la pointe active est tombé ; le restant est large
mais davantage mécanique.

---

## 6. Architecture en une image

```
                 ┌─────────────────────────────────────────────┐
   nie.exe ──RE──┤  nie-re / nie-trace / nie-seed (échafaudage) │
   (jeu cible)   └─────────────────────────────────────────────┘
        │
        ▼
   ┌───────────┐   ┌──────────┐   ┌──────────┐   ┌──────────────┐
   │ nie-formats│→ │ nie-data │→ │ nie-core │→ │  nie-engine   │
   │ (conteneurs│  │ (91 mods │  │ (gameplay│  │ (fns C portées│
   │  + VFS CPK)│  │  golden) │  │  reversé)│  │   de nie.exe) │
   └───────────┘   └──────────┘   └──────────┘   └──────────────┘
        │                                              │
        ▼                                              ▼
   ┌──────────────────────────┐              ┌──────────────────┐
   │ nie-lua (VM 5.2 + host    │── runtime ──▶│ nie-game (rendu  │
   │  des commandes de menu)   │  layout      │  natif, pilier D)│
   └──────────────────────────┘              └──────────────────┘
                                                      │
                                          SSIM vs capture réelle
```

---

*Rapport généré le 2026-06-16. Tous les chiffres de tests/LOC/gates sont issus du workspace à cette
date ; les SSIM sont les planchers de non-régression documentés dans le gate de rendu.*
