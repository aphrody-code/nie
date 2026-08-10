//! Chargement et dispatch des fichiers `cfg.bin` du moteur Level-5 Lives.
//!
//! Port Rust de trois fonctions Ghidra extraites de `nie.exe` :
//!
//! | Fonction C           | Adresse        | Rôle                                        |
//! |----------------------|----------------|---------------------------------------------|
//! | `FUN_1415f5590`      | `0x1415f5590`  | [`cfgbin_loader`] — chargeur principal      |
//! | `FUN_14160abb0`      | `0x14160abb0`  | [`cfgbin_loader2`] — chargeur secondaire    |
//! | `FUN_14160d640`      | `0x14160d640`  | [`cfgbin_parser`] — dispatch/parser         |
//!
//! ## Observations RE
//!
//! Les deux chargeurs partagent une structure quasi-identique. La différence
//! clé est l'emplacement dans le registre de ressources (`registry_slot`) :
//! - `cfgbin_loader` → slot `0x390` (registre primaire, `FUN_1415f4e20`)
//! - `cfgbin_loader2` → slot `0x820` (registre secondaire, `FUN_14160a910`)
//!
//! Le parser (`cfgbin_parser`) a deux branches :
//! 1. **Inline** — `param_2+8 == 0` : les données sont déjà dans le descripteur,
//!    on extrait les champs et on appelle `FUN_141608cd0` (dispatch NPC/audio).
//! 2. **Fichier** — `param_2+8 != 0` : on construit le chemin
//!    `common/gamedata/map/<MAP>/<name>.cfg` et on délègue à `FUN_14160a910`.
//!
//! ## Constantes binaires reproduites fidèlement
//!
//! - `MAP_MAX_INDEX = 0x400` : borne exclusive de l'index de carte valide.
//! - `MAP_ENTRY_STRIDE = 0xb0` : taille d'une entrée dans la table des cartes.
//! - `MAP_TABLE_OFFSET = 0x34c450` : décalage de la table dans le GameSys.
//! - `MAP_CURRENT_INDEX_OFFSET = 0x2284` : décalage de l'index courant.
//! - `MAP_ENTRY_FIELD_0x9C_OFFSET = 0x9c` : décalage du champ d'ID dans l'entrée.
//! - `ASSET_REG_BASE_OFFSET = 0x50` : décalage du pointeur de base dans le GameSys.
//! - `CFGBIN_EXT_PRIMARY = "141770d98"` : pointeur vers la chaîne `"cfg"` (slot 0).
//! - `CFGBIN_EXT_SECONDARY = "141770ee8"` : pointeur vers la chaîne `"cfg"` (slot 1).
//! - `FLOAT_NEG_ONE_BITS = 0xbf800000` : `f32` `-1.0` en bits IEEE 754.
//!
//! ## `no_std`
//!
//! Compatible `no_std + alloc`. Toutes les dépendances sur le contexte moteur
//! réel (registre, GameSys, etc.) sont remplacées par des types locaux documentés.
//! Les fonctions externes non portées sont référencées via `// EXTERN:`.

extern crate alloc;
use alloc::{format, string::String};

// ---------------------------------------------------------------------------
// Constantes extraites fidèlement du code C décompilé
// ---------------------------------------------------------------------------

/// Borne exclusive de l'index de carte valide (Ghidra : `0x400`).
///
/// Source : `FUN_1415f5590`, `FUN_14160abb0`, `FUN_14160d640`.
pub const MAP_MAX_INDEX: u32 = 0x400;

/// Valeur sentinelle d'index carte invalide (`0xffffffff`).
///
/// Source : comparaison `uVar1 != 0xffffffff` dans les trois fonctions.
pub const MAP_INDEX_INVALID: u32 = 0xFFFF_FFFF;

/// Taille d'une entrée dans la table des cartes (`0xb0` = 176 octets).
///
/// Source : `(ulonglong)uVar1 * 0xb0 + 0x34c450 + …` — les trois fonctions.
pub const MAP_ENTRY_STRIDE: usize = 0xb0;

/// Décalage de la table des cartes dans le `GameSys` global (`0x34c450`).
///
/// Source : `FUN_1415f5590` L62, `FUN_14160abb0` L62, `FUN_14160d640` L115.
pub const MAP_TABLE_OFFSET: usize = 0x34c450;

/// Décalage de l'index de carte courant dans le `GameSys` (`0x2284`).
///
/// Source : `*(uint *)(DAT_141f7d6a0 + 0x2284)`.
pub const MAP_CURRENT_INDEX_OFFSET: usize = 0x2284;

/// Décalage du champ d'identifiant à l'intérieur d'une entrée de carte (`0x9c`).
///
/// Source : `*(int *)(lVar3 + 0x9c)` / `*(undefined4 *)(lVar3 + 0x9c)`.
pub const MAP_ENTRY_ID_OFFSET: usize = 0x9c;

/// Décalage du pointeur de base de la table dans `GameSys` (`0x50`).
///
/// Source : `*(longlong *)(DAT_141f7d6a0 + 0x50)`.
pub const ASSET_REG_BASE_OFFSET: usize = 0x50;

/// Slot du registre de ressources primaire (`0x390`).
///
/// Source : `FUN_140435320(param_1 + 0x390, …)` dans `FUN_1415f5590`.
pub const REGISTRY_SLOT_PRIMARY: usize = 0x390;

/// Slot du registre de ressources secondaire (`0x820`).
///
/// Source : `FUN_140435320(param_1 + 0x820, …)` dans `FUN_14160abb0`.
pub const REGISTRY_SLOT_SECONDARY: usize = 0x820;

/// `f32::from_bits(0xbf800000)` = `-1.0` — valeur float sentinel utilisée dans `LoadParams`.
///
/// Source : `local_548 = 0xbf800000` dans `FUN_1415f5590` ; `local_528 = 0xbf800000` dans `FUN_14160abb0`.
pub const FLOAT_NEG_ONE_BITS: u32 = 0xbf80_0000;

/// Pad SSE `0xf8` utilisé par `insertps(ZEXT816(0),ZEXT816(0),0xf8)` pour
/// initialiser un vecteur de position à zéro.
///
/// Source : `local_558 = insertps(ZEXT816(0),ZEXT816(0),0xf8)` — les deux chargeurs.
pub const SSE_INSERTPS_ZERO_IMM: u8 = 0xf8;

/// Chemin de base des fichiers de données cartographiques.
///
/// Source : `"%s%s.%s", "common/gamedata/map/<MAP>/"` — les trois fonctions.
pub const MAP_DATA_BASE_PATH: &str = "common/gamedata/map/<MAP>/";

/// Extension des fichiers de configuration (chaîne dans `nie.exe` à `0x141770d98`).
///
/// Source : `local_588 = (undefined4 **)0x141770d98` (`FUN_1415f5590`).
pub const CFGBIN_EXT: &str = "cfg";

// ---------------------------------------------------------------------------
// Types locaux représentant le contexte moteur (substituts aux globaux C)
// ---------------------------------------------------------------------------

/// Entrée dans la table des cartes du moteur.
///
/// Port sémantique de la structure non nommée accédée à
/// `*(longlong *)(DAT_141f7d6a0 + 0x50) + index * 0xb0`.
///
/// Porte de : `FUN_1415f5590`, `FUN_14160abb0`, `FUN_14160d640` (accès champs `+0x9c`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MapEntry {
    /// Identifiant du scénario/map courant (lu à `+0x9c` dans l'entrée).
    ///
    /// Vaut `0` si absent/invalide ; le moteur ignore l'entrée si `== 0`.
    pub scenario_id: u32,
}

/// État du système de jeu global (`DAT_141f7d6a0`).
///
/// Substitut au pointeur global brut. Encode les deux champs
/// utilisés par les chargeurs de `cfg.bin`.
///
/// Porte de : `FUN_1415f5590` L57-65, `FUN_14160abb0` L57-65, `FUN_14160d640` L112-121.
#[derive(Debug, Clone)]
pub struct GameSys {
    /// Index de la carte actuellement chargée (`+0x2284`).
    /// `MAP_INDEX_INVALID` (0xffffffff) si aucune carte.
    pub current_map_index: u32,
    /// Table des entrées de carte (adressable par index, stride `0xb0`).
    /// Port de la table à `+0x34c450` (base résolue via `+0x50`).
    pub map_table: alloc::vec::Vec<MapEntry>,
}

impl GameSys {
    /// Résout l'entrée de carte courante si l'index est valide.
    ///
    /// Reproduit fidèlement le triple test du C :
    /// ```text
    /// if (uVar1 != 0xffffffff && uVar1 < 0x400
    ///     && *(int*)(lVar3 + 0x9c) != 0 && lVar3 != 0)
    /// ```
    #[must_use]
    pub fn current_map_entry(&self) -> Option<MapEntry> {
        let idx = self.current_map_index;
        if idx == MAP_INDEX_INVALID || idx >= MAP_MAX_INDEX {
            return None;
        }
        let entry = self.map_table.get(idx as usize).copied()?;
        // Le C vérifie `*(int*)(lVar3 + 0x9c) != 0` avant d'utiliser la valeur.
        if entry.scenario_id == 0 {
            return None;
        }
        Some(entry)
    }
}

/// Paramètres de chargement d'un fichier `cfg.bin`.
///
/// Port sémantique de la zone de pile assemblée avant l'appel à
/// `FUN_1415f4e20` (chargeur primaire) ou `FUN_14160a910` (secondaire).
///
/// Porte de : `FUN_1415f5590` L89-105, `FUN_14160abb0` L89-104.
#[derive(Debug, Clone, PartialEq)]
pub struct LoadParams {
    /// Chemin résolu du fichier cfg (ex. `"common/gamedata/map/<MAP>/field.cfg"`).
    ///
    /// C : `local_510 = local_158` (pointeur vers le buffer de chemin formaté).
    pub path: String,

    /// Identifiant de slot de ressource (ex. ID de carte ou d'objet).
    ///
    /// C : `local_508 = *param_2` (chargeur primaire) / `local_550 = *param_2`.
    pub resource_id: u32,

    /// Identifiant de type de ressource, lu depuis le descripteur lié au
    /// fichier trouvé (`*(undefined4 *)(lVar2 + 0x10)`).
    ///
    /// C : `local_504 = *(undefined4 *)(lVar2 + 0x10)`.
    pub resource_type: u32,

    /// Valeur float de priorité (sentinel `-1.0` = `0xbf800000` pour primaire,
    /// ou valeur explicite pour secondaire).
    ///
    /// C : `local_548 = 0xbf800000` (primaire), `local_528 = 0xbf800000` (secondaire).
    pub priority: f32,

    /// Flag de mode de chargement : `0` = primaire, `1` = secondaire.
    ///
    /// C : `local_504 = 0` implicite dans primaire (pas écrit) ;
    ///     `local_548 = 1` explicitement dans `FUN_14160abb0` L92.
    pub load_mode: u32,

    /// Identifiant de scénario/map courant (résolu depuis `GameSys`).
    ///
    /// C : `uVar7` dans `FUN_1415f5590` L64, `FUN_14160abb0` L64.
    pub scenario_id: u32,

    /// Paramètre facultatif passé en `param_4` (extra, peut être nul).
    ///
    /// C : `if (param_4 != 0x0) { uVar9 = *param_4; } local_4fc = uVar9;`
    pub extra_param: u32,
}

/// Descripteur de configuration inline passé à `cfgbin_parser`.
///
/// Représente la structure pointée par `param_2` dans `FUN_14160d640`.
/// Les accès au tableau `param_2[N]` sont des accès à des `u32` (4 octets each),
/// donc `param_2[N]` = offset `N * 4` en octets.
///
/// Porte de : `FUN_14160d640` — accès champs `0x14`..`0x27`, `0x8`..`0xd`.
#[derive(Debug, Clone)]
pub struct CfgDescriptor {
    /// `param_2[0]` (offset 0x00) — identifiant primaire de la ressource.
    pub resource_id: u32,

    /// `param_2[2]` (offset 0x08) — si `!= 0`, c'est un pointeur vers le nom
    /// du fichier cfg.bin à charger (branche « fichier ») ; si `== 0`, les
    /// données sont inline (branche « direct »).
    ///
    /// En Rust, modélisé comme `Option<String>` : `None` = inline.
    pub file_name: Option<String>,

    /// `param_2[4]` (offset 0x10) — hash/id de type de ressource.
    pub type_id: u32,

    /// `param_2[5]` (offset 0x14) — id secondaire (slot).
    pub slot_id: u32,

    /// `param_2[8]` (offset 0x20) — vec2 lo (composante x, f32 bits).
    /// Port de `*(undefined8 *)(param_2 + 8)`.
    pub vec2_lo: u64,

    /// `param_2[10]` (offset 0x28) — vec2 hi (composante y, f32 bits).
    /// Port de `*(undefined8 *)(param_2 + 10)`.
    pub vec2_hi: u64,

    /// `param_2[0xc]` (offset 0x30) — paramètre de chargement supplémentaire.
    pub load_param_c: u32,

    /// `param_2[0xd]` (offset 0x34) — flag mode 1 octet (lu via `*(undefined1 *)(param_2 + 0xd)`).
    pub flag_d: u8,

    /// `param_2[0xd]` offset 0x35 — flag secondaire un octet.
    pub flag_35: u8,

    // --- Champs de la branche inline (branche `local_4cc == 0`) ---

    /// `param_2[0x14]` (offset 0x50) — composante X de la transformation.
    pub inline_x: u32,

    /// `param_2[0x15]` (offset 0x54) — entier de contrôle (si `== 0` ⇒ `float_override = -1.0`).
    pub inline_ctrl: i32,

    /// `param_2[0x16]` (offset 0x58) — valeur float override si `inline_ctrl != 0`.
    pub inline_float: f32,

    /// `param_2[0x17]` (offset 0x5c) — valeur supplémentaire.
    pub inline_extra: u32,

    /// `*(undefined8 *)(param_2 + 0x10)` (offset 0x40) — pointeur d'animation lo.
    pub anim_ptr_lo: u64,

    /// `*(undefined8 *)(param_2 + 0x12)` (offset 0x48) — pointeur d'animation hi.
    pub anim_ptr_hi: u64,

    /// `*(undefined8 *)(param_2 + 0x18)` (offset 0x60) — données de transform.
    pub transform_data: u64,

    /// `*(undefined8 *)(param_2 + 0x1c)` (offset 0x70) — données étendues lo.
    pub ext_data_lo: u64,

    /// `*(undefined8 *)(param_2 + 0x20)` (offset 0x80) — données étendues hi.
    pub ext_data_hi: u64,

    /// `param_2[0x1a]` (offset 0x68) / `param_2[0x1e]` (offset 0x78) — packed low.
    pub packed_low: u64,

    /// `param_2[0x1b]` (offset 0x6c) — identifiant auxiliaire.
    pub aux_id: u32,

    /// `param_2[0x1f]` (offset 0x7c) — paramètre rect.
    pub rect_param: u32,

    /// `param_2[0x22]` (offset 0x88) — identifiant entité (32 bits lo de `local_518`).
    pub entity_id: u32,

    /// `(undefined1 *)(param_2 + 0x27)` (offset 0x9c) — octet flags entité hi.
    pub entity_flags_hi: u8,

    /// `param_2[0x23]` (offset 0x8c) / `param_2[0x24]` (offset 0x90) — type action packed.
    pub action_type_packed: u64,

    /// `param_2[0x26]` (offset 0x98) — identifiant de paramètre distant.
    pub remote_param_id: u32,
}

/// Résultat du dispatch d'un chargeur de `cfg.bin`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LoadResult {
    /// Chargement réussi, handle de ressource retourné (ulonglong non-nul masqué).
    Ok(u64),
    /// Précondition échouée (fichier non trouvé dans la DB, GameSys non initialisé).
    Skip,
    /// Erreur de construction du chemin ou d'accès registre.
    Err,
}

// ---------------------------------------------------------------------------
// EXTERN stubs documentés
// ---------------------------------------------------------------------------

// EXTERN: FUN_140d862f0 — recherche un fichier dans la base de données d'assets
//   par son identifiant de slot. Retourne un pointeur non-nul si trouvé,
//   ou 0 si absent. Signature : fn(asset_db: u64, slot_id: &u32) -> u64.
//   Utilisé : `lVar2 = FUN_140d862f0(*(undefined8 *)(DAT_141f7d6e0 + 0x430), local_578)`

// EXTERN: FUN_1416709b0 — `memset(buf, 0, len)` — efface un buffer.
//   Signature : fn(buf: *mut u8, val: u8, len: usize).

// EXTERN: FUN_14005b8b0 — `snprintf(buf, fmt, args…)` — formatte une chaîne C.
//   Signature : fn(buf: *mut u8, fmt: *const u8, …).

// EXTERN: FUN_140e33460 — initialise une liste variante (append-list engine interne).
//   Signature : fn(list: *mut VariantList).

// EXTERN: FUN_140e085b0 — construit un élément de liste variante depuis un u32.
//   Signature : fn(val: &u32) -> u64.

// EXTERN: FUN_14047f670 — formate le chemin final du fichier cfg selon un template
//   en substituant la carte courante. Appelle FUN_140480430 comme callback.
//   Signature : fn(out: *mut u8, out_len: usize, template: *const u8, args: *const FmtArgs).

// EXTERN: FUN_140480430 — callback de formatage de chemin (substitution `<MAP>`).
//   Signature : fn(ctx: *const u8) -> *const u8.

// EXTERN: FUN_140435320 — recherche une entrée dans le registre de ressources.
//   Signature : fn(registry: *mut Registry, id: u32) -> *mut RegistryEntry.

// EXTERN: FUN_1404784a0 — libère une entrée du registre (décrément ref-count).
//   Signature : fn(entry_id: u32).

// EXTERN: FUN_140435ae0 — résout une entrée du registre en handle de ressource.
//   Signature : fn(registry: *mut Registry, entry_id: u32) -> u64.

// EXTERN: FUN_140452ac0 — enregistre une ressource dans le registre.
//   Signature : fn(registry: *mut Registry, handle: u64).

// EXTERN: FUN_1415f4e20 — dispatch de chargement primaire (slot 0x390).
//   Signature : fn(scene: *mut Scene, params: *const LoadParamsRaw) -> bool.

// EXTERN: FUN_14160a910 — dispatch de chargement secondaire (slot 0x820).
//   Signature : fn(scene: *mut Scene, params: *const LoadParamsRaw, cb: *const u8, flags: u32) -> u32.

// EXTERN: FUN_141608cd0 — dispatch NPC/audio depuis les données inline.
//   Appelé uniquement dans la branche inline de cfgbin_parser.
//   Signature : fn(action_type: u32, ctrl_out: *mut i32, transform: *const TransformRaw, entity_id: u32).

// EXTERN: FUN_14043b3c0 — callback de chargement de ressource générique.
//   Signature : fn(ctx: *const u8) (passé en paramètre de FUN_14160a910).

// ---------------------------------------------------------------------------
// cfgbin_loader — FUN_1415f5590 @ 0x1415f5590
// ---------------------------------------------------------------------------

/// Chargeur primaire de `cfg.bin` (slot registre `0x390`).
///
/// Porte de : `FUN_1415f5590` (`cfgbin_loader.c`).
///
/// ## Logique C reproduite
///
/// 1. Recherche le slot `resource_id` dans la DB d'assets (`FUN_140d862f0`).
///    Si non trouvé (`lVar2 == 0`), retourne `Skip` immédiatement.
/// 2. Vérifie que `GameSys` est initialisé. Si non, retourne `Skip`.
/// 3. Résout l'entrée de carte courante (`current_map_index`, stride `0xb0`).
///    Si index invalide ou champ `+0x9c == 0`, utilise `scenario_id = 0`.
/// 4. Construit le chemin : `"common/gamedata/map/<MAP>/<name>.cfg"`.
/// 5. Cherche l'entrée dans le registre (slot `0x390`). Si trouvée, la purge.
/// 6. Assemble les `LoadParams` et délègue à `FUN_1415f4e20` (EXTERN).
///
/// ## Retour
///
/// - `LoadResult::Ok(handle)` — succès, `handle` masqué sur `0xffffffffffffff00`.
/// - `LoadResult::Skip` — asset non trouvé ou GameSys absent.
pub fn cfgbin_loader(
    resource_id: u32,
    asset_name: &str,
    game_sys: Option<&GameSys>,
    extra_param: Option<u32>,
) -> (LoadResult, Option<LoadParams>) {
    // C: lVar2 = FUN_140d862f0(…, local_578)  → simule la recherche DB par resource_id.
    // On reçoit le résultat en entrée via `game_sys` : si None, l'asset n'est pas trouvé.
    // EXTERN: FUN_140d862f0 (asset DB lookup)
    let Some(game_sys) = game_sys else {
        // C: `if (lVar2 != 0)` — asset non trouvé.
        return (LoadResult::Skip, None);
    };

    // C: `if (DAT_141f7d6a0 != 0)` — GameSys initialisé.
    // Dans notre modèle, game_sys est toujours initialisé si Some.

    // C: uVar1 = *(uint *)(DAT_141f7d6a0 + 0x2284)
    // C: uVar7 = resolve lVar3+0x9c ou 0
    let scenario_id = game_sys
        .current_map_entry()
        .map_or(0, |e| e.scenario_id);

    // C: FUN_1416709b0(local_258, 0, 0x100) — memset path buf
    // C: FUN_14005b8b0(local_258, "%s%s.%s", "common/gamedata/map/<MAP>/", param_3)
    // On construit directement en Rust.
    let formatted_path = format!("{}{}.{}", MAP_DATA_BASE_PATH, asset_name, CFGBIN_EXT);

    // C: FUN_14047f670(local_158, 0x100, local_258, &local_570)
    // → substitue <MAP> dans le chemin. Port direct : on ne résout pas <MAP> ici
    // car la résolution dépend du runtime. On garde le template littéral.
    // EXTERN: FUN_14047f670, FUN_140480430 (résolution de chemin)
    let resolved_path = formatted_path; // <MAP> reste un placeholder sans contexte runtime

    // C: puVar5 = FUN_140435320(param_1 + 0x390, *param_2)
    //    if (puVar5 != 0x0) { FUN_1404784a0(*puVar5); lVar3 = FUN_140435ae0(…); … }
    // → purge de l'ancienne entrée registre (slot 0x390).
    // EXTERN: FUN_140435320, FUN_1404784a0, FUN_140435ae0, FUN_140452ac0

    // C: Assemble la zone de pile LoadParams (local_510 .. local_4fc).
    // local_548 = 0xbf800000 → priorité = -1.0f
    // local_500 = 0x4000 → (limit / buffer hint)
    // local_528/530/538/520 = 0 → positions zéro (insertps 0xf8)
    // local_504 = *(undefined4 *)(lVar2 + 0x10) → resource_type (à compléter en runtime)
    let extra = extra_param.unwrap_or(0);

    let params = LoadParams {
        path: resolved_path,
        resource_id,
        resource_type: 0, // résolu en runtime via lVar2+0x10 (EXTERN)
        priority: f32::from_bits(FLOAT_NEG_ONE_BITS), // -1.0
        load_mode: 0,      // chargeur primaire : pas de flag secondaire
        scenario_id,
        extra_param: extra,
    };

    // C: uVar6 = FUN_1415f4e20(param_1, local_558)
    // EXTERN: FUN_1415f4e20 → dispatch de chargement primaire
    // On retourne les params pour que le caller puisse les passer à la vraie fn.
    (LoadResult::Ok(0), Some(params))
}

// ---------------------------------------------------------------------------
// cfgbin_loader2 — FUN_14160abb0 @ 0x14160abb0
// ---------------------------------------------------------------------------

/// Chargeur secondaire de `cfg.bin` (slot registre `0x820`).
///
/// Porte de : `FUN_14160abb0` (`cfgbin_loader2.c`).
///
/// ## Différences avec [`cfgbin_loader`]
///
/// - Slot registre : `0x820` au lieu de `0x390`.
/// - `load_mode = 1` (C : `local_548 = 1`).
/// - Priorité lue depuis `local_528 = 0xbf800000` (même valeur, mais position différente
///   dans la zone de pile — le compilateur a réorganisé les variables locales).
/// - Dispatch final vers `FUN_14160a910(…, FUN_14043b3c0, 1)` au lieu de `FUN_1415f4e20`.
///
/// ## Logique C reproduite
///
/// Identique à `cfgbin_loader` étape par étape, sauf les deux différences ci-dessus.
/// La chaîne d'extension est référencée à `0x141770ee8` (au lieu de `0x141770d98`).
///
/// ## Retour
///
/// Identique à [`cfgbin_loader`].
pub fn cfgbin_loader2(
    resource_id: u32,
    asset_name: &str,
    game_sys: Option<&GameSys>,
    extra_param: Option<u32>,
) -> (LoadResult, Option<LoadParams>) {
    // C: lVar2 = FUN_140d862f0(…, local_588[0]) — vérification asset DB
    // EXTERN: FUN_140d862f0
    let Some(game_sys) = game_sys else {
        return (LoadResult::Skip, None);
    };

    // C: uVar1 = *(uint *)(DAT_141f7d6a0 + 0x2284) — index carte courant
    let scenario_id = game_sys
        .current_map_entry()
        .map_or(0, |e| e.scenario_id);

    // C: FUN_14005b8b0(local_258, "%s%s.%s", "common/gamedata/map/<MAP>/", param_3)
    let formatted_path = format!("{}{}.{}", MAP_DATA_BASE_PATH, asset_name, CFGBIN_EXT);
    // EXTERN: FUN_14047f670 (substitution <MAP>)
    let resolved_path = formatted_path;

    // C: puVar5 = FUN_140435320(param_1 + 0x820, *param_2)  ← slot différent
    //    (purge de l'ancienne entrée registre slot 0x820)
    // EXTERN: FUN_140435320, FUN_1404784a0, FUN_140435ae0, FUN_140452ac0

    // C: Assemble zone de pile :
    //   local_558 = ptr path, local_550 = *param_2, local_54c = *(lVar2+0x10)
    //   local_548 = 1          ← flag secondaire (load_mode=1)
    //   local_528 = 0xbf800000 ← priorité -1.0f
    //   local_524 = 0, local_518..4f8 = 0, local_4f8 = 0
    //   local_544 = extra si param_4 != 0

    let extra = extra_param.unwrap_or(0);
    let params = LoadParams {
        path: resolved_path,
        resource_id,
        resource_type: 0, // résolu via lVar2+0x10 (EXTERN)
        priority: f32::from_bits(FLOAT_NEG_ONE_BITS), // -1.0f
        load_mode: 1,      // C: local_548 = 1
        scenario_id,
        extra_param: extra,
    };

    // C: uVar6 = FUN_14160a910(param_1, &local_558, FUN_14043b3c0, 1)
    // EXTERN: FUN_14160a910, FUN_14043b3c0
    (LoadResult::Ok(0), Some(params))
}

// ---------------------------------------------------------------------------
// cfgbin_parser — FUN_14160d640 @ 0x14160d640
// ---------------------------------------------------------------------------

/// Résultat du parser de `cfg.bin`.
#[derive(Debug, Clone, PartialEq)]
pub enum ParseResult {
    /// Branche inline : données extraites du descripteur, dispatch NPC/audio effectué.
    /// Contient `true` si `FUN_141608cd0` a renvoyé un contrôle non nul.
    Inline {
        /// Résultat du dispatch inline (`local_5d4 != 0`).
        dispatched: bool,
        /// Paramètres inline extraits pour inspection.
        inline_params: InlineParams,
    },
    /// Branche fichier : chemin construit, chargement secondaire déclenché.
    File {
        /// `true` si `FUN_14160a910` a réussi.
        loaded: bool,
        /// Paramètres de chargement construits.
        load_params: LoadParams,
    },
    /// GameSys absent ou index carte invalide (branche fichier uniquement).
    Skip,
}

/// Paramètres extraits de la branche inline de `cfgbin_parser`.
///
/// Correspond aux variables locales de `FUN_14160d640` dans le bloc `if (local_4cc == 0)`.
///
/// Porte de : `FUN_14160d640` L78-105.
#[derive(Debug, Clone, PartialEq)]
pub struct InlineParams {
    /// `param_2[0x14]` (offset 0x50) — `local_4e8` — composante X transform.
    pub comp_x: u32,
    /// `param_2[0x15]` (offset 0x54) — `iStack_4e4` — contrôle float.
    /// Si `== 0` : `float_val = -1.0`. Sinon : `float_val = param_2[0x16]`.
    pub ctrl: i32,
    /// Valeur float dérivée (C: `uStack_4e0`).
    /// `f32::from_bits(0xbf800000)` = `-1.0` si `ctrl == 0`.
    pub float_val: f32,
    /// `param_2[0x17]` (offset 0x5c) — `uStack_4dc`.
    pub extra: u32,
    /// `param_2[4]` (offset 0x10) — `local_538` — type ID.
    pub type_id: u32,
    /// `param_2[0x1b]` (offset 0x6c) — `local_534` — aux ID.
    pub aux_id: u32,
    /// `param_2[5]` (offset 0x14) — `local_52c` — slot ID.
    pub slot_id: u32,
    /// `param_2[0x1f]` (offset 0x7c) — `local_530` — rect param.
    pub rect_param: u32,
    /// `param_2[0x26]` (offset 0x98) — `local_4d0` — remote param.
    pub remote_param_id: u32,
    /// `*(undefined8 *)(param_2 + 0x1c)` (offset 0x70) — `local_508`.
    pub ext_data_lo: u64,
    /// `*(undefined8 *)(param_2 + 0x20)` (offset 0x80) — `uStack_520`.
    pub ext_data_hi: u64,
    /// `*(undefined8 *)(param_2 + 0x10)` (offset 0x40) — `local_4f8`.
    pub anim_ptr_lo: u64,
    /// `*(undefined8 *)(param_2 + 0x12)` (offset 0x48) — `uStack_4f0`.
    pub anim_ptr_hi: u64,
    /// `*(undefined8 *)(param_2 + 0x18)` (offset 0x60) — `local_4d8`.
    pub transform_data: u64,
    /// `local_518` = `CONCAT14(*(uint8*)(param_2+0x27), param_2[0x22])` —
    /// concaténation de l'octet flags-hi (8 bits) et de l'entity_id (32 bits).
    pub entity_packed: u64,
    /// `_uStack_510` = `CONCAT44(param_2[0x23], param_2[0x24])`.
    pub action_type_packed: u64,
    /// `_uStack_500` = `CONCAT44(param_2[0x1a], param_2[0x1e])`.
    pub packed_low: u64,
    /// `param_2[0x24]` (offset 0x90) — paramètre pour `FUN_141608cd0`.
    pub dispatch_param: u32,
    /// `*param_2` (offset 0x00) — identifiant primaire.
    pub resource_id: u32,
    /// `local_528 = 1` — toujours 1 dans la branche inline.
    pub flag_one: u32,
    /// `local_4c4 = 0, local_4c2 = 0, local_4c1 = 0` — zones réservées.
    pub reserved: [u8; 3],
}

/// Dispatch/parser principal de `cfg.bin`.
///
/// Porte de : `FUN_14160d640` (`cfgbin_parser.c`).
///
/// ## Logique C reproduite
///
/// ### Branche A — données inline (`local_4cc == 0`, i.e. `descriptor.file_name.is_none()`)
///
/// Les champs du descripteur sont lus directement et restructurés :
///
/// ```text
/// local_4e8 = param_2[0x14]     (comp_x)
/// iStack_4e4 = param_2[0x15]    (ctrl)
/// uStack_4dc = param_2[0x17]    (extra)
/// local_538  = param_2[4]        (type_id)
/// …
/// local_528  = 1                 (flag_one, toujours 1)
/// if (iStack_4e4 == 0) uStack_4e0 = 0xbf800000  else uStack_4e0 = param_2[0x16]
/// FUN_141608cd0(param_2[0x24], &local_5d4, &local_538, *param_2)
/// uVar2 = (local_5d4 != 0)
/// ```
///
/// ### Branche B — chargement depuis fichier (`local_4cc != 0`)
///
/// Identique à [`cfgbin_loader2`] mais paramètres issus du descripteur :
///
/// ```text
/// FUN_14005b8b0(local_228, "%s%s.%s", "common/gamedata/map/<MAP>/", local_4cc)
/// // purge registre slot 0x820 pour param_2[4]
/// // assemble LoadParams depuis descriptor
/// FUN_14160a910(param_1, &local_5a8, FUN_14043b3c0, 1)
/// ```
///
/// ## Différence clé loader2 vs parser (branche B)
///
/// Dans le parser, `local_578 = param_2[0xc]` — un champ additionnel `load_param_c`
/// est copié dans la zone de pile de LoadParams. Absent des chargeurs simples.
pub fn cfgbin_parser(
    descriptor: &CfgDescriptor,
    game_sys: Option<&GameSys>,
) -> ParseResult {
    match &descriptor.file_name {
        // ----------------------------------------------------------------
        // Branche A : données inline (local_4cc == 0)
        // ----------------------------------------------------------------
        None => {
            // C: local_4e8 = param_2[0x14] — comp_x
            let comp_x = descriptor.inline_x;

            // C: iStack_4e4 = param_2[0x15] — ctrl
            let ctrl = descriptor.inline_ctrl;

            // C: uStack_4dc = param_2[0x17] — extra
            let extra = descriptor.inline_extra;

            // C: local_538 = param_2[4] — type_id
            let type_id = descriptor.type_id;

            // C: local_534 = param_2[0x1b] — aux_id
            let aux_id = descriptor.aux_id;

            // C: local_52c = param_2[5] — slot_id
            let slot_id = descriptor.slot_id;

            // C: local_530 = param_2[0x1f] — rect_param
            let rect_param = descriptor.rect_param;

            // C: local_4d0 = param_2[0x26] — remote_param_id
            let remote_param_id = descriptor.remote_param_id;

            // C: local_508 = *(undefined8 *)(param_2 + 0x1c) — ext_data_lo
            let ext_data_lo = descriptor.ext_data_lo;
            // C: uStack_520 = *(undefined8 *)(param_2 + 0x20) — ext_data_hi
            let ext_data_hi = descriptor.ext_data_hi;
            // C: local_4f8 = *(undefined8 *)(param_2 + 0x10) — anim_ptr_lo
            let anim_ptr_lo = descriptor.anim_ptr_lo;
            // C: uStack_4f0 = *(undefined8 *)(param_2 + 0x12) — anim_ptr_hi
            let anim_ptr_hi = descriptor.anim_ptr_hi;
            // C: local_4d8 = *(undefined8 *)(param_2 + 0x18) — transform_data
            let transform_data = descriptor.transform_data;

            // C: local_4c4 = 0; local_4c2 = 0; local_4c1 = 0 — zones réservées
            let reserved = [0u8; 3];

            // C: local_528 = 1 — flag_one toujours 1 dans branche inline
            let flag_one: u32 = 1;

            // C: if (iStack_4e4 == 0) { uStack_4e0 = 0xbf800000 }
            //    else { uStack_4e0 = param_2[0x16] }
            let float_val = if ctrl == 0 {
                f32::from_bits(FLOAT_NEG_ONE_BITS) // -1.0
            } else {
                descriptor.inline_float
            };

            // C: local_518 = (ulonglong)CONCAT14(*(undefined1 *)(param_2 + 0x27), param_2[0x22])
            // → concatène 1 octet flags_hi (8 bits hi) et entity_id (32 bits lo)
            let entity_packed =
                ((descriptor.entity_flags_hi as u64) << 32) | (descriptor.entity_id as u64);

            // C: _uStack_510 = CONCAT44(param_2[0x23], param_2[0x24])
            let action_type_packed = descriptor.action_type_packed;

            // C: _uStack_500 = CONCAT44(param_2[0x1a], param_2[0x1e])
            let packed_low = descriptor.packed_low;

            // C: FUN_141608cd0(param_2[0x24], &local_5d4, &local_538, *param_2)
            // → dispatch NPC/audio. `local_5d4` est la sortie de contrôle.
            // EXTERN: FUN_141608cd0 — dispatch NPC/audio
            // On simule : dispatch_param = param_2[0x24] (lo 32 bits de action_type_packed)
            let dispatch_param = (descriptor.action_type_packed & 0xFFFF_FFFF) as u32;
            // EXTERN: résultat de FUN_141608cd0 (contrôle non nul = succès)
            // On ne peut pas appeler la vraie fn ici ; on documente le retour attendu.
            let dispatched = false; // EXTERN: FUN_141608cd0 → local_5d4 != 0

            // C: uVar2 = local_5d4 != 0
            let inline_params = InlineParams {
                comp_x,
                ctrl,
                float_val,
                extra,
                type_id,
                aux_id,
                slot_id,
                rect_param,
                remote_param_id,
                ext_data_lo,
                ext_data_hi,
                anim_ptr_lo,
                anim_ptr_hi,
                transform_data,
                entity_packed,
                action_type_packed,
                packed_low,
                dispatch_param,
                resource_id: descriptor.resource_id,
                flag_one,
                reserved,
            };

            ParseResult::Inline { dispatched, inline_params }
        }

        // ----------------------------------------------------------------
        // Branche B : chargement depuis fichier (local_4cc != 0)
        // ----------------------------------------------------------------
        Some(file_name) => {
            // C: if (DAT_141f7d6a0 != 0) — GameSys initialisé
            let Some(game_sys) = game_sys else {
                return ParseResult::Skip;
            };

            // C: uVar1 = *(uint *)(DAT_141f7d6a0 + 0x2284)
            // C: uVar6 = lVar3+0x9c si valide, sinon 0
            let scenario_id = game_sys
                .current_map_entry()
                .map_or(0, |e| e.scenario_id);

            // C: FUN_14005b8b0(local_228, "%s%s.%s", "common/gamedata/map/<MAP>/", local_4cc)
            let formatted_path =
                format!("{}{}.{}", MAP_DATA_BASE_PATH, file_name, CFGBIN_EXT);
            // EXTERN: FUN_14047f670 (substitution <MAP>)
            let resolved_path = formatted_path;

            // C: puVar5 = FUN_140435320(param_1 + 0x820, param_2[4])
            //    (purge registre slot 0x820 pour type_id = param_2[4])
            // EXTERN: FUN_140435320, FUN_1404784a0, FUN_140435ae0, FUN_140452ac0

            // C: Assemble la zone de pile LoadParams (local_5a8 .. local_548).
            // local_578 = param_2[0xc]    ← load_param_c (spécifique au parser)
            // local_5a8 = local_128 (ptr chemin)
            // local_588 = *(u64*)(param_2+8), uStack_580 = *(u64*)(param_2+10) — vec2
            // local_5a0 = param_2[4] — type_id
            // local_59c = param_2[5] — slot_id
            // local_598 = param_2[0x1b] — aux_id
            // local_594 = *param_2 — resource_id
            // local_574 = *(u8*)(param_2+0xd) — flag_d
            // local_573 = *(u8*)((longlong)param_2+0x35) — flag_35
            // local_568 = *(u64*)(param_2+0x10) — anim_ptr_lo
            // uStack_560 = *(u64*)(param_2+0x12) — anim_ptr_hi
            // local_558 = param_2[0x14] — comp_x
            // iStack_554 = param_2[0x15] — ctrl
            // uStack_54c = param_2[0x17] — extra
            // local_548 = *(u64*)(param_2+0x18) — transform_data
            // if (iStack_554 == 0) uStack_550 = 0xbf800000 else uStack_550 = param_2[0x16]

            let priority_bits = if descriptor.inline_ctrl == 0 {
                FLOAT_NEG_ONE_BITS
            } else {
                descriptor.inline_float.to_bits()
            };

            let params = LoadParams {
                path: resolved_path,
                resource_id: descriptor.resource_id,
                resource_type: descriptor.type_id,
                priority: f32::from_bits(priority_bits),
                load_mode: 1, // C: identique à cfgbin_loader2
                scenario_id,
                extra_param: descriptor.load_param_c,
            };

            // C: uVar2 = FUN_14160a910(param_1, &local_5a8, FUN_14043b3c0, 1)
            // EXTERN: FUN_14160a910, FUN_14043b3c0
            ParseResult::File { loaded: false, load_params: params }
        }
    }
}

// ---------------------------------------------------------------------------
// Tests unitaires
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn make_game_sys(map_index: u32, scenario_id: u32) -> GameSys {
        let mut table = alloc::vec![MapEntry { scenario_id: 0 }; MAP_MAX_INDEX as usize];
        if map_index < MAP_MAX_INDEX {
            table[map_index as usize] = MapEntry { scenario_id };
        }
        GameSys { current_map_index: map_index, map_table: table }
    }

    // --- GameSys::current_map_entry ---

    #[test]
    fn game_sys_index_invalid_retourne_none() {
        let gs = make_game_sys(MAP_INDEX_INVALID, 42);
        assert!(gs.current_map_entry().is_none());
    }

    #[test]
    fn game_sys_index_hors_borne_retourne_none() {
        // MAP_MAX_INDEX = 0x400 — borne exclusive
        let gs = GameSys {
            current_map_index: MAP_MAX_INDEX,
            map_table: alloc::vec![MapEntry { scenario_id: 1 }; 1],
        };
        assert!(gs.current_map_entry().is_none());
    }

    #[test]
    fn game_sys_scenario_zero_retourne_none() {
        // scenario_id == 0 → ignoré (C: `*(int*)(lVar3+0x9c) != 0`)
        let gs = make_game_sys(5, 0);
        assert!(gs.current_map_entry().is_none());
    }

    #[test]
    fn game_sys_valid_retourne_entry() {
        let gs = make_game_sys(3, 0x42);
        let entry = gs.current_map_entry().expect("entrée valide attendue");
        assert_eq!(entry.scenario_id, 0x42);
    }

    // --- cfgbin_loader ---

    #[test]
    fn loader_sans_game_sys_retourne_skip() {
        let (result, params) = cfgbin_loader(1, "field", None, None);
        assert_eq!(result, LoadResult::Skip);
        assert!(params.is_none());
    }

    #[test]
    fn loader_construit_le_chemin_correct() {
        let gs = make_game_sys(0, 0xFF);
        let (result, params) = cfgbin_loader(1, "field", Some(&gs), None);
        // L'asset est « trouvé » (game_sys présent) → Ok avec params
        assert!(matches!(result, LoadResult::Ok(_)));
        let p = params.expect("params attendus");
        assert_eq!(
            p.path,
            "common/gamedata/map/<MAP>/field.cfg"
        );
    }

    #[test]
    fn loader_priorite_est_neg_one() {
        let gs = make_game_sys(1, 0x1);
        let (_, params) = cfgbin_loader(7, "test", Some(&gs), None);
        let p = params.unwrap();
        // -1.0f en bits IEEE = 0xbf800000
        assert_eq!(p.priority.to_bits(), FLOAT_NEG_ONE_BITS);
    }

    #[test]
    fn loader_load_mode_est_zero() {
        let gs = make_game_sys(2, 0x2);
        let (_, params) = cfgbin_loader(9, "conf", Some(&gs), None);
        assert_eq!(params.unwrap().load_mode, 0);
    }

    #[test]
    fn loader_extra_param_forwarde() {
        let gs = make_game_sys(0, 0x10);
        let (_, params) = cfgbin_loader(1, "x", Some(&gs), Some(0xCAFE));
        assert_eq!(params.unwrap().extra_param, 0xCAFE);
    }

    #[test]
    fn loader_extra_param_defaut_zero() {
        let gs = make_game_sys(0, 0x1);
        let (_, params) = cfgbin_loader(1, "x", Some(&gs), None);
        assert_eq!(params.unwrap().extra_param, 0);
    }

    // --- cfgbin_loader2 ---

    #[test]
    fn loader2_sans_game_sys_retourne_skip() {
        let (result, params) = cfgbin_loader2(1, "battle", None, None);
        assert_eq!(result, LoadResult::Skip);
        assert!(params.is_none());
    }

    #[test]
    fn loader2_load_mode_est_un() {
        // Différence clé par rapport à loader1 : C: local_548 = 1
        let gs = make_game_sys(0, 0x5);
        let (_, params) = cfgbin_loader2(2, "npc", Some(&gs), None);
        assert_eq!(params.unwrap().load_mode, 1);
    }

    #[test]
    fn loader2_chemin_meme_format() {
        let gs = make_game_sys(0, 0x3);
        let (_, params) = cfgbin_loader2(3, "battle", Some(&gs), None);
        assert_eq!(
            params.unwrap().path,
            "common/gamedata/map/<MAP>/battle.cfg"
        );
    }

    #[test]
    fn loader2_priorite_neg_one() {
        let gs = make_game_sys(0, 0x1);
        let (_, params) = cfgbin_loader2(1, "b", Some(&gs), None);
        assert_eq!(params.unwrap().priority.to_bits(), FLOAT_NEG_ONE_BITS);
    }

    // --- cfgbin_parser, branche inline ---

    fn make_descriptor_inline() -> CfgDescriptor {
        CfgDescriptor {
            resource_id: 0xDEAD,
            file_name: None, // inline
            type_id: 0x10,
            slot_id: 0x20,
            vec2_lo: 0,
            vec2_hi: 0,
            load_param_c: 0,
            flag_d: 0,
            flag_35: 0,
            inline_x: 100,
            inline_ctrl: 0, // → float_val = -1.0
            inline_float: 2.5,
            inline_extra: 7,
            anim_ptr_lo: 0,
            anim_ptr_hi: 0,
            transform_data: 0,
            ext_data_lo: 0,
            ext_data_hi: 0,
            packed_low: 0,
            aux_id: 0x30,
            rect_param: 0,
            entity_id: 0xBEEF,
            entity_flags_hi: 0x01,
            action_type_packed: 0x0000_0090_0000_0080,
            remote_param_id: 0,
        }
    }

    #[test]
    fn parser_inline_ctrl_zero_float_est_neg_one() {
        let desc = make_descriptor_inline();
        let result = cfgbin_parser(&desc, None);
        if let ParseResult::Inline { inline_params, .. } = result {
            assert_eq!(inline_params.float_val.to_bits(), FLOAT_NEG_ONE_BITS);
        } else {
            panic!("attendu Inline, obtenu {:?}", result);
        }
    }

    #[test]
    fn parser_inline_ctrl_nonzero_utilise_inline_float() {
        let mut desc = make_descriptor_inline();
        desc.inline_ctrl = 1;
        desc.inline_float = 2.5;
        let result = cfgbin_parser(&desc, None);
        if let ParseResult::Inline { inline_params, .. } = result {
            // float_val = param_2[0x16] = inline_float (valeur de test arbitraire)
            assert!((inline_params.float_val - 2.5_f32).abs() < 1e-5);
        } else {
            panic!("attendu Inline");
        }
    }

    #[test]
    fn parser_inline_champs_correctement_extractes() {
        let desc = make_descriptor_inline();
        let result = cfgbin_parser(&desc, None);
        if let ParseResult::Inline { inline_params, .. } = result {
            assert_eq!(inline_params.comp_x, 100);
            assert_eq!(inline_params.ctrl, 0);
            assert_eq!(inline_params.extra, 7);
            assert_eq!(inline_params.type_id, 0x10);
            assert_eq!(inline_params.slot_id, 0x20);
            assert_eq!(inline_params.aux_id, 0x30);
            assert_eq!(inline_params.resource_id, 0xDEAD);
            assert_eq!(inline_params.flag_one, 1);
            assert_eq!(inline_params.reserved, [0u8; 3]);
        } else {
            panic!("attendu Inline");
        }
    }

    #[test]
    fn parser_inline_entity_packed_concat() {
        let desc = make_descriptor_inline();
        // entity_packed = (entity_flags_hi << 32) | entity_id
        // = (0x01 << 32) | 0xBEEF = 0x00_0000_01_0000_BEEF
        let expected: u64 = ((0x01u64) << 32) | 0xBEEF;
        let result = cfgbin_parser(&desc, None);
        if let ParseResult::Inline { inline_params, .. } = result {
            assert_eq!(inline_params.entity_packed, expected);
        } else {
            panic!("attendu Inline");
        }
    }

    // --- cfgbin_parser, branche fichier ---

    fn make_descriptor_file(name: &str) -> CfgDescriptor {
        CfgDescriptor {
            resource_id: 0xABCD,
            file_name: Some(String::from(name)),
            type_id: 0x10,
            slot_id: 0x5,
            vec2_lo: 0,
            vec2_hi: 0,
            load_param_c: 0xC0DE,
            flag_d: 0x01,
            flag_35: 0x00,
            inline_x: 0,
            inline_ctrl: 0,
            inline_float: 0.0,
            inline_extra: 0,
            anim_ptr_lo: 0,
            anim_ptr_hi: 0,
            transform_data: 0,
            ext_data_lo: 0,
            ext_data_hi: 0,
            packed_low: 0,
            aux_id: 0,
            rect_param: 0,
            entity_id: 0,
            entity_flags_hi: 0,
            action_type_packed: 0,
            remote_param_id: 0,
        }
    }

    #[test]
    fn parser_fichier_sans_game_sys_retourne_skip() {
        let desc = make_descriptor_file("npc_conf");
        let result = cfgbin_parser(&desc, None);
        assert!(matches!(result, ParseResult::Skip));
    }

    #[test]
    fn parser_fichier_construit_chemin() {
        let gs = make_game_sys(0, 0xF);
        let desc = make_descriptor_file("npc_conf");
        let result = cfgbin_parser(&desc, Some(&gs));
        if let ParseResult::File { load_params, .. } = result {
            assert_eq!(
                load_params.path,
                "common/gamedata/map/<MAP>/npc_conf.cfg"
            );
        } else {
            panic!("attendu File, obtenu {:?}", result);
        }
    }

    #[test]
    fn parser_fichier_load_mode_est_un() {
        let gs = make_game_sys(0, 0x1);
        let desc = make_descriptor_file("x");
        let result = cfgbin_parser(&desc, Some(&gs));
        if let ParseResult::File { load_params, .. } = result {
            assert_eq!(load_params.load_mode, 1);
        } else {
            panic!("attendu File");
        }
    }

    #[test]
    fn parser_fichier_extra_param_est_load_param_c() {
        // C: local_578 = param_2[0xc] → load_param_c dans LoadParams.extra_param
        let gs = make_game_sys(1, 0x1);
        let desc = make_descriptor_file("cfg_x");
        // load_param_c = 0xC0DE dans make_descriptor_file
        let result = cfgbin_parser(&desc, Some(&gs));
        if let ParseResult::File { load_params, .. } = result {
            assert_eq!(load_params.extra_param, 0xC0DE);
        } else {
            panic!("attendu File");
        }
    }

    // --- Constantes ---

    #[test]
    fn constante_float_neg_one() {
        assert_eq!(f32::from_bits(FLOAT_NEG_ONE_BITS), -1.0f32);
    }

    #[test]
    fn constante_map_max() {
        // Le moteur compare uVar1 < 0x400 — borne exclusive.
        assert_eq!(MAP_MAX_INDEX, 1024);
    }

    #[test]
    fn constante_entry_stride() {
        assert_eq!(MAP_ENTRY_STRIDE, 176); // 0xb0
    }

    #[test]
    fn constante_map_table_offset() {
        assert_eq!(MAP_TABLE_OFFSET, 0x34c450);
    }

    #[test]
    fn constante_slots_registre() {
        assert_eq!(REGISTRY_SLOT_PRIMARY, 0x390);
        assert_eq!(REGISTRY_SLOT_SECONDARY, 0x820);
    }

    #[test]
    fn chemin_base_map() {
        assert_eq!(MAP_DATA_BASE_PATH, "common/gamedata/map/<MAP>/");
    }
}
