//! **nie-geom** — types géométriques POD partagés du workspace niers (dédup Phase 2).
//!
//! `Vec2`/`Vec3` sont des conteneurs `[f32]` **axis-agnostiques** : le système de coordonnées
//! (quel axe est « vertical ») vit dans le CODE de chaque consommateur, PAS dans le type.
//!
//! ⚠ **Landmine #4** (cf. `docs/DEDUP-PLAN.md`) : `nie-core` traite `y` comme hauteur, `nie-runtime`
//! traite `z` comme hauteur. Le type unifié ne change RIEN à cela (chaque crate garde sa convention
//! dans son code). Mais **ne jamais convertir implicitement** un `Vec3` d'un système vers l'autre :
//! la similarité de layout ne vaut pas équivalence sémantique.
//!
//! `no_std` par défaut hors feature `std` : les méthodes à `f32::sqrt`/`hypot`
//! (`length`/`normalize`/`len`/`norm`) sont gatées `#[cfg(feature = "std")]`.

#![cfg_attr(not(feature = "std"), no_std)]
#![forbid(unsafe_code)]

/// Vecteur 2D `[f32; 2]` (plan). Sémantique des axes = celle du consommateur.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Vec2 {
    pub x: f32,
    pub y: f32,
}

impl Vec2 {
    /// Construit un vecteur 2D.
    #[must_use]
    pub const fn new(x: f32, y: f32) -> Self {
        Self { x, y }
    }

    /// Norme euclidienne.
    #[cfg(feature = "std")]
    #[must_use]
    pub fn len(self) -> f32 {
        self.x.hypot(self.y)
    }

    /// Vecteur unitaire (ou zéro si longueur nulle).
    #[cfg(feature = "std")]
    #[must_use]
    pub fn norm(self) -> Self {
        let l = self.len();
        if l > 1e-6 { self * (1.0 / l) } else { Self::default() }
    }
}

impl core::ops::Add for Vec2 {
    type Output = Self;
    fn add(self, o: Self) -> Self {
        Self::new(self.x + o.x, self.y + o.y)
    }
}

impl core::ops::Sub for Vec2 {
    type Output = Self;
    fn sub(self, o: Self) -> Self {
        Self::new(self.x - o.x, self.y - o.y)
    }
}

impl core::ops::Mul<f32> for Vec2 {
    type Output = Self;
    fn mul(self, s: f32) -> Self {
        Self::new(self.x * s, self.y * s)
    }
}

/// Vecteur 3D `[f32; 3]`. Sémantique des axes = celle du consommateur (cf. landmine #4 ci-dessus).
#[derive(Debug, Clone, Copy, PartialEq, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Vec3 {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

impl Vec3 {
    /// Vecteur nul.
    #[must_use]
    pub const fn zero() -> Self {
        Self { x: 0.0, y: 0.0, z: 0.0 }
    }

    /// Construit un vecteur 3D.
    #[must_use]
    pub const fn new(x: f32, y: f32, z: f32) -> Self {
        Self { x, y, z }
    }

    /// Composante X.
    #[must_use]
    pub fn x(self) -> f32 {
        self.x
    }
    /// Composante Y.
    #[must_use]
    pub fn y(self) -> f32 {
        self.y
    }
    /// Composante Z.
    #[must_use]
    pub fn z(self) -> f32 {
        self.z
    }

    /// Projection sur le plan `(x, y)`.
    #[must_use]
    pub const fn ground(self) -> Vec2 {
        Vec2::new(self.x, self.y)
    }

    /// Longueur euclidienne au carré (sans racine, pour comparaisons).
    #[must_use]
    pub fn length_sq(self) -> f32 {
        self.x * self.x + self.y * self.y + self.z * self.z
    }

    /// Longueur euclidienne.
    #[cfg(feature = "std")]
    #[must_use]
    pub fn length(self) -> f32 {
        self.length_sq().sqrt()
    }

    /// Normalise (retourne `zero()` si norme < epsilon).
    #[cfg(feature = "std")]
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

#[cfg(all(test, feature = "std"))]
mod tests {
    use super::*;

    #[test]
    fn vec3_length() {
        let v = Vec3 { x: 3.0, y: 0.0, z: 4.0 };
        assert!((v.length() - 5.0).abs() < 1e-5);
    }

    #[test]
    fn vec3_normalize_zero() {
        assert_eq!(Vec3::zero().normalize(), Vec3::zero());
    }

    #[test]
    fn vec3_lerp() {
        let a = Vec3::zero();
        let b = Vec3 { x: 10.0, y: 20.0, z: 30.0 };
        let mid = a.lerp(b, 0.5);
        assert!((mid.x - 5.0).abs() < 1e-6 && (mid.y - 10.0).abs() < 1e-6 && (mid.z - 15.0).abs() < 1e-6);
    }

    #[test]
    fn vec2_ops() {
        let a = Vec2::new(1.0, 2.0);
        let b = Vec2::new(3.0, 4.0);
        assert_eq!(a + b, Vec2::new(4.0, 6.0));
        assert_eq!((b - a), Vec2::new(2.0, 2.0));
        assert!((Vec2::new(3.0, 4.0).len() - 5.0).abs() < 1e-5);
    }

    #[test]
    fn ground_projects_xy() {
        assert_eq!(Vec3::new(1.0, 2.0, 3.0).ground(), Vec2::new(1.0, 2.0));
    }
}
