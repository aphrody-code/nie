//! Machine à états complète du match (11 états) + formule de score final.
//!
//! Porte la vraie FSM à 11 états de `CSceneSoccer` (`FUN_1412aa4a0`) sous forme
//! d'une fonction de transition [`tick`] reproduisant fidèlement le `switch`
//! décompilé : fallthrough `case 0 -> 1` et `case 6 -> 7`, transitions
//! immédiates des cases 5/10, lecture du score à la case 7.
//!
//! Complète [`crate::match_state`] (qui modélise le sous-cas entraînement) avec
//! la vue « enum d'état + tick » demandée.
//!
//! # Source de vérité
//!
//! - C décompilé : `refs/iecode-re/research/ghidra-export/decompiled/soccer_match_state_machine.c`
//!   (`FUN_1412aa4a0`, switch L79-316). États 0-10 documentés L11-16.
//!   Score final L282-288 : `uVar4 (minutes @+0x1e080) * 10000 + uVar3
//!   (secondes @+0x1e082)`. Flag entraînement L153 :
//!   `(*(byte*)(…+0x6a30)+0x14) & 4`. Fallthrough case 0→1 (pas de break L84),
//!   case 6→7 (L263), case 7 lit le score.

/// Les 11 états du match (`*(byte *)(param_1 + 0x20)`).
///
/// Source : labels du switch `FUN_1412aa4a0` (L79-316) et strings embarquées.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[repr(u8)]
pub enum MatchState {
    /// 0 — Init : pose le flag bit 1, démarre le timer de reset, tombe en 1.
    #[default]
    Init = 0,
    /// 1 — `WaitTimer` : attente fin timer + reset anims joueurs, branche 5 ou 2.
    WaitTimer = 1,
    /// 2 — `ResultUi` : attente fin de l'UI de résultat.
    ResultUi = 2,
    /// 3 — `CheckTelop` : vérification du telop d'échec.
    CheckTelop = 3,
    /// 4 — `WaitAnim` : attente fin d'animation de résultat.
    WaitAnim = 4,
    /// 5 — `Transition` : fade standard (normal) ou logique restart/complétion.
    Transition = 5,
    /// 6 — `Fade` : attente fin de fade, tombe en 7.
    Fade = 6,
    /// 7 — `Cleanup` : lit le score (`min*10000+sec`), passe en 8.
    Cleanup = 7,
    /// 8 — `PostMatch` : UI de résultat final.
    PostMatch = 8,
    /// 9 — `FadeOut` : attente fade out final.
    FadeOut = 9,
    /// 10 — `LoadNext` : chargement de la scène suivante (transition immédiate).
    LoadNext = 10,
}

impl TryFrom<u8> for MatchState {
    type Error = ();

    fn try_from(v: u8) -> Result<Self, ()> {
        Ok(match v {
            0 => Self::Init,
            1 => Self::WaitTimer,
            2 => Self::ResultUi,
            3 => Self::CheckTelop,
            4 => Self::WaitAnim,
            5 => Self::Transition,
            6 => Self::Fade,
            7 => Self::Cleanup,
            8 => Self::PostMatch,
            9 => Self::FadeOut,
            10 => Self::LoadNext,
            _ => return Err(()),
        })
    }
}

/// Résultat d'un `tick` : l'état suivant et si c'est une transition immédiate.
///
/// La FSM décompilée `return 1` (transition immédiate vers la scène suivante)
/// dans les cases 5 (complétion) et 10 (chargement), et `return 0` (continuer
/// la boucle) sinon.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Tick {
    /// État suivant écrit dans `param_1 + 0x20`.
    pub next: MatchState,
    /// `true` si la FSM `return 1` (transition immédiate vers scène suivante).
    pub immediate: bool,
}

/// Contexte minimal pour résoudre les branchements conditionnels du `switch`.
///
/// Reproduit les seules entrées externes qui orientent les transitions
/// déterministes (le reste — timers, fades — est supposé « terminé » pour
/// modéliser l'avancement nominal de la FSM).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct MatchContext {
    /// Flag entraînement spécial : `(*(byte*)(…+0x6a30)+0x14) & 4` (L153/L235).
    /// `false` = match normal.
    pub is_training: bool,
    /// Compteur de fin `*(int *)(param_1 + 0x24)` (case 5, `iVar18`).
    /// 0 ou 1 = restart/retry (→ Fade), 2 = complétion (transition immédiate).
    pub end_counter: i32,
}

/// Transition nominale de la FSM depuis `state`, avec le contexte.
///
/// Reproduit fidèlement les transitions du `switch` décompilé en supposant les
/// gardes temporelles satisfaites (timer/fade terminés) — c'est l'avancement
/// nominal d'un tick à l'autre.
///
/// - `Init` → `WaitTimer` (fallthrough case 0→1, L84).
/// - `WaitTimer` → `Transition` si match normal (`uVar6 = 5`, L154), sinon
///   `ResultUi` (entraînement, `uVar6 = 2`, L198).
/// - `ResultUi` → `WaitAnim` (case 2 → 4, L210).
/// - `CheckTelop` → `ResultUi` (case 3 → 2, L220).
/// - `WaitAnim` → `Transition` (case 4 → 5, L230).
/// - `Transition` : match normal → `Fade` (L238) ; entraînement avec
///   `end_counter ∈ {0,1}` → `Fade` (L245) ; `end_counter == 2` → `LoadNext`
///   en transition immédiate (L247-253, `return 1`).
/// - `Fade` → `Cleanup` (fallthrough case 6→7, L263).
/// - `Cleanup` → `PostMatch` (case 7 → 8, L289) ; le score se lit ici.
/// - `PostMatch` → `FadeOut` (avance nominal vers le fade out final).
/// - `FadeOut` → `LoadNext` (case 9 → 10, L301).
/// - `LoadNext` → `LoadNext`, transition immédiate (`return 1`, L315).
#[must_use]
pub fn tick(state: MatchState, ctx: MatchContext) -> Tick {
    use MatchState as S;
    match state {
        // Fallthrough case 0 → 1 (pas de break L84).
        S::Init => Tick {
            next: S::WaitTimer,
            immediate: false,
        },
        // Branche match normal (5) vs entraînement (2) selon le flag 0x4.
        S::WaitTimer => Tick {
            next: if ctx.is_training {
                S::ResultUi
            } else {
                S::Transition
            },
            immediate: false,
        },
        S::ResultUi => Tick {
            next: S::WaitAnim,
            immediate: false,
        },
        S::CheckTelop => Tick {
            next: S::ResultUi,
            immediate: false,
        },
        S::WaitAnim => Tick {
            next: S::Transition,
            immediate: false,
        },
        S::Transition => {
            if !ctx.is_training {
                // Match normal : fade standard → état 6.
                Tick {
                    next: S::Fade,
                    immediate: false,
                }
            } else if ctx.end_counter == 2 {
                // Complétion : charge le résultat final, transition immédiate.
                Tick {
                    next: S::LoadNext,
                    immediate: true,
                }
            } else {
                // end_counter 0 ou 1 : restart/retry → fade.
                Tick {
                    next: S::Fade,
                    immediate: false,
                }
            }
        }
        // Fallthrough case 6 → 7 (L263).
        S::Fade => Tick {
            next: S::Cleanup,
            immediate: false,
        },
        // Case 7 : lit le score puis passe en 8.
        S::Cleanup => Tick {
            next: S::PostMatch,
            immediate: false,
        },
        S::PostMatch => Tick {
            next: S::FadeOut,
            immediate: false,
        },
        S::FadeOut => Tick {
            next: S::LoadNext,
            immediate: false,
        },
        // Case 10 : return 1 (transition immédiate vers scène suivante).
        S::LoadNext => Tick {
            next: S::LoadNext,
            immediate: true,
        },
    }
}

/// Score final encodé : `minutes * 10000 + secondes`.
///
/// Source : `FUN_1412aa4a0` case 7 (L282-288) —
/// `(uint)uVar4 * 10000 + (uint)uVar3`, avec `uVar4` = minutes (`@+0x1e080`)
/// et `uVar3` = secondes (`@+0x1e082`).
#[must_use]
pub fn final_score(minutes: u16, seconds: u16) -> u32 {
    u32::from(minutes) * 10_000 + u32::from(seconds)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_roundtrip() {
        for i in 0u8..=10 {
            let s = MatchState::try_from(i).expect("état valide");
            assert_eq!(s as u8, i);
        }
        assert!(MatchState::try_from(11).is_err());
    }

    /// Golden : score(2 min, 30 s) = 20030.
    #[test]
    fn golden_score_2m30s() {
        assert_eq!(final_score(2, 30), 20030);
    }

    #[test]
    fn score_edge_cases() {
        assert_eq!(final_score(0, 0), 0);
        assert_eq!(final_score(1, 30), 10030);
        assert_eq!(final_score(0, 45), 45);
    }

    /// Golden : depuis Init, la FSM traverse 0→1 puis branche 5 (normal).
    #[test]
    fn golden_sequence_normal_match() {
        let normal = MatchContext {
            is_training: false,
            end_counter: 0,
        };
        // Init → WaitTimer (fallthrough 0→1).
        assert_eq!(tick(MatchState::Init, normal).next, MatchState::WaitTimer);
        // WaitTimer → Transition (5) en match normal.
        assert_eq!(
            tick(MatchState::WaitTimer, normal).next,
            MatchState::Transition
        );
        // Transition → Fade (6) en match normal.
        let t = tick(MatchState::Transition, normal);
        assert_eq!(t.next, MatchState::Fade);
        assert!(!t.immediate);
        // Fade → Cleanup (fallthrough 6→7).
        assert_eq!(tick(MatchState::Fade, normal).next, MatchState::Cleanup);
        // Cleanup → PostMatch (7→8).
        assert_eq!(
            tick(MatchState::Cleanup, normal).next,
            MatchState::PostMatch
        );
    }

    /// Golden : entraînement → WaitTimer branche 2 (ResultUi).
    #[test]
    fn golden_sequence_training_branches_to_2() {
        let training = MatchContext {
            is_training: true,
            end_counter: 0,
        };
        assert_eq!(tick(MatchState::Init, training).next, MatchState::WaitTimer);
        // WaitTimer → ResultUi (2) en entraînement.
        assert_eq!(
            tick(MatchState::WaitTimer, training).next,
            MatchState::ResultUi
        );
    }

    /// Case 5 entraînement avec end_counter==2 → transition immédiate vers LoadNext.
    #[test]
    fn training_completion_immediate_transition() {
        let complete = MatchContext {
            is_training: true,
            end_counter: 2,
        };
        let t = tick(MatchState::Transition, complete);
        assert_eq!(t.next, MatchState::LoadNext);
        assert!(t.immediate, "complétion = return 1 (transition immédiate)");
    }

    /// Case 5 entraînement avec end_counter 0/1 → Fade (pas immédiat).
    #[test]
    fn training_restart_goes_to_fade() {
        for ec in [0, 1] {
            let ctx = MatchContext {
                is_training: true,
                end_counter: ec,
            };
            let t = tick(MatchState::Transition, ctx);
            assert_eq!(t.next, MatchState::Fade);
            assert!(!t.immediate);
        }
    }

    /// Case 10 (LoadNext) = transition immédiate (return 1).
    #[test]
    fn load_next_is_immediate() {
        let t = tick(MatchState::LoadNext, MatchContext::default());
        assert!(t.immediate);
        assert_eq!(t.next, MatchState::LoadNext);
    }
}
