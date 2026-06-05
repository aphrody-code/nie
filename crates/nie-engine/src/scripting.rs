//! Sous-système de scripting Lua — `CObjLuaManager` / commandes Lua
//!
//! Portage fidèle du pseudo-C Ghidra de `nie.exe` (Inazuma Eleven: Victory Road).
//!
//! # Sources portées
//!
//! | Adresse       | Fichier source Ghidra            | Rôle                              |
//! |---------------|----------------------------------|-----------------------------------|
//! | `0x140ef27c0` | `lua_manager_init.c`             | `CObjLuaManager::init`            |
//! | `0x140c34ec0` | `lua_command_register.c`         | `funcLuaCommand` registration     |
//! | `0x14059b950` | `lua_openlibs.c`                 | Chargeur bibliothèques Lua (`_LOADED`) |
//!
//! # Architecture
//!
//! Le moteur Level-5 Lives embarque **Lua 5.2** dans `nie.exe`. Le sous-système
//! repose sur trois couches :
//!
//! 1. **`CObjLuaManager`** (0x140ef27c0) — gestionnaire singleton initialisé une
//!    seule fois (guard `_Init_thread_footer` pattern). Configure l'état global Lua,
//!    charge les bibliothèques standard via `_LOADED`, puis enregistre toutes les
//!    commandes moteur.
//!
//! 2. **Table de commandes** (`lua_command_register`, 0x140c34ec0) — enregistre
//!    `funcLuaCommand` (0x955 = 2389 entrées) via `FUN_140c35080`, puis lie le
//!    handler C++ et le nom dans l'environnement Lua global via `FUN_1405992e0`
//!    + `FUN_1405999b0`.
//!
//! 3. **`lua_openlibs`** (0x14059b950) — ouvre une bibliothèque Lua standard en
//!    vérifiant la table globale `_LOADED` pour éviter les double-initialisations,
//!    en reproduisant exactement le protocole `require()` de Lua 5.2.
//!
//! # Conventions de portage
//!
//! - `#![forbid(unsafe_code)]` : les pointeurs C sont remplacés par des indices / slices.
//! - Les pseudo-registres Ghidra (`undefined8`, `CONCAT44`, etc.) sont typés
//!   sémantiquement d'après le contexte.
//! - Les constantes entières IEEE 754 sont converties : `0x3F800000` → `1.0_f32`.
//! - Les `DAT_*` globaux deviennent des champs de [`LuaManager`].
//! - Les `FUN_*` externes non portés sont déclarés `// EXTERN:`.

// EXTERN: FUN_1405992e0  — lua_pushcfunction(L, fn, arg2)
// EXTERN: FUN_1405999b0  — lua_setglobal(L, name)
// EXTERN: FUN_140c35080  — register_command_table(table_ptr, fn_table, count)
// EXTERN: FUN_140598cb0  — lua_getfield(L, idx, key)    (Lua 5.2 API)
// EXTERN: FUN_140599fa0  — lua_type(L, idx)
// EXTERN: FUN_140599b10  — lua_pushvalue(L, idx)
// EXTERN: FUN_1405986a0  — lua_newuserdata(L, idx)      / lua_createtable variant
// EXTERN: FUN_1405989a0  — lua_setfield variant
// EXTERN: FUN_1405995b0  — lua_rawget(L, idx)
// EXTERN: FUN_140599940  — lua_rawset / lua_setfield(L, idx, key)
// EXTERN: FUN_1405992c0  — lua_pushboolean(L, val)
// EXTERN: FUN_140599de0  — lua_tonumber(L, idx, is_int)
// EXTERN: FUN_140598e30  — lua_gettop(L)
// EXTERN: FUN_140599cc0  — lua_toboolean(L, idx)
// EXTERN: FUN_1404e4f20  — entity_find_by_id(manager, id_buf, flag)
// EXTERN: FUN_140509b40  — entity_get_motion(entity, motion_id)
// EXTERN: FUN_1400ac540  — entity_get_component(entity, idx)
// EXTERN: FUN_1405986f0  — lua_createtable(L, narr, nrec, a, b)  — variante Lua 5.2
// EXTERN: FUN_140c97bf0  — get_entity_manager()
// EXTERN: FUN_140984bdc  — _Init_thread_head(guard)
// EXTERN: _Init_thread_footer — fin de section init thread-safe MSVC
// EXTERN: FUN_14046ff10  — engine_subsystem_init()
// EXTERN: FUN_14049d800  — config_load_from_path(result, cfg_desc)
// EXTERN: FUN_140ae7c00  — args_parse(dst)
// EXTERN: FUN_14057ed40  — engine_startup(config)
// EXTERN: FUN_140ef6e40  — lua_subsystem_check()
// EXTERN: FUN_140b0f730  — scene_register_camera(name, id, flag)
// EXTERN: FUN_1415b6870  — CObjLuaManager constructor

use std::collections::HashMap;

// ─────────────────────────────────────────────────────────────────────────────
// Types locaux (reproduits fidèlement depuis les offsets Ghidra)
// ─────────────────────────────────────────────────────────────────────────────

/// Identifiant opaque d'un état Lua.
///
/// Modélise le `lua_State *` (paramètre `param_1` dans tous les wrappers Lua).
/// Dans le moteur C++, c'est un pointeur vers la structure opaque Lua 5.2.
///
/// Portage : on utilise un index entier dans la table des états actifs gérée
/// par [`LuaManager`]. Jamais de pointeur brut — `forbid(unsafe_code)`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct LuaStateId(pub u32);

/// Type d'une valeur Lua sur la pile (équivaut aux constantes `LUA_T*` de Lua 5.2).
///
/// Portage depuis les constantes littérales `5` (table), `0` (nil), etc.
/// observées dans `lua_openlibs` (`FUN_14059b950` L17 : `if (iVar1 != 5)`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(i32)]
pub enum LuaType {
    /// `LUA_TNIL` = 0
    Nil = 0,
    /// `LUA_TBOOLEAN` = 1
    Boolean = 1,
    /// `LUA_TNUMBER` = 3
    Number = 3,
    /// `LUA_TSTRING` = 4
    String = 4,
    /// `LUA_TTABLE` = 5
    Table = 5,
    /// `LUA_TFUNCTION` = 6
    Function = 6,
    /// Type inconnu / hors plage
    Unknown = -1,
}

impl From<i32> for LuaType {
    fn from(v: i32) -> Self {
        match v {
            0 => Self::Nil,
            1 => Self::Boolean,
            3 => Self::Number,
            4 => Self::String,
            5 => Self::Table,
            6 => Self::Function,
            _ => Self::Unknown,
        }
    }
}

/// Valeur scalaire sur la pile Lua (modélise `double`/`bool`/`nil`).
///
/// Lua 5.2 stocke tout comme `lua_Number` (`double`) sauf les booléens et nil.
/// Les entiers sont convertis par `(int)(double)` avec branche négative
/// reproduisant la décompilation Ghidra :
/// ```text
/// if (dVar10 < 0.0) iVar = (int)dVar10;
/// else              iVar = (int)(longlong)dVar10;
/// ```
#[derive(Debug, Clone, PartialEq)]
pub enum LuaValue {
    /// Valeur nulle (`nil` Lua).
    Nil,
    /// Valeur booléenne (`true` / `false`).
    Boolean(bool),
    /// Nombre flottant 64 bits (`lua_Number`).
    Number(f64),
    /// Chaîne (utilisée pour les noms de commandes)
    String(String),
}

impl LuaValue {
    /// Conversion `double` → `i32` reproduisant le pattern Ghidra (L55-60, L63-68, L80-87).
    ///
    /// La décompilation génère deux branches selon le signe :
    /// - négatif : `(int)dVar10` (troncature vers zéro, identique à cast C)
    /// - positif : `(int)(longlong)dVar10` (idem sur x86-64 — différence formelle uniquement)
    #[inline]
    pub fn number_to_i32(v: f64) -> i32 {
        // Les deux branches C++ produisent le même résultat sur x86-64.
        v as i32
    }

    /// Conversion `double` → `u64` reproduisant le cast branche positive (L65-68).
    ///
    /// Ghidra : `uVar7 = (ulonglong)dVar10` sur branche positive.
    #[inline]
    pub fn number_to_u64(v: f64) -> u64 {
        v as u64
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Registre de commandes Lua (porté depuis lua_command_register.c)
// ─────────────────────────────────────────────────────────────────────────────

/// Signature d'un handler de commande Lua.
///
/// Modélise `funcLuaCommand` / `funcLuaMenuCommand` / `funcLuaMenuNetworkCommand`.
/// - `args` : slice des arguments extraits de la pile Lua
/// - Retourne `true` si la commande a poussé une valeur de retour sur la pile.
pub type LuaCommandFn = fn(args: &[LuaValue]) -> LuaCommandResult;

/// Résultat d'une commande Lua.
///
/// Reproduit le pattern `FUN_1405992c0(*param_1, val); return 1;` de
/// `FUN_140c3a070` (menu_lua_command.c L100-101).
#[derive(Debug, Clone)]
pub struct LuaCommandResult {
    /// Valeur poussée sur la pile Lua (`lua_pushboolean` → bool, etc.).
    /// `None` = aucune valeur poussée (commande void).
    pub return_value: Option<LuaValue>,
    /// Nombre de valeurs de retour Lua (0 ou 1 dans nie.exe).
    /// Reproduit le `return 1` / `return 0` des handlers C++.
    pub n_returns: u32,
}

impl LuaCommandResult {
    /// Commande sans retour — `return 0` côté C++.
    pub const fn void() -> Self {
        Self { return_value: None, n_returns: 0 }
    }

    /// Commande avec un retour booléen — `lua_pushboolean(L, val); return 1`.
    pub const fn bool(val: bool) -> Self {
        Self {
            return_value: Some(LuaValue::Boolean(val)),
            n_returns: 1,
        }
    }
}

/// Entrée dans la table de commandes Lua (portée depuis `PTR_FUN_141a52de0`).
///
/// La table C++ originale (`DAT_142038cf0`, 0x955 = 2389 entrées) est un tableau
/// `(funcptr, name)` enregistré en bloc par `FUN_140c35080`.
///
/// # Source
/// `lua_command_register.c` L11 :
/// `FUN_140c35080(&DAT_142038cf0, &PTR_FUN_141a52de0, 0x955);`
#[derive(Debug, Clone)]
pub struct LuaCommandEntry {
    /// Nom de la commande dans l'environnement Lua global.
    pub name: &'static str,
    /// Handler Rust associé.
    pub handler: LuaCommandFn,
    /// Adresse originale dans nie.exe (documentation RE).
    pub original_addr: u64,
}

/// Table complète des commandes `funcLuaCommand`.
///
/// Source : `lua_command_register.c` `FUN_140c34ec0`.
///
/// Taille observée : `0x955` = 2389 entrées. Seules les commandes dont le handler
/// est completement reversé sont listées ici ; les autres sont stubs documentés.
///
/// # EXTERN
/// Les entrées non portées font référence à des fonctions C++ non encore reversées.
/// Elles sont marquées `// EXTERN:` dans le code.
pub static LUA_COMMAND_TABLE: &[(&str, u64)] = &[
    // Commandes portées complètement
    ("funcLuaCommand",            0x140b7a020),  // handler principal
    ("funcLuaMenuCommand",        0x140c39e90),  // menu_lua_command.c FUN_140c39e90
    ("funcLuaMenuNetworkCommand", 0x141088280),  // network_lua_command.c FUN_141088280
    // EXTERN: 0x955 - 3 entrées restantes non portées (handlers C++ non reversés)
];

/// Nombre total d'entrées dans la table C++ originale.
///
/// Source : `lua_command_register.c` L11 : `0x955`.
pub const LUA_COMMAND_TABLE_SIZE: usize = 0x955;

/// Nombre d'entrées de commandes réseau.
///
/// Source : `network_lua_command.c` L21 : `0x27`.
pub const LUA_NETWORK_COMMAND_TABLE_SIZE: usize = 0x27;

/// Nombre d'entrées de commandes menu.
///
/// Source : `menu_lua_command.c` L15 : `0x402`.
pub const LUA_MENU_COMMAND_TABLE_SIZE: usize = 0x402;

// ─────────────────────────────────────────────────────────────────────────────
// Bibliothèque Lua standard — porté depuis lua_openlibs.c
// ─────────────────────────────────────────────────────────────────────────────

/// Bibliothèques standard Lua 5.2 gérées par `lua_openlibs`.
///
/// Corresponds aux appels successifs de `FUN_14059b950` lors de l'initialisation.
/// Chaque variante porte le nom Lua et l'adresse originale de l'ouvreur.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum LuaStdLib {
    /// `package` — `luaopen_package` (Lua 5.2)
    Package,
    /// `table` — `luaopen_table`
    Table,
    /// `string` — `luaopen_string`
    String,
    /// `math` — `luaopen_math`
    Math,
    /// `io` — `luaopen_io` (potentiellement désactivé en prod)
    Io,
    /// `os` — `luaopen_os`
    Os,
    /// `debug` — `luaopen_debug`
    Debug,
    /// `bit32` — Lua 5.2 only (opérations bit)
    Bit32,
    /// Bibliothèque custom Level-5 (nom non reversé)
    Level5Custom,
}

impl LuaStdLib {
    /// Nom Lua de la bibliothèque (utilisé comme clé dans `_LOADED`).
    pub const fn lua_name(self) -> &'static str {
        match self {
            Self::Package      => "package",
            Self::Table        => "table",
            Self::String       => "string",
            Self::Math         => "math",
            Self::Io           => "io",
            Self::Os           => "os",
            Self::Debug        => "debug",
            Self::Bit32        => "bit32",
            Self::Level5Custom => "_L5",
        }
    }
}

/// État de chargement d'une bibliothèque dans la table `_LOADED`.
///
/// Reproduit la sémantique de `FUN_14059b950` (lua_openlibs.c) :
/// - Lit `_LOADED[lib_name]` (type doit être `LUA_TTABLE = 5`).
/// - Si absent ou non-table → crée une nouvelle table et l'insère.
/// - Toujours met `_LOADED[lib_name] = table` et `_G[lib_name] = table` si `global`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoadStatus {
    /// Bibliothèque déjà présente dans `_LOADED` (type = table).
    AlreadyLoaded,
    /// Bibliothèque absente ou non-table → nouvelle table créée.
    Loaded,
}

/// Table `_LOADED` simulée — état interne de [`LuaManager`].
///
/// Modélise `_LOADED` (registre Lua) : map `lib_name → bool` (présente ou non).
/// Simplifié par rapport à l'implémentation C++ complète qui gère des objets Lua
/// arbitraires, car le moteur nie.exe insère uniquement des tables.
#[derive(Debug, Default, Clone)]
pub struct LoadedTable {
    entries: HashMap<String, bool>,
}

impl LoadedTable {
    /// Vérifie si la bibliothèque est déjà chargée (type table = true).
    ///
    /// Reproduit `if (iVar1 != 5) { ... }` de `FUN_14059b950` L17.
    #[inline]
    pub fn is_loaded(&self, name: &str) -> bool {
        self.entries.get(name).copied().unwrap_or(false)
    }

    /// Marque la bibliothèque comme chargée.
    ///
    /// Reproduit `FUN_140599940(param_1, uVar2, "_LOADED")` L22 et
    /// `FUN_140599940(param_1, 0xfffffffe, param_2)` L25 de `FUN_14059b950`.
    #[inline]
    pub fn mark_loaded(&mut self, name: &str) {
        self.entries.insert(name.to_string(), true);
    }
}

/// Résultat de l'ouverture d'une bibliothèque Lua.
///
/// Reproduit la logique complète de `FUN_14059b950` :
/// 1. `FUN_1405992e0(param_1, param_3, 0)` — push de la fonction open
/// 2. `FUN_1405994d0(param_1, param_2)` — push du nom
/// 3. `FUN_1405986f0(param_1, 1, 1, 0, 0)` — crée une table si nécessaire
/// 4. Vérifie `_LOADED[name]` (type == 5 → déjà chargé)
/// 5. Si non : insère une nouvelle table dans `_LOADED`
/// 6. Met toujours `_LOADED[name] = table`
/// 7. Si `param_4 != 0` : copie dans `_G[name]` aussi
#[derive(Debug)]
pub struct OpenLibResult {
    /// Bibliothèque concernée.
    pub lib: LuaStdLib,
    /// Statut de chargement.
    pub status: LoadStatus,
    /// Si `true`, la table a été propagée dans `_G` (environnement global Lua).
    /// Correspond à `param_4 != 0` (L27-30 de `FUN_14059b950`).
    pub registered_global: bool,
}

// ─────────────────────────────────────────────────────────────────────────────
// Entité moteur / motion (pour les commandes menu Lua)
// ─────────────────────────────────────────────────────────────────────────────

/// Résultat d'une recherche d'entité par ID.
///
/// Porté depuis `FUN_140c3a070` / `FUN_140c3a1f0` (menu_lua_command.c).
/// `entity_find_by_id` = `FUN_1404e4f20(manager, id_buf, flag)`.
///
/// # EXTERN
/// La résolution réelle nécessite l'accès au gestionnaire d'entités C++ :
/// `// EXTERN: FUN_1404e4f20`
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EntityId {
    /// ID primaire (argument Lua 1, `iVar9` / `local_res10[0]`).
    pub primary: i32,
    /// ID secondaire / variante (argument Lua 2, `uVar7`, cast u64).
    pub secondary: u64,
    /// Flag supplémentaire (argument Lua 3 ou 4 selon l'arité, `iVar8`).
    pub flag: i32,
}

/// Résultat d'un appel à `funcLuaMenuCommand` (FUN_140c3a070).
///
/// Le handler C++ retourne 1 (n_returns) avec un booléen sur la pile.
/// L'entité est recherchée par `(primary, flag)`, puis le motion `secondary`
/// est cherché sur l'entité. Si trouvé, `bool_field_at_0x1d1` est écrit.
///
/// Offset `0x1d1` = 465 dec, champ booléen non nommé dans le RE.
/// Source : menu_lua_command.c L93-97.
#[derive(Debug)]
pub struct MenuCommandOutcome {
    /// Entité trouvée ?
    pub entity_found: bool,
    /// Motion trouvé sur l'entité ?
    pub motion_found: bool,
    /// Valeur écrite dans le champ `+0x1d1` de la motion (arg Lua 3, bool).
    pub bool_written: Option<bool>,
}

// ─────────────────────────────────────────────────────────────────────────────
// CObjLuaManager — gestionnaire principal (lua_manager_init.c)
// ─────────────────────────────────────────────────────────────────────────────

/// Gestionnaire Lua de nie.exe — `CObjLuaManager`.
///
/// Singleton (guard thread-safe MSVC `_Init_thread_footer`) initialisé dans
/// `FUN_140ef27c0`. Sa durée de vie couvre tout le jeu.
///
/// # Initialisation (0x140ef27c0)
///
/// La décompilation montre la séquence suivante :
///
/// 1. **Guard MSVC** (`DAT_14213645c`) — initialisation unique thread-safe.
/// 2. **Vtable** — `DAT_1420c33f0 = &PTR_vftable_141c000c0` (CObjLuaManager RTTI).
/// 3. **Chemin data** — si `DAT_1420c33f8 == NULL`, `DAT_1420435e8 = "data/"` ;
///    sinon copie du chemin custom dans `DAT_142043600`.
/// 4. **Steam check** (`SteamInternal_ContextInit`) — lit la langue/région Steam
///    pour sélectionner `DAT_142035218` (mode plateforme : 0-4, 6, 7, 0x10, 0x11).
/// 5. **Config moteur** — charge `common/system/add_content_config.cfg.bin` via
///    `FUN_1404863d0`.
/// 6. **Initialisation sous-systèmes** — shader, physique (CPhysXManager, CWaitPhysX),
///    CPseudoRand (×10 instances), CTagObjMesh/Effect/PointLight/PxCol managers.
/// 7. **CObjLuaManager** — enregistrement (`FUN_140469700`, "CObjLuaManager", 2),
///    puis allocation d'un buffer `0x100` octets pour l'état Lua.
/// 8. **Caméra** — `FUN_140b0f730("BaseCamera", 0xffffffff, 1)`.
/// 9. **Scène root** — `FUN_1412a6690(&local_4f8, "SceneRoot", 0, local_298)`.
/// 10. **CMainComponent** + **CMainEndComponent** — attachés à la scène root.
///
/// # Champs documentés (offsets C++)
///
/// | Offset | Type     | Description                                    |
/// |--------|----------|------------------------------------------------|
/// | `+0x00`| vtable*  | `PTR_vftable_141c000c0` (CObjLuaManager RTTI)  |
/// | `+0x08`| char*    | Chemin data base (`"data/"` ou custom)         |
/// | `+0x80`| u8[0x80] | Buffer état Lua (`lVar30` alloué à 0x100 B)    |
/// | `+0x28`| u8       | Flag `DAT_142019d34 = 0x10`                    |
/// | `+0x29`| u8       | `DAT_142019d38 = 0x25`                         |
#[derive(Debug)]
pub struct LuaManager {
    /// Chemin de base pour les ressources data du jeu.
    ///
    /// Source : L173-185 (`DAT_1420435e8 = "data/"` ou chemin custom).
    /// Correspond à `DAT_1420435e8` / `DAT_142043600`.
    pub data_path: String,

    /// Mode plateforme sélectionné depuis la config Steam.
    ///
    /// Valeurs valides : 0, 1, 2, 3, 4, 6, 7, 0x10, 0x11.
    /// Source : L271-283 (`DAT_142035218`).
    /// Valeur par défaut : 1 (L292 `DAT_142035218 = 1` sur fallback).
    pub platform_mode: u32,

    /// Bibliothèques standard Lua chargées (table `_LOADED`).
    ///
    /// Source : `FUN_14059b950` — vérification/insertion dans `_LOADED`.
    pub loaded_libs: LoadedTable,

    /// Table de commandes enregistrées dans l'environnement Lua.
    ///
    /// Clé : nom Lua (`"funcLuaCommand"`, etc.).
    /// Source : `FUN_140c34ec0` / `FUN_140c39f90` / `FUN_141088380`.
    pub command_registry: HashMap<String, LuaCommandEntry>,

    /// Flag d'initialisation thread-safe (reproduit `DAT_14213645c`).
    ///
    /// `true` si l'init a été exécutée au moins une fois.
    pub initialized: bool,

    /// Flag sub-système Lua actif (reproduit `DAT_141f7ea3f` / `DAT_141f97a89`).
    ///
    /// Mis à `true` lors du premier appel à `register_commands`.
    pub commands_registered: bool,

    /// Mode locale configuré (`setlocale(0, "ja_JP")` — L212).
    ///
    /// Dans nie.exe, la locale est toujours `ja_JP` (jeu japonais Level-5).
    pub locale: &'static str,

    /// Thread ID principal (reproduit `DAT_142043548 = GetCurrentThreadId()`).
    ///
    /// Source : L209-210.
    pub main_thread_id: u64,

    /// Taille du pool mémoire Lua (reproduit `DAT_141a5009c = 0x100000`).
    ///
    /// Source : L213.
    pub lua_pool_size: usize,
}

impl Default for LuaManager {
    fn default() -> Self {
        Self::new()
    }
}

impl LuaManager {
    /// Crée un `LuaManager` avec les valeurs par défaut de nie.exe.
    ///
    /// Reproduit l'état initial après `FUN_140ef27c0` (avant les initialisations
    /// conditionnelles). Les valeurs magiques sont documentées avec leur offset
    /// dans le binaire.
    pub fn new() -> Self {
        Self {
            data_path: "data/".to_string(),   // L174 : DAT_1420435e8 = "data/"
            platform_mode: 1,                  // L292 : DAT_142035218 = 1 (fallback)
            loaded_libs: LoadedTable::default(),
            command_registry: HashMap::new(),
            initialized: false,
            commands_registered: false,
            locale: "ja_JP",                   // L212 : setlocale(0, "ja_JP")
            main_thread_id: 0,
            lua_pool_size: 0x100000,           // L213 : DAT_141a5009c = 0x100000
        }
    }

    /// Initialise le gestionnaire Lua (portage de `FUN_140ef27c0`).
    ///
    /// Reproduit la séquence d'initialisation documentée en en-tête de module.
    /// Les étapes nécessitant le contexte C++ natif (Steam, VFS, D3D11) sont
    /// documentées comme `// EXTERN`.
    ///
    /// # Retour
    ///
    /// `Ok(())` si l'initialisation a réussi, `Err` avec description sinon.
    /// Reproduit `return 1` (succès) vs `return 0` / retour anticipé (échec).
    ///
    /// # Invariants
    ///
    /// - Ne peut être appelé qu'une seule fois (guard thread-safe).
    /// - L'ordre des initialisations est important (cf. séquence en en-tête).
    pub fn init(&mut self, data_path: Option<&str>) -> Result<(), LuaInitError> {
        // Guard thread-safe (reproduit _Init_thread_footer / DAT_14213645c).
        // Source : L165-170.
        if self.initialized {
            return Err(LuaInitError::AlreadyInitialized);
        }

        // ── Étape 3 : chemin data ────────────────────────────────────────────
        // Source : L173-185.
        // Si DAT_1420c33f8 == NULL → "data/" ; sinon copie du chemin custom.
        // EXTERN: FUN_14046ff10 (engine_subsystem_init)
        if let Some(path) = data_path {
            // Chemin custom : copie dans le buffer (analogue DAT_142043600).
            self.data_path = path.to_string();
        }
        // data_path déjà = "data/" par défaut (analogue DAT_1420435e8 = "data/").

        // ── Étape 4 : mode plateforme ────────────────────────────────────────
        // Source : L258-292. Steam check + table régions.
        // EXTERN: SteamInternal_ContextInit, FUN_14047a9c0
        // On garde la valeur par défaut 1 (fallback L292).
        self.platform_mode = 1;

        // ── Étape 7 : buffer état Lua ────────────────────────────────────────
        // Source : L2112-2119.
        // Alloue 0x100 octets via *DAT_142043520+0x128.
        // FUN_1416709b0(lVar30, 0, 0x100) — memset zéro.
        // EXTERN: allocateur moteur
        // _DAT_142019d28 = lVar30 + 0x80 (début zone travail Lua)
        // DAT_142019d34 = 0x10
        // DAT_142019d38 = 0x25

        // ── Locale ───────────────────────────────────────────────────────────
        // Source : L212. setlocale(0, "ja_JP").
        // _configthreadlocale(2) (mode per-thread).
        self.locale = "ja_JP";

        // ── Pool Lua ─────────────────────────────────────────────────────────
        // Source : L213. DAT_141a5009c = 0x100000.
        self.lua_pool_size = 0x100000;

        self.initialized = true;
        Ok(())
    }

    /// Enregistre les commandes Lua dans l'environnement global.
    ///
    /// Portage de `FUN_140c34ec0` (`lua_command_register.c`).
    ///
    /// # Logique C++ (L9-23)
    ///
    /// ```c
    /// if (DAT_141f7ea3f == '\0') {
    ///     DAT_141f7ea3f = '\x01';
    ///     FUN_140c35080(&DAT_142038cf0, &PTR_FUN_141a52de0, 0x955);
    /// }
    /// // Init thread-safe du slot (DAT_14212fd18)
    /// DAT_1420524b0 = FUN_140b7a020;          // handler
    /// DAT_1420524b8 = "funcLuaCommand";        // nom global Lua
    /// FUN_1405992e0(param_1, DAT_1420524b0, 0); // lua_pushcfunction
    /// FUN_1405999b0(param_1, DAT_1420524b8);    // lua_setglobal
    /// ```
    ///
    /// # Pattern commun
    ///
    /// Les trois commandes (`funcLuaCommand`, `funcLuaMenuCommand`,
    /// `funcLuaMenuNetworkCommand`) suivent exactement le même pattern.
    /// Seules les tailles de table et les adresses diffèrent.
    pub fn register_commands(&mut self, state_id: LuaStateId) -> RegisterResult {
        // Guard (DAT_141f7ea3f) — first-call only.
        // Source : lua_command_register.c L9-12.
        let already_registered = self.commands_registered;
        if !already_registered {
            self.commands_registered = true;
            // EXTERN: FUN_140c35080(&DAT_142038cf0, &PTR_FUN_141a52de0, 0x955)
            // Enregistre le bloc de 0x955 pointeurs de fonction dans la table interne.
        }

        // Enregistrement funcLuaCommand
        // Source : L14-22 (init thread-safe slot DAT_14212fd18)
        // DAT_1420524b0 = FUN_140b7a020  (handler)
        // DAT_1420524b8 = "funcLuaCommand" (nom global Lua)
        // EXTERN: FUN_1405992e0(param_1, handler, 0) — lua_pushcfunction(L, fn)
        // EXTERN: FUN_1405999b0(param_1, name)        — lua_setglobal(L, name)
        let registered_count = LUA_COMMAND_TABLE.len();

        RegisterResult {
            state_id,
            already_registered,
            registered_count,
            command_table_size: LUA_COMMAND_TABLE_SIZE,
        }
    }

    /// Ouvre une bibliothèque Lua standard (portage de `FUN_14059b950`).
    ///
    /// # Logique C++ (lua_openlibs.c L12-31)
    ///
    /// ```c
    /// FUN_1405992e0(param_1, param_3, 0);   // lua_pushcfunction(L, openlib_fn)
    /// FUN_1405994d0(param_1, param_2);       // lua_pushstring(L, lib_name)
    /// FUN_1405986f0(param_1, 1, 1, 0, 0);   // lua_createtable(L, 1, 1, ...)
    /// FUN_140598cb0(param_1, 0xfff0b9d8, "_LOADED"); // lua_getfield(L, LUA_REGISTRYINDEX, "_LOADED")
    /// iVar1 = FUN_140599fa0(param_1, 0xffffffff);    // lua_type(L, -1)
    /// if (iVar1 != 5) {   // LUA_TTABLE
    ///     // Crée une nouvelle table, l'insert dans _LOADED
    ///     FUN_140599b10(param_1, 0xfffffffe);          // lua_pushvalue(L, -2)
    ///     uVar2 = FUN_1405986a0(param_1, 0xfff0b9d8); // lua_newuserdata?
    ///     FUN_1405989a0(param_1, 0, 0);
    ///     FUN_1405995b0(param_1, 0xffffffff);          // lua_rawget(L, -1)
    ///     FUN_140599940(param_1, uVar2, "_LOADED");    // lua_setfield(_LOADED)
    /// }
    /// FUN_1405995b0(param_1, 0xfffffffe);              // lua_rawget(L, -2)
    /// FUN_140599940(param_1, 0xfffffffe, param_2);     // lua_setfield(L, -2, lib_name)
    /// FUN_140599b10(param_1, 0xfffffffe);              // lua_pushvalue(L, -2)
    /// if (param_4 != 0) {
    ///     FUN_1405995b0(param_1, 0xffffffff);          // copie dans _G
    ///     FUN_1405999b0(param_1, param_2);             // lua_setglobal(L, lib_name)
    /// }
    /// ```
    ///
    /// # Index Lua pseudo-négatifs
    ///
    /// - `0xfff0b9d8` (`i32` = -1000470) = `LUA_REGISTRYINDEX` (Lua 5.2 : `-10000`
    ///   convention; valeur Ghidra différente car registre virtuel 64 bits).
    /// - `0xfffffffe` = `-2` (stack top - 1)
    /// - `0xffffffff` = `-1` (stack top)
    pub fn open_lib(
        &mut self,
        state_id: LuaStateId,
        lib: LuaStdLib,
        register_global: bool,
    ) -> OpenLibResult {
        let lib_name = lib.lua_name();

        // Vérifie _LOADED[lib_name] — type == LUA_TTABLE (5).
        // Source : L17 `if (iVar1 != 5) { ... }`.
        let already = self.loaded_libs.is_loaded(lib_name);
        let status = if already {
            // Bibliothèque déjà chargée — skip insertion.
            // Source : branche `if (iVar1 != 5)` non prise.
            LoadStatus::AlreadyLoaded
        } else {
            // Insère une nouvelle table dans _LOADED.
            // Source : L19-23 (FUN_140599940 avec "_LOADED").
            self.loaded_libs.mark_loaded(lib_name);
            LoadStatus::Loaded
        };

        // Toujours met _LOADED[lib_name] = table (L25-26).
        // EXTERN: FUN_1405995b0 / FUN_140599940 sur param_1 (état Lua)

        // Si register_global (param_4 != 0) → copie dans _G[lib_name] (L27-30).
        // EXTERN: FUN_1405995b0 + FUN_1405999b0

        let _ = state_id; // utilisé par les callsites EXTERN
        OpenLibResult {
            lib,
            status,
            registered_global: register_global,
        }
    }

    /// Exécute la commande `funcLuaMenuCommand` (portage de `FUN_140c3a070`).
    ///
    /// # Arguments Lua (min 3, max 4 — L47-87)
    ///
    /// 1. `id_primary` : `f64` → `i32` — ID entité primaire
    ///    (Ghidra L54-60 : `iVar9 = (int)(longlong)dVar10` ou `(int)dVar10` si négatif)
    /// 2. `id_secondary` : `f64` → `u64` — ID motion/animation
    ///    (L63-68 : `uVar7 = (ulonglong)dVar10`)
    /// 3. `bool_arg` : `bool` — flag écrit dans `entity.motion[+0x1d1]`
    ///    (L72 : `FUN_140599cc0`)
    /// 4. `flag_extra` : `f64` → `i32` — flag optionnel passé à `entity_find_by_id`
    ///    (L78-87 : seulement si `top >= base + arg_count + 1`)
    ///
    /// # Retour
    ///
    /// `n_returns = 1`, valeur bool poussée sur la pile via `lua_pushboolean`.
    ///
    /// # Vérification d'arité
    ///
    /// Si `param_2 < 3` → `lua_pushboolean(L, 0); return 0`.
    /// Source : L47-50.
    pub fn exec_menu_command(
        &self,
        args: &[LuaValue],
    ) -> LuaCommandResult {
        // Vérification arité minimale (param_2 < 3).
        // Source : FUN_140c3a070 L47-50.
        if args.len() < 3 {
            // FUN_1405992c0(*param_1, 0) — lua_pushboolean(L, false)
            return LuaCommandResult::bool(false);
        }

        // ── Arg 1 : id_primary (iVar9) ────────────────────────────────────
        // Source : L52-60.
        // *(int*)(param_1+1) += 1 (avancement du pointeur de pile Lua)
        // dVar10 = FUN_140599de0(*param_1, iVar9 + base + 1, 0)  (lua_tonumber)
        let id_primary = match args.first() {
            Some(LuaValue::Number(n)) => LuaValue::number_to_i32(*n),
            _ => 0,
        };

        // ── Arg 2 : id_secondary (uVar7) ──────────────────────────────────
        // Source : L61-68. Cast en u64 (branche positive).
        let id_secondary = match args.get(1) {
            Some(LuaValue::Number(n)) => LuaValue::number_to_u64(*n),
            _ => 0,
        };

        // ── Arg 3 : bool_arg (iVar3) ──────────────────────────────────────
        // Source : L70-72. FUN_140599cc0 = lua_toboolean.
        let bool_arg = match args.get(2) {
            Some(LuaValue::Boolean(b)) => *b,
            Some(LuaValue::Number(n)) => *n != 0.0,
            _ => false,
        };

        // ── Arg 4 (optionnel) : flag_extra (iVar8) ────────────────────────
        // Source : L73-87. Lu seulement si lua_gettop >= base + arg_count + 1.
        let flag_extra = if args.len() >= 4 {
            match args.get(3) {
                Some(LuaValue::Number(n)) => LuaValue::number_to_i32(*n),
                _ => 0,
            }
        } else {
            // Valeur par défaut : 0 (iVar8 = 0, L75).
            0
        };

        // ── Recherche de l'entité ──────────────────────────────────────────
        // Source : L88-97.
        // local_res10[0] = iVar9 (id_primary)
        // lVar6 = FUN_1404e4f20(uVar5, local_res10, iVar8) — entity_find_by_id
        // EXTERN: FUN_1404e4f20 / FUN_140509b40 / *(bool*)(lVar6+0x1d1) = iVar3!=0

        // Simulation : on ne peut pas appeler le moteur natif depuis Rust pur.
        // Le résultat réel nécessite l'accès au runtime C++.
        let entity_id = EntityId {
            primary: id_primary,
            secondary: id_secondary,
            flag: flag_extra,
        };
        let _ = (entity_id, bool_arg); // EXTERN — suppress lint

        // En l'absence du runtime C++ :
        // - entity_found = false (EXTERN: FUN_1404e4f20)
        // - motion_found = false (EXTERN: FUN_140509b40)
        // La valeur de retour Lua est false par défaut.
        // Un intégration avec le runtime renverrait l'outcome réel.
        LuaCommandResult::bool(false)
    }

    /// Exécute la variante simplifiée de la commande menu Lua (`FUN_140c3a1f0`).
    ///
    /// # Différences avec [`exec_menu_command`]
    ///
    /// - N'a pas d'argument `id_secondary` (motion) : cherche juste l'entité.
    /// - Lit `*(longlong*)(entity+0x10)` → appelle `FUN_1400ac540(ptr, 0)`.
    /// - Écrit `*(undefined1*)(component+0x38) = 1` (flag à +0x38).
    /// - Si `param_2 == 0` → retourne immédiatement `false` (L119-121).
    ///
    /// # Source
    /// `menu_lua_command.c` `FUN_140c3a1f0` L106-164.
    pub fn exec_menu_command_simple(
        &self,
        args: &[LuaValue],
    ) -> LuaCommandResult {
        // Vérification arité (param_2 == 0 → retour immédiat).
        // Source : L119-121.
        if args.is_empty() {
            return LuaCommandResult::bool(false);
        }

        // ── Arg 1 : id_primary (iVar6) ────────────────────────────────────
        // Source : L124-132.
        let id_primary = match args.first() {
            Some(LuaValue::Number(n)) => LuaValue::number_to_i32(*n),
            _ => 0,
        };

        // ── Arg 2 (optionnel) : flag (iVar7) ──────────────────────────────
        // Source : L133-147. Même garde top >= base + 1.
        let flag_extra = if args.len() >= 2 {
            match args.get(1) {
                Some(LuaValue::Number(n)) => LuaValue::number_to_i32(*n),
                _ => 0,
            }
        } else {
            0
        };

        // EXTERN: FUN_1404e4f20(manager, &id_primary, flag_extra)
        // EXTERN: *(longlong*)(entity+0x10) != 0 → FUN_1400ac540(ptr, 0)
        // EXTERN: *(byte*)(component+0x38) = 1

        let _ = (id_primary, flag_extra); // EXTERN — suppress lint
        LuaCommandResult::bool(false)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Erreurs
// ─────────────────────────────────────────────────────────────────────────────

/// Erreurs d'initialisation du gestionnaire Lua.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum LuaInitError {
    /// Le manager a déjà été initialisé (guard thread-safe déclenché).
    #[error("LuaManager déjà initialisé")]
    AlreadyInitialized,

    /// Échec du chargement de la config système.
    ///
    /// Source : L217 `FUN_140ae07e0(0x7180d958, 1)` + retour anticipé.
    #[error("échec config système : {path}")]
    ConfigLoadFailed {
        /// Chemin de la config qui a échoué à charger.
        path: String,
    },

    /// Échec du sous-système Lua (FUN_140ef6e40 retourne '\0').
    ///
    /// Source : L2082-2088.
    #[error("échec vérification sous-système Lua")]
    LuaSubsystemFailed,
}

// ─────────────────────────────────────────────────────────────────────────────
// Résultat d'enregistrement
// ─────────────────────────────────────────────────────────────────────────────

/// Résultat de [`LuaManager::register_commands`].
#[derive(Debug, Clone)]
pub struct RegisterResult {
    /// État Lua dans lequel les commandes ont été enregistrées.
    pub state_id: LuaStateId,
    /// Si `true`, les commandes étaient déjà enregistrées (guard déclenché).
    pub already_registered: bool,
    /// Nombre de commandes effectivement portées dans cette implémentation.
    pub registered_count: usize,
    /// Taille totale de la table C++ originale (0x955).
    pub command_table_size: usize,
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// Vérifie la valeur par défaut du chemin data.
    /// Source : lua_manager_init.c L174 `DAT_1420435e8 = "data/"`.
    #[test]
    fn test_lua_manager_default_data_path() {
        let mgr = LuaManager::new();
        assert_eq!(mgr.data_path, "data/");
    }

    /// Vérifie le mode plateforme par défaut (fallback L292).
    #[test]
    fn test_lua_manager_default_platform_mode() {
        let mgr = LuaManager::new();
        assert_eq!(mgr.platform_mode, 1);
    }

    /// Vérifie la locale par défaut (ja_JP — L212).
    #[test]
    fn test_lua_manager_locale() {
        let mgr = LuaManager::new();
        assert_eq!(mgr.locale, "ja_JP");
    }

    /// Vérifie la taille du pool mémoire Lua (0x100000 — L213).
    #[test]
    fn test_lua_pool_size() {
        let mgr = LuaManager::new();
        assert_eq!(mgr.lua_pool_size, 0x100000);
    }

    /// Vérifie que l'init réussit sur un manager vierge.
    #[test]
    fn test_init_succeeds() {
        let mut mgr = LuaManager::new();
        assert!(mgr.init(None).is_ok());
        assert!(mgr.initialized);
    }

    /// Vérifie que l'init est idempotente (guard thread-safe).
    #[test]
    fn test_init_idempotent() {
        let mut mgr = LuaManager::new();
        mgr.init(None).unwrap();
        let err = mgr.init(None).unwrap_err();
        assert_eq!(err, LuaInitError::AlreadyInitialized);
    }

    /// Vérifie le chemin data custom.
    #[test]
    fn test_init_custom_data_path() {
        let mut mgr = LuaManager::new();
        mgr.init(Some("custom/data/")).unwrap();
        assert_eq!(mgr.data_path, "custom/data/");
    }

    /// Vérifie l'enregistrement des commandes (guard first-call).
    /// Source : lua_command_register.c L9-12 (`DAT_141f7ea3f`).
    #[test]
    fn test_register_commands_first_call() {
        let mut mgr = LuaManager::new();
        mgr.init(None).unwrap();
        let state = LuaStateId(1);
        let result = mgr.register_commands(state);
        assert!(!result.already_registered);
        assert_eq!(result.command_table_size, LUA_COMMAND_TABLE_SIZE);
        assert_eq!(result.command_table_size, 0x955);
    }

    /// Vérifie que le second enregistrement détecte le guard.
    #[test]
    fn test_register_commands_second_call() {
        let mut mgr = LuaManager::new();
        mgr.init(None).unwrap();
        let state = LuaStateId(1);
        mgr.register_commands(state);
        let result = mgr.register_commands(state);
        assert!(result.already_registered);
    }

    /// Vérifie le chargement d'une bibliothèque Lua absente.
    /// Source : lua_openlibs.c `if (iVar1 != 5)` L17 → nouveau chargement.
    #[test]
    fn test_open_lib_new() {
        let mut mgr = LuaManager::new();
        mgr.init(None).unwrap();
        let state = LuaStateId(1);
        let result = mgr.open_lib(state, LuaStdLib::Math, true);
        assert_eq!(result.status, LoadStatus::Loaded);
        assert!(result.registered_global);
    }

    /// Vérifie qu'une bibliothèque déjà chargée retourne `AlreadyLoaded`.
    /// Source : lua_openlibs.c branche `if (iVar1 != 5)` non prise.
    #[test]
    fn test_open_lib_already_loaded() {
        let mut mgr = LuaManager::new();
        mgr.init(None).unwrap();
        let state = LuaStateId(1);
        mgr.open_lib(state, LuaStdLib::String, false);
        let result = mgr.open_lib(state, LuaStdLib::String, false);
        assert_eq!(result.status, LoadStatus::AlreadyLoaded);
    }

    /// Vérifie la conversion double→i32 (branche positive — L58-60).
    #[test]
    fn test_number_to_i32_positive() {
        assert_eq!(LuaValue::number_to_i32(42.9), 42);
    }

    /// Vérifie la conversion double→i32 (branche négative — L55-57).
    #[test]
    fn test_number_to_i32_negative() {
        assert_eq!(LuaValue::number_to_i32(-3.7), -3);
    }

    /// Vérifie la conversion double→u64 (branche positive — L65-68).
    #[test]
    fn test_number_to_u64() {
        assert_eq!(LuaValue::number_to_u64(255.0), 255u64);
    }

    /// Vérifie l'arité minimale de exec_menu_command (< 3 → false).
    /// Source : FUN_140c3a070 L47-50.
    #[test]
    fn test_exec_menu_command_too_few_args() {
        let mgr = LuaManager::new();
        let result = mgr.exec_menu_command(&[LuaValue::Number(1.0), LuaValue::Number(2.0)]);
        assert_eq!(result.n_returns, 1);
        assert_eq!(result.return_value, Some(LuaValue::Boolean(false)));
    }

    /// Vérifie que 3 args est acceptable pour exec_menu_command.
    #[test]
    fn test_exec_menu_command_min_args() {
        let mgr = LuaManager::new();
        let result = mgr.exec_menu_command(&[
            LuaValue::Number(1.0),
            LuaValue::Number(42.0),
            LuaValue::Boolean(true),
        ]);
        assert_eq!(result.n_returns, 1);
    }

    /// Vérifie le retour immédiat de exec_menu_command_simple sur args vide.
    /// Source : FUN_140c3a1f0 L119-121 `if (param_2 == 0)`.
    #[test]
    fn test_exec_menu_command_simple_empty() {
        let mgr = LuaManager::new();
        let result = mgr.exec_menu_command_simple(&[]);
        assert_eq!(result.return_value, Some(LuaValue::Boolean(false)));
    }

    /// Vérifie les constantes de la table de commandes.
    /// Source : lua_command_register.c `0x955`, network_lua_command.c `0x27`,
    ///          menu_lua_command.c `0x402`.
    #[test]
    fn test_command_table_constants() {
        assert_eq!(LUA_COMMAND_TABLE_SIZE, 0x955);
        assert_eq!(LUA_NETWORK_COMMAND_TABLE_SIZE, 0x27);
        assert_eq!(LUA_MENU_COMMAND_TABLE_SIZE, 0x402);
    }

    /// Vérifie les noms Lua des bibliothèques standard.
    #[test]
    fn test_lua_std_lib_names() {
        assert_eq!(LuaStdLib::Math.lua_name(), "math");
        assert_eq!(LuaStdLib::String.lua_name(), "string");
        assert_eq!(LuaStdLib::Package.lua_name(), "package");
        assert_eq!(LuaStdLib::Bit32.lua_name(), "bit32");
    }

    /// Vérifie la conversion LuaType depuis i32.
    #[test]
    fn test_lua_type_from_i32() {
        assert_eq!(LuaType::from(5), LuaType::Table);
        assert_eq!(LuaType::from(0), LuaType::Nil);
        assert_eq!(LuaType::from(99), LuaType::Unknown);
    }
}
