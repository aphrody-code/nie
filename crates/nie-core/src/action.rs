//! Contrôleur d'actions joueur (`game::SoccerActionCtrl`).
//!
//! Porte la structure de slots d'action et l'initialisation depuis
//! `refs/iecode-re/research/ghidra-export/decompiled/soccer_action_ctrl.c`.
//!
//! # Sources RE
//!
//! - `soccer_action_ctrl.c` — `FUN_1412ca580` = `SoccerActionCtrl::SoccerActionCtrl()` (lignes nie.c 3467044-3467078)
//! - `soccer_action_ctrl.c` — `FUN_1412ca660` = `copy_action()` (lignes nie.c 3467082-3467128)
//! - `soccer_action_ctrl.c` — `FUN_1412ca7f0` = `init_transform()` (lignes nie.c 3467134-3467231)
//!
//! # Fidélité
//!
//! - 32 slots, stride 0x120 (288 bytes) : FIABLE (`lVar2 = 0x20`, `lVar1 + 0x120`)
//! - Données par slot = 0x118 bytes + 2 bytes état : FIABLE
//! - Scale identité (1.0f) dans `init_transform()` : FIABLE (bits IEEE 754 explicites)
//! - Taille totale `0xA0` pour `copy_action()` : FIABLE (`FUN_1416709b0(param_1, 0, 0xa0)`)
//! - Contenu interne des slots d'action (layout position/direction/collision) : RECONSTRUIT
//!   — déduit du commentaire Ghidra, non confirmé byte-par-byte

/// Nombre de slots d'action simultanés par joueur.
///
/// Source: `soccer_action_ctrl.c` — `lVar2 = 0x20` (32 itérations).
pub const ACTION_SLOT_COUNT: usize = 32;

/// Taille de la zone de données d'une action (bytes).
///
/// Source: `FUN_1412ca7f0` — la structure copiée dans `copy_action()` est `0xA0 = 160` bytes.
pub const ACTION_DATA_SIZE: usize = 0xA0;

/// État d'un slot d'action.
///
/// Source: `soccer_action_ctrl.c` — `*(undefined2 *)(lVar1 + -1) = 0` dans la boucle d'init.
/// `0` = libre, non-nul = en cours.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum ActionSlotState {
    /// Slot disponible.
    #[default]
    Free,
    /// Action en cours dans ce slot.
    Active,
}

/// Données brutes d'un slot d'action (160 bytes opaque).
///
/// La structure interne de ces 160 bytes est partiellement reconstruite
/// depuis les commentaires Ghidra mais non vérifiée byte-par-byte.
/// Stockée comme tableau d'octets pour refléter fidèlement l'opacité RE.
///
/// RE incertain: layout interne des 160 bytes. Le commentaire Ghidra suggère:
/// - `+0x00`: type d'action (enum)
/// - `+0x10-0x30`: position 3D cible
/// - `+0x30-0x50`: direction
/// - `+0x50-0xA0`: données collision/résultat
/// Mais ce n'est pas vérifié par le code C décompilé.
#[derive(Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct ActionData {
    /// Données brutes (160 bytes, initialisées à 0).
    pub raw: [u8; ACTION_DATA_SIZE],
}

impl Default for ActionData {
    fn default() -> Self {
        Self { raw: [0u8; ACTION_DATA_SIZE] }
    }
}

impl core::fmt::Debug for ActionData {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.debug_struct("ActionData")
            .field("raw[0..4]", &&self.raw[..4])
            .finish()
    }
}

impl ActionData {
    /// Copie les données depuis une autre `ActionData` (copie complète).
    ///
    /// Source: `FUN_1412ca660` — copie de 20 qwords (0xA0 bytes) via
    /// affectations directes pairées. Retourne une erreur si source nulle.
    ///
    /// # Exemple
    ///
    /// ```
    /// use nie_core::action::ActionData;
    ///
    /// let mut src = ActionData::default();
    /// src.raw[0] = 42;
    /// let dst = ActionData::copy_from(&src);
    /// assert_eq!(dst.raw[0], 42);
    /// ```
    #[must_use]
    pub fn copy_from(src: &Self) -> Self {
        Self { raw: src.raw }
    }

    /// Remet toutes les données à zéro (équivalent à `memset(0, 0xA0)`).
    pub fn clear(&mut self) {
        self.raw = [0u8; ACTION_DATA_SIZE];
    }
}

/// Un slot d'action individuel (partie d'un `SoccerActionCtrl`).
///
/// Source: `soccer_action_ctrl.c` — stride `0x120` bytes par slot.
/// Structure: `0x118` bytes données + `2` bytes état.
#[derive(Debug, Default, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct ActionSlot {
    /// Données de l'action (parties visibles = 0xA0 bytes au minimum).
    pub data: ActionData,
    /// État du slot (libre ou actif).
    pub state: ActionSlotState,
}

impl ActionSlot {
    /// Libère le slot (réinitialise données + état).
    pub fn free(&mut self) {
        self.data.clear();
        self.state = ActionSlotState::Free;
    }

    /// Retourne `true` si le slot est disponible.
    #[must_use]
    pub fn is_free(&self) -> bool {
        self.state == ActionSlotState::Free
    }
}

/// Données de transformation pour le rendu d'un slot.
///
/// Source: `FUN_1412ca7f0` (`init_transform`) — initialisées avec des scales
/// à 1.0f et des positions/rotations à zéro.
///
/// RE incertain: les 3 paires position/orientation puis les 6 scales sont
/// déduites du pseudo-C mais le nombre exact de vecteurs n'est pas absolu.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct ActionTransform {
    /// Échelle sur l'axe X pour les 3 composantes.
    ///
    /// Source: `param_1[6..11] = 0x3f8000003f800000` (deux f32 = 1.0 dans un qword).
    /// Valeur exacte confirmée par les bits IEEE 754.
    pub scales: [[f32; 2]; 6],
}

impl Default for ActionTransform {
    fn default() -> Self {
        // init_transform: `param_1[6..11] = 0x3f8000003f800000`
        // = paires (1.0f, 1.0f) × 6 slots
        Self { scales: [[1.0f32, 1.0f32]; 6] }
    }
}

impl ActionTransform {
    /// Vérifie que toutes les scales sont à l'identité (1.0).
    #[must_use]
    pub fn is_identity(&self) -> bool {
        self.scales.iter().all(|&[a, b]| a == 1.0 && b == 1.0)
    }
}

/// Contrôleur d'actions d'un joueur (`game::SoccerActionCtrl`).
///
/// Contient 32 slots d'action, un compteur global et un flag d'état.
///
/// Source: `soccer_action_ctrl.c` — taille originale ~0x2488 (9352 bytes).
///
/// # Exemple
///
/// ```
/// use nie_core::action::{SoccerActionCtrl, ActionSlotState};
///
/// let ctrl = SoccerActionCtrl::new();
/// assert_eq!(ctrl.active_count, 0);
/// assert!(ctrl.slots.iter().all(|s| s.is_free()));
/// ```
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct SoccerActionCtrl {
    /// 32 slots d'action simultanés.
    pub slots: [ActionSlot; ACTION_SLOT_COUNT],
    /// Compteur d'actions actives.
    ///
    /// Source: `*(undefined4 *)(param_1 + 0x48e) = 0` dans le ctor.
    pub active_count: u32,
    /// Flag global d'état du contrôleur.
    ///
    /// Source: `*(undefined1 *)(param_1 + 0x490) = 0` dans le ctor.
    pub global_flag: bool,
}

impl Default for SoccerActionCtrl {
    fn default() -> Self {
        Self {
            slots: core::array::from_fn(|_| ActionSlot::default()),
            active_count: 0,
            global_flag: false,
        }
    }
}

impl SoccerActionCtrl {
    /// Crée un contrôleur vide.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Retourne le premier slot libre, ou `None` si tous sont occupés.
    #[must_use]
    pub fn first_free_slot(&self) -> Option<usize> {
        self.slots.iter().position(|s| s.is_free())
    }

    /// Compte les slots actifs (vérifié depuis `active_count`).
    ///
    /// Ce compteur est maintenu côté C++ — en Rust on le resynchronise
    /// si nécessaire via cette méthode.
    #[must_use]
    pub fn count_active(&self) -> usize {
        self.slots.iter().filter(|s| !s.is_free()).count()
    }

    /// Libère tous les slots (reset complet).
    pub fn reset_all(&mut self) {
        for slot in &mut self.slots {
            slot.free();
        }
        self.active_count = 0;
        self.global_flag = false;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn action_ctrl_default_all_free() {
        let ctrl = SoccerActionCtrl::new();
        assert!(ctrl.slots.iter().all(|s| s.is_free()));
        assert_eq!(ctrl.active_count, 0);
        assert!(!ctrl.global_flag);
    }

    #[test]
    fn action_ctrl_slot_count() {
        let ctrl = SoccerActionCtrl::new();
        // 32 slots exactement — confirmé par lVar2 = 0x20
        assert_eq!(ctrl.slots.len(), 32);
    }

    #[test]
    fn action_slot_free_then_active() {
        let mut slot = ActionSlot::default();
        assert!(slot.is_free());
        slot.state = ActionSlotState::Active;
        assert!(!slot.is_free());
        slot.free();
        assert!(slot.is_free());
    }

    #[test]
    fn action_data_copy() {
        let mut src = ActionData::default();
        src.raw[0] = 0xDE;
        src.raw[1] = 0xAD;
        let dst = ActionData::copy_from(&src);
        assert_eq!(dst.raw[0], 0xDE);
        assert_eq!(dst.raw[1], 0xAD);
    }

    #[test]
    fn action_data_size_correct() {
        // 0xA0 = 160 bytes — confirmé par FUN_1412ca660 copie de 20 qwords
        assert_eq!(core::mem::size_of::<ActionData>(), 160);
    }

    #[test]
    fn action_transform_identity() {
        // 0x3f8000003f800000 = (1.0f, 1.0f) × 6 — confirmé par FUN_1412ca7f0
        let t = ActionTransform::default();
        assert!(t.is_identity());
        // Vérifie les bits IEEE 754
        for pair in &t.scales {
            assert_eq!(pair[0].to_bits(), 0x3F80_0000);
            assert_eq!(pair[1].to_bits(), 0x3F80_0000);
        }
    }

    #[test]
    fn action_ctrl_first_free_slot() {
        let mut ctrl = SoccerActionCtrl::new();
        assert_eq!(ctrl.first_free_slot(), Some(0));
        ctrl.slots[0].state = ActionSlotState::Active;
        assert_eq!(ctrl.first_free_slot(), Some(1));
    }

    #[test]
    fn action_ctrl_count_active() {
        let mut ctrl = SoccerActionCtrl::new();
        assert_eq!(ctrl.count_active(), 0);
        ctrl.slots[0].state = ActionSlotState::Active;
        ctrl.slots[5].state = ActionSlotState::Active;
        assert_eq!(ctrl.count_active(), 2);
    }

    #[test]
    fn action_ctrl_reset_all() {
        let mut ctrl = SoccerActionCtrl::new();
        ctrl.slots[0].state = ActionSlotState::Active;
        ctrl.active_count = 1;
        ctrl.global_flag = true;
        ctrl.reset_all();
        assert_eq!(ctrl.count_active(), 0);
        assert_eq!(ctrl.active_count, 0);
        assert!(!ctrl.global_flag);
    }
}
