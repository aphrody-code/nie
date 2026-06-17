//! Sous-système réseau EOS Lobby + pont Lua réseau de `nie.exe`
//!
//! Porte fidèlement les fonctions décompilées Ghidra :
//!
//! | Fonction C                   | Rust                                  | Adresse binaire  |
//! |------------------------------|---------------------------------------|------------------|
//! | `FUN_141142fa0`              | [`LobbyManager::init`]                | `0x141142fa0`    |
//! | `FUN_1411430e0`              | [`LobbyManager::cleanup`]             | `0x1411430e0`    |
//! | `FUN_1411431b0`              | [`LobbyManager::free_resources`]      | `0x1411431b0`    |
//! | `FUN_141148d80`              | [`LobbyManager::create`]              | `0x141148d80`    |
//! | `FUN_141141660`              | [`LobbyManager::modify`]              | `0x141141660`    |
//! | `FUN_141088380`              | [`register_lua_network_command`]      | `0x141088380`    |
//!
//! Sources : `network_lobby_init.c`, `network_lobby_create.c`,
//! `network_lobby_modify.c`, `network_lua_command.c`
//!
//! # Architecture
//!
//! Le moteur nie.exe utilise Epic Online Services (EOS) pour les lobbys
//! multijoueur. La couche Lua expose ces fonctionnalités via la table
//! `funcLuaMenuNetworkCommand` (0x27 commandes).
//!
//! Tous les appels EOS (ex. `EOS_Platform_GetLobbyInterface`,
//! `EOS_Lobby_CreateLobby`) sont modélisés par des traits / stubs
//! documentés (`// EXTERN:`) car ils n'existent pas en dehors de la DLL
//! EOS SDK propriétaire.

// ── types et stubs externes ────────────────────────────────────────────────

/// Handle opaque vers l'interface lobby EOS (`EOS_HLobby`).
///
/// Dans nie.exe : pointeur 64-bit stocké à `param_1[0]`.
/// `0` représente "non initialisé / invalide".
///
/// EXTERN: `EOS_Platform_GetLobbyInterface()` → retourne ce handle.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct EosLobbyHandle(pub u64);

impl EosLobbyHandle {
    /// Handle nul — lobby non initialisé.
    pub const NULL: Self = Self(0);

    /// Retourne `true` si le handle est valide (non-nul).
    #[must_use]
    pub fn is_valid(self) -> bool {
        self.0 != 0
    }
}

/// Handle de notification EOS.
///
/// Retourné par `EOS_Lobby_AddNotify*` ; doit être conservé pour
/// pouvoir appeler `EOS_Lobby_RemoveNotify*` lors du cleanup.
/// `0` = notification non enregistrée.
///
/// EXTERN: `EOS_Lobby_AddNotifyLobbyUpdateReceived` → `NotifyHandle`
/// EXTERN: `EOS_Lobby_AddNotifyLobbyMemberUpdateReceived` → `NotifyHandle`
/// EXTERN: `EOS_Lobby_AddNotifyLobbyMemberStatusReceived` → `NotifyHandle`
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct NotifyHandle(pub u64);

impl NotifyHandle {
    /// Handle nul — notification non enregistrée.
    pub const NULL: Self = Self(0);

    /// Retourne `true` si la notification est active.
    #[must_use]
    pub fn is_active(self) -> bool {
        self.0 != 0
    }
}

/// `EOS_ProductUserId` — identifiant produit EOS du joueur.
///
/// Dans nie.exe, stocké à `DAT_14201c570 + 0x50` (singleton utilisateur EOS).
///
/// EXTERN: `EOS_ProductUserId_IsValid(id) -> i32`  (non-zéro = valide)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct EosProductUserId(pub u64);

impl EosProductUserId {
    /// ID nul — joueur non connecté.
    pub const NULL: Self = Self(0);

    /// Reproduit `EOS_ProductUserId_IsValid` (version locale sans FFI).
    /// RE incertain : l'implémentation réelle teste probablement un bit interne.
    #[must_use]
    pub fn is_valid(self) -> bool {
        self.0 != 0
    }
}

/// Handle opaque vers une modification de lobby EOS (`EOS_HLobbyModification`).
///
/// EXTERN: `EOS_Lobby_UpdateLobbyModification` → peuple ce handle.
/// EXTERN: `EOS_LobbyModification_SetPermissionLevel(handle, &opts)`
/// EXTERN: `EOS_LobbyModification_SetBucketId(handle, &opts)`
/// EXTERN: `EOS_LobbyModification_SetInvitesAllowed(handle, &opts)`
/// EXTERN: `EOS_LobbyModification_SetMaxMembers(handle, &opts)`
/// EXTERN: `EOS_Lobby_UpdateLobby(*lobby_iface, &opts, ctx, callback)`
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct EosLobbyModificationHandle(pub u64);

/// Version API EOS `EOS_Lobby_CreateLobby` la plus récente connue.
///
/// Source: `network_lobby_create.c` — `local_68 = 10` (`EOS_LOBBY_CREATELOBBY_API_LATEST`).
pub const EOS_LOBBY_CREATELOBBY_API_LATEST: u64 = 10;

/// Taille d'un attribut de modification de lobby, en octets.
///
/// Source: `network_lobby_modify.c` — `uVar11 = uVar11 + 0x88` dans la boucle
/// d'itération des attributs personnalisés.
pub const LOBBY_ATTR_STRIDE: u64 = 0x88;

/// Offset du champ `max_members` dans la configuration lobby.
///
/// Source: `network_lobby_create.c` — `*(byte *)(param_2 + 0x105)`.
pub const CFG_OFFSET_MAX_MEMBERS: usize = 0x105;

/// Offset du champ `lobby_id` (chaîne C) dans la configuration lobby.
///
/// Source: `network_lobby_modify.c` — `param_2 + 0x32`.
pub const CFG_OFFSET_LOBBY_ID: usize = 0x32;

/// Offset du champ `owner_user_id` dans la configuration lobby.
///
/// Source: `network_lobby_modify.c` — `*(ulonglong *)(param_2 + 0x44)`.
pub const CFG_OFFSET_OWNER_ID: usize = 0x44;

/// Nombre de commandes réseau enregistrées dans la table Lua.
///
/// Source: `network_lua_command.c` — `FUN_140c35080(&DAT_14203fcc0, &PTR_FUN_141a657a0, 0x27)`.
pub const LUA_NETWORK_COMMAND_COUNT: u32 = 0x27;

/// Nom de la commande Lua réseau exposée au moteur.
///
/// Source: `network_lua_command.c` — `DAT_1420dd2c0 = "funcLuaMenuNetworkCommand"`.
pub const LUA_NETWORK_COMMAND_NAME: &str = "funcLuaMenuNetworkCommand";

/// Niveau de permission par défaut appliqué lors d'un `ModifyLobby`.
///
/// Source: `network_lobby_modify.c` — `local_1a0 = 1` passé à
/// `EOS_LobbyModification_SetPermissionLevel`.
pub const DEFAULT_PERMISSION_LEVEL: u32 = 1;

/// Bit de flag "UpdateLobby en cours" dans `lobby_manager.state_flags`.
///
/// Source: `network_lobby_modify.c` —
/// `*(uint *)(param_1 + 0xbd) = *(uint *)(param_1 + 0xbd) | 0x40`.
pub const STATE_FLAG_UPDATE_IN_PROGRESS: u32 = 0x40;

// ── configuration lobby ────────────────────────────────────────────────────

/// Niveau de permission d'accès au lobby.
///
/// Source: `network_lobby_modify.c` — entier passé à
/// `EOS_LobbyModification_SetPermissionLevel`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[repr(u32)]
pub enum LobbyPermission {
    /// Public — ouvert à tous.
    #[default]
    Public = 0,
    /// JoinViaPresence — rejoindre via présence EOS (valeur observée = 1).
    JoinViaPresence = 1,
    /// InviteOnly — sur invitation uniquement.
    InviteOnly = 2,
}

/// Configuration d'initialisation/création d'un lobby.
///
/// Reconstruit depuis les offsets observés dans `network_lobby_init.c` et
/// `network_lobby_create.c`. Les champs correspondent aux accès pointeur
/// Ghidra (`param_2[N]`, `param_2 + offset`).
///
/// Porté de `network_lobby_init.c` (`FUN_141142fa0`) et
/// `network_lobby_create.c` (`FUN_141148d80`).
#[derive(Debug, Clone, Default)]
pub struct LobbyConfig {
    /// Identifiant produit EOS du joueur local.
    ///
    /// Source: `network_lobby_init.c` — `*param_2` (premier champ, 8 octets).
    /// `network_lobby_create.c` — `DAT_14201c570 + 0x50`.
    pub local_user_id: EosProductUserId,

    /// Nombre maximum de membres dans le lobby.
    ///
    /// Source: `network_lobby_init.c` — `*(int *)(param_1 + 0xbc) = (int)param_2[1]`.
    /// `network_lobby_create.c` — `local_58 = (uint)*(byte *)(param_2 + 0x105)`.
    /// `network_lobby_modify.c` — `*(byte *)(param_2 + 0x105)`.
    pub max_members: u32,

    /// Type de lobby (champ `param_2[2]`).
    ///
    /// Source: `network_lobby_init.c` — `(int)param_2[2] != 0` (condition init).
    /// Stocké à `param_1 + 0x5ec`.
    pub lobby_type: i32,

    /// Identifiant "bucket" EOS pour le matchmaking.
    ///
    /// Source: `network_lobby_init.c` — `*(undefined4 *)((longlong)param_2 + 0xc)`.
    /// Stocké à `param_1 + 0x5e4`.
    pub bucket_id_raw: u32,

    /// Identifiant textuel du lobby existant (pour ModifyLobby).
    ///
    /// Source: `network_lobby_modify.c` — `param_2 + 0x32` (chaîne C 0-terminée).
    pub lobby_id: Option<String>,

    /// Propriétaire du lobby (`EOS_ProductUserId`).
    ///
    /// Source: `network_lobby_modify.c` — `*(ulonglong *)(param_2 + 0x44)`.
    pub owner_id: EosProductUserId,

    /// Niveau de permission d'accès.
    ///
    /// Source: `network_lobby_modify.c` — `*param_2` (premier `undefined4`).
    pub permission: LobbyPermission,

    /// Attributs personnalisés du lobby (liste variable).
    ///
    /// Source: `network_lobby_modify.c` — boucle sur `param_2[0x2a..0x2c]`
    /// avec stride `0x88` octets par attribut.
    pub attributes: Vec<LobbyAttribute>,
}

/// Un attribut personnalisé de lobby EOS.
///
/// Source: `network_lobby_modify.c` — boucle `FUN_14113dc00(lVar9, local_168, lVar5 + uVar11)`
/// avec stride `0x88` et `FUN_1400d1360(&local_100, "DATA_VERSION", 0xc)`.
/// L'attribut `DATA_VERSION` est toujours ajouté en dernier via `FUN_14113acb0`.
#[derive(Debug, Clone, Default)]
pub struct LobbyAttribute {
    /// Clé de l'attribut (chaîne UTF-8).
    pub key: String,
    /// Valeur de l'attribut (chaîne UTF-8).
    pub value: String,
}

// ── handle d'opération asynchrone ─────────────────────────────────────────

/// Handle d'opération asynchrone lobby (attente de callback EOS).
///
/// Source: `network_lobby_create.c` — `lVar2 = FUN_141145890(param_1)` retourne
/// ce pointeur d'attente ; `EOS_Lobby_CreateLobby` reçoit `lVar2` comme contexte
/// pour `LAB_141146ce0`.
///
/// Dans la mémoire nie.exe, la structure fait au moins 0x1e8 + 8 octets et
/// porte un back-pointer vers le `LobbyManager` à offset `+0x10`.
#[derive(Debug)]
pub struct AsyncLobbyOp {
    /// Identifiant interne (indice dans la liste des opérations en cours).
    ///
    /// Source: `network_lobby_create.c` — le `lVar1` pointant dans
    /// `param_1[0x1a..0x1c]` (liste chaînée).
    pub op_idx: usize,

    /// Identifiant produit EOS du joueur initiant l'opération.
    ///
    /// Source: `network_lobby_create.c` — `*(undefined8 *)(lVar1 + -0x1e8) = uVar3`.
    pub initiator_id: EosProductUserId,
}

// ── résultats et erreurs ───────────────────────────────────────────────────

/// Résultat d'une opération lobby.
pub type LobbyResult<T> = Result<T, LobbyError>;

/// Erreurs du sous-système lobby.
///
/// Porté de `network_lobby_modify.c` — messages d'erreur littéraux dans le
/// pseudo-C et codes de retour observés.
#[derive(Debug, thiserror::Error)]
pub enum LobbyError {
    /// L'interface EOS Lobby n'a pas pu être obtenue.
    ///
    /// Source: `network_lobby_init.c` — `if (lVar1 != 0)` après
    /// `EOS_Platform_GetLobbyInterface()`.
    #[error("EOS: impossible d'obtenir l'interface lobby (handle nul)")]
    EosLobbyInterfaceNull,

    /// Paramètres de configuration invalides (joueur ou type lobby absent).
    ///
    /// Source: `network_lobby_init.c` — `(*param_2 != 0) && ((int)param_2[2] != 0)`.
    #[error("configuration lobby invalide : joueur ou type manquant")]
    InvalidConfig,

    /// L'identifiant de lobby est vide (chaîne lobby_id longueur 0).
    ///
    /// Source: `network_lobby_modify.c` — `if (lVar5 == 0) goto LAB_1411416e6`.
    #[error("identifiant de lobby vide")]
    EmptyLobbyId,

    /// Le joueur courant n'est pas valide selon EOS.
    ///
    /// Source: `network_lobby_modify.c` — `"[*** Error] ModifyLobby: Current player is invalid!"`.
    #[error("ModifyLobby: joueur courant invalide (EOS_ProductUserId_IsValid == false)")]
    InvalidPlayer,

    /// Seul le propriétaire du lobby peut le modifier.
    ///
    /// Source: `network_lobby_modify.c` — `"[*** Error] ModifyLobby: Only owner can modify lobby."`.
    #[error("ModifyLobby: seul le propriétaire peut modifier le lobby")]
    NotOwner,

    /// Échec d'une opération EOS (`EOS_Lobby_UpdateLobbyModification`, etc.).
    ///
    /// Source: `network_lobby_modify.c` — `if ((int)uVar6 != 0) goto LAB_1411416e6`
    /// et `goto LAB_141141a2c` (retour 0).
    #[error("opération EOS échouée (code {0})")]
    EosError(i32),

    /// Lobby déjà initialisé (flag `param_1[0x1a] != 0`).
    ///
    /// Source: `network_lobby_init.c` — `if ((char)param_1[0x1a] != '\0') return 1`.
    #[error("lobby déjà initialisé")]
    AlreadyInitialized,
}

// ── LobbyManager ──────────────────────────────────────────────────────────

/// Gestionnaire de lobby EOS pour nie.exe.
///
/// Porté de `network_lobby_init.c` (`FUN_141142fa0` / `FUN_1411430e0` /
/// `FUN_1411431b0`) et `network_lobby_create.c` (`FUN_141148d80`) et
/// `network_lobby_modify.c` (`FUN_141141660`).
///
/// # Disposition mémoire originale (nie.exe)
///
/// ```text
/// offset  champ
/// +0x000  lobby_iface          : EOS_HLobby (8 bytes)  → self.lobby_iface
/// +0x0d0  initialized flag     : u8                    → self.initialized (param_1[0x1a], byte 0)
/// +0x0e0  max_members_raw      : u32                   → self.max_members_raw (param_1[0xbc])
/// +0x0e8  api_version_flag     : u32 = 8               → self.api_version_flag
/// +0x440  lobby_type           : u8 (char)             → self.lobby_type (param_1 + 0x5ec)
/// +0x438  bucket_id_raw        : u32                   → self.bucket_id_raw (param_1 + 0x5e4)
/// +0x440  pending_ops[0..3]    : u64 × 4               → self.pending_ops (param_1[0x87..0x8b])
/// +0x460  notify_lobby_update  : NotifyHandle          → self.notify_lobby_update (param_1[0x8c])
/// +0x468  notify_member_update : NotifyHandle          → self.notify_member_update (param_1[0x8d])
/// +0x470  notify_member_status : NotifyHandle          → self.notify_member_status (param_1[0x8e])
/// +0x4a0  lobby_list_begin     : usize index           → self.lobby_list (param_1[0x1a])
/// +0x4b8  state_flags          : u32                   → self.state_flags (param_1[0xbd])
/// +0x5c0  allocator_vtable     : ptr (option)          → self.resource_allocator_vtable
/// +0x5c8  resource_ptr         : u64                   → self.resource_ptr
/// ```
///
/// Les offsets `0x4a8`, `0x3d0`, `0xd8` (FUN_1411431b0) correspondent aux
/// sous-listes de ressources allouées, nettoyées séquentiellement.
///
/// # Note sur l'injection EOS
///
/// En Rust, les callbacks EOS réels ne sont pas portés (ils nécessitent la
/// DLL EOS). Les méthodes qui devraient appeler EOS sont documentées
/// `// EXTERN:` et retournent des stubs ou acceptent des handles injectés.
#[derive(Debug, Default)]
pub struct LobbyManager {
    // ── état d'initialisation ──────────────────────────────────────────────

    /// Drapeau d'initialisation (`param_1[0x1a]`, byte).
    ///
    /// Source: `network_lobby_init.c` — `*(undefined1 *)(param_1 + 0x1a) = 1`.
    /// Positionné à 1 en début d'init, remis à 0 lors du cleanup.
    pub initialized: bool,

    // ── interface EOS ──────────────────────────────────────────────────────

    /// Handle EOS Lobby (offset +0x000).
    ///
    /// Source: `network_lobby_init.c` — `*param_1 = lVar1` après
    /// `EOS_Platform_GetLobbyInterface()`.
    pub lobby_iface: EosLobbyHandle,

    // ── configuration stockée ──────────────────────────────────────────────

    /// Nombre maximum de membres (offset `param_1[0xbc]`).
    ///
    /// Source: `network_lobby_init.c` — `*(int *)(param_1 + 0xbc) = (int)param_2[1]`.
    pub max_members_raw: u32,

    /// Version API interne (offset `param_1[0xbd]`), toujours `8`.
    ///
    /// Source: `network_lobby_init.c` — `*(undefined4 *)(param_1 + 0xbd) = 8`.
    pub api_version_flag: u32,

    /// Type de lobby (offset `param_1 + 0x5ec`).
    ///
    /// Source: `network_lobby_init.c` — `*(char *)((longlong)param_1 + 0x5ec) = (char)param_2[2]`.
    pub lobby_type: i8,

    /// Bucket ID brut EOS (offset `param_1 + 0x5e4`).
    ///
    /// Source: `network_lobby_init.c` — `*(undefined4 *)((longlong)param_1 + 0x5e4)`.
    pub bucket_id_raw: u32,

    // ── flags d'état ──────────────────────────────────────────────────────

    /// Flags d'état du lobby manager (offset `param_1[0xbd]`).
    ///
    /// Source: `network_lobby_modify.c` —
    /// `*(uint *)(param_1 + 0xbd) = *(uint *)(param_1 + 0xbd) | 0x40`.
    /// Le bit `0x40` indique qu'un `UpdateLobby` est en cours.
    pub state_flags: u32,

    // ── opérations en attente (param_1[0x87..0x8b]) ───────────────────────

    /// Opérations asynchrones en attente (4 slots, offsets +0x87, +0x88, +0x89, +0x8a, +0x8b).
    ///
    /// Source: `network_lobby_init.c` — `param_1[0x88..0x8b] = 0` (init),
    /// remis à 0 lors du cleanup.
    /// RE incertain : la signification exacte de chaque slot n'est pas claire.
    pub pending_ops: [u64; 4],

    /// Compteur/handle supplémentaire (offset `param_1[0x87]`).
    ///
    /// Source: `network_lobby_init.c` — `param_1[0x87] = 0` (fin d'init et cleanup).
    pub pending_ops_aux: u64,

    // ── handles de notification ────────────────────────────────────────────

    /// Handle de notification `LobbyUpdateReceived` (offset `param_1[0x8c]`).
    ///
    /// Source: `network_lobby_init.c` —
    /// `lVar1 = EOS_Lobby_AddNotifyLobbyUpdateReceived(*param_1, opts, param_1, cb)`.
    pub notify_lobby_update: NotifyHandle,

    /// Handle de notification `LobbyMemberUpdateReceived` (offset `param_1[0x8d]`).
    ///
    /// Source: `network_lobby_init.c` —
    /// `lVar1 = EOS_Lobby_AddNotifyLobbyMemberUpdateReceived(*param_1, opts, param_1, cb)`.
    pub notify_member_update: NotifyHandle,

    /// Handle de notification `LobbyMemberStatusReceived` (offset `param_1[0x8e]`).
    ///
    /// Source: `network_lobby_init.c` —
    /// `lVar1 = EOS_Lobby_AddNotifyLobbyMemberStatusReceived(*param_1, opts, param_1, cb)`.
    pub notify_member_status: NotifyHandle,

    // ── liste des lobbys actifs ────────────────────────────────────────────

    /// Liste des lobbys actifs (copie Rust du linked-list C param_1[0x1a..0x1d]).
    ///
    /// Source: `network_lobby_create.c` — `lVar1 = param_1[0x1c]` / comparaison
    /// `param_1[0x1d]` pour déterminer overflow de liste, avance par `+0x2f8`.
    pub active_lobbies: Vec<ActiveLobby>,

    // ── ressources mémoire (FUN_1411431b0) ────────────────────────────────

    /// Pointeur vers la ressource allouée (offset `param_1 + 0x5c8`).
    ///
    /// Source: `network_lobby_init.c` (FUN_1411431b0) —
    /// `if (*(longlong *)(param_1 + 0x5c8) != 0)`.
    /// `0` = aucune ressource allouée.
    pub resource_ptr: u64,

    /// Indique si un allocateur custom (vtable) est actif (offset `param_1 + 0x5c0`).
    ///
    /// Source: `network_lobby_init.c` (FUN_1411431b0) —
    /// `if (*(longlong **)(param_1 + 0x5c0) == NULL)` → `thunk_FUN_1409bae00(resource_ptr)`
    /// sinon → dispatch via vtable `(*vtable[0x30])()`.
    pub has_custom_allocator: bool,

    // ── ProductUserId du player local (singleton EOS) ─────────────────────

    /// Identifiant EOS du joueur local.
    ///
    /// Source: `network_lobby_create.c` — `*(undefined8 *)(DAT_14201c570 + 0x50)`.
    /// Rempli lors de `create()` / `modify()`.
    pub local_user_id: EosProductUserId,
}

/// Représente une entrée dans la liste des lobbys actifs.
///
/// Source: `network_lobby_create.c` — chaque entrée fait `0x2f8` bytes dans
/// la mémoire originale (stride `param_1[0x1c] += 0x2f8`).
#[derive(Debug, Clone, Default)]
pub struct ActiveLobby {
    /// ProductUserId du joueur propriétaire de ce lobby.
    ///
    /// Source: `network_lobby_create.c` — `*(undefined8 *)(lVar1 + -0x1e8) = uVar3`.
    /// RE incertain : offset exact relatif à la tête de liste.
    pub owner_id: EosProductUserId,

    /// Données de configuration de ce lobby.
    pub config: LobbyConfig,
}

impl LobbyManager {
    /// Crée un nouveau gestionnaire de lobby non initialisé.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Initialise le gestionnaire de lobby EOS.
    ///
    /// Portage fidèle de `FUN_141142fa0` (adresse `0x141142fa0`).
    ///
    /// # Logique C reproduite
    ///
    /// ```c
    /// // Garde : déjà initialisé
    /// if ((char)param_1[0x1a] != '\0') return 1;
    /// *(undefined1 *)(param_1 + 0x1a) = 1;          // flag initialisé
    ///
    /// // Valide la config (joueur présent + type non-nul)
    /// if ((*param_2 != 0) && ((int)param_2[2] != 0)) {
    ///     lVar1 = EOS_Platform_GetLobbyInterface();  // EXTERN
    ///     *param_1 = lVar1;
    ///     if (lVar1 != 0) {
    ///         FUN_141134f90(param_1 + 0x95, *param_2);  // copie ProductUserId
    ///         *(undefined4 *)(param_1 + 0xbd) = 8;      // api_version_flag
    ///         *(char *)((longlong)param_1 + 0x5ec) = (char)param_2[2]; // lobby_type
    ///         *(int *)(param_1 + 0xbc) = (int)param_2[1];  // max_members
    ///         *(undefined4 *)((longlong)param_1 + 0x5e4) = *(undefined4 *)((longlong)param_2 + 0xc);
    ///         param_1[0x88..0x8b] = 0;               // pending_ops reset
    ///
    ///         // Enregistre 3 callbacks EOS
    ///         lVar1 = EOS_Lobby_AddNotifyLobbyUpdateReceived(...);   param_1[0x8c] = lVar1;
    ///         lVar1 = EOS_Lobby_AddNotifyLobbyMemberUpdateReceived(...); param_1[0x8d] = lVar1;
    ///         lVar1 = EOS_Lobby_AddNotifyLobbyMemberStatusReceived(...); param_1[0x8e] = lVar1;
    ///
    ///         param_1[0x87] = 0; // pending_ops_aux
    ///         return 1;
    ///     }
    /// }
    /// return 0;
    /// ```
    ///
    /// # Différences Rust
    ///
    /// - Les appels EOS (`EOS_Platform_GetLobbyInterface`, `AddNotify*`) sont
    ///   simulés par injection de handles via `eos_iface` et `notify_handles`.
    /// - `FUN_141134f90` (copie ProductUserId) devient une assignation directe.
    /// - Retourne `Err(AlreadyInitialized)` si déjà initialisé (au lieu de
    ///   retourner `1` silencieusement).
    ///
    /// # Erreurs
    ///
    /// - [`LobbyError::AlreadyInitialized`] si `self.initialized == true`.
    /// - [`LobbyError::InvalidConfig`] si `local_user_id` nul ou `lobby_type == 0`.
    /// - [`LobbyError::EosLobbyInterfaceNull`] si le handle EOS fourni est nul.
    pub fn init(
        &mut self,
        config: &LobbyConfig,
        // Handle EOS Lobby injecté (substitue `EOS_Platform_GetLobbyInterface()`).
        // EXTERN: `EOS_Platform_GetLobbyInterface()` → ce handle.
        eos_iface: EosLobbyHandle,
        // Handles de notification EOS injectés (substitue `EOS_Lobby_AddNotify*`).
        // EXTERN: `EOS_Lobby_AddNotifyLobbyUpdateReceived` → `notify_handles.0`
        // EXTERN: `EOS_Lobby_AddNotifyLobbyMemberUpdateReceived` → `notify_handles.1`
        // EXTERN: `EOS_Lobby_AddNotifyLobbyMemberStatusReceived` → `notify_handles.2`
        notify_handles: (NotifyHandle, NotifyHandle, NotifyHandle),
    ) -> LobbyResult<()> {
        // Reproduit : `if ((char)param_1[0x1a] != '\0') return 1;`
        // En C, retourner 1 ici = "déjà initialisé, succès silencieux".
        // En Rust, on signale explicitement l'état.
        if self.initialized {
            return Err(LobbyError::AlreadyInitialized);
        }

        // Reproduit : `*(undefined1 *)(param_1 + 0x1a) = 1;`
        self.initialized = true;

        // Reproduit : `(*param_2 != 0) && ((int)param_2[2] != 0)`
        // param_2[0] = local_user_id (non-nul), param_2[2] = lobby_type (non-nul)
        if !config.local_user_id.is_valid() || config.lobby_type == 0 {
            return Err(LobbyError::InvalidConfig);
        }

        // Reproduit : `lVar1 = EOS_Platform_GetLobbyInterface(); *param_1 = lVar1;`
        // EXTERN: EOS_Platform_GetLobbyInterface
        if !eos_iface.is_valid() {
            return Err(LobbyError::EosLobbyInterfaceNull);
        }
        self.lobby_iface = eos_iface;

        // Reproduit : `FUN_141134f90(param_1 + 0x95, *param_2)` — copie ProductUserId
        self.local_user_id = config.local_user_id;

        // Reproduit : `*(undefined4 *)(param_1 + 0xbd) = 8`
        self.api_version_flag = 8;

        // Reproduit : `*(char *)((longlong)param_1 + 0x5ec) = (char)param_2[2]`
        self.lobby_type = config.lobby_type as i8;

        // Reproduit : `*(int *)(param_1 + 0xbc) = (int)param_2[1]`
        self.max_members_raw = config.max_members;

        // Reproduit : `*(undefined4 *)((longlong)param_1 + 0x5e4) = *(undefined4 *)((longlong)param_2 + 0xc)`
        self.bucket_id_raw = config.bucket_id_raw;

        // Reproduit : `param_1[0x88] = 0; param_1[0x89] = 0; param_1[0x8a] = 0; param_1[0x8b] = 0;`
        self.pending_ops = [0u64; 4];

        // Reproduit : enregistrement des 3 callbacks EOS (si encore initialisé)
        // `if ((char)param_1[0x1a] != '\0')` — vérifié juste avant les AddNotify
        if self.initialized {
            // EXTERN: EOS_Lobby_AddNotifyLobbyUpdateReceived
            // `local_res8[0] = 1; lVar1 = EOS_Lobby_AddNotifyLobbyUpdateReceived(...)`
            self.notify_lobby_update = notify_handles.0;

            // EXTERN: EOS_Lobby_AddNotifyLobbyMemberUpdateReceived
            // `local_res18[0] = 1; lVar1 = EOS_Lobby_AddNotifyLobbyMemberUpdateReceived(...)`
            self.notify_member_update = notify_handles.1;

            // EXTERN: EOS_Lobby_AddNotifyLobbyMemberStatusReceived
            // `local_res20[0] = 1; lVar1 = EOS_Lobby_AddNotifyLobbyMemberStatusReceived(...)`
            self.notify_member_status = notify_handles.2;
        }

        // Reproduit : `param_1[0x87] = 0;`
        self.pending_ops_aux = 0;

        tracing::debug!(
            lobby_type = self.lobby_type,
            max_members = self.max_members_raw,
            "lobby EOS initialisé"
        );

        Ok(())
    }

    /// Nettoie le gestionnaire de lobby (désenregistre les notifications EOS).
    ///
    /// Portage fidèle de `FUN_1411430e0` (adresse `0x1411430e0`).
    ///
    /// # Logique C reproduite
    ///
    /// ```c
    /// if (*(char *)(param_1 + 0x1a) != '\0') {
    ///     // Désenregistre chaque notification si son handle est non-nul
    ///     if (param_1[0x8c] != 0) {
    ///         EOS_Lobby_RemoveNotifyLobbyUpdateReceived(*param_1);
    ///         param_1[0x8c] = 0;
    ///     }
    ///     if (param_1[0x8d] != 0) {
    ///         EOS_Lobby_RemoveNotifyLobbyMemberUpdateReceived(*param_1);
    ///         param_1[0x8d] = 0;
    ///     }
    ///     if (param_1[0x8e] != 0) {
    ///         EOS_Lobby_RemoveNotifyLobbyMemberStatusReceived(*param_1);
    ///         param_1[0x8e] = 0;
    ///     }
    /// }
    /// param_1[0x88..0x8b] = 0;
    /// param_1[0x87] = 0;
    /// FUN_141134ba0(param_1 + 0x95);  // reset ProductUserId local
    /// FUN_141133de0(param_1 + 0x95);  // destructeur/free ProductUserId
    /// *param_1 = 0;                   // lobby_iface = NULL
    /// *(undefined1 *)(param_1 + 0x1a) = 0; // initialized = false
    /// ```
    ///
    /// # Différences Rust
    ///
    /// - Les appels `EOS_Lobby_RemoveNotify*` sont signalés via le callback
    ///   `on_remove_notify` (fermeture) plutôt que via FFI directe.
    /// - `FUN_141134ba0` / `FUN_141133de0` (destructeurs ProductUserId) sont
    ///   remplacés par `self.local_user_id = EosProductUserId::NULL`.
    pub fn cleanup<F>(&mut self, mut on_remove_notify: F)
    where
        // Callback simulant EOS_Lobby_RemoveNotify* (3 handles à retirer).
        // EXTERN: EOS_Lobby_RemoveNotifyLobbyUpdateReceived
        // EXTERN: EOS_Lobby_RemoveNotifyLobbyMemberUpdateReceived
        // EXTERN: EOS_Lobby_RemoveNotifyLobbyMemberStatusReceived
        F: FnMut(NotifyHandle),
    {
        // Reproduit : `if (*(char *)(param_1 + 0x1a) != '\0')`
        if self.initialized {
            // Reproduit : handle notify_lobby_update → RemoveNotify + reset
            if self.notify_lobby_update.is_active() {
                // EXTERN: EOS_Lobby_RemoveNotifyLobbyUpdateReceived(*param_1)
                on_remove_notify(self.notify_lobby_update);
                self.notify_lobby_update = NotifyHandle::NULL;
            }

            // Reproduit : handle notify_member_update → RemoveNotify + reset
            if self.notify_member_update.is_active() {
                // EXTERN: EOS_Lobby_RemoveNotifyLobbyMemberUpdateReceived(*param_1)
                on_remove_notify(self.notify_member_update);
                self.notify_member_update = NotifyHandle::NULL;
            }

            // Reproduit : handle notify_member_status → RemoveNotify + reset
            if self.notify_member_status.is_active() {
                // EXTERN: EOS_Lobby_RemoveNotifyLobbyMemberStatusReceived(*param_1)
                on_remove_notify(self.notify_member_status);
                self.notify_member_status = NotifyHandle::NULL;
            }
        }

        // Reproduit : `param_1[0x88..0x8b] = 0`
        self.pending_ops = [0u64; 4];

        // Reproduit : `param_1[0x87] = 0`
        self.pending_ops_aux = 0;

        // Reproduit : `FUN_141134ba0(param_1 + 0x95)` + `FUN_141133de0(param_1 + 0x95)`
        // → reset + destructeur du ProductUserId local
        self.local_user_id = EosProductUserId::NULL;

        // Reproduit : `*param_1 = 0` → lobby_iface = NULL
        self.lobby_iface = EosLobbyHandle::NULL;

        // Reproduit : `*(undefined1 *)(param_1 + 0x1a) = 0`
        self.initialized = false;

        tracing::debug!("lobby EOS nettoyé");
    }

    /// Libère les ressources allouées au lobby.
    ///
    /// Portage fidèle de `FUN_1411431b0` (adresse `0x1411431b0`).
    ///
    /// # Logique C reproduite
    ///
    /// ```c
    /// if (*(longlong *)(param_1 + 0x5c8) != 0) {
    ///     if (*(longlong **)(param_1 + 0x5c0) == NULL) {
    ///         // Allocateur par défaut
    ///         thunk_FUN_1409bae00(*(longlong *)(param_1 + 0x5c8));
    ///     } else {
    ///         // Allocateur custom via vtable[+0x30]
    ///         (**(code **)(**(longlong **)(param_1 + 0x5c0) + 0x30))();
    ///     }
    ///     *(undefined8 *)(param_1 + 0x5c8) = 0;
    ///     *(undefined8 *)(param_1 + 0x5d0) = 0;
    ///     *(undefined8 *)(param_1 + 0x5d8) = 0;
    /// }
    /// FUN_140312c70(param_1 + 0x4a8);  // libère sous-liste 1
    /// FUN_1403133c0(param_1 + 0x3d0);  // libère sous-liste 2
    /// FUN_140313430(param_1 + 0xd8);   // libère sous-liste 3
    /// ```
    ///
    /// # Différences Rust
    ///
    /// - `thunk_FUN_1409bae00` (free globale) → signalé via `on_free_resource`.
    /// - Les 3 appels de cleanup de sous-listes sont modélisés par le vidage
    ///   de `self.active_lobbies` et le reset du `resource_ptr`.
    pub fn free_resources<F>(&mut self, mut on_free_resource: F)
    where
        // Callback simulant `thunk_FUN_1409bae00(ptr)` ou l'appel via vtable.
        // EXTERN: thunk_FUN_1409bae00 (free) ou vtable[+0x30]
        F: FnMut(u64, bool /* has_custom_allocator */),
    {
        // Reproduit : `if (*(longlong *)(param_1 + 0x5c8) != 0)`
        if self.resource_ptr != 0 {
            // Reproduit : dispatch allocateur (défaut vs vtable)
            // EXTERN: thunk_FUN_1409bae00 / vtable[+0x30]
            on_free_resource(self.resource_ptr, self.has_custom_allocator);

            // Reproduit : reset des 3 champs (0x5c8, 0x5d0, 0x5d8)
            self.resource_ptr = 0;
        }

        // Reproduit : `FUN_140312c70(param_1 + 0x4a8)` — libère sous-liste 1
        // `FUN_1403133c0(param_1 + 0x3d0)` — libère sous-liste 2
        // `FUN_140313430(param_1 + 0xd8)` — libère sous-liste 3
        // En Rust, les sous-listes sont dans `active_lobbies` — on les vide.
        self.active_lobbies.clear();

        tracing::debug!("ressources lobby libérées");
    }

    /// Crée un nouveau lobby EOS de façon asynchrone.
    ///
    /// Portage fidèle de `FUN_141148d80` (adresse `0x141148d80`).
    ///
    /// # Logique C reproduite
    ///
    /// ```c
    /// // Récupère le ProductUserId du joueur courant (singleton)
    /// uVar3 = (DAT_14201c570 != 0) ? *(undefined8 *)(DAT_14201c570 + 0x50) : 0;
    ///
    /// // Prépare les options EOS_Lobby_CreateLobby_Options
    /// local_68 = 10;         // ApiVersion = EOS_LOBBY_CREATELOBBY_API_LATEST
    /// uStack_60 = uVar3;     // LocalUserId
    /// local_58 = *(byte *)(param_2 + 0x105); // MaxMembers
    /// uStack_40 = 1;         // bPresenceEnabled
    ///
    /// // Format debug id via FUN_14008d830 (snprintf)
    /// FUN_14008d830(&DAT_1420deb40, "%s:%s:%d", ...);
    /// local_48 = &DAT_1420deb40; // BucketId = chaîne formatée
    ///
    /// // Insertion dans la liste chaînée des lobbys
    /// lVar1 = param_1[0x1c]; // curseur liste
    /// if (lVar1 == param_1[0x1d]) {
    ///     FUN_140316100(param_1 + 0x1a, lVar1, param_2); // grow list
    /// } else {
    ///     if (lVar1 != 0) FUN_140314d20(lVar1, param_2); // in-place set
    ///     param_1[0x1c] += 0x2f8; // avance curseur (stride)
    /// }
    ///
    /// // Alloue l'opération asynchrone
    /// lVar2 = FUN_141145890(param_1);
    /// lVar1 = param_1[0x1c];
    /// *(undefined8 *)(lVar1 + -0x1e8) = uVar3; // owner_id dans l'entrée
    /// *(longlong *)(lVar2 + 8) = lVar1 + -0x2f8; // back-ptr liste
    /// *(undefined8 **)(lVar2 + 0x10) = param_1;  // back-ptr manager
    ///
    /// // Appel EOS asynchrone
    /// EOS_Lobby_CreateLobby(*param_1, &local_68, lVar2, &LAB_141146ce0);
    /// return lVar2;
    /// ```
    ///
    /// # Différences Rust
    ///
    /// - Le `snprintf` de debug id est reproduit via `format!`.
    /// - L'allocation de l'opération async (`FUN_141145890`) devient la
    ///   construction d'un [`AsyncLobbyOp`].
    /// - `EOS_Lobby_CreateLobby` est signalé via `on_create_lobby`.
    ///
    /// # Paramètres
    ///
    /// - `config`: configuration du lobby à créer.
    /// - `on_create_lobby`: callback simulant `EOS_Lobby_CreateLobby`.
    ///   EXTERN: `EOS_Lobby_CreateLobby(iface, opts, ctx, cb)`
    pub fn create<F>(&mut self, config: &LobbyConfig, mut on_create_lobby: F) -> AsyncLobbyOp
    where
        F: FnMut(EosLobbyHandle, &LobbyCreateOptions),
    {
        // Reproduit : récupère le ProductUserId du singleton EOS
        // EXTERN: DAT_14201c570 + 0x50 (singleton global EOS user)
        let local_user_id = if self.local_user_id.is_valid() {
            self.local_user_id
        } else {
            EosProductUserId::NULL
        };

        // Reproduit : options EOS_Lobby_CreateLobby_Options
        // local_68 = 10 (API_LATEST), uStack_60 = uVar3, local_58 = max_members,
        // uStack_40 = 1 (bPresenceEnabled)
        let max_members = config.max_members.min(u8::MAX as u32) as u8;

        // Reproduit : formatage du BucketId debug via FUN_14008d830
        // `FUN_14008d830(&DAT_1420deb40, "%s:%s:%d", &DAT_14180a9a0, &DAT_14180aa24, 0)`
        // RE incertain : les globales DAT_14180a9a0 / DAT_14180aa24 contiennent
        // probablement le nom du jeu et le nom de build.
        let bucket_id = "IEVR:build:0".to_string();

        // Reproduit : insertion dans la liste des lobbys actifs
        // `lVar1 = param_1[0x1c]; if (lVar1 == param_1[0x1d]) { grow } else { stride }`
        let op_idx = self.active_lobbies.len();
        self.active_lobbies.push(ActiveLobby {
            owner_id: local_user_id,
            config: config.clone(),
        });

        // Reproduit : construction de l'opération async (FUN_141145890)
        // `lVar2 = FUN_141145890(param_1)` → handle opération
        // `*(undefined8 *)(lVar1 + -0x1e8) = uVar3` → owner_id dans l'entrée liste
        let op = AsyncLobbyOp {
            op_idx,
            initiator_id: local_user_id,
        };

        // Reproduit : EOS_Lobby_CreateLobby(*param_1, &local_68, lVar2, &LAB_141146ce0)
        // EXTERN: EOS_Lobby_CreateLobby
        let opts = LobbyCreateOptions {
            api_version: EOS_LOBBY_CREATELOBBY_API_LATEST,
            local_user_id,
            max_members,
            presence_enabled: true,
            bucket_id,
        };
        on_create_lobby(self.lobby_iface, &opts);

        tracing::debug!(
            op_idx = op.op_idx,
            max_members,
            "création lobby EOS soumise"
        );

        op
    }

    /// Modifie les propriétés d'un lobby EOS existant.
    ///
    /// Portage fidèle de `FUN_141141660` (adresse `0x141141660`).
    ///
    /// # Logique C reproduite (résumé)
    ///
    /// ```c
    /// // 1. Longueur du lobby_id (chaîne C)
    /// lVar5 = strlen(param_2 + 0x32);
    /// if (lVar5 == 0) goto error_return;
    ///
    /// // 2. Récupère + valide le ProductUserId courant
    /// uVar6 = (DAT_14201c570 != 0) ? *(ulonglong *)(DAT_14201c570 + 0x50) : 0;
    /// if (!EOS_ProductUserId_IsValid(uVar6)) { log("invalid player"); goto error; }
    ///
    /// // 3. Vérifie ownership
    /// if (uVar6 != *(ulonglong *)(param_2 + 0x44)) { log("not owner"); goto error; }
    ///
    /// // 4. Obtient le handle de modification
    /// param_1[0x90..0x93] = {guard_check_icall, 0, 0, 0};
    /// local_180 = 1; local_178 = uVar6; local_170 = param_2 + 0x32;
    /// uVar6 = EOS_Lobby_UpdateLobbyModification(*param_1, &local_180, &local_1a8);
    /// if ((int)uVar6 != 0) goto error_return;
    ///
    /// // 5. Configure la modification
    /// EOS_LobbyModification_SetPermissionLevel(handle, &{1, *param_2});
    /// EOS_LobbyModification_SetBucketId(handle, &{1, bucket_id_ptr});   // si bucket non-nul
    /// EOS_LobbyModification_SetInvitesAllowed(handle, &{1});
    /// EOS_LobbyModification_SetMaxMembers(handle, &{1, max_members});   // si max_members non-nul
    ///
    /// // 6. Attributs custom (stride 0x88)
    /// for (i = 0; i < n_attrs; i++) {
    ///     FUN_14113dc00(n_attrs, handle, attrs_base + i * 0x88);
    /// }
    ///
    /// // 7. Attribut DATA_VERSION (memset 128 + FUN_14113acb0 + FUN_14113dc00)
    /// memset(local_c8, 0, 128);
    /// local_148 = FUN_14113acb0(param_2 + 0x51, 0x14, local_c8);
    /// FUN_14113dc00(result, handle, data_version_attr);
    ///
    /// // 8. Finalise (FUN_141141ba0) + soumet (EOS_Lobby_UpdateLobby)
    /// if (FUN_141141ba0(handle) != 0) {
    ///     EOS_Lobby_UpdateLobby(*param_1, &{1, handle}, param_1, FUN_141140830);
    ///     *(uint *)(param_1 + 0xbd) |= 0x40;  // state_flag UPDATE_IN_PROGRESS
    ///     return 1;
    /// }
    /// return 0;
    /// ```
    ///
    /// # Différences Rust
    ///
    /// - L'obtention du handle de modification (`EOS_Lobby_UpdateLobbyModification`)
    ///   et les appels `EOS_LobbyModification_Set*` sont délégués via `on_modify`.
    /// - `FUN_14113dc00` (ajout attribut au handle) et `FUN_141141ba0` (finalisation)
    ///   sont signalés comme EXTERN.
    /// - La protection `_guard_check_icall` (Microsoft CFG) est omise.
    /// - Le compteur de référence (`LOCK/UNLOCK` sur `local_160`) est un artefact
    ///   du runtime C++ — non porté (les lifetimes Rust gèrent cela).
    ///
    /// # Erreurs
    ///
    /// Voir [`LobbyError`].
    pub fn modify<F>(
        &mut self,
        config: &LobbyConfig,
        // Callback simulant EOS_Lobby_UpdateLobbyModification + Set* + UpdateLobby.
        // EXTERN: `EOS_Lobby_UpdateLobbyModification(*lobby_iface, opts, &out_handle)`
        // EXTERN: `EOS_LobbyModification_SetPermissionLevel(handle, opts)`
        // EXTERN: `EOS_LobbyModification_SetBucketId(handle, opts)`
        // EXTERN: `EOS_LobbyModification_SetInvitesAllowed(handle, opts)`
        // EXTERN: `EOS_LobbyModification_SetMaxMembers(handle, opts)`
        // EXTERN: `FUN_14113dc00(n_attrs, handle, attr_ptr)` (ajout attribut)
        // EXTERN: `FUN_141141ba0(handle)` (finalisation membre)
        // EXTERN: `EOS_Lobby_UpdateLobby(*lobby_iface, opts, ctx, cb)`
        mut on_modify: F,
    ) -> LobbyResult<bool>
    where
        F: FnMut(EosLobbyHandle, &LobbyModifyOptions) -> ModifyResult,
    {
        // Reproduit : `lVar5 = strlen(param_2 + 0x32); if (lVar5 == 0) goto LAB_1411416e6`
        let lobby_id = config.lobby_id.as_deref().unwrap_or("");
        if lobby_id.is_empty() {
            return Err(LobbyError::EmptyLobbyId);
        }

        // Reproduit : `uVar6 = DAT_14201c570 ? *(DAT_14201c570 + 0x50) : 0`
        // EXTERN: DAT_14201c570 (singleton EOS user)
        let current_user = self.local_user_id;

        // Reproduit : `EOS_ProductUserId_IsValid(uVar6)`
        // EXTERN: EOS_ProductUserId_IsValid
        if !current_user.is_valid() {
            tracing::error!("[*** Error] ModifyLobby: Current player is invalid!");
            return Err(LobbyError::InvalidPlayer);
        }

        // Reproduit : `if (uVar6 != *(ulonglong *)(param_2 + 0x44))`
        if current_user != config.owner_id {
            tracing::error!("[*** Error] ModifyLobby: Only owner can modify lobby.");
            return Err(LobbyError::NotOwner);
        }

        // Reproduit : préparation des options pour EOS_Lobby_UpdateLobbyModification
        // `param_1[0x90] = _guard_check_icall; param_1[0x91..0x93] = 0`
        // (CFG guard — omis en Rust)
        // `local_180 = 1 (version), local_178 = uVar6 (user_id), local_170 = lobby_id`

        let opts = LobbyModifyOptions {
            lobby_id: lobby_id.to_owned(),
            local_user_id: current_user,
            permission: config.permission,
            max_members: config.max_members,
            bucket_id: if config.bucket_id_raw != 0 {
                Some(format!("{:08x}", config.bucket_id_raw))
            } else {
                None
            },
            invites_allowed: true, // reproduit : `local_198 = 1` (toujours activé)
            attributes: config.attributes.clone(),
            // data_version : voir note FUN_14113acb0 — offset param_2+0x51, longueur 0x14
            // RE incertain : contenu exact de la version data (chemin build? checksum?)
            data_version: format!("{:020}", 0u64), // buffer 128 octets, 20 hex chars
        };

        // EXTERN: EOS_Lobby_UpdateLobbyModification + Set* + FUN_14113dc00 + FUN_141141ba0
        // + EOS_Lobby_UpdateLobby via on_modify
        let result = on_modify(self.lobby_iface, &opts);

        match result {
            ModifyResult::Success => {
                // Reproduit : `*(uint *)(param_1 + 0xbd) |= 0x40`
                self.state_flags |= STATE_FLAG_UPDATE_IN_PROGRESS;
                tracing::debug!(lobby_id, "ModifyLobby soumis avec succès");
                Ok(true)
            }
            ModifyResult::EosFailure(code) => {
                // Reproduit : `goto LAB_141141a2c` → retour 0
                tracing::warn!(code, "ModifyLobby: opération EOS échouée");
                Err(LobbyError::EosError(code))
            }
            ModifyResult::AttributeError => {
                // Reproduit : `goto LAB_141141a2c` depuis FUN_14113dc00 retournant '\0'
                tracing::warn!("ModifyLobby: erreur lors de l'ajout d'attribut");
                Ok(false)
            }
        }
    }
}

// ── types d'options passés aux callbacks EOS ──────────────────────────────

/// Options transmises à `EOS_Lobby_CreateLobby`.
///
/// Source: `network_lobby_create.c` — structure locale `local_68..uStack_10`.
#[derive(Debug, Clone)]
pub struct LobbyCreateOptions {
    /// Version API (`EOS_LOBBY_CREATELOBBY_API_LATEST = 10`).
    ///
    /// Source: `network_lobby_create.c` — `local_68 = 10`.
    pub api_version: u64,

    /// Identifiant produit EOS du joueur local.
    ///
    /// Source: `network_lobby_create.c` — `uStack_60 = uVar3`.
    pub local_user_id: EosProductUserId,

    /// Nombre max de membres.
    ///
    /// Source: `network_lobby_create.c` — `local_58 = (uint)*(byte *)(param_2 + 0x105)`.
    pub max_members: u8,

    /// Présence EOS activée.
    ///
    /// Source: `network_lobby_create.c` — `uStack_40 = 1`.
    pub presence_enabled: bool,

    /// Identifiant bucket (chaîne formatée).
    ///
    /// Source: `network_lobby_create.c` — `local_48 = &DAT_1420deb40`
    /// (résultat de `FUN_14008d830`).
    pub bucket_id: String,
}

/// Options transmises aux callbacks EOS de modification de lobby.
///
/// Source: `network_lobby_modify.c` — champs `local_180`, `local_1a0`, `local_198`…
#[derive(Debug, Clone)]
pub struct LobbyModifyOptions {
    /// Identifiant du lobby à modifier.
    ///
    /// Source: `network_lobby_modify.c` — `local_170 = param_2 + 0x32`.
    pub lobby_id: String,

    /// Joueur effectuant la modification (doit être le propriétaire).
    ///
    /// Source: `network_lobby_modify.c` — `local_178 = uVar6`.
    pub local_user_id: EosProductUserId,

    /// Niveau de permission à appliquer.
    ///
    /// Source: `network_lobby_modify.c` — `local_1a0 = 1; local_19c = *param_2`.
    pub permission: LobbyPermission,

    /// Nombre maximum de membres (0 = non modifié).
    ///
    /// Source: `network_lobby_modify.c` — `*(byte *)(param_2 + 0x105)`.
    pub max_members: u32,

    /// Bucket ID EOS optionnel (présent seulement si `*(longlong *)(param_2 + 0xc) != 0`).
    ///
    /// Source: `network_lobby_modify.c` — bloc `SetBucketId`.
    pub bucket_id: Option<String>,

    /// Invitations activées (toujours `true` dans nie.exe).
    ///
    /// Source: `network_lobby_modify.c` — `local_198 = 1` (SetInvitesAllowed).
    pub invites_allowed: bool,

    /// Attributs personnalisés à appliquer.
    ///
    /// Source: `network_lobby_modify.c` — boucle stride `0x88`.
    pub attributes: Vec<LobbyAttribute>,

    /// Version de données (attribut `DATA_VERSION`).
    ///
    /// Source: `network_lobby_modify.c` — `FUN_14113acb0(param_2 + 0x51, 0x14, local_c8)`.
    /// RE incertain : format exact de la chaîne DATA_VERSION.
    pub data_version: String,
}

/// Résultat retourné par le callback `on_modify` de [`LobbyManager::modify`].
#[derive(Debug)]
pub enum ModifyResult {
    /// Toutes les opérations EOS ont réussi et `EOS_Lobby_UpdateLobby` a été soumis.
    ///
    /// Source: `network_lobby_modify.c` — branche finale `uVar6 = 1`.
    Success,

    /// Une opération EOS a retourné une erreur (code non-nul).
    ///
    /// Source: `network_lobby_modify.c` — `if ((int)uVar6 != 0) goto LAB_1411416e6`.
    EosFailure(i32),

    /// Erreur lors de l'ajout d'un attribut (`FUN_14113dc00` retourne `'\0'`).
    ///
    /// Source: `network_lobby_modify.c` — `if (cVar3 == '\0') goto LAB_141141a2c`.
    AttributeError,
}

// ── pont Lua réseau ────────────────────────────────────────────────────────

/// Contexte d'initialisation du pont Lua réseau.
///
/// Porté de `network_lua_command.c` (`FUN_141088380`, adresse `0x141088380`).
/// Utilisé pour le pattern d'enregistrement lazy thread-safe reproduit.
#[derive(Debug, Default)]
pub struct LuaNetworkBridge {
    /// Drapeau d'initialisation de la table de commandes (lazy, une seule fois).
    ///
    /// Source: `network_lua_command.c` — `DAT_141f97fc9` (byte global, `'\0'` = non init).
    pub command_table_initialized: bool,

    /// Drapeau d'initialisation TLS de la commande principale (lazy thread-safe).
    ///
    /// Source: `network_lua_command.c` — `DAT_14213d610` (int TLS, `-1` = initialisé).
    /// RE incertain : mécanisme exact `_Init_thread_footer` (Windows TLS init C++ 11).
    pub tls_init_done: bool,

    /// Pointeur vers le handler Lua réseau principal.
    ///
    /// Source: `network_lua_command.c` — `DAT_1420dd2b8 = FUN_141088280`.
    /// EXTERN: `FUN_141088280` — handler réseau Lua (non porté, hors scope).
    pub handler_fn_ptr: u64,

    /// Nom Lua de la commande réseau.
    ///
    /// Source: `network_lua_command.c` — `DAT_1420dd2c0 = "funcLuaMenuNetworkCommand"`.
    pub command_name: &'static str,
}

impl LuaNetworkBridge {
    /// Crée un nouveau bridge Lua réseau non initialisé.
    #[must_use]
    pub fn new() -> Self {
        Self {
            command_table_initialized: false,
            tls_init_done: false,
            handler_fn_ptr: 0,
            command_name: LUA_NETWORK_COMMAND_NAME,
        }
    }

    /// Enregistre la commande Lua réseau dans le runtime Lua du jeu.
    ///
    /// Portage fidèle de `FUN_141088380` (adresse `0x141088380`).
    ///
    /// # Logique C reproduite
    ///
    /// ```c
    /// // Phase 1 : initialisation de la table de commandes (une seule fois)
    /// if (DAT_141f97fc9 == '\0') {
    ///     DAT_141f97fc9 = '\x01';
    ///     FUN_140c35080(&DAT_14203fcc0, &PTR_FUN_141a657a0, 0x27); // registre 0x27 cmds
    /// }
    ///
    /// // Phase 2 : init TLS lazy thread-safe pour le handler principal
    /// if (*(int *)(*(longlong *)ThreadLocalStoragePointer + 4) < DAT_14213d610) {
    ///     FUN_140984bdc(&DAT_14213d610); // acquiert le verrou TLS
    ///     if (DAT_14213d610 == -1) {
    ///         DAT_1420dd2b8 = FUN_141088280;          // handler fn ptr
    ///         DAT_1420dd2c0 = "funcLuaMenuNetworkCommand"; // nom commande
    ///         _Init_thread_footer(&DAT_14213d610);    // finalise init TLS
    ///     }
    /// }
    ///
    /// // Phase 3 : lie le handler et nomme la commande dans le contexte Lua
    /// FUN_1405992e0(param_1, DAT_1420dd2b8, 0); // lua_pushcfunction
    /// FUN_1405999b0(param_1, DAT_1420dd2c0);    // lua_setglobal
    /// ```
    ///
    /// # Correspondances Lua
    ///
    /// - `FUN_1405992e0` ≈ `lua_pushcfunction(L, fn, debug_name)`.
    /// - `FUN_1405999b0` ≈ `lua_setglobal(L, name)`.
    /// - `FUN_140c35080` ≈ enregistrement de la table de dispatch (0x27 = 39 entrées).
    ///
    /// # Paramètres
    ///
    /// - `lua_context`: handle opaque vers le contexte Lua (type de l'appelant).
    ///   Substitue `param_1` (le `undefined8` passé à `FUN_141088380`).
    /// - `on_register_table`: callback simulant `FUN_140c35080` (enregistrement table).
    ///   EXTERN: `FUN_140c35080(&table_base, &fn_table, 0x27)`
    /// - `on_push_fn`: callback simulant `FUN_1405992e0` (lua_pushcfunction).
    ///   EXTERN: `FUN_1405992e0(lua_ctx, handler_ptr, 0)`
    /// - `on_set_global`: callback simulant `FUN_1405999b0` (lua_setglobal).
    ///   EXTERN: `FUN_1405999b0(lua_ctx, cmd_name)`
    /// - `network_handler_ptr`: adresse du handler `FUN_141088280`.
    ///   EXTERN: `FUN_141088280` (handler réseau Lua, non porté)
    pub fn register<FT, FP, FG>(
        &mut self,
        lua_context: u64,
        network_handler_ptr: u64,
        mut on_register_table: FT,
        mut on_push_fn: FP,
        mut on_set_global: FG,
    ) where
        // EXTERN: FUN_140c35080 — enregistre la table de 0x27 commandes réseau
        FT: FnMut(u64 /* table_base */, u32 /* count */),
        // EXTERN: FUN_1405992e0 — lua_pushcfunction
        FP: FnMut(u64 /* lua_ctx */, u64 /* fn_ptr */, i32 /* debug=0 */),
        // EXTERN: FUN_1405999b0 — lua_setglobal
        FG: FnMut(u64 /* lua_ctx */, &str /* name */),
    {
        // Reproduit : `if (DAT_141f97fc9 == '\0') { ... FUN_140c35080(..., 0x27) }`
        // Init de la table de dispatch une seule fois (flag global).
        if !self.command_table_initialized {
            self.command_table_initialized = true;
            // EXTERN: FUN_140c35080(&DAT_14203fcc0, &PTR_FUN_141a657a0, 0x27)
            // DAT_14203fcc0 = base de la table de commandes réseau
            on_register_table(0x14203fcc0_u64, LUA_NETWORK_COMMAND_COUNT);
        }

        // Reproduit : pattern d'init TLS lazy (if TLS < global → acquiert verrou)
        // `if (*(int *)(*(longlong *)ThreadLocalStoragePointer + 4) < DAT_14213d610)`
        // En Rust, on reproduit l'effet : si non initialisé, stocker le handler.
        if !self.tls_init_done {
            // Reproduit : `FUN_140984bdc(&DAT_14213d610)` — acquiert verrou TLS
            // Reproduit : `if (DAT_14213d610 == -1)` — premier thread à init
            // Reproduit : `DAT_1420dd2b8 = FUN_141088280`
            self.handler_fn_ptr = network_handler_ptr;
            // Reproduit : `DAT_1420dd2c0 = "funcLuaMenuNetworkCommand"`
            self.command_name = LUA_NETWORK_COMMAND_NAME;
            // Reproduit : `_Init_thread_footer(&DAT_14213d610)` — finalise init TLS
            self.tls_init_done = true;
        }

        // Reproduit : `FUN_1405992e0(param_1, DAT_1420dd2b8, 0)` — lua_pushcfunction
        // EXTERN: FUN_1405992e0
        on_push_fn(lua_context, self.handler_fn_ptr, 0);

        // Reproduit : `FUN_1405999b0(param_1, DAT_1420dd2c0)` — lua_setglobal
        // EXTERN: FUN_1405999b0
        on_set_global(lua_context, self.command_name);

        tracing::debug!(
            command = self.command_name,
            handler_ptr = self.handler_fn_ptr,
            "commande Lua réseau enregistrée"
        );
    }
}

// ── tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_config() -> LobbyConfig {
        LobbyConfig {
            local_user_id: EosProductUserId(1),
            max_members: 4,
            lobby_type: 1,
            bucket_id_raw: 0xDEAD,
            lobby_id: Some("lobby-test-001".to_owned()),
            owner_id: EosProductUserId(1),
            permission: LobbyPermission::JoinViaPresence,
            attributes: vec![
                LobbyAttribute {
                    key: "map".to_owned(),
                    value: "stadium_a".to_owned(),
                },
            ],
        }
    }

    // ── init ──────────────────────────────────────────────────────────────

    #[test]
    fn init_ok() {
        let mut mgr = LobbyManager::new();
        let cfg = valid_config();
        let iface = EosLobbyHandle(0xABCD);
        let notifs = (NotifyHandle(1), NotifyHandle(2), NotifyHandle(3));

        assert!(mgr.init(&cfg, iface, notifs).is_ok());

        assert!(mgr.initialized);
        assert_eq!(mgr.lobby_iface, EosLobbyHandle(0xABCD));
        assert_eq!(mgr.api_version_flag, 8);
        assert_eq!(mgr.lobby_type, 1);
        assert_eq!(mgr.max_members_raw, 4);
        assert_eq!(mgr.bucket_id_raw, 0xDEAD);
        assert_eq!(mgr.pending_ops, [0u64; 4]);
        assert_eq!(mgr.pending_ops_aux, 0);
        assert_eq!(mgr.notify_lobby_update, NotifyHandle(1));
        assert_eq!(mgr.notify_member_update, NotifyHandle(2));
        assert_eq!(mgr.notify_member_status, NotifyHandle(3));
    }

    #[test]
    fn init_already_initialized_returns_error() {
        let mut mgr = LobbyManager::new();
        let cfg = valid_config();
        let iface = EosLobbyHandle(1);
        let notifs = (NotifyHandle(1), NotifyHandle(2), NotifyHandle(3));
        mgr.init(&cfg, iface, notifs).unwrap();

        // Deuxième appel doit retourner AlreadyInitialized
        let err = mgr
            .init(&cfg, EosLobbyHandle(2), (NotifyHandle(0), NotifyHandle(0), NotifyHandle(0)))
            .unwrap_err();
        assert!(matches!(err, LobbyError::AlreadyInitialized));
    }

    #[test]
    fn init_invalid_config_null_user() {
        let mut mgr = LobbyManager::new();
        let mut cfg = valid_config();
        cfg.local_user_id = EosProductUserId::NULL; // user nul

        let err = mgr
            .init(
                &cfg,
                EosLobbyHandle(1),
                (NotifyHandle(0), NotifyHandle(0), NotifyHandle(0)),
            )
            .unwrap_err();
        assert!(matches!(err, LobbyError::InvalidConfig));
        // Fidèle au C : `*(param_1 + 0x1a) = 1` est positionné AVANT le test de
        // config ; même si la config est invalide, le flag initialized est déjà à 1.
        // Source: network_lobby_init.c ligne 33 — assignation inconditionnelle.
        assert!(mgr.initialized);
    }

    #[test]
    fn init_invalid_config_zero_type() {
        let mut mgr = LobbyManager::new();
        let mut cfg = valid_config();
        cfg.lobby_type = 0; // type nul

        let err = mgr
            .init(
                &cfg,
                EosLobbyHandle(1),
                (NotifyHandle(0), NotifyHandle(0), NotifyHandle(0)),
            )
            .unwrap_err();
        assert!(matches!(err, LobbyError::InvalidConfig));
    }

    #[test]
    fn init_null_eos_iface() {
        let mut mgr = LobbyManager::new();
        let cfg = valid_config();

        let err = mgr
            .init(
                &cfg,
                EosLobbyHandle::NULL, // handle nul
                (NotifyHandle(0), NotifyHandle(0), NotifyHandle(0)),
            )
            .unwrap_err();
        assert!(matches!(err, LobbyError::EosLobbyInterfaceNull));
    }

    // ── cleanup ───────────────────────────────────────────────────────────

    #[test]
    fn cleanup_removes_all_notifications() {
        let mut mgr = LobbyManager::new();
        let cfg = valid_config();
        mgr.init(
            &cfg,
            EosLobbyHandle(1),
            (NotifyHandle(10), NotifyHandle(20), NotifyHandle(30)),
        )
        .unwrap();

        let mut removed = vec![];
        mgr.cleanup(|h| removed.push(h.0));

        assert_eq!(removed, vec![10u64, 20, 30]);
        assert!(!mgr.initialized);
        assert_eq!(mgr.lobby_iface, EosLobbyHandle::NULL);
        assert_eq!(mgr.local_user_id, EosProductUserId::NULL);
        assert_eq!(mgr.pending_ops, [0u64; 4]);
        assert_eq!(mgr.pending_ops_aux, 0);
        assert_eq!(mgr.notify_lobby_update, NotifyHandle::NULL);
        assert_eq!(mgr.notify_member_update, NotifyHandle::NULL);
        assert_eq!(mgr.notify_member_status, NotifyHandle::NULL);
    }

    #[test]
    fn cleanup_skips_null_notifications() {
        let mut mgr = LobbyManager::new();
        let cfg = valid_config();
        // Seule la 2ème notification est active
        mgr.init(
            &cfg,
            EosLobbyHandle(1),
            (NotifyHandle::NULL, NotifyHandle(20), NotifyHandle::NULL),
        )
        .unwrap();

        let mut removed = vec![];
        mgr.cleanup(|h| removed.push(h.0));

        // Seul le handle 20 doit être retiré
        assert_eq!(removed, vec![20u64]);
    }

    #[test]
    fn cleanup_when_not_initialized_does_not_remove_notifs() {
        let mut mgr = LobbyManager::new();
        // Injection manuelle de handles (sans passer par init)
        mgr.notify_lobby_update = NotifyHandle(99);

        let mut removed = vec![];
        mgr.cleanup(|h| removed.push(h.0));

        // initialized était false → pas de RemoveNotify
        assert!(removed.is_empty());
    }

    // ── free_resources ────────────────────────────────────────────────────

    #[test]
    fn free_resources_calls_free_when_ptr_set() {
        let mut mgr = LobbyManager::new();
        mgr.resource_ptr = 0xDEAD_BEEF;
        mgr.active_lobbies.push(ActiveLobby::default());

        let mut freed = vec![];
        mgr.free_resources(|ptr, custom| freed.push((ptr, custom)));

        assert_eq!(freed, vec![(0xDEAD_BEEF_u64, false)]);
        assert_eq!(mgr.resource_ptr, 0);
        assert!(mgr.active_lobbies.is_empty());
    }

    #[test]
    fn free_resources_skips_free_when_ptr_null() {
        let mut mgr = LobbyManager::new();
        mgr.resource_ptr = 0;

        let mut freed = vec![];
        mgr.free_resources(|ptr, custom| freed.push((ptr, custom)));

        assert!(freed.is_empty());
    }

    // ── create ────────────────────────────────────────────────────────────

    #[test]
    fn create_returns_async_op_and_calls_eos() {
        let mut mgr = LobbyManager::new();
        mgr.local_user_id = EosProductUserId(42);
        mgr.lobby_iface = EosLobbyHandle(0xBEEF);
        let cfg = valid_config();

        let mut received_opts: Option<LobbyCreateOptions> = None;
        let op = mgr.create(&cfg, |_iface, opts| {
            received_opts = Some(opts.clone());
        });

        assert_eq!(op.op_idx, 0);
        assert_eq!(op.initiator_id, EosProductUserId(42));
        assert_eq!(mgr.active_lobbies.len(), 1);

        let opts = received_opts.unwrap();
        assert_eq!(opts.api_version, EOS_LOBBY_CREATELOBBY_API_LATEST);
        assert_eq!(opts.max_members, 4);
        assert!(opts.presence_enabled);
    }

    #[test]
    fn create_increments_op_idx_on_multiple_calls() {
        let mut mgr = LobbyManager::new();
        mgr.local_user_id = EosProductUserId(1);
        let cfg = valid_config();

        let op0 = mgr.create(&cfg, |_, _| {});
        let op1 = mgr.create(&cfg, |_, _| {});
        assert_eq!(op0.op_idx, 0);
        assert_eq!(op1.op_idx, 1);
        assert_eq!(mgr.active_lobbies.len(), 2);
    }

    // ── modify ────────────────────────────────────────────────────────────

    #[test]
    fn modify_success_sets_state_flag() {
        let mut mgr = LobbyManager::new();
        mgr.local_user_id = EosProductUserId(1);
        mgr.lobby_iface = EosLobbyHandle(1);
        let cfg = valid_config(); // owner_id == local_user_id == 1

        let ok = mgr
            .modify(&cfg, |_, _| ModifyResult::Success)
            .unwrap();

        assert!(ok);
        assert_ne!(mgr.state_flags & STATE_FLAG_UPDATE_IN_PROGRESS, 0);
    }

    #[test]
    fn modify_error_empty_lobby_id() {
        let mut mgr = LobbyManager::new();
        mgr.local_user_id = EosProductUserId(1);
        let mut cfg = valid_config();
        cfg.lobby_id = Some(String::new());

        let err = mgr.modify(&cfg, |_, _| ModifyResult::Success).unwrap_err();
        assert!(matches!(err, LobbyError::EmptyLobbyId));
    }

    #[test]
    fn modify_error_no_lobby_id() {
        let mut mgr = LobbyManager::new();
        mgr.local_user_id = EosProductUserId(1);
        let mut cfg = valid_config();
        cfg.lobby_id = None;

        let err = mgr.modify(&cfg, |_, _| ModifyResult::Success).unwrap_err();
        assert!(matches!(err, LobbyError::EmptyLobbyId));
    }

    #[test]
    fn modify_error_invalid_player() {
        let mut mgr = LobbyManager::new();
        mgr.local_user_id = EosProductUserId::NULL; // joueur non connecté
        let cfg = valid_config();

        let err = mgr.modify(&cfg, |_, _| ModifyResult::Success).unwrap_err();
        assert!(matches!(err, LobbyError::InvalidPlayer));
    }

    #[test]
    fn modify_error_not_owner() {
        let mut mgr = LobbyManager::new();
        mgr.local_user_id = EosProductUserId(99); // différent de owner_id=1
        let cfg = valid_config(); // owner_id = 1

        let err = mgr.modify(&cfg, |_, _| ModifyResult::Success).unwrap_err();
        assert!(matches!(err, LobbyError::NotOwner));
    }

    #[test]
    fn modify_eos_failure_propagates() {
        let mut mgr = LobbyManager::new();
        mgr.local_user_id = EosProductUserId(1);
        let cfg = valid_config();

        let err = mgr
            .modify(&cfg, |_, _| ModifyResult::EosFailure(-42))
            .unwrap_err();
        assert!(matches!(err, LobbyError::EosError(-42)));
    }

    #[test]
    fn modify_attribute_error_returns_false() {
        let mut mgr = LobbyManager::new();
        mgr.local_user_id = EosProductUserId(1);
        let cfg = valid_config();

        let ok = mgr
            .modify(&cfg, |_, _| ModifyResult::AttributeError)
            .unwrap();
        assert!(!ok);
    }

    // ── Lua bridge ────────────────────────────────────────────────────────

    #[test]
    fn lua_bridge_registers_command() {
        let mut bridge = LuaNetworkBridge::new();
        let handler_ptr = 0x141088280_u64;
        let lua_ctx = 0xCAFE_u64;

        let mut table_calls: Vec<(u64, u32)> = vec![];
        let mut push_calls: Vec<(u64, u64, i32)> = vec![];
        let mut global_calls: Vec<(u64, String)> = vec![];

        bridge.register(
            lua_ctx,
            handler_ptr,
            |base, count| table_calls.push((base, count)),
            |ctx, ptr, dbg| push_calls.push((ctx, ptr, dbg)),
            |ctx, name| global_calls.push((ctx, name.to_owned())),
        );

        // Table initialisée une seule fois
        assert_eq!(table_calls.len(), 1);
        assert_eq!(table_calls[0].1, LUA_NETWORK_COMMAND_COUNT);

        // lua_pushcfunction appelé avec le handler
        assert_eq!(push_calls.len(), 1);
        assert_eq!(push_calls[0].0, lua_ctx);
        assert_eq!(push_calls[0].1, handler_ptr);
        assert_eq!(push_calls[0].2, 0);

        // lua_setglobal appelé avec le bon nom
        assert_eq!(global_calls.len(), 1);
        assert_eq!(global_calls[0].1, LUA_NETWORK_COMMAND_NAME);

        assert!(bridge.tls_init_done);
        assert!(bridge.command_table_initialized);
    }

    #[test]
    fn lua_bridge_table_init_only_once() {
        let mut bridge = LuaNetworkBridge::new();
        let mut table_calls = 0u32;

        // Premier appel
        bridge.register(
            1,
            0xDEAD,
            |_, _| table_calls += 1,
            |_, _, _| {},
            |_, _| {},
        );

        // Deuxième appel : la table ne doit PAS être re-initialisée
        bridge.register(
            1,
            0xDEAD,
            |_, _| table_calls += 1,
            |_, _, _| {},
            |_, _| {},
        );

        assert_eq!(table_calls, 1, "FUN_140c35080 doit être appelé une seule fois");
    }

    #[test]
    fn eos_product_user_id_valid() {
        assert!(!EosProductUserId::NULL.is_valid());
        assert!(EosProductUserId(1).is_valid());
    }

    #[test]
    fn eos_lobby_handle_valid() {
        assert!(!EosLobbyHandle::NULL.is_valid());
        assert!(EosLobbyHandle(0xFFFF).is_valid());
    }

    #[test]
    fn notify_handle_active() {
        assert!(!NotifyHandle::NULL.is_active());
        assert!(NotifyHandle(42).is_active());
    }

    #[test]
    fn lobby_create_options_api_version_constant() {
        // Vérifie que la constante API_LATEST = 10 (binaire nie.exe)
        assert_eq!(EOS_LOBBY_CREATELOBBY_API_LATEST, 10);
    }

    #[test]
    fn lobby_attr_stride_constant() {
        // Vérifie le stride 0x88 octets (boucle ModifyLobby)
        assert_eq!(LOBBY_ATTR_STRIDE, 0x88);
    }

    #[test]
    fn state_flag_update_in_progress_bit() {
        // Vérifie que le flag 0x40 est un bit isolé
        assert_eq!(STATE_FLAG_UPDATE_IN_PROGRESS, 0x40);
        assert_eq!(STATE_FLAG_UPDATE_IN_PROGRESS.count_ones(), 1);
    }
}
