# niers — plan maître

## Objectif (la fin)

**Réécrire 100 % d'*Inazuma Eleven: Victory Road* (IEVR, `nie.exe`, moteur Level-5 « Lives ») en Rust pur,
jouable en headless + WebAssembly — sans le binaire Windows ni le moteur propriétaire.**

C'est une **réimplémentation complète du jeu**, pas un outil d'analyse. Au lancement de `niers`, la cible est
d'avoir le jeu disponible en Rust : formats lus nativement, données chargées, moteur de match simulé, assets
décodés, le tout portable navigateur.

## Le moyen ≠ la fin

Le **reverse-engineering** (boucle `nie-re`/`nie-index`/`nie-seed`/`nie-queue` : index Ghidra, désassemblage
iced-x86, propagation de labels auto-ML, **93,36 %** des 52 783 fonctions classifiées + **6 429 nommées** structurellement) est **l'échafaudage**.
Il sert à *résoudre* la logique de `nie.exe` pour la **porter** en Rust. Les références de portage sont
[iecode](../../rg/iecode) (C# .NET 10) et `inagle` (TS) + le réel (`/home/ubuntu/niers/data`, `.pdata`) :
chaque format/fonction porté est validé **byte-à-byte** contre eux. La cible est que niers fasse **tout** lui-même
en Rust ; iecode/inagle ne sont pas des dépendances permanentes, ce sont des vérités terrain de portage.

## Les piliers (état réel, classé FAIT / INCOMPLET / NON_FAIT)

### 1. Formats — `nie-formats` (lecture pure-Rust de tous les conteneurs Level-5/Criware)
- **FAIT** : RDBN (cfg.bin), g4tx (en-tête), g4md (en-tête/submesh), g4mg (géométrie), g4pk/g4ra (archive, validé sur 3 vrais .g4pk).
- **FAIT (2026-06-05)** : `@UTF` (TOC des CPK) — modèle de stockage corrigé en **bits** (`HAS_NAME=0x10`, `HAS_DEFAULT=0x20`, `ROW_STORAGE=0x40`, priorité DEFAULT>ROW), ancré sur iecode `UtfTable.cs`. Avant : enum faux → 0 extrait sur vrais CPK.
- **FAIT (2026-06-05)** : **décompression CRILAYLA** — bug off-by-one corrigé (décrément `write_pos` avant calcul de la source du backref LZ, conforme C#). Extraction g4tx **300/300, 0 échec** ; **validée croisée Rust↔C#** (mêmes width/height que le parseur iecode sur les fichiers communs : 308×180, 512×256, 32×32). Le verrou de l'extraction d'assets est levé.
- **nxtch — N/A pour le PC (2026-06-10)** : format texture **Switch** ; **0/250 800** fichiers de l'IEVR PC sont NXTCH (textures = DDS dans g4tx, déjà décodées via `image_dds`). Code deswizzle gardé pour Switch, hors chemin critique PC.
- **INCOMPLET** : g4sk hiérarchie d'os (fallback heuristique marqué `heuristic=true` sur les fichiers dispo ; à confirmer sans heuristique).
- **Déchiffrement CPK — RÉSOLU (rien à RE)** : recherche 2026-06-10 — il n'existe **aucune 2ᵉ enveloppe ni clé non publique**. Le seul chemin iecode est : magic `CPK ` → clair, sinon clé = CRC32(nom de fichier) puis XOR position-based — déjà porté (`cpk.rs` `key_from_filename`/`decrypt_block`). Vérifié : **921/921 CPK de `data/packs/` déchiffrent** en `CPK `+`@UTF`, 0 échec. La « clé fixe Viola `0x1717E18E` » n'est pas un secret : c'est `key_from_filename("cpk_list.cfg.bin")`.
- **Durcissement `parse_t2b` — FAIT (2026-06-13, `7f3e09c`)** : le parseur cfg.bin débordait (`off + len`, `cfgbin.rs:693`) sur un en-tête chiffré → panic en debug, wrap silencieux en release. Découvert via `nie-game` sur le `cpk_list.cfg.bin` Steam. Corrigé : validation du signe + `checked_add` → `Corrupt` propre, byte-exact pour les fichiers valides (+3 tests de régression, **105 tests lib nie-formats**).
- **`cpk_list.cfg.bin` déchiffré — FAIT (2026-06-14, `bdb45a6`)** : ni XOR (Viola/nom) ni compressé, mais **AES-256-CBC**. Clé/IV reversés statiquement de `nie.exe` (loader @ VA `0x14168D5E0`, désasm `nie-re`/iced-x86) : `KEY=decrypt_block(blob256,0,0x8A90ABA9)`, `IV=decrypt_block(blob128,0,0x4C801618)`, puis AES-256-CBC (`cpk::decrypt_cpk_list`, dép `aes`). **`Vfs::init()` monte les 254 202 fichiers logiques** (vérifié réel : footer T2B + 254 202 entrées). iecode N'A PAS ce déchiffrement (« Unknown encryption »). Premier déchiffrement de container **au-delà** d'iecode.
- **Audio Criware — FAIT (vérifié 2026-06-10)** : ADX/AWB/ACB/USM = conteneurs réels portés. **HCA décode réellement** : clé IEVR `0x00D2997C0DC5EE72` (`SoundPlayManager.DecryptionKey`, dump il2cpp, absente de vgmstream) posée via `set_encryption_key` ; magic masqué `0xC8C3C1` reconnu ; sous-clé AFS2 (u16 LE @0x0E) propagée. Décodage via `cridecoder` (clHCA). Test sur vrai AWB `c00001001.awb` → 48 kHz mono, samples non nuls = déchiffrement effectif. L'ancien `cri_audio::hca_decode` (non conforme) est `#[deprecated]`.
- **Correction honnête** : l'« extraction CPK FAIT » (`c91faeb`) était un **faux FAIT** — jamais validée end-to-end ; cassait sur les vrais CPK (cause = @UTF + CRILAYLA ci-dessus).

### 2. Données — `nie-data` (modèles no_std du jeu, port inagle)
- **État mesuré (2026-06-13)** : **34 familles golden byte-exact** + **8 en portage (lot B2)** ; les jalons datés ci-dessous (31/58, 847 tests) restent l'**historique**. Comptage de tests à reconcilier (marqueurs `#[test]` mesurés ~990 vs 962 vs 847 — cf. `docs/INVENTAIRE.md` § discordances).
- **FAIT (5/7)** : skill-info, item-info, growth-tables, exp-table, passive-skill (validés byte contre les vrais cfg.bin + recalcul `calculateStats` inagle au bit près).
- **FAIT (2026-06-06) : base passives unifiée** — `nie-data/src/passives.rs` (+ `bin/export_passives.rs`, `tests/passives_golden.rs`). Lit `passive_skill_config_5.00.07.00.cfg.bin.json` (**1716 passives joueur**, texte résolu via `skill_text` NOUN_INFO fr/en/ja), `soccer_team_passive_config` (21 team passives), `team_passive_lot_table_config` (653 lots). Export → `apps/azalee/data/passives-full.json` (consommé par la page azalee `/passive`). Méta vérifiée : `player_count=1716`, `team_count=21`, `lot_count=653`, `unique_effect_count=128`.
- **FAIT (2026-06-10) : `chara-param` + `aura-cmd` clos** — la logique (pairing **level-first**, résolution aura) était correcte ; restaient des doc-comments hallucinés + l'absence de golden sur vrai fichier. Corrigé : `chara_param` 0x240BEDF2 → learnLevel 0 (vrai dump) ; `aura` 0x0F8C620D → whs01780 (Feu/Tir), structure réelle 387 AURA_CMD_INFO + 1161 REF (la claim « 0/1549 » était hallucinée). **45/45 tests verts, golden sur vrais dumps.**
- **FAIT (2026-06-12) : 10 familles supplémentaires via workflows séquentiels disque-légers → 31/58** — deux vagues de 5, portées **séquentiellement sur le main tree** (un seul `target/`, builds incrémentaux : tient sur un VPS à ~88 % plein là où les worktrees parallèles saturaient le disque) puis **vérifiées adversarialement** : `gallery` (m_GalleryInfoList, 360 entrées), `banner`, `search_word` (config + bookmark), `scene_archive` (6 flags + 112×18), `music_app` (nesting 3 niveaux, var[5] polymorphe), `photo_mode` (91 RANDOM_POSE), `update_notice`, `chat_emote` (3 versions), `user_name_plate`, `input` (adaptive_trigger/haptic/vibration DualSense). +219 tests (847 nie-data total). Anti-faux-FAIT tenu : agent music_app a corrigé 2 hypothèses fausses (variant unique, volume constant) au contact du vrai fichier ; commentaire stale « 95 » de photo_mode corrigé en « 91 » à l'intégration.
- **FAIT (2026-06-10) : 10 familles supplémentaires via workflow → 21/58** — portées en parallèle (worktrees git isolés ; golden via chemin absolu vers le main tree) puis **vérifiées adversarialement** (valeurs golden recoupées au JSON brut, 0 mismatch) : `mission`, `dungeon` (gimmick récursif), `boost_grp`, `record`, `chronicle_top`, `friendmap`, `fast_travel`, `weather`, `light`, `dictionary` (zukan : 43 habitats + 280 obs). +279 tests (628 nie-data total). Caveats honnêtes (sémantique opaque sans source TS) en doc-comments ; typos Level-5 (« SPRIT », « acttion_list ») préservées byte.
- **FAIT (2026-06-10) : 7 familles de match portées → 11/58** — `formation` (10 positions, 1073 placements, 115 formations ; positions terrain = 16 hex-chars = 2 f32 LE, ex. `"000000008FC2753F"` → (0.0, 0.9599) GK profond ; 21 tests), `command` (effets de commande soccer/rpg, format `entries`, 32 tests), `ai` (IA stratégie/tactique, 73 tests), `party` (contrôle/composition d'équipe, 39 tests), `phase` (phases scénarisées de match, 29 tests), `soccer` (config de match : focus-battle/technic/difficulties — sous-ensemble ciblé, 37 tests), `rpg_battle` (combat RPG, 8 parseurs, 74 tests). Tous **golden byte sur les vrais dumps** de `data/common/gamedata/`. Deux layouts cfg.bin coexistent (`lists` / `entries`). Piège serde connu : tableaux `[T;N]` N>32 cassent `Deserialize` → utiliser `Vec`. Ces familles nourrissent directement la boucle de match (cf. §3).

### 3. Moteur / gameplay — `nie-core` (logique reversée portée du C décompilé)
- **FAIT (7/7)** : stat-tables, exp-level, skill-model, aura-model, match-fsm, command-effect-slots, action-ctrl-ring.
- **Mesure réelle** : 4999 LOC, 92 fn publiques, 56 struct/enum, **126 tests + 9 doctests verts, 0 stub**, `#![forbid(unsafe_code)]`. Porté de `soccer_match_state_machine.c`, `soccer_command_effect.c`, `soccer_action_ctrl.c` (formules score `min*10000+sec`, strides, sentinelles confirmés ligne-par-ligne). **Ce n'est pas un squelette.**
- **FAIT (2026-06-10) : boucle de match JOUABLE** — `nie-core/src/match_sim.rs` (`simulate_match`) câble FSM + horloge + effets en un match déterministe kickoff→score→fin, exposé via `nie-headless match --home --away --seed`. **Confirmé byte** vs C : séquence FSM post-match (switch L79-316) + `final_score(90,0)=900000`. **Nominal** (honnêtement marqué) : durée 90 min, modèle de but probabiliste (le vrai moteur est physique), PRNG splitmix64, agrégat `TeamSetup`. **167 tests verts** (140 nie-core + 16 nie-headless + 11 doctests), déterministe. Premier vrai jalon « jouable ».
- **FAIT (2026-06-10) : match piloté par les VRAIES données** — `TeamSetup::with_formation(&FormationConfig, &SoccerFormationInfo)` place les 11 joueurs aux positions **byte-exactes** du dump `formation_config` (GK `start_pos.y = bits 0x3F75C28F`), propagées dans `MatchResult.home/away_placements`. `TeamSetup::from_chara_params_and_levels` dérive les stats réelles de chaque joueur via les tables de croissance (lerp lv1↔lv30 puis lv99) — débloqué après résolution de la vérité terrain sur l'encodage de position : **`Position{GK=1,FW=2,MF=3,DF=4}`** (iecode `types.h:28`/`loader.cpp:178` ; le commentaire « 2=DF » de growth/stats était faux, corrigé). Prouvé byte : `CHARA_PARAM_INFO_1` (FW) lv1=[12,13,12,10,11,9,11], lv30/lv99 idem + test sur le vrai dump `chara_param_1.03.66.00`. **Réserve honnête** : `chara_rank` absent de `CharaParam` → défaut N (stats sous-estimées R→LR), agrégation = moyenne non pondérée.
- **FAIT (2026-06-10) : 1er primitif moteur porté BYTE-EXACT — PRNG `lives::CRand`** — `crate::crand::CRand` = Mersenne Twister MT19937 32-bit, décompilé via Ghidra (`docs/recherche-modele-match-decompile.md` : constantes `0x6C078965`/`0x9908B0DF`, n=624/m=397, tempering canonique, bornage Lemire). **Validé bit-exact** contre le vecteur de référence MT19937 (graine 5489 → 3499211612, 581869302, 3890346734…). Remplace le Splitmix64 nominal dans `match_sim`. **Découverte structurante** : la vraie résolution tir/but n'est PAS une formule inline mais **event-driven (IDs hachés) + data-driven (cfg.bin)** ; le modèle de but de `match_sim` reste donc nominal, à reconstruire depuis le système d'événements (`FUN_1412C0970`). **152 tests lib nie-core** (dont 5 crand).

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
- **FAIT** : runner CLI headless ; surface wasm-bindgen (detect/crilayla/@UTF + g4tx→PNG, audio CRI→WAV, cfg.bin typé) sur `wasm32-unknown-unknown`.
- **Cap révisé (2026-06-13)** : le **chemin central est la GUI native** (`nie-game`/D1, §5bis) ; le wasm (`nie-wasm` → azalee) reste un **compagnon secondaire**, pas la cible de rendu primaire.

### 4bis. Encyclopédie web — `nie-zukan` (ingesteur zukan.inazuma.jp)
- **FAIT (2026-06-06)** : `crates/nie-zukan` ingère l'encyclopédie officielle `zukan.inazuma.jp`. **Algo `?q=` reversé** (`forge.rs`) : `json → complément-à-1 octet par octet → base64url sans padding → percent-encode` (round-trip validé en live, ancre Endou `c01000010`). Client JA/EN (`client.rs`/`pull.rs`), modèles (`models.rs`), parser HTML (`parser.rs`), module `cross.rs`. Croisement vérité terrain : **99,98 % de match avec inagle** (les fiches zukan recoupent les `inagle_characters`). Sert à câbler les **courbes de stats** + données encyclopédiques manquantes côté azalee (RESTANT).

### 4ter. Index des fichiers CPK — export `iev:file:index` → azalee
- **FAIT (2026-06-06)** : l'arbre complet des **250 800 fichiers** des CPK (common 193 540 / dx11 57 260) est indexé en Redis db3 `iev:file:index` (HASH `path → cpk`) et exporté en artefact tracké `apps/azalee/data/cpk-index.ndjson.gz` (~3,9 Mo, via `apps/azalee/scripts/build-cpk-index.ts`). Alimente le navigateur CPK d'azalee (`/cpk`, `/api/cpk`) — cf. `rg/docs/cpk-browser.md`. Couplé au serving live (g4tx→png :8788, GLB texturé :8790) = exploration totale des assets du jeu.

### 5. Échafaudage RE — `nie-re`, `nie-index`, `nie-seed`, `nie-queue`
- **FAIT** : pipeline `seed → rtti → rebuild(.pdata → vtable → disasm → propagate)`. **93,36 %** (49 280/52 783) **classifié** (label de sous-système ML, **pas un nom** ; 81,8 % des labels à confiance < 0,1, ≈1 707 à ancre forte ≥0,75) + **6 429 fonctions (12,18 %) nommées structurellement** (`Namespace::Classe::vmethod_N` via RTTI+vtable, `name_source='vtable-struct'` — **pas** des symboles PDB originaux). **Lever 2026-06-10** : arêtes indirectes (LEA rip-relatif + ancrage vtable→RTTI) 92,45 → 93,36 % (+484 fn, mesuré A/B). Sur `.pdata` (50 674 racines + 2 109 feuilles vtable) + graphe d'appels réel (169 828 arêtes). Table `coverage` dans `var/niers.sqlite`. Heartbeat de fond (`var/re-heartbeat.log`).
- **Découverte clé** : l'index Ghidra est **désaligné** (3,7 % des `FUN_` sont de vrais débuts) ; `.pdata` est la vérité terrain. Toujours s'y adosser.

### 5bis. Host GUI natif — `nie-game` (pilier D1/C4, **chemin central vers le jeu jouable**)
- **FAIT (2026-06-13, squelette de pipeline)** : `crates/nie-game` (1 180 LOC) — host **wgpu 22 + winit 0.30 + pollster 0.3**. Modes `--capture` (rendu hors-écran → PNG, `Rgba8Unorm`/`Nearest`/sans sRGB, readback aligné 256 o **bit-exact**) et `--window` (`ApplicationHandler`). Rend une **vraie texture `.g4tx`** décodée RGBA8 (VFS ou scan CPK direct). Capture vérifiée end-to-end sur un vrai asset du jeu (`soccer00_01.g4tx`, 352×148).
- **FAIT (2026-06-14) : conception pixel-perfect des 2 écrans tête-de-pont → `docs/DESIGN.md`** — `start.png`=`title02`, `menu.png`=`mainmenu01` décomposés élément-par-élément (analyse multi-agents vérifiée adversarialement vs VFS/code/iecode). 6 couches runtime manquantes identifiées + sous-plan **D1.a–D1.f** (cf. `docs/ROADMAP-100.md` pilier D).
- **FAIT (2026-06-14) : D1.a — placement ancêtre-fallback** : `nie-formats/src/g4pkm_motion.rs` (`motion_final_pose`, port iecode `G4pkmMotion.cs:84-192`) branché dans `menu.rs::place_on_canvas`. Découverte structurante : **les slide-in de menu n'ont pas de keyframes dans les fichiers** (G4MA/G4MT = anim de matériau seulement) → la position finale est une **heuristique d'ancêtre on-écran**, pas une lecture de motion. **Effet réel** : `--menu title02` passe du canvas quasi vide au logo IEVR rendu on-écran (45 Ko → 543 Ko PNG). 7 tests motion + 141 tests lib nie-formats, clippy 0.
- **FAIT (2026-06-14) : D1.b — sélection de texture** (`g4tx::select_main_texture`, nom==basename sinon plus grande non-dummy) : ne pioche plus le **dummy 4×4** de tête. + `g4pkm::extract_g4md` exposé. **D1.b-det — DÉTERMINISME (critique)** : rendu rendu reproductible (était non déterministe : `Vfs`=HashMap → locale/ordre aléatoires) ; `resolve_vfs_basename` trié+locale-aware (`fr`), `obj_paths` trié. **3 runs octet-identiques** = prérequis du gate pixel. 144 tests nie-formats, clippy 0.
- **FAIT (2026-06-14) : D1.f gate + D1.c amorcé.** Gate : `nie-game/tests/menu_render_gate.rs` (hard-gate déterminisme + SSIM maison, baseline title02 = **0.25**). D1.c : workflow RE a reversé le dispatch `funcLuaMenuCommand` de nie.exe (handler `0x140C91B30`, **table 1109 cmdId** extraite → `data/re/funclua-cmdids.json`), **12 cmdId** portés dans `nie-lua/menu_host.rs` (layouts d'args corrigés, `current_layer`) → `OnInit` de `title_menu_2` reconnaît **7/7** commandes (était 0/7). 5 tests dispatch.
- **FAIT (2026-06-15) : GÉNÉRATION DE MENU AU RUNTIME — « comme nie »** (demande utilisateur, pour azalee). `nie-lua::drive_menu` exécute les VRAIS scripts Lua du jeu via le driver reversé (OnInit/OnSetupLayer/...) → `MenuState` → `nie-game --menu <screen> --runtime --export-layout`. **Title populé : 10 objets** (7 masqués par la logique DLC réelle), **mainmenu populé : 4 objets** (header/tabs/doc), déterministe, installés dans azalee (`/menu/50_title`, `/menu/100_mainmenu` → 200 en local). Couches reversées (unluac) : `GetObjectAttr` lit les comptes des slots AttachLocator objbin ; INCLUDE `LUA_MAIN_MENU_INC` → `MAIN_MENU`. Reste : reverser les cmdId résiduels (`0x214DA123` tab-icon, ~21 distincts) + tables inverses texte/cell pour 100% du contenu.
- **Reste D1.c** : émuler la **boucle driver** post-`OnInit` (Setup* créent les objets) + getters renvoyant les vraies données + join `crc32(objbin.name)` dans `build_sprite_list` → la SSIM montera. Puis D1.d (texte/police `.g4tg`) → D1.e (3D in-menu) → D1.f cible SSIM ≥ 0,99 ; + bump wgpu **22→29**. Détail : `docs/DESIGN.md` §11/§13.
- **Cap** : c'est désormais la **pointe active** ; le pont wasm/azalee (§4) redevient un **compagnon secondaire**.

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
