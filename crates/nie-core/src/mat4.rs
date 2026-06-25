//! Multiplication de matrices 4x4 (row-major) — port byte-exact de `FUN_140090fa0`
//! de `nie_eacpatched.exe`.
//!
//! Sémantique. La fonction calcule `result = A * B` où `A`, `B` et `result` sont des
//! matrices 4x4 de `f32` stockées en **row-major** (16 floats contigus, 4 lignes de 4).
//! Convention vecteur-ligne : `result[i] = sum_k A[i][k] * B_row[k]`, c'est-à-dire que
//! chaque ligne de sortie est une combinaison linéaire des lignes de `B` pondérée par la
//! ligne `i` de `A`. ABI d'origine : `param_1`=rcx (sortie), `param_2`=rdx (A), `param_3`=r8 (B).
//!
//! Ordre d'accumulation (FMA3, single-rounding) — reproduit exactement le code machine
//! (`mulps` puis trois `vfmadd231ps` par ligne) :
//!
//! ```text
//! acc = A[i][0] * B[0][j]                       // mulps (multiplication arrondie)
//! acc = fma(A[i][1], B[1][j], acc)              // vfmadd231ps
//! acc = fma(A[i][2], B[2][j], acc)              // vfmadd231ps
//! acc = fma(A[i][3], B[3][j], acc)              // vfmadd231ps
//! ```
//!
//! Le premier terme est une multiplication ordinaire ; les trois suivants des
//! fused-multiply-add (`f32::mul_add`) → l'ordre et l'arrondi sont byte-exacts.
//!
//! Validation. `scripts/validate_mat4_mul.py` confronte ce miroir à l'oracle uemu
//! (Unicorn sur le PE réel) : 604 cas (identité, zéros, séquentiels, et fuzz LCG seedé
//! couvrant petits entiers, autour de 1, uniformes [-1000,1000] et mantisses 23 bits
//! pleines à exposant borné) — **tous byte-exacts** (comparaison sur les bits f32).

/// Multiplie deux matrices 4x4 row-major : `a * b`.
///
/// Reproduit `FUN_140090fa0` au bit près (ordre d'accumulation FMA identique).
pub fn mat4_mul(a: &[f32; 16], b: &[f32; 16]) -> [f32; 16] {
    let mut out = [0.0f32; 16];
    // lignes de B
    let b0 = [b[0], b[1], b[2], b[3]];
    let b1 = [b[4], b[5], b[6], b[7]];
    let b2 = [b[8], b[9], b[10], b[11]];
    let b3 = [b[12], b[13], b[14], b[15]];

    let mut i = 0;
    while i < 4 {
        let a0 = a[i * 4];
        let a1 = a[i * 4 + 1];
        let a2 = a[i * 4 + 2];
        let a3 = a[i * 4 + 3];
        let mut j = 0;
        while j < 4 {
            // mulps puis 3x vfmadd231ps — ordre exact du binaire
            let acc = a0 * b0[j];
            let acc = a1.mul_add(b1[j], acc);
            let acc = a2.mul_add(b2[j], acc);
            let acc = a3.mul_add(b3[j], acc);
            out[i * 4 + j] = acc;
            j += 1;
        }
        i += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Égalité au bit près (pas float==, gère -0.0/NaN proprement).
    fn bit_eq(a: &[f32; 16], b: &[f32; 16]) -> bool {
        a.iter().zip(b).all(|(x, y)| x.to_bits() == y.to_bits())
    }

    #[test]
    fn identite_x_sequentiel() {
        let ident = [
            1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
        ];
        let seq = [
            1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 11.0, 12.0, 13.0, 14.0, 15.0, 16.0,
        ];
        // I * M == M  et  M * I == M
        assert!(bit_eq(&mat4_mul(&ident, &seq), &seq));
        assert!(bit_eq(&mat4_mul(&seq, &ident), &seq));
    }

    #[test]
    fn cas_fractionnaire_golden() {
        // Valeurs capturées de l'oracle uemu (cas "frac" de validate_mat4_mul.py).
        let a = [
            0.5, 1.5, -2.25, 3.0, 0.125, -0.75, 4.0, 1.0, 2.0, -1.0, 0.5, -0.5, 1.25, 2.5, -3.5,
            0.25,
        ];
        let b = [
            1.5, -0.5, 2.0, 0.25, -1.0, 3.0, 0.5, -2.0, 0.75, 1.25, -1.5, 4.0, 2.5, -0.25, 1.0,
            -1.25,
        ];
        let expect = [
            5.0625, 0.6875, 8.125, -15.625, 6.4375, 2.4375, -5.125, 16.28125, 3.125, -3.25, 2.25,
            5.125, -2.625, 2.4375, 9.25, -19.0,
        ];
        assert!(bit_eq(&mat4_mul(&a, &b), &expect));
    }

    #[test]
    fn zero_annule() {
        let zero = [0.0f32; 16];
        let seq = [
            1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 11.0, 12.0, 13.0, 14.0, 15.0, 16.0,
        ];
        assert!(bit_eq(&mat4_mul(&zero, &seq), &zero));
    }
}
