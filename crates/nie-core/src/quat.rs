//! Produit de quaternions (Hamilton) — port byte-exact de `FUN_14007faf0`
//! de `nie_eacpatched.exe`.
//!
//! Sémantique. La fonction calcule `out = q1 * q2`, produit de Hamilton de deux
//! quaternions. Chaque quaternion est un `[f32; 4]` au format `(x, y, z, w)` avec
//! `w` = composante scalaire (index 3). ABI d'origine : `param_1`=rcx (q1),
//! `param_2`=rdx (out, aussi renvoyé), `param_3`=r8 (q2).
//!
//! Ordre d'accumulation tiré du code machine (uniquement `mulss`/`addss`/`subss`
//! scalaires — **aucune FMA**), donc des `f32` à arrondis séparés, gauche-à-droite :
//!
//! ```text
//! out.x = ((x2*w1 + w2*x1) + z2*y1) - y2*z1
//! out.y = ((w2*y1 + w1*y2) + x2*z1) - x1*z2
//! out.z = ((w1*z2 + w2*z1) + x1*y2) - x2*y1
//! out.w = ((w1*w2 - x2*x1) - y1*y2) - z2*z1
//! ```
//!
//! La multiplication f32 étant commutative et exacte au bit, seul l'ordre des
//! additions/soustractions importe ; il est reproduit tel quel (associativité à
//! gauche, identique à l'évaluation Rust par défaut, sans `mul_add`).
//!
//! Validation. `scripts/validate_quat_mul.py` confronte ce miroir à l'oracle uemu
//! (Unicorn sur le PE réel) : 1096 cas (bords explicites 0/±1/±0/inf/π/… et fuzz
//! LCG seedé sur [-10,10] + valeurs extrêmes 1e±30) — 4336 comparaisons f32/inf
//! **byte-exactes** (sur les bits), 48 NaN canonicalisés (payload = artefact HW),
//! 0 mismatch.

/// Produit de Hamilton de deux quaternions `(x, y, z, w)` : `q1 * q2`.
///
/// Reproduit `FUN_14007faf0` au bit près (ordre d'accumulation SSE scalaire
/// identique, pas de fused-multiply-add).
pub fn quat_mul(q1: &[f32; 4], q2: &[f32; 4]) -> [f32; 4] {
    let [x1, y1, z1, w1] = *q1;
    let [x2, y2, z2, w2] = *q2;

    // `*` lie plus fort que `+`/`-`, qui sont associatifs à gauche → l'ordre
    // d'évaluation correspond exactement à la séquence mulss/addss/subss.
    let out_x = x2 * w1 + w2 * x1 + z2 * y1 - y2 * z1;
    let out_y = w2 * y1 + w1 * y2 + x2 * z1 - x1 * z2;
    let out_z = w1 * z2 + w2 * z1 + x1 * y2 - x2 * y1;
    let out_w = w1 * w2 - x2 * x1 - y1 * y2 - z2 * z1;

    [out_x, out_y, out_z, out_w]
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Égalité au bit près (pas float==, gère -0.0/NaN proprement).
    fn bit_eq(a: &[f32; 4], b: &[f32; 4]) -> bool {
        a.iter().zip(b).all(|(x, y)| x.to_bits() == y.to_bits())
    }

    #[test]
    fn golden_sequentiel() {
        // Oracle uemu : (1,2,3,4) * (5,6,7,8) = (24,48,48,-6).
        let out = quat_mul(&[1.0, 2.0, 3.0, 4.0], &[5.0, 6.0, 7.0, 8.0]);
        assert!(bit_eq(&out, &[24.0, 48.0, 48.0, -6.0]));
    }

    #[test]
    fn identite_renvoie_q2() {
        // q1 = identité (0,0,0,1) → out == q2 (oracle uemu).
        let q2 = [1.0, 2.0, 3.0, 4.0];
        let out = quat_mul(&[0.0, 0.0, 0.0, 1.0], &q2);
        assert!(bit_eq(&out, &q2));
    }

    #[test]
    #[allow(clippy::approx_constant)] // 0.70710678 = entrée d'oracle littérale, PAS FRAC_1_SQRT_2.
    fn golden_irrationnel() {
        // Oracle uemu : produit où chaque composante = 0x3effffff (= 0.4999999701976776).
        let q = [0.70710678f32, 0.0, 0.0, 0.70710678];
        let out = quat_mul(&q, &[0.0, 0.70710678, 0.0, 0.70710678]);
        let half = f32::from_bits(0x3eff_ffff);
        assert!(bit_eq(&out, &[half, half, half, half]));
    }

    #[test]
    fn golden_fractionnaire() {
        // Oracle uemu.
        let out = quat_mul(&[-1.5, 2.25, -3.5, 0.5], &[4.0, -0.25, 1.75, -2.0]);
        assert!(bit_eq(&out, &[8.0625, -16.0, -0.75, 11.6875]));
    }
}
