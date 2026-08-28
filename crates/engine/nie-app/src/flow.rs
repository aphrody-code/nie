//! FSM **interactive** du jeu jouable (écran-titre → menu → **vrai match** [moteur `nie-runtime`] →
//! mode histoire). Relocalisée depuis `nie-wasm` (dédup Phase 5) : la logique d'écran vit dans le
//! cœur `nie-app`, partageable par tous les fronts (wasm = navigateur ; à terme nie-game/nie-play).
//!
//! Move **verbatim** : comportement identique à l'ancienne FSM de `WasmGame` (qui ne fait plus que
//! déléguer + mapper clavier→commande). Le match embarque le vrai moteur `nie_runtime::World`.

use crate::render::{render_list, render_state};
use crate::{Font, GameState, H, MENU, MODES, W};

/// Quelques répliques du mode histoire (placeholder localisé — les vrais dialogues SQLite suivront).
const STORY: &[(&str, &str)] = &[
    ("Endou Mamoru", "Can anyone bring down Raimon's unshakable fortress?!"),
    ("Gouenji Shuuya", "Let's settle this on the pitch."),
    ("Kidou Yuuto", "A perfect strategy demands a perfect execution."),
];

/// Écran courant du JEU (machine à états interactive). Les 9 onglets = [`MENU`], les 5 modes = [`MODES`].
#[derive(Default)]
pub enum Screen {
    /// Écran-titre (PRESS START).
    #[default]
    Title,
    /// Menu principal : les 9 onglets réels ([`MENU`]).
    Menu { sel: usize },
    /// Sélecteur de mode : les 5 modes réels ([`MODES`]), atteint via « Adversaires ».
    ModeSelect { sel: usize },
    /// Match en cours : le **vrai moteur** `nie-runtime` (physique, 22 joueurs, ballon, buts).
    Match { world: nie_runtime::World },
    /// Scène de dialogue (mode histoire).
    Story { idx: usize },
    /// Onglet/mode pas encore jouable (titre = libellé réel) — données réelles à venir.
    Info { title: String },
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
        let wrap = |sel: usize, n: usize| -> usize { ((sel as i32 + nav).rem_euclid(n as i32)) as usize };

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
                        *self = Screen::Info { title: MENU[cur].into() };
                    }
                } else if back {
                    *self = Screen::Title;
                }
            }
            Screen::ModeSelect { sel } => {
                if nav != 0 {
                    *sel = wrap(*sel, MODES.len());
                } else if enter {
                    // 0 = Mode Histoire → dialogues ; 1-4 → vrai match (moteur nie-runtime).
                    if *sel == 0 {
                        *self = Screen::Story { idx: 0 };
                    } else {
                        *self = Screen::Match { world: nie_runtime::World::kickoff() };
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
            Screen::Story { idx } => {
                if enter {
                    *idx += 1;
                    if *idx >= STORY.len() {
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
        }
    }

    /// Avance le temps de `dt` secondes : la physique du match tourne quand un match est en cours.
    pub fn update(&mut self, dt: f32) {
        if let Screen::Match { world } = self {
            world.step(dt);
        }
    }

    /// Transmet au match l'état des commandes de jeu, pour le prochain [`Screen::update`].
    ///
    /// Distinct de [`Screen::input`], qui traite des ÉVÉNEMENTS de menu : ici c'est un état
    /// maintenu — une direction dure tant que la touche est tenue. Hors match, l'appel est sans
    /// effet, ce qui évite au front de savoir sur quel écran il se trouve.
    pub fn set_game_input(&mut self, dx: f32, dy: f32, shoot: bool) {
        if let Screen::Match { world } = self {
            world.input = nie_runtime::Input { dir: nie_geom::Vec2::new(dx, dy), shoot };
        }
    }

    /// Index du joueur que la joueuse contrôle, pour que l'interface puisse le désigner.
    #[must_use]
    pub fn controlled_player(&self) -> Option<usize> {
        match self {
            Screen::Match { world } => world.controlled(),
            _ => None,
        }
    }

    /// Score du match en cours `[domicile, extérieur]` (zéros hors match).
    #[must_use]
    pub fn score(&self) -> Vec<u32> {
        match self {
            Screen::Match { world } => vec![world.score[0], world.score[1]],
            _ => vec![0, 0],
        }
    }

    /// `true` si un match est en cours (pour l'overlay de score côté UI).
    #[must_use]
    pub fn in_match(&self) -> bool {
        matches!(self, Screen::Match { .. })
    }

    /// Rend l'écran courant en framebuffer RGBA8 `W*H*4`.
    #[must_use]
    pub fn render(&self, font: &Font) -> Vec<u8> {
        match self {
            Screen::Title => render_state(&GameState::Title, font, None).buf,
            Screen::Menu { sel } => render_list("MENU PRINCIPAL", &MENU, *sel, font).buf,
            Screen::ModeSelect { sel } => render_list("MODE DE JEU", &MODES, *sel, font).buf,
            Screen::Story { idx } => {
                let (sp, ln) = STORY[(*idx).min(STORY.len() - 1)];
                let st = GameState::Story { speaker: sp.into(), line: ln.into() };
                render_state(&st, font, None).buf
            }
            Screen::Match { world } => nie_runtime::render::render(world, W as u32, H as u32).px,
            Screen::Info { title } => {
                let st = GameState::Story {
                    speaker: title.clone(),
                    line: "Mode en cours d'intégration — données réelles disponibles (Échap : retour).".into(),
                };
                render_state(&st, font, None).buf
            }
        }
    }
}
