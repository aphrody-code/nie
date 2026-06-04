# Vérification adversariale — nie-formats (CPK + g4sk) & nie-wasm

Date : 2026-06-05. Toolchain `nightly-2026-05-17` (rustc 1.97.0-nightly d3cd04068).
Méthode : build/test réels + ré-implémentation indépendante (Python) sur octets binaires
réels + recoupement avec les structs C# `IECODE.Core` et les vrais fichiers IEVR du VPS.

## Build / tests réels (constatés)

- `cargo check --workspace` : **VERT**.
- `cargo test --workspace` : **VERT**, 0 échec (27 suites `test result: ok`).
- `cargo test -p nie-formats` : **79 passed / 0 failed** (+ 1 doctest).
- `cargo test -p nie-wasm` : **27 passed / 0 failed** (jumeaux natifs).
- `cargo build -p nie-wasm --target wasm32-unknown-unknown --release` : **VERT** (std wasm32 présente).
- `cargo clippy -p nie-formats -p nie-wasm` (natif) : **propre**.
- `cargo clippy -p nie-wasm --target wasm32-unknown-unknown` : **propre**.
- `#![forbid(unsafe_code)]` présent dans `nie-formats/src/lib.rs` ET `nie-wasm/src/lib.rs`.
- Aucune modif sous `/home/ubuntu/rg/packages` (git status confiné à `niers`).

## nie-formats

### cpk-decryption — **FAIT** (vérifié sur le réel, indépendamment)

- Distinction clé confirmée par la source C# :
  - `0x1717E18E` = `IEVRGame.CriEncryptionKey` / `NativeCrypto.IEVRCriKey`, clé **FIXE** passée en dur
    à `DecryptBlock` dans `Viola/Pack/Logic/CPack.cs` L59/L156 et `Viola/Dump/Logic/CDump.cs` L114
    (cfg.bin Viola). Ce n'est PAS la clé des `.cpk` de packs.
  - Les `.cpk` de `data/packs/` passent par `CpkDecryptionStream.FromFile` →
    `CriwareCrypt.CalculateKeyFromFilename(Path.GetFileName(...))` (CRC32 poly 0xEDB88320,
    init/xorout 0xFFFFFFFF). Port fidèle dans `cpk.rs` (`key_from_filename`, `decrypt_block`
    position-aware, `decrypt_and_check_cpk`).
- Ré-implémentation Python indépendante exécutée sur les VRAIS octets
  (`/home/ubuntu/.local/share/Steam/iecode/inazuma/data/packs/*.cpk`) :
  - `1d08dda…` → clé `0xBD281847` → magic `CPK ` + `@UTF` @0x10 ✔
  - `fc62c6ef…` → `0x00DE44F8` → `CPK `/`@UTF` ✔
  - `48d8f85b…` → `0x5629F92E` → `CPK `/`@UTF` ✔
  - `6a3ab1ff…` → `0x52B41918` → `CPK `/`@UTF` ✔
  - Les 4 clés correspondent **exactement** aux valeurs assertées dans les tests.
  - Clé fixe `0x1717E18E` sur un pack → `14 ff 0a 0b` (bruit, PAS `CPK `) — réfute l'audit.
- Fixture committée (`…head512.enc`) = **octets chiffrés réels identiques** aux 512 premiers
  octets du vrai `.cpk` (`cmp` OK). Le fichier brut commence bien par `8e ef 66 e3` (chiffré),
  pas `CPK `.
- Verdict : la correction du worker est **juste et adossée au réel**. Pas d'hallucination.

### g4sk-hierarchy — **FAIT** (vérifié sur le réel, indépendamment)

- Cause « ne se déclenche jamais » confirmée : `G4skParser.cs` L157 scanne
  `for (int i = 0x1000; ...)`. Le vrai `s28g001b.g4sk` fait **3344 octets** (< 0x1000) → le scan
  C# ne se déclenche jamais. Constat exact.
- Fixture `s28g001b.g4sk` = **données réelles** : les 3344 octets sont retrouvés VERBATIM à
  l'offset 128 dans le vrai `s28g001b.g4pk`
  (`/home/ubuntu/.local/share/Steam/iecode/inazuma/data/_g4pk_fixtures/`).
- Décodage indépendant (Python) du layout réel (table de slots @0x22, slot[4]=parents @0xB6C
  sentinelle=bone_count, slot[8]=offsets de noms @0xC1C, header_end 0x40) :
  - `bone_count = 19`.
  - parents bruts `[19,0,1,2,1,1,5,5,5,5,5,5,5,5,5,19,15,16,16]` → normalisés (19→-1)
    `[-1,0,1,2,1,1,5,5,5,5,5,5,5,5,5,-1,15,16,16]` — **identique** à la valeur assertée.
  - 19 noms exacts (`s28g001b_map`, …, `instance`, …, `ao241_bk00_02`) — **identiques**.
  - 2 racines `[0,15]` — identiques. Arbre acyclique.
- `parse_hierarchy` valide (parents bornés + forêt acyclique + noms imprimables) puis retombe sur
  `parse_parents_heuristic` (marqué `heuristic=true`) si invalide — pas de fabrication.
- Verdict : **juste et adossé au réel**. Pas d'hallucination.

## nie-wasm — **FAIT**

- Cible wasm32 : **compile** (release, toolchain nightly std wasm présente) + clippy wasm propre.
- 12 exports dans `pkg/nie_wasm.d.ts` régénérés (wasm-bindgen) dont les 8 nouveaux :
  `calculate_stats, single_stat, rarity_to_growth_rank, match_tick, final_score,
  skill_lookup, aura_lookup, item_lookup` (+ 4 préexistants : `detect_format`,
  `crilayla_decompress`, `utf_table_json`, `init_panic_hook`).
- Chaque fonction a un jumeau natif `cfg`-gardé (`Result<_,String>`) → testable hors wasm
  (27 tests natifs verts). `init_panic_hook` conservé. Sérialisation via `serde_json`.
- Goldens adossés au réel (vérifiés en amont dans nie-core/nie-data) :
  - growth FW rang UR lv99 = `[207,216,218,235,242,210,261]` (ancré sur `nie_core::growth`
    `golden_fw_ur`, lui-même calé sur `inagle/stat-calculator.ts`, tables IEVR embarquées
    `growth_table.json`).
  - FSM `final_score(2,30)=20030` ; skill whs00010 `0x63BDA8A4` ; aura `AURA_CMD_INFO_0` ;
    item `ITEM_SHOES_INFO_0`.
- Le savoir exposé est pré-existant (nie-core/nie-data déjà validés) ; nie-wasm ne fait que le
  projeter au navigateur. Aucune clé/offset inventé introduit ici.
- Note descriptive mineure (non bloquante) : la signature réelle de `single_stat` est
  `single_stat(level, stat_lv1, stat_lv30, stat_lv50, stat_lv99)` (interpolation 4 paliers),
  pas une variante de `calculate_stats` — divergence de libellé dans le résumé, pas un défaut code.

## Synthèse

| Crate | Livrable | Statut | Adossé au réel |
|---|---|---|---|
| nie-formats | cpk-decryption | **FAIT** | Oui (4 CPK réels, struct C#, fixture = octets réels) |
| nie-formats | g4sk-hierarchy | **FAIT** | Oui (fixture extraite du vrai g4pk, décodage indépendant 1:1) |
| nie-wasm | calculate_stats / single_stat / rarity_to_growth_rank | **FAIT** | Oui (golden inagle) |
| nie-wasm | match_tick / final_score (FSM) | **FAIT** | Oui (FSM décompilée) |
| nie-wasm | skill_lookup / aura_lookup / item_lookup | **FAIT** | Oui (1ers records réels) |
| nie-wasm | wasm32 build + glue pkg/ | **FAIT** | n/a (compile + 12 exports) |

**Aucune hallucination détectée.** La clé `0x1717E18E` n'est PAS présentée comme la clé des packs ;
elle est correctement reléguée à `VIOLA_FIXED_KEY` (cfg.bin) avec un test qui assert qu'elle ne
déchiffre PAS un pack. Les clés des packs (CRC32 du nom) et la hiérarchie g4sk sont reproduites
indépendamment sur les vrais octets binaires. Builds et tests réels VERTS.
