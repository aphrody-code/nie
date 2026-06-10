# niers — plan maître

## Objectif (la fin)

**Réécrire 100 % d'*Inazuma Eleven: Victory Road* (IEVR, `nie.exe`, moteur Level-5 « Lives ») en Rust pur,
jouable en headless + WebAssembly — sans le binaire Windows ni le moteur propriétaire.**

C'est une **réimplémentation complète du jeu**, pas un outil d'analyse. Au lancement de `niers`, la cible est
d'avoir le jeu disponible en Rust : formats lus nativement, données chargées, moteur de match simulé, assets
décodés, le tout portable navigateur.

## Le moyen ≠ la fin

Le **reverse-engineering** (boucle `nie-re`/`nie-index`/`nie-seed`/`nie-queue` : index Ghidra, désassemblage
iced-x86, propagation de labels auto-ML, **92,45 %** des 52 783 fonctions réelles classifiées) est **l'échafaudage**.
Il sert à *résoudre* la logique de `nie.exe` pour la **porter** en Rust. Les références de portage sont
[iecode](../../rg/iecode) (C# .NET 10) et `inagle` (TS) + le réel (`/home/ubuntu/niers/data`, `.pdata`) :
chaque format/fonction porté est validé **byte-à-byte** contre eux. La cible est que niers fasse **tout** lui-même
en Rust ; iecode/inagle ne sont pas des dépendances permanentes, ce sont des vérités terrain de portage.

## Les piliers (état réel, classé FAIT / INCOMPLET / NON_FAIT)

### 1. Formats — `nie-formats` (lecture pure-Rust de tous les conteneurs Level-5/Criware)
- **FAIT** : RDBN (cfg.bin), g4tx (en-tête), g4md (en-tête/submesh), g4mg (géométrie), g4pk/g4ra (archive, validé sur 3 vrais .g4pk).
- **FAIT (2026-06-05)** : `@UTF` (TOC des CPK) — modèle de stockage corrigé en **bits** (`HAS_NAME=0x10`, `HAS_DEFAULT=0x20`, `ROW_STORAGE=0x40`, priorité DEFAULT>ROW), ancré sur iecode `UtfTable.cs`. Avant : enum faux → 0 extrait sur vrais CPK.
- **FAIT (2026-06-05)** : **décompression CRILAYLA** — bug off-by-one corrigé (décrément `write_pos` avant calcul de la source du backref LZ, conforme C#). Extraction g4tx **300/300, 0 échec** ; **validée croisée Rust↔C#** (mêmes width/height que le parseur iecode sur les fichiers communs : 308×180, 512×256, 32×32). Le verrou de l'extraction d'assets est levé.
- **INCOMPLET** : nxtch deswizzle (offsets en-tête off-by-4 vs struct C# `NxtchHeader`) ; g4sk hiérarchie d'os (heuristique ne se déclenche pas sur les fichiers dispo).
- **Déchiffrement CPK — RÉSOLU (rien à RE)** : recherche 2026-06-10 — il n'existe **aucune 2ᵉ enveloppe ni clé non publique**. Le seul chemin iecode est : magic `CPK ` → clair, sinon clé = CRC32(nom de fichier) puis XOR position-based — déjà porté (`cpk.rs` `key_from_filename`/`decrypt_block`). Vérifié : **921/921 CPK de `data/packs/` déchiffrent** en `CPK `+`@UTF`, 0 échec. La « clé fixe Viola `0x1717E18E` » n'est pas un secret : c'est `key_from_filename("cpk_list.cfg.bin")`.
- **Audio Criware** : ADX/AWB/ACB/USM = conteneurs réels portés. **HCA — clé de déchiffrement IEVR récupérée** (`SoundPlayManager.DecryptionKey = 0x00D2997C0DC5EE72`, dump il2cpp ; absente de la liste publique vgmstream) ; décodage réel via `cridecoder` (port clHCA complet) — *câblage de la clé en cours* (le stub `cri_audio::hca_decode` était non conforme et n'appliquait jamais la clé → silence).
- **Correction honnête** : l'« extraction CPK FAIT » (`c91faeb`) était un **faux FAIT** — jamais validée end-to-end ; cassait sur les vrais CPK (cause = @UTF + CRILAYLA ci-dessus).

### 2. Données — `nie-data` (modèles no_std du jeu, port inagle)
- **FAIT (5/7)** : skill-info, item-info, growth-tables, exp-table, passive-skill (validés byte contre les vrais cfg.bin + recalcul `calculateStats` inagle au bit près).
- **FAIT (2026-06-06) : base passives unifiée** — `nie-data/src/passives.rs` (+ `bin/export_passives.rs`, `tests/passives_golden.rs`). Lit `passive_skill_config_5.00.07.00.cfg.bin.json` (**1716 passives joueur**, texte résolu via `skill_text` NOUN_INFO fr/en/ja), `soccer_team_passive_config` (21 team passives), `team_passive_lot_table_config` (653 lots). Export → `apps/azalee/data/passives-full.json` (consommé par la page azalee `/passive`). Méta vérifiée : `player_count=1716`, `team_count=21`, `lot_count=653`, `unique_effect_count=128`.
- **INCOMPLET (2/7)** : `chara-param` (pairing skill/niveau **off-by-one** à inverser vers « level-first », cf. inagle commit 07ee6ce) ; `aura-cmd` (conclusion « 0/1549 résolvent » **hallucinée** → réalité 61/1548 ; corriger le bun-check hex/décimal et baser le test sur le vrai whs01780).

### 3. Moteur / gameplay — `nie-core` (logique reversée portée du C décompilé)
- **FAIT (7/7)** : stat-tables, exp-level, skill-model, aura-model, match-fsm, command-effect-slots, action-ctrl-ring.
- **Mesure réelle** : 4999 LOC, 92 fn publiques, 56 struct/enum, **126 tests + 9 doctests verts, 0 stub**, `#![forbid(unsafe_code)]`. Porté de `soccer_match_state_machine.c`, `soccer_command_effect.c`, `soccer_action_ctrl.c` (formules score `min*10000+sec`, strides, sentinelles confirmés ligne-par-ligne). **Ce n'est pas un squelette.**

### 3bis. Acquisition Steam — `nie-steam` (download natif des dépôts, port du Steam C# d'iecode)
- **FAIT (2026-06-05, `be3811f`)** : port complet de `IECODE.Core/Steam/Content/` sur **`steamroom`** + `steamroom-client` (MIT/Apache, = équivalent SteamKit2). Modules : `depot_resolver` (filtres OS/arch/langue, **fidélité C# vérifiée**), `token_store` (cache refresh-token round-trip), `options`, `session` (login refresh/credentials/2FA/anon, PICS, depot keys), `downloader` (orchestration `DepotJob`, proxy `depotfromapp`), + CLI `nie-steam`. **33 tests verts, clippy 0, 0 stub.** Le protocole (CM/auth/manifest/chunk/CDN) vient de steamroom, pas réimplémenté.
- **E2E live** en attente de creds Steam (`session`/`downloader` font de vrais appels steamroom, non testables sans login + réseau).
- **Hors scope** (pilier distinct « jeu en cours d'exécution ») : `SteamApi` (FFI `libsteam_api` → crate `steamworks`), `SteamEncryptedAppTicket` (EOS Windows-only).

### 3ter. Saves — `nie-save` (déchiffrement/lecture/édition native)
- **FAIT (2026-06-05, `a08e6b7`)** : déchiffre/lit/édite les saves IEVR (Lives) en Rust pur. Algo = **XOR position-based, clé CRC32(nom de fichier)** (même que les packs CPK). Conteneur magic `0x9DCE66C3`/`0x2EC3031F`, répertoire stride 0x80, data @0x800, blocs internes magic `0xEEFF` (SYSTEM/AUTOSAVE/HEADERSAVE). Vérifié : entropie **8.0→0.01**, round-trip identique, **12 tests**. CLI `niers save read/decrypt/edit`.

### 3quater. CLI wiki — `nie-wiki` (exploration game-data, ex-azalee CLI)
- **FAIT (`448bc9c`)** : migration du cœur game-data de l'azalee CLI TS → **13 sous-commandes `niers wiki`** (chara/skill/item/team/compare/search/db/random-team/team-builder/status/redis/audit/dialogue), lecture du miroir SQLite via `rusqlite` + calcul `nie-core`/`nie-data` + rendu. (push/sync/rag/translate restent TS.)

### 3quinquies. Moteur décompilé — `nie-engine` (portage des fonctions C de nie.exe)
- **FAIT (socle)** : portage de **~55 fonctions distinctes** (depuis les 60 fichiers `.c` décompilés Ghidra) → Rust, **11 modules / ~15k LOC** (render/animation/audio/physics-physx/menu/network/scripting/cfgbin/cpk/g4/app), `forbid(unsafe)`, workspace build vert, tests par module. **434 marqueurs `// EXTERN:`** (≈7,6 par fonction portée) = refs vers fonctions non encore portées : le socle est un îlot, pas une boucle moteur. Reste : étendre vers une boucle moteur réelle + résoudre les `// EXTERN:`.

### 3sexies. Assemblage 3D — `nie-formats/assemble.rs` (modèle complet joueur)
- **FAIT (2026-06-06)** : fusion **corps + face + uniforme TEXTURÉS** en un GLB. Matching reversé : face = GLB de l'internalCode, corps = mesh PARTAGÉ `base_*` (par type_idx, 99 % couverts), uniforme = team→kit→`ModelIdCrc = crc32_std(code)` (manifeste `var/uniform-model-map.ndjson`, **3550** entrées). **Textures g4tx→PNG (BC1-7) embarquées** dans le GLB (face + uniforme). Keshin (`k*`) / armures (`ka*`) aussi assemblés. Reste : skinning complet (animations), codes hors `c/k/ka` (uniforme isolé `n*` non assemblable seul).

### 3sexies-bis. Serving live — `nie-model-serve` (HTTP, assemblage GLB à la volée)
- **FAIT (2026-06-06)** : `crates/nie-model-serve` (binaire) sert `GET /model-full/<code>.glb` = assemblage **live** (corps+visage+uniforme texturés) depuis les CPK, sans dump. Déployé : `nie-model-serve.service` (systemd VPS, :8790), proxifié par nginx `cdn.rosegriffon.fr/model-full/`. Args : `--game-dir`, `--glb-dir`, `--crc-manifest var/model-crc-manifest.ndjson`, `--body-manifest var/body-type-manifest.ndjson`, `--cache-dir var/model-cache`. Vérifié live : `c11250030`/`k000010`/`c05021090` → 200, ~175-436 Ko, textures embarquées. ⚠ Binaire dans `/home/ubuntu/aphrody/target/linux-gnu/release/` (target-dir partagé avec aphrody — un `cargo clean` d'aphrody supprime le binaire ; le service survit sur l'inode mais **rebuild avant restart**). Consommé par azalee (page `/cpk` + fiches perso, cache-bust `?v=3`).

### 3septies. Données Steam — `better-auth-steam` (côté rg, alimenté par la RE nie.exe)
- Constantes Steam extraites de nie.exe (app 2799860, 27 interfaces Steamworks, 52 succès `ACHIEVEMENT_%04u`, EncryptedAppTicket/Cloud/DLC) + manifeste 230 succès→noms. Cf. mémoire `project-steam-integration` (le plugin vit dans rg, pas niers).

### 4. Runtime + portabilité — `nie-headless`, `nie-wasm`
- **FAIT** : runner CLI headless ; surface wasm-bindgen (detect/crilayla/@UTF) sur `wasm32-unknown-unknown`.
- **À étendre** : exposer nie-core/nie-data en wasm → boucle de jeu navigateur.

### 4bis. Encyclopédie web — `nie-zukan` (ingesteur zukan.inazuma.jp)
- **FAIT (2026-06-06)** : `crates/nie-zukan` ingère l'encyclopédie officielle `zukan.inazuma.jp`. **Algo `?q=` reversé** (`forge.rs`) : `json → complément-à-1 octet par octet → base64url sans padding → percent-encode` (round-trip validé en live, ancre Endou `c01000010`). Client JA/EN (`client.rs`/`pull.rs`), modèles (`models.rs`), parser HTML (`parser.rs`), module `cross.rs`. Croisement vérité terrain : **99,98 % de match avec inagle** (les fiches zukan recoupent les `inagle_characters`). Sert à câbler les **courbes de stats** + données encyclopédiques manquantes côté azalee (RESTANT).

### 4ter. Index des fichiers CPK — export `iev:file:index` → azalee
- **FAIT (2026-06-06)** : l'arbre complet des **250 800 fichiers** des CPK (common 193 540 / dx11 57 260) est indexé en Redis db3 `iev:file:index` (HASH `path → cpk`) et exporté en artefact tracké `apps/azalee/data/cpk-index.ndjson.gz` (~3,9 Mo, via `apps/azalee/scripts/build-cpk-index.ts`). Alimente le navigateur CPK d'azalee (`/cpk`, `/api/cpk`) — cf. `rg/docs/cpk-browser.md`. Couplé au serving live (g4tx→png :8788, GLB texturé :8790) = exploration totale des assets du jeu.

### 5. Échafaudage RE — `nie-re`, `nie-index`, `nie-seed`, `nie-queue`
- **FAIT** : pipeline `seed → rtti → rebuild(.pdata) → disasm → propagate`. **92,45 %** (48 796/52 783 fonctions réelles) **classifié** — c.-à-d. doté d'un *label de sous-système* propagé (ML), **pas d'un nom** : 0 fonction nommée (tables `symbol`/`hash_name` vides), et 81,8 % des labels ML ont une confiance < 0,1 (≈1 707 fonctions à ancre forte ≥0,75). Sur adresses correctes (`.pdata` = 50 674 racines + 2 109 feuilles vtable) + graphe d'appels réel (169 828 arêtes directes). Table `coverage` dans `var/niers.sqlite`.
- **Découverte clé** : l'index Ghidra est **désaligné** (3,7 % des `FUN_` sont de vrais débuts) ; `.pdata` est la vérité terrain. Toujours s'y adosser.

## Roadmap priorisée (vers le jeu jouable)

> **Trajectoire complète et mesurable vers 100 % pixel-perfect : `docs/ROADMAP-100.md`** (décomposition en 5 couvertures C1–C5, jalons à *gates* vérifiables, vagues d'exécution, tableau de bord honnête). La section ci-dessous reste le court terme opérationnel.

**P0 — débloquer l'extraction d'assets (pilier Formats)**
1. ~~Finir la décompression **CRILAYLA**~~ → **FAIT** (300/300 g4tx extraits, validé croisé Rust↔C#).
2. Recaler les offsets **nxtch** (off-by-4) + test à valeurs réelles → textures déswizzlées correctes (prochain).

**P0 — corriger les données fausses (pilier Données)**
3. `chara-param` : inverser le pairing vers « level-first » ; retirer le test qui entérine la mauvaise valeur.
4. `aura-cmd` : corriger la conclusion (61/1548) + test sur le vrai whs01780.

**P1 — assembler le jeu jouable (piliers Moteur + Runtime)**
5. **Câblage runtime** : relier `nie-core` (FSM match + slots d'action + effets) à `nie-data` (stats/skills/auras corrigés) dans une **boucle de simulation de match jouable**.
6. **Modèle d'équipe / formation** : exploiter `command-effect-slots` (TeamBuild, SpecialTactics) déjà mappés.
7. **Validation bout-en-bout** : test golden d'un match complet (kickoff → score `min*10000+sec` → fin) recoupé au C décompilé.

**P1 — pipeline d'assets visuels (pilier Formats → rendu)** — **largement FAIT**
8. ~~Chaîner g4tx → g4md → g4mg pour produire des **meshes texturés**~~ → **FAIT** : `assemble.rs` produit des GLB corps+visage+uniforme texturés (g4tx→PNG BC1-7 embarqués), servis live par `nie-model-serve` (:8790, `cdn.rosegriffon.fr/model-full/`). Reste : g4sk (skinning/animations), nxtch deswizzle pour le résidu de textures non-BC, rendu GPU/webgpu de la boucle moteur.

**P2 — étendre la couverture RE (échafaudage, rendements décroissants)**
9. Arêtes **indirectes** (références `lea reg,[fn]`, slots de vtable `.rdata` reliés aux classes RTTI) — meilleur levier sur le résidu (~4 000 fns isolées).
10. Audio Criware : finir le câblage de la clé HCA (`cridecoder` + `IEVR_HCA_KEY` + sous-clé AFS2). *(Déchiffrement enveloppe CPK : RÉSOLU, cf. pilier Formats — pas un verrou.)*

## Méthode

Portage incrémental. Chaque livrable est **classé FAIT / INCOMPLET / NON_FAIT** et **validé byte-à-byte** contre
iecode (C#) / inagle (TS) / le réel — jamais supposé. Sortie CLI `niers` = terse (1 ligne `clé=val`), détails via
`RUST_LOG`. Reverser puis réécrire 100 % d'un jeu AAA est un effort de longue haleine assumé : ce repo livre la
**boucle réelle et le code porté réel** (pas des stubs), avec les écarts vérifiés par décodage direct.

> Suivi détaillé par crate : `docs/jeu-jouable-avancement.md` (gameplay/données), `docs/assets-wasm-avancement.md`
> (assets/wasm), `docs/ARCHITECTURE.md` (boucle RE + découvertes `.pdata`).
