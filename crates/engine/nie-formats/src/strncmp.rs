//! Port byte-exact de `FUN_14168b330` de `nie_eacpatched.exe`.
//!
//! Fonction de bibliothèque MSVC 2019 identifiée : `strncmp`.
//! Signature C : `int __cdecl strncmp(const char* s1, const char* s2, size_t count)`.
//! ABI x64 : `rcx`=s1, `rdx`=s2, `r8`=count ; retour `int` dans `eax`.
//!
//! Sémantique : compare au plus `count` octets de `s1` et `s2`, interprétés comme
//! des octets NON signés (`u8`). S'arrête au premier octet différent (renvoie
//! `-1` si `s1[i] < s2[i]`, sinon `1`) ou à un octet nul commun (renvoie `0`).
//! Si les `count` premiers octets sont égaux, renvoie `0`. `count == 0` → `0`.
//! Le retour est exactement `{-1, 0, 1}` (le binaire fait `sbb/or`, pas la
//! différence d'octets) — c'est le contrat MSVC, pas le contrat ISO C.
//!
//! L'original utilise un chemin SSE « word-at-a-time » (lecture de 8 octets,
//! détection de zéro par `(~x & (x - 0x0101…01) & 0x8080…80)`) avec garde de
//! franchissement de page (`page_offset(s2) <= 0xff8`). Ces optimisations ne
//! changent pas le résultat : ce port reproduit la sémantique octet par octet,
//! qui est bit-pour-bit identique à la sortie de la fonction.
//!
//! Validation : `scripts/validate_strncmp.py` — oracle uemu (exécution du vrai
//! code à `0x14168B330`) vs ce miroir, 908/908 cas concordants (fuzz LCG seedé
//! couvrant count=0, égalité, diff avant/après null, null commun, tous les
//! alignements de s1, bord octet non signé 0xff/0x01).
//!
//! Contrat : `s1` et `s2` doivent contenir au moins `count` octets lisibles
//! (comme la version C, qui suppose des tampons valides). En pratique la
//! comparaison s'arrête tôt sur un nul ou une différence.

/// `strncmp` byte-exact (équivalent MSVC de `FUN_14168b330`).
///
/// Renvoie `-1`, `0` ou `1`. Voir la doc du module pour la sémantique exacte.
///
/// # Panics
/// Indexe `s1[i]`/`s2[i]` pour `i < count` ; les deux tranches doivent donc
/// avoir une longueur `>= count`.
#[must_use]
pub fn strncmp(s1: &[u8], s2: &[u8], count: usize) -> i32 {
    let mut i = 0;
    while i < count {
        let c1 = s1[i];
        let c2 = s2[i];
        if c1 != c2 {
            return if c1 < c2 { -1 } else { 1 };
        }
        if c1 == 0 {
            return 0;
        }
        i += 1;
    }
    0
}

#[cfg(test)]
mod tests {
    use super::strncmp;

    #[test]
    fn count_zero_est_egal() {
        // count=0 → 0 quel que soit le contenu (chemin `test r8,r8; je`).
        assert_eq!(strncmp(b"\xffabc", b"\x00xyz", 0), 0);
    }

    #[test]
    fn egaux_avec_null_court_circuite() {
        // "abc\0" == "abc\0" sur count=10 : le nul commun renvoie 0 avant la fin.
        assert_eq!(strncmp(b"abc\0\0\0\0\0\0\0", b"abc\0\0\0\0\0\0\0", 10), 0);
    }

    #[test]
    fn difference_dans_le_count() {
        // 'c'(0x63) < 'd'(0x64) → -1 ; ordre inverse → 1.
        assert_eq!(strncmp(b"abc\0", b"abd\0", 10), -1);
        assert_eq!(strncmp(b"abd\0", b"abc\0", 10), 1);
    }

    #[test]
    fn difference_hors_du_count() {
        // count=2 ne compare que "ab" → 0 malgré le 3e octet différent.
        assert_eq!(strncmp(b"abc\0", b"abd\0", 2), 0);
    }

    #[test]
    fn octets_non_signes() {
        // 0xff > 0x01 en NON signé → 1 (et -1 dans l'autre sens).
        assert_eq!(strncmp(b"\xffaaaa", b"\x01aaaa", 5), 1);
        assert_eq!(strncmp(b"\x01aaaa", b"\xffaaaa", 5), -1);
    }
}
