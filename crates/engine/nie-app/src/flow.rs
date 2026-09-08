//! Interactive FSM for the niers prototype (title screen → menu → local `nie-runtime`
//! simulation → story mode). Moved from `nie-wasm` (Phase 5 deduplication): screen logic lives
//! in `nie-app` and is shared by every front end (wasm today; nie-game/nie-play eventually).
//!
//! `nie_runtime::World` provides a deterministic local simulation. It is not the original game
//! executable, its match engine, or proof that a game mode has been reproduced faithfully.

use crate::render::{host_owned_surface, render_list, render_state};
use crate::{Font, GameState, H, MENU, MODES, W};

/// Public fallback shown until a front end injects sourced dialogue lines.
const STORY_UNAVAILABLE: &str =
    "Dialogue indisponible — aucune donnée réelle n'a été chargée (Échap : retour).";

/// Public fallback shown when an information screen has no injected data.
const CONTENT_UNAVAILABLE: &str =
    "Contenu indisponible — aucune donnée réelle n'a été chargée (Échap : retour).";

/// Current screen of the interactive niers prototype. Its nine tabs are [`MENU`] and its five
/// selectable modes are [`MODES`].
#[derive(Default)]
pub enum Screen {
    /// Écran-titre (PRESS START).
    #[default]
    Title,
    /// Menu principal : les 9 onglets réels ([`MENU`]).
    Menu { sel: usize },
    /// Sélecteur de mode : les 5 modes réels ([`MODES`]), atteint via « Adversaires ».
    ModeSelect { sel: usize },
    /// Local `nie-runtime` match simulation (physics, 22 players, ball, goals).
    Match { world: nie_runtime::World },
    /// Scène de dialogue (mode histoire).
    ///
    /// Empty `repliques` means that no sourced dialogue was injected and renders an explicit
    /// unavailable state. Otherwise the front end supplied the lines (`titre` is the event ID).
    /// As with [`Screen::Liste`], loading the source data requires access outside this FSM.
    Story {
        idx: usize,
        titre: String,
        repliques: Vec<String>,
    },
    /// Onglet/mode pas encore jouable (titre = libellé réel) — données réelles à venir.
    Info { title: String },
    /// Liste de données réelles du jeu (effectif…) : `titre` + lignes déjà résolues.
    ///
    /// Les lignes arrivent **du front**, pas de la FSM : les charger demande le VFS, que le web
    /// n'a pas (il reçoit ses octets autrement). La FSM reste ainsi portable, et un front qui ne
    /// sait pas charger l'effectif garde simplement l'écran d'information.
    Liste {
        titre: String,
        lignes: Vec<String>,
        sel: usize,
    },
}

impl Screen {
    /// Démarre sur l'écran-titre.
    #[must_use]
    pub fn new() -> Self {
        Screen::Title
    }

    /// Traite une commande de menu IEVR RÉELLE (`MENU_CMD_INFO` + `input_ctrl`) :
    /// `CMD_FCS_MTX_{UP,DOWN,LEFT,RIGHT}` (navigation), `CMD_ENTER`/`CMD_SUB_ENTER` (valider),
    /// `CMD_BACK`/`CMD_CANCEL` (retour). Le mapping clavier/souris/manette → commande vit côté front.
    pub fn input(&mut self, cmd: &str) {
        let nav: i32 = match cmd {
            "CMD_FCS_MTX_UP" | "CMD_FCS_MTX_LEFT" | "CMD_FCS_BACK" => -1,
            "CMD_FCS_MTX_DOWN" | "CMD_FCS_MTX_RIGHT" | "CMD_FCS_NEXT" => 1,
            _ => 0,
        };
        let enter = matches!(cmd, "CMD_ENTER" | "CMD_SUB_ENTER");
        let back = matches!(cmd, "CMD_BACK" | "CMD_CANCEL");
        let wrap =
            |sel: usize, n: usize| -> usize { ((sel as i32 + nav).rem_euclid(n as i32)) as usize };

        match self {
            Screen::Title => {
                if enter {
                    *self = Screen::Menu { sel: 0 };
                }
            }
            Screen::Menu { sel } => {
                if nav != 0 {
                    *sel = wrap(*sel, MENU.len());
                } else if enter {
                    let cur = *sel;
                    // Onglet 5 = « Adversaires » → sélection de mode ; autres → écran à venir.
                    if cur == 5 {
                        *self = Screen::ModeSelect { sel: 0 };
                    } else {
                        *self = Screen::Info {
                            title: MENU[cur].into(),
                        };
                    }
                } else if back {
                    *self = Screen::Title;
                }
            }
            Screen::ModeSelect { sel } => {
                if nav != 0 {
                    *sel = wrap(*sel, MODES.len());
                } else if enter {
                    // Mode 0 waits for sourced story data; modes 1-4 start the local simulation.
                    if *sel == 0 {
                        *self = Screen::Story {
                            idx: 0,
                            titre: String::new(),
                            repliques: Vec::new(),
                        };
                    } else {
                        *self = Screen::Match {
                            world: nie_runtime::World::kickoff(),
                        };
                    }
                } else if back {
                    *self = Screen::Menu { sel: 5 };
                }
            }
            Screen::Match { .. } => {
                if back {
                    *self = Screen::ModeSelect { sel: 0 };
                }
            }
            Screen::Story { idx, repliques, .. } => {
                // An unavailable scene is a single status page, not synthetic dialogue.
                let total = repliques.len().max(1);
                if enter {
                    *idx += 1;
                    if *idx >= total {
                        *self = Screen::ModeSelect { sel: 0 };
                    }
                } else if back {
                    *self = Screen::ModeSelect { sel: 0 };
                }
            }
            Screen::Info { .. } => {
                if enter || back {
                    *self = Screen::Menu { sel: 0 };
                }
            }
            Screen::Liste { lignes, sel, .. } => {
                if nav != 0 && !lignes.is_empty() {
                    *sel = wrap(*sel, lignes.len());
                } else if back || enter {
                    *self = Screen::Menu { sel: 0 };
                }
            }
        }
    }

    /// Advances the local simulation by `dt` seconds while its match screen is active.
    pub fn update(&mut self, dt: f32) {
        if let Screen::Match { world } = self {
            world.step(dt);
        }
    }

    /// Sends gameplay input to the local simulation for the next [`Screen::update`].
    ///
    /// Distinct de [`Screen::input`], qui traite des ÉVÉNEMENTS de menu : ici c'est un état
    /// maintenu — une direction dure tant que la touche est tenue. Hors match, l'appel est sans
    /// effet, ce qui évite au front de savoir sur quel écran il se trouve.
    pub fn set_game_input(&mut self, dx: f32, dy: f32, shoot: bool) {
        if let Screen::Match { world } = self {
            world.input = nie_runtime::Input {
                dir: nie_geom::Vec2::new(dx, dy),
                shoot,
            };
        }
    }

    /// Remplace un écran d'information par une **liste de données réelles**.
    ///
    /// Appelée par le front juste après un `input` qui a ouvert un onglet : c'est lui qui sait
    /// charger (VFS), la FSM qui sait naviguer. Sans effet si l'écran courant n'est pas un écran
    /// d'information, ou si la liste est vide — mieux vaut le message « en cours d'intégration »
    /// qu'un écran vide sans explication.
    pub fn fournir_liste(&mut self, lignes: Vec<String>) {
        if let Screen::Info { title } = self
            && !lignes.is_empty()
        {
            *self = Screen::Liste {
                titre: title.clone(),
                lignes,
                sel: 0,
            };
        }
    }

    /// Injects sourced game dialogue into the current story screen.
    ///
    /// The front end loads the source data and the FSM advances through it. An empty injection is
    /// ignored, leaving the explicit unavailable state visible.
    pub fn fournir_dialogue(&mut self, id: String, lignes: Vec<String>) {
        if let Screen::Story {
            idx,
            titre,
            repliques,
        } = self
            && !lignes.is_empty()
        {
            *idx = 0;
            *titre = id;
            *repliques = lignes;
        }
    }

    /// Returns `true` when the story screen still has no sourced dialogue lines.
    #[must_use]
    pub fn attend_dialogue(&self) -> bool {
        matches!(self, Screen::Story { repliques, .. } if repliques.is_empty())
    }

    /// Titre de l'écran d'information courant, pour que le front sache quoi charger.
    #[must_use]
    pub fn info_title(&self) -> Option<&str> {
        match self {
            Screen::Info { title } => Some(title),
            _ => None,
        }
    }

    /// Exposes the current local simulation world for alternate front-end rendering.
    ///
    /// C'est ce qui permet à `nie-game` de proposer la vue 3D (`crate::match3d`) sans que la FSM
    /// dépende du VFS : elle expose l'état, le front choisit sa caméra.
    #[must_use]
    pub fn world(&self) -> Option<&nie_runtime::World> {
        match self {
            Screen::Match { world } => Some(world),
            _ => None,
        }
    }

    /// Index of the player controlled in the local simulation.
    #[must_use]
    pub fn controlled_player(&self) -> Option<usize> {
        match self {
            Screen::Match { world } => world.controlled(),
            _ => None,
        }
    }

    /// Current local simulation score `[home, away]` (zeroes outside its match screen).
    #[must_use]
    pub fn score(&self) -> Vec<u32> {
        match self {
            Screen::Match { world } => vec![world.score[0], world.score[1]],
            _ => vec![0, 0],
        }
    }

    /// Returns `true` while the local simulation match screen is active.
    #[must_use]
    pub fn in_match(&self) -> bool {
        matches!(self, Screen::Match { .. })
    }

    /// Returns `true` when verified pixels must be supplied by the front end.
    ///
    /// `nie-app` deliberately does not synthesize the native main menu. Browser/native hosts can
    /// use this boundary to display the measured reference or the `nie-lua` runtime renderer.
    #[must_use]
    pub fn requires_host_surface(&self) -> bool {
        matches!(self, Screen::Menu { .. })
    }

    /// Rend l'écran courant en framebuffer RGBA8 `W*H*4`.
    #[must_use]
    pub fn render(&self, font: &Font) -> Vec<u8> {
        match self {
            Screen::Title => render_state(&GameState::Title, font, None).buf,
            Screen::Menu { .. } => host_owned_surface(),
            Screen::ModeSelect { sel } => render_list("MODE DE JEU", &MODES, *sel, font).buf,
            Screen::Story {
                idx,
                titre,
                repliques,
            } => render_state(&story_render_state(*idx, titre, repliques), font, None).buf,
            Screen::Match { world } => {
                let terrain = nie_runtime::render::render(world, W as u32, H as u32).px;
                // The local rasterizer has no font, so this layer adds its score and clock.
                crate::render::hud_match(&terrain, font, world.score, world.time)
            }
            Screen::Liste { titre, lignes, sel } => {
                let vues: Vec<&str> = lignes.iter().map(String::as_str).collect();
                // Fenêtre glissante autour de la sélection : un effectif compte des milliers de
                // joueurs, l'écran une dizaine de lignes.
                const VISIBLES: usize = 9;
                let debut = sel
                    .saturating_sub(VISIBLES / 2)
                    .min(vues.len().saturating_sub(VISIBLES));
                let fin = (debut + VISIBLES).min(vues.len());
                render_list(titre, &vues[debut..fin], sel - debut, font).buf
            }
            Screen::Info { title } => {
                let st = GameState::Story {
                    speaker: title.clone(),
                    line: CONTENT_UNAVAILABLE.into(),
                };
                render_state(&st, font, None).buf
            }
        }
    }
}

fn story_render_state(idx: usize, title: &str, lines: &[String]) -> GameState {
    if lines.is_empty() {
        return GameState::Story {
            speaker: MODES[0].into(),
            line: STORY_UNAVAILABLE.into(),
        };
    }

    // Text resources contain lines but not speaker attribution; the event script owns that
    // mapping. Keep the verified event ID and progress instead of inventing a character name.
    let i = idx.min(lines.len() - 1);
    GameState::Story {
        speaker: format!("{title} — {}/{}", i + 1, lines.len()),
        line: lines[i].clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn story_without_injected_lines_reports_unavailable() {
        let state = story_render_state(0, "", &[]);
        let GameState::Story { speaker, line } = state else {
            panic!("story renderer must produce a story state");
        };

        assert_eq!(speaker, MODES[0]);
        assert_eq!(line, STORY_UNAVAILABLE);
    }

    #[test]
    fn unavailable_story_is_one_status_page() {
        let mut screen = Screen::Story {
            idx: 0,
            titre: String::new(),
            repliques: Vec::new(),
        };

        screen.input("CMD_ENTER");

        assert!(matches!(screen, Screen::ModeSelect { sel: 0 }));
    }

    #[test]
    fn story_renderer_uses_only_injected_line_content() {
        let lines = vec!["Sourced line one".to_owned(), "Sourced line two".to_owned()];
        let state = story_render_state(1, "event_001", &lines);
        let GameState::Story { speaker, line } = state else {
            panic!("story renderer must produce a story state");
        };

        assert_eq!(speaker, "event_001 — 2/2");
        assert_eq!(line, lines[1]);
    }

    #[test]
    fn main_menu_is_a_host_owned_transparent_surface() {
        let screen = Screen::Menu { sel: 0 };

        assert!(screen.requires_host_surface());
        let pixels = host_owned_surface();
        assert_eq!(pixels.len(), W * H * 4);
        assert!(pixels.iter().all(|channel| *channel == 0));
    }
}
