//! IA tactique par joueur (`game::SoccerCharaTacticsAI`).
//!
//! Porte la structure des contextes tactiques depuis
//! `refs/iecode-re/research/ghidra-export/decompiled/soccer_tactics_ai.c`.
//!
//! # Sources RE
//!
//! - `soccer_tactics_ai.c` — `FUN_14130b9e0` = ctor (lignes nie.c 3517024-3517146)
//! - `soccer_tactics_ai.c` — `FUN_14130bd50` = `init()` (lignes nie.c 3517150-3517172)
//! - `soccer_tactics_ai.c` — `FUN_14130be30` = `evaluate()` (lignes nie.c 3517176+)
//!
//! # Fidélité
//!
//! - 3 contextes tactiques avec 4 priorités chacun : FIABLE
//! - Priorité max = 7, compteur = 1 par priorité : FIABLE
//! - Mode tactique par défaut = 2 : FIABLE
//! - Distance seuil = -1.0f : FIABLE (0xBF800000 IEEE 754)
//! - Masque de flags = 0x1000000 : FIABLE
//! - Timeout contexte 3 = 20 (0x14) : FIABLE
//! - Compteur contexte 3 = 5 : FIABLE
//! - Sémantique des 3 contextes (offensif/défensif/neutre) : RECONSTRUIT
//!   depuis la position dans la struct — non confirmé par labels binaires
//! - Logique d'`evaluate()` : PARTIELLEMENT PORTÉE — seul le squelette de
//!   la recherche dans la table est visible, pas les calculs de score

use crate::{DISTANCE_UNINIT, TACTICS_FLAGS_MASK, TACTICS_MAX_PRIORITY, Vec3};

/// Mode tactique d'un joueur.
///
/// Source: `*(undefined8 *)((longlong)param_1 + 0xac) = 2` dans le ctor.
/// RE incertain: l'enum exact n'est pas décodé — seule la valeur `2` comme
/// défaut est confirmée. Les valeurs 0, 1, 3 sont inférées.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[repr(u8)]
pub enum TacticsMode {
    /// Mode inactif (0).
    Off = 0,
    /// Mode défensif (1).
    Defensive = 1,
    /// Mode normal (2, défaut).
    #[default]
    Normal = 2,
    /// Mode offensif (3).
    /// RE incertain: valeur 3 non observée explicitement.
    Offensive = 3,
}

impl TryFrom<u64> for TacticsMode {
    type Error = ();
    fn try_from(v: u64) -> Result<Self, ()> {
        match v {
            0 => Ok(Self::Off),
            1 => Ok(Self::Defensive),
            2 => Ok(Self::Normal),
            3 => Ok(Self::Offensive),
            _ => Err(()),
        }
    }
}

/// Un niveau de priorité dans un contexte tactique.
///
/// Source: `soccer_tactics_ai.c` — pattern répété 4 fois par contexte:
/// ```c
/// *(undefined4 *)(param_1 + 0x19) = 1;  // compteur = 1
/// *(undefined2 *)((longlong)param_1 + 0xcc) = 7;  // priorité max = 7
/// *(undefined1 *)((longlong)param_1 + 0xce) = 0;  // flag = 0
/// param_1[0x18] = 0;  // données = 0
/// ```
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct TacticsPriorityLevel {
    /// Compteur (initialisé à 1).
    pub count: u32,
    /// Priorité maximale (initialisée à 7 = `TACTICS_MAX_PRIORITY`).
    pub max_priority: u16,
    /// Flag d'état (initialisé à 0).
    pub flag: u8,
}

impl Default for TacticsPriorityLevel {
    fn default() -> Self {
        Self {
            count: 1,
            max_priority: TACTICS_MAX_PRIORITY,
            flag: 0,
        }
    }
}

/// Contexte tactique (offensif, défensif ou neutre).
///
/// Chaque contexte contient 4 niveaux de priorité + des données
/// de position/direction et des méta-données.
///
/// Source: `soccer_tactics_ai.c` — 3 blocs répétés dans `FUN_14130b9e0`.
/// RE incertain: les rôles "offensif/défensif/neutre" sont inférés de
/// la position dans la struct, non confirmés par labels binaires.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct TacticsContext {
    /// 4 niveaux de priorité de décision.
    pub priorities: [TacticsPriorityLevel; 4],
    /// Flag de contexte actif.
    ///
    /// Source: `*(undefined1 *)(param_1 + 0x20) = 0` après les 4 priorités.
    pub active_flag: u8,
    /// Position du joueur dans ce contexte.
    pub position: Vec3,
    /// Direction du joueur dans ce contexte.
    pub direction: Vec3,
    /// Distance seuil de déclenchement (`-1.0` = invalide/non défini).
    ///
    /// Source: `*(undefined4 *)(param_1 + 0x2a) = 0xbf800000`.
    pub distance_threshold: f32,
    /// Masque de flags tactiques.
    ///
    /// Source: `*(undefined4 *)((longlong)param_1 + 0x154) = 0x1000000`.
    pub flags_mask: u32,
}

impl Default for TacticsContext {
    fn default() -> Self {
        Self {
            priorities: core::array::from_fn(|_| TacticsPriorityLevel::default()),
            active_flag: 0,
            position: Vec3::zero(),
            direction: Vec3::zero(),
            distance_threshold: DISTANCE_UNINIT,
            flags_mask: TACTICS_FLAGS_MASK,
        }
    }
}

impl TacticsContext {
    /// Retourne `true` si le contexte est actif.
    #[must_use]
    pub fn is_active(&self) -> bool {
        self.active_flag != 0
    }

    /// Retourne `true` si le seuil de distance est défini (pas -1.0).
    #[must_use]
    pub fn has_distance_threshold(&self) -> bool {
        (self.distance_threshold - DISTANCE_UNINIT).abs() > f32::EPSILON
    }
}

/// Contexte tactique spécial (3ème contexte, set play / neutre).
///
/// Source: `soccer_tactics_ai.c` — dernier bloc, avec des valeurs différentes:
/// `*(undefined4 *)(param_1 + 0x54) = 0x14` (timeout=20) et
/// `*(undefined8 *)((longlong)param_1 + 0x2a4) = 5` (compteur=5).
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct TacticsContextSpecial {
    /// Contexte de base.
    pub base: TacticsContext,
    /// Timeout en frames avant reset (20 par défaut).
    ///
    /// Source: `*(undefined4 *)(param_1 + 0x54) = 0x14`.
    pub timeout_frames: u32,
    /// Compteur interne (5 par défaut).
    ///
    /// Source: `*(undefined8 *)((longlong)param_1 + 0x2a4) = 5`.
    pub counter: u64,
    /// Flag supplémentaire.
    ///
    /// Source: `*(undefined1 *)((longlong)param_1 + 0x2ac) = 0`.
    pub extra_flag: u8,
}

impl Default for TacticsContextSpecial {
    fn default() -> Self {
        Self {
            base: TacticsContext::default(),
            timeout_frames: 0x14, // 20 frames
            counter: 5,
            extra_flag: 0,
        }
    }
}

/// Index d'équipe (0 = équipe A, 1 = équipe B).
///
/// Source: `FUN_14130bd50` — `param_4` est un `uint` représentant l'index.
/// Maskage `& 0x7F` pour la sécurité dans le binaire original.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct TeamIndex(pub u8);

impl TeamIndex {
    /// Retourne l'index sécurisé (maskage `& 0x7F` comme dans le binaire).
    #[must_use]
    pub fn safe(self) -> usize {
        (self.0 & 0x7F) as usize
    }
}

/// IA tactique d'un joueur (`game::SoccerCharaTacticsAI`).
///
/// Taille originale ~0x2B0 bytes (688 bytes).
/// Contient 3 contextes tactiques + des métadonnées de configuration.
///
/// Source: `soccer_tactics_ai.c` — `FUN_14130b9e0`.
///
/// # Exemple
///
/// ```
/// use nie_core::tactics::{CharaTacticsAi, TacticsMode};
///
/// let ai = CharaTacticsAi::new();
/// assert_eq!(ai.mode, TacticsMode::Normal);
/// assert!(!ai.context_offensive.is_active());
/// ```
#[derive(Debug, Clone, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct CharaTacticsAi {
    /// Mode tactique actif (défaut = `Normal` = 2).
    pub mode: TacticsMode,
    /// Contexte offensif (premier bloc dans la struct C++).
    ///
    /// RE incertain: "offensif" est inféré de la position — non confirmé.
    pub context_offensive: TacticsContext,
    /// Contexte défensif (deuxième bloc).
    ///
    /// RE incertain: "défensif" est inféré de la position — non confirmé.
    pub context_defensive: TacticsContext,
    /// Contexte set-play/neutre (troisième bloc, valeurs spéciales).
    pub context_special: TacticsContextSpecial,
    /// Index de l'équipe du joueur.
    ///
    /// Source: `*(char *)(param_1 + 0x50) = (char)param_4` dans `init()`.
    pub team_index: TeamIndex,
    /// Paramètre de config A (depuis `init()`, `*param_2`).
    ///
    /// RE incertain: type exact (`undefined4`), sémantique inconnue.
    pub config_param_a: u32,
    /// Paramètre de config B (depuis `init()`, `*param_3`).
    ///
    /// RE incertain.
    pub config_param_b: u32,
}

impl CharaTacticsAi {
    /// Crée un composant IA tactique avec les valeurs du constructeur C++.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Initialise avec l'index d'équipe et les paramètres de config.
    ///
    /// Source: `FUN_14130bd50` — stocke l'index équipe et les config params.
    pub fn init(&mut self, team: TeamIndex, param_a: u32, param_b: u32) {
        self.team_index = team;
        self.config_param_a = param_a;
        self.config_param_b = param_b;
    }

    /// Retourne le contexte correspondant à un index (0, 1 ou 2).
    ///
    /// RE incertain: la correspondance index → contexte est inférée.
    #[must_use]
    pub fn context(&self, index: usize) -> Option<&TacticsContext> {
        match index {
            0 => Some(&self.context_offensive),
            1 => Some(&self.context_defensive),
            2 => Some(&self.context_special.base),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{DISTANCE_UNINIT, TACTICS_FLAGS_MASK, TACTICS_MAX_PRIORITY};

    #[test]
    fn tactics_ai_default_mode() {
        let ai = CharaTacticsAi::new();
        // *(undefined8 *)((longlong)param_1 + 0xac) = 2 → Normal
        assert_eq!(ai.mode, TacticsMode::Normal);
        assert_eq!(ai.mode as u8, 2);
    }

    #[test]
    fn tactics_context_default_priorities() {
        let ctx = TacticsContext::default();
        for p in &ctx.priorities {
            // *(undefined4 *)(...) = 1 → count = 1
            assert_eq!(p.count, 1);
            // *(undefined2 *)(...) = 7 → max_priority = 7
            assert_eq!(p.max_priority, TACTICS_MAX_PRIORITY);
            // *(undefined1 *)(...) = 0 → flag = 0
            assert_eq!(p.flag, 0);
        }
    }

    #[test]
    fn tactics_context_distance_uninit() {
        let ctx = TacticsContext::default();
        // 0xBF800000 = -1.0f — confirmé par soccer_tactics_ai.c
        assert_eq!(ctx.distance_threshold.to_bits(), 0xBF80_0000);
        assert_eq!(ctx.distance_threshold, DISTANCE_UNINIT);
        assert!(!ctx.has_distance_threshold());
    }

    #[test]
    fn tactics_context_flags_mask() {
        let ctx = TacticsContext::default();
        // 0x1000000 — confirmé par soccer_tactics_ai.c
        assert_eq!(ctx.flags_mask, TACTICS_FLAGS_MASK);
        assert_eq!(ctx.flags_mask, 0x0100_0000);
    }

    #[test]
    fn tactics_context_not_active_by_default() {
        let ctx = TacticsContext::default();
        assert!(!ctx.is_active());
    }

    #[test]
    fn tactics_context_special_timeout() {
        let ctx = TacticsContextSpecial::default();
        // *(undefined4 *)(param_1 + 0x54) = 0x14 → 20 frames
        assert_eq!(ctx.timeout_frames, 20);
    }

    #[test]
    fn tactics_context_special_counter() {
        let ctx = TacticsContextSpecial::default();
        // *(undefined8 *)(...) = 5
        assert_eq!(ctx.counter, 5);
    }

    #[test]
    fn tactics_ai_has_three_contexts() {
        let ai = CharaTacticsAi::new();
        assert!(ai.context(0).is_some());
        assert!(ai.context(1).is_some());
        assert!(ai.context(2).is_some());
        assert!(ai.context(3).is_none());
    }

    #[test]
    fn tactics_ai_init() {
        let mut ai = CharaTacticsAi::new();
        ai.init(TeamIndex(1), 42, 99);
        assert_eq!(ai.team_index.0, 1);
        assert_eq!(ai.config_param_a, 42);
        assert_eq!(ai.config_param_b, 99);
    }

    #[test]
    fn team_index_safe_masking() {
        // Maskage & 0x7F — comme dans FUN_14130bd50
        let t = TeamIndex(0xFF);
        assert_eq!(t.safe(), 0x7F);
        let t2 = TeamIndex(1);
        assert_eq!(t2.safe(), 1);
    }

    #[test]
    fn tactics_mode_try_from() {
        assert_eq!(TacticsMode::try_from(0u64), Ok(TacticsMode::Off));
        assert_eq!(TacticsMode::try_from(2u64), Ok(TacticsMode::Normal));
        assert!(TacticsMode::try_from(99u64).is_err());
    }
}
