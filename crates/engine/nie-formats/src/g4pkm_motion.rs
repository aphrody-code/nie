//! Ancestor-based placement fallback for menu objects.
//!
//! Compatibility port of `G4pkmMotion.cs` placement selection. This module does
//! not sample animation or establish the actual final pose. When placement is
//! off-screen it selects an on-screen ancestor while preserving leaf scale.
//!
//! Real motion keys do exist: loading01 G4MT includes translation, scale, and
//! Euler channels. Faithful playback additionally requires the G4RA resource
//! binding and state transitions, which this fallback does not decode.
//!
//! Compatible with `no_std + alloc`.

extern crate alloc;
use alloc::string::String;

use crate::g4pkm::{G4pkmLayout, Transform2D};

/// Résultat de la résolution de la pose finale du bone de placement d'un objet-menu.
///
/// Port de `G4pkmMotionPose` (`G4pkmMotion.cs:29-48`).
#[derive(Debug, Clone, PartialEq)]
pub struct MotionFinalPose {
    /// Nom du bone retenu (peut être un **ancêtre** si le bone de placement était hors-écran).
    pub bone_name: String,
    /// Transform monde retenu (espace-écran 1920×1080, centre = 0).
    pub pose: Transform2D,
    /// `true` si la bind pose du bone de placement était hors-écran et qu'on a remonté à un ancêtre.
    pub used_ancestor_fallback: bool,
    /// `true` si l'objet a une motion d'ouverture (`AnimationComponent.mot_open_hash != 0`).
    /// **Annotation seulement** — n'influe pas sur la pose (conforme iecode `:79-82`).
    pub has_open_motion: bool,
}

/// Retourne la pose finale du bone de placement de cet objet-menu, avec fallback d'ancêtre
/// si le bone est hors-écran.
///
/// Port strict de `G4pkmMotion.GetMotionFinalPose` (`G4pkmMotion.cs:84-155`).
/// `has_open_motion` ne sert qu'à annoter le résultat (aucune logique différente, `:79-82`).
#[must_use]
pub fn motion_final_pose(layout: &G4pkmLayout, has_open_motion: bool) -> MotionFinalPose {
    if layout.bones.is_empty() {
        return MotionFinalPose {
            bone_name: String::new(),
            pose: Transform2D::ZERO,
            used_ancestor_fallback: false,
            has_open_motion,
        };
    }

    // 1. Bone de placement candidat (base / pos_scl).
    let candidate_idx = find_placement_bone_index(layout);
    let candidate = &layout.bones[candidate_idx];
    let candidate_pose = candidate.world_bind_pose;

    // 2. S'il est dans l'écran → le retourner directement.
    if !candidate_pose.is_off_screen_1920() {
        return MotionFinalPose {
            bone_name: candidate.name.clone(),
            pose: candidate_pose,
            used_ancestor_fallback: false,
            has_open_motion,
        };
    }

    // 3. Hors-écran : remonter la hiérarchie jusqu'au 1er ancêtre visible, en conservant la
    //    scale/rotation du bone feuille (candidat).
    if let Some((parent_index, pose)) = on_screen_ancestor_pose(layout, candidate_idx) {
        return MotionFinalPose {
            bone_name: layout.bones[parent_index].name.clone(),
            pose,
            used_ancestor_fallback: true,
            has_open_motion,
        };
    }

    // 4. Tous les ancêtres hors-écran (rarissime) → bind pose telle quelle.
    MotionFinalPose {
        bone_name: candidate.name.clone(),
        pose: candidate_pose,
        used_ancestor_fallback: false,
        has_open_motion,
    }
}

/// Le premier ancêtre VISIBLE de `bone_index`, avec sa position et l'échelle de la feuille.
///
/// Rend `None` quand l'os est déjà à l'écran ou qu'aucun ancêtre ne l'est.
///
/// Un menu range ce qu'il n'affiche pas encore hors du cadre : mesuré le 2026-09-13 sur
/// `vroad01_71_vroad_tournament_notice`, la chaîne `_pos_base01` → `_pos_slide01` →
/// `_pos_offset01` ajoute **exactement une largeur d'écran (1920) à chaque cran**, si bien que ses
/// plaques reposent à x = 7 054 dans un espace qui s'arrête à 960. Ce sont les états d'une
/// animation d'ouverture ; la pose de repos qu'un rendu statique peut connaître est celle de
/// l'ancêtre resté visible. C'est la règle que `GetMotionFinalPose` applique déjà pour l'objet ;
/// elle est ici extraite pour qu'un appelant l'applique aussi os par os.
#[must_use]
pub fn on_screen_ancestor_pose(
    layout: &G4pkmLayout,
    bone_index: usize,
) -> Option<(usize, Transform2D)> {
    let leaf = layout.bones.get(bone_index)?.world_bind_pose;
    if !leaf.is_off_screen_1920() {
        return None;
    }
    let mut current = bone_index;
    loop {
        let parent_index = layout.bones[current].parent_index;
        if parent_index < 0 || (parent_index as usize) >= layout.bones.len() {
            return None;
        }
        let parent_index = parent_index as usize;
        let parent_pose = layout.bones[parent_index].world_bind_pose;
        if !parent_pose.is_off_screen_1920() {
            return Some((
                parent_index,
                Transform2D {
                    x: parent_pose.x,
                    y: parent_pose.y,
                    // L'échelle et la rotation restent celles de la FEUILLE : c'est elle qui
                    // désigne ce qui est dessiné, l'ancêtre ne fait que donner un point d'ancrage.
                    scale_x: leaf.scale_x,
                    scale_y: leaf.scale_y,
                    rot: leaf.rot,
                    anchor_x: parent_pose.anchor_x,
                    anchor_y: parent_pose.anchor_y,
                },
            ));
        }
        current = parent_index;
    }
}

/// Trouve l'index du bone de placement : dernier bone dont le nom contient `pos_scl` (le plus
/// profond), sinon premier bone dont le nom contient `base`, sinon bone 0.
///
/// Port de `FindPlacementBoneIndex` (`G4pkmMotion.cs:172-192`), comparaison **insensible à la
/// casse** (`OrdinalIgnoreCase`). Pré-condition : `layout.bones` non vide.
#[must_use]
pub fn find_placement_bone_index(layout: &G4pkmLayout) -> usize {
    // Passe 1 : bones "pos_scl" — garder le dernier (le plus profond).
    let mut best_pos_scl: Option<usize> = None;
    for (i, b) in layout.bones.iter().enumerate() {
        if contains_ic(&b.name, "pos_scl") {
            best_pos_scl = Some(i);
        }
    }
    if let Some(i) = best_pos_scl {
        return i;
    }

    // Passe 2 : premier bone "base" (port 1:1 iecode `FindPlacementBoneIndex`).
    //
    // NB (raffinement « préférer le 1ᵉʳ base NON-trivial » TENTÉ + MESURÉ 2026-06-16, ÉCARTÉ) :
    // sauter un `_pos_base01` trivial (origine, scale 1) au profit du 1ᵉʳ base non-trivial (ex.
    // `_header_base01` plein-largeur) place mieux l'en-tête/onglets de `main_menu` (**SSIM 0,418 →
    // 0,446**) MAIS régresse `title02` (**0,251 → 0,245** : certains objbins title02 se replacent
    // hors de leur centre correct). Le raffinement n'est donc PAS universel — il appartient à la
    // **placement spécifique au driver** (D1.c-driver), pas à l'heuristique partagée iecode. On
    // préserve la fidélité title02 (discipline anti-régression « relever le plancher, jamais le baisser »).
    for (i, b) in layout.bones.iter().enumerate() {
        if contains_ic(&b.name, "base") {
            return i;
        }
    }

    0
}

/// `haystack.contains(needle)` insensible à la casse ASCII (équivalent `StringComparison.OrdinalIgnoreCase`
/// pour les noms de bone, tous ASCII). Sans allocation.
fn contains_ic(haystack: &str, needle: &str) -> bool {
    let (h, n) = (haystack.as_bytes(), needle.as_bytes());
    if n.is_empty() {
        return true;
    }
    if n.len() > h.len() {
        return false;
    }
    h.windows(n.len())
        .any(|w| w.iter().zip(n).all(|(a, b)| a.eq_ignore_ascii_case(b)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::g4pkm::{G4pkmBone, G4pkmLayout};
    use alloc::collections::BTreeMap;
    use alloc::string::String;
    use alloc::vec;
    use alloc::vec::Vec;

    fn bone(index: usize, name: &str, parent: i32, world: Transform2D) -> G4pkmBone {
        G4pkmBone {
            index,
            name: String::from(name),
            parent_index: parent,
            local_bind_pose: world,
            world_bind_pose: world,
        }
    }

    fn layout(bones: Vec<G4pkmBone>) -> G4pkmLayout {
        G4pkmLayout {
            bones,
            world_pose_by_name: BTreeMap::new(),
        }
    }

    fn tf(x: f32, y: f32, sx: f32, sy: f32) -> Transform2D {
        Transform2D {
            x,
            y,
            scale_x: sx,
            scale_y: sy,
            rot: 0.0,
            anchor_x: 0.5,
            anchor_y: 0.5,
        }
    }

    /// Layout vide → pose zéro, bone vide, annotation propagée.
    #[test]
    fn empty_layout_zero_pose() {
        let l = layout(vec![]);
        let mp = motion_final_pose(&l, true);
        assert_eq!(mp.bone_name, "");
        assert_eq!(mp.pose, Transform2D::ZERO);
        assert!(!mp.used_ancestor_fallback);
        assert!(mp.has_open_motion);
    }

    /// `FindPlacementBoneIndex` : `pos_scl` prioritaire, le plus profond.
    #[test]
    fn placement_prefers_deepest_pos_scl() {
        let l = layout(vec![
            bone(0, "_pos_base01", -1, tf(0.0, 0.0, 1.0, 1.0)),
            bone(1, "_pos_scl_base01", 0, tf(100.0, 0.0, 2.0, 2.0)),
            bone(2, "_pos_scl_base02", 1, tf(200.0, 0.0, 3.0, 3.0)),
            bone(3, "_cursor01", 2, tf(0.0, 0.0, 1.0, 1.0)),
        ]);
        assert_eq!(find_placement_bone_index(&l), 2, "dernier pos_scl");
    }

    /// `FindPlacementBoneIndex` : sinon premier `base`, sinon bone 0.
    #[test]
    fn placement_base_then_zero() {
        let l = layout(vec![
            bone(0, "_root", -1, tf(0.0, 0.0, 1.0, 1.0)),
            bone(1, "_my_base01", 0, tf(10.0, 0.0, 1.0, 1.0)),
        ]);
        assert_eq!(find_placement_bone_index(&l), 1, "premier base");

        let l2 = layout(vec![
            bone(0, "_cursor01", -1, tf(0.0, 0.0, 1.0, 1.0)),
            bone(1, "_gtxt01", 0, tf(10.0, 0.0, 1.0, 1.0)),
        ]);
        assert_eq!(find_placement_bone_index(&l2), 0, "fallback bone 0");
    }

    /// Bone de placement EN écran → retourné tel quel, pas de fallback.
    #[test]
    fn on_screen_placement_returned_directly() {
        let l = layout(vec![bone(
            0,
            "_pos_scl_base01",
            -1,
            tf(100.0, 50.0, 0.65, 0.9),
        )]);
        let mp = motion_final_pose(&l, false);
        assert_eq!(mp.bone_name, "_pos_scl_base01");
        assert!(!mp.used_ancestor_fallback);
        assert!((mp.pose.x - 100.0).abs() < 1e-4);
    }

    /// Cas central (port de `OffScreenBaseWithOnScreenParent`, `G4pkmMotionTests.cs:195-237`) :
    /// parent `_pos_base01` à l'origine (on-écran) + enfant `_pos_scl_base01` hors-écran
    /// (tx=1873, sx=0.65, sy=0.9) → résultat = position du parent, **scale du candidat conservée**,
    /// fallback marqué, et la pose résultante est dans l'écran.
    #[test]
    fn off_screen_base_falls_back_to_on_screen_parent() {
        let l = layout(vec![
            bone(0, "_pos_base01", -1, tf(0.0, 0.0, 1.0, 1.0)),
            bone(1, "_pos_scl_base01", 0, tf(1873.0, -39.0, 0.65, 0.9)),
        ]);
        let mp = motion_final_pose(&l, true);
        assert_eq!(mp.bone_name, "_pos_base01", "remonte au parent on-écran");
        assert!(mp.used_ancestor_fallback);
        assert!(mp.has_open_motion);
        assert!((mp.pose.x - 0.0).abs() < 1e-4, "x du parent");
        assert!((mp.pose.y - 0.0).abs() < 1e-4, "y du parent");
        assert!(
            (mp.pose.scale_x - 0.65).abs() < 1e-4,
            "scale du candidat conservée"
        );
        assert!((mp.pose.scale_y - 0.9).abs() < 1e-4);
        assert!(!mp.pose.is_off_screen_1920(), "pose finale dans l'écran");
    }

    /// Tous les ancêtres hors-écran → bind pose du candidat telle quelle, pas de fallback.
    #[test]
    fn all_ancestors_off_screen_returns_bind_pose() {
        let l = layout(vec![
            bone(0, "_pos_base01", -1, tf(2000.0, 0.0, 1.0, 1.0)),
            bone(1, "_pos_scl_base01", 0, tf(1873.0, -39.0, 0.65, 0.9)),
        ]);
        let mp = motion_final_pose(&l, false);
        assert_eq!(mp.bone_name, "_pos_scl_base01");
        assert!(!mp.used_ancestor_fallback);
        assert!((mp.pose.x - 1873.0).abs() < 1e-4);
    }

    #[test]
    fn contains_ic_basic() {
        assert!(contains_ic("_POS_SCL_base01", "pos_scl"));
        assert!(contains_ic("_my_BASE01", "base"));
        assert!(!contains_ic("_cursor01", "base"));
        assert!(contains_ic("anything", ""));
        assert!(!contains_ic("ab", "abc"));
    }

    /// Golden VFS : le fallback d'ancêtre sur les **vrais** paquets menu.
    ///
    /// `G4pkmMotionTests.cs` faisait ces mesures depuis `/tmp/g4pkm-extract`, un dossier qui
    /// n'existe pas ici : ses assertions ne s'exécutaient jamais sous Windows.
    #[test]
    fn golden_motion_sur_les_paquets_menu_reels() {
        // `title00_09` : le bone de placement est hors écran (x=1873) ⇒ on remonte à un ancêtre.
        if let Some((chemin, data)) = crate::g4pk::tests_vfs::lire_par_suffixe("title00_09.g4pkm") {
            let layout = crate::g4pkm::parse(&data).expect("parse title00_09.g4pkm");
            let mp = motion_final_pose(&layout, true);
            std::eprintln!(
                "{chemin} : bone={} fallback={} x={} y={}",
                mp.bone_name,
                mp.used_ancestor_fallback,
                mp.pose.x,
                mp.pose.y
            );
            assert!(
                mp.used_ancestor_fallback,
                "title00_09 : placement hors écran ⇒ fallback"
            );
            assert!(
                !mp.pose.is_off_screen_1920(),
                "la pose finale doit être dans l'écran"
            );
            assert!(
                (-960.0..=960.0).contains(&mp.pose.x),
                "x hors canvas : {}",
                mp.pose.x
            );
            assert!(
                (-540.0..=540.0).contains(&mp.pose.y),
                "y hors canvas : {}",
                mp.pose.y
            );
            let (px, py) = mp.pose.to_css_1280x720();
            assert!((0.0..=1280.0).contains(&px), "px hors [0,1280] : {px}");
            assert!((0.0..=720.0).contains(&py), "py hors [0,720] : {py}");
        }

        // `title00_01` : son bone de placement est déjà dans l'écran ⇒ aucun fallback.
        if let Some((chemin, data)) = crate::g4pk::tests_vfs::lire_par_suffixe("title00_01.g4pkm") {
            let layout = crate::g4pkm::parse(&data).expect("parse title00_01.g4pkm");
            let mp = motion_final_pose(&layout, false);
            std::eprintln!(
                "{chemin} : bone={} fallback={}",
                mp.bone_name,
                mp.used_ancestor_fallback
            );
            assert!(
                !mp.used_ancestor_fallback,
                "title00_01 : placement en écran ⇒ pas de fallback"
            );
            assert!(
                contains_ic(&mp.bone_name, "base") || contains_ic(&mp.bone_name, "pos_scl"),
                "bone de placement inattendu : {}",
                mp.bone_name
            );
        }

        // `option01_02` : 66 bones — mesure de volume, elle attrape une régression de parsing.
        if let Some((chemin, data)) = crate::g4pk::tests_vfs::lire_par_suffixe("option01_02.g4pkm")
        {
            let layout = crate::g4pkm::parse(&data).expect("parse option01_02.g4pkm");
            std::eprintln!("{chemin} : {} bones", layout.bone_count());
            assert_eq!(
                layout.bone_count(),
                66,
                "option01_02 : bone_count attendu 66"
            );
        }
    }
}
