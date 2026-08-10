//! Scène principale du match (`game::CSceneSoccer`).
//!
//! Porte le constructeur décompilé `FUN_1412aa220` depuis
//! `refs/iecode-re/research/ghidra-export/decompiled/soccer_scene_init.c` (même source que
//! [`crate::ball`]/[`crate::keeper`]). `CSceneSoccer` (hérite de `CScene`) est le conteneur de
//! match : il **compose la machine d'état** ([`crate::match_fsm`], `CSoccerStateMachine` à `+0x170`),
//! deux zones de données par équipe (`+0xa588`/`+0xa938`, `0x3b0` octets chacune), la zone de
//! données de match (`+0x96cc`, `0xe84` octets) et des **paramètres de rendu/couleur**.
//!
//! # Fidélité
//!
//! La majeure partie du ctor zéro-initialise de grandes zones (slots joueurs, données de match,
//! zones d'équipe) — modélisées par les sous-systèmes dédiés (FSM, scores). Les **constantes de
//! couleur/rendu** sont byte-exact (valeurs littérales du décompilé). La sémantique fine des zones
//! d'équipe (`0x3b0` octets) n'est pas décomposée ici (RE partiel, assumé) ; ce module fixe la
//! **composition** et les **constantes** de la scène.

use crate::match_fsm::{MatchContext, MatchState};

/// Conteneur de la scène de match (`game::CSceneSoccer`).
///
/// Source : `soccer_scene_init.c` `FUN_1412aa220`. Compose la machine d'état du match + les
/// paramètres de rendu (couleurs) de la scène, byte-exact depuis le ctor.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct MatchScene {
    /// `+0x170` — état courant du `CSoccerStateMachine` (init `Init`, cf. [`MatchState`]).
    pub state: MatchState,
    /// Contexte de la machine d'état du match.
    pub ctx: MatchContext,
    /// `+0xacec` — paramètre de rendu/couleur (write 8 octets, init `0x100`).
    pub render_param: u64,
    /// `+0xacf4` — couleur primaire de rendu (init `0xFF00`, « vert » selon le décompilé).
    pub render_color_primary: u32,
    /// `+0xad0c` — couleur secondaire (write 8 octets, init `0xFF0000`, « rouge »).
    pub render_color_secondary: u32,
}

impl MatchScene {
    /// Crée la scène de match avec les valeurs d'initialisation du ctor `CSceneSoccer`.
    ///
    /// # Exemple
    ///
    /// ```
    /// use nie_core::scene::MatchScene;
    /// use nie_core::match_fsm::MatchState;
    ///
    /// let scene = MatchScene::new();
    /// assert_eq!(scene.state, MatchState::Init);
    /// assert_eq!(scene.render_color_primary, 0xFF00);
    /// ```
    #[must_use]
    pub fn new() -> Self {
        Self {
            state: MatchState::Init,
            ctx: MatchContext::default(),
            render_param: 0x100,
            render_color_primary: 0xFF00,
            render_color_secondary: 0xFF_0000,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn match_scene_init_byte_exact() {
        // Constantes du ctor FUN_1412aa220 (soccer_scene_init.c).
        let s = MatchScene::new();
        assert_eq!(s.state, MatchState::Init); // CSoccerStateMachine démarre en case 0
        assert_eq!(s.render_param, 0x100); // +0xacec
        assert_eq!(s.render_color_primary, 0xFF00); // +0xacf4 (vert)
        assert_eq!(s.render_color_secondary, 0xFF_0000); // +0xad0c (rouge)
        assert!(!s.ctx.is_training);
    }

    #[test]
    fn match_scene_default_eq_new() {
        // Default ≠ ctor (Default zéro) : new() porte les constantes réelles.
        assert_eq!(MatchScene::new().render_color_primary, 0xFF00);
        assert_eq!(MatchScene::default().render_color_primary, 0); // Default dérivé = zéros
    }
}
