# niers — plan maître

## Objectif (la fin)

**Réécrire 100 % d'*Inazuma Eleven: Victory Road* (IEVR, `nie.exe`, moteur Level-5 « Lives ») en Rust pur,
jouable en headless + WebAssembly — sans le binaire Windows ni le moteur propriétaire.**

C'est une **réimplémentation complète du jeu**, pas un outil d'analyse. Au lancement de `niers`, la cible est
d'avoir le jeu disponible en Rust : formats lus nativement, données chargées, moteur de match simulé, assets
décodés, le tout portable navigateur.

## Le moyen ≠ la fin

Le **reverse-engineering** (boucle `nie-re`/`nie-index`/`nie-seed`/`nie-queue` : index Ghidra, désassemblage
iced-x86, propagation de labels auto-ML, **92,43 %** des 52 783 fonctions réelles classifiées) est **l'échafaudage**.
Il sert à *résoudre* la logique de `nie.exe` pour la **porter** en Rust. Les références de portage sont
[iecode](../../rg/iecode) (C# .NET 10) et `inagle` (TS) + le réel (`/home/ubuntu/niers/data`, `.pdata`) :
chaque format/fonction porté est validé **byte-à-byte** contre eux. La cible est que niers fasse **tout** lui-même
en Rust ; iecode/inagle ne sont pas des dépendances permanentes, ce sont des vérités terrain de portage.

## Les piliers (état réel, classé FAIT / INCOMPLET / NON_FAIT)

### 1. Formats — `nie-formats` (lecture pure-Rust de tous les conteneurs Level-5/Criware)
- **FAIT** : RDBN (cfg.bin), g4tx (en-tête), g4md (en-tête/submesh), g4mg (géométrie), g4pk/g4ra (archive, validé sur 3 vrais .g4pk).
- **FAIT (2026-06-05)** : `@UTF` (TOC des CPK) — modèle de stockage corrigé en **bits** (`HAS_NAME=0x10`, `HAS_DEFAULT=0x20`, `ROW_STORAGE=0x40`, priorité DEFAULT>ROW), ancré sur iecode `UtfTable.cs`. Avant : enum faux → 0 extrait sur vrais CPK.
- **INCOMPLET / blocage actuel** : **décompression CRILAYLA** — ~90 % des g4tx sont CRILAYLA-compressés et échouent ; fix en cours ancré sur iecode `CriLayla.cs`. C'est le verrou de l'extraction d'assets.
- **INCOMPLET** : nxtch deswizzle (offsets en-tête off-by-4 vs struct C# `NxtchHeader`) ; g4sk hiérarchie d'os (heuristique ne se déclenche pas sur les fichiers dispo).
- **NON_FAIT** : audio Criware (HCA/ACB/AWB/ADX), déchiffrement enveloppe CPK côté niers (clé dérivée du nom OK ; le reste à porter depuis iecode).
- **Correction honnête** : l'« extraction CPK FAIT » (`c91faeb`) était un **faux FAIT** — jamais validée end-to-end ; cassait sur les vrais CPK (cause = @UTF + CRILAYLA ci-dessus).

### 2. Données — `nie-data` (modèles no_std du jeu, port inagle)
- **FAIT (5/7)** : skill-info, item-info, growth-tables, exp-table, passive-skill (validés byte contre les vrais cfg.bin + recalcul `calculateStats` inagle au bit près).
- **INCOMPLET (2/7)** : `chara-param` (pairing skill/niveau **off-by-one** à inverser vers « level-first », cf. inagle commit 07ee6ce) ; `aura-cmd` (conclusion « 0/1549 résolvent » **hallucinée** → réalité 61/1548 ; corriger le bun-check hex/décimal et baser le test sur le vrai whs01780).

### 3. Moteur / gameplay — `nie-core` (logique reversée portée du C décompilé)
- **FAIT (7/7)** : stat-tables, exp-level, skill-model, aura-model, match-fsm, command-effect-slots, action-ctrl-ring.
- **Mesure réelle** : 4999 LOC, 92 fn publiques, 56 struct/enum, **126 tests + 9 doctests verts, 0 stub**, `#![forbid(unsafe_code)]`. Porté de `soccer_match_state_machine.c`, `soccer_command_effect.c`, `soccer_action_ctrl.c` (formules score `min*10000+sec`, strides, sentinelles confirmés ligne-par-ligne). **Ce n'est pas un squelette.**

### 4. Runtime + portabilité — `nie-headless`, `nie-wasm`
- **FAIT** : runner CLI headless ; surface wasm-bindgen (detect/crilayla/@UTF) sur `wasm32-unknown-unknown`.
- **À étendre** : exposer nie-core/nie-data en wasm → boucle de jeu navigateur.

### 5. Échafaudage RE — `nie-re`, `nie-index`, `nie-seed`, `nie-queue`
- **FAIT** : pipeline `seed → rtti → rebuild(.pdata) → disasm → propagate`. **92,43 %** (48 787/52 783 fonctions réelles) classifié, sur adresses correctes (`.pdata` = 50 674 racines + 2 109 feuilles vtable) + graphe d'appels réel (125 029 arêtes directes). Table `coverage` dans `var/niers.sqlite`.
- **Découverte clé** : l'index Ghidra est **désaligné** (3,7 % des `FUN_` sont de vrais débuts) ; `.pdata` est la vérité terrain. Toujours s'y adosser.

## Roadmap priorisée (vers le jeu jouable)

**P0 — débloquer l'extraction d'assets (pilier Formats)**
1. Finir la décompression **CRILAYLA** (en cours) → ~90 %+ des g4tx extraits en Rust pur.
2. Recaler les offsets **nxtch** (off-by-4) + test à valeurs réelles → textures déswizzlées correctes.

**P0 — corriger les données fausses (pilier Données)**
3. `chara-param` : inverser le pairing vers « level-first » ; retirer le test qui entérine la mauvaise valeur.
4. `aura-cmd` : corriger la conclusion (61/1548) + test sur le vrai whs01780.

**P1 — assembler le jeu jouable (piliers Moteur + Runtime)**
5. **Câblage runtime** : relier `nie-core` (FSM match + slots d'action + effets) à `nie-data` (stats/skills/auras corrigés) dans une **boucle de simulation de match jouable**.
6. **Modèle d'équipe / formation** : exploiter `command-effect-slots` (TeamBuild, SpecialTactics) déjà mappés.
7. **Validation bout-en-bout** : test golden d'un match complet (kickoff → score `min*10000+sec` → fin) recoupé au C décompilé.

**P1 — pipeline d'assets visuels (pilier Formats → rendu)**
8. Une fois nxtch recalé : chaîner g4tx → g4md → g4mg → g4sk pour produire des **meshes texturés** (rendu personnages), puis rendu GPU/webgpu.

**P2 — étendre la couverture RE (échafaudage, rendements décroissants)**
9. Arêtes **indirectes** (références `lea reg,[fn]`, slots de vtable `.rdata` reliés aux classes RTTI) — meilleur levier sur le résidu (~4 000 fns isolées).
10. Audio Criware (HCA/ACB/AWB/ADX) + déchiffrement enveloppe CPK en Rust.

## Méthode

Portage incrémental. Chaque livrable est **classé FAIT / INCOMPLET / NON_FAIT** et **validé byte-à-byte** contre
iecode (C#) / inagle (TS) / le réel — jamais supposé. Sortie CLI `niers` = terse (1 ligne `clé=val`), détails via
`RUST_LOG`. Reverser puis réécrire 100 % d'un jeu AAA est un effort de longue haleine assumé : ce repo livre la
**boucle réelle et le code porté réel** (pas des stubs), avec les écarts vérifiés par décodage direct.

> Suivi détaillé par crate : `docs/jeu-jouable-avancement.md` (gameplay/données), `docs/assets-wasm-avancement.md`
> (assets/wasm), `docs/ARCHITECTURE.md` (boucle RE + découvertes `.pdata`).
