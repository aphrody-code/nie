# niers — INVENTAIRE réel (RE / extraction / portage par pilier)

> État mesuré au **2026-06-13**. Décomposition en 5 couvertures C1–C5 (cf. `docs/ROADMAP-100.md` § 1). Règle d'or préservée : **aucun « FAIT » sans validation end-to-end sur le réel** (byte-à-byte vs iecode/inagle, pixel-à-pixel vs le jeu).
>
> **Cap (2026-06-13)** : le chemin vers le jeu jouable passe désormais par la **GUI native `nie-game` (host wgpu, pilier D1/C4)** ; le pont **azalee** (B′) est un **compagnon web secondaire** (livré, plus le cap). Cet inventaire est ordonné en conséquence : C1→C3 (socle acquis), **C4 = la pointe active**, C5 = échafaudage (rendements décroissants).

## C1 — Formats (lecture pure-Rust des conteneurs)

**Source** : `crates/engine/nie-formats/src/` (16 modules — +`objbin`, +`g4pkm` au 2026-06-14), `docs/cartographie-data.md` (2026-06-13).

- **16/16 modules implémentés** ; **15/16 parsent du réel** (seul `nxtch.rs` sans fichier IEVR PC réel — variante Switch, 0/250 800).
- **Trilogie menu — FAIT (2026-06-14)** : `objbin` (objet-menu = quoi : texture/z-order/composants), `g4pkm` (transform 2D = où : squelette G4SK → poses bind écran), `g4tx` (pixels) → un écran de menu est entièrement descriptible nativement. Portés d'iecode, **validés byte-exact via le VFS réel** (cpk_list déchiffré) : `win01_21` draw_priority 300, `option02_02` os nvidia X0/Y0/1920×1080, etc.
- **Fichiers lisibles : 232 323 / 250 800 = 92,6 %** (cartographie-data.md, 2026-06-13). *Métrique officielle ROADMAP = 84,06 % (2026-06-10, antérieure à p3lip — à reconcilier, cf. gaps.)*
- **p3lip (lip-sync) : 20 357 fichiers réels validés byte-à-byte (2026-06-13)** — `lip.rs` (185 LOC), magic `lip\0`, visèmes u8, route `/lip`.
- **HCA décode réellement (A2, 2026-06-10)** : clé IEVR `0x00D2997C0DC5EE72` + magic masqué `0xC8C3C1` + sous-clé AFS2, via `cridecoder` (clHCA). Vérifié `c00001001.awb` (48 kHz mono, non silencieux).
- **CPK : 921/921 déchiffrent** (clé = CRC32 du nom, XOR position-based). Pas de 2ᵉ enveloppe/clé non publique (A5 résolu).
- **Gates** : **A0 FAIT** (RDBN, g4tx/g4md/g4mg/g4pk, @UTF, CRILAYLA, CPK, GLB texturé) ; **A1 FAIT** (nxtch N/A PC) ; **A2 FAIT** (HCA). **A3/A4/A5 = résidu**.
- **Tests** : **125 nie-formats (lib) / 0 échec** (mesuré 2026-06-14 : +cpk_list AES, +objbin, +g4pkm, validés byte-exact sur le VFS réel) + **30 nie-wasm / 0 échec** (jumeaux natifs).

**Reste (A4) — ~6 557 fichiers (2,6 %) sans parseur réel** (après objbin, plus gros restant levé) : `vfxo` 1 335 · `g4cm` 1 210 · `col` 1 143 · `pfxo` 1 113 · `ptlb` 655 · `fxbin` 372 · `mevbin` 328 · `g4nv` 156 · `g4mt` 63 · `clobin` 39 · `g4ma` 35 · script Lua 616 (non décompilé). Priorité gameplay : `g4cm` (caméra cutscene) > `col` (collision) > `g4nv` (navmesh) > `mevbin` (motion-event). *(`objbin` 11 920 — **levé 2026-06-14**, cf. trilogie menu.)*

**Dettes** : A3 `g4sk` garde un fallback heuristique (`parse_parents_heuristic`, g4sk.rs l.371-392) — hiérarchie résolue par table d'offsets sur `s28g001b.g4sk` (19 os) mais slots `SLOT_PARENTS=4`/`SLOT_NAMES=8` hardcodés ; HCA multikey validée sur 1 AWB seulement (généraliser à ≥3) ; G4MD/G4MG validés sur fixture synthétique + `u11130090` (pas de `.g4md` isolé réel) ; `vfs.rs` est std-only (cache LRU budget `NIE_CPK_CACHE_BUDGET_GIB`, défaut 16 Gio).

## C2 — Données (familles cfg.bin portées + recalcul au bit)

**Source** : `crates/engine/nie-data/src/` (**48 fichiers .rs**), `crates/engine/nie-data/tests/*_golden.rs` (47 fichiers).

- **34 familles golden byte-exact confirmées** (énumérées ROADMAP l.48 ; le doc dit « 31/58 » → discordance +3 non arbitrée, cf. gaps). Baseline + workflows séquentiels disque-légers : skill, item, growth, exp, passives, aura, chara_param, formation, command, ai, party, phase, soccer, rpg_battle, mission, dungeon, boost_grp, record, chronicle_top, friendmap, fast_travel, weather, light, dictionary, gallery, banner, search_word, scene_archive, music_app, photo_mode, update_notice, chat_emote, user_name_plate, input.
- **+8 familles en portage (lot B2)** : chara_bank, skill_view, post (+5 sous-familles), craft, trophy, setting_menu, vsroute, help.
- **Tests golden : 962 `#[test]` mesurés (2026-06-13)** ; ROADMAP cite 847 (2026-06-10) → +115.
- **Reste : 27/58 familles** (shop 9,5M, capsule 6,6M, quest 66 fichiers, system 28, team 4 — *match-critical, prioritaire*, players_universe, event 54/272M, character 45/131M — partiellement couvert ; ~40 sur 58 sont de vraies familles de données, le reste = assets/système hors C2).
- **Export industrialisé (2026-06-13)** : `export_passives` → `passives-full.json` ; `export_formations` → `formations-full.json` (115 formations, 83 valides). Route générique `/typed/<vfs>.json` = **37 familles** dispatchées live (formation 115 coords f32, mission, aura 387, item 4153, skill 1001, chara_param 6148).

**Vérité terrain** : dumps `data/common/gamedata/*.cfg.bin.json` + inagle (TS) + iecode (C#). Réserves honnêtes préservées (`chara_rank` absent de `CharaParam` → stats R→LR sous-estimées ; soccer/rpg_battle = sous-ensembles documentés ; typos Level-5 « SPRIT »/« acttion_list » préservées byte).

## C3 — Logique moteur (portage du décompilé)

**Source** : `crates/archive/nie-engine/src/` (12 fichiers, **15 070 LOC**), `crates/engine/nie-core/src/` (16 fichiers + 2 tests, **6 102 LOC**). Les deux : `#![forbid(unsafe_code)]`.

- **nie-engine** : **129 pub fn**, **271 tests**, **11 sous-systèmes publics** (app, render, menu, audio, animation, scripting, network, cpk, g4 + cfgbin utilitaire) **+ `physics` privé** (PhysX, 35 tests, non exposé `pub mod`). **434 `// EXTERN:` non résolues** (≈7,6/fn) = socle = îlot non connecté. Portage : **60 fonctions C décompilées** (commit 2026-06-05) ; ~55 distinctes.
- **nie-core** : **103 pub fn**, **166 marqueurs `#[test]`** (mesuré 2026-06-13 : **152 lib** verts + 14 en `tests/`), **15 sous-systèmes logiques**, **0 `EXTERN`** (autonome). Portage : **14 primitives gameplay** (2026-06-04, depuis `soccer_match_state_machine.c`/`soccer_command_effect.c`/`soccer_action_ctrl.c`).
- **PRNG `lives::CRand` (MT19937 32-bit) BYTE-EXACT (2026-06-10)** : `0x6C078965`/`0x9908B0DF`, n=624/m=397, tempering canonique, bornage Lemire ; validé vs vecteur de référence (graine 5489). 1er primitif moteur réel.
- **Boucle de match JOUABLE déterministe (2026-06-10)** : `match_sim::simulate_match` (kickoff→score→fin), `final_score(2,30)=20030` confirmé byte vs C. **Pilotée par les vraies données** : `with_formation` (placements byte-exacts du dump `formation_config`), `from_chara_params_and_levels` (stats via tables de croissance, mapping `Position{GK=1,FW=2,MF=3,DF=4}` tranché par iecode `types.h:28`).
- **Dette lint** : `render.rs` 2236 LOC, **37 items publics, 11 documentés (30 %)** alors que `#![warn(missing_docs)]`.

**Restent NOMINAUX (honnêtement marqués)** : modèle de but probabiliste (le vrai est event-driven `FUN_1412C0970` + data-driven cfg.bin), agrégation `TeamSetup` (moyenne non pondérée), `chara_rank` par défaut. La VM Lua actuelle (`scripting.rs`) est un **simulateur de dispatch**, pas une vraie VM → cible du sous-système `nie-lua` (cf. `docs/STACK.md`).

## C4 — Rendu (pixel-perfect) — LA POINTE ACTIVE

**Source** : `crates/engine/nie-game/src/main.rs` (**1 180 LOC**), `crates/engine/nie-formats/src/assemble.rs` (2279 LOC), `crates/tools/nie-model-serve`.

- **D0 FAIT partiel** : assemblage **GLB statique texturé** (corps + face + uniforme, g4tx→PNG BC1-7 embarqués), servi live par `nie-model-serve` (`/model-full/<code>.glb`, 6 routes, cache configurable). Manifeste uniforme 3550 entrées.
- **Host natif `nie-game` (D1) EN PLACE** : wgpu **22** + winit 0.30 + pollster 0.3. Modes `--capture` (rendu hors-écran → PNG, `Rgba8Unorm`/`Nearest`/sans sRGB, readback aligné 256 o **déjà bit-exact**) et `--window` (surface + `ApplicationHandler`). **Rend une vraie texture `.g4tx`** décodée RGBA8 depuis les CPK (VFS ou scan direct). C'est le squelette du pipeline pixel-perfect.
- **D1/D2/D3 NON DÉMARRÉS** : pas encore de pipeline portant les shaders/transforms du moteur ; pas de skinning g4sk animé rendu ; pas de scène de match rendue. **C4 SSIM = — (aucune mesure).**
- **Bug réel découvert par le host, CORRIGÉ (2026-06-13, commit `7f3e09c`)** : `nie-formats/src/cfgbin.rs:693` débordait (`off + len`) dans `parse_t2b` sur un en-tête chiffré → panic en debug, wrap silencieux en release (pire). `parse_t2b` valide désormais le signe + `checked_add` → renvoie `Corrupt` proprement (+3 tests de régression). Plus aucun panic sur les binaires du workspace.
- **`cpk_list.cfg.bin` déchiffré — RÉSOLU (2026-06-14, commit `bdb45a6`)** : ce n'est ni l'enveloppe XOR (Viola/nom) ni du compressé, mais **AES-256-CBC**. Clé/IV **reversés statiquement de `nie.exe`** (loader @ VA `0x14168D5E0`, xref string `0x1418BA8E8`, désassemblé via `nie-re`/iced-x86) : `KEY = decrypt_block(blob256, 0, seed 0x8A90ABA9)`, `IV = decrypt_block(blob128, 0, seed 0x4C801618)`, puis AES-256-CBC. Porté (`cpk::decrypt_cpk_list`, dép `aes` RustCrypto), `vfs::init()` recâblé. **Vérifié réel** : footer T2B `01 74 32 62`, `entries_count=254203`, **`Vfs::init()` indexe 254 202 fichiers logiques** (était cassé/repli). iecode N'A PAS ce déchiffrement (« Unknown encryption »). Le scan CPK `@UTF` reste un chemin valide en parallèle.

**Écran de menu RENDU de bout en bout (2026-06-14)** : la trilogie `objbin`+`g4pkm`+`g4tx` + assembleur (`menu::place_on_canvas`/`assemble_object`) + compositeur CPU (`menu::compose`, blit affine/bilinéaire/over) → `nie-game --menu <écran> --capture <png>`. Vérifié réel : `title00` → **15 sprites composés** → écran d'avertissement santé du jeu reconnaissable (1280×720). Les positions sont les poses g4pkm byte-exactes (correct par construction). Portée : éléments STATIQUES (les objets sans `g4tx` — boutons-texte, overlays runtime — et les éléments animés sont hors scope). Reste : pipeline GPU + **gate pixel-diff** (nécessite une capture de référence du vrai jeu) ; pas de prétention pixel-perfect à ce stade.

**Chemin D1→D3** (cf. `docs/STACK.md`) : bump wgpu 22→29 + retarget `nie-engine/render.rs` (D3D11) → gate pixel-diff (image-compare SSIM + égalité octet) → skinning (port maison + glam scalaire) → audio runtime (cpal + CRI maison) → vidéo (libvpx VP9) → Lua réel (mlua lua52). Azalee/wasm = compagnon, pas le chemin.

## C5 — RE / échafaudage (nommer, pas seulement classer)

**Source** : `var/niers.sqlite` (binary_id=2 `nie_eacpatched.exe#pdata`, indexé 2026-06-04 19:43:43, couverture mesurée 2026-06-10 22:10:47).

- **Total : 52 783 fonctions** (borné par `.pdata` réel : 50 674 racines + 2 109 feuilles vtable).
- **Classifiées : 49 280 = 93,36 %** (2026-06-10 ; 92,45→93,36 % via arêtes indirectes LEA + ancrage vtable→RTTI, +484 fn dont +17 à confiance ≥0,3).
- **Nommées : 6 429 = 12,18 %** (2026-06-10 ; 0→non nul). **100 % `name_source='vtable-struct'`** = noms structurels `Namespace::Classe::vmethod_N`, **pas** les symboles C++ originaux.
- **Non classifiées (standalone) : 3 503 = 6,64 %**.
- **Distribution des classifiées par sous-système** : menu 11 592 · chara 11 507 · physics 8 238 · gameplay 6 608 · animation 4 547 · audio 3 354 · network 1 081 · render 849 · level 528 · script 528 · vfs 384 · input 64.
- **RTTI** : 1 575 classes ; **169 828 arêtes d'appel directes** (≈×25 vs le graphe Ghidra désaligné).

**Découverte structurante** : l'index Ghidra est désaligné (3,7 % des `FUN_` sont de vrais débuts) ; `.pdata` est la vérité terrain. **C5 est un moyen, pas la fin** : la priorité bascule de « monter le % » vers « nommer + porter par sous-système » (ré-export Ghidra aligné `analyzeHeadless` = E2, en attente). Le résidu (~3 500 fn) est largement isolé → rendements décroissants.

## Transverse — Assets servis & portabilité (compagnon)

- **250 800 fichiers** indexés (Redis db3 `iev:file:index`, exporté `cpk-index.ndjson.gz`).
- **`nie-model-serve`** : routes `/tex`, `/model-full`, `/model-motion`, `/audio`, `/video`, `/lip`, `/typed`, `/cpk`, déployé VPS :8790, proxifié `cdn.rosegriffon.fr`.
- **`nie-wasm`** : **12 exports wasm-bindgen** (detect_format, crilayla_decompress, utf_table_json, calculate_stats, match_tick, final_score, skill/aura/item_lookup…). Decode g4tx→PNG, audio CRI→WAV, cfg.bin typé in-browser (commits récents).
- **azalee** (repo `rg`, pont B′) : explorateur CPK refondu, viewers typés, `My Team builder` aux vraies formations. **Reste compagnon secondaire** — la lecture live `/typed` couvre la valeur, l'écriture miroir `inagle_*` (B′1) est résiduelle.

## Discordances / dettes à arbitrer

1. **C1 92,6 % (cartographie 2026-06-13) vs 84,06 % (ROADMAP 2026-06-10)** : lag p3lip (20 357 fichiers). Reconcilier la métrique officielle.
2. **C2 « 31/58 » (ROADMAP l.16) vs 34 noms énumérés (l.48)** : trancher via `git log 2026-06-10..HEAD` (hypothèses : passive/passives = 1 ; +3 après baseline ; comptage azalee-ready vs src-ported).
3. **Tests nie-data : ~990 marqueurs `#[test]` (mesuré 2026-06-13) vs 962 (synthèse) vs 847 (ROADMAP)** ; le delta = comptage marqueurs bruts vs tests passés vs snapshot daté. Mesurer le `cargo nextest` réel pour figer le chiffre officiel.
4. **physics.rs privé** : motif délibéré ou dette ? À clarifier.
5. **434 EXTERN nie-engine** : socle = îlot ; résorber par sous-système (cible C2-logique).
6. **Comptage crates : 17 mesuré** (`ls crates/*/`) — toute mention « 18 » est à corriger.
7. **RÉSOLU 2026-06-13/14** : (a) overflow `cfgbin.rs:693` corrigé (`7f3e09c`, +3 tests) ; (b) **`cpk_list.cfg.bin` déchiffré** — AES-256-CBC reversé de `nie.exe` (`bdb45a6`), `Vfs::init()` monte 254 202 fichiers. Plus de blocker VFS ; la RE du conteneur est faite.
