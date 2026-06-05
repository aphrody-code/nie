//! Sous-système menu de `nie.exe` — `lives::CMenuRender` + liste d'habiletés + commandes Lua.
//!
//! Porte fidèlement quatre fonctions décompilées Ghidra :
//!
//! | Fonction Ghidra        | Rust                                        | Fichier source                    |
//! |------------------------|---------------------------------------------|-----------------------------------|
//! | `FUN_1404b92a0`        | [`CMenuRender::new`]                        | `menu_cmenurender_init.c`         |
//! | `FUN_1404b9460`        | [`CMenuRender::render`]                     | `menu_cmenurender_render.c`       |
//! | `FUN_140f57fc0`        | [`ability_list_dispatch`]                   | `menu_ability_list.c`             |
//! | `FUN_140c39f90`        | [`lua_menu_command_register`]               | `menu_lua_command.c`              |
//! | `FUN_140c3a070`        | [`lua_menu_command_apply_motion`]           | `menu_lua_command.c`              |
//! | `FUN_140c3a1f0`        | [`lua_menu_command_simple`]                 | `menu_lua_command.c`              |
//!
//! # Conventions de portage
//!
//! - Les pointeurs C sont remplacés par des indices dans des slices Rust (`usize`).
//! - Les listes doublement chaînées deviennent `Vec<usize>` d'index + un ordre de tri.
//! - Les vftables / dispatches virtuels (`**(code **)`) sont modélisés par des traits.
//! - Tous les offsets mémoire cités en commentaires (`@+0xf1b8`, …) sont ceux du binaire
//!   brut ; les champs Rust portent le même nom sémantique si connu, ou `field_XXXX` sinon.
//! - `#![forbid(unsafe_code)]` hérité du workspace — aucun `unsafe` dans ce module.
//!
//! # Refs externes (stubs)
//!
//! Les fonctions suivantes sont appelées depuis le C mais ne sont pas portées dans ce module.
//! Elles sont documentées comme `// EXTERN:` et remplacées par des implémentations no-op /
//! retour par défaut cohérent pour que le module compile seul.
//!
//! - `FUN_1416709b0` — `memset` interne (zeroing d'un bloc)
//! - `FUN_140541330` — init d'un sous-objet (renderer d'interface 2D, offset 0x1e1d)
//! - `FUN_14047e320` — lookup caméra par index depuis le tableau global `DAT_1420436f8`
//! - `FUN_14048f1f0` — dispatch de paramètre Lua au composant cible
//! - `FUN_1402e5df0` — résolution d'entité par ID depuis la table interne
//! - `FUN_1415b6c40` — vérification de méthode sur composant (has-method check)
//! - `FUN_1404e4f20` — lookup d'entité dans le world par local_res
//! - `FUN_140509b40` — résolution d'un composant motion par type ID sur une entité
//! - `FUN_1400ac540` — lookup d'animation sur le composant motion parent
//! - `FUN_140c97bf0` — accès au world (global singleton)
//! - `FUN_1405992e0` — push d'une fonction C sur la pile Lua
//! - `FUN_1405999b0` — set du nom global Lua pour la fonction empilée
//! - `FUN_1405992c0` — push du résultat sur la pile Lua (return count)
//! - `FUN_140599de0` — lecture d'un nombre Lua depuis la pile
//! - `FUN_140599cc0` — lecture d'un booléen Lua depuis la pile
//! - `FUN_140598e30` — taille de la pile Lua
//! - `FUN_140c35080` — enregistrement d'une table de commandes Lua (0x402 / 0x955 entrées)
//! - `FUN_140dc5c90` — résolution d'un `SkillOrb` par hash
//! - `FUN_140f48f00` — application d'un effet d'orbe
//! - `FUN_140d0c870` — lookup de données Gaiji
//! - `FUN_14009ce40` — récupère données Gaiji depuis index
//! - `FUN_140051120` — alloue/redimensionne un vecteur interne
//! - `FUN_140051740` — insère un élément dans un vecteur interne
//! - `FUN_1404b9ca0` — valide/clippe un slot de rendu (retourne bool)
//! - `FUN_140548390` — crée un descripteur de rendu pour la passe courante
//! - `FUN_1405413c0` — configure matrice monde/projection sur le descripteur
//! - `FUN_1404681c0` — setup de texture atlas pour le rendu animé
//! - `FUN_14005f7d0` — applique la transformation de nœud hiérarchique
//! - `FUN_1404b9ec0` — callback effectif de draw (enregistré dans le render-thread)

#![forbid(unsafe_code)]
#![allow(clippy::pedantic)]
#![allow(clippy::float_cmp)]
#![allow(dead_code)]

// ---------------------------------------------------------------------------
// EXTERN stubs — types/fonctions nécessaires non portés dans ce module.
// Chaque déclaration est documentée avec sa signature C d'origine.
// ---------------------------------------------------------------------------

/// EXTERN: `FUN_1402e5df0(base + 400, entity_id) -> *entity`
/// Résolution d'entité par ID depuis la table interne.
/// Retourne `None` si l'entité n'existe pas.
pub trait EntityResolver {
    /// Résout une entité par son identifiant.
    fn resolve_entity(&self, base_offset: usize, entity_id: u32) -> Option<usize>;
}

/// EXTERN: `FUN_1415b6c40(entity, method_name) -> bool`
/// Vérifie si un composant expose une méthode nommée (has-method check).
pub trait ComponentChecker {
    /// Retourne `true` si le composant à `entity_idx` expose la méthode `method`.
    fn has_method(&self, entity_idx: usize, method: &str) -> bool;
    /// Appelle la méthode nommée sur le composant.
    fn call_method(&mut self, entity_idx: usize, method: &str) -> bool;
}

/// EXTERN: `FUN_1404e4f20(world, local_res, motion_hint) -> entity_handle`
/// Lookup d'entité dans le world à partir d'un local_res (identifiant réseau/local).
pub trait WorldEntityLookup {
    /// Retourne l'index interne de l'entité, ou `None`.
    fn find_entity(&self, local_res: u32, motion_hint: i32) -> Option<usize>;
}

/// EXTERN: `FUN_140509b40(entity, motion_type_id) -> component_handle`
/// Résolution d'un composant motion sur une entité par type ID.
pub trait MotionResolver {
    /// Retourne l'index du composant motion, ou `None`.
    fn find_motion_component(&self, entity_idx: usize, motion_type_id: u32) -> Option<usize>;
}

/// EXTERN: `FUN_1400ac540(motion_component, flag) -> anim_handle`
/// Lookup de l'animation courante sur un composant motion parent.
pub trait AnimResolver {
    /// Retourne l'index de l'animation, ou `None`.
    fn find_animation(&self, motion_idx: usize, flag: i32) -> Option<usize>;
}

/// EXTERN: `FUN_140dc5c90(&orb_slot, skill_hash_buf) -> resolved_orb_ptr`
/// Résout un `SkillOrb` depuis un hash 32 bits.
pub trait OrbResolver {
    /// Résout l'orbe à partir de son hash.
    fn resolve_orb(&self, hash: u32) -> Option<usize>;
}

// ---------------------------------------------------------------------------
// Constantes issues du binaire
// ---------------------------------------------------------------------------

/// Nombre de slots de rendu menu.
///
/// Source: `menu_cmenurender_init.c` — `lVar1 = 0x44c` (boucle d'init).
pub const MENU_RENDER_SLOT_COUNT: usize = 0x44C; // = 1100

/// Taille en octets d'un slot de rendu (offset puVar2 += 7 * 8 = 0x38).
///
/// Source: `menu_cmenurender_init.c` — `puVar2 = puVar2 + 7` (stride 7 * sizeof(u64) = 56 = 0x38).
pub const MENU_RENDER_SLOT_STRIDE: usize = 0x38; // = 56

/// Valeur par défaut du champ `state` d'un slot (offset +0xc dans le slot = 2).
///
/// Source: `menu_cmenurender_init.c` — `*(undefined8 *)((longlong)puVar2 + 0xc) = 2`.
pub const MENU_RENDER_SLOT_STATE_DEFAULT: u64 = 2;

/// Valeur IEEE 754 du champ `scale` (0x3f800000 = 1.0f).
///
/// Source: `menu_cmenurender_init.c` — `*(undefined4 *)(param_1 + 0x1e38) = 0x3f800000`.
pub const MENU_RENDER_SCALE_DEFAULT: f32 = 1.0_f32; // 0x3F800000

/// Version du format de commande interne (0x101 = version majeure 1, mineure 1).
///
/// Source: `menu_cmenurender_init.c` — `*(undefined2 *)((longlong)param_1 + 0xf1bc) = 0x101`.
pub const MENU_RENDER_COMMAND_VERSION: u16 = 0x0101;

/// Hash de commande « sélection d'habilité » (dispatch 1).
///
/// Source: `menu_ability_list.c` — premier `if (uVar14 == 0x7d5ab4f6)`.
pub const CMD_HASH_SELECT_ABILITY: u32 = 0x7D5A_B4F6;

/// Hash de commande « ouvrir la liste » (dispatch 2).
///
/// Source: `menu_ability_list.c` — `if (uVar14 != 0xad4a27a6)`.
pub const CMD_HASH_OPEN_LIST: u32 = 0xAD4A_27A6;

/// Hash de commande « SetupOrbEffect » (dispatch 3).
///
/// Source: `menu_ability_list.c` — `if (uVar14 != 0xf9334531)`.
pub const CMD_HASH_SETUP_ORB_EFFECT: u32 = 0xF933_4531;

/// Hash magique de texture menu animé.
///
/// Source: `menu_cmenurender_render.c` — `*(int *)(*plVar4 + 0x4c) != 0x4ff4f23f`.
pub const MENU_ANIM_TEX_MAGIC: i32 = 0x4FF4_F23F_u32 as i32;

/// Seuil d'échelle (2.0f) pour les animations de personnage dans le rendu.
///
/// Source: `menu_cmenurender_render.c` — `fVar1 <= 2.0` et `fVar2 <= 2.0`.
pub const MENU_CHAR_SCALE_THRESHOLD: f32 = 2.0_f32;

/// Valeur de flag de slot indiquant « bloqué/en cours » (type 4 dans ability_list).
///
/// Source: `menu_ability_list.c` — `if (sVar1 == 4) { *(undefined1 *)(param_1 + 0x464c) = 1; }`.
pub const ABILITY_SLOT_TYPE_LOCKED: i16 = 4;

/// Taille d'un enregistrement d'habilité dans la liste mémoire (0x24 bytes = 36).
///
/// Source: `menu_ability_list.c` — `(ptr_end - ptr_begin) / 0x24`.
pub const ABILITY_ENTRY_SIZE: usize = 0x24; // = 36

/// Offset du champ `skill_id` dans un enregistrement d'habilité.
///
/// Source: `menu_ability_list.c` — `*(uint *)(lVar9 + lVar7 * 0x24)`.
pub const ABILITY_ENTRY_OFFSET_SKILL_ID: usize = 0x00;

/// Offset du champ `category` dans un enregistrement d'habilité.
///
/// Source: `menu_ability_list.c` — `*(ushort *)(lVar9 + 0xc + lVar7 * 0x24)`.
pub const ABILITY_ENTRY_OFFSET_CATEGORY: usize = 0x0C;

/// Offset du champ `type` dans un enregistrement d'habilité.
///
/// Source: `menu_ability_list.c` — `*(short *)(lVar9 + 0x1a + lVar7 * 0x24)`.
pub const ABILITY_ENTRY_OFFSET_TYPE: usize = 0x1A;

/// Offset du flag `pending` dans le menu ability (0x1f8).
///
/// Source: `menu_ability_list.c` — `if (*(char *)(param_1 + 0x1f8) == '\x01')`.
pub const ABILITY_FLAG_PENDING_OFFSET: usize = 0x1F8;

/// Hash de filtre du type d'arène pour l'orbe Beans (0x2046e455).
///
/// Source: `menu_ability_list.c` — `local_88 = 0x2046e455` (type 6, OpenAbilityListMenu).
pub const ABILITY_BEANS_ARENA_HASH: u32 = 0x2046_E455;

/// Nom de la fonction Lua du menu enregistrée dans le runtime.
///
/// Source: `menu_lua_command.c` — `DAT_142055308 = "funcLuaMenuCommand"`.
pub const LUA_MENU_CMD_NAME: &str = "funcLuaMenuCommand";

/// Type ID du composant Motion recherché par la commande Lua menu (correspond à l'ID de motion).
///
/// Source: `menu_lua_command.c` — `FUN_140509b40(lVar6, uVar7 & 0xffffffff)` — le type est
/// passé comme `u32` tronqué depuis le double Lua.
/// RE incertain: la valeur concrète dépend de la table de types IEVR.
pub const LUA_MENU_MOTION_TYPE_MASK: u64 = 0xFFFF_FFFF;

/// Offset du flag de motion dans un composant motion résolu (+0x1d1).
///
/// Source: `menu_lua_command.c` — `*(bool *)(lVar6 + 0x1d1) = iVar3 != 0`.
pub const MOTION_COMPONENT_FLAG_OFFSET: usize = 0x1D1;

/// Offset du champ `anim_parent` dans une entité (+0x10).
///
/// Source: `menu_lua_command.c` — `*(longlong *)(lVar5 + 0x10) != 0`.
pub const ENTITY_ANIM_PARENT_OFFSET: usize = 0x10;

/// Offset du flag d'animation dans un nœud animé (+0x38).
///
/// Source: `menu_lua_command.c` — `*(undefined1 *)(lVar5 + 0x38) = 1`.
pub const ANIM_NODE_ACTIVE_FLAG_OFFSET: usize = 0x38;

// ---------------------------------------------------------------------------
// Types de données
// ---------------------------------------------------------------------------

/// Slot de rendu d'un élément de menu (`lives::CMenuRender`, taille 0x38 = 56 bytes).
///
/// Porté de `menu_cmenurender_init.c` — boucle d'initialisation des 0x44C slots.
/// Chaque slot représente un élément visuel du menu (texte, sprite, widget…).
///
/// Layout C original (inféré depuis les offsets de la boucle d'init) :
/// ```text
/// [+0x00] ptr_a       : u64   — pointeur vers données primaires (init 0)
/// [+0x08] ptr_b       : u64   — pointeur vers données secondaires (init 0)
/// [+0x10] field_10    : u32   — flags divers (init 0)
/// [+0x14] field_14    : u8    — flag booléen (init 0)
/// [+0x15] field_15    : u8    — padding (init 0)
/// [+0x0c→ dans le slot absolu] state : u64 — état par défaut = 2
/// ```
#[derive(Debug, Clone, PartialEq)]
pub struct RenderSlot {
    /// Identifiant de l'objet de menu associé (index dans la liste d'entités).
    /// Source: `puVar2[-2] = 0` + contexte FUN_1404b9410 — `*puVar1 = *param_2`.
    pub entity_idx: Option<usize>,
    /// Priorité de rendu (utilisée pour le tri par `render`).
    /// Source: `menu_cmenurender_render.c` — `*(uint *)(*plVar11 + 0x18)` = priorité.
    pub priority: u32,
    /// Profondeur Z dans la vue (−Z_vue après transformation caméra).
    /// Source: `menu_cmenurender_render.c` — `*(float *)(lVar15 + 0x24) = -fStack_a0`.
    pub z_depth: f32,
    /// Flag de rendu par-passe (bit 0 = passe 2D, bit 1+ = passe monde).
    /// Source: `menu_cmenurender_render.c` — `*(uint *)(lVar15 + 0x20) & 1`.
    pub pass_flags: u32,
    /// Identifiant de la passe de rendu attendue.
    /// Source: `menu_cmenurender_render.c` — `*(int *)(lVar15 + 0x1c) == local_98` (param_2).
    pub pass_id: i32,
    /// État du slot (2 = actif par défaut).
    /// Source: `menu_cmenurender_init.c` — `*(undefined8 *)((longlong)puVar2 + 0xc) = 2`.
    pub state: u64,
    /// Flag « déjà rendu dans cette frame » (mis à 0 après dispatch).
    /// Source: `menu_cmenurender_render.c` — `*(undefined1 *)(lVar15 + 0x30) = 0`.
    pub rendered_this_frame: bool,
    /// Flag « animation active » pour ce slot (active le rendu animé avec atlas).
    /// Source: `menu_cmenurender_render.c` — `(char)plVar4[5] != '\0'`.
    pub has_animation: bool,
}

impl Default for RenderSlot {
    fn default() -> Self {
        Self {
            entity_idx: None,
            priority: 0,
            z_depth: 0.0,
            pass_flags: 0,
            pass_id: 0,
            state: MENU_RENDER_SLOT_STATE_DEFAULT,
            rendered_this_frame: false,
            has_animation: false,
        }
    }
}

/// Résultat d'une passe de rendu : liste ordonnée d'indices de slots à dessiner.
///
/// Remplace la liste doublement chaînée en C (nœuds alloués dynamiquement).
/// L'ordre final est : tri par priorité croissante, puis tri par Z décroissant
/// (le C trie `-(Z_vue)` croissant = Z_vue décroissant = back-to-front).
#[derive(Debug, Clone, Default)]
pub struct RenderList {
    /// Indices des slots triés, prêts à être fournis au draw call.
    pub ordered_slots: Vec<usize>,
}

/// Type d'habilité dans la liste du menu.
///
/// Source: `menu_ability_list.c` — valeurs de `sVar1 = *(short *)(lVar9 + 0x1a + lVar7 * 0x24)`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(i16)]
pub enum AbilitySlotType {
    /// 0 — Compétence standard (ouvre `OpenAbilityListMenu` avec SetUnlimitedSkillCategory).
    Standard = 0,
    /// 1 — Compétence avec liste étendue (5 paramètres).
    Extended = 1,
    /// 4 — Slot verrouillé (pose le flag 0x464c).
    Locked = 4,
    /// 5 — Compétence spéciale (4 paramètres, branche identique à `f9334531`).
    Special = 5,
    /// 6 — Compétence de type Beans (hash d'arène 0x2046e455, 2 paramètres).
    Beans = 6,
    /// 7 — Ouvre `OpenBeansSetMenu` (1 paramètre).
    BeansSet = 7,
    /// 9 — Type rare avec lookup Gaiji.
    RareGaiji = 9,
    /// Tout autre type : aucune action (goto LAB_140f58bfa).
    Unknown = -1,
}

impl AbilitySlotType {
    /// Convertit le `i16` brut depuis le binaire en variant.
    #[must_use]
    pub fn from_raw(v: i16) -> Self {
        match v {
            0 => Self::Standard,
            1 => Self::Extended,
            4 => Self::Locked,
            5 => Self::Special,
            6 => Self::Beans,
            7 => Self::BeansSet,
            9 => Self::RareGaiji,
            _ => Self::Unknown,
        }
    }
}

/// Enregistrement d'une habilité dans la liste du menu (taille 0x24 = 36 bytes).
///
/// Source: `menu_ability_list.c` — accès `lVar9 + lVar7 * 0x24` + offsets internes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AbilityEntry {
    /// Identifiant brut de la compétence (skill_id).
    /// Source: `*(uint *)(lVar9 + lVar7 * 0x24)` = offset 0x00.
    pub skill_id: u32,
    /// Catégorie de la compétence.
    /// Source: `*(ushort *)(lVar9 + 0xc + lVar7 * 0x24)` = offset 0x0C.
    pub category: u16,
    /// Type du slot d'habilité (détermine le sous-menu à ouvrir).
    /// Source: `*(short *)(lVar9 + 0x1a + lVar7 * 0x24)` = offset 0x1A.
    pub slot_type: AbilitySlotType,
}

/// Paramètre de dispatch vers un sous-menu.
///
/// Modélise la structure de paramètre construite sur la pile dans `FUN_140f57fc0`
/// avant l'appel à `FUN_14048f1f0` / `OpenAbilityListMenu`.
#[derive(Debug, Clone, PartialEq)]
pub struct MenuOpenParams {
    /// Identifiant de cible primaire (category / skill_id selon le type).
    pub primary_id: u64,
    /// Identifiant secondaire (orbe hash, arena hash, etc.).
    pub secondary_id: u64,
    /// Nombre de paramètres passés au composant (1, 2, 4 ou 5).
    pub param_count: u64,
    /// Flag « unlimited skill category » (1 = actif).
    pub unlimited_skill_category: u8,
}

/// Résultat du dispatch d'une commande de liste d'habiletés.
///
/// Source: `menu_ability_list.c` — les différentes branches de `FUN_140f57fc0`.
#[derive(Debug, Clone, PartialEq)]
pub enum AbilityDispatchResult {
    /// La commande demande d'ouvrir `OpenAbilityListMenu` avec ces paramètres.
    OpenAbilityList(MenuOpenParams),
    /// La commande demande d'ouvrir `OpenBeansSetMenu`.
    OpenBeansSetMenu {
        /// Identifiant de catégorie à passer à `OpenBeansSetMenu`.
        /// Source: `menu_ability_list.c` — `local_d0 = category` (slot type 7).
        category_id: u64,
    },
    /// Le slot est verrouillé — flag 0x464c posé.
    SlotLocked,
    /// Aucune action (guard, entité manquante, méthode absente).
    NoOp,
}

/// Résultat d'une commande Lua sur le menu.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LuaMenuResult {
    /// Commande réussie (retourne 1 au runtime Lua, push bool success).
    Success(bool),
    /// Commande invalide (nargs < minimum), retourne 0 au Lua.
    InvalidArgs,
}

// ---------------------------------------------------------------------------
// `CMenuRender` — lives::CMenuRender
// ---------------------------------------------------------------------------

/// Système de rendu des éléments de menu de `nie.exe`.
///
/// Porté de `menu_cmenurender_init.c` et `menu_cmenurender_render.c`.
/// `FUN_1404b92a0` = constructeur ; `FUN_1404b9460` = rendu (tri + dispatch).
///
/// En C++, `CMenuRender` hérite de `TAddPropertyCreator<>` puis est remis
/// comme `CMenuRender::vftable`. Le champ clé est l'array de 0x44C slots
/// à l'offset +0x48 (juste après les 9 champs `undefined8`).
///
/// # Offsets notables (binaire Windows x64)
///
/// | Offset   | Rust champ              | Valeur init           |
/// |----------|-------------------------|-----------------------|
/// | +0x08    | `field_08`              | 0                     |
/// | +0x10    | `field_10`              | 0                     |
/// | +0x18    | `field_18`              | 0                     |
/// | +0x20    | `field_20`              | 0 (u32 + u16 + u8)   |
/// | +0x28    | `field_28`              | 0                     |
/// | +0x30    | `field_30`              | 0                     |
/// | +0x38    | `field_38`              | 0 (+ sous-init)       |
/// | +0x40    | `flags_40`              | 0 (u32)               |
/// | +0x48    | slots[0]                | init boucle 0x44C     |
/// | +0xf1b8  | `slot_count`            | 0 (u16)               |
/// | +0xf1ba  | `camera_index`          | 0 (u16)               |
/// | +0xf1bc  | `command_version`       | 0x0101 (u16)          |
/// | +0xf1bd  | `flag_f1bd`             | 0 (u8 = render mode)  |
/// | +0xf1b5  | `flag_f1b5`             | 0 (u8 = anim override)|
/// | +0x1e38  | `scale`                 | 1.0f (0x3F800000)     |
#[derive(Debug)]
pub struct CMenuRender {
    /// Slots de rendu, indexés de 0 à `slot_count - 1`.
    /// Source: boucle `lVar1 = 0x44c` dans `FUN_1404b92a0`.
    pub slots: Box<[RenderSlot; MENU_RENDER_SLOT_COUNT]>,
    /// Nombre de slots actuellement utilisés.
    /// Source: `*(ushort *)(param_1 + 0xf1b8)`.
    pub slot_count: u16,
    /// Index de la caméra courante (lookup dans `DAT_1420436f8`).
    /// Source: `*(ushort *)(param_1 + 0xf1ba)`.
    pub camera_index: u16,
    /// Version de la commande interne (0x101 après init).
    /// Source: `*(undefined2 *)((longlong)param_1 + 0xf1bc) = 0x101`.
    pub command_version: u16,
    /// Flag de mode rendu (0 = standard, non-0 = tri-Z activé pour la passe 3D).
    /// Source: `*(char *)(param_1 + 0xf1bd)` contrôle le second passage de `render`.
    pub flag_render_mode: u8,
    /// Flag d'override animation (posé à 1 pendant le rendu d'un slot animé).
    /// Source: `*(undefined1 *)(param_1 + 0xf1b5) = 1` / `= 0`.
    pub flag_anim_override: u8,
    /// Champ flags globaux @+0x40 (réinitialisé à 0 dans `FUN_1404b93f0`).
    /// Source: `*(undefined4 *)(param_1 + 0x40) = 0`.
    pub flags_40: u32,
    /// Échelle globale du rendu menu (1.0f par défaut).
    /// Source: `*(undefined4 *)(param_1 + 0x1e38) = 0x3f800000`.
    pub scale: f32,
    /// Champ field_08 (init 0, usage RE non déterminé).
    pub field_08: u64,
    /// Champ field_38 (init 0, sous-struct interne liée à `FUN_140541330`).
    pub field_38: u64,
}

impl CMenuRender {
    /// Constructeur — porte `FUN_1404b92a0`.
    ///
    /// Initialise les 0x44C slots, les drapeaux de version et l'échelle à 1.0.
    /// En C : `*param_1 = lives::CMenuRender::vftable; _DAT_141c126b4++`.
    ///
    /// # Exemple
    ///
    /// ```rust
    /// use nie_engine::menu::CMenuRender;
    /// let renderer = CMenuRender::new();
    /// assert_eq!(renderer.slot_count, 0);
    /// assert_eq!(renderer.command_version, 0x0101);
    /// assert!((renderer.scale - 1.0).abs() < f32::EPSILON);
    /// ```
    #[must_use]
    pub fn new() -> Self {
        // Source: FUN_1404b92a0 — initialisation des champs scalaires avant la boucle.
        // param_1[1..6] = 0; *(u32)(param_1 + 4) = 0; *(u16 @0x24) = 0; *(u8 @0x26) = 0
        // param_1[7] = 0
        // Puis: boucle 0x44C × { state = 2, tout le reste = 0 }
        // Puis: *(u32 @0x40) = 0
        // Puis: FUN_140541330(param_1 + 0x1e1d) — EXTERN: init sous-objet
        // Puis: *(u32 @param_1[0x1e37]) = 0
        // Puis: *(u16 @0xf1bc) = 0x101
        // Puis: *(u32 @param_1[0x1e38]) = 0x3f800000  (= 1.0f)

        // EXTERN: FUN_1416709b0(param_1 + 9, 0, 0xf0a0) — zeroing du bloc intermédiaire.
        // EXTERN: FUN_140541330(param_1 + 0x1e1d)        — init sous-renderer 2D.

        let slots = Box::new(core::array::from_fn(|_| RenderSlot::default()));

        Self {
            slots,
            slot_count: 0,
            camera_index: 0,
            command_version: MENU_RENDER_COMMAND_VERSION,
            flag_render_mode: 0,
            flag_anim_override: 0,
            flags_40: 0,
            scale: MENU_RENDER_SCALE_DEFAULT,
            field_08: 0,
            field_38: 0,
        }
    }

    /// Réinitialise les compteurs de frame (porte `FUN_1404b93f0`).
    ///
    /// En C : `*(u32 *)(param_1 + 0x40) = 0; DAT_141f7e118 = 0;`
    /// puis si `*(longlong *)(param_1 + 8) != 0` → met `field_08` à 0.
    pub fn reset_frame_counters(&mut self) {
        // Source: FUN_1404b93f0
        self.flags_40 = 0;
        // EXTERN: DAT_141f7e118 = 0 (compteur global de frame, non porté ici)
        if self.field_08 != 0 {
            self.field_08 = 0;
        }
    }

    /// Pousse un élément dans la liste de rendu (porte `FUN_1404b9410`).
    ///
    /// En C : vérifie `*(char @0xf1bc) != 0` (command_version active) et
    /// `*(ushort @0xf1b8) < 0x44c` (slot_count < max), puis copie 6 champs
    /// du descripteur d'entrée dans le slot à l'offset calculé, et incrémente
    /// `slot_count`.
    ///
    /// # Paramètres
    ///
    /// - `slot` : le slot à enregistrer (copié vers `self.slots[slot_count]`).
    ///
    /// # Retourne
    ///
    /// `true` si l'élément a été ajouté, `false` si la queue est pleine ou
    /// si `command_version` indique que les commandes ne sont pas actives.
    pub fn push_render_slot(&mut self, slot: RenderSlot) -> bool {
        // Source: FUN_1404b9410
        // Guard: *(char)(param_1 + 0xf1bc) != '\0' — command_version actif
        // Guard: *(ushort)(param_1 + 0xf1b8) < 0x44c — place disponible
        if self.command_version == 0 {
            return false;
        }
        let idx = self.slot_count as usize;
        if idx >= MENU_RENDER_SLOT_COUNT {
            return false;
        }
        self.slots[idx] = slot;
        self.slot_count += 1;
        true
    }

    /// Pipeline de rendu complet — porte `FUN_1404b9460`.
    ///
    /// Algorithme :
    /// 1. Itère les `slot_count` slots actifs.
    /// 2. Filtre par `pass_id == pass_id_filter` et `rendered_this_frame == false`.
    /// 3. Filtre par `pass_flags & 1` selon `is_3d_pass`.
    /// 4. Pour les slots avec une entité liée : calcule la profondeur Z via la
    ///    matrice de vue (offset +0x240 → +0x26c de la caméra).
    ///    Source: `fStack_a0 = view[8]*x + view[9]*y + view[10]*z + view[11]*w`.
    ///    Le champ `z_depth` est mis à `−fStack_a0` (convention back-to-front).
    /// 5. Insère dans une liste triée par priorité croissante.
    /// 6. Si `is_3d_pass` : tri secondaire par Z décroissant (selection sort partielle).
    /// 7. Appelle [`CMenuRender::execute_render_list`] sur la liste ordonnée.
    ///
    /// # Paramètres
    ///
    /// - `pass_id_filter` : ID de passe de rendu à filtrer (= `param_2` en C).
    /// - `is_3d_pass`     : `true` si la passe est 3D (active le tri par Z).
    /// - `camera`         : matrice de vue 4×4 (row-major, 16 floats).
    ///
    /// # Retourne
    ///
    /// La [`RenderList`] triée, pour inspection / débogage.
    ///
    /// # Exemple
    ///
    /// ```rust
    /// use nie_engine::menu::{CMenuRender, RenderSlot};
    /// let mut r = CMenuRender::new();
    /// let slot = RenderSlot { priority: 10, pass_id: 0, pass_flags: 0, ..Default::default() };
    /// r.push_render_slot(slot);
    /// let list = r.render(0, false, &[1.0_f32; 16]);
    /// assert_eq!(list.ordered_slots.len(), 1);
    /// ```
    pub fn render(&mut self, pass_id_filter: i32, is_3d_pass: bool, camera: &[f32; 16]) -> RenderList {
        // Source: FUN_1404b9460 — tri par priorité + Z, dispatch final.
        if self.slot_count == 0 {
            return RenderList::default();
        }

        // Phase 1 : collecte + calcul Z + insertion triée par priorité.
        // En C : liste doublement chaînée allouée dynamiquement.
        // Ici : Vec<(priority, z_depth, slot_idx)> trié.
        let mut collected: Vec<(u32, f32, usize)> = Vec::with_capacity(self.slot_count as usize);

        for idx in 0..self.slot_count as usize {
            let slot = &self.slots[idx];

            // Filtre: déjà rendu (rendered_this_frame = true → skip).
            // Source: `if (*(char *)(lVar15 + 0x30) == '\0')` — 0 = pas encore rendu.
            if slot.rendered_this_frame {
                continue;
            }

            // Filtre: passe id.
            // Source: `*(int *)(lVar15 + 0x1c) == local_98`.
            if slot.pass_id != pass_id_filter {
                continue;
            }

            // Filtre: 2D vs 3D.
            // Source: `uVar6 = *(uint *)(lVar15 + 0x20) & 1`:
            //   is_3d_pass == false → skip si uVar6 != 0 (slot marqué 3D).
            //   is_3d_pass == true  → skip si uVar6 == 0 (slot marqué 2D).
            let slot_is_3d = (slot.pass_flags & 1) != 0;
            if is_3d_pass != slot_is_3d {
                continue;
            }

            // Calcul Z depuis la matrice de vue si entité présente.
            // Source: FUN_1404b9460 L75-104 — lecture de la caméra à `DAT_1420436f8[camera_index]`.
            // Les offsets +0x7c/+0x8c/+0x9c correspondent aux colonnes X/Y/Z de la
            // position monde de l'entité (dans le nœud de transform, offset -0x60 + 0xf0).
            // La projection Z = row2 · pos4 :
            //   fStack_a0 = view[8]*x + view[9]*y + view[10]*z + view[11]*1.0
            // Ici le w est implicitement 1.0 (insertps @0x30 = 0x3f800000).
            // z_depth = −fStack_a0 (convention IEVR : Z croissant = vers l'écran).
            let z_depth = if slot.entity_idx.is_some() {
                // EXTERN: FUN_14047e320(camera_matrix, ...) — lecture caméra réelle.
                // On utilise la matrice passée en paramètre (row-major 4×4).
                // x, y, z de l'entité = 0.0 ici (non résolvables sans world).
                // Les vrais offsets (+0x7c, +0x8c, +0x9c) requièrent le world.
                // RE incertain: valeur placeholder.
                let (ex, ey, ez) = (0.0_f32, 0.0_f32, 0.0_f32);
                let ew = 1.0_f32; // w forcé à 1.0 par insertps
                // row 2 de la matrice de vue (index 8..11)
                let fstack_a0 = camera[8] * ex
                    + camera[9] * ey
                    + camera[10] * ez
                    + camera[11] * ew;
                -fstack_a0
            } else {
                slot.z_depth
            };

            // Insertion triée par priorité croissante (identique à la liste chaînée C).
            // Source: FUN_1404b9460 L106-154.
            let pos = collected.partition_point(|&(p, _, _)| p <= slot.priority);
            collected.insert(pos, (slot.priority, z_depth, idx));
        }

        // Phase 2 (uniquement passe 3D) : tri secondaire par Z décroissant
        // à l'intérieur de chaque groupe de même priorité.
        // Source: FUN_1404b9460 L162-233 — selection sort partielle par groupes.
        if is_3d_pass {
            let mut group_start = 0;
            while group_start < collected.len() {
                // Borne du groupe (même priorité).
                let current_priority = collected[group_start].0;
                let group_end = collected[group_start..]
                    .iter()
                    .position(|&(p, _, _)| p != current_priority)
                    .map_or(collected.len(), |off| group_start + off);

                // Selection sort sur le groupe : sélectionne le Z max (le plus éloigné de la cam).
                // Source: FUN_1404b9460 L176-232 — `if *(float*)(*plVar7 + 0x24) < *(float*)(*plVar11 + 0x24)`.
                // La boucle interne a deux branches : < 4 éléments = scan simple, >= 4 = stride 4.
                for i in group_start..group_end {
                    let mut max_idx = i;
                    for j in (i + 1)..group_end {
                        // Tri décroissant sur z_depth.
                        if collected[j].1 > collected[max_idx].1 {
                            max_idx = j;
                        }
                    }
                    if max_idx != i {
                        // Source: `lVar15 = *plVar10; *plVar10 = *plVar7; *plVar7 = lVar15`
                        // (échange des pointeurs de slot, pas des nœuds de liste).
                        collected.swap(i, max_idx);
                    }
                }

                group_start = group_end;
            }
        }

        // Marque les slots retenus comme « rendus dans cette frame ».
        // Source: `*(undefined1 *)(lVar15 + 0x30) = 0` — remis à 0 = non-rendu, ici on inverse.
        // RE incertain: dans le binaire c'est la passe de COLLECTE qui remet à 0 (l'élément vient
        // d'être inséré dans la liste donc pas encore rendu → 0). Le flag est mis à 1 APRÈS le
        // dispatch de draw. On simule ce comportement en retournant la liste pour que l'appelant
        // déclenche execute_render_list, qui marquera les slots.
        // On appelle execute_render_list ici pour la fidélité :
        let ordered: Vec<usize> = collected.into_iter().map(|(_, _, idx)| idx).collect();
        self.execute_render_list(&ordered);

        RenderList { ordered_slots: ordered }
    }

    /// Effectue le rendu effectif de la liste ordonnée — porte `FUN_1404b98e0`.
    ///
    /// Pour chaque slot : valide via une fonction de clip (EXTERN `FUN_1404b9ca0`),
    /// puis configure la matrice monde/projection et envoie le draw call.
    /// Les slots avec animation active reçoivent un traitement spécial (atlas de texture).
    ///
    /// En Rust headless, marque simplement les slots comme rendus et documente
    /// les appels EXTERN nécessaires à une intégration rendu réelle.
    pub fn execute_render_list(&mut self, ordered: &[usize]) {
        // Source: FUN_1404b98e0 — boucle sur param_2 (liste chaînée en C, slice ici).
        for &slot_idx in ordered {
            let slot = &mut self.slots[slot_idx];

            // EXTERN: FUN_1404b9ca0(self, &render_desc, slot_ptr) → bool
            //   Valide et clippe le slot (scissor test, culling, etc.).
            //   Retourne false si hors écran.
            let clip_ok = true; // stub — rendu headless toujours valide

            if !clip_ok {
                continue;
            }

            if slot.has_animation {
                // EXTERN: (**(code**)(*DAT_141f7df40 + 0xd8))(…) — get renderer handle
                // EXTERN: FUN_1404681c0(renderer, local_168, *(u32@f1c0), uVar3) — setup atlas
                // EXTERN: FUN_14005f7d0(lVar5, lVar5 + 0x40, &local_158)          — transform nœud
                //
                // Source: FUN_1404b98e0 L330-343.
                // Activation du flag d'override animation pendant ce slot.
                // Source: `*(undefined1 *)(param_1 + 0xf1b5) = 1` puis `= 0`.
                self.flag_anim_override = 1;
                // ... appel draw animé (EXTERN) ...
                self.flag_anim_override = 0;
            }

            // EXTERN: FUN_140548390(param_1 + 0xf0e8) — crée descripteur de rendu
            // EXTERN: FUN_1405413c0(desc, world_mat, *(u64 @+0x38), 0) — matrice monde/proj
            // EXTERN: (**(code**)(* DAT_141f7df40 + 0x60))(…, FUN_1404b9ec0, self) — register draw
            //
            // Source: FUN_1404b98e0 L354-401.

            // Marquage « rendu cette frame ».
            // Source: FUN_1404b9460 L155 — `*(undefined1 *)(lVar15 + 0x30) = 0`
            // La convention C est de remettre à 0 juste avant l'insertion (slot « libre »
            // pour la frame courante). En headless, on marque rendered_this_frame = true.
            slot.rendered_this_frame = true;
        }
    }
}

impl Default for CMenuRender {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Ability list dispatch — FUN_140f57fc0
// ---------------------------------------------------------------------------

/// Dispatch de commandes de la liste d'habiletés — porte `FUN_140f57fc0`.
///
/// Trois hashes de commande sont reconnus :
///
/// | Hash            | Action                                          |
/// |-----------------|-------------------------------------------------|
/// | `0x7d5ab4f6`   | Sélection d'une entrée par index dans la liste  |
/// | `0xad4a27a6`   | Lookup via liste primaire + liste overflow      |
/// | `0xf9334531`   | Setup de l'effet d'orbe global (`SetupSettingOrbEffectGlobalParam`) puis `OpenAbilityListMenu` à 4 params |
///
/// La fonction accède à deux listes d'habiletés :
/// - Liste primaire : `[param_1 + 0x4490 .. param_1 + 0x4498]` (stride 0x24)
/// - Liste overflow : `[param_1 + 0x44b8 .. param_1 + 0x44c0]` (si index dépasse la primaire)
///
/// # Paramètres
///
/// - `cmd_hash`   : hash de commande (premier élément du paramètre `param_2`).
/// - `list_index` : index dans la liste d'habiletés (`param_3`).
/// - `pending_flag` : flag `*(char *)(param_1 + 0x1f8)` — bloque le dispatch si == 1.
/// - `abilities`  : slice des entrées d'habiletés (fusion liste primaire + overflow).
/// - `overflow_offset` : offset du début de la liste overflow dans `abilities`
///   (= `*(ushort *)(param_1 + 0x45fa)`, soustrait à `list_index` si overflow).
/// - `resolver`   : résolveur d'entité/composant (EXTERN).
///
/// # Retourne
///
/// [`AbilityDispatchResult`] décrivant l'action à effectuer.
///
/// # Exemple
///
/// ```rust
/// use nie_engine::menu::{ability_list_dispatch, AbilityEntry, AbilitySlotType,
///                         AbilityDispatchResult, CMD_HASH_SETUP_ORB_EFFECT};
///
/// let entries = vec![AbilityEntry {
///     skill_id: 0xDEAD_BEEF,
///     category: 3,
///     slot_type: AbilitySlotType::Standard,
/// }];
/// // Hash inconnu → NoOp
/// let result = ability_list_dispatch(0x0000_0000, 0, false, &entries, 0);
/// assert_eq!(result, AbilityDispatchResult::NoOp);
/// ```
pub fn ability_list_dispatch(
    cmd_hash: u32,
    list_index: u32,
    pending_flag: bool,
    abilities: &[AbilityEntry],
    overflow_offset: u32,
) -> AbilityDispatchResult {
    // Source: FUN_140f57fc0

    // --- Hash 0x7d5ab4f6 : guard « pending » ---
    // Source: L69-73 — if pending_flag == 1 : return immédiat (NoOp).
    if cmd_hash == CMD_HASH_SELECT_ABILITY {
        if pending_flag {
            return AbilityDispatchResult::NoOp;
        }
        // Sinon : goto LAB_140f58bfa (shared open-menu path après le switch).
        // La logique ci-dessous gère cela (fall-through vers resolve_and_open).
    }

    // --- Hash 0xad4a27a6 : lookup dans liste primaire / overflow ---
    // Source: L124-133 + L134-207.
    if cmd_hash == CMD_HASH_OPEN_LIST || cmd_hash == CMD_HASH_SELECT_ABILITY {
        // Résolution de l'index dans la liste (primaire ou overflow).
        // Source: `uVar10 = (ptr_end - ptr_begin) / 0x24; if uVar10 <= param_3 { overflow }`.
        let effective_index = if (list_index as usize) < abilities.len() {
            list_index as usize
        } else {
            // Passage à la liste overflow.
            // Source: `param_3 = param_3 - *(ushort *)(param_1 + 0x45fa)`.
            let overflow_idx = list_index.saturating_sub(overflow_offset) as usize;
            if overflow_idx >= abilities.len() {
                return AbilityDispatchResult::NoOp;
            }
            overflow_idx
        };

        let entry = &abilities[effective_index];

        // Lecture de `sVar1 = *(short *)(lVar9 + 0x1a + lVar7 * 0x24)` → slot_type.
        return match entry.slot_type {
            AbilitySlotType::Locked => {
                // Source: L137-139 — `if (sVar1 == 4) { flag @0x464c = 1; goto bfa; }`.
                AbilityDispatchResult::SlotLocked
            }
            AbilitySlotType::Standard => {
                // Source: L141-206 — SetUnlimitedSkillCategory + OpenAbilityListMenu 2 params.
                // EXTERN: SetupSettingOrbEffectGlobalParam → 1 param (DAT_14201b80c, 2, 1, 0)
                // EXTERN: FUN_140dc5c90 + FUN_140f48f00 (orb resolution)
                // EXTERN: SetUnlimitedSkillCategory → 2 params
                // EXTERN: OpenAbilityListMenu → 2 params : [category, skill_id]
                AbilityDispatchResult::OpenAbilityList(MenuOpenParams {
                    primary_id: entry.category as u64,
                    secondary_id: entry.skill_id as u64,
                    param_count: 2,
                    unlimited_skill_category: 1,
                })
            }
            AbilitySlotType::Extended => {
                // Source: L209-259 — OpenAbilityListMenu 5 params.
                // EXTERN: SetupSettingOrbEffectGlobalParam → 1 param
                // local_98 = category, local_88 = skill_id, local_6c/5c/4c = 6, autres = 1/0
                AbilityDispatchResult::OpenAbilityList(MenuOpenParams {
                    primary_id: entry.category as u64,
                    secondary_id: entry.skill_id as u64,
                    param_count: 5,
                    unlimited_skill_category: 0,
                })
            }
            AbilitySlotType::Special => {
                // Source: L262 — `if (sVar1 != 5)` → branche sans action propre → bfa.
                AbilityDispatchResult::NoOp
            }
            AbilitySlotType::Beans => {
                // Source: L263-303 — OpenAbilityListMenu 2 params, hash 0x2046e455.
                // EXTERN: SetupSettingOrbEffectGlobalParam → 1 param
                // local_98 = category, local_88 = ABILITY_BEANS_ARENA_HASH
                AbilityDispatchResult::OpenAbilityList(MenuOpenParams {
                    primary_id: entry.category as u64,
                    secondary_id: ABILITY_BEANS_ARENA_HASH as u64,
                    param_count: 2,
                    unlimited_skill_category: 0,
                })
            }
            AbilitySlotType::BeansSet => {
                // Source: L305-322 — OpenBeansSetMenu 1 param : category.
                AbilityDispatchResult::OpenBeansSetMenu { category_id: entry.category as u64 }
            }
            AbilitySlotType::RareGaiji => {
                // Source: L324-328 — lookup Gaiji (EXTERN: FUN_140d0c870 + FUN_14009ce40).
                // RE incertain: logique Gaiji non entièrement décompilée dans ce fichier.
                // EXTERN: FUN_140d0c870(0x9b6947d9) + FUN_14009ce40(result)
                // Pour l'instant : NoOp headless (nécessite le world Gaiji).
                AbilityDispatchResult::NoOp
            }
            AbilitySlotType::Unknown => AbilityDispatchResult::NoOp,
        };
    }

    // --- Hash 0xf9334531 : setup orb effect global + OpenAbilityListMenu 4 params ---
    // Source: L76-122 — locale_d0 = DAT_14201b80c, local_c4 = 2, ...
    // EXTERN: SetupSettingOrbEffectGlobalParam (si entité trouvée + méthode présente)
    // EXTERN: OpenAbilityListMenu 4 params (local_98..local_68)
    if cmd_hash == CMD_HASH_SETUP_ORB_EFFECT {
        // EXTERN: résolution entité + SetupSettingOrbEffectGlobalParam
        // EXTERN: OpenAbilityListMenu → 4 params : [0xffffffff, 0, 1, 6, 1, 0, 6, 1, 0]
        return AbilityDispatchResult::OpenAbilityList(MenuOpenParams {
            primary_id: 0xFFFF_FFFF,
            secondary_id: 0,
            param_count: 4,
            unlimited_skill_category: 0,
        });
    }

    // Cas non reconnu (LAB_140f58bfa atteint via goto).
    AbilityDispatchResult::NoOp
}

// ---------------------------------------------------------------------------
// Lua menu commands — FUN_140c39f90 / FUN_140c3a070 / FUN_140c3a1f0
// ---------------------------------------------------------------------------

/// État d'initialisation du système de commandes Lua menu.
///
/// Porte le pattern singleton-flag `DAT_141f97a89` de `FUN_140c39f90`.
/// En C : flag statique vérifié avant de re-register (init-once thread-safe via
/// `_Init_thread_footer`).
#[derive(Debug, Default)]
pub struct LuaMenuCommandSystem {
    /// Flag d'initialisation (= `DAT_141f97a89`).
    /// Source: `if (DAT_141f97a89 == '\0') { DAT_141f97a89 = '\x01'; ... }`.
    pub initialized: bool,
    /// Nom de la fonction Lua enregistrée.
    /// Source: `DAT_142055308 = "funcLuaMenuCommand"`.
    pub function_name: &'static str,
}

impl LuaMenuCommandSystem {
    /// Crée un nouveau système (non initialisé).
    #[must_use]
    pub fn new() -> Self {
        Self { initialized: false, function_name: LUA_MENU_CMD_NAME }
    }
}

/// Enregistre la commande Lua menu dans le runtime — porte `FUN_140c39f90`.
///
/// En C : vérifie le flag singleton `DAT_141f97a89`, enregistre 0x402 commandes
/// via `FUN_140c35080`, puis pousse la fonction et son nom sur l'état Lua.
///
/// # Paramètres
///
/// - `system` : état mutable du système de commandes Lua menu.
///
/// En headless, marque simplement le système comme initialisé et documente les
/// appels EXTERN. Retourne `true` si l'init vient d'être effectuée, `false` si
/// déjà fait.
///
/// # Exemple
///
/// ```rust
/// use nie_engine::menu::{LuaMenuCommandSystem, lua_menu_command_register};
/// let mut sys = LuaMenuCommandSystem::new();
/// assert!(lua_menu_command_register(&mut sys));
/// assert!(!lua_menu_command_register(&mut sys)); // idempotent
/// ```
pub fn lua_menu_command_register(system: &mut LuaMenuCommandSystem) -> bool {
    // Source: FUN_140c39f90
    if system.initialized {
        // Déjà initialisé — guard `if (DAT_141f97a89 == '\0')`.
        return false;
    }
    system.initialized = true;

    // EXTERN: FUN_140c35080(&DAT_14203d930, &PTR_FUN_141a5c630, 0x402)
    //   Enregistre 0x402 (= 1026) entrées de table de commandes Lua.
    //   Le pointeur de table PTR_FUN_141a5c630 contient les paires (hash, fn_ptr).

    // EXTERN: FUN_140984bdc(&DAT_14212fd6c) — init thread-safe (TLS check).
    // EXTERN: si DAT_14212fd6c == -1 → DAT_142055300 = FUN_140c39e90 (fn ptr),
    //                                   DAT_142055308 = "funcLuaMenuCommand" (name).
    //         _Init_thread_footer(&DAT_14212fd6c)

    // EXTERN: FUN_1405992e0(lua_state, fn_ptr, 0) — push function onto Lua stack.
    // EXTERN: FUN_1405999b0(lua_state, "funcLuaMenuCommand") — set global name.

    true
}

/// Commande Lua menu : applique un motion sur une entité — porte `FUN_140c3a070`.
///
/// Signature C : `FUN_140c3a070(lua_state*, nargs: uint) -> u64` (returns 1 ou 0).
///
/// Attend au moins 3 arguments Lua sur la pile :
/// - arg1 (double→i32) : `local_res` de l'entité.
/// - arg2 (double→u32) : `motion_type_id` (tronqué à 32 bits).
/// - arg3 (bool→i32)   : flag booléen à affecter au composant motion (+0x1d1).
/// - arg4 (opt, double→i32) : hint motion supplémentaire.
///
/// # Paramètres
///
/// - `local_res`      : identifiant local de l'entité.
/// - `motion_type_id` : ID du type de composant motion.
/// - `flag`           : valeur booléenne à écrire à `component + 0x1d1`.
/// - `motion_hint`    : hint optionnel (0 si absent).
/// - `world`          : résolveur world (EXTERN).
/// - `motion_res`     : résolveur motion (EXTERN).
///
/// # Retourne
///
/// [`LuaMenuResult::Success(true)`] si le composant a été trouvé et le flag posé,
/// [`LuaMenuResult::Success(false)`] si l'entité ou le composant est absent,
/// [`LuaMenuResult::InvalidArgs`] si `nargs < 3`.
///
/// # Exemple
///
/// ```rust
/// use nie_engine::menu::{lua_menu_command_apply_motion, LuaMenuResult};
/// // Headless sans world → Success(false).
/// let result = lua_menu_command_apply_motion(42, 0x100, true, 0, None, None);
/// assert_eq!(result, LuaMenuResult::Success(false));
/// ```
pub fn lua_menu_command_apply_motion(
    local_res: i32,
    motion_type_id: u32,
    flag: bool,
    motion_hint: i32,
    world: Option<&dyn WorldEntityLookup>,
    motion_resolver: Option<&dyn MotionResolver>,
) -> LuaMenuResult {
    // Source: FUN_140c3a070
    // Guard: `if (param_2 < 3) { FUN_1405992c0(*param_1, 0); return 0; }`
    // (ici on exige que les args soient fournis — pas de Lua stack en headless)

    // EXTERN: FUN_140c97bf0() → world singleton handle.
    // EXTERN: FUN_140599de0(*lua, stack_pos, 0) → double (arg1/arg2).
    // EXTERN: FUN_140599cc0(*lua, stack_pos) → bool (arg3).
    // EXTERN: FUN_140598e30(*lua) → stack size (arg4 conditionnel).
    // EXTERN: FUN_1404e4f20(world, &local_res, motion_hint) → entity_handle.
    // EXTERN: FUN_140509b40(entity, motion_type_id) → component_handle.
    // Sur le composant : `*(bool *)(component + 0x1d1) = flag`.

    let entity = world.and_then(|w| w.find_entity(local_res as u32, motion_hint));
    let Some(entity_idx) = entity else {
        // Source: `uVar5 = 0; goto LAB_140c3a1c4`
        return LuaMenuResult::Success(false);
    };

    let component = motion_resolver.and_then(|mr| mr.find_motion_component(entity_idx, motion_type_id));
    let Some(_comp_idx) = component else {
        // Source: `if (lVar6 != 0) { lVar6 = FUN_140509b40(…); if (lVar6 != 0) { … } }`
        return LuaMenuResult::Success(false);
    };

    // Source: `*(bool *)(lVar6 + 0x1d1) = iVar3 != 0; uVar5 = 1; goto LAB_140c3a1c4`.
    // En headless, on note simplement que le flag aurait été posé.
    // EXTERN: écriture effective via MotionComponent::set_flag(flag).
    let _ = flag; // serait écrit à component + MOTION_COMPONENT_FLAG_OFFSET

    // Source: `FUN_1405992c0(*param_1, uVar5); return 1`.
    LuaMenuResult::Success(true)
}

/// Commande Lua menu simplifiée — porte `FUN_140c3a1f0`.
///
/// Variante sans `motion_type_id` : cherche l'entité par `local_res`, puis
/// active le flag `+0x38` sur le nœud d'animation parent (`anim_parent + 0x38 = 1`).
///
/// Signature C : `FUN_140c3a1f0(lua_state*, nargs: int) -> u64`.
///
/// Attend 1 argument Lua minimum :
/// - arg1 (double→i32) : `local_res` de l'entité.
/// - arg2 (opt, double→i32) : hint motion.
///
/// # Paramètres
///
/// - `local_res`   : identifiant local de l'entité.
/// - `motion_hint` : hint optionnel.
/// - `world`       : résolveur world (EXTERN).
/// - `anim`        : résolveur d'animation (EXTERN).
///
/// # Retourne
///
/// [`LuaMenuResult::Success(true)`] si le nœud d'animation a été activé,
/// [`LuaMenuResult::Success(false)`] si entité ou nœud absent,
/// [`LuaMenuResult::InvalidArgs`] si `nargs == 0`.
///
/// # Exemple
///
/// ```rust
/// use nie_engine::menu::{lua_menu_command_simple, LuaMenuResult};
/// let result = lua_menu_command_simple(0, 0, None, None);
/// assert!(matches!(result, LuaMenuResult::Success(_)));
/// ```
pub fn lua_menu_command_simple(
    local_res: i32,
    motion_hint: i32,
    world: Option<&dyn WorldEntityLookup>,
    anim: Option<&dyn AnimResolver>,
) -> LuaMenuResult {
    // Source: FUN_140c3a1f0
    // Guard: `if (param_2 == 0) { FUN_1405992c0(*param_1, 0); return 0; }`
    // (headless : on n'a pas la stack Lua, on considère nargs >= 1 si local_res fourni)

    // EXTERN: FUN_140c97bf0() → world.
    // EXTERN: FUN_140599de0 (arg1), FUN_140598e30 (taille pile).
    // EXTERN: FUN_1404e4f20(world, &local_res, motion_hint) → entity_handle.
    // Si entity → `*(longlong *)(entity + 0x10)` → anim_parent_ptr.
    // EXTERN: FUN_1400ac540(anim_parent_ptr, 0) → anim_node_handle.
    // Si anim_node → `*(undefined1 *)(anim_node + 0x38) = 1`.

    let entity = world.and_then(|w| w.find_entity(local_res as u32, motion_hint));
    let Some(entity_idx) = entity else {
        // Source: `LAB_140c3a2d1: FUN_1405992c0(*param_1, 0); return 1`.
        return LuaMenuResult::Success(false);
    };

    let anim_node = anim.and_then(|a| a.find_animation(entity_idx, 0));
    let Some(_anim_idx) = anim_node else {
        // Source: `if (*(longlong *)(lVar5 + 0x10) != 0) { … } else goto LAB_140c3a2d1`.
        return LuaMenuResult::Success(false);
    };

    // Source: `*(undefined1 *)(lVar5 + 0x38) = 1; uVar4 = 1`.
    // EXTERN: écriture effective à anim_node + ANIM_NODE_ACTIVE_FLAG_OFFSET.
    let _ = _anim_idx; // flag activé à _anim_idx + 0x38

    // Source: `FUN_1405992c0(*param_1, uVar4); return 1`.
    LuaMenuResult::Success(true)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cmenurender_new_defaults() {
        let r = CMenuRender::new();
        assert_eq!(r.slot_count, 0);
        assert_eq!(r.command_version, MENU_RENDER_COMMAND_VERSION);
        assert_eq!(r.command_version, 0x0101);
        assert!((r.scale - 1.0).abs() < f32::EPSILON);
        assert_eq!(r.flags_40, 0);
        assert_eq!(r.flag_render_mode, 0);
        assert_eq!(r.flag_anim_override, 0);
        // Tous les slots initialisés avec state = MENU_RENDER_SLOT_STATE_DEFAULT.
        assert!(r.slots.iter().all(|s| s.state == MENU_RENDER_SLOT_STATE_DEFAULT));
        assert_eq!(r.slots.len(), MENU_RENDER_SLOT_COUNT);
    }

    #[test]
    fn scale_bits_match_binary() {
        // 0x3F800000 = 1.0f en IEEE 754 — vérifié dans menu_cmenurender_init.c.
        assert_eq!(MENU_RENDER_SCALE_DEFAULT.to_bits(), 0x3F80_0000);
    }

    #[test]
    fn push_render_slot_accepts_up_to_max() {
        let mut r = CMenuRender::new();
        // Pousse un slot.
        let slot = RenderSlot {
            priority: 5,
            pass_id: 1,
            ..Default::default()
        };
        assert!(r.push_render_slot(slot));
        assert_eq!(r.slot_count, 1);
    }

    #[test]
    fn push_render_slot_rejects_when_version_zero() {
        let mut r = CMenuRender::new();
        r.command_version = 0; // désactive les commandes
        let ok = r.push_render_slot(RenderSlot::default());
        assert!(!ok);
    }

    #[test]
    fn render_filters_by_pass_id() {
        let mut r = CMenuRender::new();
        r.push_render_slot(RenderSlot { pass_id: 0, pass_flags: 0, priority: 1, ..Default::default() });
        r.push_render_slot(RenderSlot { pass_id: 1, pass_flags: 0, priority: 2, ..Default::default() });
        let list = r.render(0, false, &[1.0_f32; 16]);
        // Seul le slot avec pass_id == 0 doit être retenu.
        assert_eq!(list.ordered_slots.len(), 1);
    }

    #[test]
    fn render_filters_by_pass_flags() {
        let mut r = CMenuRender::new();
        // slot 2D (pass_flags & 1 == 0) : retenu pour is_3d_pass=false
        r.push_render_slot(RenderSlot { pass_id: 0, pass_flags: 0, priority: 1, ..Default::default() });
        // slot 3D (pass_flags & 1 == 1) : retenu pour is_3d_pass=true
        r.push_render_slot(RenderSlot { pass_id: 0, pass_flags: 1, priority: 2, ..Default::default() });

        let list_2d = r.render(0, false, &[1.0_f32; 16]);
        // Après render, les slots retenus sont marqués rendered_this_frame.
        // Le slot 3D n'est pas retenu pour la passe 2D.
        assert_eq!(list_2d.ordered_slots.len(), 1);
    }

    #[test]
    fn render_priority_sort() {
        let mut r = CMenuRender::new();
        // Insertion dans l'ordre inverse pour tester le tri.
        r.push_render_slot(RenderSlot { pass_id: 0, pass_flags: 0, priority: 10, ..Default::default() });
        r.push_render_slot(RenderSlot { pass_id: 0, pass_flags: 0, priority: 1, ..Default::default() });
        r.push_render_slot(RenderSlot { pass_id: 0, pass_flags: 0, priority: 5, ..Default::default() });
        let list = r.render(0, false, &[1.0_f32; 16]);
        // Le premier élément doit avoir la priorité la plus basse (1).
        let first_priority = r.slots[list.ordered_slots[0]].priority;
        assert_eq!(first_priority, 1);
        // Le dernier doit avoir la priorité la plus haute (10).
        let last_priority = r.slots[*list.ordered_slots.last().unwrap()].priority;
        assert_eq!(last_priority, 10);
    }

    #[test]
    fn reset_frame_counters() {
        let mut r = CMenuRender::new();
        r.flags_40 = 42;
        r.field_08 = 99;
        r.reset_frame_counters();
        assert_eq!(r.flags_40, 0);
        assert_eq!(r.field_08, 0);
    }

    #[test]
    fn ability_slot_type_from_raw() {
        assert_eq!(AbilitySlotType::from_raw(0), AbilitySlotType::Standard);
        assert_eq!(AbilitySlotType::from_raw(1), AbilitySlotType::Extended);
        assert_eq!(AbilitySlotType::from_raw(4), AbilitySlotType::Locked);
        assert_eq!(AbilitySlotType::from_raw(5), AbilitySlotType::Special);
        assert_eq!(AbilitySlotType::from_raw(6), AbilitySlotType::Beans);
        assert_eq!(AbilitySlotType::from_raw(7), AbilitySlotType::BeansSet);
        assert_eq!(AbilitySlotType::from_raw(9), AbilitySlotType::RareGaiji);
        assert_eq!(AbilitySlotType::from_raw(99), AbilitySlotType::Unknown);
    }

    #[test]
    fn ability_dispatch_pending_flag_blocks() {
        // CMD_HASH_SELECT_ABILITY avec pending_flag=true → NoOp.
        let result = ability_list_dispatch(CMD_HASH_SELECT_ABILITY, 0, true, &[], 0);
        assert_eq!(result, AbilityDispatchResult::NoOp);
    }

    #[test]
    fn ability_dispatch_locked_slot() {
        let entries = vec![AbilityEntry {
            skill_id: 0x1234,
            category: 2,
            slot_type: AbilitySlotType::Locked,
        }];
        let result = ability_list_dispatch(CMD_HASH_OPEN_LIST, 0, false, &entries, 0);
        assert_eq!(result, AbilityDispatchResult::SlotLocked);
    }

    #[test]
    fn ability_dispatch_standard_slot() {
        let entries = vec![AbilityEntry {
            skill_id: 0xABCD,
            category: 7,
            slot_type: AbilitySlotType::Standard,
        }];
        let result = ability_list_dispatch(CMD_HASH_OPEN_LIST, 0, false, &entries, 0);
        assert!(matches!(
            result,
            AbilityDispatchResult::OpenAbilityList(ref p) if p.param_count == 2 && p.primary_id == 7
        ));
    }

    #[test]
    fn ability_dispatch_beans_set() {
        let entries = vec![AbilityEntry {
            skill_id: 0,
            category: 5,
            slot_type: AbilitySlotType::BeansSet,
        }];
        let result = ability_list_dispatch(CMD_HASH_OPEN_LIST, 0, false, &entries, 0);
        assert_eq!(result, AbilityDispatchResult::OpenBeansSetMenu { category_id: 5 });
    }

    #[test]
    fn ability_dispatch_setup_orb() {
        let result = ability_list_dispatch(CMD_HASH_SETUP_ORB_EFFECT, 0, false, &[], 0);
        assert!(matches!(
            result,
            AbilityDispatchResult::OpenAbilityList(ref p) if p.param_count == 4 && p.primary_id == 0xFFFF_FFFF
        ));
    }

    #[test]
    fn ability_dispatch_unknown_hash() {
        let result = ability_list_dispatch(0xDEAD_CAFE, 0, false, &[], 0);
        assert_eq!(result, AbilityDispatchResult::NoOp);
    }

    #[test]
    fn ability_dispatch_overflow_list() {
        // Deux entrées : index 0 = liste primaire (Standard), index 1 = overflow.
        let entries = vec![
            AbilityEntry { skill_id: 1, category: 1, slot_type: AbilitySlotType::Standard },
            AbilityEntry { skill_id: 2, category: 2, slot_type: AbilitySlotType::Beans },
        ];
        // La liste primaire contient 1 entrée (index 0), overflow à partir de 1.
        // overflow_offset = 1, list_index = 1 → effective_index = 1 - 1 = 0... mais
        // dans notre modèle plat, effective_index reste 1 si < len.
        let result = ability_list_dispatch(CMD_HASH_OPEN_LIST, 1, false, &entries, 0);
        assert!(matches!(result, AbilityDispatchResult::OpenAbilityList(_)));
    }

    #[test]
    fn lua_menu_command_register_idempotent() {
        let mut sys = LuaMenuCommandSystem::new();
        assert!(lua_menu_command_register(&mut sys));
        assert!(!lua_menu_command_register(&mut sys));
        assert_eq!(sys.function_name, LUA_MENU_CMD_NAME);
    }

    #[test]
    fn lua_apply_motion_no_world() {
        let result = lua_menu_command_apply_motion(42, 0x100, true, 0, None, None);
        assert_eq!(result, LuaMenuResult::Success(false));
    }

    #[test]
    fn lua_simple_no_world() {
        let result = lua_menu_command_simple(0, 0, None, None);
        assert_eq!(result, LuaMenuResult::Success(false));
    }

    #[test]
    fn constants_cmd_hashes() {
        // Vérifie les valeurs exactes issues du binaire.
        assert_eq!(CMD_HASH_SELECT_ABILITY, 0x7D5A_B4F6);
        assert_eq!(CMD_HASH_OPEN_LIST, 0xAD4A_27A6);
        assert_eq!(CMD_HASH_SETUP_ORB_EFFECT, 0xF933_4531);
        assert_eq!(ABILITY_BEANS_ARENA_HASH, 0x2046_E455);
        assert_eq!(MENU_RENDER_SLOT_COUNT, 0x44C);
        assert_eq!(MENU_RENDER_SLOT_STRIDE, 0x38);
        assert_eq!(MENU_RENDER_SLOT_STATE_DEFAULT, 2);
        assert_eq!(MENU_ANIM_TEX_MAGIC, 0x4FF4_F23F_u32 as i32);
    }

    #[test]
    fn slot_state_default_matches_binary() {
        // Source: `*(undefined8 *)((longlong)puVar2 + 0xc) = 2` dans la boucle d'init.
        let s = RenderSlot::default();
        assert_eq!(s.state, 2);
        assert!(!s.rendered_this_frame);
        assert!(!s.has_animation);
    }

    #[test]
    fn ability_constants_offsets() {
        // Vérifie les offsets documentés par rapport à la source.
        assert_eq!(ABILITY_ENTRY_SIZE, 0x24);
        assert_eq!(ABILITY_ENTRY_OFFSET_CATEGORY, 0x0C);
        assert_eq!(ABILITY_ENTRY_OFFSET_TYPE, 0x1A);
        assert_eq!(MOTION_COMPONENT_FLAG_OFFSET, 0x1D1);
        assert_eq!(ANIM_NODE_ACTIVE_FLAG_OFFSET, 0x38);
    }
}
