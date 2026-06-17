//! Portage RE du sous-système `lives::gmdCAnimation` de `nie.exe`.
//!
//! Sources Ghidra :
//! - `animation_gmdcanimation_init.c` — constructeur (`FUN_1404ae380`), destructeur
//!   (`FUN_1404ae510`), nettoyage (`FUN_1404ae550`)
//! - `animation_bone_blend.c` — interpolation osseuse (`FUN_1404ae7e0`,
//!   `FUN_1404aeac0`)
//! - `animation_play_anime.c` — lecture d'animation (`FUN_1404f6a30`,
//!   `FUN_1404f6bc0`, `FUN_1404f6f20`, `FUN_1404f7030`)
//!
//! ## Architecture
//!
//! `gmdCAnimation` est un objet Level-5 Lives de 0x1C0 octets (~448 B) qui
//! orchestre la lecture d'animations squelettiques sur un personnage. Il contient :
//!
//! - Un pointeur vers le squelette courant (`+0x08`) depuis lequel il accède à
//!   l'objet skeleton (`+0xF0`) et au skinning (`-0x60` depuis cet objet).
//! - Des paires de buffers de poses osseuses (`+0x158`, `+0x160`) indexées par un
//!   bit de parité (`bVar9 = flags & 1`).
//! - Des slots de ressources animation (`+0x17C`, `+0x16C`, …) référencés par
//!   handle packés : 16 bits hauts = index objet, 16 bits bas = génération.
//! - Un scale (`+0x54`, f32 = 1.0), une vitesse inverse (`+0x1B0`, -1.0f = 0xBF800000).
//!
//! ## Champs offset (ABI nie.exe x64)
//!
//! ```text
//! +0x00  vftable ptr (lives::gmdCAnimation::vftable)
//! +0x08  skeleton_link ptr
//! +0x25  flags_byte (bit0 = bone_filter_enabled)
//! +0x54  scale            (f32, défaut 1.0)
//! +0x5C  active_flag      (u32, défaut 1)
//! +0xA0  anim_resource ptr
//! +0xA8  resource_mgr ptr
//! +0xB0  motion_data ptr
//! +0xB8  error_callback ptr
//! +0xCA  layer_index_a    (u8)
//! +0xCB  layer_index_b    (u8)
//! +0xCC  layer_select     (u8)
//! +0x14C sub_flags        (u16)
//! +0x150 pose_buf[0]      (ptr → tableau de matrices Transform3x4 * bone_count)
//! +0x158 pose_buf[1]      (ptr)
//! +0x160 pose_buf[2]      (ptr)
//! +0x168 motion_handle    (u32 : idx<<16 | gen)
//! +0x16C anim_handles[8]  (u32[8])
//! +0x17C layer_handles[4] (u32[4])
//! +0x18C weight_table ptr
//! +0x18E bone_count       (u8)
//! +0x194 resource_slot    (u8, 0x7F = slot id)
//! +0x198 is_playing       (bool)
//! +0x19A loop_flag        (u8)
//! +0x19C root_motion_mask (i32)
//! +0x1A4 root_motion_pos  (f32[3])
//! +0x1B0 speed_inv        (f32, défaut -1.0 = 0xBF800000)
//! +0x1B4 dirty_flag       (u8)
//! ```

#![forbid(unsafe_code)]

// ------------------------------------------------------------------------------------------------
// Constantes
// ------------------------------------------------------------------------------------------------

/// Magic G4MT (GMDT) identifiant un bloc de données de mouvement squelettique.
/// Vu dans `FUN_1404f6bc0` : `iVar7 == 0x544d3447`.
/// Octets ASCII : 'G','4','M','T'.
pub const G4MT_MAGIC: u32 = 0x544d_3447;

/// Taille de l'objet `gmdCAnimation` en octets (ABI nie.exe x64).
/// Portée depuis `FUN_1404ae510` : `thunk_FUN_140472d10(param_1, 0x1C0)`.
pub const GMD_C_ANIMATION_SIZE: usize = 0x1C0;

/// Taille d'un slot `Transform3x4` osseux en octets (3 × vec4 = 48 B).
/// Vu dans les strides `uVar11 * 0x30` de `FUN_1404ae7e0`.
pub const TRANSFORM3X4_STRIDE: usize = 0x30;

/// Nombre de slots de layer simultanés (voir boucle `lVar11 = 7` dans cleanup).
pub const ANIM_HANDLE_SLOTS: usize = 8;

/// Nombre maximal de layers contrôlés (boucle 0..3 dans `FUN_1404f6bc0`).
pub const LAYER_SLOT_COUNT: usize = 4;

/// Nombre d'itérations de la boucle G4MT PlayAnime (uVar9 < 3).
pub const PLAY_ANIME_EFFECT_LOOP: usize = 3;

// ------------------------------------------------------------------------------------------------
// Types externes non portés (stubs)
// ------------------------------------------------------------------------------------------------

/// Index opaque dans le tableau de ressources du gestionnaire Lives.
///
/// Les handles nie.exe sont encodés `(index << 16) | generation`. Ce type
/// wrappe le u32 brut; la résolution réelle vers un objet ressource dépend du
/// resource manager (non porté dans ce module).
///
/// // EXTERN: lives::ResourceManager::resolve(handle) → *mut T
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ResourceHandle(pub u32);

impl ResourceHandle {
    /// Extrait l'index objet (bits 31-16).
    #[must_use]
    pub fn index(self) -> u16 {
        (self.0 >> 16) as u16
    }

    /// Extrait la génération (bits 15-0).
    #[must_use]
    pub fn generation(self) -> u16 {
        self.0 as u16
    }

    /// Renvoie `true` si le handle est nul (pas de ressource liée).
    #[must_use]
    pub fn is_null(self) -> bool {
        self.0 == 0
    }
}

/// Poids de blend pour une pose osseuse, dans `[0.0, 1.0]`.
///
/// Dans `FUN_1404ae7e0`, le poids source est lu à `*(float*)(param_2+5*8)` et
/// le poids destination est `1.0 - weight`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BlendWeight(pub f32);

impl BlendWeight {
    /// Crée un poids en clampant à `[0.0, 1.0]`.
    #[must_use]
    pub fn new(v: f32) -> Self {
        Self(v.clamp(0.0, 1.0))
    }

    /// Poids complémentaire (`1.0 - self`), utilisé pour la destination.
    #[must_use]
    pub fn complement(self) -> Self {
        Self(1.0 - self.0)
    }
}

/// Matrice 3 × 4 représentant une pose osseuse (translation + rotation).
///
/// Layout mémoire : column-major, 12 floats, stride 0x30 (48 B).
/// // EXTERN: lives::Transform3x4 — structure interne Level-5 Lives
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Transform3x4(pub [f32; 12]);

impl Default for Transform3x4 {
    fn default() -> Self {
        // Matrice identité 3×4 (rotation identité + translation nulle).
        Self([
            1.0, 0.0, 0.0, 0.0, // colonne 0
            0.0, 1.0, 0.0, 0.0, // colonne 1
            0.0, 0.0, 1.0, 0.0, // colonne 2
        ])
    }
}

/// Paramètre de blend bone-to-bone : desc d'une paire de poses à interpoler.
///
/// Porté depuis la signature de `FUN_1404ae7e0` :
/// ```c
/// void FUN_1404ae7e0(longlong param_1, longlong *param_2, longlong *param_3)
/// ```
/// - `param_2` = pointeur vers le descripteur de la source (blend desc)
/// - `param_3[0]` = ptr poses source, `param_3[1]` = ptr poses destination,
///   `param_3[2]` = ptr tableau dirty-flags par bone.
#[derive(Debug)]
pub struct BoneBlendDesc<'a> {
    /// Poids du blend (lu à `*(float*)(param_2 + 5*8)` = offset 0x28).
    pub weight: BlendWeight,
    /// Index de sous-frame (lu à `*(ushort*)((longlong)param_2 + 0x1C)`).
    pub sub_frame_index: u16,
    /// Flag de mode (bit 0 : parité buffer, lu à offset `+0x25`).
    pub mode_flags: u8,
    /// Poses source (param_3[0] → tableau de Transform3x4 bone_count éléments).
    pub src_poses: &'a [Transform3x4],
    /// Poses destination (param_3[1] → même taille).
    pub dst_poses: &'a mut [Transform3x4],
    /// Tableau dirty par bone : `dst_dirty[i] = 1` si le bone i a été blendé.
    /// Taille = bone_count. Correspond à `param_3[2]`.
    pub dst_dirty: &'a mut [u8],
}

/// Contexte d'animation principale (squelette + skeleton data).
///
/// Correspond au `param_1` de `FUN_1404ae7e0` : objet `gmdCAnimation`.
/// Les champs sont les offsets critiques extraits du décompilé.
#[derive(Debug, Default)]
pub struct GmdCAnimation {
    /// Indique si la lecture est active (offset +0x198).
    pub is_playing: bool,
    /// Nombre de bones du squelette courant (offset +0x18E).
    pub bone_count: u8,
    /// Slot de ressource (offset +0x194, masqué `& 0x7F`).
    pub resource_slot: u8,
    /// Masque root motion (offset +0x19C) : si != 0, applique les matrices
    /// de root motion globale après le blend.
    pub root_motion_mask: i32,
    /// Scale de l'animation (offset +0x54, défaut 1.0).
    pub scale: f32,
    /// Vitesse inverse (offset +0x1B0, initialisée à -1.0).
    pub speed_inv: f32,
    /// Flag de boucle (offset +0x19A).
    pub loop_flag: u8,
    /// Flag dirty (offset +0x1B4) : marqué à 1 quand un blend a eu lieu.
    pub dirty_flag: u8,
    /// Handles de ressources animation (offset +0x16C, 8 slots).
    pub anim_handles: [ResourceHandle; ANIM_HANDLE_SLOTS],
    /// Handles de layers (offset +0x17C, 4 slots).
    pub layer_handles: [ResourceHandle; LAYER_SLOT_COUNT],
    /// Handle de motion courant (offset +0x168).
    pub motion_handle: ResourceHandle,
    /// Index layer A (offset +0xCA).
    pub layer_index_a: u8,
    /// Index layer B (offset +0xCB).
    pub layer_index_b: u8,
    /// Sélecteur de layer actif (offset +0xCC).
    pub layer_select: u8,
    /// Paires de buffers pose (indices 0..2 → offsets +0x150, +0x158, +0x160).
    /// Chaque buffer contient `bone_count` matrices `Transform3x4`.
    pub pose_buffers: [Vec<Transform3x4>; 3],
    /// Filtre bone activé (offset +0x25E, bit 0).
    pub bone_filter_enabled: bool,
    /// Masque bitfield de bones autorisés (optionnel, depuis offset +0x240).
    /// Un bit à 1 = le bone est inclus dans le blend.
    /// Taille : `ceil(bone_count / 32)` mots de 32 bits.
    pub bone_mask: Vec<u32>,
    /// Compteur global d'instances actives (équivalent `_DAT_141c125b4`).
    /// Incrémenté dans le constructeur, décrémenté dans le destructeur.
    /// // EXTERN: DAT_141c125b4 — global Lives
    pub _instance_count_snapshot: i32,
}

impl GmdCAnimation {
    /// Construit un `GmdCAnimation` dans son état initial.
    ///
    /// Portage de `FUN_1404ae380` (adresse `0x1404ae380`) :
    /// - Tous les champs à 0 / null
    /// - `scale = 1.0` (offset +0x54 = `0x3F800000`)
    /// - `active_flag = 1` (offset +0x5C)
    /// - `speed_inv = -1.0` (offset +0x1B0 = `0xBF800000`)
    /// - `flags byte +0x25 = 1` (is_active)
    ///
    /// Le constructeur original incrémente aussi `_DAT_141c125b4` (compteur
    /// global d'instances Lives) et positionne la vftable. Ces opérations sont
    /// sans équivalent direct en Rust safe.
    #[must_use]
    pub fn new() -> Self {
        Self {
            is_playing: false,
            bone_count: 0,
            resource_slot: 0,
            root_motion_mask: 0,
            scale: 1.0,         // 0x3F800000 @ +0x54
            speed_inv: -1.0,    // 0xBF800000 @ +0x1B0
            loop_flag: 0,
            dirty_flag: 0,
            anim_handles: [ResourceHandle(0); ANIM_HANDLE_SLOTS],
            layer_handles: [ResourceHandle(0); LAYER_SLOT_COUNT],
            motion_handle: ResourceHandle(0),
            layer_index_a: 0,
            layer_index_b: 0,
            layer_select: 0,
            pose_buffers: [const { vec![] }; 3],
            bone_filter_enabled: false,
            bone_mask: Vec::new(),
            _instance_count_snapshot: 0,
        }
    }

    /// Réalloue les buffers de poses pour un squelette de `bone_count` bones.
    ///
    /// Portage de la logique de `FUN_1404aeac0` (bloc `(*pbVar41 & 1) == 0`) :
    /// - Si la réallocation inline (stack alloca) est utilisée → 2 buffers de
    ///   taille `bone_count * 0x60` octets (= `bone_count * 3` Transform3x4).
    /// - Sinon → pointeurs dans un tampon pré-alloué de la ressource skeleton.
    ///
    /// En Rust safe on alloue toujours sur le tas. Les 3 buffers couvrent les
    /// slots `+0x150`, `+0x158`, `+0x160`.
    pub fn allocate_pose_buffers(&mut self, bone_count: u8) {
        self.bone_count = bone_count;
        let n = bone_count as usize;
        for buf in &mut self.pose_buffers {
            buf.clear();
            buf.resize(n, Transform3x4::default());
        }
    }

    /// Libère toutes les ressources de l'objet animation.
    ///
    /// Portage de `FUN_1404ae550` (adresse `0x1404ae550`) :
    /// - Décrémente le compteur de ref des ressources liées
    ///   (`+0x150`, `+0xB0`, `+0xA0`, `+0x168`).
    /// - Efface les 8 slots `anim_handles` + les 4 `layer_handles`.
    /// - Appelle `FUN_1404adf60` (nettoyage table poids — `+0xB8`).
    ///
    /// En Rust, le Drop des Vec libère les buffers ; les handles sont mis à 0.
    ///
    /// // EXTERN: FUN_140452ac0 — libération handle Lives (ref-count → free)
    /// // EXTERN: FUN_1404adf60 — nettoyage weight_table (+0xB8)
    /// // EXTERN: FUN_140054e00 — nettoyage objet racine Lives
    pub fn cleanup(&mut self) {
        // Effacement motion handle (offset +0x150 → +0x160, +0xB0)
        for buf in &mut self.pose_buffers {
            buf.clear();
        }
        self.motion_handle = ResourceHandle(0);

        // Offset +0x18E : bone_count et flags
        self.bone_count = 0;
        self.bone_filter_enabled = false;

        // Effacement handle ressource anim (offset +0xA0 après release ref)
        // Boucle lVar11 = 7 sur les 8 slots anim_handles (+0x16C)
        for h in &mut self.anim_handles {
            *h = ResourceHandle(0);
        }

        // Layer handles (+0x17C) — traités par la boucle motion_constraints
        for h in &mut self.layer_handles {
            *h = ResourceHandle(0);
        }

        self.is_playing = false;
        self.dirty_flag = 0;
    }
}

// ------------------------------------------------------------------------------------------------
// Bone blend (FUN_1404ae7e0)
// ------------------------------------------------------------------------------------------------

/// Erreur de blend osseux.
#[derive(Debug, thiserror::Error)]
pub enum BoneBlendError {
    /// Le tableau source/destination n'a pas la taille attendue.
    #[error("taille de buffer incohérente : attendu {expected}, reçu src={src_len} dst={dst_len}")]
    BufferSizeMismatch {
        /// Nombre de bones attendu.
        expected: usize,
        /// Taille du buffer source fourni.
        src_len: usize,
        /// Taille du buffer destination fourni.
        dst_len: usize,
    },
    /// Le tableau dirty n'a pas la bonne taille.
    #[error("tableau dirty trop petit : attendu {expected}, reçu {got}")]
    DirtyArrayTooSmall {
        /// Taille minimale requise.
        expected: usize,
        /// Taille réellement fournie.
        got: usize,
    },
    /// Le skeleton interne est absent (pointeur null côté C).
    #[error("skeleton absent (ptr nul @ +0x08)")]
    NoSkeleton,
    /// Le skinning data absent (lVar13 == 0 ou == -0x70).
    #[error("données skinning absentes ou invalides")]
    NoSkinningData,
    /// Bone count = 0 dans le skeleton.
    #[error("aucun bone dans le skeleton (bone_count = 0 @ +0x25C)")]
    ZeroBoneCount,
    /// Poids de blend >= 1.0 : le blend n'est pas nécessaire.
    #[error("poids >= 1.0, blend ignoré")]
    WeightSaturated,
}

/// Résultat d'une opération de blend.
pub type BlendResult<T> = Result<T, BoneBlendError>;

/// Interpole bone par bone entre deux poses squelettiques avec un poids scalaire.
///
/// Portage de `FUN_1404ae7e0` (`0x1404ae7e0`) —
/// `lives::gmdCAnimation::BonePoseBlend` (nom RE supposé).
///
/// ## Algorithme (contrôle-flow C fidèle)
///
/// ```text
/// si skeleton == null → retour
/// lVar5 = *(skeleton + 0xF0)          // skinning object ptr
/// lVar13 = lVar5 - 0x60               // object ptr ajusté
/// si lVar13 == 0 || lVar13 == -0x70 → retour
/// si bone_count(lVar13+0x25C) == 0 → retour
/// si param_2 == null || *param_3 == 0 → retour
/// si param_3[1] == 0 || param_3[2] == 0 → retour
/// si weight >= 1.0 → retour (aucun blend nécessaire)
///
/// lVar6 = *(*param_2 + 0x20)          // anim data block ptr
/// uVar3 = *(lVar6+0x22)               // bone_stride
/// uVar11 = *(lVar6+0x0A)              // base_bone_index
/// lVar1  = uVar11 + sub_frame_index*4 // frame_block_offset
/// uVar4  = *(lVar6+6 + lVar1*4)       // bone_count_in_anim
/// puVar14 = ptr vers la table d'index bone (lVar6 + ...)
/// bVar9  = *(lVar6+8 + lVar1*4) & 1   // parité buffer
///
/// src_pose_buf = *(param_1 + 0x158 + bVar9*8)
/// si src_pose_buf == null || !bone_filter_enabled → retour
/// dst_pose_buf = *(param_3[1] + 8 + bVar9*8)
/// fVar16 = 1.0 - weight               // poids destination
///
/// pour chaque bone_in_anim :
///   bone_idx = *(lVar8 + mode_byte*bone_stride*2 + *puVar14*2)
///   si bone_idx >= total_bone_count → skip
///   si bone_mask != null && bit(bone_mask, bone_idx) == 0 → skip
///   si weight_table != null && weight_table[bone_idx] <= 0.0 → skip
///   blend_transform(src[bone_idx], dst[bone_idx], fVar16)
///   si parité == 1 : dirty[bone_idx] = 1
///   puVar14 += 4  // stride de 4 ushorts
///
/// si parité == 1 : blend_weight_out = fVar16
/// si root_motion_mask != 0 : applique blend root motion
/// ```
///
/// ## Paramètres
///
/// - `anim` : contexte de l'objet animation (valide les préconditions).
/// - `desc` : descripteur du blend avec les buffers source/destination.
/// - `bone_index_table` : table d'index bone issue du bloc anim data
///   (`puVar14` dans le C, stride de 4 u16 par entrée).
/// - `bone_mask` : bitfield optionnel de bones autorisés (null = tous acceptés).
/// - `weight_table` : table de poids par bone (optionnel).
///
/// ## Retour
///
/// `Ok(blend_weight_out)` = poids destination effectivement appliqué, ou une
/// `BoneBlendError` si une précondition n'est pas satisfaite.
pub fn bone_blend(
    anim: &GmdCAnimation,
    desc: &mut BoneBlendDesc<'_>,
    bone_index_table: &[u16],
    bone_mask: Option<&[u32]>,
    weight_table: Option<&[f32]>,
) -> BlendResult<f32> {
    // Précondition : skeleton présent (param_1 + 8 != 0)
    if anim.bone_count == 0 {
        return Err(BoneBlendError::NoSkeleton);
    }
    // Précondition : skinning data valide (lVar13 != 0 && lVar13 != -0x70)
    // → représenté en Rust par bone_count > 0 et bone_filter_enabled
    // (offset +0x25E = skinning_ok flag en amont)
    if !anim.bone_filter_enabled {
        return Err(BoneBlendError::NoSkinningData);
    }

    let total_bone_count = anim.bone_count as usize;

    // *(short *)(lVar13 + 0x25c) != 0
    if total_bone_count == 0 {
        return Err(BoneBlendError::ZeroBoneCount);
    }

    // *(float *)(param_2 + 5) < 1.0  (param_2+5 = offset +0x28 = weight)
    if desc.weight.0 >= 1.0 {
        return Err(BoneBlendError::WeightSaturated);
    }

    // Vérification tailles des buffers
    if desc.src_poses.len() < total_bone_count || desc.dst_poses.len() < total_bone_count {
        return Err(BoneBlendError::BufferSizeMismatch {
            expected: total_bone_count,
            src_len: desc.src_poses.len(),
            dst_len: desc.dst_poses.len(),
        });
    }
    if desc.dst_dirty.len() < total_bone_count {
        return Err(BoneBlendError::DirtyArrayTooSmall {
            expected: total_bone_count,
            got: desc.dst_dirty.len(),
        });
    }

    // bVar9 = *(byte *)(lVar6 + 8 + lVar1 * 4) & 1  (parité buffer)
    let parity = desc.mode_flags & 1;
    // fVar16 = 1.0 - *(float *)(param_2 + 5)
    let blend_dst_weight = desc.weight.complement().0;

    // Sélection du buffer source selon la parité
    // lVar1 = *(longlong *)(param_1 + 0x158 + (ulonglong)bVar9 * 8)
    let src_buf_idx = parity as usize;
    let src_buf = anim
        .pose_buffers
        .get(src_buf_idx)
        .ok_or(BoneBlendError::NoSkinningData)?;

    // bVar2 = *(byte *)((longlong)param_2 + 0x25)  (mode_flags byte)
    let mode_byte = desc.mode_flags;

    // Nombre de bones dans cette animation (uVar4 = uVar12 dans la boucle)
    // On utilise la taille de bone_index_table comme proxy.
    // Dans le C : uVar4 = *(ushort *)(lVar6 + 6 + lVar1 * 4)
    let _anim_bone_count = bone_index_table.len();

    // uVar3 = *(ushort *)(lVar6 + 0x22)  (bone_stride dans la table)
    // Stride représenté ici comme total_bone_count (layout dense).
    let bone_stride = total_bone_count as u16;

    // Boucle principale de blend
    // do { ... puVar14 += 4; uVar12--; } while (uVar12 != 0)
    for (i, &bone_table_idx) in bone_index_table.iter().enumerate() {
        // uVar4 = *(ushort *)(lVar8 + mode_byte*bone_stride*2 + *puVar14*2)
        // → sélection bone index via la table
        let local_bone_idx = bone_table_idx as usize;

        // Mode offset : lVar8 + (mode_byte * bone_stride) * 2 + local_bone_idx * 2
        // RE incertain: lVar8 = param_2[1] = ptr table d'index globale ; on
        // utilise bone_stride et mode_byte pour calculer un décalage de ligne.
        let row_offset = (mode_byte as usize) * (bone_stride as usize);
        let global_bone_idx = row_offset + local_bone_idx;

        // Validation : bone_idx < total_bone_count
        // if ((uVar4 < *(ushort *)(lVar13 + 0x25c)))
        if global_bone_idx >= total_bone_count {
            continue;
        }

        // Filtre bitfield : lVar7 == 0 || bit(lVar7, uVar4) != 0
        // lVar7 = *(longlong *)(lVar13 + 0x240)
        if let Some(mask) = bone_mask {
            let word = global_bone_idx >> 5;
            let bit = global_bone_idx & 0x1f;
            if mask.get(word).copied().unwrap_or(0) >> bit & 1 == 0 {
                continue;
            }
        }

        // Filtre weight_table : lVar15 == 0 || weight_table[local_bone_idx] > 0.0
        if let Some(wtbl) = weight_table
            && wtbl.get(i).copied().unwrap_or(0.0) <= 0.0 {
                continue;
            }

        // Blend : FUN_140585c60(dst[bone_idx], src[bone_idx], fVar16)
        // RE incertain: FUN_140585c60 = interpolation linéaire de Transform3x4
        // // EXTERN: FUN_140585c60 — lives::Transform3x4::Lerp (addr 0x140585c60)
        if let (Some(src), Some(dst)) = (
            src_buf.get(global_bone_idx),
            desc.dst_poses.get_mut(global_bone_idx),
        ) {
            blend_transform(src, dst, blend_dst_weight);
        }

        // si parité == 1 : dirty[bone_idx] = 1
        // *(undefined1 *)(uVar11 + param_3[2]) = 1
        if parity != 0
            && let Some(d) = desc.dst_dirty.get_mut(global_bone_idx) {
                *d = 1;
            }
    }

    // si bVar9 != 0 : *(float *)(param_3 + 3) = fVar16
    if parity != 0 {
        // blend_weight_out écrit dans param_3[3] = champ weight_out du desc
    }

    // Root motion blend
    // if (*(int *)(param_1 + 0x19c) != 0) { ... FUN_140585c60(lVar5, &local_88, fVar16) }
    // // EXTERN: DAT_142115a70, DAT_14212dca0 — constantes root motion globales
    if anim.root_motion_mask != 0 {
        blend_root_motion(blend_dst_weight);
    }

    Ok(blend_dst_weight)
}

/// Interpole linéairement deux matrices `Transform3x4`.
///
/// Portage de `FUN_140585c60` (addr `0x140585c60`) — supposé
/// `lives::Transform3x4::Lerp(dst, src, weight)`.
///
/// Chaque composant : `dst[i] = dst[i] * weight + src[i] * (1.0 - weight)`.
///
/// // EXTERN: FUN_140585c60 — lives::Transform3x4::Lerp
fn blend_transform(src: &Transform3x4, dst: &mut Transform3x4, dst_weight: f32) {
    let src_weight = 1.0 - dst_weight;
    for (d, s) in dst.0.iter_mut().zip(src.0.iter()) {
        *d = *d * dst_weight + s * src_weight;
    }
}

/// Applique le blend de root motion avec le poids donné.
///
/// Dans le C : lit les globaux `DAT_142115a70` (quaternion) et `DAT_14212dca0`
/// (translation) et les mélange via `FUN_140585c60`.
/// En Rust safe, ces globaux ne sont pas accessibles : on documente le point
/// d'extension.
///
/// // EXTERN: DAT_142115a70 — quaternion root motion (4xf32 @ 0x142115a70)
/// // EXTERN: DAT_14212dca0 — translation root motion (4xf32 @ 0x14212dca0)
/// // EXTERN: FUN_14005b060 — accesseur pose courante Lives
fn blend_root_motion(_dst_weight: f32) {
    // Point d'extension : intégrer quand les globaux root motion seront portés.
}

// ------------------------------------------------------------------------------------------------
// Allocation pose buffers (FUN_1404aeac0)
// ------------------------------------------------------------------------------------------------

/// Résultat de l'allocation pose.
#[derive(Debug, thiserror::Error)]
pub enum PoseAllocError {
    /// Pas de ressource animation liée (ptr null @ +0xA0).
    #[error("ressource animation absente")]
    NoAnimResource,
    /// L'animation n'est pas en cours de lecture (+0x198 == 0).
    #[error("animation non active")]
    NotPlaying,
    /// Bone count nul.
    #[error("bone count nul (offset +0x18E)")]
    ZeroBoneCount,
    /// Données skeleton absentes (ptr +0x08 null).
    #[error("skeleton absent")]
    NoSkeleton,
}

/// Prépare les buffers de pose et calcule les layers actifs.
///
/// Portage de `FUN_1404aeac0` (`0x1404aeac0`) —
/// vraisemblablement `gmdCAnimation::UpdatePoseBuffers`.
///
/// ## Algorithme principal
///
/// ```text
/// Préconditions :
///   *(param_1+0xA0) != 0          // anim resource liée
///   *(param_1+0x198) != '\0'      // is_playing
///   *(param_1+0xB0) != 0          // motion data
///   *(param_1+0x18E) != 0         // bone_count > 0
///   *(param_1+8) != 0             // skeleton link
///   skinning_data valide (pauVar47 != null && pauVar48 != null)
///   *(pauVar49) != 0              // bone count depuis skeleton
///
/// Si flag bit0 @ (pauVar47+0x25+0xE) == 0 (inline alloca) :
///   alloue 2 tableaux de bone_count * 3 Transform3x4 sur la stack (alloca)
///   pauVar27[0] = tableau 0
///   pauVar27[1] = tableau 1 (offset bone_count*3)
/// Sinon (shared pool) :
///   lit 2 ptrs depuis *(pauVar47[0x1F] + 8) + idx*bone_count*0x30
///
/// FUN_1404bba80(skeleton, local_poses, lStack_770)  // copie poses initiales
///
/// Boucle LAYER_SLOT_COUNT slots, bit-masked par local_7a4 (offset +0x190) :
///   si bit non mis ou handle nul → skip
///   résout le handle layer (idx >> 16) * 0x40 dans resource table
///   appelle vfunc @+0x10 pour valider l'objet
///   applique le layer sur les poses (bone_blend interne)
///
/// Retourne ptr vers le buffer résultat (ou null si précondition échouée)
/// ```
///
/// // EXTERN: FUN_1404bba80 — copie des poses initiales (skeleton → buffer local)
/// // EXTERN: FUN_1416709b0 — initialisation du buffer dirty
/// // EXTERN: FUN_14005b060 — accesseur live-pose Lives
pub fn update_pose_buffers(anim: &mut GmdCAnimation) -> Result<(), PoseAllocError> {
    // *(param_1+0xA0) != 0 : ressource anim liée
    if anim.motion_handle.is_null() && anim.anim_handles.iter().all(|h| h.is_null()) {
        return Err(PoseAllocError::NoAnimResource);
    }
    // *(param_1+0x198) != '\0' : is_playing
    if !anim.is_playing {
        return Err(PoseAllocError::NotPlaying);
    }
    // *(param_1+0xB0) != 0 : motion data
    // RE incertain: porté comme flag via is_playing + bone_count
    if anim.bone_count == 0 {
        return Err(PoseAllocError::ZeroBoneCount);
    }

    let n = anim.bone_count as usize;

    // Logique flag bit0 (inline alloca vs shared pool) :
    // En Rust safe, on alloue toujours sur le tas.
    // (*pbVar41 & 1) == 0 → alloca inline : 2 bufs de n*3 Transform3x4
    // (*pbVar41 & 1) != 0 → shared pool : 2 ptrs dans skeleton data
    // Ici on alloue toujours 3 buffers (3 slots +0x150/+0x158/+0x160).
    for buf in &mut anim.pose_buffers {
        if buf.len() != n {
            buf.resize(n, Transform3x4::default());
        }
    }

    // FUN_1404bba80 : copie les poses initiales du skeleton dans local_poses.
    // // EXTERN: FUN_1404bba80 — copie initial poses (addr 0x1404bba80)
    // On initialise les buffers avec l'identité (pas de skeleton ptr disponible).
    for buf in &mut anim.pose_buffers {
        for t in buf.iter_mut() {
            *t = Transform3x4::default();
        }
    }

    // Boucle layers (local_7a0 = 4, bitmask local_7a4 @ +0x190)
    // do { bVar40 = local_7a0; uVar35 = local_7a0; ...
    //      si (uVar31 >> uVar35) & 1 == 0 || *local_768 == 0 → skip
    //      résout handle → applique layer
    //      local_7a0 décrémenté de 1 jusqu'à 0
    // }
    // RE incertain: layer_handles correspondent aux slots @ +0x17C
    for (slot_idx, handle) in anim.layer_handles.iter().enumerate() {
        if handle.is_null() {
            continue;
        }
        // Validation handle via vfunc (pcVar6 = *(code **)(*plVar42 + 0x10))
        // // EXTERN: vfunc@+0x10 — IsValid() du resource handle Lives
        // On simule : si handle est valide (non nul), marque dirty
        let _ = slot_idx; // utilisé pour la sémantique de la boucle
    }

    // Dirty flag : positionné après le blend de layers.
    anim.dirty_flag = 1;

    Ok(())
}

// ------------------------------------------------------------------------------------------------
// PlayAnime (FUN_1404f6a30, FUN_1404f6bc0)
// ------------------------------------------------------------------------------------------------

/// Type d'animation pour `PlayAnime`.
///
/// Portage du discriminant `iVar6 = (**(code **)(*param_3 + 0x18))(param_3)` :
/// - 0 = animation simple (skeleton uniquement)
/// - 1 = animation avec skeletal blend
/// - 2 = animation avec ressource G4MT (motion table)
///
/// Tout autre valeur → retour succès immédiat sans action.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(i32)]
pub enum AnimeType {
    /// Animation squelettique simple (type 0).
    Skeletal = 0,
    /// Animation avec blend de layers (type 1).
    SkeletalBlend = 1,
    /// Animation avec table de mouvement G4MT (type 2).
    G4mt = 2,
}

/// Erreur de lecture d'animation.
#[derive(Debug, thiserror::Error)]
pub enum PlayAnimeError {
    /// Paramètre manquant (param_2 = 0 ou param_3 = null).
    #[error("paramètre animation null")]
    NullParam,
    /// Pas de ressource skeleton liée.
    #[error("skeleton nul")]
    NullSkeleton,
    /// Ressource G4MT introuvable ou non initialisée.
    #[error("ressource G4MT absente")]
    NoG4mtResource,
    /// Animation introuvable dans la table G4MT.
    ///
    /// Correspond au log `"gmdCAnimation::PlayAnime Not Exist Anime"`.
    #[error("animation introuvable (effect={effect_id}, motion={motion_idx})")]
    NotExistAnime {
        /// ID de l'effet (packed handle).
        effect_id: u32,
        /// Index motion dans la table G4MT.
        motion_idx: u32,
    },
    /// Erreur layer (type 2 avec ressource layer invalide).
    #[error("layer invalide ou non chargé")]
    InvalidLayer,
}

/// Résultat de PlayAnime.
pub type PlayResult<T> = Result<T, PlayAnimeError>;

/// Descripteur d'une animation à jouer.
///
/// Correspond aux champs de `param_3` (longlong* de 32+ qwords) dans
/// `FUN_1404f6a30` / `FUN_1404f6bc0`.
#[derive(Debug, Clone)]
pub struct AnimDescriptor {
    /// Type d'animation (discriminant vfunc @+0x18).
    pub anime_type: AnimeType,
    /// Handle de la ressource animation (param_3[8]).
    pub resource_handle: ResourceHandle,
    /// Handle de layer secondaire (param_3[10]).
    pub layer_handle: ResourceHandle,
    /// Index motion dans la table (param_3[0x11]).
    pub motion_table_index: u8,
    /// ID d'effet (param_3[0xD] = effect_id, utilisé pour NotExistAnime).
    pub effect_id: u32,
}

/// Démarre la lecture d'une animation sur un objet `gmdCAnimation`.
///
/// Portage de `FUN_1404f6a30` (`0x1404f6a30`) :
///
/// ```text
/// si param_2 == 0 → 0
/// si param_3 == null → 0
/// iVar6 = vfunc@+0x18(param_3)    // AnimeType
/// si type == 0 || type == 1 :
///   lVar7 = FUN_140097510(param_2, layer_select)
///   si lVar7 != 0 :
///     FUN_1404ba600(lVar7+0x70, layer_select, motion_idx, 1, 1, param_3[9], lVar4, 8, 0)
///     si ok && resource_handle != 0 :
///       FUN_14005aaa0(param_2, 1)   // activer skeleton
///       FUN_1404b1a20(uVar8, lVar4) // bind resource
///     retourne 1/0
/// si type == 2 :
///   plVar3 = param_3[10]            // layer_handle
///   IsValid(plVar3) et !IsLoaded(plVar3) → 0
///   stocker plVar3 @ param_2+0xF8, incrémenter ref
///   lVar7 = FUN_140097330(param_2, 0) // slot courant
///   écrire layer_index_a/b dans slot
///   si ressource chargée → FUN_1404ebd70(param_2, plVar3)
///   sinon → FUN_1402ce490 + *(lVar7+0x60) = 0
///   retourne 1/0
/// sinon type inconnu → retourne 1
/// ```
///
/// // EXTERN: FUN_140097510 — résolution skeleton slot (addr 0x140097510)
/// // EXTERN: FUN_1404ba600 — liaison motion data (addr 0x1404ba600)
/// // EXTERN: FUN_14005aaa0 — activation skeleton (addr 0x14005aaa0)
/// // EXTERN: FUN_1404b1a20 — bind resource handle (addr 0x1404b1a20)
/// // EXTERN: FUN_140097330 — slot courant animation (addr 0x140097330)
/// // EXTERN: FUN_1404ebd70 — lecture G4MT resource (addr 0x1404ebd70)
/// // EXTERN: FUN_1402ce490 — allocation slot (addr 0x1402ce490)
pub fn play_anime(anim: &mut GmdCAnimation, desc: &AnimDescriptor) -> PlayResult<bool> {
    // si param_2 == 0 ou param_3 == null → retour 0
    if desc.resource_handle.is_null() && desc.layer_handle.is_null() {
        return Err(PlayAnimeError::NullParam);
    }

    match desc.anime_type {
        AnimeType::Skeletal | AnimeType::SkeletalBlend => {
            // lVar7 = FUN_140097510(param_2, *(param_1+0xCC))
            // Résolution du skeleton slot selon layer_select
            // // EXTERN: FUN_140097510
            // FUN_1404ba600 : liaison motion data avec paramètres
            // // EXTERN: FUN_1404ba600
            let has_resource = !desc.resource_handle.is_null();
            if has_resource {
                // FUN_14005aaa0(param_2, 1) : activer skeleton
                // // EXTERN: FUN_14005aaa0
                // FUN_1404b1a20 : bind resource handle dans le skeleton
                // // EXTERN: FUN_1404b1a20
                anim.motion_handle = desc.resource_handle;
                anim.is_playing = true;
                Ok(true)
            } else {
                Ok(false)
            }
        }

        AnimeType::G4mt => {
            // plVar3 = param_3[10] : layer handle G4MT
            if desc.layer_handle.is_null() {
                return Err(PlayAnimeError::NoG4mtResource);
            }

            // IsValid(plVar3) = vfunc@+0x10 → cVar5 != '\0'
            // IsLoaded(plVar3) = vfunc@+0x20 → doit être '\0' (pas encore chargé)
            // On simule : handle non nul = valide.

            // Stocker ptr layer @ param_2+0xF8, ref++
            // LOCK: *(plVar3+0xC) += 1 ; UNLOCK
            // // EXTERN: LOCK/UNLOCK — interlocked increment Lives

            // Écriture layer_index_a/b dans le slot courant
            // lVar7 = FUN_140097330(param_2, 0)
            // si lVar7 == 0 : *(param_2+0x7A) = layer_index_a ; *(param_2+0x7B) = layer_index_b
            // sinon         : *(lVar7+0x332) = layer_index_a ; *(lVar7+0x333) = layer_index_b
            // // EXTERN: FUN_140097330

            anim.layer_index_a = (desc.layer_handle.generation() & 0xFF) as u8;
            anim.layer_index_b = (desc.layer_handle.generation() >> 8) as u8;
            anim.is_playing = true;

            // Si ressource G4MT déjà chargée (IsValid renvoie vrai) :
            //   FUN_1404ebd70(param_2, plVar3) → liaison directe
            // Sinon :
            //   lVar7 = FUN_1402ce490(param_2, *(param_2+0x79))
            //   *(lVar7+0x60) = 0
            // // EXTERN: FUN_1404ebd70, FUN_1402ce490

            Ok(true)
        }
    }
}

/// Démarre une animation avec recherche dans la table G4MT.
///
/// Portage de `FUN_1404f6bc0` (`0x1404f6bc0`) — version enrichie de `play_anime`
/// qui recherche le bon index motion dans les blocs G4MT avant de jouer.
///
/// ## Algorithme
///
/// ```text
/// si param_2 == 0 || param_3 == null → retour 0
/// uVar10 = *(param_2 + 8)              // skeleton obj
/// iVar7 = vfunc@+0x18(param_3)         // AnimeType
///
/// si type 0/1 :
///   lVar8 = FUN_14005aaa0(uVar10, 0)   // skeleton courant
///   si null → 0
///   FUN_1404f6f20(...)                  // calcul sub_frame
///   *(param_2+0xC5) = local_1c8
///
/// si type 2 :
///   FUN_1404f6f20(...)
///   lVar8 = FUN_14005aaa0(uVar10, 0)
///   si lVar8 != 0 && param_5 != '\0' :
///     lVar8 = FUN_1404b1d90(lVar8, 5)  // table G4MT depuis skeleton
///     si lVar8 != 0 :
///       Boucle i=0..3 (PLAY_ANIME_EFFECT_LOOP) :
///         uVar3 = *(param_2 + 0x7C + i*0xC)  // effect handle slot i
///         si uVar3 == 0 → skip
///         itère sur G4MT chain (lVar8, uVar1, uVar13) :
///           pour chaque bloc motion dans le G4MT :
///             si magic == G4MT_MAGIC :
///               sVar2 = *(lVar5+0x20)          // nb frames attendu
///               FUN_1404b86f0(effect_handle, frame_begin_ptr, frame_end_ptr)
///               si résultat != sVar2 → local_1c8 = 1, break
///         si local_1c8 != 0 → goto LAB (inner break)
///         si non trouvé : log "Not Exist Anime" ou callback erreur
///   lVar8 = FUN_14027d7f0(uVar10, 0)    // current blend state
///   si lVar8 != 0 :
///     *(param_2+0xC4) = (*(lVar8+0x38) != '\0') + 1
///     retourne 1
/// retourne 1
/// ```
///
/// // EXTERN: FUN_14005aaa0 — skeleton courant
/// // EXTERN: FUN_1404b1d90 — table G4MT depuis skeleton (addr 0x1404b1d90)
/// // EXTERN: FUN_1404b86f0 — recherche frame dans G4MT (addr 0x1404b86f0)
/// // EXTERN: FUN_1404b7430 — next node G4MT chain (addr 0x1404b7430)
/// // EXTERN: FUN_14027d7f0 — blend state courant (addr 0x14027d7f0)
/// // EXTERN: FUN_1400abf50 — printf log (addr 0x1400abf50)
pub fn play_anime_with_g4mt_search(
    anim: &mut GmdCAnimation,
    desc: &AnimDescriptor,
    effect_slots: &[ResourceHandle; PLAY_ANIME_EFFECT_LOOP],
    g4mt_blocks: &[G4mtBlock],
    use_blend_search: bool,
) -> PlayResult<bool> {
    if desc.resource_handle.is_null() && desc.layer_handle.is_null() {
        return Err(PlayAnimeError::NullParam);
    }

    match desc.anime_type {
        AnimeType::Skeletal | AnimeType::SkeletalBlend => {
            // lVar8 = FUN_14005aaa0(uVar10, 0) : skeleton courant
            // FUN_1404f6f20 : calcul sub_frame → *(param_2+0xC5)
            // // EXTERN: FUN_14005aaa0, FUN_1404f6f20
            anim.is_playing = true;
            Ok(true)
        }

        AnimeType::G4mt => {
            // FUN_1404f6f20 : sub_frame calculation
            // // EXTERN: FUN_1404f6f20

            if !use_blend_search {
                // pas de recherche G4MT → juste activer
                anim.is_playing = true;
                return Ok(true);
            }

            // Boucle i = 0 .. PLAY_ANIME_EFFECT_LOOP (< 3)
            // local_1c4 = 0; do { ... local_1c4++; } while (local_1c4 < 3)
            for (loop_idx, effect_handle) in effect_slots.iter().enumerate() {
                if effect_handle.is_null() {
                    continue;
                }

                // Recherche dans la chain G4MT
                // uVar1 = *(ushort *)(lVar8 + 0x30)  // premier node
                // itère via FUN_1404b7430 (next node)
                let mut found = false;
                'g4mt_search: for block in g4mt_blocks {
                    if block.magic != G4MT_MAGIC {
                        continue;
                    }
                    // sVar2 = *(lVar5 + 0x20) : nb frames attendu
                    let expected_frames = block.frame_count;

                    // FUN_1404b86f0(effect_handle_raw, frame_begin_ptr, frame_end_ptr)
                    // → si résultat != sVar2 : local_1c8 = 1 (anime trouvé ≠ attendu)
                    // // EXTERN: FUN_1404b86f0
                    // Simulation : on compare l'effect_handle index à block.effect_id
                    if effect_handle.index() == block.effect_id && block.frame_count != expected_frames {
                        found = true;
                        break 'g4mt_search;
                    }
                }

                if !found {
                    // Log "gmdCAnimation::PlayAnime Not Exist Anime\n effect name [%s] motion index[%02u]"
                    // Si error_callback (*(param_1+0xB8) != null) :
                    //   construit 3 params (effect_id, loop_idx, motion_idx) et appelle callback
                    // // EXTERN: FUN_1400abf50 printf
                    return Err(PlayAnimeError::NotExistAnime {
                        effect_id: effect_handle.0,
                        motion_idx: loop_idx as u32,
                    });
                }
            }

            // lVar8 = FUN_14027d7f0(uVar10, 0) → blend state
            // *(param_2+0xC4) = (*(lVar8+0x38) != '\0') + 1
            // // EXTERN: FUN_14027d7f0
            anim.is_playing = true;
            Ok(true)
        }
    }
}

/// Calcule l'index de sub-frame pour le slot de lecture courant.
///
/// Portage de `FUN_1404f6f20` (`0x1404f6f20`) — `SetSubFrame` (nom supposé).
///
/// ## Algorithme
///
/// ```text
/// si *(param_5+0x68) == 0 && *(param_5+0x74) == 0 && *(param_5+0x80) == 0 :
///   bVar2 = 0
///   pour i = 0..3 :
///     *(param_3 + 0x7C + i*0xC) = CONCAT(i, *(param_4+0x20+i*4))
///     *(param_3 + 0x84 + i*0xC) = 0
/// sinon :
///   *(param_3+0x7C) = *(param_5+0x68) (sub 0)
///   *(param_3+0x84) = 0
///   *(param_3+0x88) = CONCAT(1, *(param_5+0x74))
///   *(param_3+0x90) = 0
///   *(param_3+0x94) = CONCAT(2, *(param_5+0x80))
///   *(param_3+0x9C) = 0
///
/// bVar2 = *(param_5+0x8C)
/// si (char)bVar2 < 0 :
///   bVar2 = 0
///   tant que *(param_3+0x7C + bVar2*0xC) == 0 : bVar2++, si > 2 retour
/// *param_2 = bVar2
/// ```
///
/// Renvoie l'index de sub-frame sélectionné (0..3) ou `None` si tous nuls.
pub fn compute_sub_frame(
    slot_offsets: &[i32; 3],
    override_slots: Option<&[i32; 3]>,
    preferred_idx: i8,
) -> Option<u8> {
    // param_5+0x8C : preferred_idx
    // param_5+0x68, +0x74, +0x80 : overrides

    let effective: [i32; 3] = if let Some(ov) = override_slots {
        // branche "sinon" : slots 0=ov[0], 1=ov[1], 2=ov[2]
        *ov
    } else {
        // branche "si tous nuls" : lit depuis param_4+0x20 (slot_offsets)
        *slot_offsets
    };

    // bVar2 = preferred_idx
    // si (char)bVar2 < 0 : cherche le premier slot non-nul
    if preferred_idx < 0 {
        for (i, &v) in effective.iter().enumerate() {
            if v != 0 {
                return Some(i as u8);
            }
        }
        None
    } else {
        Some(preferred_idx as u8)
    }
}

// ------------------------------------------------------------------------------------------------
// Données G4MT (format motion table)
// ------------------------------------------------------------------------------------------------

/// Bloc de données G4MT (`'G','4','M','T'`).
///
/// Porté depuis `FUN_1404f6bc0` : structure minimale pour la recherche.
/// Les champs exacts de la struct Lives sont partiellement reconstruits
/// à partir des offsets observés dans le décompilé.
///
/// // EXTERN: lives::G4mtBlock — struct interne motion table Level-5
#[derive(Debug, Clone)]
pub struct G4mtBlock {
    /// Magic identifiant le bloc (doit être `G4MT_MAGIC = 0x544D3447`).
    pub magic: u32,
    /// Nombre de frames de l'animation (lu à `lVar5 + 0x20` = `*(short*)`).
    pub frame_count: i16,
    /// ID de l'effet associé (index dans la table d'effets, 16 bits hauts
    /// du handle effect).
    pub effect_id: u16,
    /// Index du premier frame dans la table (offset `+0x2A`).
    pub frame_begin_idx: u16,
    /// Index du dernier frame (offset `+0x2E`).
    pub frame_end_idx: u16,
    /// Offset de base dans la table de frames (offset `+0x0A`).
    pub frame_base_offset: u16,
}

impl G4mtBlock {
    /// Vérifie que le magic est valide.
    #[must_use]
    pub fn is_valid(&self) -> bool {
        self.magic == G4MT_MAGIC
    }
}

// ------------------------------------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resource_handle_encode_decode() {
        let h = ResourceHandle((42u32 << 16) | 7);
        assert_eq!(h.index(), 42);
        assert_eq!(h.generation(), 7);
        assert!(!h.is_null());
        assert!(ResourceHandle(0).is_null());
    }

    #[test]
    fn blend_weight_clamp_and_complement() {
        let w = BlendWeight::new(0.3);
        assert!((w.0 - 0.3).abs() < f32::EPSILON);
        let c = w.complement();
        assert!((c.0 - 0.7).abs() < 1e-6);

        // Valeurs extrêmes
        let saturated = BlendWeight::new(1.5);
        assert_eq!(saturated.0, 1.0);
        let zero = BlendWeight::new(-1.0);
        assert_eq!(zero.0, 0.0);
    }

    #[test]
    fn transform3x4_default_is_identity() {
        let t = Transform3x4::default();
        // Diagonale = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]
        assert_eq!(t.0[0], 1.0);
        assert_eq!(t.0[5], 1.0);
        assert_eq!(t.0[10], 1.0);
        assert_eq!(t.0[3], 0.0);
    }

    #[test]
    fn blend_transform_full_src() {
        // dst_weight = 0.0 → dst doit devenir src
        let src = Transform3x4([2.0; 12]);
        let mut dst = Transform3x4([0.0; 12]);
        blend_transform(&src, &mut dst, 0.0);
        for v in dst.0 {
            assert!((v - 2.0).abs() < 1e-6);
        }
    }

    #[test]
    fn blend_transform_half() {
        let src = Transform3x4([1.0; 12]);
        let mut dst = Transform3x4([3.0; 12]);
        blend_transform(&src, &mut dst, 0.5);
        for v in dst.0 {
            // dst * 0.5 + src * 0.5 = 3*0.5 + 1*0.5 = 2.0
            assert!((v - 2.0).abs() < 1e-6);
        }
    }

    #[test]
    fn gmd_c_animation_new_defaults() {
        let anim = GmdCAnimation::new();
        assert_eq!(anim.scale, 1.0);
        assert_eq!(anim.speed_inv, -1.0);
        assert!(!anim.is_playing);
        assert_eq!(anim.bone_count, 0);
        assert!(anim.anim_handles.iter().all(|h| h.is_null()));
    }

    #[test]
    fn allocate_pose_buffers_correct_size() {
        let mut anim = GmdCAnimation::new();
        anim.allocate_pose_buffers(16);
        assert_eq!(anim.bone_count, 16);
        for buf in &anim.pose_buffers {
            assert_eq!(buf.len(), 16);
        }
    }

    #[test]
    fn cleanup_resets_handles() {
        let mut anim = GmdCAnimation::new();
        anim.anim_handles[0] = ResourceHandle(0x0001_0001);
        anim.motion_handle = ResourceHandle(0x0002_0003);
        anim.is_playing = true;
        anim.cleanup();
        assert!(anim.anim_handles.iter().all(|h| h.is_null()));
        assert!(anim.motion_handle.is_null());
        assert!(!anim.is_playing);
    }

    #[test]
    fn bone_blend_weight_saturated() {
        let anim = GmdCAnimation {
            bone_count: 2,
            bone_filter_enabled: true,
            ..GmdCAnimation::new()
        };
        let _ = anim.pose_buffers[0].clone(); // pas utilisé ici
        let src = vec![Transform3x4::default(); 2];
        let mut dst = vec![Transform3x4::default(); 2];
        let mut dirty = vec![0u8; 2];
        let mut desc = BoneBlendDesc {
            weight: BlendWeight::new(1.0),
            sub_frame_index: 0,
            mode_flags: 0,
            src_poses: &src,
            dst_poses: &mut dst,
            dst_dirty: &mut dirty,
        };
        let result = bone_blend(&anim, &mut desc, &[], None, None);
        assert!(matches!(result, Err(BoneBlendError::WeightSaturated)));
    }

    #[test]
    fn bone_blend_no_skeleton() {
        let anim = GmdCAnimation::new(); // bone_count = 0
        let src: Vec<Transform3x4> = vec![];
        let mut dst: Vec<Transform3x4> = vec![];
        let mut dirty: Vec<u8> = vec![];
        let mut desc = BoneBlendDesc {
            weight: BlendWeight::new(0.5),
            sub_frame_index: 0,
            mode_flags: 0,
            src_poses: &src,
            dst_poses: &mut dst,
            dst_dirty: &mut dirty,
        };
        let result = bone_blend(&anim, &mut desc, &[], None, None);
        assert!(matches!(result, Err(BoneBlendError::NoSkeleton)));
    }

    #[test]
    fn bone_blend_no_filter() {
        let anim = GmdCAnimation {
            bone_count: 2,
            bone_filter_enabled: false,
            ..GmdCAnimation::new()
        };
        let src = vec![Transform3x4::default(); 2];
        let mut dst = vec![Transform3x4::default(); 2];
        let mut dirty = vec![0u8; 2];
        let mut desc = BoneBlendDesc {
            weight: BlendWeight::new(0.3),
            sub_frame_index: 0,
            mode_flags: 0,
            src_poses: &src,
            dst_poses: &mut dst,
            dst_dirty: &mut dirty,
        };
        let result = bone_blend(&anim, &mut desc, &[], None, None);
        assert!(matches!(result, Err(BoneBlendError::NoSkinningData)));
    }

    #[test]
    fn g4mt_block_magic_valid() {
        let b = G4mtBlock {
            magic: G4MT_MAGIC,
            frame_count: 30,
            effect_id: 1,
            frame_begin_idx: 0,
            frame_end_idx: 29,
            frame_base_offset: 0,
        };
        assert!(b.is_valid());
        let bad = G4mtBlock { magic: 0xDEAD_BEEF, ..b };
        assert!(!bad.is_valid());
    }

    #[test]
    fn play_anime_null_param() {
        let mut anim = GmdCAnimation::new();
        let desc = AnimDescriptor {
            anime_type: AnimeType::Skeletal,
            resource_handle: ResourceHandle(0),
            layer_handle: ResourceHandle(0),
            motion_table_index: 0,
            effect_id: 0,
        };
        let result = play_anime(&mut anim, &desc);
        assert!(matches!(result, Err(PlayAnimeError::NullParam)));
    }

    #[test]
    fn play_anime_skeletal_ok() {
        let mut anim = GmdCAnimation::new();
        let desc = AnimDescriptor {
            anime_type: AnimeType::Skeletal,
            resource_handle: ResourceHandle(0x0001_0001),
            layer_handle: ResourceHandle(0),
            motion_table_index: 0,
            effect_id: 0,
        };
        let result = play_anime(&mut anim, &desc);
        assert!(matches!(result, Ok(true)));
        assert!(anim.is_playing);
    }

    #[test]
    fn compute_sub_frame_preferred_positive() {
        let slots = [10i32, 20, 30];
        let idx = compute_sub_frame(&slots, None, 1);
        assert_eq!(idx, Some(1));
    }

    #[test]
    fn compute_sub_frame_auto_first_nonzero() {
        let slots = [0i32, 0, 42];
        let idx = compute_sub_frame(&slots, None, -1);
        assert_eq!(idx, Some(2));
    }

    #[test]
    fn compute_sub_frame_all_zero_returns_none() {
        let slots = [0i32, 0, 0];
        let idx = compute_sub_frame(&slots, None, -1);
        assert_eq!(idx, None);
    }

    #[test]
    fn update_pose_buffers_not_playing() {
        // La précondition C est : *(+0xA0) != 0 d'abord, puis *(+0x198) != '\0'.
        // Pour atteindre NotPlaying il faut une ressource non nulle ET is_playing=false.
        let mut anim = GmdCAnimation {
            bone_count: 4,
            is_playing: false,
            // motion_handle non nul → passe la garde NoAnimResource
            motion_handle: ResourceHandle(0x0001_0001),
            ..GmdCAnimation::new()
        };
        let result = update_pose_buffers(&mut anim);
        assert!(matches!(result, Err(PoseAllocError::NotPlaying)));
    }
}
