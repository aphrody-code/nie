//! Port byte-exact de `FUN_14168b5f0` de `nie_eacpatched.exe`.
//!
//! Sémantique : `strlen` MSVC — longueur d'une chaîne C terminée par NUL.
//! Reçoit un pointeur (`rcx`) vers une suite d'octets et renvoie (`rax`) le nombre
//! d'octets avant le premier `0x00`.
//!
//! L'implémentation d'origine fait : préfixe non aligné octet-par-octet jusqu'à un
//! alignement de 8, puis détection SWAR du zéro-octet sur 8 octets
//! `((!x ^ (x.wrapping_add(0x7efefefefefefeff))) & 0x8101010101010100) != 0`.
//! Le RÉSULTAT est exactement l'index du premier octet nul — c'est cette valeur qui
//! est validée byte-exact contre l'oracle uemu (1028 cas : longueurs 0..600,
//! tous les alignements 0..7, octets stressants 0x01/0xFE/0xFF).
//!
//! Port Rust SAFE sur tranche : on travaille sur `&[u8]` plutôt qu'un pointeur brut.
//! - `strlen` renvoie l'index du premier `0x00` (== valeur de retour de la fonction).
//!   Si aucun NUL n'est présent dans la tranche, renvoie `buf.len()` (la fonction
//!   d'origine lirait au-delà ; ici on borne proprement, sans `unsafe`).
//!
//! Validation : `scripts/validate_strlen.py` → « BYTE-EXACT » (1028 cas, fails=0).

#![allow(dead_code)]

/// Masques SWAR de la version MSVC (documentés ; voir `strlen_swar`).
const SWAR_MAGIC: u64 = 0x7efe_fefe_fefe_feff;
const SWAR_HOLE: u64 = 0x8101_0101_0101_0100;

/// Longueur d'une chaîne C terminée par NUL contenue dans `buf`.
///
/// Renvoie l'index du premier octet `0x00`. Si `buf` ne contient aucun NUL,
/// renvoie `buf.len()`.
#[inline]
pub fn strlen(buf: &[u8]) -> usize {
    match buf.iter().position(|&b| b == 0) {
        Some(i) => i,
        None => buf.len(),
    }
}

/// Reproduction fidèle de l'algorithme SWAR MSVC (préfixe non aligné + blocs de 8).
///
/// `start` est l'offset logique du pointeur dans `buf` (pour reproduire la gestion
/// de l'alignement par rapport à une adresse). Renvoie la même valeur que [`strlen`]
/// sur `&buf[start..]`, mais en suivant pas-à-pas la mécanique d'origine. Fourni à
/// titre de documentation/équivalence ; [`strlen`] est l'API recommandée.
///
/// Suppose qu'un NUL existe dans `buf` au-delà de `start` (sinon renvoie la distance
/// jusqu'à la fin de `buf`).
pub fn strlen_swar(buf: &[u8], start: usize) -> usize {
    let mut i = start;
    // Préfixe non aligné : avance octet-par-octet jusqu'à i % 8 == 0.
    while i < buf.len() && (i & 7) != 0 {
        if buf[i] == 0 {
            return i - start;
        }
        i += 1;
    }
    // Blocs alignés de 8 octets, détection SWAR du zéro-octet.
    while i + 8 <= buf.len() {
        let mut x = 0u64;
        for k in 0..8 {
            x |= (buf[i + k] as u64) << (8 * k);
        }
        if ((!x ^ x.wrapping_add(SWAR_MAGIC)) & SWAR_HOLE) != 0 {
            // Un octet nul est présent dans ce bloc : localise le premier.
            for k in 0..8 {
                if buf[i + k] == 0 {
                    return (i + k) - start;
                }
            }
        }
        i += 8;
    }
    // Queue (< 8 octets) ou pas de NUL : balayage simple.
    while i < buf.len() {
        if buf[i] == 0 {
            return i - start;
        }
        i += 1;
    }
    buf.len() - start
}

#[cfg(test)]
mod tests {
    use super::*;

    // Goldens capturés via l'oracle uemu (scripts/validate_strlen.py).
    #[test]
    fn golden_basic() {
        assert_eq!(strlen(b"\0"), 0);
        assert_eq!(strlen(b"a\0"), 1);
        assert_eq!(strlen(b"hello\0"), 5);
        assert_eq!(strlen(b"0123456789\0"), 10); // > 1 bloc SWAR + queue
    }

    #[test]
    fn golden_blocks() {
        // Longueur multiple de 8 et juste au-dessus (frontière de bloc SWAR).
        let s8 = b"ABCDEFGH\0";
        assert_eq!(strlen(s8), 8);
        let s17 = b"ABCDEFGHIJKLMNOPQ\0";
        assert_eq!(strlen(s17), 17);
    }

    #[test]
    fn golden_stress_bytes() {
        // Octets 0xFE/0xFF/0x01 qui stressent l'arithmétique SWAR (carries).
        let mut v = vec![0xFFu8; 13];
        v.extend_from_slice(&[0x01, 0xFE, 0xFF]);
        v.push(0);
        assert_eq!(strlen(&v), 16);
    }

    #[test]
    fn swar_matches_simple() {
        // Équivalence des deux implémentations sur des entrées variées + alignements.
        for len in 0..200usize {
            for off in 0..8usize {
                let mut v = vec![0u8; off];
                v.extend(std::iter::repeat_n(0xAB, len));
                v.push(0);
                v.extend_from_slice(&[0xCD; 8]);
                assert_eq!(strlen_swar(&v, off), len, "len={len} off={off}");
                assert_eq!(strlen(&v[off..]), len, "len={len} off={off}");
            }
        }
    }
}
