//! CRILAYLA — magic + (à venir) décompression complète.
//!
//! Port de `FUN_14066371c` (Ghidra `crilayla_decompress.c`, `0x14066371c`) : le helper
//! natif vérifie le préfixe `"CRILAYLA"` et renvoie 1/0. La décompression complète (LZ
//! à bitstream inversé, header 16 octets `uncompressed_size`/`header_offset`) est portée
//! depuis le décodeur iecode (`CriFs/CriLayla.cs`) dans une passe ultérieure de la boucle.

/// Préfixe magic CRILAYLA (8 octets ASCII).
pub const MAGIC: &[u8; 8] = b"CRILAYLA";

/// Vrai si `buf` commence par le magic CRILAYLA (faux si plus court que 8 octets).
#[must_use]
pub fn has_magic(buf: &[u8]) -> bool {
    buf.starts_with(MAGIC)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn magic_detection() {
        assert!(has_magic(b"CRILAYLA"));
        assert!(has_magic(b"CRILAYLA\x00\x01\x02\x03"));
        assert!(!has_magic(b"CRILAYL"));
        assert!(!has_magic(b""));
        assert!(!has_magic(b"crilayla"));
    }
}
