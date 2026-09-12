//! **nie-app** — shared application-state and rendering prototype for niers.
//!
//! It owns the rendering DTO ([`GameState`]), the abstract rendering contract ([`Renderer`]),
//! and the interactive state machine ([`flow::Screen`]). `Screen` delegates rendering to
//! `GameState` through `render_state`. Current consumers include `nie-play` (headless CPU output)
//! and `nie-wasm` (interactive web host).
//!
//! The state machine uses the deterministic local `nie-runtime` simulation. Its DTOs and scripted
//! flows do not establish fidelity with the native executable or its screens.

pub mod character;
/// Effectif réel chargé depuis le VFS — natif seulement : le VFS lit des fichiers, ce que le web
/// ne fait pas (il reçoit ses octets par `fetch`).
#[cfg(not(target_arch = "wasm32"))]
pub mod effectif;
pub mod flow;
/// Rendu 3D d'un match (vrais modèles du VFS) — natif seulement, comme `effectif`.
#[cfg(not(target_arch = "wasm32"))]
pub mod match3d;
pub mod render;
#[cfg(not(target_arch = "wasm32"))]
pub mod roster;
pub mod story;

/// Renderer CPU natif (charge les assets disque) — absent en wasm (le web utilise [`render::render_state`]).
#[cfg(not(target_arch = "wasm32"))]
pub use render::CpuRenderer;
pub use render::{Font, Frame, H, MENU_DESCRIPTIONS, W, render_main_menu};

/// Shared rendering state used by the front ends.
///
/// These variants are presentation DTOs, not evidence that the corresponding native screens have
/// been reproduced.
#[derive(Debug, Clone)]
pub enum GameState {
    /// Écran-titre (logo + PRESS START).
    Title,
    /// Menu principal, `sel` = option surlignée.
    MainMenu { sel: usize },
    /// Résultat / déroulé de match (score domicile-extérieur).
    Match { home: u8, away: u8 },
    /// Scène de dialogue (mode histoire).
    Story { speaker: String, line: String },
}

/// Les 9 onglets RÉELS du menu principal d'IEVR, prouvés byte-exact dans `main_menu_1.02.92.00.lua.bin`
/// (types {10,20,30,70,40,80,60,50,90} → obj_hash CRC32 + text_id). Libellés = vrais textes FR
/// (`data/common/text/fr/menu_text.cfg.bin.json`, résolus par hash). Source vérifiée, pas inventé.
pub const MENU: [&str; 9] = [
    "Composition d'équipe",        // team_dock_menu
    "Objets",                      // item_menu
    "Marque-pages d'informations", // info_bookmark_menu
    "Inacord",                     // inacode_menu
    "Fichier de données",          // datafile_menu
    "Adversaires",                 // opponent_team_menu (→ sélection de mode/match)
    "Aide",                        // help_menu
    "Options",                     // setting_menu
    "Sauvegarder",                 // rpg_save_menu
];

/// Les 5 MODES DE JEU racine d'IEVR (libellés FR réels, hash menu_text). Atteints via « Adversaires ».
/// Source : menu_text + cfg `*_mode_top_menu_setting.cfg.bin` / `bb_stadium_top_menu_setting.cfg.bin`.
pub const MODES: [&str; 5] = [
    "Mode Histoire",
    "Mode Chronique",
    "Mode Compétition",
    "Victory Road",
    "Stade BB",
];

/// Abstraction de rendu : un front-end fournit un `Renderer` qui transforme un état en frame RGBA
/// (1280×720, 4 octets/px). CPU (`CpuRenderer`) aujourd'hui, wgpu demain (nie-game, Phase 4).
pub trait Renderer {
    /// Rend l'état en une frame RGBA8 `W*H*4`.
    fn render(&self, state: &GameState) -> Vec<u8>;
}

/// Returns a deterministic presentation sequence for headless rendering tests.
///
/// The caller supplies the displayed score. The match state represents the local simulation, not
/// the native executable's match engine. No story state is emitted because this function receives
/// no sourced dialogue data.
#[must_use]
pub fn demo_flow(home: u8, away: u8) -> Vec<(GameState, u32)> {
    vec![
        (GameState::Title, 30),
        (GameState::MainMenu { sel: 0 }, 20),
        (GameState::Match { home, away }, 40),
        (GameState::MainMenu { sel: 1 }, 20),
        (GameState::MainMenu { sel: 3 }, 20),
    ]
}

#[cfg(test)]
mod tests {
    use super::{GameState, demo_flow};

    #[test]
    fn demo_flow_never_invents_story_content() {
        let flow = demo_flow(2, 1);

        assert!(
            flow.iter()
                .all(|(state, _)| !matches!(state, GameState::Story { .. })),
            "the data-free demo must not emit unsourced dialogue"
        );
    }

    #[test]
    fn demo_flow_preserves_the_caller_supplied_local_score() {
        let flow = demo_flow(3, 2);
        let scores: Vec<(u8, u8)> = flow
            .iter()
            .filter_map(|(state, _)| match state {
                GameState::Match { home, away } => Some((*home, *away)),
                _ => None,
            })
            .collect();

        assert_eq!(scores, [(3, 2)]);
    }
}
