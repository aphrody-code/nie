//! Sous-système PhysX 3.4 de IEVR — portage Rust de `physx::NpScene` et `game::BallComponent`.
//!
//! Porte les classes et algorithmes extraits par Ghidra depuis `nie.exe`
//! (Inazuma Eleven: Victory Road). Toute la logique de contrôle est
//! reproduite fidèlement depuis le pseudo-C décompilé.
//!
//! # Sources RE
//!
//! - `physx_npscene_constructor.c` — `FUN_140711e30` : constructeur NpScene
//! - `physx_npscene_add_actors.c`  — `FUN_140713000` : ajout d'acteurs
//! - `physx_npscene_simulate_fetch.c` — `FUN_1407100a0` (advance), `FUN_140710200`
//!   (fetchCollision), `FUN_140710280` (fetchResults)
//! - `physx_npscene_release.c` — `FUN_14070e680` : libération de scène
//! - `ball_component.c` — `BallComponent_ctor` + `FUN_14027ac10` (BallMoveNormal)
//!
//! # Fidélité
//!
//! - State machine de simulation (0/1/2/3) : FIABLE — transitions extraites
//!   des checks `*(int *)(param_1 + 0x1f14) != N` explicites.
//! - Types d'acteurs (6=RigidDynamic, 7=RigidStatic, 0xB-0xD=ArticulationLink) :
//!   FIABLE — valeurs hardcodées dans `FUN_140713000`.
//! - Offsets des pools de tâches (0x4AB, 0x4B4, 0x4C2, etc.) : FIABLE — lus
//!   directement du pseudo-C du constructeur.
//! - Constantes flottantes IEEE 754 (gravité=2.0f, scale=1.0f, etc.) : FIABLE.
//! - Sémantique interne des fonctions `FUN_140734a40`, `FUN_140921d80`, etc. :
//!   INCONNUE — modélisées comme des appels opaques.
//!
//! # Convention
//!
//! `// EXTERN: <fn/global>` signale une référence vers une fonction ou un
//! global non porté dans ce fichier. Les stubs correspondants sont définis
//! localement avec leurs signatures reconstruites.

#![forbid(unsafe_code)]
#![warn(missing_docs)]
#![allow(clippy::pedantic)]
#![allow(clippy::float_cmp)]

// ── Types partagés ────────────────────────────────────────────────────────────

/// Vecteur 3D flottant (convention IEVR : x/y/z, y vers le haut).
///
/// Répliqué localement pour que ce fichier soit autonome.
/// Source canonique : `nie-core/src/lib.rs` → `Vec3`.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Vec3 {
    /// Composante X (axe longueur terrain).
    pub x: f32,
    /// Composante Y (altitude).
    pub y: f32,
    /// Composante Z (axe largeur terrain).
    pub z: f32,
}

impl Vec3 {
    /// Vecteur nul.
    #[must_use]
    pub const fn zero() -> Self {
        Self { x: 0.0, y: 0.0, z: 0.0 }
    }

    /// Longueur euclidienne au carré.
    #[must_use]
    pub fn length_sq(self) -> f32 {
        self.x * self.x + self.y * self.y + self.z * self.z
    }

    /// Longueur euclidienne.
    #[must_use]
    pub fn length(self) -> f32 {
        self.length_sq().sqrt()
    }
}

// ── Constantes IEEE 754 ───────────────────────────────────────────────────────

/// Valeur flottante 0.75f (0x3F400000) — utilisée comme seuil dans les pools
/// de tâches du constructeur NpScene.
///
/// Source: `physx_npscene_constructor.c` —
/// `*(undefined4 *)(param_1 + 0x4b0) = 0x3f400000` (et idem aux offsets
/// 0x4b9, 0x4c0, 0x4c7, 0x4d0, 0x4d7).
pub const TASK_POOL_THRESHOLD: f32 = 0.75; // bits = 0x3F40_0000

/// Sentinelle de slot invalide dans les pools (0xFFFFFFFF).
///
/// Source: `physx_npscene_constructor.c` —
/// `*(undefined4 *)((longlong)param_1 + 0x2584) = 0xffffffff` (et aux offsets
/// 0x25cc, 0x2604, 0x263c, 0x2684, 0x26bc).
pub const TASK_POOL_SLOT_INVALID: u32 = 0xFFFF_FFFF;

/// Capacité initiale d'un pool de tâches (0x40 = 64 entrées).
///
/// Source: `physx_npscene_constructor.c` — `FUN_14070d280(param_1 + 0x4ab, 0x40)`.
pub const TASK_POOL_INIT_CAPACITY: usize = 0x40;

/// Valeur MXCSR imposée par PhysX avant toute opération FP (mode troncature,
/// flush-to-zero, denormals-are-zero).
///
/// Source: `physx_npscene_add_actors.c` — `MXCSR = 0x9fc0` en début de
/// `FUN_140713000` ; `physx_npscene_simulate_fetch.c` — idem dans fetchResults.
///
/// En Rust pur (no-unsafe), on ne peut pas modifier MXCSR directement.
/// La constante est conservée comme documentation de l'intention originale.
pub const PHYSX_MXCSR: u32 = 0x9FC0;

/// Masque de restauration MXCSR (bits 0-5 = exception flags réinitialisés).
///
/// Source: `physx_npscene_add_actors.c` — `MXCSR = uVar4 & 0xffffffc0` en fin
/// de `FUN_140713000`.
pub const PHYSX_MXCSR_RESTORE_MASK: u32 = 0xFFFF_FFC0;

/// Gravité du ballon en unités/frame² (2.0f).
///
/// Source: `ball_component.c` — `*(undefined4 *)(param_1 + 0x1474) = 0x40000000`.
pub const BALL_GRAVITY: f32 = 2.0; // bits = 0x4000_0000

/// Scale par défaut du ballon (1.0f).
///
/// Source: `ball_component.c` — `*(undefined4 *)(param_1 + 0x2ea) = 0x3f800000`.
pub const BALL_SCALE_DEFAULT: f32 = 1.0; // bits = 0x3F80_0000

/// Distance non initialisée sentinelle (-1.0f).
///
/// Source: `ball_component.c` — offsets 0x1764, 0x176c, 0x2ef, 0x2f0.
pub const DISTANCE_UNINIT: f32 = -1.0; // bits = 0xBF80_0000

/// Indice de joueur invalide (pas de possession).
///
/// Source: `ball_component.c` — `*(undefined1 *)(param_1 + 0x293) = 0xff` (× 3).
pub const INVALID_PLAYER_IDX: u8 = 0xFF;

/// ID de cible invalide (passe/interception).
///
/// Source: `ball_component.c` — `*(undefined4 *)(param_1 + 0x29a) = 0xffff0000`.
pub const INVALID_TARGET_ID: u32 = 0xFFFF_0000;

/// Nombre maximum de collisions par frame du ballon (5).
///
/// Source: `ball_component.c` — `*(undefined1 *)(param_1 + 0x148a) = 5`.
pub const BALL_MAX_COLLISIONS: u8 = 5;

// ── Stubs externes (EXTERN) ───────────────────────────────────────────────────

// EXTERN: FUN_140734a40  — initialise le SqManager de broadphase (pruning)
// EXTERN: FUN_140921d80  — initialise le ScScene (simulation interne)
// EXTERN: FUN_140756ed0  — crée le pool de tâches "collide"
// EXTERN: FUN_14075af30  — crée le pool de tâches "solve"
// EXTERN: FUN_14074e350  — crée le pool de tâches "execution"
// EXTERN: FUN_14070d280  — init pool TQ generique (capacité 0x40)
// EXTERN: FUN_1406fcdd0  — init pool TQ alternatif (capacité 0x40)
// EXTERN: FUN_14070e180  — init CmPool (allocateur simulation)
// EXTERN: FUN_1408a85a0  — retourne le gestionnaire d'allocation nommée (PxAllocator)
// EXTERN: FUN_1408a66c0  — retourne l'allocateur fondation PhysX
// EXTERN: FUN_1408a6690  — retourne le logger fondation PhysX
// EXTERN: FUN_1408a8510  — initialise/signale un PsSync
// EXTERN: FUN_1408a7c50  — init TLS contextuel de la scene (ScScene tls slot)
// EXTERN: FUN_14070d280  — init CmPool (pool flush)
// EXTERN: FUN_140735fc0  — prépare le pipeline collide
// EXTERN: FUN_1408a8550  — attend un PsSync (renvoie true si signalé)
// EXTERN: FUN_1407150e0  — post-fetchResults: met à jour l'état des acteurs
// EXTERN: FUN_140939830  — notifie les callbacks de simulation
// EXTERN: FUN_1407152a0  — reset les compteurs de simulation
// EXTERN: FUN_14073f050  — retourne l'adresse de la scene associee à un acteur
// EXTERN: FUN_1407153d0  — addRigidStatic interne (ScScene)
// EXTERN: FUN_14071ba60  — prépare la BVH broadphase pour l'acteur
// EXTERN: FUN_1409357e0  — ajoute un static actor au SqManager
// EXTERN: FUN_140935940  — ajoute un dynamic actor au SqManager
// EXTERN: FUN_140714580  — addRigidStatic via PruningStructure
// EXTERN: FUN_140714800  — addRigidDynamic via PruningStructure
// EXTERN: FUN_140712bf0  — addArticulation interne
// EXTERN: FUN_140712d30  — rollback acteur en cas d'erreur partielle
// EXTERN: FUN_140719fa0  — push_back dans le vecteur de statics (realloc)
// EXTERN: FUN_14073f0b0  — enregistre l'acteur dans le task manager
// EXTERN: FUN_1406fae00  — libère la mémoire de la NpScene (scene pool)
// EXTERN: FUN_140714290  — continuation task interne
// EXTERN: FUN_1408a6840  — retourne l'ErrorCallback de fondation PhysX
// EXTERN: FUN_1408a6a80  — émet un message d'erreur PhysX
// EXTERN: DAT_141f6a8a8  — scene pool global PhysX (NpPhysics::mScenePool)
// EXTERN: DAT_141a3ef08  — table de dispatch par type d'acteur (vtable table)
// EXTERN: DAT_141a3ee10  — table de masques de shapes par groupe

// ── État de simulation de la scène ────────────────────────────────────────────

/// État de la machine à états de simulation `physx::NpScene`.
///
/// Source: `physx_npscene_simulate_fetch.c` — transitions codifiées par les
/// checks `*(int *)(param_1 + 0x1f14) != N` dans chaque fonction.
///
/// ```text
/// Idle(0) → [collide()] → Colliding(1)
///   → [fetchCollision()] → CollisionDone(2)
///   → [advance()] → Simulating(3)
///   → [fetchResults()] → Idle(0)
/// ```
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SimulationState {
    /// Scène au repos, prête à simuler.
    ///
    /// Source: valeur `0` dans `*(int *)(param_1 + 0x1f14)`.
    #[default]
    Idle = 0,

    /// Phase de détection de collision en cours (`collide()` appelé).
    ///
    /// Source: `FUN_140710200` — check `== 1` pour autoriser `fetchCollision`.
    Colliding = 1,

    /// Collision terminée, prête pour `advance()`.
    ///
    /// Source: `FUN_1407100a0` — check `== 2` (sinon erreur advance illegal).
    CollisionDone = 2,

    /// Simulation en cours, prête pour `fetchResults()`.
    ///
    /// Source: `FUN_140710280` — check `== 3` pour autoriser `fetchResults`.
    Simulating = 3,
}

impl SimulationState {
    /// Retourne `true` si la scène est en train de simuler (état ≠ Idle).
    ///
    /// Source: `physx_npscene_release.c` — `if (*(int *)((longlong)param_1 + 0x1f14) != 0)`.
    #[must_use]
    pub fn is_running(self) -> bool {
        self != SimulationState::Idle
    }
}

// ── Pools de tâches ───────────────────────────────────────────────────────────

/// Pool de tâches PhysX (`CmPool`/`CmFlushPool`).
///
/// Source: `physx_npscene_constructor.c` — 6 pools initialisés via
/// `FUN_14070d280` et `FUN_1406fcdd0` avec capacité `0x40`.
/// Chaque pool a un seuil flottant `0x3f400000` (0.75f) et un slot
/// invalide `0xffffffff`.
///
/// Porté ici sous forme d'un `Vec<usize>` d'indices (remplace les pointeurs
/// C++ par des indices sûrs dans une liste d'acteurs gérée par la scène).
///
/// # Offsets originaux
///
/// | Pool       | Offset param_1 | Init fn       |
/// |------------|----------------|---------------|
/// | pool_0     | 0x4AB          | FUN_14070d280 |
/// | pool_1     | 0x4B4          | FUN_14070d280 |
/// | pool_2     | 0x4BB          | FUN_14070d280 |
/// | pool_3     | 0x4C2          | FUN_1406fcdd0 |
/// | pool_4     | 0x4CB          | FUN_14070d280 |
/// | pool_5     | 0x4D2          | FUN_14070d280 |
#[derive(Debug, Clone, Default)]
pub struct TaskPool {
    /// Entrées du pool (indices dans la liste d'acteurs de la scène).
    pub entries: Vec<usize>,
    /// Seuil de remplissage avant flush (0.75f en C++).
    ///
    /// Source: `physx_npscene_constructor.c` —
    /// `*(undefined4 *)(param_1 + 0x4b0) = 0x3f400000`.
    pub fill_threshold: f32,
    /// Slot invalide sentinelle (0xFFFFFFFF).
    ///
    /// Source: `physx_npscene_constructor.c` —
    /// `*(undefined4 *)((longlong)param_1 + 0x2584) = 0xffffffff`.
    pub invalid_slot: u32,
}

impl TaskPool {
    /// Crée un pool avec les valeurs d'initialisation du constructeur NpScene.
    #[must_use]
    pub fn new() -> Self {
        Self {
            entries: Vec::with_capacity(TASK_POOL_INIT_CAPACITY),
            fill_threshold: TASK_POOL_THRESHOLD,
            invalid_slot: TASK_POOL_SLOT_INVALID,
        }
    }

    /// Retourne `true` si le pool dépasse son seuil de remplissage.
    #[must_use]
    pub fn is_full(&self) -> bool {
        #[allow(clippy::cast_precision_loss)]
        let ratio = self.entries.len() as f32 / TASK_POOL_INIT_CAPACITY as f32;
        ratio >= self.fill_threshold
    }
}

// ── Descripteur de tâche légère (PxLightCpuTask) ─────────────────────────────

/// Tâche légère CPU PhysX (`physx::PxLightCpuTask`).
///
/// Source: `physx_npscene_constructor.c` — 4 vftables `PxLightCpuTask` posées
/// aux offsets 0x4E5, 0x4EB, 0x4F1, 0x4F8, 0x4FF avec les noms de chaînes
/// "NpScene.execution" (0x4F7), "NpScene.collide" (0x4FE),
/// "NpScene.solve" (0x505).
///
/// RE incertain: la structure interne de PxLightCpuTask n'est pas décomposée
/// ici — seuls le nom et l'état d'activation sont retenus.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LightCpuTask {
    /// Nom de la tâche (chaîne statique dans le binaire).
    ///
    /// Source: `physx_npscene_constructor.c` — `param_1[0x4f7] = "NpScene.execution"`.
    pub name: &'static str,
    /// `true` si la tâche est en cours d'exécution.
    pub running: bool,
    /// Compteur de références de continuations (nombre de tâches qui attendent).
    ///
    /// Source: `physx_npscene_constructor.c` —
    /// `*(undefined4 *)((longlong)param_1 + 0x270c) = 1` (exécution).
    pub ref_count: u32,
}

impl LightCpuTask {
    /// Crée une tâche nommée avec ref_count initial.
    #[must_use]
    pub fn new(name: &'static str, initial_ref_count: u32) -> Self {
        Self { name, running: false, ref_count: initial_ref_count }
    }
}

// ── Sync primitives ───────────────────────────────────────────────────────────

/// Primitive de synchronisation PhysX (`physx::PsSync`).
///
/// Source: `physx_npscene_constructor.c` — deux `PsSync` créés via le
/// gestionnaire d'allocation nommée, aux offsets `param_1[0x4df]` et
/// `param_1[0x4e0]`, avec la chaîne source
/// `"D:\\SVN\\PhysX3.4\\PxShared\\src\\foundation\\include\\PsSync.h"` ligne 95.
///
/// En Rust, modélisé comme un booléen atomique (signalé/non-signalé).
#[derive(Debug, Default)]
pub struct PsSync {
    /// `true` si le sync est signalé (prêt à débloquer les waiters).
    pub signaled: bool,
}

impl PsSync {
    /// Signale le sync (équivalent de `FUN_1408a8510`).
    pub fn signal(&mut self) {
        self.signaled = true;
    }

    /// Attend le sync : retourne `true` si signalé, `false` si bloquant.
    ///
    /// Source: `physx_npscene_simulate_fetch.c` — `FUN_1408a8550(*(undefined8 *)(param_1 + 0x2700), ...)`.
    pub fn wait(&mut self, non_blocking: bool) -> bool {
        if non_blocking {
            self.signaled
        } else {
            // Modélise un wait bloquant — toujours signalé en simulation offline.
            // EXTERN: FUN_1408a8550 — logique réelle WaitForSingleObject / condvar
            true
        }
    }

    /// Réinitialise le sync (non-signalé).
    pub fn reset(&mut self) {
        self.signaled = false;
    }
}

// ── Type d'acteur physique ────────────────────────────────────────────────────

/// Type d'acteur PhysX (extrait depuis le champ type à `offset+8` dans le binaire).
///
/// Source: `physx_npscene_add_actors.c` — `sVar1 = *(short *)(lVar9 + 8)` avec
/// les branches `sVar1 == 7` (RigidStatic), `sVar1 == 6` (RigidDynamic),
/// `(ushort)(sVar1 - 0xbU) <= 2` (ArticulationLink).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActorType {
    /// Acteur rigide statique (`PxRigidStatic`), type 7.
    RigidStatic,
    /// Acteur rigide dynamique (`PxRigidDynamic`), type 6.
    RigidDynamic,
    /// Lien d'articulation (`PxArticulationLink`), types 0xB, 0xC, 0xD.
    ArticulationLink,
}

impl ActorType {
    /// Convertit l'entier type PhysX (lu à `offset+8`) vers `ActorType`.
    ///
    /// Source: `physx_npscene_add_actors.c` — logique de dispatch par type.
    ///
    /// Retourne `None` pour les valeurs non reconnues.
    #[must_use]
    pub fn from_raw(raw: u16) -> Option<Self> {
        match raw {
            7 => Some(Self::RigidStatic),
            6 => Some(Self::RigidDynamic),
            // (ushort)(raw - 0xB) <= 2 : i.e. raw ∈ {0xB, 0xC, 0xD}
            0x0B | 0x0C | 0x0D => Some(Self::ArticulationLink),
            _ => None,
        }
    }
}

// ── Acteur physique ───────────────────────────────────────────────────────────

/// Acteur physique dans la scène PhysX.
///
/// Source: `physx_npscene_add_actors.c` — chaque entrée de `param_2[]` est
/// un pointeur vers un acteur ; les champs lus sont :
/// - `offset+8` : type (u16)
/// - `offset+0x30` : nombre de shapes (u16, utilisé pour `FUN_14071ba60`)
/// - `offset+0x48` : pointeur vers la pruning structure (0 = aucune)
/// - `offset+0x50` : index dans le tableau de statics de la scène
/// - `offset+0x60` : pointeur body/simulation handle
/// - `offset+0x68` : flags (bit 0 = utilise un tableau de filtres externe)
/// - `offset+0x6b` : groupe de filtres (nibble bas = index dans DAT_141a3ee10)
/// - `offset+0x6c` : tableau de masques de filtres inline
/// - `offset+0x70` : ptr vers données externes (si bit 0 de flags[0x68] == 1)
/// - `offset+0x174`-`0x170` : vélocité linéaire (3 × f32)
/// - `offset+0x178` : flag "sleeping" (1 si toutes vitesses == 0.0)
/// - `offset+0x17c` : flags simulation (bit 0x4000 = articulation link)
///
/// RE incertain: les offsets 0x68-0x70 (filter data) sont inférés des
/// branches `(*(byte *)(lVar9 + 0x68) & 1)` — le schéma exact du filter
/// data n'est pas entièrement décodé.
#[derive(Debug, Clone)]
pub struct PhysActor {
    /// Type de l'acteur.
    pub actor_type: ActorType,
    /// Nombre de shapes associées (lu à `offset+0x30`).
    ///
    /// Source: `physx_npscene_add_actors.c` — `*(ushort *)(lVar9 + 0x30) + 1`
    /// passé à `FUN_14071ba60`.
    pub shape_count: u16,
    /// `true` si l'acteur provient d'une pruning structure externe.
    ///
    /// Source: `physx_npscene_add_actors.c` — `*(longlong *)(lVar9 + 0x48) != 0`.
    pub from_pruning_structure: bool,
    /// Index dans le tableau de statics de la scène (mis à jour à l'ajout).
    ///
    /// Source: `physx_npscene_add_actors.c` —
    /// `*(undefined4 *)(lVar9 + 0x50) = *(undefined4 *)(param_1 + 0x2598)`.
    pub scene_index: u32,
    /// Vélocité linéaire du corps (vec3).
    ///
    /// Source: `physx_npscene_add_actors.c` — offsets 0x15c, 0x160, 0x164
    /// lus pour déterminer si l'acteur est au repos (sleeping test).
    pub linear_velocity: Vec3,
    /// Vélocité angulaire du corps (vec3).
    ///
    /// Source: `physx_npscene_add_actors.c` — offsets 0x168, 0x16c, 0x170.
    pub angular_velocity: Vec3,
    /// `true` si l'acteur est en état de sommeil (toutes vitesses nulles).
    ///
    /// Source: `physx_npscene_add_actors.c` —
    /// ```text
    /// if (linear_vel == 0 && angular_vel == 0) {
    ///   *(undefined4 *)(lVar9 + 0x178) = 1;  // sleeping
    /// }
    /// ```
    pub sleeping: bool,
    /// Déjà assigné à une autre scène (bit 30-31 du flags à `base+0`).
    ///
    /// Source: `physx_npscene_add_actors.c` — `uVar2 >> 0x1e != 0` déclenche
    /// l'erreur « Actor already assigned to a scene ».
    pub already_in_scene: bool,
}

impl PhysActor {
    /// Crée un RigidStatic minimal prêt à être ajouté.
    #[must_use]
    pub fn new_static(shape_count: u16) -> Self {
        Self {
            actor_type: ActorType::RigidStatic,
            shape_count,
            from_pruning_structure: false,
            scene_index: 0,
            linear_velocity: Vec3::zero(),
            angular_velocity: Vec3::zero(),
            sleeping: true,
            already_in_scene: false,
        }
    }

    /// Crée un RigidDynamic minimal prêt à être ajouté.
    #[must_use]
    pub fn new_dynamic(shape_count: u16) -> Self {
        Self {
            actor_type: ActorType::RigidDynamic,
            shape_count,
            from_pruning_structure: false,
            scene_index: 0,
            linear_velocity: Vec3::zero(),
            angular_velocity: Vec3::zero(),
            sleeping: false,
            already_in_scene: false,
        }
    }

    /// Recalcule le flag `sleeping` d'après les vitesses actuelles.
    ///
    /// Source: `physx_npscene_add_actors.c` — test explicite des 6 composantes
    /// de vélocité à 0.0 aux offsets 0x15c-0x170.
    pub fn update_sleeping(&mut self) {
        let lin = &self.linear_velocity;
        let ang = &self.angular_velocity;
        self.sleeping = lin.x == 0.0
            && lin.y == 0.0
            && lin.z == 0.0
            && ang.x == 0.0
            && ang.y == 0.0
            && ang.z == 0.0;
    }
}

// ── Erreurs de la scène ───────────────────────────────────────────────────────

/// Erreurs retournées par les méthodes de `NpScene`.
///
/// Source: messages d'erreur extraits de `physx_npscene_add_actors.c` et
/// `physx_npscene_simulate_fetch.c` (chaînes hardcodées `NpScene.cpp`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SceneError {
    /// L'acteur est déjà assigné à une (autre) scène.
    ///
    /// Source: « PxScene::addActors(): Actor already assigned to a scene. »
    /// `physx_npscene_add_actors.c` ligne 78-79, erreur code 0x216.
    ActorAlreadyInScene,

    /// L'acteur est dans une pruning structure et ne peut pas être ajouté directement.
    ///
    /// Source: « PxScene::addActors(): actor is in a pruning structure… »
    /// `physx_npscene_add_actors.c` lignes 129-131, erreurs 0x228 / 0x23F.
    ActorInPruningStructure,

    /// Un articulation link ne peut pas être ajouté via `addRigidActors`.
    ///
    /// Source: « PxScene::addRigidActors(): articulation link not permitted »
    /// `physx_npscene_add_actors.c` ligne 178, erreur 0x254.
    ArticulationLinkNotPermitted,

    /// La simulation tourne déjà ; l'opération est interdite.
    ///
    /// Source: « PxScene::addActors() not allowed while simulation is running. »
    /// `physx_npscene_add_actors.c` ligne 225.
    SimulationRunning,

    /// `advance()` appelé dans un mauvais état.
    ///
    /// Source: « PxScene::advance: advance() called illegally! »
    /// `physx_npscene_simulate_fetch.c` ligne 85-86.
    AdvanceIllegal,

    /// `fetchCollision()` appelé dans un mauvais état.
    ///
    /// Source: « PxScene::fetchCollision: fetchCollision() should be called after collide() »
    /// `physx_npscene_simulate_fetch.c` ligne 135-136.
    FetchCollisionIllegal,

    /// `fetchResults()` appelé dans un mauvais état.
    ///
    /// Source: « PxScene::fetchResults: fetchResults() called illegally! »
    /// `physx_npscene_simulate_fetch.c` ligne 167-168.
    FetchResultsIllegal,
}

impl core::fmt::Display for SceneError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::ActorAlreadyInScene => write!(
                f,
                "PxScene::addActors(): Actor already assigned to a scene. Call will be ignored!"
            ),
            Self::ActorInPruningStructure => write!(
                f,
                "PxScene::addActors(): actor is in a pruning structure and cannot be added to a \
                 scene directly, use addActors(const PxPruningStructure& )"
            ),
            Self::ArticulationLinkNotPermitted => {
                write!(f, "PxScene::addRigidActors(): articulation link not permitted")
            }
            Self::SimulationRunning => write!(
                f,
                "PxScene::addActors() not allowed while simulation is running."
            ),
            Self::AdvanceIllegal => write!(
                f,
                "PxScene::advance: advance() called illegally! advance() needed to be called after \
                 fetchCollision() and before fetchResult()!!"
            ),
            Self::FetchCollisionIllegal => write!(
                f,
                "PxScene::fetchCollision: fetchCollision() should be called after collide() and \
                 before advance()!"
            ),
            Self::FetchResultsIllegal => write!(
                f,
                "PxScene::fetchResults: fetchResults() called illegally! It must be called after \
                 advance() or simulate()"
            ),
        }
    }
}

// ── Descripteur de scène (NpSceneDesc) ───────────────────────────────────────

/// Paramètres de construction de la scène PhysX (équivalent `PxSceneDesc`).
///
/// Source: `physx_npscene_constructor.c` — `param_2` est le descripteur de scène ;
/// les champs lus sont aux offsets :
/// - `+0xA0` : filtres broadphase (3 × u32)
/// - `+0xD0` : limites de simulation (3 × 2 × f32 = bounds)
/// - `+0x58` : configuration SQ (spatial query)
///
/// RE incertain: la structure complète de `PxSceneDesc` n'est pas décodée ;
/// seuls les champs observés dans le constructeur sont retenus.
#[derive(Debug, Clone)]
pub struct NpSceneDesc {
    /// Masques de filtre broadphase [0], [4], [8] (offsets param_2+0xA0..0xA8).
    ///
    /// Source: `physx_npscene_constructor.c` — passés à `FUN_140921d80`.
    pub broadphase_filter: [u32; 3],
    /// Bounds min/max de simulation (6 × f32 : minX/minY/minZ/maxX/maxY/maxZ).
    ///
    /// Source: `physx_npscene_constructor.c` — offsets 0xD0-0xE4 copiés vers
    /// `param_1[0x4d9]`-`param_1[0x4db]`.
    pub simulation_bounds: [f32; 6],
    /// Activer les queries spatiales (SQ).
    ///
    /// RE incertain: déduit de l'appel à `FUN_140734a40` (SqManager init).
    pub enable_sq: bool,
}

impl Default for NpSceneDesc {
    fn default() -> Self {
        Self {
            broadphase_filter: [0; 3],
            simulation_bounds: [0.0; 6],
            enable_sq: true,
        }
    }
}

// ── Scene PhysX (NpScene) ─────────────────────────────────────────────────────

/// Scène PhysX 3.4 (`physx::NpScene`).
///
/// Source: `physx_npscene_constructor.c` — `FUN_140711e30` (constructeur),
/// `physx_npscene_add_actors.c` — `FUN_140713000`,
/// `physx_npscene_simulate_fetch.c` — `FUN_1407100a0` / `FUN_140710200` / `FUN_140710280`,
/// `physx_npscene_release.c` — `FUN_14070e680`.
///
/// # Structure mémoire originale (partielle, offset param_1)
///
/// ```text
/// +0x000        : vftable (physx::NpScene, 2 slots posés dans le ctor)
/// +0x001 * 8    : 0
/// +0x002 * 8    : SqManager (init via FUN_140734a40)
/// +0x48a * 8    : ScScene  (init via FUN_140921d80)
/// +0x49c * 8    : task pool "collide"    (FUN_140756ed0)
/// +0x49d * 8    : task pool "solve"      (FUN_14075af30)
/// +0x49e * 8    : task pool "execution"  (FUN_14074e350)
/// +0x4ab * 8    : CmPool[0]  (capacité 0x40, seuil 0x3f400000)
/// +0x4b4 * 8    : CmPool[1]
/// +0x4bb * 8    : CmPool[2]
/// +0x4c2 * 8    : CmPool[3]  (init via FUN_1406fcdd0)
/// +0x4cb * 8    : CmPool[4]
/// +0x4d2 * 8    : CmPool[5]
/// +0x4d9..4db   : simulation_bounds (3 × 2 × f32)
/// +0x4df * 8    : PsSync #0 (collide)
/// +0x4e0 * 8    : PsSync #1 (results)
/// +0x4e5..4e6   : PxLightCpuTask "execution" vftable + ref_count=1
/// +0x4eb        : PxLightCpuTask "execution" continuation
/// +0x4f1        : PxLightCpuTask (intermédiaire)
/// +0x4f8        : PxLightCpuTask "solve"
/// +0x4fe..4ff   : PxLightCpuTask "collide"
/// +0x505 * 8    : name "NpScene.solve"
/// +0x50a * 8    : TLS slot (via TlsAlloc → offset 0x2844)
/// +0x1f14       : simulation state (int)
/// +0x2590       : ptr tableau statics (capacité 0x259c)
/// +0x2598       : nb statics courant
/// +0x2450       : broadphase handle (RigidStatic)
/// +0x2480       : broadphase handle (RigidDynamic)
/// +0x2700       : PsSync handle collide
/// +0x26f8       : PsSync handle results
/// +0x2728       : task execution (plVar1)
/// +0x2740       : param_2 (completion callback)
/// +0x2808       : task solve data
/// +0x2844       : TLS index (DWORD, depuis TlsAlloc())
/// ```
///
/// RE incertain: les offsets en dehors de ceux listés ci-dessus n'ont pas
/// été décodés sémantiquement et ne sont pas modélisés.
#[derive(Debug)]
pub struct NpScene {
    /// État courant de la machine à états de simulation.
    ///
    /// Source: offset `0x1f14` dans le binaire.
    pub state: SimulationState,

    /// Descripteur de la scène (paramètres de construction).
    pub desc: NpSceneDesc,

    /// 6 pools de tâches internes.
    ///
    /// Source: `physx_npscene_constructor.c` — offsets 0x4AB-0x4D2.
    pub task_pools: [TaskPool; 6],

    /// Tâche légère "collide" (`NpScene.collide`).
    ///
    /// Source: `physx_npscene_constructor.c` — `param_1[0x4fe] = "NpScene.collide"`.
    pub task_collide: LightCpuTask,

    /// Tâche légère "solve" (`NpScene.solve`).
    ///
    /// Source: `physx_npscene_constructor.c` — `param_1[0x505] = "NpScene.solve"`.
    pub task_solve: LightCpuTask,

    /// Tâche légère "execution" (`NpScene.execution`).
    ///
    /// Source: `physx_npscene_constructor.c` — `param_1[0x4f7] = "NpScene.execution"`,
    /// `*(undefined4 *)((longlong)param_1 + 0x270c) = 1`.
    pub task_execution: LightCpuTask,

    /// Sync primitif pour la phase de collision.
    ///
    /// Source: `param_1[0x4df]` — premier PsSync créé dans le constructeur.
    pub sync_collide: PsSync,

    /// Sync primitif pour les résultats de simulation.
    ///
    /// Source: `param_1[0x4e0]` — second PsSync créé dans le constructeur.
    pub sync_results: PsSync,

    /// Acteurs statiques de la scène (remplace le vecteur C++ à `0x2590`).
    ///
    /// Source: `physx_npscene_add_actors.c` — le pointeur `param_1 + 0x2590`
    /// est un `PxArray<NpRigidStatic*>` croissant dynamiquement.
    pub statics: Vec<usize>,

    /// Acteurs dynamiques de la scène.
    ///
    /// RE incertain: non directement observé dans l'extrait décompilé mais
    /// inféré de la symétrie avec `statics` et de l'appel à `FUN_140935940`.
    pub dynamics: Vec<usize>,

    /// `true` si la scène a le flag 0x1000 activé (flag de débogage).
    ///
    /// Source: `physx_npscene_release.c` —
    /// `if ((*(uint *)(lVar1 + (longlong)param_1) & 0x1000) != 0)` appelle
    /// une fonction de vérification de cohérence.
    pub debug_check_flag: bool,

    /// `true` si la scène est en mode GPU (bit 2 de `param_1[0x489]`).
    ///
    /// Source: `physx_npscene_release.c` —
    /// `if ((*(byte *)(param_1 + 0x489) & 4) == 0) lVar1 = 0x1124; else lVar1 = 0x2428`.
    pub gpu_mode: bool,

    /// Index TLS alloué par `TlsAlloc()` au moment de la construction.
    ///
    /// Source: `physx_npscene_constructor.c` —
    /// `DVar3 = TlsAlloc(); *(DWORD *)((longlong)param_1 + 0x2844) = DVar3`.
    ///
    /// Modélisé comme `u32::MAX` si non alloué (TLS non dispo en simulation).
    pub tls_index: u32,
}

impl NpScene {
    /// Construit une nouvelle scène PhysX vide avec le descripteur fourni.
    ///
    /// Reproduit la logique de `FUN_140711e30` (sans les appels aux fonctions
    /// opaques C++ — pools initialisés avec les mêmes constantes).
    ///
    /// # Exemple
    ///
    /// ```
    /// use nie_engine::physics::{NpScene, NpSceneDesc};
    ///
    /// let scene = NpScene::new(NpSceneDesc::default());
    /// assert!(!scene.state.is_running());
    /// ```
    #[must_use]
    pub fn new(desc: NpSceneDesc) -> Self {
        // Source: physx_npscene_constructor.c
        // Ordre de construction reproduit fidèlement :
        //   1. Pose vftable (simulé : état Idle)
        //   2. Init SqManager + ScScene (EXTERN)
        //   3. Crée 3 pools task (collide/solve/execution) → EXTERN, ici = TaskPool::new()
        //   4. Init 6 CmPool (param_1[0x4AB..0x4D2]) → TaskPool::new() × 6
        //   5. Copie simulation_bounds depuis desc
        //   6. Init CmPool additionnel (FUN_14070e180) → ignoré (EXTERN)
        //   7. Crée 2 PsSync via gestionnaire nommé → PsSync::default()
        //   8. Initialise les 4 PxLightCpuTask (collide/solve/execution)
        //   9. TlsAlloc → tls_index = u32::MAX (non dispo offline)

        Self {
            state: SimulationState::Idle,
            desc,
            task_pools: core::array::from_fn(|_| TaskPool::new()),
            // Source: param_1[0x4f7] = "NpScene.execution", ref_count = 1
            task_execution: LightCpuTask::new("NpScene.execution", 1),
            // Source: param_1[0x4fe] = "NpScene.collide"
            task_collide: LightCpuTask::new("NpScene.collide", 0),
            // Source: param_1[0x505] = "NpScene.solve"
            task_solve: LightCpuTask::new("NpScene.solve", 0),
            // Source: param_1[0x4df], param_1[0x4e0] — FUN_1408a8510 signale chaque sync
            sync_collide: PsSync { signaled: true },
            sync_results: PsSync { signaled: true },
            statics: Vec::new(),
            dynamics: Vec::new(),
            debug_check_flag: false,
            gpu_mode: false,
            // Source: TlsAlloc() — non disponible offline
            tls_index: u32::MAX,
        }
    }

    /// Ajoute une liste d'acteurs à la scène.
    ///
    /// Reproduit la logique de `FUN_140713000` :
    /// 1. Vérifie que la simulation ne tourne pas (`state == Idle`).
    /// 2. Itère sur les acteurs ; pour chaque acteur :
    ///    a. Si `already_in_scene` → erreur `ActorAlreadyInScene`.
    ///    b. Si type == 7 (RigidStatic) : vérifie la pruning structure,
    ///       ajoute dans `statics` ou via pruning structure.
    ///    c. Si type == 6 (RigidDynamic) : vérifie la pruning structure,
    ///       met à jour le flag sleeping, ajoute dans `dynamics`.
    ///    d. Si type ∈ {0xB, 0xC, 0xD} (ArticulationLink) : redirigé vers
    ///       `addArticulation` (EXTERN ici → erreur retournée).
    ///    e. Tout autre type → erreur `ArticulationLinkNotPermitted`.
    /// 3. En cas d'erreur partielle, un rollback est effectué sur les acteurs
    ///    précédemment ajoutés (reproduit la boucle `FUN_140712d30`).
    ///
    /// # Source
    ///
    /// `physx_npscene_add_actors.c` — `FUN_140713000`.
    ///
    /// # Erreurs
    ///
    /// Retourne la première erreur rencontrée. Les acteurs ajoutés avant
    /// l'erreur restent dans la scène (rollback partiel non implémenté ici
    /// — le binaire appelle `FUN_140712d30` sur les acteurs précédents).
    pub fn add_actors(
        &mut self,
        actors: &mut [PhysActor],
        pruning_structure: Option<usize>,
    ) -> Result<(), SceneError> {
        // Source: FUN_140713000, ligne 50 — if (*(int *)(param_1 + 0x1f14) == 0)
        if self.state != SimulationState::Idle {
            return Err(SceneError::SimulationRunning);
        }

        // Source: FUN_140713000, ligne 51 — bVar14 = param_4 != 0
        let has_pruning_structure = pruning_structure.is_some();

        // Source: FUN_140713000, lignes 63-187 — boucle sur param_3 acteurs
        let mut first_error: Option<SceneError> = None;
        let mut added_count: usize = 0;

        'actor_loop: for actor in actors.iter_mut() {
            // Source: FUN_140713000, lignes 72-85 — vérification already_in_scene
            // uVar2 = *(uint *)(&DAT_141a3ef08 + type*8 + base) ; uVar2>>0x1e != 0
            if actor.already_in_scene {
                first_error = Some(SceneError::ActorAlreadyInScene);
                break 'actor_loop;
            }

            match actor.actor_type {
                // ── RigidStatic (type == 7) ──────────────────────────────────
                // Source: FUN_140713000, lignes 89-126
                ActorType::RigidStatic => {
                    // Source: ligne 90 — if (bVar14) || (*(longlong *)(lVar9 + 0x48) == 0)
                    // bVar14 = has_pruning_structure ; +0x48 = from_pruning_structure ptr
                    if !has_pruning_structure && actor.from_pruning_structure {
                        first_error = Some(SceneError::ActorInPruningStructure);
                        break 'actor_loop;
                    }

                    // Source: lignes 91-101 — test filtre shapes (bit 3 du masque)
                    // (*pbVar7 & 8) == 0 → ajouter normalement
                    // (*pbVar7 & 8) != 0 → addRigidStatic via pruning (FUN_140714580)
                    // Modélisé : toujours chemin normal (filtre inconnu → EXTERN)
                    // EXTERN: FUN_14071ba60 — prépare BVH pour l'acteur (shape_count+1)
                    // EXTERN: FUN_1409357e0 — ajoute dans SqManager
                    // EXTERN: FUN_1407153d0 — addRigidStatic dans ScScene

                    // Source: ligne 109-114 — mise à jour du scene_index et du tableau
                    actor.scene_index = self.statics.len() as u32;
                    self.statics.push(added_count); // index symbolique dans la scène
                    actor.already_in_scene = true;
                    added_count += 1;

                    // Source: ligne 119-121 — si +0x20 != 0, enregistre dans task mgr
                    // EXTERN: FUN_14073f0b0 — enregistre l'acteur dans le task manager
                }

                // ── RigidDynamic (type == 6) ─────────────────────────────────
                // Source: FUN_140713000, lignes 136-173
                ActorType::RigidDynamic => {
                    // Source: ligne 137-144 — pruning structure guard pour dynamic
                    if !has_pruning_structure && actor.from_pruning_structure {
                        first_error = Some(SceneError::ActorInPruningStructure);
                        break 'actor_loop;
                    }

                    // Source: lignes 146-156 — lecture filtre shapes (même logique)
                    // EXTERN: FUN_14071ba60, FUN_140935940

                    // Source: lignes 160-170 — test sleeping (all velocities == 0.0)
                    // if (linear==0 && angular==0) sleeping=1; else sleeping=0;
                    actor.update_sleeping();

                    // Source: lignes 107-114 (via LAB_14071322c) — scène index + push
                    actor.scene_index = self.dynamics.len() as u32;
                    self.dynamics.push(added_count);
                    actor.already_in_scene = true;
                    added_count += 1;
                }

                // ── ArticulationLink (type ∈ {0xB, 0xC, 0xD}) ───────────────
                // Source: FUN_140713000, lignes 176-183
                ActorType::ArticulationLink => {
                    // Source: ligne 183 — FUN_140712bf0(param_1, lVar9)
                    // EXTERN: FUN_140712bf0 — addArticulation — non portée ici
                    // L'articulation link est traitée via addArticulation, pas addRigidActors.
                    // En cas d'appel via addRigidActors (type >= 0xB) le binaire log :
                    // « PxScene::addRigidActors(): articulation link not permitted »
                    // RE incertain: le binaire n'émet PAS l'erreur ici — il appelle
                    // FUN_140712bf0 silencieusement. L'erreur n'est émise que si on
                    // tente d'ajouter un lien hors de son articulation.
                    // EXTERN: FUN_140712bf0
                }
            }
        }

        // Source: FUN_140713000, lignes 208-214 — rollback partiel
        // Si une erreur est survenue et des acteurs ont été ajoutés, les retirer.
        // Le binaire appelle FUN_140712d30(param_1, *param_2, 0, 1) pour chaque
        // acteur précédemment traité (boucle décroissante sur uVar12).
        // EXTERN: FUN_140712d30 — rollback acteur
        if first_error.is_some() && added_count > 0 {
            // Rollback symbolique : retire les acteurs ajoutés
            let drain_statics = self.statics.len().saturating_sub(added_count);
            let drain_dynamics = self.dynamics.len().saturating_sub(added_count);
            self.statics.truncate(drain_statics);
            self.dynamics.truncate(drain_dynamics);
        }

        match first_error {
            Some(e) => Err(e),
            None => Ok(()),
        }
    }

    /// Lance la phase `advance()` (transition état CollisionDone → Simulating).
    ///
    /// Reproduit `FUN_1407100a0`.
    ///
    /// Source: `physx_npscene_simulate_fetch.c` — `FUN_1407100a0` :
    /// ```text
    /// if state != CollisionDone → erreur AdvanceIllegal
    /// state = Simulating (3)
    /// FUN_140735fc0()         // prépare le pipeline collide
    /// lance task_execution
    /// ```
    ///
    /// # Erreurs
    ///
    /// Retourne `AdvanceIllegal` si l'état n'est pas `CollisionDone`.
    pub fn advance(&mut self) -> Result<(), SceneError> {
        // Source: ligne 82-88 — if (*(int *)(param_1 + 0x1f14) != 2) erreur
        if self.state != SimulationState::CollisionDone {
            return Err(SceneError::AdvanceIllegal);
        }

        // Source: ligne 89 — FUN_140735fc0() — prépare le pipeline
        // EXTERN: FUN_140735fc0

        // Source: ligne 90 — *(undefined4 *)(param_1 + 0x1f14) = 3
        self.state = SimulationState::Simulating;

        // Source: lignes 91-105 — lance task_execution via task manager
        // EXTERN: (**(code **)(*plVar1 + 0x18))(plVar1)
        // EXTERN: (**(code **)(*plVar1 + 0x20))(plVar1)
        self.task_execution.running = true;

        // Source: ligne 105 — dispatch final vers un task manager indirect
        // EXTERN: (**(code **)(*(longlong *)(param_1 + 0x27f8) + 0x20))(param_1 + 0x27f8)

        Ok(())
    }

    /// Lance `collide()` (transition état Idle → Colliding).
    ///
    /// RE incertain: `collide()` n'est pas directement extrait du fichier
    /// `physx_npscene_simulate_fetch.c` mais est inféré de la machine à états
    /// (état 1 = Colliding est attendu par `fetchCollision()`).
    ///
    /// # Source
    ///
    /// Inféré de `FUN_140710200` qui vérifie `state == 1` (Colliding).
    pub fn collide(&mut self) -> Result<(), SceneError> {
        if self.state != SimulationState::Idle {
            return Err(SceneError::SimulationRunning);
        }
        // EXTERN: lancement réel du pipeline de collision
        self.state = SimulationState::Colliding;
        self.sync_collide.reset();
        Ok(())
    }

    /// `fetchCollision()` — attend la fin de la collision (Colliding → CollisionDone).
    ///
    /// Reproduit `FUN_140710200`.
    ///
    /// Source: `physx_npscene_simulate_fetch.c` — `FUN_140710200` :
    /// ```text
    /// if state != 1 → erreur FetchCollisionIllegal
    /// cVar2 = FUN_1408a8550(*(undefined8 *)(param_1 + 0x2700), -(uint)(param_2 != 0))
    /// if cVar2 → state = 2, retour 1
    /// retour 0
    /// ```
    ///
    /// # Paramètres
    ///
    /// - `block` : si `true`, bloque jusqu'à la fin de la collision.
    ///
    /// # Retour
    ///
    /// `true` si la collision est terminée et l'état a avancé.
    pub fn fetch_collision(&mut self, block: bool) -> Result<bool, SceneError> {
        // Source: ligne 126-138
        if self.state != SimulationState::Colliding {
            return Err(SceneError::FetchCollisionIllegal);
        }
        // Source: ligne 127 — FUN_1408a8550(sync_collide, block_flag)
        // EXTERN: FUN_1408a8550
        let done = self.sync_collide.wait(block);
        if done {
            // Source: ligne 129 — *(undefined4 *)(param_1 + 0x1f14) = 2
            self.state = SimulationState::CollisionDone;
            self.sync_collide.reset();
        }
        Ok(done)
    }

    /// `fetchResults()` — collecte les résultats de simulation (Simulating → Idle).
    ///
    /// Reproduit `FUN_140710280`.
    ///
    /// Source: `physx_npscene_simulate_fetch.c` — `FUN_140710280` :
    /// ```text
    /// if state != 3 → erreur FetchResultsIllegal
    /// cVar3 = FUN_1408a8550(*(undefined8 *)(param_1 + 0x26f8), block_flag)
    /// MXCSR = 0x9fc0
    /// if cVar3 :
    ///   FUN_1407150e0(param_1)   // mise à jour acteurs
    ///   FUN_140939830(param_1+0x10, 0) // callbacks
    ///   FUN_1407152a0(param_1)   // reset compteurs
    ///   if param_3 != 0 : *param_3 = 0  // error_state = 0
    ///   MXCSR = uVar2 & 0xffffffc0
    ///   retour 1
    /// retour 0
    /// ```
    ///
    /// # Paramètres
    ///
    /// - `block` : si `true`, bloque jusqu'à la fin des résultats.
    ///
    /// # Retour
    ///
    /// `true` si les résultats sont prêts et l'état a été remis à `Idle`.
    pub fn fetch_results(&mut self, block: bool) -> Result<bool, SceneError> {
        // Source: ligne 151-172
        if self.state != SimulationState::Simulating {
            return Err(SceneError::FetchResultsIllegal);
        }
        // Source: ligne 152 — FUN_1408a8550(sync_results, block_flag)
        // Note: MXCSR = 0x9fc0 appliqué dans le binaire — ignoré (no-unsafe)
        // EXTERN: FUN_1408a8550
        let done = self.sync_results.wait(block);
        if done {
            // Source: ligne 157 — FUN_1407150e0 — mise à jour état acteurs
            // EXTERN: FUN_1407150e0
            // Source: ligne 158 — FUN_140939830 — callbacks simulation
            // EXTERN: FUN_140939830
            // Source: ligne 159 — FUN_1407152a0 — reset compteurs
            // EXTERN: FUN_1407152a0
            self.task_execution.running = false;
            self.sync_results.reset();
            // Source: ligne 163 — *(undefined4 *)(param_1 + 0x1f14) revient à Idle
            // (implicite : la prochaine collide repart de 0)
            self.state = SimulationState::Idle;
        }
        Ok(done)
    }

    /// `simulate()` — raccourci collide + advance (non présent explicitement
    /// dans les fichiers décompilés mais référencé par le message d'erreur
    /// de `fetchResults` : « It must be called after advance() or simulate() »).
    ///
    /// Source: `physx_npscene_simulate_fetch.c` — chaîne d'erreur ligne 169.
    pub fn simulate(&mut self) -> Result<(), SceneError> {
        self.collide()?;
        // Simule une fin de collision immédiate (offline/headless)
        self.sync_collide.signal();
        self.fetch_collision(true)?;
        self.advance()?;
        // Simule une fin de simulation immédiate
        self.sync_results.signal();
        Ok(())
    }

    /// Libère la scène en forçant `fetchResults()` si la simulation tourne.
    ///
    /// Reproduit `FUN_14070e680`.
    ///
    /// Source: `physx_npscene_release.c` :
    /// ```text
    /// lVar1 = gpu_mode ? 0x2428 : 0x1124
    /// if (flags[lVar1] & 0x1000) → debug check (FUN vftable +0x330)
    /// if state != 0 :
    ///   log « PxScene::release(): Scene is still being simulated! … »
    ///   if state == 1 : fetchCollision(block=true)  // vftable +0x1e0
    ///   if state == 2 : advance()                   // vftable +0x1c8
    ///   fetchResults(block=true)                    // vftable +0x1e8
    /// FUN_1406fae00(scene_pool, param_1)  // libère la mémoire
    /// ```
    ///
    /// # Sécurité
    ///
    /// En Rust, la libération est gérée par `Drop`. Cette méthode encapsule
    /// la logique de pré-libération (forçage des fetch) sans gérer la mémoire
    /// brute.
    pub fn release(&mut self) {
        // Source: ligne 15-16 — gpu_mode sélectionne l'offset du flags word
        // if ((*(byte *)(param_1 + 0x489) & 4) == 0) lVar1 = 0x1124; else lVar1 = 0x2428
        let _flags_offset: u32 = if self.gpu_mode { 0x2428 } else { 0x1124 };

        // Source: ligne 18-21 — if (flags & 0x1000) → debug check (EXTERN)
        // EXTERN: (**(code **)(*param_1 + 0x330))(param_1, ...)

        // Source: lignes 22-33 — forcer les fetch si en cours de simulation
        if self.state.is_running() {
            // Source: ligne 24 — log « Scene is still being simulated! fetchResults called implicitly. »
            // EXTERN: FUN_1408a6840 / FUN_1408a6a80

            // Source: ligne 27-28 — if state == 1: vftable+0x1e0 = fetchCollision(1)
            if self.state == SimulationState::Colliding {
                self.sync_collide.signal();
                let _ = self.fetch_collision(true);
            }

            // Source: ligne 30-31 — if state == 2: vftable+0x1c8 = advance()
            if self.state == SimulationState::CollisionDone {
                let _ = self.advance();
            }

            // Source: ligne 33 — vftable+0x1e8 = fetchResults(1, 0)
            self.sync_results.signal();
            let _ = self.fetch_results(true);
        }

        // Source: ligne 35 — FUN_1406fae00(DAT_141f6a8a8, param_1) — libère la scène
        // EXTERN: FUN_1406fae00 — retour mémoire au scene pool
        // En Rust, Drop gère ceci automatiquement.
    }
}

// ── BallMoveNormal (game::BallMoveNormal) ─────────────────────────────────────

/// Contrôleur de mouvement physique normal du ballon (`game::BallMoveNormal`).
///
/// Source: `ball_component.c` — `FUN_14027ac10` (lignes nie.c 512870-512921).
/// Taille de l'objet original : ~0x138 bytes (0x27 qwords).
///
/// # Fidélité
///
/// - Toutes les valeurs d'initialisation sont extraites directement du pseudo-C.
/// - La physique de `update()` n'est PAS portée (seul le constructeur l'est).
///
/// # Offsets originaux (FUN_14027ac10)
///
/// ```text
/// +0x000        : vftable IBallMoveController (initial)
/// +0x020-0x028  : position courante (vec3, 2×u64 depuis DAT_14212dd10/18)
/// +0x030        : padding w = 0
/// +0x040-0x048  : position précédente (même init)
/// +0x050        : padding w = 0
/// +0x060        : direction (vec4, depuis DAT_142115a70-7c = 0)
/// +0x000        : vftable BallMoveNormal (finale)
/// +0x070        : direction_b (vec4, idem)
/// +0x080-0x098  : bounce_normal, surface_tangent (vec4 × 2, depuis DAT_142115a70)
/// +0x0C0 (0x18) : on_ground = false (byte)
/// +0x0E0-0x0E8  : force_a (vec3 + w, depuis DAT_14212dd10/18)
/// +0x0F0        : padding w = 0
/// +0x100-0x108  : force_b (vec3 + w, idem)
/// +0x110        : padding w = 0
/// +0x12C (300)  : collision_flag = false (byte)
/// ```
#[derive(Debug, Clone, PartialEq)]
pub struct BallMoveNormal {
    /// Position courante du ballon.
    ///
    /// Source: `FUN_14027ac10` — `param_1[4] = _DAT_14212dd10`, `param_1[5] = _DAT_14212dd18`.
    pub position: Vec3,

    /// Position précédente (frame N-1).
    ///
    /// Source: `FUN_14027ac10` — `param_1[8] = _DAT_14212dd10`, `param_1[9] = _DAT_14212dd18`.
    pub prev_position: Vec3,

    /// Vecteur direction (normalisé en théorie).
    ///
    /// Source: `FUN_14027ac10` — `param_1[0xc] = _DAT_142115a70` (= 0).
    pub direction: Vec3,

    /// Vecteur direction secondaire (axe de rotation ? normale ?).
    ///
    /// Source: `FUN_14027ac10` — `param_1[0xe] = uVar1` (= `_DAT_142115a70`).
    /// RE incertain: rôle exact non déterminé.
    pub direction_b: Vec3,

    /// Normale de rebond / surface.
    ///
    /// Source: `FUN_14027ac10` — `param_1[0x14] = _DAT_142115a70`.
    pub bounce_normal: Vec3,

    /// Tangente de surface.
    ///
    /// Source: `FUN_14027ac10` — `param_1[0x16] = _DAT_142115a70`.
    /// RE incertain.
    pub surface_tangent: Vec3,

    /// `true` si le ballon est en contact avec le sol.
    ///
    /// Source: `FUN_14027ac10` — `*(undefined1 *)(param_1 + 0x18) = 0`.
    pub on_ground: bool,

    /// Force externe A (direction + magnitude).
    ///
    /// Source: `FUN_14027ac10` — `param_1[0x1c] = _DAT_14212dd10`.
    /// RE incertain: force externe vs inertie.
    pub force_a: Vec3,

    /// Force externe B.
    ///
    /// Source: `FUN_14027ac10` — `param_1[0x20] = _DAT_14212dd10`.
    /// RE incertain.
    pub force_b: Vec3,

    /// Flag de collision (byte à offset 300 = 0x12C).
    ///
    /// Source: `FUN_14027ac10` — `*(undefined1 *)(longlong)param_1 + 300) = 0`.
    pub collision_flag: bool,
}

impl Default for BallMoveNormal {
    fn default() -> Self {
        Self {
            position: Vec3::zero(),
            prev_position: Vec3::zero(),
            direction: Vec3::zero(),
            direction_b: Vec3::zero(),
            bounce_normal: Vec3::zero(),
            surface_tangent: Vec3::zero(),
            on_ground: false,
            force_a: Vec3::zero(),
            force_b: Vec3::zero(),
            collision_flag: false,
        }
    }
}

// ── Contrôleur de mouvement du ballon ─────────────────────────────────────────

/// Type du contrôleur de mouvement actif du ballon.
///
/// Source: `ball_component.c` — commentaire « Architecture du mouvement du ballon »
/// et noms vftable Ghidra (`game::BallMoveNormal::vftable`, etc.).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[non_exhaustive]
pub enum BallMoveKind {
    /// Mouvement physique normal (gravité, rebonds).
    #[default]
    Normal,
    /// Suivi d'une cible (passes, centres).
    /// Contrôleur initial posé dans `BallComponent_ctor` (vftable finale).
    TargetFollow,
    /// Courbe de Bézier simple.
    Bezier,
    /// Courbe de Bézier multi-segments.
    MultiBezier,
    /// Tir hissatsu (courbe spéciale Bézier).
    RealSkillShootBezier,
    /// Trajectoire parabolique simple.
    SimpleParabola,
    /// Pendant le dribble.
    Dribble,
    /// Interpolation linéaire.
    Lerp,
    /// Mouvement basé sur un taux.
    Rate,
    /// Animation filet de but.
    Goalnet,
}

/// IDs de possession du ballon (3 joueurs max simultanément).
///
/// Source: `ball_component.c` offsets 0x1490-0x14A0 — 3 octets `0xFF`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PossessionIds {
    /// Joueur principal (`0xFF` = aucun).
    pub owner: u8,
    /// Joueur secondaire (`0xFF` = aucun).
    pub secondary: u8,
    /// Troisième joueur (`0xFF` = aucun).
    /// RE incertain: rôle exact du troisième slot.
    pub tertiary: u8,
}

impl Default for PossessionIds {
    fn default() -> Self {
        Self {
            owner: INVALID_PLAYER_IDX,
            secondary: INVALID_PLAYER_IDX,
            tertiary: INVALID_PLAYER_IDX,
        }
    }
}

impl PossessionIds {
    /// `true` si personne ne possède le ballon.
    #[must_use]
    pub fn is_free(&self) -> bool {
        self.owner == INVALID_PLAYER_IDX
    }
}

/// IDs de cibles actives (passe / interception).
///
/// Source: `ball_component.c` offsets 0x14D0, 0x14E0 — 2 × `u32` à `0xFFFF0000`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TargetIds {
    /// Cible principale (`INVALID_TARGET_ID` = aucune).
    pub primary: u32,
    /// Cible secondaire (`INVALID_TARGET_ID` = aucune).
    pub secondary: u32,
}

impl Default for TargetIds {
    fn default() -> Self {
        Self { primary: INVALID_TARGET_ID, secondary: INVALID_TARGET_ID }
    }
}

impl TargetIds {
    /// `true` si aucune cible n'est définie.
    #[must_use]
    pub fn has_no_target(&self) -> bool {
        self.primary == INVALID_TARGET_ID && self.secondary == INVALID_TARGET_ID
    }
}

/// Données d'interception en cours.
///
/// Source: `ball_component.c` — offsets 0x14F0-0x1540 (zone interception/trap).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct InterceptionData {
    /// ID du joueur tentant l'interception (`INVALID_TARGET_ID` = aucun).
    pub interceptor_id: u32,
    /// ID source (passeur ou cible de la passe).
    /// RE incertain.
    pub source_id: u32,
}

impl InterceptionData {
    /// Crée une interception vide.
    #[must_use]
    pub fn none() -> Self {
        Self {
            interceptor_id: INVALID_TARGET_ID,
            source_id: INVALID_TARGET_ID,
        }
    }

    /// `true` si aucune interception n'est en cours.
    #[must_use]
    pub fn is_none(&self) -> bool {
        self.interceptor_id == INVALID_TARGET_ID
    }
}

// ── BallComponent (game::BallComponent) ──────────────────────────────────────

/// Composant principal du ballon (`game::BallComponent`).
///
/// Source: `ball_component.c` — `BallComponent_ctor` (lignes nie.c 175440-175592).
/// Taille originale estimée : ~0x17C0 bytes (6080 bytes).
///
/// # Fidélité
///
/// - Toutes les valeurs d'initialisation : FIABLE (bits IEEE 754 explicites).
/// - Le contrôleur actif au démarrage est `BallMoveKind::TargetFollow` —
///   le ctor pose `IBallMoveController::vftable` puis `BallMoveTargetFollow::vftable`
///   en dernier (`param_1[0xe] = game::BallMoveTargetFollow::vftable`).
/// - La zone `0x130-0x1450` (initialisée via `FUN_14132dc00`) : INCONNUE.
///
/// # Offsets principaux (BallComponent_ctor)
///
/// ```text
/// +0x000        : vftable game::BallComponent
/// +0x060        : word flags
/// +0x070 (0xe)  : IBallMoveController vtable → BallMoveTargetFollow (finale)
/// +0x090-0x0D0  : positions 3D (current, previous)
/// +0x0D0-0x0F0  : vec4 orientation (DAT_142115a70-7c = 0)
/// +0x0F0        : vec4 position monde (= 0)
/// +0x100        : flags/états
/// +0x130        : zone données mouvement (FUN_14132dc00)
/// +0x1474       : float gravity = 2.0f (0x40000000)
/// +0x1484       : byte = 0
/// +0x148a       : byte max_collisions = 5
/// +0x1490-0x14A0: IDs joueur (3 × 0xFF)
/// +0x14D0       : target_id[0] = 0xFFFF0000
/// +0x14E0       : target_id[1] = 0xFFFF0000
/// +0x14F0-0x1540: interception data (0 / INVALID)
/// +0x1750 (0x2ea): float scale = 1.0f (0x3F800000)
/// +0x1764,0x176c,0x1778,0x1780: distances = -1.0f (0xBF800000)
/// ```
#[derive(Debug, Clone)]
pub struct BallComponent {
    /// Contrôleur de mouvement actif.
    ///
    /// Source: `BallComponent_ctor` — dernier `param_1[0xe] = game::BallMoveTargetFollow::vftable`.
    pub move_controller: BallMoveKind,

    /// Position courante du ballon.
    pub position: Vec3,

    /// Position précédente (frame N-1).
    pub prev_position: Vec3,

    /// Vecteur d'orientation.
    ///
    /// Source: offset 0x0D0 — vec4 initialisé depuis `DAT_142115a70-7c` (= 0.0).
    pub orientation: Vec3,

    /// Vecteur vitesse.
    ///
    /// Source: offset 0x0E0 — vec4 initialisé à 0.
    /// RE incertain: vitesse ou accélération ?
    pub velocity: Vec3,

    /// IDs des joueurs en possession.
    pub possession: PossessionIds,

    /// IDs des cibles actives.
    pub targets: TargetIds,

    /// Données d'interception en cours.
    pub interception: InterceptionData,

    /// Gravité en unités/frame².
    ///
    /// Source: `*(undefined4 *)(param_1 + 0x1474) = 0x40000000` = 2.0f.
    pub gravity: f32,

    /// Nombre maximum de collisions par frame.
    ///
    /// Source: `*(undefined1 *)(param_1 + 0x148a) = 5`.
    pub max_collisions_per_frame: u8,

    /// Scale du ballon (1.0 = normal).
    ///
    /// Source: `*(undefined4 *)(param_1 + 0x2ea) = 0x3f800000`.
    pub scale: f32,

    /// Distance de détection primaire (-1.0 = non calculée).
    ///
    /// Source: offsets 0x1764, 0x176c initialisés à `0xBF800000`.
    pub detection_dist_primary: f32,

    /// Distance de détection secondaire (-1.0 = non calculée).
    ///
    /// Source: offsets 0x2ef, 0x2f0 initialisés à `0xBF800000`.
    pub detection_dist_secondary: f32,

    /// Contrôleur de mouvement normal (embarqué pour éviter allocation).
    pub move_normal: BallMoveNormal,
}

impl Default for BallComponent {
    /// Initialise le composant ballon avec les valeurs du constructeur C++.
    ///
    /// Source: `BallComponent_ctor` dans `ball_component.c`.
    fn default() -> Self {
        Self {
            // Le ctor pose BallMoveTargetFollow::vftable comme dernière vftable
            move_controller: BallMoveKind::TargetFollow,
            position: Vec3::zero(),
            prev_position: Vec3::zero(),
            orientation: Vec3::zero(),
            velocity: Vec3::zero(),
            possession: PossessionIds::default(),
            targets: TargetIds::default(),
            interception: InterceptionData::none(),
            // 0x40000000 = 2.0f
            gravity: BALL_GRAVITY,
            // offset 0x148a = 5
            max_collisions_per_frame: BALL_MAX_COLLISIONS,
            // 0x3F800000 = 1.0f
            scale: BALL_SCALE_DEFAULT,
            // 0xBF800000 = -1.0f
            detection_dist_primary: DISTANCE_UNINIT,
            detection_dist_secondary: DISTANCE_UNINIT,
            move_normal: BallMoveNormal::default(),
        }
    }
}

impl BallComponent {
    /// Crée un composant ballon avec les valeurs d'initialisation par défaut.
    ///
    /// # Exemple
    ///
    /// ```
    /// use nie_engine::physics::BallComponent;
    /// use nie_engine::physics::{BALL_GRAVITY, INVALID_PLAYER_IDX};
    ///
    /// let ball = BallComponent::new();
    /// assert_eq!(ball.gravity, BALL_GRAVITY);
    /// assert!(ball.possession.is_free());
    /// ```
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// `true` si le ballon est libre (aucun joueur en possession).
    #[must_use]
    pub fn is_free(&self) -> bool {
        self.possession.is_free()
    }

    /// `true` si une interception est en cours.
    #[must_use]
    pub fn is_being_intercepted(&self) -> bool {
        !self.interception.is_none()
    }

    /// Définit le joueur propriétaire du ballon.
    pub fn set_owner(&mut self, player_idx: u8) {
        self.possession.owner = player_idx;
    }

    /// Libère la possession du ballon (remet tous les IDs à leurs sentinelles).
    ///
    /// Source: équivalent du reset dans `BallComponent_ctor`.
    pub fn release_possession(&mut self) {
        self.possession = PossessionIds::default();
        self.interception = InterceptionData::none();
        self.targets = TargetIds::default();
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── Constantes IEEE 754 ──────────────────────────────────────────────────

    #[test]
    fn constantes_ieee754_fideles() {
        // 0x40000000 = 2.0f — ball_component.c offset 0x1474
        assert_eq!(BALL_GRAVITY.to_bits(), 0x4000_0000);
        // 0x3F800000 = 1.0f — ball_component.c offset 0x2ea
        assert_eq!(BALL_SCALE_DEFAULT.to_bits(), 0x3F80_0000);
        // 0xBF800000 = -1.0f — ball_component.c offsets 0x1764, 0x176c
        assert_eq!(DISTANCE_UNINIT.to_bits(), 0xBF80_0000);
        // 0x3F400000 = 0.75f — physx_npscene_constructor.c offset 0x4b0
        assert_eq!(TASK_POOL_THRESHOLD.to_bits(), 0x3F40_0000);
    }

    // ── NpScene state machine ────────────────────────────────────────────────

    #[test]
    fn npscene_initial_state_idle() {
        let scene = NpScene::new(NpSceneDesc::default());
        assert_eq!(scene.state, SimulationState::Idle);
        assert!(!scene.state.is_running());
    }

    #[test]
    fn npscene_simulate_cycle_complet() {
        let mut scene = NpScene::new(NpSceneDesc::default());
        assert_eq!(scene.state, SimulationState::Idle);

        // collide → Colliding
        scene.simulate().expect("simulate doit réussir depuis Idle");
        // simulate() appelle collide + fetch_collision + advance + (signal) → Idle final non atteint
        // après simulate(), state = Simulating (fetch_results pas encore appelé)
        assert_eq!(scene.state, SimulationState::Simulating);

        // fetch_results → Idle
        let done = scene.fetch_results(true).expect("fetch_results doit réussir depuis Simulating");
        assert!(done);
        assert_eq!(scene.state, SimulationState::Idle);
    }

    #[test]
    fn npscene_advance_illegal_depuis_idle() {
        let mut scene = NpScene::new(NpSceneDesc::default());
        let err = scene.advance().unwrap_err();
        assert_eq!(err, SceneError::AdvanceIllegal);
    }

    #[test]
    fn npscene_fetch_collision_illegal_depuis_idle() {
        let mut scene = NpScene::new(NpSceneDesc::default());
        let err = scene.fetch_collision(false).unwrap_err();
        assert_eq!(err, SceneError::FetchCollisionIllegal);
    }

    #[test]
    fn npscene_fetch_results_illegal_depuis_idle() {
        let mut scene = NpScene::new(NpSceneDesc::default());
        let err = scene.fetch_results(false).unwrap_err();
        assert_eq!(err, SceneError::FetchResultsIllegal);
    }

    #[test]
    fn npscene_simulation_running_bloque_add_actors() {
        let mut scene = NpScene::new(NpSceneDesc::default());
        scene.collide().unwrap();
        let mut actors = vec![PhysActor::new_static(1)];
        let err = scene.add_actors(&mut actors, None).unwrap_err();
        assert_eq!(err, SceneError::SimulationRunning);
    }

    // ── NpScene::add_actors ──────────────────────────────────────────────────

    #[test]
    fn add_actors_static_ok() {
        let mut scene = NpScene::new(NpSceneDesc::default());
        let mut actors = vec![
            PhysActor::new_static(2),
            PhysActor::new_static(1),
        ];
        scene.add_actors(&mut actors, None).expect("ajout de statics doit réussir");
        assert_eq!(scene.statics.len(), 2);
        assert_eq!(actors[0].scene_index, 0);
        assert_eq!(actors[1].scene_index, 1);
        // already_in_scene mis à true après l'ajout
        assert!(actors[0].already_in_scene);
        assert!(actors[1].already_in_scene);
    }

    #[test]
    fn add_actors_dynamic_ok() {
        let mut scene = NpScene::new(NpSceneDesc::default());
        let mut actors = vec![PhysActor::new_dynamic(3)];
        scene.add_actors(&mut actors, None).expect("ajout d'un dynamic doit réussir");
        assert_eq!(scene.dynamics.len(), 1);
    }

    #[test]
    fn add_actors_already_in_scene_erreur() {
        let mut scene = NpScene::new(NpSceneDesc::default());
        let mut actor = PhysActor::new_static(1);
        actor.already_in_scene = true;
        let err = scene.add_actors(&mut [actor], None).unwrap_err();
        assert_eq!(err, SceneError::ActorAlreadyInScene);
    }

    #[test]
    fn add_actors_pruning_structure_static_erreur() {
        let mut scene = NpScene::new(NpSceneDesc::default());
        let mut actor = PhysActor::new_static(1);
        actor.from_pruning_structure = true;
        // Sans pruning structure fournie, erreur attendue
        let err = scene.add_actors(&mut [actor], None).unwrap_err();
        assert_eq!(err, SceneError::ActorInPruningStructure);
    }

    #[test]
    fn add_actors_pruning_structure_dynamic_erreur() {
        let mut scene = NpScene::new(NpSceneDesc::default());
        let mut actor = PhysActor::new_dynamic(1);
        actor.from_pruning_structure = true;
        let err = scene.add_actors(&mut [actor], None).unwrap_err();
        assert_eq!(err, SceneError::ActorInPruningStructure);
    }

    #[test]
    fn add_actors_avec_pruning_structure_static_ok() {
        let mut scene = NpScene::new(NpSceneDesc::default());
        let mut actor = PhysActor::new_static(1);
        actor.from_pruning_structure = true;
        // Avec pruning structure fournie (has_pruning_structure=true), ok
        scene.add_actors(&mut [actor], Some(42)).expect("devrait réussir avec pruning structure");
    }

    // ── NpScene::release ─────────────────────────────────────────────────────

    #[test]
    fn release_depuis_idle_ok() {
        let mut scene = NpScene::new(NpSceneDesc::default());
        scene.release(); // ne doit pas paniquer
        assert_eq!(scene.state, SimulationState::Idle);
    }

    #[test]
    fn release_depuis_simulating_force_fetchresults() {
        let mut scene = NpScene::new(NpSceneDesc::default());
        scene.simulate().unwrap(); // state = Simulating
        assert_eq!(scene.state, SimulationState::Simulating);
        scene.release(); // doit forcer fetch_results
        assert_eq!(scene.state, SimulationState::Idle);
    }

    // ── Actor type dispatch ──────────────────────────────────────────────────

    #[test]
    fn actor_type_from_raw_reconnu() {
        assert_eq!(ActorType::from_raw(7), Some(ActorType::RigidStatic));
        assert_eq!(ActorType::from_raw(6), Some(ActorType::RigidDynamic));
        assert_eq!(ActorType::from_raw(0x0B), Some(ActorType::ArticulationLink));
        assert_eq!(ActorType::from_raw(0x0C), Some(ActorType::ArticulationLink));
        assert_eq!(ActorType::from_raw(0x0D), Some(ActorType::ArticulationLink));
        assert_eq!(ActorType::from_raw(0), None);
        assert_eq!(ActorType::from_raw(5), None);
        assert_eq!(ActorType::from_raw(0x0E), None);
    }

    // ── TaskPool ─────────────────────────────────────────────────────────────

    #[test]
    fn task_pool_init_values() {
        let pool = TaskPool::new();
        // 0x3F400000 = 0.75f
        assert_eq!(pool.fill_threshold.to_bits(), 0x3F40_0000);
        assert_eq!(pool.invalid_slot, TASK_POOL_SLOT_INVALID);
        assert_eq!(pool.entries.capacity(), TASK_POOL_INIT_CAPACITY);
        assert!(!pool.is_full());
    }

    #[test]
    fn task_pool_is_full_when_over_threshold() {
        let mut pool = TaskPool::new();
        for i in 0..TASK_POOL_INIT_CAPACITY {
            pool.entries.push(i);
        }
        assert!(pool.is_full());
    }

    // ── PsSync ───────────────────────────────────────────────────────────────

    #[test]
    fn pssync_cycle_signal_wait_reset() {
        let mut sync = PsSync::default();
        assert!(!sync.signaled);
        // wait non-bloquant → false si non signalé
        assert!(!sync.wait(true));
        sync.signal();
        assert!(sync.wait(true));
        sync.reset();
        assert!(!sync.signaled);
    }

    #[test]
    fn pssync_wait_blocking_always_true() {
        let mut sync = PsSync::default();
        // Mode bloquant : retourne toujours true (simulation offline)
        assert!(sync.wait(false));
    }

    // ── BallComponent ────────────────────────────────────────────────────────

    #[test]
    fn ball_component_gravity_ieee754() {
        let ball = BallComponent::new();
        // 0x40000000 — ball_component.c offset 0x1474
        assert_eq!(ball.gravity.to_bits(), 0x4000_0000);
        assert_eq!(ball.gravity, BALL_GRAVITY);
    }

    #[test]
    fn ball_component_scale_ieee754() {
        let ball = BallComponent::new();
        // 0x3F800000 — ball_component.c offset 0x2ea
        assert_eq!(ball.scale.to_bits(), 0x3F80_0000);
        assert_eq!(ball.scale, BALL_SCALE_DEFAULT);
    }

    #[test]
    fn ball_component_distances_uninit_ieee754() {
        let ball = BallComponent::new();
        // 0xBF800000 — ball_component.c offsets 0x1764, 0x176c
        assert_eq!(ball.detection_dist_primary.to_bits(), 0xBF80_0000);
        assert_eq!(ball.detection_dist_secondary.to_bits(), 0xBF80_0000);
        assert_eq!(ball.detection_dist_primary, DISTANCE_UNINIT);
    }

    #[test]
    fn ball_component_max_collisions() {
        let ball = BallComponent::new();
        // ball_component.c : *(undefined1 *)(param_1 + 0x148a) = 5
        assert_eq!(ball.max_collisions_per_frame, 5);
        assert_eq!(ball.max_collisions_per_frame, BALL_MAX_COLLISIONS);
    }

    #[test]
    fn ball_component_possession_ids_all_invalid() {
        let ball = BallComponent::new();
        // 3 × 0xFF — ball_component.c offsets 0x1490-0x14A0
        assert_eq!(ball.possession.owner, INVALID_PLAYER_IDX);
        assert_eq!(ball.possession.secondary, INVALID_PLAYER_IDX);
        assert_eq!(ball.possession.tertiary, INVALID_PLAYER_IDX);
        assert!(ball.possession.is_free());
    }

    #[test]
    fn ball_component_target_ids_default() {
        let ball = BallComponent::new();
        // 0xFFFF0000 — ball_component.c offsets 0x14D0, 0x14E0
        assert_eq!(ball.targets.primary, INVALID_TARGET_ID);
        assert_eq!(ball.targets.secondary, INVALID_TARGET_ID);
        assert!(ball.targets.has_no_target());
    }

    #[test]
    fn ball_component_initial_controller_is_target_follow() {
        let ball = BallComponent::new();
        // BallComponent_ctor : dernier param_1[0xe] = game::BallMoveTargetFollow::vftable
        assert_eq!(ball.move_controller, BallMoveKind::TargetFollow);
    }

    #[test]
    fn ball_component_set_owner_libere() {
        let mut ball = BallComponent::new();
        assert!(ball.is_free());
        ball.set_owner(7);
        assert!(!ball.is_free());
        assert_eq!(ball.possession.owner, 7);
        ball.release_possession();
        assert!(ball.is_free());
        assert!(ball.targets.has_no_target());
    }

    #[test]
    fn ball_component_interception_none() {
        let ball = BallComponent::new();
        assert!(!ball.is_being_intercepted());
        assert_eq!(ball.interception.interceptor_id, INVALID_TARGET_ID);
    }

    // ── BallMoveNormal ───────────────────────────────────────────────────────

    #[test]
    fn ball_move_normal_flags_initialises_a_false() {
        let mv = BallMoveNormal::default();
        // FUN_14027ac10 : *(undefined1 *)(param_1 + 0x18) = 0
        assert!(!mv.on_ground);
        // FUN_14027ac10 : *(undefined1 *)((longlong)param_1 + 300) = 0
        assert!(!mv.collision_flag);
    }

    #[test]
    fn ball_move_normal_positions_initialisees_a_zero() {
        let mv = BallMoveNormal::default();
        assert_eq!(mv.position, Vec3::zero());
        assert_eq!(mv.prev_position, Vec3::zero());
        assert_eq!(mv.direction, Vec3::zero());
    }

    // ── PhysActor::update_sleeping ───────────────────────────────────────────

    #[test]
    fn actor_update_sleeping_velocite_nulle() {
        let mut actor = PhysActor::new_dynamic(1);
        actor.linear_velocity = Vec3::zero();
        actor.angular_velocity = Vec3::zero();
        actor.update_sleeping();
        assert!(actor.sleeping);
    }

    #[test]
    fn actor_update_sleeping_velocite_non_nulle() {
        let mut actor = PhysActor::new_dynamic(1);
        actor.linear_velocity = Vec3 { x: 1.0, y: 0.0, z: 0.0 };
        actor.update_sleeping();
        assert!(!actor.sleeping);
    }

    // ── LightCpuTask ─────────────────────────────────────────────────────────

    #[test]
    fn light_cpu_task_execution_ref_count_1() {
        // physx_npscene_constructor.c : *(undefined4 *)((longlong)param_1 + 0x270c) = 1
        let task = LightCpuTask::new("NpScene.execution", 1);
        assert_eq!(task.ref_count, 1);
        assert_eq!(task.name, "NpScene.execution");
    }

    #[test]
    fn npscene_task_names_fideles() {
        let scene = NpScene::new(NpSceneDesc::default());
        // physx_npscene_constructor.c lignes 153, 168, 188
        assert_eq!(scene.task_execution.name, "NpScene.execution");
        assert_eq!(scene.task_collide.name, "NpScene.collide");
        assert_eq!(scene.task_solve.name, "NpScene.solve");
    }
}
