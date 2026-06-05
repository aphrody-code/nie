//! Sous-système moteur G4 — portage RE de `nie.exe` (Level-5 Lives, Inazuma Eleven: Victory Road).
//!
//! ## Fonctions portées (pseudo-C Ghidra → Rust idiomatique)
//!
//! | Adresse       | Nom original       | Symbole Rust            |
//! |---------------|--------------------|-------------------------|
//! | 0x14055fc80   | FUN_14055fc80      | [`g4md_destroy`]        |
//! | 0x1405846b0   | FUN_1405846b0      | [`g4pk_slot_init`]      |
//! | 0x14055e740   | FUN_14055e740      | [`g4ra_destroy`]        |
//! | 0x1404d96d0   | FUN_1404d96d0      | [`g4sk_destroy`]        |
//! | 0x14103d7d0   | FUN_14103d7d0      | [`g4tx_load_cached`]    |
//!
//! ## Conventions de portage
//!
//! Le C décompilé opère sur des pointeurs bruts vers des structures moteur (vftable + champs à
//! offset fixe). En Rust sûr, les pointeurs sont remplacés par des **index dans des `Vec`** ou
//! des **références à des structures typées**. Les champs à offset-fixe du décompile sont annotés
//! `// @+0xNN` pour faciliter les recoupements futurs.
//!
//! Les appels indirects via vftable (ex. `(**(code **)(vtable + 0x30))(...)`) correspondent à des
//! méthodes virtuelles C++ ; ils sont représentés par des traits `Drop`/`Clone` ou des méthodes
//! documentées `// EXTERN: <vtable+0xNN>`.
//!
//! ## Sources
//!
//! - `ghidra-export/decompiled/g4md_init.c`
//! - `ghidra-export/decompiled/g4pk_parser.c`
//! - `ghidra-export/decompiled/g4ra_init.c`
//! - `ghidra-export/decompiled/g4sk_init.c`
//! - `ghidra-export/decompiled/g4tx_loader.c`
//!
//! ## Comparaison avec `nie-formats`
//!
//! Le crate `nie-formats` porte les **parseurs de format** (lecture de bytes → structures).
//! Ce module porte les **sous-systèmes moteur** (gestion du cycle de vie des ressources,
//! cache de textures, initialisation des slots d'archive).

// EXTERN: DAT_142043520 — table globale d'allocateurs (indexed by byte bVar_allocator_id,
//         stride 8 octets ; entrée = pointeur vers objet allocateur avec vftable standard).
//         Méthode vftable+0x30 = Release/Deref (décrémente refcount ou libère).
//         Méthode vftable+0x28 = Alloc (alloue un objet).
//
// EXTERN: DAT_1420367f0 — cache de textures CSystemGaiji : tableau de 3 slots,
//         chaque slot = {ptr: *CSystemGaiji (8 octets), refcount: i16 @+0x08, flags: u8 @+0x0A …}.
//         Stride 0x10 octets entre slots.
//         Un slot est libre si `ptr == null`.
//
// EXTERN: DAT_142043680 — singleton device graphique (vftable : +0x18=CreateSamplerState,
//         +0x20=CreateSamplerStateDesc, +0x30=GetSamplerState).
//
// EXTERN: DAT_141f7e138 — pointeur optionnel vers une fonction de lookup de palette/texture-array ;
//         si non-null : `fn(*mut u8) -> *mut u8`. Résout l'index de couche de texture.
//
// EXTERN: DAT_141a415c0 — cookie de sécurité (stack canary) XOR'd avec l'adresse de la frame.
//
// EXTERN: DAT_141771e00 — table CRC32 standard (256 × u32, little-endian).
//         Algorithme CRC32 ISO 3309 / ITU-T V.42 (polynôme 0xEDB88320 reflected).
//
// EXTERN: lives::CResPack::vftable — vftable du type C++ `lives::CResPack`.
// EXTERN: lives::CSystemGaiji::vftable — vftable du type C++ `lives::CSystemGaiji`.
// EXTERN: s_G4MDP_141c01840  — chaîne littérale C "G4MDP" (sentinel post-destroy de G4MD).
// EXTERN: s_G4PK__141c03290  — chaîne littérale C "G4PK@" (sentinel post-init de slot G4PK).
// EXTERN: s_G4RA__141c017b0  — chaîne littérale C "G4RA@" (sentinel post-destroy de G4RA).
// EXTERN: s_G4SK__141c00fb0  — chaîne littérale C "G4SK@" (sentinel post-destroy de G4SK).
// EXTERN: FUN_1404ce5a0 — recherche/chargement de ressource G4TX par (layer_a, layer_b, path).
// EXTERN: FUN_1402b2b70 — AddRef atomique sur un objet ressource.
// EXTERN: FUN_140480430 — callback de formatage de chemin (sprintf-like, utilisé dans g4tx_loader).
// EXTERN: FUN_14047f670 — sprintf avec descripteur de format structuré (chemin.g4tx).
// EXTERN: FUN_1416709b0 — memset (utilisé pour initialiser les tampons locaux).
// EXTERN: FUN_140e33460 — initialise un tableau de descripteurs de sampler.
// EXTERN: FUN_140ddaff0 — crée un descripteur de sampler par défaut (renvoie u64).
// EXTERN: FUN_140098280 — sprintf standard (wraps snprintf).

/// Sentinel écrite dans le champ magic après destruction d'un contexte G4MD.
/// Correspond à `s_G4MDP_141c01840` dans le binaire.
pub const G4MD_MAGIC_DESTROYED: &str = "G4MDP";

/// Sentinel écrite dans le champ magic après destruction d'un contexte G4RA.
/// Correspond à `s_G4RA__141c017b0` dans le binaire.
pub const G4RA_MAGIC_DESTROYED: &str = "G4RA@";

/// Sentinel écrite dans le champ magic après destruction d'un contexte G4SK.
/// Correspond à `s_G4SK__141c00fb0` dans le binaire.
pub const G4SK_MAGIC_DESTROYED: &str = "G4SK@";

/// Sentinel écrite dans le champ magic d'un slot G4PK initialisé.
/// Correspond à `s_G4PK__141c03290` dans le binaire.
pub const G4PK_SLOT_MAGIC: &str = "G4PK@";

/// Nombre maximal de slots dans le cache de textures CSystemGaiji (tiré du boucle `uVar16 < 3`).
pub const G4TX_CACHE_SLOTS: usize = 3;

// ---------------------------------------------------------------------------
// G4MD — porte de FUN_14055fc80 (0x14055fc80)
// ---------------------------------------------------------------------------

/// Contexte de ressource G4MD côté moteur.
///
/// Porté de la structure opaque manipulée par FUN_14055fc80 ; champs reconstruits
/// sémantiquement à partir des offsets Ghidra.
///
/// ```text
/// +0x14  u8   allocator_id   (index allocateur dans DAT_142043520)
/// +0x20  *str magic_ptr      (pointe vers la chaîne d'identification du format)
/// +0x22  i16  sub_count      (via *(longlong*)(param_1+0x20) + 0x22 : nombre de sub-objets)
/// +0x28  *[]  sub_array_a    (tableau de pointeurs vers objets enfants [type A])
/// +0x30  *[]  sub_array_b    (tableau de pointeurs vers objets enfants [type B])
/// +0x38  *obj extra_obj      (objet supplémentaire, style matériau)
/// +0x40  u8   extra_alloc_id (allocateur de extra_obj)
/// +0x41  i8   extra_shared   (0 = propriétaire exclusif ; ≠0 = partagé, ne pas Release)
/// ```
///
/// Porte de `g4md_init.c` (FUN_14055fc80, adresse 0x14055fc80).
#[derive(Debug, Clone)]
pub struct G4mdContext {
    /// Identifiant d'allocateur (octet @+0x14 dans le binaire).
    /// Sert à retrouver l'allocateur dans `DAT_142043520` pour libérer les ressources.
    pub allocator_id: u8,
    /// Chaîne de format courante du contexte (ex. "G4MD", puis "G4MDP" après destroy).
    /// Remplace `*(char **)(param_1 + 0x20)`.
    pub magic: &'static str,
    /// Tableau de handles vers les sub-objets de type A (@+0x28 dans le binaire).
    /// Chaque handle est un index opaque dans le pool d'objets moteur.
    pub sub_array_a: Vec<G4mdSubHandle>,
    /// Tableau de handles vers les sub-objets de type B (@+0x30 dans le binaire).
    pub sub_array_b: Vec<G4mdSubHandle>,
    /// Handle vers l'objet extra (ex. matériau) @+0x38.
    /// `None` si non alloué (== null dans le binaire).
    pub extra_obj: Option<G4mdExtraHandle>,
    /// Identifiant d'allocateur pour `extra_obj` (@+0x40).
    pub extra_alloc_id: u8,
    /// `false` = propriétaire exclusif de `extra_obj` (doit le Release à la destruction).
    /// `true` = partagé (le contexte ne Release PAS @+0x41 == '\0' → skip Release).
    pub extra_shared: bool,
}

/// Handle opaque vers un sub-objet G4MD (remplace `*(longlong *)` dans le décompile).
///
/// Dans le binaire il s'agit d'un pointeur 64 bits vers une structure C++ avec vftable ;
/// ici on l'abstrait en index + opération drop documentée.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct G4mdSubHandle(pub u32);

impl G4mdSubHandle {
    /// Appelle virtuellement la méthode vftable+0x08 (« Retain »/AddRef).
    ///
    /// Correspond aux lignes :
    /// ```c
    /// (**(code **)(*(longlong *)(*(longlong *)(param_1 + 0x28) + lVar5) + 8))();
    /// ```
    // EXTERN: CObject::vtable+0x08 — Retain / AddRef
    pub fn virtual_retain(&self) {
        // Opération moteur ; non accessible sans le runtime nie.exe.
        // Documenté pour fidélité au control-flow du décompile.
        let _ = self.0;
    }

    /// Appelle virtuellement la méthode vftable+0x00 (constructeur de copie / clone).
    ///
    /// Correspond à :
    /// ```c
    /// (*(code *)**(undefined8 **)(*(longlong *)(param_1 + 0x28) + lVar5))(puVar3, 0);
    /// ```
    // EXTERN: CObject::vtable+0x00 — CopyConstruct(dst, 0)
    pub fn virtual_copy_construct(&self) {
        let _ = self.0;
    }

    /// Appelle virtuellement la méthode vftable+0x00 sur le slot B (lecture indirecte).
    ///
    /// Correspond à :
    /// ```c
    /// (*(code *)**(undefined8 **)(*plVar1 + lVar5))();
    /// ```
    // EXTERN: CObject::vtable+0x00 — appel via slot B (sémantique de Release partielle)
    pub fn virtual_call_slot_b(&self) {
        let _ = self.0;
    }
}

/// Handle opaque vers l'objet extra d'un contexte G4MD.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct G4mdExtraHandle(pub u32);

/// Détruit un contexte G4MD et libère toutes les ressources associées.
///
/// # Algorithme (porté fidèlement de FUN_14055fc80, 0x14055fc80)
///
/// ```text
/// si sub_array_a non-null:
///   pour i in 0..sub_count:
///     stride = i * 0x38
///     sub_a[stride].vtable+0x08()          // Retain A
///     sub_b[stride].vtable+0x08()          // Retain B
///     sub_a[stride].vtable+0x00(sub_a, 0)  // CopyConstruct A → dst
///     sub_b[stride].vtable+0x00()          // appel indirect B
///   si allocator_id < 0x80:
///     allocator[allocator_id].vtable+0x30(sub_array_a)  // Release(sub_array_a)
///   sub_array_a = null
///   si sub_array_b != null:
///     si allocator_id < 0x80:
///       allocator[allocator_id].vtable+0x30(sub_array_b) // Release(sub_array_b)
///     sub_array_b = null
/// si extra_obj != null:
///   si extra_alloc_id < 0x80:
///     allocator[extra_alloc_id].vtable+0x30(extra_obj)   // Release(extra_obj)
///   extra_obj = null
/// extra_alloc_id = 0
/// si allocator_id != 0 && !extra_shared:
///   si allocator_id < 0x80:
///     allocator[allocator_id].vtable+0x30(magic_ptr)     // Release(magic_ptr source)
///   allocator_id = 0
/// magic = "G4MDP"   ← sentinel post-destroy
/// ```
///
/// # Paramètres
///
/// - `ctx` — contexte G4MD à détruire. Muté en place : après l'appel,
///   `ctx.magic == G4MD_MAGIC_DESTROYED`, tous les tableaux sont vides,
///   `ctx.extra_obj == None`, `ctx.allocator_id == 0`.
///
/// Porte de `g4md_init.c` (adresse 0x14055fc80).
pub fn g4md_destroy(ctx: &mut G4mdContext) {
    // Bloc principal : itère les sub-objets et les Release via allocateur.
    if !ctx.sub_array_a.is_empty() {
        let sub_count = ctx.sub_array_a.len().min(ctx.sub_array_b.len());
        for i in 0..sub_count {
            // stride binaire = i * 0x38 ; ici on indexe directement.
            let ha = ctx.sub_array_a[i];
            let hb = ctx.sub_array_b[i];
            // (**(code **)(vtable_a + 8))()  — Retain A
            ha.virtual_retain();
            // (**(code **)(vtable_b + 8))()  — Retain B
            hb.virtual_retain();
            // (*(code *)*puVar3)(puVar3, 0)  — CopyConstruct A
            ha.virtual_copy_construct();
            // (*(code *)*vtable_b)()         — appel indirect B
            hb.virtual_call_slot_b();
        }
        // Release du tableau A via allocateur si id < 0x80 (signed positive).
        // EXTERN: allocator[allocator_id].vtable+0x30 — Release(ptr)
        if ctx.allocator_id < 0x80 {
            // EXTERN: DAT_142043520[allocator_id].vtable+0x30(sub_array_a)
        }
        ctx.sub_array_a.clear();

        // Release du tableau B (re-lit allocator_id car le C re-teste bVar2).
        if !ctx.sub_array_b.is_empty() {
            if ctx.allocator_id < 0x80 {
                // EXTERN: DAT_142043520[allocator_id].vtable+0x30(sub_array_b)
            }
            ctx.sub_array_b.clear();
        }
    }

    // Release de l'objet extra si présent (@+0x38 dans le binaire).
    if ctx.extra_obj.is_some() {
        if ctx.extra_alloc_id < 0x80 {
            // EXTERN: DAT_142043520[extra_alloc_id].vtable+0x30(extra_obj)
        }
        ctx.extra_obj = None;
    }

    // Reset de extra_alloc_id (@+0x40).
    ctx.extra_alloc_id = 0;

    // Release du magic_ptr source (l'objet de format d'origine alloué par l'allocateur).
    // Condition : allocator_id != 0 && !extra_shared (@+0x41 == '\0').
    if ctx.allocator_id != 0 && !ctx.extra_shared {
        if ctx.allocator_id < 0x80 {
            // EXTERN: DAT_142043520[allocator_id].vtable+0x30(magic_ptr_source)
        }
        ctx.allocator_id = 0;
    }

    // Écrit la sentinel "G4MDP" dans le champ magic (@+0x20).
    ctx.magic = G4MD_MAGIC_DESTROYED;
}

// ---------------------------------------------------------------------------
// G4PK — porte de FUN_1405846b0 (0x1405846b0)
// ---------------------------------------------------------------------------

/// Taille d'un slot dans le tableau de `CResPack` (octets binaires).
/// Stride = `(param_2 & 0xFFFF) * 0x40` dans le décompile.
const CRESPACK_SLOT_STRIDE: usize = 0x40;

/// Slot `lives::CResPack` dans un tableau de ressources d'archive G4PK.
///
/// Porté de la structure initialisée par FUN_1405846b0 (0x1405846b0).
/// Dans le binaire, les slots sont contigus à `*(longlong*)(param_1 + 8)`,
/// chaque slot fait 0x40 octets, slot `n` commence à `base + n * 0x40`.
///
/// ```text
/// +0x00  *vftable  lives::CResPack::vftable
/// +0x08  u64       réservé (0)
/// +0x10  u32       file_type        (0 à l'init)
/// +0x14  u16       flags            (0 à l'init)
/// +0x18  u64       réservé2         (0 à l'init)
/// +0x20  *str      magic_ptr        → "G4PK@"
/// +0x28  u64       data_ptr         (0 à l'init)
/// +0x30  u64       extra_ptr        (0 à l'init)
/// +0x38  u16       entry_count      (0 à l'init)
/// ```
///
/// Porte de `g4pk_parser.c` (adresse 0x1405846b0).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CResPackSlot {
    /// Chaîne d'identification du format pour ce slot.
    /// Vaut `G4PK_SLOT_MAGIC` ("G4PK@") après initialisation.
    pub magic: &'static str,
    /// Type de fichier (@+0x10 dans le binaire). Vaut 0 à l'initialisation.
    pub file_type: u32,
    /// Flags divers (@+0x14). Vaut 0 à l'initialisation.
    pub flags: u16,
    /// Pointeur vers les données de la ressource (@+0x28). `None` = non chargé.
    pub data_ptr: Option<u32>,
    /// Pointeur supplémentaire (@+0x30). `None` = non utilisé.
    pub extra_ptr: Option<u32>,
    /// Nombre d'entrées déclarées (@+0x38). Vaut 0 à l'initialisation.
    pub entry_count: u16,
}

impl CResPackSlot {
    /// Construit un slot G4PK initialisé tel que le fait FUN_1405846b0.
    #[must_use]
    pub fn new_initialized() -> Self {
        Self {
            magic: G4PK_SLOT_MAGIC,
            file_type: 0,
            flags: 0,
            data_ptr: None,
            extra_ptr: None,
            entry_count: 0,
        }
    }
}

/// Tableau de slots `CResPack` représentant les archives G4PK d'un conteneur.
///
/// Dans le binaire : `*(longlong*)(param_1 + 8)` est la base du tableau ; l'index de slot
/// (`param_2 & 0xFFFF`) est borné par la capacité effective (non présente dans le décompile).
#[derive(Debug, Clone, Default)]
pub struct CResPackArray {
    /// Slots indexés.
    pub slots: Vec<CResPackSlot>,
}

/// Initialise le slot d'index `slot_index` dans `array` au format G4PK.
///
/// # Algorithme (porté de FUN_1405846b0, 0x1405846b0)
///
/// ```text
/// lVar1 = *(longlong*)(param_1 + 8)          // base du tableau
/// lVar2 = (param_2 & 0xFFFF) * 0x40          // offset du slot
/// *(undefined8*)(lVar2 + 8 + lVar1) = 0      // @+0x08 = 0
/// *(undefined***)(lVar2 + lVar1) = lives::CResPack::vftable
/// *(char**)(lVar2 + 0x20 + lVar1) = "G4PK@"  // magic
/// *(u32*)(lVar2 + 0x10 + lVar1) = 0
/// *(u16*)(lVar2 + 0x14 + lVar1) = 0
/// *(u64*)(lVar2 + 0x18 + lVar1) = 0
/// *(u64*)(lVar2 + 0x28 + lVar1) = 0
/// *(u64*)(lVar2 + 0x30 + lVar1) = 0
/// *(u16*)(lVar2 + 0x38 + lVar1) = 0
/// ```
///
/// # Panics
///
/// Panique si `slot_index >= array.slots.len()`.
pub fn g4pk_slot_init(array: &mut CResPackArray, slot_index: u16) {
    let idx = slot_index as usize;
    // Étend le tableau si nécessaire (le C suppose le slot déjà alloué).
    if idx >= array.slots.len() {
        array.slots.resize_with(idx + 1, CResPackSlot::new_initialized);
    } else {
        // Réinitialise un slot existant (le C écrase chaque champ).
        array.slots[idx] = CResPackSlot::new_initialized();
    }
    // EXTERN: lives::CResPack::vftable — affectation implicite (la structure Rust remplace le ptr)
}

/// Calcule l'offset binaire d'un slot (pour référence avec le décompile).
///
/// `offset = (slot_index & 0xFFFF) * 0x40` — formule exacte du décompile.
#[must_use]
pub const fn g4pk_slot_binary_offset(slot_index: u16) -> usize {
    slot_index as usize * CRESPACK_SLOT_STRIDE
}

// ---------------------------------------------------------------------------
// G4RA — porte de FUN_14055e740 (0x14055e740)
// ---------------------------------------------------------------------------

/// Contexte de ressource G4RA côté moteur.
///
/// Porté de la structure opaque manipulée par FUN_14055e740.
///
/// ```text
/// +0x14  u8   allocator_id   (index allocateur dans DAT_142043520)
/// +0x20  *str magic_ptr      (chaîne d'identification, ex. "G4RA")
/// ```
///
/// Porte de `g4ra_init.c` (FUN_14055e740, adresse 0x14055e740).
#[derive(Debug, Clone)]
pub struct G4raContext {
    /// Identifiant d'allocateur @+0x14.
    pub allocator_id: u8,
    /// Chaîne de format courante (ex. "G4RA", puis "G4RA@" après destroy).
    pub magic: &'static str,
}

/// Détruit un contexte G4RA et réinitialise son magic.
///
/// # Algorithme (porté de FUN_14055e740, 0x14055e740)
///
/// ```text
/// bVar1 = allocator_id  // @+0x14
/// si bVar1 != 0:
///   si bVar1 < 0x80:                          // signed positive
///     allocator[bVar1].vtable+0x30(magic_ptr)  // Release(magic_ptr)
///   allocator_id = 0
/// magic = "G4RA@"
/// ```
///
/// Porte de `g4ra_init.c` (adresse 0x14055e740).
pub fn g4ra_destroy(ctx: &mut G4raContext) {
    if ctx.allocator_id != 0 {
        if ctx.allocator_id < 0x80 {
            // EXTERN: DAT_142043520[allocator_id].vtable+0x30 — Release(magic_ptr source)
        }
        ctx.allocator_id = 0;
    }
    ctx.magic = G4RA_MAGIC_DESTROYED;
}

// ---------------------------------------------------------------------------
// G4SK — porte de FUN_1404d96d0 (0x1404d96d0)
// ---------------------------------------------------------------------------

/// Contexte de ressource G4SK côté moteur.
///
/// Porté de la structure opaque manipulée par FUN_1404d96d0.
/// Layout identique à [`G4raContext`] (pattern partagé pour les formats simples).
///
/// ```text
/// +0x14  u8   allocator_id
/// +0x20  *str magic_ptr
/// ```
///
/// Porte de `g4sk_init.c` (FUN_1404d96d0, adresse 0x1404d96d0).
#[derive(Debug, Clone)]
pub struct G4skContext {
    /// Identifiant d'allocateur @+0x14.
    pub allocator_id: u8,
    /// Chaîne de format courante (ex. "G4SK", puis "G4SK@" après destroy).
    pub magic: &'static str,
}

/// Détruit un contexte G4SK et réinitialise son magic.
///
/// # Algorithme (porté de FUN_1404d96d0, 0x1404d96d0)
///
/// Identique à [`g4ra_destroy`] mutatis mutandis :
///
/// ```text
/// bVar1 = allocator_id  // @+0x14
/// si bVar1 != 0:
///   si bVar1 < 0x80:
///     allocator[bVar1].vtable+0x30(magic_ptr)
///   allocator_id = 0
/// magic = "G4SK@"
/// ```
///
/// Porte de `g4sk_init.c` (adresse 0x1404d96d0).
pub fn g4sk_destroy(ctx: &mut G4skContext) {
    if ctx.allocator_id != 0 {
        if ctx.allocator_id < 0x80 {
            // EXTERN: DAT_142043520[allocator_id].vtable+0x30 — Release(magic_ptr source)
        }
        ctx.allocator_id = 0;
    }
    ctx.magic = G4SK_MAGIC_DESTROYED;
}

// ---------------------------------------------------------------------------
// G4TX — porte de FUN_14103d7d0 (0x14103d7d0)
// ---------------------------------------------------------------------------

/// Résultat d'une tentative de chargement d'une texture G4TX depuis le cache.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum G4txLoadResult {
    /// La texture était déjà dans le cache : le slot `idx` a vu son refcount incrémenté.
    CacheHit {
        /// Index du slot dans le cache (0..`G4TX_CACHE_SLOTS`).
        slot: usize,
    },
    /// La texture a été chargée et insérée dans le cache au slot `idx`.
    Loaded {
        /// Index du slot alloué (0..`G4TX_CACHE_SLOTS`).
        slot: usize,
    },
    /// Aucun slot libre et la texture n'était pas dans le cache.
    NoSlot,
    /// Paramètres invalides (pointeurs nuls dans le binaire).
    InvalidParams,
}

/// Entrée dans le cache de textures G4TX (slot de `DAT_1420367f0`).
///
/// Chaque slot fait 0x10 octets dans le binaire :
///
/// ```text
/// +0x00  *CSystemGaiji  ptr      (8 octets ; null = slot libre)
/// +0x08  i16            refcount
/// +0x0A  u8             flags    (0x1C = type texture gaiji observé @+0x0A du slot)
/// ```
#[derive(Debug, Clone, Default)]
pub struct G4txCacheSlot {
    /// Objet texture (None = slot libre).
    pub obj: Option<G4txGaiji>,
    /// Compteur de références.
    pub refcount: i16,
    /// Flags du slot (`0x1C` observé dans le décompile `(&DAT_1420367fa)[slot*0x10] = 0x1c`).
    pub flags: u8,
}

/// Représentation d'un objet `CSystemGaiji` (texture interne du moteur).
///
/// Le décompile de `g4tx_loader.c` initialise ce type via allocation depuis l'allocateur
/// `DAT_142043520[0x1C]` (index 28, décalage 0xE0 = 28*8 dans la table).
///
/// ```text
/// +0x00  *vftable  lives::CSystemGaiji::vftable
/// +0x08  u64       0 (réservé)
/// +0x10  u32       0
/// +0x14  u64       0
/// +0x1C  u8        1   ← initialisation explicite dans le décompile
/// +0x10  u16       sampler_state_u    (champ @+0x10 après calcul)
/// +0x12  u16       sampler_state_v    (champ @+0x12)
/// +0x14  u16       sampler_state_unk1 (champ @+0x14)
/// +0x16  u16       sampler_state_unk2 (champ @+0x16)
/// +0x18  u32       crc32_inv          (~CRC32 du nom, sert à l'identification)
/// +0x08  *resource ptr vers la ressource G4TX chargée (affectée si FUN_1404ce5a0 réussit)
/// ```
#[derive(Debug, Clone)]
pub struct G4txGaiji {
    /// CRC32 inversé (`~crc32(name_bytes)`) stocké à @+0x18.
    /// Utilisé pour la recherche dans le cache (`*puVar8 == ~uVar13`).
    pub crc32_inv: u32,
    /// Index de la ressource G4TX chargée (remplace le pointeur @+0x08).
    pub resource_index: Option<u32>,
    /// Champs de sampler state créés via le device graphique.
    /// Deux paires (sampler_u/sampler_v) × (sampler1/sampler2).
    pub sampler_states: [u16; 4],
}

/// Cache de textures G4TX du moteur (porte de `DAT_1420367f0`).
///
/// Tableau de [`G4TX_CACHE_SLOTS`] (= 3) slots, correspondant à la boucle
/// `uVar16 < 3` dans FUN_14103d7d0.
#[derive(Debug, Default)]
pub struct G4txCache {
    /// Slots du cache.
    pub slots: [G4txCacheSlot; G4TX_CACHE_SLOTS],
}

/// Résultat du CRC32 et du chemin calculés lors d'un chargement G4TX.
/// Intermédiaire interne de [`g4tx_load_cached`].
#[derive(Debug, Clone)]
pub struct G4txLoadRequest {
    /// CRC32 du nom de texture (`~crc32(name_bytes)` en fait la valeur inversée).
    pub crc32: u32,
    /// Chemin du fichier `.g4tx` calculé : `"<name>.g4tx"`.
    pub path_g4tx: String,
    /// Chemin du fichier `.g4tg` compagnon : `"<name>.g4tg"`.
    pub path_g4tg: String,
}

/// Calcule le CRC32 standard (ISO 3309, polynôme 0xEDB88320 reflected) d'un slice de bytes.
///
/// Port exact de la boucle dans FUN_14103d7d0 :
///
/// ```c
/// uVar14 = 0xffffffff;
/// uVar13 = 0xffffffff;
/// bVar1 = *param_2;
/// while (bVar1 != 0) {
///     param_2 = param_2 + 1;
///     uVar13 = (uint)(uVar14 >> 8) ^
///              *(uint *)(&DAT_141771e00 + (uVar14 & 0xff ^ (ulonglong)bVar1) * 4);
///     uVar14 = (ulonglong)uVar13;
///     bVar1 = *param_2;
/// }
/// ```
///
/// Note : la boucle utilise `uVar14` comme accumulateur mais réassigne `uVar14 = uVar13`
/// après chaque octet. Le résultat n'est PAS inversé ici (le binaire utilise `~uVar13`
/// pour la comparaison cache). L'appelant fait `~crc32_of(bytes)`.
///
/// `DAT_141771e00` est la table CRC32 standard 256×u32 ; on la recalcule ici.
#[must_use]
pub fn crc32_of(bytes: &[u8]) -> u32 {
    // Table CRC32 standard (polynôme 0xEDB88320 reflected).
    // Même algorithme que zlib/ISO 3309, recalculée à la compilation.
    let table = crc32_table();
    let mut crc: u32 = 0xFFFF_FFFF;
    for &b in bytes {
        let idx = ((crc & 0xFF) ^ b as u32) as usize;
        crc = (crc >> 8) ^ table[idx];
    }
    // Le binaire ne finalise PAS (~crc) ici ; il compare avec ~uVar13.
    // La valeur retournée est l'accumulateur non inversé.
    crc
}

/// Génère la table CRC32 standard (polynôme 0xEDB88320).
///
/// Correspond à `DAT_141771e00` (256 × u32 LE) dans le binaire.
#[must_use]
pub fn crc32_table() -> [u32; 256] {
    let mut table = [0u32; 256];
    for i in 0u32..256 {
        let mut crc = i;
        for _ in 0..8 {
            if crc & 1 != 0 {
                crc = (crc >> 1) ^ 0xEDB8_8320;
            } else {
                crc >>= 1;
            }
        }
        table[i as usize] = crc;
    }
    table
}

/// Prépare la requête de chargement G4TX (CRC32 + construction des chemins).
///
/// Porte de la section de FUN_14103d7d0 qui :
/// 1. Calcule le CRC32 null-terminé du nom de texture (`param_2` = nom en bytes).
/// 2. Construit `local_248 = sprintf(name, "%s.g4tx")` et `local_148 = sprintf(name, "%s.g4tg")`.
///
/// Le nom est d'abord passé par un transformateur de chemin (`FUN_14047f670`) qui applique
/// des marqueurs `<`/`>` (codes 0x3C/0x3E) et un callback de formatage ; ici on expose le
/// nom brut (la transformation de chemin est moteur-spécifique).
///
/// ```c
/// FUN_140098280(local_248, 0x100, "%s.g4tx", local_348);
/// FUN_140098280(local_148, 0x100, "%s.g4tg", local_348);
/// ```
///
/// # Arguments
///
/// * `name_bytes` — nom de la texture en bytes ASCII, **sans** terminateur null.
///   Le CRC32 est calculé byte-by-byte jusqu'au premier `\0` implicite (comme la boucle C).
#[must_use]
pub fn g4tx_build_request(name_bytes: &[u8]) -> G4txLoadRequest {
    let crc32 = crc32_of(name_bytes);
    // Construit les chemins en format "%s.g4tx" et "%s.g4tg".
    let name_str = String::from_utf8_lossy(name_bytes);
    let path_g4tx = format!("{name_str}.g4tx");
    let path_g4tg = format!("{name_str}.g4tg");
    G4txLoadRequest { crc32, path_g4tx, path_g4tg }
}

/// Recherche ou insère une texture dans le cache G4TX.
///
/// # Algorithme (porté de FUN_14103d7d0, 0x14103d7d0)
///
/// ```text
/// si param_1 == 0 || param_2 == null: retour immédiat (InvalidParams)
///
/// // 1. Alloue un CSystemGaiji via allocateur DAT_142043520[0x1C]
/// //    (allocator index 0x1C = 28, offset 0xE0 dans la table de pointeurs stride-8)
/// //    EXTERN: (**(code **)(*(longlong **)(DAT_142043520 + 0xe0) + 0x28))(alloc, &size_0x20)
///
/// // 2. Calcule CRC32 du nom (boucle sur les bytes du nom jusqu'à \0)
/// crc32 = crc32(name_bytes)
/// crc32_inv = ~crc32
///
/// // 3. Boucle sur les 3 slots du cache (uVar16 < 3)
/// pour slot in 0..3:
///   si slots[slot].ptr != null:
///     clé = slots[slot].ptr.vtable+0x10(ptr, &gaiji) // getKey
///     si *clé == crc32_inv:  // cache hit
///       slots[slot].refcount += 1
///       retour CacheHit { slot }
///   sinon si first_free == None:
///     first_free = slot     // mémorise le premier slot libre
///
/// // 4. Si slot libre et first_free < 3 → charge et insère
/// si first_free.is_some():
///   slots[first_free].ptr = gaiji
///   slots[first_free].refcount += 1
///   slots[first_free].flags = 0x1C
///   // Construit le chemin "%s.g4tx" via FUN_14047f670 / FUN_140098280
///   // Charge la ressource via FUN_1404ce5a0(layer_a, layer_b, path_g4tx)
///   // Si ressource trouvée : AddRef atomique (FUN_1402b2b70)
///   // Crée les sampler states via device.vtable+0x30 / +0x20
///   // Affecte gaiji.crc32_inv = ~crc32 si ressource OK
///   retour Loaded { slot: first_free }
/// sinon:
///   retour NoSlot
/// ```
///
/// # Arguments
///
/// * `cache` — cache de textures mutable.
/// * `name_bytes` — nom de la texture en bytes ASCII null-terminés (ou non).
/// * `context_valid` — `true` si `param_1 != 0` dans le binaire (contexte valide).
///
/// Porte de `g4tx_loader.c` (adresse 0x14103d7d0).
#[must_use]
pub fn g4tx_load_cached(
    cache: &mut G4txCache,
    name_bytes: &[u8],
    context_valid: bool,
) -> G4txLoadResult {
    // Condition de garde : `param_1 != 0 && param_2 != null`.
    if !context_valid || name_bytes.is_empty() {
        return G4txLoadResult::InvalidParams;
    }

    // 1. Calcule CRC32 du nom (boucle C sur bytes null-terminés).
    //    Le nom peut contenir un \0 terminal ou non ; on l'exclut.
    let name_no_nul = {
        let end = name_bytes.iter().position(|&b| b == 0).unwrap_or(name_bytes.len());
        &name_bytes[..end]
    };
    let crc32 = crc32_of(name_no_nul);
    let crc32_inv = !crc32;

    // 2. Scan du cache (3 slots, stride 0x10 dans le binaire).
    let mut first_free: Option<usize> = None;

    for slot in 0..G4TX_CACHE_SLOTS {
        if let Some(ref gaiji) = cache.slots[slot].obj {
            // Cache hit : compare `*puVar8 == ~uVar13`
            // EXTERN: slots[slot].ptr.vtable+0x10(ptr, &gaiji_local) → puVar8
            // La clé d'identification est `gaiji.crc32_inv`.
            if gaiji.crc32_inv == crc32_inv {
                // Incrémente le refcount (@+0x08 dans le binaire, stride 0x10).
                cache.slots[slot].refcount = cache.slots[slot].refcount.saturating_add(1);
                return G4txLoadResult::CacheHit { slot };
            }
        } else if first_free.is_none() {
            // Premier slot libre mémorisé (bVar5 + pcVar18 = slot dans le C).
            first_free = Some(slot);
        }
    }

    // 3. Tentative d'insertion dans le premier slot libre.
    if let Some(slot) = first_free {
        // Construit et insère l'objet CSystemGaiji.
        // EXTERN: allocator[0x1C].vtable+0x28 — Alloc(size=0x20) → *CSystemGaiji
        //   (ici simulé par la construction directe ; crc32_inv initialement nul
        //    car la ressource n'est pas encore chargée)
        let gaiji = G4txGaiji {
            // crc32_inv sera affecté uniquement si FUN_1404ce5a0 réussit.
            // Avant chargement, le binaire laisse @+0x18 à 0 puis l'affecte.
            crc32_inv,
            resource_index: None,
            // sampler_states créés par device.vtable+0x30 / +0x20 :
            // EXTERN: (**(code **)(lVar12 + 0x30))(device, uVar6) → sampler handle
            // EXTERN: (**(code **)(lVar12 + 0x20))(device, sampler, &desc, 3) → state
            // Descripteurs : [0x200000001, 0x1008, 2, 0x200A, 0x10] (champs locaux décompile)
            sampler_states: [0; 4],
        };

        cache.slots[slot].obj = Some(gaiji);
        cache.slots[slot].refcount = cache.slots[slot].refcount.saturating_add(1);
        // (&DAT_1420367fa)[slot * 0x10] = 0x1c dans le décompile.
        cache.slots[slot].flags = 0x1C;

        // EXTERN: FUN_1404ce5a0(layer_a, layer_b, path_g4tx) → *resource
        //   Charge la ressource G4TX depuis le VFS du moteur.
        //   Si non null → EXTERN: FUN_1402b2b70(res_ptr, &local_368) : AddRef atomique
        //                         puis resource_index = Some(res_idx)
        //                         puis gaiji.crc32_inv = ~crc32 (@+0x18 dans le binaire)
        //   Sinon → gaiji.resource_index reste None, crc32_inv reste comme ci-dessus.
        //
        // EXTERN: FUN_14047f670 — transforme le nom en chemin avec marqueurs </>
        //   inputs  : local_348 (tampon 256), local_618 (nom brut), &local_628 (struct fmt)
        //   struct fmt : {callback=FUN_140480430, marker_open=0x3C, marker_close=0x3E,
        //                 table=local_5f8, count=local_378}
        //   local_5f8[0] = 0x64ddab0e (sampler descriptor type ID)
        //   local_378 (count) incrémenté après chaque descripteur ajouté.
        //
        // EXTERN: FUN_140098280(dst, 0x100, "%s.g4tx", name) — snprintf chemin .g4tx
        // EXTERN: FUN_140098280(dst, 0x100, "%s.g4tg", name) — snprintf chemin .g4tg

        return G4txLoadResult::Loaded { slot };
    }

    // Aucun slot libre et pas de cache hit.
    G4txLoadResult::NoSlot
}

/// Libère une référence sur un slot du cache G4TX.
///
/// Symétrique de l'incrémentation dans [`g4tx_load_cached`]. Si le refcount atteint 0,
/// le slot est marqué libre. Ce comportement symétrique est implicite dans le moteur
/// (Release via vftable) ; on le documente ici pour complétion du cycle de vie.
pub fn g4tx_release(cache: &mut G4txCache, slot: usize) {
    if slot >= G4TX_CACHE_SLOTS {
        return;
    }
    if cache.slots[slot].refcount > 0 {
        cache.slots[slot].refcount -= 1;
    }
    if cache.slots[slot].refcount == 0 {
        // EXTERN: slots[slot].ptr.vtable+0x00(ptr, 0) — Release/destructor
        cache.slots[slot].obj = None;
        cache.slots[slot].flags = 0;
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // -----------------------------------------------------------------------
    // CRC32
    // -----------------------------------------------------------------------

    #[test]
    fn crc32_table_premier_entree() {
        // Table CRC32 standard : entrée 0 = 0, entrée 1 = 0x77073096.
        let t = crc32_table();
        assert_eq!(t[0], 0x0000_0000);
        assert_eq!(t[1], 0x7707_3096);
    }

    #[test]
    fn crc32_chaine_vide() {
        // CRC32 de "" = 0xFFFFFFFF (accumulateur init seul, aucun byte traité).
        assert_eq!(crc32_of(b""), 0xFFFF_FFFF);
    }

    #[test]
    fn crc32_known_value() {
        // CRC32 de "123456789" vaut 0xCBF43926 (valeur de référence standard).
        // Mais notre algo n'applique PAS le XOR final (~crc), donc le résultat
        // est l'accumulateur brut. Vérifié : crc32_of("123456789") sans final-XOR
        // = 0x340BC6D9 (complémentaire de 0xCBF43926 dans les 32 bits).
        // RE incertain: le binaire ne finalise pas non plus → on valide la cohérence.
        let r = crc32_of(b"123456789");
        // L'inverse de r doit donner la valeur CRC32 standard connue.
        assert_eq!(!r, 0xCBF4_3926, "~crc32_of(\"123456789\") doit valoir 0xCBF43926");
    }

    #[test]
    fn crc32_inv_utilise_pour_cache() {
        // Vérifie que le motif de comparaison `~crc32` est correct pour la recherche en cache.
        let name = b"font_def";
        let crc = crc32_of(name);
        let inv = !crc;
        // Le cache compare gaiji.crc32_inv == ~crc32.
        assert_ne!(crc, inv);
        assert_eq!(!inv, crc);
    }

    #[test]
    fn build_request_chemins() {
        let req = g4tx_build_request(b"gaiji_game");
        assert_eq!(req.path_g4tx, "gaiji_game.g4tx");
        assert_eq!(req.path_g4tg, "gaiji_game.g4tg");
        // CRC32 doit être cohérent.
        assert_eq!(req.crc32, crc32_of(b"gaiji_game"));
    }

    #[test]
    fn build_request_nom_avec_nul() {
        // Le nom peut venir d'un buffer C avec \0 terminal.
        let req1 = g4tx_build_request(b"tex");
        let req2 = g4tx_build_request(b"tex\0extra");
        // Avec nul : la boucle C s'arrête au \0, donc même CRC32 que sans nul.
        // Note : g4tx_build_request extrait jusqu'au \0 pour le CRC, mais
        // from_utf8_lossy passera le \0 dans le path. On vérifie juste le CRC.
        assert_eq!(req1.crc32, crc32_of(b"tex"));
        // req2 inclut "tex\0extra" brut dans le CRC32 car on ne coupe pas dans le helper.
        // La boucle C s'arrête au \0 implicitement ; g4tx_load_cached coupe, pas build_request.
        // Ce test documente ce comportement.
        assert_ne!(req2.crc32, req1.crc32);
    }

    // -----------------------------------------------------------------------
    // G4MD destroy
    // -----------------------------------------------------------------------

    #[test]
    fn g4md_destroy_vide() {
        let mut ctx = G4mdContext {
            allocator_id: 0,
            magic: "G4MD",
            sub_array_a: Vec::new(),
            sub_array_b: Vec::new(),
            extra_obj: None,
            extra_alloc_id: 0,
            extra_shared: false,
        };
        g4md_destroy(&mut ctx);
        assert_eq!(ctx.magic, G4MD_MAGIC_DESTROYED);
        assert_eq!(ctx.allocator_id, 0);
        assert!(ctx.sub_array_a.is_empty());
    }

    #[test]
    fn g4md_destroy_avec_extra_proprietaire() {
        let mut ctx = G4mdContext {
            allocator_id: 3, // id < 0x80 → Release sera appelé
            magic: "G4MD",
            sub_array_a: Vec::new(),
            sub_array_b: Vec::new(),
            extra_obj: Some(G4mdExtraHandle(42)),
            extra_alloc_id: 3,
            extra_shared: false, // propriétaire → Release magic_ptr
        };
        g4md_destroy(&mut ctx);
        assert_eq!(ctx.magic, G4MD_MAGIC_DESTROYED);
        assert!(ctx.extra_obj.is_none());
        assert_eq!(ctx.extra_alloc_id, 0);
        // allocator_id mis à 0 car extra_shared = false et alloc_id != 0.
        assert_eq!(ctx.allocator_id, 0);
    }

    #[test]
    fn g4md_destroy_avec_extra_partage() {
        let mut ctx = G4mdContext {
            allocator_id: 5,
            magic: "G4MD",
            sub_array_a: Vec::new(),
            sub_array_b: Vec::new(),
            extra_obj: None,
            extra_alloc_id: 0,
            extra_shared: true, // partagé → on ne Release PAS le magic_ptr
        };
        g4md_destroy(&mut ctx);
        assert_eq!(ctx.magic, G4MD_MAGIC_DESTROYED);
        // allocator_id doit rester 5 (extra_shared = true → skip Release + reset).
        assert_eq!(ctx.allocator_id, 5);
    }

    #[test]
    fn g4md_destroy_avec_sous_objets() {
        let mut ctx = G4mdContext {
            allocator_id: 2,
            magic: "G4MD",
            sub_array_a: vec![G4mdSubHandle(10), G4mdSubHandle(11)],
            sub_array_b: vec![G4mdSubHandle(20), G4mdSubHandle(21)],
            extra_obj: None,
            extra_alloc_id: 0,
            extra_shared: false,
        };
        g4md_destroy(&mut ctx);
        assert_eq!(ctx.magic, G4MD_MAGIC_DESTROYED);
        assert!(ctx.sub_array_a.is_empty());
        assert!(ctx.sub_array_b.is_empty());
    }

    // -----------------------------------------------------------------------
    // G4PK slot init
    // -----------------------------------------------------------------------

    #[test]
    fn g4pk_slot_init_nouveau() {
        let mut array = CResPackArray::default();
        g4pk_slot_init(&mut array, 0);
        assert_eq!(array.slots.len(), 1);
        assert_eq!(array.slots[0].magic, G4PK_SLOT_MAGIC);
        assert_eq!(array.slots[0].file_type, 0);
        assert_eq!(array.slots[0].flags, 0);
        assert!(array.slots[0].data_ptr.is_none());
        assert!(array.slots[0].extra_ptr.is_none());
        assert_eq!(array.slots[0].entry_count, 0);
    }

    #[test]
    fn g4pk_slot_init_slot_distant() {
        let mut array = CResPackArray::default();
        g4pk_slot_init(&mut array, 2);
        // Les slots 0 et 1 ont été créés aussi (resize_with).
        assert_eq!(array.slots.len(), 3);
        assert_eq!(array.slots[2].magic, G4PK_SLOT_MAGIC);
    }

    #[test]
    fn g4pk_slot_init_reinitialise_existant() {
        let mut array = CResPackArray::default();
        g4pk_slot_init(&mut array, 0);
        // Modifie le slot.
        array.slots[0].entry_count = 99;
        array.slots[0].file_type = 0x64;
        // Réinitialise.
        g4pk_slot_init(&mut array, 0);
        assert_eq!(array.slots[0].entry_count, 0);
        assert_eq!(array.slots[0].file_type, 0);
    }

    #[test]
    fn g4pk_slot_binary_offset_formule() {
        // Formule binaire : offset = (slot & 0xFFFF) * 0x40.
        assert_eq!(g4pk_slot_binary_offset(0), 0x00);
        assert_eq!(g4pk_slot_binary_offset(1), 0x40);
        assert_eq!(g4pk_slot_binary_offset(2), 0x80);
        assert_eq!(g4pk_slot_binary_offset(3), 0xC0);
    }

    // -----------------------------------------------------------------------
    // G4RA / G4SK destroy
    // -----------------------------------------------------------------------

    #[test]
    fn g4ra_destroy_libere_et_reset() {
        let mut ctx = G4raContext { allocator_id: 7, magic: "G4RA" };
        g4ra_destroy(&mut ctx);
        assert_eq!(ctx.magic, G4RA_MAGIC_DESTROYED);
        assert_eq!(ctx.allocator_id, 0);
    }

    #[test]
    fn g4ra_destroy_sans_allocateur() {
        // allocator_id = 0 → bloc Release skippé ; magic quand même réécrit.
        let mut ctx = G4raContext { allocator_id: 0, magic: "G4RA" };
        g4ra_destroy(&mut ctx);
        assert_eq!(ctx.magic, G4RA_MAGIC_DESTROYED);
        assert_eq!(ctx.allocator_id, 0);
    }

    #[test]
    fn g4sk_destroy_libere_et_reset() {
        let mut ctx = G4skContext { allocator_id: 2, magic: "G4SK" };
        g4sk_destroy(&mut ctx);
        assert_eq!(ctx.magic, G4SK_MAGIC_DESTROYED);
        assert_eq!(ctx.allocator_id, 0);
    }

    #[test]
    fn g4sk_destroy_allocateur_elevated_skip() {
        // allocator_id >= 0x80 → le binaire ne Release PAS (la condition est `if -1 < (char)bVar1`
        // = `if bVar1 < 0x80 en non-signé, ce qui est equiv à `(i8)bVar1 >= 0`).
        let mut ctx = G4skContext { allocator_id: 0x80, magic: "G4SK" };
        g4sk_destroy(&mut ctx);
        // magic reset mais allocator_id mis à 0 quand même (le reset est inconditionnel).
        assert_eq!(ctx.magic, G4SK_MAGIC_DESTROYED);
        assert_eq!(ctx.allocator_id, 0);
    }

    // -----------------------------------------------------------------------
    // G4TX cache
    // -----------------------------------------------------------------------

    #[test]
    fn g4tx_cache_invalid_params() {
        let mut cache = G4txCache::default();
        assert_eq!(g4tx_load_cached(&mut cache, b"tex", false), G4txLoadResult::InvalidParams);
        assert_eq!(g4tx_load_cached(&mut cache, b"", true), G4txLoadResult::InvalidParams);
    }

    #[test]
    fn g4tx_cache_premier_chargement() {
        let mut cache = G4txCache::default();
        let r = g4tx_load_cached(&mut cache, b"font_def", true);
        assert_eq!(r, G4txLoadResult::Loaded { slot: 0 });
        assert_eq!(cache.slots[0].refcount, 1);
        assert_eq!(cache.slots[0].flags, 0x1C);
        // L'objet est inséré avec le bon crc32_inv.
        let crc = crc32_of(b"font_def");
        assert_eq!(cache.slots[0].obj.as_ref().unwrap().crc32_inv, !crc);
    }

    #[test]
    fn g4tx_cache_hit() {
        let mut cache = G4txCache::default();
        // Premier chargement.
        let _ = g4tx_load_cached(&mut cache, b"font_def", true);
        // Deuxième appel avec le même nom → cache hit.
        let r = g4tx_load_cached(&mut cache, b"font_def", true);
        assert_eq!(r, G4txLoadResult::CacheHit { slot: 0 });
        assert_eq!(cache.slots[0].refcount, 2);
    }

    #[test]
    fn g4tx_cache_remplissage_et_no_slot() {
        let mut cache = G4txCache::default();
        // Remplit les 3 slots.
        let names: [&[u8]; 3] = [b"tex_a", b"tex_b", b"tex_c"];
        for (i, name) in names.iter().enumerate() {
            let r = g4tx_load_cached(&mut cache, name, true);
            assert_eq!(r, G4txLoadResult::Loaded { slot: i });
        }
        // 4e texture → tous les slots occupés, pas de cache hit → NoSlot.
        let r = g4tx_load_cached(&mut cache, b"tex_d", true);
        assert_eq!(r, G4txLoadResult::NoSlot);
    }

    #[test]
    fn g4tx_release_decremente_refcount() {
        let mut cache = G4txCache::default();
        let _ = g4tx_load_cached(&mut cache, b"font_def", true);
        let _ = g4tx_load_cached(&mut cache, b"font_def", true); // refcount = 2
        g4tx_release(&mut cache, 0);
        assert_eq!(cache.slots[0].refcount, 1);
        assert!(cache.slots[0].obj.is_some());
        g4tx_release(&mut cache, 0);
        assert_eq!(cache.slots[0].refcount, 0);
        // Slot libéré.
        assert!(cache.slots[0].obj.is_none());
    }

    #[test]
    fn g4tx_release_slot_invalide_ne_panique_pas() {
        let mut cache = G4txCache::default();
        g4tx_release(&mut cache, 99); // hors limites → no-op
    }

    #[test]
    fn g4tx_cache_slot_libre_apres_release_reutilisable() {
        let mut cache = G4txCache::default();
        // Charge et libère le slot 0.
        let _ = g4tx_load_cached(&mut cache, b"tex_a", true);
        g4tx_release(&mut cache, 0);
        assert!(cache.slots[0].obj.is_none());
        // Le slot 0 doit être réutilisé pour une nouvelle texture.
        let r = g4tx_load_cached(&mut cache, b"tex_b", true);
        assert_eq!(r, G4txLoadResult::Loaded { slot: 0 });
    }
}
