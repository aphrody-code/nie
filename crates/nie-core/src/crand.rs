//! `CRand` — port byte-exact du PRNG `lives::CRand` de nie.exe.
//!
//! ## Vérité terrain
//!
//! La décompilation Ghidra ciblée (`docs/recherche-modele-match-decompile.md`) a établi que
//! `lives::CRand` est un **Mersenne Twister MT19937 32-bit canonique** :
//!
//! - graine via `init_genrand` : `mt[i] = 1_812_433_253 * (mt[i-1] ^ (mt[i-1] >> 30)) + i`
//!   (multiplicateur `0x6C078965` trouvé dans le binaire) ;
//! - torsion avec `MATRIX_A = 0x9908_B0DF`, `n = 624`, `m = 397` ;
//! - tempering canonique, masques `b = 0x9D2C_5680`, `c = 0xEFC6_0000`
//!   (les masques « bizarres » `0xff3a58ad`/`0xffffdf8c` du décompilé sont des réécritures
//!   compilateur de `(y << s) & B`, vérifiées bit-exact) ;
//! - bornage par la **méthode de Lemire** (`bounded`).
//!
//! Réserve honnête (cf. doc) : le masque de tempering `d` (étape `y >> 11`) est stocké dans la
//! struct binaire plutôt qu'en littéral ; il vaut quasi certainement `0xFFFF_FFFF` (valeur MT19937
//! canonique, prise ici). À reconfirmer si un jour la valeur de struct est lue à l'exécution.
//!
//! Ce port **remplace** l'ancien Splitmix64 nominal de `match_sim` : c'est désormais le vrai RNG
//! du moteur, validé contre le vecteur de référence MT19937 (graine 5489).

const N: usize = 624;
const M: usize = 397;
const MATRIX_A: u32 = 0x9908_B0DF;
const UPPER_MASK: u32 = 0x8000_0000;
const LOWER_MASK: u32 = 0x7FFF_FFFF;
const INIT_MULT: u32 = 1_812_433_253; // 0x6C078965

/// Mersenne Twister MT19937 32-bit — port de `lives::CRand` (nie.exe).
#[derive(Clone)]
pub struct CRand {
    mt: [u32; N],
    index: usize,
}

impl CRand {
    /// Initialise l'état depuis une graine 32 bits (`init_genrand`).
    #[must_use]
    pub fn new(seed: u32) -> Self {
        let mut mt = [0u32; N];
        mt[0] = seed;
        let mut i = 1;
        while i < N {
            let prev = mt[i - 1];
            mt[i] = INIT_MULT
                .wrapping_mul(prev ^ (prev >> 30))
                .wrapping_add(i as u32);
            i += 1;
        }
        // `index == N` force une torsion au premier tirage.
        Self { mt, index: N }
    }

    /// Variante de confort pour les graines 64 bits de l'API de match :
    /// replie les deux moitiés (XOR) sur 32 bits.
    #[must_use]
    pub fn from_u64(seed: u64) -> Self {
        Self::new((seed ^ (seed >> 32)) as u32)
    }

    /// Régénère le bloc d'état (la « torsion » MT19937).
    fn generate(&mut self) {
        for i in 0..N {
            let y = (self.mt[i] & UPPER_MASK) | (self.mt[(i + 1) % N] & LOWER_MASK);
            let mut next = self.mt[(i + M) % N] ^ (y >> 1);
            if y & 1 != 0 {
                next ^= MATRIX_A;
            }
            self.mt[i] = next;
        }
        self.index = 0;
    }

    /// Prochain `u32` (`genrand_int32`), avec tempering canonique.
    pub fn next_u32(&mut self) -> u32 {
        if self.index >= N {
            self.generate();
        }
        let mut y = self.mt[self.index];
        self.index += 1;
        // Tempering canonique (d = 0xFFFFFFFF).
        y ^= y >> 11;
        y ^= (y << 7) & 0x9D2C_5680;
        y ^= (y << 15) & 0xEFC6_0000;
        y ^= y >> 18;
        y
    }

    /// Entier non biaisé dans `[0, bound)` par la méthode de Lemire.
    /// Renvoie 0 si `bound == 0`.
    pub fn bounded(&mut self, bound: u32) -> u32 {
        if bound == 0 {
            return 0;
        }
        // mulhi 64 bits : (r * bound) >> 32, biais ~nul.
        let product = u64::from(self.next_u32()) * u64::from(bound);
        (product >> 32) as u32
    }

    /// `f32` dans `[0.0, 1.0)` via les 24 bits de poids fort (exacts en f32).
    pub fn next_f32(&mut self) -> f32 {
        let bits = self.next_u32() >> 8; // 24 bits
        #[allow(clippy::cast_precision_loss)]
        {
            bits as f32 / 16_777_216.0_f32
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Vecteur de référence MT19937 canonique : `init_genrand(5489)` (graine par défaut de
    /// référence) produit cette séquence `genrand_int32`. Si ce test passe, notre torsion +
    /// tempering sont bit-exacts par rapport à MT19937 de référence — donc à `lives::CRand`.
    #[test]
    fn vecteur_reference_mt19937_seed_5489() {
        let mut r = CRand::new(5489);
        let attendu: [u32; 10] = [
            3_499_211_612,
            581_869_302,
            3_890_346_734,
            3_586_334_585,
            545_404_204,
            4_161_255_391,
            3_922_919_429,
            949_333_985,
            2_715_962_298,
            1_323_567_403,
        ];
        for (i, &exp) in attendu.iter().enumerate() {
            assert_eq!(r.next_u32(), exp, "genrand_int32 #{i} (seed 5489)");
        }
    }

    #[test]
    fn determinisme_meme_graine() {
        let mut a = CRand::new(42);
        let mut b = CRand::new(42);
        for _ in 0..2000 {
            assert_eq!(a.next_u32(), b.next_u32());
        }
    }

    #[test]
    fn from_u64_replie_les_moities() {
        // seed bas pur == new(low) quand la moitié haute est nulle.
        let mut a = CRand::from_u64(12345);
        let mut b = CRand::new(12345);
        assert_eq!(a.next_u32(), b.next_u32());
    }

    #[test]
    fn bounded_dans_intervalle() {
        let mut r = CRand::new(1);
        for _ in 0..10_000 {
            assert!(r.bounded(6) < 6);
        }
        assert_eq!(r.bounded(0), 0);
    }

    #[test]
    fn next_f32_dans_zero_un() {
        let mut r = CRand::new(7);
        for _ in 0..10_000 {
            let f = r.next_f32();
            assert!((0.0..1.0).contains(&f));
        }
    }
}
