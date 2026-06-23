//! Résolution d'un tir au but — **convergence des physiques byte-fidèles validées** vers le match
//! jouable (objectif `CLAUDE.md` : réimplémentation jouable).
//!
//! Compose : la trajectoire du ballon ([`crate::ball::BallMover::trajectory`], physique byte-exact
//! des contrôleurs validés vs binaire) + la décision d'arrêt du gardien évaluée **par-frame**
//! ([`crate::keeper::KeeperSaveComponent::intercept_frame`], géométrie byte-exact). L'orchestration
//! par-frame est fidèle au binaire (le composant keeper s'exécute chaque frame) ; le verdict
//! géométrique et la trajectoire sont byte-exact.

use crate::ball::BallMover;
use crate::keeper::KeeperSaveComponent;
use crate::Vec3;

/// Issue d'un tir face au gardien.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum ShotOutcome {
    /// Le gardien arrête le tir à la frame indiquée.
    Saved(usize),
    /// Le ballon franchit le gardien (tir géométriquement non arrêté sur l'échantillon).
    BeatsKeeper,
}

/// Résout un tir : échantillonne la trajectoire du ballon (`mover` depuis `start`, `frames` pas de
/// `dt`) puis détermine si le gardien (à `keeper`, paramètres `kpr`, échelle monde `scale`)
/// l'intercepte. Renvoie [`ShotOutcome::Saved`] (frame d'arrêt) ou [`ShotOutcome::BeatsKeeper`].
#[must_use]
pub fn resolve_shot(
    mut mover: BallMover,
    start: Vec3,
    dt: f32,
    frames: usize,
    kpr: &KeeperSaveComponent,
    keeper: Vec3,
    scale: f32,
) -> ShotOutcome {
    let traj = mover.trajectory(start, dt, frames);
    match kpr.intercept_frame(&traj, keeper, scale) {
        Some(f) => ShotOutcome::Saved(f),
        None => ShotOutcome::BeatsKeeper,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ball::ParabolaMove;

    #[test]
    fn shot_saved_when_trajectory_enters_reach() {
        // Tir parabolique passant près du gardien à l'origine → arrêté ; reach_sq = 0.8 (keeper défaut).
        let kpr = KeeperSaveComponent::new();
        let mover = BallMover::Parabola(ParabolaMove {
            accel: Vec3 { x: 0.0, y: 0.0, z: 0.0 },
            velocity: Vec3 { x: -1.0, y: 0.0, z: 0.0 }, // avance vers x=0
            t: 0.0,
            t_max: 100.0,
        });
        // départ à (3,0,0), vers l'origine : à un moment dx²<0.8.
        let out = resolve_shot(mover, Vec3 { x: 3.0, y: 0.0, z: 0.0 }, 0.5, 10, &kpr, Vec3::zero(), 1.0);
        assert!(matches!(out, ShotOutcome::Saved(_)));
    }

    #[test]
    fn shot_beats_keeper_when_off_target() {
        let kpr = KeeperSaveComponent::new();
        let mover = BallMover::Parabola(ParabolaMove {
            accel: Vec3 { x: 0.0, y: 0.0, z: 0.0 },
            velocity: Vec3 { x: 0.0, y: 0.0, z: 1.0 }, // s'éloigne en z, loin du gardien
            t: 0.0,
            t_max: 100.0,
        });
        let out = resolve_shot(mover, Vec3 { x: 5.0, y: 0.0, z: 0.0 }, 0.5, 10, &kpr, Vec3::zero(), 1.0);
        assert_eq!(out, ShotOutcome::BeatsKeeper);
    }
}
