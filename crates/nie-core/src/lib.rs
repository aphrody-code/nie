//! `nie-core` — Logique de jeu reversée en Rust pur
//!
//! Ce crate porte en Rust idiomatique les structures et algorithmes de
//! gameplay extraits du pseudo-C Ghidra de `nie.exe` (Inazuma Eleven:
//! Victory Road). Chaque élément porté cite sa source exacte et documente
//! ce qui est fidèle versus incertain.
//!
//! # Modules
//!
//! - [`ball`] — Composant ballon (`game::BallComponent`, contrôleurs de mouvement)
//! - [`match_state`] — Machine à états du match d'entraînement (`game::CSceneSoccer`)
//! - [`match_fsm`] — FSM de match 11 états + score final (`tick`/`final_score`)
//! - [`soccer_ctrl`] — Contrôleur de match et transitions de phase
//! - [`action`] — Contrôleur d'actions joueur (`game::SoccerActionCtrl`)
//! - [`command_effect`] — Tables de slots d'effets de commande de match
//! - [`keeper`] — Calcul d'arrêt du gardien (`game::SoccerCalcKeeperSaveComponent`)
//! - [`tactics`] — IA tactique par joueur (`game::SoccerCharaTacticsAI`)
//! - [`stats`] — Courbe d'interpolation 3-segments des statistiques
//! - [`growth`] — Tables de croissance + lookup à fallback + `calculate_stats`
//! - [`exp`] — Table d'XP par niveau + multiplicateur de rareté
//! - [`skill`] — Modèle de technique (hissatsu) + maps élément/catégorie
//! - [`aura`] — Modèle d'aura (Keshin/Soul/…) + résolution du hissatsu lié
//!
//! # Conventions de portage
//!
//! - Chaque `struct` Rust correspond à une classe C++ identifiée par RTTI/vftable
//! - Les champs `undefined8`/`param_N` Ghidra sont reconstruits sémantiquement
//! - Les constantes flottantes IEEE 754 (`0x3F800000` = 1.0f, etc.) sont nommées
//! - Les incertitudes RE sont documentées `// RE incertain: …`
//! - `#![forbid(unsafe_code)]` — aucun `unsafe` dans ce crate

#![forbid(unsafe_code)]
#![warn(missing_docs)]
#![allow(clippy::pedantic)]
#![allow(clippy::float_cmp)]
// std est requis pour f32::sqrt, f32::floor sur certaines cibles no_std.
// Pour l'instant on reste std pour simplicité; une feature no_std peut être
// ajoutée plus tard avec libm si nécessaire pour wasm bare-metal.

/// Helpers serde pour les grands tableaux d'octets (serde n'impl. pas les
/// arrays > 32 nativement). (Dé)sérialise un `[u8; N]` comme une séquence.
///
/// N'est compilé que sous la feature `serde`.
#[cfg(feature = "serde")]
pub(crate) mod serde_byte_array {
    use core::convert::TryInto;
    use serde::de::{Deserialize, Deserializer, Error};
    use serde::ser::Serializer;

    /// Sérialise `[u8; N]` comme un slice d'octets.
    pub fn serialize<S, const N: usize>(arr: &[u8; N], s: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        s.serialize_bytes(arr)
    }

    /// Désérialise un `[u8; N]` depuis un `Vec<u8>` de longueur exacte.
    pub fn deserialize<'de, D, const N: usize>(d: D) -> Result<[u8; N], D::Error>
    where
        D: Deserializer<'de>,
    {
        let v = <Vec<u8>>::deserialize(d)?;
        v.as_slice()
            .try_into()
            .map_err(|_| D::Error::custom("longueur de tableau d'octets invalide"))
    }
}

pub mod action;
pub mod aura;
pub mod ball;
pub mod command_effect;
pub mod exp;
pub mod growth;
pub mod keeper;
pub mod match_fsm;
pub mod match_state;
pub mod skill;
pub mod soccer_ctrl;
pub mod stats;
pub mod tactics;

/// Identifiant invalide pour joueur/cible (0xFFFF0000 en binaire IEVR).
///
/// Source: `ball_component.c` offsets 0x14D0, 0x1500 — initialisation des
/// champs `target_id` et `intercept_target_id` à `0xFFFF0000`.
pub const INVALID_TARGET_ID: u32 = 0xFFFF_0000;

/// Indice de joueur invalide (0xFF = "aucun joueur").
///
/// Source: `ball_component.c` offsets 0x1490-0x14A0 — 3 octets initialisés
/// à `0xFF` pour les IDs de possession.
pub const INVALID_PLAYER_IDX: u8 = 0xFF;

/// Gravité du ballon en unités/frame² (valeur lue à offset 0x1474).
///
/// Source: `ball_component.c` — `*(undefined4 *)(param_1 + 0x1474) = 0x40000000`
/// soit `2.0f` en IEEE 754.
pub const BALL_GRAVITY: f32 = 2.0;

/// Scale du ballon par défaut (1.0f).
///
/// Source: `ball_component.c` — `*(undefined4 *)(param_1 + 0x2ea) = 0x3f800000`.
pub const BALL_SCALE_DEFAULT: f32 = 1.0;

/// Valeur sentinelle pour une distance non encore calculée (-1.0f).
///
/// Source: `ball_component.c` — offsets 0x1764, 0x176c initialisés à
/// `0xBF800000` (-1.0f en IEEE 754).
pub const DISTANCE_UNINIT: f32 = -1.0;

/// Rayon d'arrêt par défaut du gardien (1.0f).
///
/// Source: `soccer_keeper_save.c` — `*(undefined4 *)(param_1 + 0x2e) = 0x3f800000`.
pub const KEEPER_SAVE_RADIUS_DEFAULT: f32 = 1.0;

/// Distance maximale de plongeon du gardien (5.0f).
///
/// Source: `soccer_keeper_save.c` — `*(undefined4 *)(param_1 + 0x174) = 0x40a00000`.
pub const KEEPER_DIVE_MAX_DIST: f32 = 5.0;

/// Probabilité de base d'arrêt du gardien (0.8 = 80 %).
///
/// Source: `soccer_keeper_save.c` — `0x3F4CCCCD` ≈ `0.8f` IEEE 754.
pub const KEEPER_SAVE_PROBABILITY_BASE: f32 = 0.8;

/// Temps de réaction du gardien en frames (valeur réelle 4.73f).
///
/// Source: `soccer_keeper_save.c` — `0x40975C29` ≈ `4.73f` IEEE 754.
/// RE incertain: unité exacte (frames 60Hz? millisecondes?)
pub const KEEPER_REACTION_TIME_FRAMES: f32 = 4.73;

/// Vitesse de plongeon du gardien (2.67f unités/frame).
///
/// Source: `soccer_keeper_save.c` — `0x402AE148` ≈ `2.67f` IEEE 754.
/// RE incertain: unité (unités monde/frame ou m/s?)
pub const KEEPER_DIVE_SPEED: f32 = 2.67;

/// Masque de flags tactiques (0x1000000).
///
/// Source: `soccer_tactics_ai.c` — `*(undefined4 *)(param_1 + 0x154) = 0x1000000`.
/// RE incertain: signification bit-par-bit inconnue.
pub const TACTICS_FLAGS_MASK: u32 = 0x0100_0000;

/// Priorité maximale d'une option tactique (7).
///
/// Source: `soccer_tactics_ai.c` — `*(undefined2 *)(...) = 7` pour chaque
/// niveau de priorité dans les contextes tactiques.
pub const TACTICS_MAX_PRIORITY: u16 = 7;

/// Mode tactique par défaut (2).
///
/// Source: `soccer_tactics_ai.c` — `*(undefined8 *)(param_1 + 0xac) = 2`.
/// RE incertain: signification enum (0=off, 1=défensif, 2=normal, 3=offensif?).
pub const TACTICS_DEFAULT_MODE: u64 = 2;

/// Vec3 flottant, convention IEVR (x, y, z).
///
/// Les coordonnées IEVR semblent utiliser y vers le haut (système main-droite
/// habituel 3D). Aucune confirmation absolue depuis le RE — système de
/// coordonnées non vérifié.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Vec3 {
    /// Composante X (horizontale, axe longueur terrain)
    pub x: f32,
    /// Composante Y (verticale, hauteur)
    pub y: f32,
    /// Composante Z (horizontale, axe largeur terrain)
    pub z: f32,
}

impl Vec3 {
    /// Vecteur nul.
    #[must_use]
    pub const fn zero() -> Self {
        Self { x: 0.0, y: 0.0, z: 0.0 }
    }

    /// Composante X du vecteur (abréviation).
    #[must_use]
    pub fn x(self) -> f32 { self.x }
    /// Composante Y du vecteur (abréviation).
    #[must_use]
    pub fn y(self) -> f32 { self.y }
    /// Composante Z du vecteur (abréviation).
    #[must_use]
    pub fn z(self) -> f32 { self.z }

    /// Longueur euclidienne au carré (sans racine carrée, pour comparaisons).
    #[must_use]
    pub fn length_sq(self) -> f32 {
        self.x * self.x + self.y * self.y + self.z * self.z
    }

    /// Longueur euclidienne.
    #[must_use]
    pub fn length(self) -> f32 {
        self.length_sq().sqrt()
    }

    /// Normalise le vecteur (retourne `zero()` si norme < epsilon).
    #[must_use]
    pub fn normalize(self) -> Self {
        let len = self.length();
        if len < f32::EPSILON {
            return Self::zero();
        }
        Self { x: self.x / len, y: self.y / len, z: self.z / len }
    }

    /// Lerp entre `self` et `other` avec poids `t` ∈ [0, 1].
    #[must_use]
    pub fn lerp(self, other: Self, t: f32) -> Self {
        Self {
            x: self.x + (other.x - self.x) * t,
            y: self.y + (other.y - self.y) * t,
            z: self.z + (other.z - self.z) * t,
        }
    }
}

impl core::fmt::Display for Vec3 {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(f, "({:.3}, {:.3}, {:.3})", self.x, self.y, self.z)
    }
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vec3_zero() {
        let v = Vec3::zero();
        assert_eq!(v.x, 0.0);
        assert_eq!(v.y, 0.0);
        assert_eq!(v.z, 0.0);
    }

    #[test]
    fn vec3_length() {
        let v = Vec3 { x: 3.0, y: 0.0, z: 4.0 };
        assert!((v.length() - 5.0).abs() < 1e-5);
    }

    #[test]
    fn vec3_normalize() {
        let v = Vec3 { x: 0.0, y: 3.0, z: 0.0 };
        let n = v.normalize();
        assert!((n.y - 1.0).abs() < 1e-6);
        assert_eq!(n.x, 0.0);
        assert_eq!(n.z, 0.0);
    }

    #[test]
    fn vec3_lerp() {
        let a = Vec3 { x: 0.0, y: 0.0, z: 0.0 };
        let b = Vec3 { x: 10.0, y: 20.0, z: 30.0 };
        let mid = a.lerp(b, 0.5);
        assert!((mid.x - 5.0).abs() < 1e-6);
        assert!((mid.y - 10.0).abs() < 1e-6);
        assert!((mid.z - 15.0).abs() < 1e-6);
    }

    #[test]
    fn constants_coherents() {
        // Vérifie que les constantes matchent les bits IEEE 754 du binaire
        assert_eq!(BALL_GRAVITY.to_bits(), 0x4000_0000);
        assert_eq!(BALL_SCALE_DEFAULT.to_bits(), 0x3F80_0000);
        assert_eq!(DISTANCE_UNINIT.to_bits(), 0xBF80_0000);
        assert_eq!(KEEPER_SAVE_RADIUS_DEFAULT.to_bits(), 0x3F80_0000);
    }
}
