//! Composant ballon de IEVR.
//!
//! Porte les classes C++ `game::BallComponent` et `game::BallMoveNormal`
//! depuis `refs/iecode-re/research/ghidra-export/decompiled/ball_component.c`.
//!
//! # Sources RE
//!
//! - `ball_component.c` — `BallComponent_ctor` (lignes nie.c 175440-175592)
//! - `ball_component.c` — `FUN_14027ac10` = `BallMoveNormal::BallMoveNormal()` (lignes 512870-512921)
//!
//! # Fidélité
//!
//! - Structure générale et champs nommés : FIABLE (dérivés directement des offsets commentés)
//! - Valeurs d'initialisation (gravité=2.0, scale=1.0, IDs=0xFF/0xFFFF0000) : FIABLE (bits IEEE 754 explicites)
//! - Variants de contrôleur de mouvement (`BallMoveKind`) : FIABLE (noms extraits des vftables Ghidra)
//! - Sémantique interne de `BallMoveNormal` (physique exacte) : INCERTAINE — le pseudo-C
//!   ne montre que le constructeur, pas la méthode `update()`.

use crate::{
    BALL_GRAVITY, BALL_SCALE_DEFAULT, DISTANCE_UNINIT, INVALID_PLAYER_IDX, INVALID_TARGET_ID,
    Vec3,
};

/// Type de contrôleur de mouvement du ballon.
///
/// Source: `ball_component.c` — commentaire « Architecture du mouvement du ballon »
/// et commentaires vftable (`game::BallMoveNormal::vftable`, etc.).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[non_exhaustive]
pub enum BallMoveKind {
    /// Mouvement physique normal (gravité, rebonds).
    /// Contrôleur par défaut observé dans `FUN_14027ac10`.
    #[default]
    Normal,
    /// Suivi d'une cible (passes, centres).
    /// Utilisé aussi comme contrôleur initial dans `BallComponent_ctor`
    /// avant d'être remplacé par `Normal`.
    TargetFollow,
    /// Courbe de Bézier simple.
    Bezier,
    /// Courbe de Bézier multi-segments.
    MultiBezier,
    /// Tir hissatsu (courbe spéciale).
    RealSkillShootBezier,
    /// Trajectoire parabolique simple.
    SimpleParabola,
    /// Pendant le dribble.
    Dribble,
    /// Interpolation linéaire.
    Lerp,
    /// Mouvement basé sur un taux (fraction du déplacement par frame).
    Rate,
    /// Animation filet de but.
    Goalnet,
}

/// IDs de possession du ballon (jusqu'à 3 joueurs peuvent être concernés
/// simultanément, ex. duel possession vs contestation).
///
/// Source: `ball_component.c` offsets 0x1490-0x14A0 — 3 octets initialisés à `0xFF`.
/// RE incertain: le troisième slot n'est pas clairement documenté dans le RE.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct PossessionIds {
    /// Joueur principal en possession (`0xFF` = aucun).
    pub owner: u8,
    /// Joueur secondaire impliqué (`0xFF` = aucun).
    pub secondary: u8,
    /// Troisième joueur impliqué (`0xFF` = aucun).
    /// RE incertain: rôle exact du troisième slot inconnu.
    pub tertiary: u8,
}

impl Default for PossessionIds {
    fn default() -> Self {
        Self {
            owner: INVALID_PLAYER_IDX,
            secondary: INVALID_PLAYER_IDX,
            tertiary: INVALID_PLAYER_IDX,
        }
    }
}

impl PossessionIds {
    /// Retourne `true` si personne n'a le ballon.
    #[must_use]
    pub fn is_free(&self) -> bool {
        self.owner == INVALID_PLAYER_IDX
    }
}

/// IDs de cibles actives pour passe/interception.
///
/// Source: `ball_component.c` offsets 0x14D0, 0x14E0 — 2 × `u32` initialisés
/// à `0xFFFF0000`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct TargetIds {
    /// Cible principale de passe/interception (`INVALID_TARGET_ID` = aucune).
    pub primary: u32,
    /// Cible secondaire (`INVALID_TARGET_ID` = aucune).
    pub secondary: u32,
}

impl Default for TargetIds {
    fn default() -> Self {
        Self {
            primary: INVALID_TARGET_ID,
            secondary: INVALID_TARGET_ID,
        }
    }
}

impl TargetIds {
    /// Retourne `true` si aucune cible n'est définie.
    #[must_use]
    pub fn has_no_target(&self) -> bool {
        self.primary == INVALID_TARGET_ID && self.secondary == INVALID_TARGET_ID
    }
}

/// Données du contrôleur de mouvement normal (`game::BallMoveNormal`).
///
/// Source: `ball_component.c` — `FUN_14027ac10` (lignes nie.c 512870-512921).
///
/// # Fidélité
///
/// Le constructeur est fidèle (positions, direction à zéro, flags à false).
/// La sémantique de la physique (update) n'est PAS portée ici — seule la
/// structure d'initialisation est reconstruite.
///
/// RE incertain: les champs `force_a` et `force_b` (offsets 0x1C0, 0x200 dans
/// `BallMoveNormal`) sont deux vecteurs supplémentaires dont le rôle exact
/// (force externe vs inertie) est unclear.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct BallMoveNormal {
    /// Position courante.
    pub position: Vec3,
    /// Position précédente (pour calcul de vitesse).
    pub prev_position: Vec3,
    /// Vecteur direction (normalisé en théorie).
    pub direction: Vec3,
    /// Second vecteur (surface normale? axe de rotation?).
    /// RE incertain: rôle exact non déterminé (offsets 0xE0-0xF0 dans la struct).
    pub direction_b: Vec3,
    /// Vecteur de rebond / normale de surface.
    pub bounce_normal: Vec3,
    /// Second vecteur de surface (axe tangent?).
    /// RE incertain.
    pub surface_tangent: Vec3,
    /// `true` si le ballon est en contact avec le sol.
    /// Source: `FUN_14027ac10` — `*(undefined1 *)(param_1 + 0x18) = 0`.
    pub on_ground: bool,
    /// Force externe A (direction+magnitude).
    /// RE incertain: deux vecteurs supplémentaires dans le ctor, rôle unclear.
    pub force_a: Vec3,
    /// Force externe B.
    /// RE incertain.
    pub force_b: Vec3,
    /// Flag de collision.
    /// Source: `FUN_14027ac10` — `*(undefined1 *)(longlong)param_1 + 300) = 0`.
    pub collision_flag: bool,
}

impl Default for BallMoveNormal {
    fn default() -> Self {
        Self {
            position: Vec3::zero(),
            prev_position: Vec3::zero(),
            direction: Vec3::zero(),
            direction_b: Vec3::zero(),
            bounce_normal: Vec3::zero(),
            surface_tangent: Vec3::zero(),
            on_ground: false,
            force_a: Vec3::zero(),
            force_b: Vec3::zero(),
            collision_flag: false,
        }
    }
}

/// Données d'interception en cours.
///
/// Source: `ball_component.c` — offsets 0x14F0-0x1540 (zone interception/trap).
/// RE incertain: structure interne non entièrement décodée. Seuls l'ID cible
/// et le flag d'état sont reconstruits avec certitude.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct InterceptionData {
    /// ID du joueur tentant l'interception (`INVALID_TARGET_ID` = aucun).
    pub interceptor_id: u32,
    /// ID secondaire associé à l'interception.
    /// RE incertain: peut être le passeur ou la cible de la passe interceptée.
    pub source_id: u32,
}

impl InterceptionData {
    /// Crée une interception vide.
    #[must_use]
    pub fn none() -> Self {
        Self {
            interceptor_id: INVALID_TARGET_ID,
            source_id: INVALID_TARGET_ID,
        }
    }

    /// Retourne `true` si aucune interception n'est en cours.
    #[must_use]
    pub fn is_none(&self) -> bool {
        self.interceptor_id == INVALID_TARGET_ID
    }
}

/// Composant principal du ballon (`game::BallComponent`).
///
/// Source: `ball_component.c` — `BallComponent_ctor` (lignes nie.c 175440-175592).
/// Taille originale estimée à `~0x17C0` bytes (6080 bytes).
///
/// # Fidélité
///
/// - Toutes les valeurs d'initialisation sont confirmées par les bits IEEE 754 explicites.
/// - Le contrôleur de mouvement actif au démarrage est `BallMoveKind::TargetFollow`
///   (le ctor pose d'abord `IBallMoveController::vftable` puis `BallMoveTargetFollow::vftable`
///   avant le retour — `Normal` n'est pas le défaut réel pour un ball fraîchement créé).
/// - RE incertain: la grande zone `0x130-0x1450` (initialisée via `FUN_14132dc00`)
///   n'est pas décomposée ici, son contenu exact est inconnu.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct BallComponent {
    /// Contrôleur de mouvement actif.
    pub move_controller: BallMoveKind,
    /// Position courante du ballon.
    pub position: Vec3,
    /// Position précédente (frame N-1).
    pub prev_position: Vec3,
    /// Vecteur d'orientation (direction du mouvement).
    pub orientation: Vec3,
    /// Vecteur de vitesse.
    /// RE incertain: ce champ est déduit de l'offset 0x0E0 dans la struct C++,
    /// mais son rôle exact (vitesse ou accélération) n'est pas confirmé.
    pub velocity: Vec3,
    /// IDs des joueurs en possession.
    pub possession: PossessionIds,
    /// IDs des cibles actives.
    pub targets: TargetIds,
    /// Données d'interception en cours.
    pub interception: InterceptionData,
    /// Gravité appliquée au ballon (unités/frame²).
    pub gravity: f32,
    /// Nombre maximum de collisions par frame.
    /// Source: `BallComponent_ctor` — `*(undefined1 *)(param_1 + 0x148a) = 5`.
    pub max_collisions_per_frame: u8,
    /// Scale du ballon (1.0 = normal).
    pub scale: f32,
    /// Distance de détection primaire (`-1.0` = non calculée).
    pub detection_dist_primary: f32,
    /// Distance de détection secondaire (`-1.0` = non calculée).
    pub detection_dist_secondary: f32,
    /// Données du contrôleur de mouvement normal (embarquées pour éviter alloc).
    pub move_normal: BallMoveNormal,
}

impl Default for BallComponent {
    /// Initialise le composant ballon avec les valeurs du constructeur C++.
    ///
    /// Source: `BallComponent_ctor` dans `ball_component.c`.
    fn default() -> Self {
        Self {
            // Le constructeur pose TargetFollow comme vftable finale
            move_controller: BallMoveKind::TargetFollow,
            position: Vec3::zero(),
            prev_position: Vec3::zero(),
            orientation: Vec3::zero(),
            velocity: Vec3::zero(),
            possession: PossessionIds::default(),
            targets: TargetIds::default(),
            interception: InterceptionData::none(),
            gravity: BALL_GRAVITY,
            max_collisions_per_frame: 5,
            scale: BALL_SCALE_DEFAULT,
            detection_dist_primary: DISTANCE_UNINIT,
            detection_dist_secondary: DISTANCE_UNINIT,
            move_normal: BallMoveNormal::default(),
        }
    }
}

impl BallComponent {
    /// Crée un composant ballon avec les valeurs d'initialisation par défaut.
    ///
    /// # Exemple
    ///
    /// ```
    /// use nie_core::ball::BallComponent;
    /// use nie_core::{BALL_GRAVITY, INVALID_PLAYER_IDX};
    ///
    /// let ball = BallComponent::new();
    /// assert_eq!(ball.gravity, BALL_GRAVITY);
    /// assert!(ball.possession.is_free());
    /// ```
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Retourne `true` si le ballon est libre (personne en possession).
    #[must_use]
    pub fn is_free(&self) -> bool {
        self.possession.is_free()
    }

    /// Retourne `true` si une interception est en cours.
    #[must_use]
    pub fn is_being_intercepted(&self) -> bool {
        !self.interception.is_none()
    }

    /// Définit le joueur propriétaire du ballon.
    pub fn set_owner(&mut self, player_idx: u8) {
        self.possession.owner = player_idx;
    }

    /// Libère la possession du ballon (remet tous les IDs à `INVALID_PLAYER_IDX`).
    pub fn release_possession(&mut self) {
        self.possession = PossessionIds::default();
        self.interception = InterceptionData::none();
        self.targets = TargetIds::default();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{BALL_GRAVITY, BALL_SCALE_DEFAULT, DISTANCE_UNINIT, INVALID_PLAYER_IDX};

    #[test]
    fn ball_component_default_gravity() {
        let ball = BallComponent::new();
        // 0x40000000 = 2.0f en IEEE 754 — confirmé par ball_component.c
        assert_eq!(ball.gravity.to_bits(), 0x4000_0000);
        assert_eq!(ball.gravity, BALL_GRAVITY);
    }

    #[test]
    fn ball_component_default_scale() {
        let ball = BallComponent::new();
        // 0x3F800000 = 1.0f en IEEE 754 — confirmé par ball_component.c offset 0x2ea
        assert_eq!(ball.scale.to_bits(), 0x3F80_0000);
        assert_eq!(ball.scale, BALL_SCALE_DEFAULT);
    }

    #[test]
    fn ball_component_default_distances() {
        let ball = BallComponent::new();
        // 0xBF800000 = -1.0f — confirmé par ball_component.c offsets 0x1764, 0x176c
        assert_eq!(ball.detection_dist_primary.to_bits(), 0xBF80_0000);
        assert_eq!(ball.detection_dist_primary, DISTANCE_UNINIT);
        assert_eq!(ball.detection_dist_secondary, DISTANCE_UNINIT);
    }

    #[test]
    fn ball_component_default_max_collisions() {
        let ball = BallComponent::new();
        // ball_component.c : *(undefined1 *)(param_1 + 0x148a) = 5
        assert_eq!(ball.max_collisions_per_frame, 5);
    }

    #[test]
    fn ball_component_possession_ids_default() {
        let ball = BallComponent::new();
        // Tous les IDs de possession doivent être 0xFF (INVALID_PLAYER_IDX)
        assert_eq!(ball.possession.owner, INVALID_PLAYER_IDX);
        assert_eq!(ball.possession.secondary, INVALID_PLAYER_IDX);
        assert_eq!(ball.possession.tertiary, INVALID_PLAYER_IDX);
        assert!(ball.possession.is_free());
    }

    #[test]
    fn ball_component_target_ids_default() {
        let ball = BallComponent::new();
        // Cibles initialisées à 0xFFFF0000
        assert_eq!(ball.targets.primary, 0xFFFF_0000);
        assert_eq!(ball.targets.secondary, 0xFFFF_0000);
        assert!(ball.targets.has_no_target());
    }

    #[test]
    fn ball_component_default_controller_is_target_follow() {
        let ball = BallComponent::new();
        // Le ctor pose BallMoveTargetFollow::vftable en dernier
        assert_eq!(ball.move_controller, BallMoveKind::TargetFollow);
    }

    #[test]
    fn ball_component_set_owner() {
        let mut ball = BallComponent::new();
        assert!(ball.is_free());
        ball.set_owner(3);
        assert!(!ball.is_free());
        assert_eq!(ball.possession.owner, 3);
    }

    #[test]
    fn ball_component_release_possession() {
        let mut ball = BallComponent::new();
        ball.set_owner(5);
        ball.targets.primary = 42;
        ball.release_possession();
        assert!(ball.is_free());
        assert!(ball.targets.has_no_target());
    }

    #[test]
    fn ball_move_normal_default_on_ground_false() {
        let mv = BallMoveNormal::default();
        // ball_component.c : *(undefined1 *)(param_1 + 0x18) = 0 dans FUN_14027ac10
        assert!(!mv.on_ground);
        assert!(!mv.collision_flag);
    }

    #[test]
    fn possession_ids_is_free() {
        let p = PossessionIds::default();
        assert!(p.is_free());
        let p2 = PossessionIds { owner: 0, secondary: 0xFF, tertiary: 0xFF };
        assert!(!p2.is_free());
    }

    #[test]
    fn target_ids_has_no_target() {
        let t = TargetIds::default();
        assert!(t.has_no_target());
        let t2 = TargetIds { primary: 1, secondary: crate::INVALID_TARGET_ID };
        assert!(!t2.has_no_target());
    }
}
