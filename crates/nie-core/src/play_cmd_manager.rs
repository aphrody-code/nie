//! Structure d'initialisation du match : `game::SoccerPlayCmdManager` (file de commandes de jeu),
//! l'objet de scoring, et le **système d'événements de match** (le prérequis du vrai modèle de but).
//!
//! Porté des **constantes structurelles EXACTES** de la séquence d'init de match décompilée. Cette
//! séquence alloue une douzaine de sous-systèmes via l'allocateur du moteur Level-5 ; on ne porte
//! PAS l'orchestration d'allocation (dispatch vtable + heap moteur, spécifique runtime) mais les
//! **tailles, paramètres d'init et constantes de données confirmés** par le décompilé — comme
//! [`crate::command_effect`].
//!
//! # Sources RE
//! - C décompilé : `refs/iecode-re/research/ghidra-export/decompiled/soccer_play_cmd_manager.c`
//!   (init match, `nie.c` L3830230-3830430).
//!
//! # Confirmé vs inféré
//! Les **tailles** (0xA0, 0x20, 0x150, 0x1BC0, 0x18F0), les **arguments d'init** (file `{8, 0x16}`,
//! effets `8`), les **constantes de scoring** (multiplicateur `1.0f`, flags `0x100`, 4 scores à 0)
//! et le **nombre de callbacks d'événement (9)** sont LUS du décompilé. La **sémantique** des
//! callbacks (`on_goal`/`on_foul`…) est *inférée* par le reverser et marquée comme telle ; les
//! adresses `FUN_*` d'origine ne sont PAS reproduites (build-spécifiques, cf. dérive binaire).

// ============================================================================
// Tailles des sous-systèmes alloués pendant l'init de match (octets) — confirmées
// ============================================================================

/// `game::SoccerPlayCmdManager` — file d'exécution des commandes de jeu.
pub const PLAY_CMD_MANAGER_SIZE: usize = 0xA0;
/// Objet de scoring du match (scores + multiplicateur).
pub const SCORING_SIZE: usize = 0x20;
/// Wrapper `game::SoccerCommandEffect`.
pub const COMMAND_EFFECT_WRAPPER_SIZE: usize = 0x150;
/// Système d'événements de match (porte les 9 callbacks).
pub const MATCH_EVENT_SYSTEM_SIZE: usize = 0x1BC0;
/// Gestionnaire de replay/caméra.
pub const REPLAY_CAMERA_SIZE: usize = 0x18F0;

// ============================================================================
// Paramètres d'initialisation — confirmés (args passés aux init internes)
// ============================================================================

/// Taille max de la file de commandes (`vtable[1](self, {8, 0x16})`, 1ᵉʳ champ).
pub const PLAY_CMD_MAX_QUEUE: u32 = 8;
/// Niveau de priorité de la file (`vtable[1](self, {8, 0x16})`, 2ᵉ champ).
pub const PLAY_CMD_PRIORITY: u32 = 0x16;
/// Nombre max d'effets de commande (`SoccerCommandEffect::init(8)`).
pub const COMMAND_EFFECT_MAX: u32 = 8;
/// Nombre de callbacks enregistrés dans le système d'événements de match.
pub const MATCH_EVENT_CALLBACK_COUNT: usize = 9;

/// Offset du flag d'activation dans le système d'événements (`[obj+0x1BAC]`).
pub const MATCH_EVENT_FLAG_OFFSET: usize = 0x1BAC;
/// Offset de la table de callbacks fusionnée (`[obj+0x18A0]`).
pub const MATCH_EVENT_CALLBACK_TABLE_OFFSET: usize = 0x18A0;

// ============================================================================
// Objet de scoring — constantes EXACTES du décompilé
// ============================================================================

/// État de scoring d'un match, layout 0x20 octets (port du bloc d'init L141-147 du décompilé).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MatchScoring {
    /// 4 compteurs de score (initialisés à 0). Sémantique précise (par équipe/période) non confirmée.
    pub scores: [u32; 4],
    /// Multiplicateur de score `[obj+0x18]` = `1.0f` (`0x3F80_0000`).
    pub multiplier: f32,
    /// Flags `[obj+0x1C]` = `0x0100`.
    pub flags: u16,
}

impl Default for MatchScoring {
    /// Reproduit l'init du décompilé : scores=0, multiplicateur=1.0f (bits `0x3F80_0000`), flags=0x100.
    fn default() -> Self {
        Self {
            scores: [0; 4],
            multiplier: f32::from_bits(0x3F80_0000),
            flags: 0x0100,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scoring_init_byte_exact() {
        let s = MatchScoring::default();
        assert_eq!(s.scores, [0; 4]);
        // multiplicateur = 1.0f, bits EXACTS du décompilé (0x3F800000).
        assert_eq!(s.multiplier.to_bits(), 0x3F80_0000);
        assert_eq!(s.multiplier, 1.0);
        assert_eq!(s.flags, 0x0100);
    }

    #[test]
    fn init_params_confirmes() {
        // Arguments d'init lus du décompilé (vtable[1](self, {8, 0x16}) ; init effets = 8).
        assert_eq!(PLAY_CMD_MAX_QUEUE, 8);
        assert_eq!(PLAY_CMD_PRIORITY, 0x16);
        assert_eq!(COMMAND_EFFECT_MAX, 8);
        assert_eq!(MATCH_EVENT_CALLBACK_COUNT, 9);
        // Tailles des sous-systèmes (octets).
        assert_eq!(PLAY_CMD_MANAGER_SIZE, 0xA0);
        assert_eq!(MATCH_EVENT_SYSTEM_SIZE, 0x1BC0);
    }
}
