# Avancement — Axe « jeu jouable » niers

Synthèse des verdicts par crate (recoupement adversarial contre la vérité terrain : dumps réels `/home/ubuntu/niers/data`, parseurs TS `packages/inagle`, mirror SQLite azalee, C# décompilé `IECODE.Core`). Statut global : **3 crates buildent vert, tests passent**. 18 livrables FAIT / 4 INCOMPLET / 0 NON_FAIT. **4 hallucinations détectées**, toutes localisées à 2 livrables (chara-param, aura-cmd) + 1 en-tête bugué (nxtch).

## Mise à jour 2026-06-13 — cap GUI native

> Le **chemin central** vers le jeu jouable est désormais le host natif **`nie-game`** (pilier D1/C4, wgpu). État des crates depuis cette synthèse (mesuré 2026-06-13) : **`nie-data` 34 familles golden + 8 B2** ; **`nie-formats`** HCA décode + p3lip 20 357 fichiers + **fix cfgbin** (105 tests lib) ; **`nie-core`** match jouable + **CRand MT19937 byte-exact** (2026-06-10, 152 tests lib) ; **`nie-engine`** 15 070 LOC / 434 `// EXTERN:`. Les verdicts détaillés ci-dessous **restent valables** pour les livrables qu'ils couvrent (historique conservé). Stack runtime : `docs/STACK.md` ; inventaire complet : `docs/INVENTAIRE.md`.

---

## nie-core — 7/7 FAIT

**Build/tests réels** : `cargo check` (défaut + all-features + wasm32) OK ; `cargo test` = 126 tests + 9 doctests PASS (défaut ET all-features) ; `clippy --all-features --all-targets` = 0 warning ; `#![forbid(unsafe_code)]`, 0 bloc unsafe.

| Livrable | Statut | Vérité terrain |
|---|---|---|
| stat-tables | FAIT | inagle `calculateStats` exécuté réellement sur vraies tables : 4 cas golden × 4 niveaux byte-identiques (GK_N, FW_UR, DF_sub3_UR, MF_pat2_R). Comptes 36/144/48/48 confirmés. |
| exp-level | FAIT | `chara_exp_table_config` : needExp lv1/2/3/99/100 confirmés byte ; cumulatifs 565/1973/254 recalculés python exacts. |
| skill-model | FAIT | `skill_config_4.00.17.00` : whs00010 (0x63BDA8A4, 70-440, Vent/Tir) et whs01780 (0x0F8C620D, 100-640, Feu/Tir) confirmés byte. |
| aura-model | FAIT | `aura_skill_config_1.04.09.00` : AURA_CMD_INFO_0 (19 vars) byte-pour-byte ; layout d'index + hissatsu→whs01780 confirmés. |
| match-fsm | FAIT | C décompilé `soccer_match_state_machine.c` : formule score `min*10000+sec` exacte (final_score(2,30)=20030), fallthrough case 0→1, flag entraînement `&4` confirmés. |
| command-effect-slots | FAIT | `soccer_command_effect.c` : 6 capacités/strides/sentinelles/flags confirmés ligne-par-ligne (passive stride 0x14 du code, pas le commentaire 0xF0). Effet 0x20DFBB4B param1=1.5 réel. |
| action-ctrl-ring | FAIT | `soccer_action_ctrl.c` : 32 slots stride 0x120, contrat `copy_action` EINVAL 0x16 + memset 0xA0, scales 0x3F800000 (1.0) confirmés. |

**Hallucinations** : aucune. Valeurs incertaines (power_at, layout 160 octets, noms d'états FSM) honnêtement marquées indicatives/reconstruites.

**Caveats mineurs (non bloquants)** : `classify_sub_type` ne porte que la priorité-1 asset-code de `determineSubType` (tous les golden la touchent) ; `match_fsm::tick` utilise des labels d'états interprétatifs et modélise l'avancement nominal.

Fichiers : `crates/engine/nie-core/src/{growth,exp,skill,aura,match_fsm,command_effect,action}.rs` + `data/*.json`.

---

## nie-data — 5/7 FAIT, 2/7 INCOMPLET (hallucinations avérées)

**Build/tests réels** : `cargo check` OK ; `clippy -D warnings` clean ; 27 tests / 9 suites PASS ; wasm32 OK ; `no_std + alloc + forbid(unsafe_code)`. Seul `crates/engine/nie-data/` touché.

| Livrable | Statut | Vérité terrain |
|---|---|---|
| skill-info | FAIT | Fixture identique octet-pour-octet à `skill_config_4.00.17.00` (2627 entrées). Jointure skill_text réelle : nameId 0x07ADF4B1 → « Trampoline du tonnerre ». |
| item-info | FAIT | `item_config_1.03.65.00` : shoes 0x6D5D11A0 (price 1401, stats 30/31, eq_sh110001), consume 0x5F0F1EAC (price None réel). CATEGORY_MAP 20 variantes. |
| growth-tables | FAIT | `calculateStats` inagle recalculé au bit près (Lv1→Lv99, total 1591). `rarityToGrowthRank` identique. floor no_std correct. |
| exp-table | FAIT | `chara_exp_table_config` : needExp L1-L10 identiques, cum5=565/cum10=1973 confirmés. |
| passive-skill | FAIT | `passive_skill_config_0.08.86` : PASSIVE_SKILL_INFO_0 → passiveId 0x3A2BCAF4, effectId 0x41DF1FED. `detectScope`/`detectBoostType` portés ligne-pour-ligne. |
| **chara-param** | **INCOMPLET** | **Pairing technique OFF-BY-ONE** inversé vs vrai parser inagle « level-first » (commit 07ee6ce, l.93-118 : skill@11 impair → niveau@10 pair). Le crate paire skill@11→niveau@12. DB prod prouve 0x240BEDF2 = learnLevel 0 (jamais 1) ; le crate l'assigne à 1. Le test `lecture_level_first_serait_fausse` **entérine le mauvais comportement** et qualifie à tort la vérité de prod de « fausse ». |
| **aura-cmd** | **INCOMPLET** | Code resolve correct, mais **claim « 0/1549 auras résolvent → None »  HALLUCINÉE** (bun-check bugué comparant des skillID hex comme décimaux). Réalité : **61/1548 résolvent**, et AURA_CMD_INFO_0 skillId1 0x0F8C620D résout vers whs01780 (Feu/Tir/100-640). Un golden positif réel déclaré à tort irrésoluble ; le test positif utilise un skill synthétique au lieu du vrai whs01780. |

**Hallucinations** : 2. (1) chara-param — pairing skill/niveau inversé, test anti-régression qui entérine la mauvaise valeur. (2) aura-cmd — conclusion « vérité terrain » fausse. Structures/offsets des 2 livrables corrects ; seules les valeurs golden et conclusions sont hallucinées.

Fichiers : `crates/engine/nie-data/src/`.

---

## nie-formats — 5/7 FAIT, 2/7 INCOMPLET

**Build/tests réels** : `cargo check` OK ; `clippy --all-targets` 0 warning (après rebuild forcé) ; wasm32 `--lib` OK ; `forbid(unsafe_code)` ; aucun `std::`/File/println dans les nouveaux modules. 66 tests + 1 doctest, 100% PASS.

| Livrable | Statut | Vérité terrain |
|---|---|---|
| rdbn-values | FAIT | Byte-à-byte contre vrai `font_color.cfg.bin`. CRC32(zlib) de la liste = name_hash. Port exact de `RdbnReader.cs` (enum RdbnFieldType complet). |
| g4tx-header | FAIT | 2 vrais .g4tx (font_def 44Mo, gaiji_game 736Ko) : toutes valeurs golden confirmées. Écart honnête DDS-pas-NXTCH réel et signalé. |
| g4md-header-submesh | FAIT | Aucun .g4md isolé sur VPS → fixture synthétique conforme. Logique portée exactement de `G4mdParser.cs` (offsets, records 0x50, table d'attributs, ExtractMaterialBaseNames). |
| g4mg-geometry | FAIT | Aucun .g4mg → fixture synthétique couplée. Port exact `ExtractGeometry` (positions float3, normale SNORM16, UV0 UNORM16, indices u16/u32). Garde « pas de fabrication » testée. |
| g4pk-g4ra-archive | FAIT | Validé contre **3 vrais .g4pk** (k002030_p010, s28g001b, ev61100200) : magics G4MT/G4TP/G4SK/G4VS/G4MA corrects. Séquence de tables = port exact `ParseFiles`. ⚠️ Le résumé disait à tort « aucun .g4pk / fixture synthétique » — des .g4pk réels existent et valident mieux. |
| **g4tx-deswizzle-nxtch** | **INCOMPLET** | **BUG RÉEL** : offsets en-tête NXTCH décalés de 4 octets vs struct C# `NxtchHeader`. Rust width@0x10/height@0x14/format@0x20 ; C# Width@0x14/Height@0x18/Format@0x24. Le doc-comment « vérifié contre la struct C# » est **HALLUCINÉ**. `parse_header` non couvert par test à valeurs réelles → bug latent. `from_code`, `block_byte_size`, `calculate_texture_data_size`, `swizzled_offset` (GOB Tegra X1) sont **corrects**. |
| **g4sk-skeleton** | **INCOMPLET** (header FAIT) | Header DÉTERMINISTE validé contre vrai s28g001b.g4sk (magic G4SK, bone_count 25@0x20). Hiérarchie INCOMPLET : `parse_parents_heuristic` porte fidèlement `FindParentIndicesOffset` mais `heuristic=true` toujours, et le vrai g4sk (0xD10 < 0x1000) renverrait None — hiérarchie genuinement non résolue. Classification FAIT(header)/INCOMPLET(hiérarchie) exacte. |

**Hallucinations** : 1. nxtch — doc « vérifié contre struct C# » alors que les offsets ne correspondent pas (off-by-4). Note résumé inexacte sur g4pk/g4sk (« aucun fichier réel ») corrigée ci-dessus.

Fichiers : `crates/engine/nie-formats/src/`.

---

## Reste à faire (correctifs prioritaires)

> **MAJ** : les correctifs P0 `chara-param` (pairing level-first) et `aura-cmd` (61/1548, vrai whs01780) ont été **clos le 2026-06-10** ; le **fix cfgbin overflow** (`parse_t2b`) l'a été le **2026-06-13** (commit `7f3e09c`). Voir `PLAN.md` / `INVENTAIRE.md`. La liste ci-dessous reste l'historique du verdict initial.

1. **nie-data / chara-param** (P0 — donnée fausse) : inverser le pairing vers « level-first » (skill@11 impair → niveau@10 pair), conforme au commit inagle 07ee6ce. Corriger/retirer le test `lecture_level_first_serait_fausse` qui entérine la mauvaise valeur. Valider 0x240BEDF2 → learnLevel 0 et 0x5EDD8114 → level 1/13 via mirror SQLite prod.
2. **nie-formats / g4tx-deswizzle-nxtch** (P0 — bug latent) : recaler les offsets de `parse_header` sur la struct C# `NxtchHeader` (Width@0x14, Height@0x18, Format@0x24, MipMapCount@0x28, TextureDataSize2@0x2C) et ajouter un test à valeurs réelles. Retirer le doc-comment mensonger.
3. **nie-data / aura-cmd** (P1 — conclusion fausse) : corriger le bun-check (comparer skillID en hex, pas décimal), remplacer la claim « 0/1549 → None » par « 61/1548 résolvent », et baser le test positif sur le vrai whs01780 au lieu d'un skill synthétique.
4. **nie-formats / g4sk-skeleton** (P2) : résoudre la hiérarchie d'os sur un g4sk ≥ 0x1000 (heuristique actuelle ne déclenche jamais sur les fichiers disponibles).

## nie-game — host natif wgpu (pilier D1/C4)

**FAIT (2026-06-13, squelette de pipeline)** : capture PNG hors-écran **bit-exacte** (`Rgba8Unorm`/`Nearest`/sans sRGB, readback aligné 256 o) + fenêtre (`ApplicationHandler`), rend une **vraie texture `.g4tx`** décodée RGBA8 (vérifié sur `soccer00_01.g4tx` 352×148). Le bug pré-existant `cfgbin.rs:693` rencontré au montage VFS a été **corrigé** (commit `7f3e09c`) ; le repli scan-CPK-direct reste en place par robustesse. **Reste** : bump wgpu 22→29 + pipeline shaders/transforms (retarget `nie-engine/render.rs`) + gate SSIM.

## Prochains livrables prioritaires (vers le jeu jouable)

- **Rendu natif pixel-perfect (pilier D1, CHEMIN CENTRAL)** : `nie-game` bump **wgpu 22→29**, gate pixel-diff (**image-compare SSIM ≥ 0,99 + égalité octet sha2/blake3**), port des transforms du compositor menu (`nie-engine/render.rs`), **Lua réel** via crate `nie-lua` (`mlua` `lua52` vendored). Détail : `docs/STACK.md`.
- **Skinning g4sk + animations (D2)** : port maison f32 scalaire + glam `scalar-math` (pas d'ozz) → modèles animés rendus.
- **Validation bout-en-bout** : test golden d'un match complet (kickoff → score `min*10000+sec` → fin) recoupant le C décompilé — *la boucle `simulate_match` pilotée par les vraies données est déjà FAIT (cf. PLAN §3)*.
- **Compagnon (secondaire)** : export des familles portées vers azalee (`/typed`, `export_*`) — livré, maintenu, mais **plus le cap**.
