//! **nie-app** — le CŒUR du jeu *Inazuma Eleven: Victory Road* réimplémenté (niers).
//!
//! Possède la **machine à états** du jeu ([`GameState`]) et le **rendu abstrait** (trait
//! [`Renderer`]), extraits du binaire `nie-play` pour être réutilisables. Deux front-ends s'y
//! branchent : `nie-play` (headless/golden, Renderer CPU → PNG/MP4) et `nie-game` (interactif,
//! Renderer wgpu → 60 fps). C'est la fondation de l'unification (cf. `docs/UNIFICATION.md`, Phase 0).
//!
//! La logique (match `nie-core`), les données (`nie-data`), les menus (`nie-lua`) se branchent ici
//! au fil des phases ; pour l'instant le cœur tient la FSM + l'orchestration du rendu.

pub mod character;
pub mod render;
pub mod roster;

pub use render::{CpuRenderer, Font, Screen, H, W};

/// État du jeu — la machine à états centrale, partagée par tous les front-ends.
///
/// S'étendra (TeamSelect, KizunaTown, AvatarEdit, …) au fil de l'unification.
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

/// Options du menu principal (placeholder ; remplacé à terme par les vrais layouts Lua, Phase 3).
pub const MENU: [&str; 4] = ["MATCH", "STORY MODE", "MY TEAM", "KIZUNA TOWN"];

/// Abstraction de rendu : un front-end fournit un `Renderer` qui transforme un état en frame RGBA
/// (1280×720, 4 octets/px). CPU (`CpuRenderer`) aujourd'hui, wgpu demain (nie-game, Phase 4).
pub trait Renderer {
    /// Rend l'état en une frame RGBA8 `W*H*4`.
    fn render(&self, state: &GameState) -> Vec<u8>;
}

/// Le playthrough scripté (mode headless/golden) : suite de `(état, nombre de frames)`.
///
/// Le score vient d'un match réel (`nie_core::simulate_match`) côté front-end ; le flux reste ici
/// pour qu'il soit partagé et déterministe (gate de non-régression PNG/MP4).
#[must_use]
pub fn demo_flow(home: u8, away: u8) -> Vec<(GameState, u32)> {
    vec![
        (GameState::Title, 30),
        (GameState::MainMenu { sel: 0 }, 20),
        (GameState::Match { home, away }, 40),
        (GameState::MainMenu { sel: 1 }, 20),
        (
            GameState::Story {
                speaker: String::from("Endou Mamoru"),
                line: String::from("Can anyone bring down Raimon's unshakable fortress?!"),
            },
            40,
        ),
        (GameState::MainMenu { sel: 3 }, 20),
    ]
}
