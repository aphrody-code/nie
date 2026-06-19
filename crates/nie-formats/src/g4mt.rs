//! Parseur **G4MT** — données de **matériaux / motion** Level-5 (`.g4mt`), présentes en standalone
//! (`common/chr/**/*.g4mt`, `common/event/**/*.g4mt`) et comme sous-table des archives `.g4pk`.
//!
//! En-tête commun Level-5 (cf. [`crate::level5`]), **validé byte sur 63 `.g4mt` réels** du VFS :
//! magic `G4MT` 63/63 + invariant `header_size + data_size == file_size` 63/63 (`header_size`=0x40,
//! `type_id`=0x68, `align`=16). Le corps (paramètres de matériau / pistes de motion) n'est pas
//! décodé faute de vérité terrain (pas de parseur iecode standalone) — en-tête byte-exact seulement.

use crate::level5::{self, Level5Header};
use crate::FormatError;

/// Magic « G4MT » en little-endian.
const MAGIC: u32 = 0x544D_3447;
/// Taille de l'en-tête fixe Level-5 pour ce format.
const HEADER_LEN: usize = 0x40;

/// Fichier G4MT parsé : en-tête commun + taille fichier.
#[derive(Debug, Clone)]
pub struct G4mt {
    pub header: Level5Header,
    pub file_size: usize,
}

impl G4mt {
    /// Invariant structurel : `header_size + data_size == file_size`.
    #[must_use]
    pub fn is_size_consistent(&self) -> bool {
        self.header.is_size_consistent(self.file_size)
    }
}

/// `true` si les 4 premiers octets sont le magic « G4MT ».
#[must_use]
pub fn is_g4mt(data: &[u8]) -> bool {
    level5::read_u32_le(data, 0).is_ok_and(|m| m == MAGIC)
}

/// Parse l'en-tête d'un `.g4mt` (corps non interprété).
///
/// # Errors
/// [`FormatError::TooShort`] si < 0x40 octets, [`FormatError::BadMagic`] si le magic ≠ « G4MT ».
pub fn parse(data: &[u8]) -> Result<G4mt, FormatError> {
    if data.len() < HEADER_LEN {
        return Err(FormatError::TooShort { got: data.len(), need: HEADER_LEN });
    }
    let header = level5::parse_header(data, MAGIC, "G4MT")?;
    Ok(G4mt { header, file_size: data.len() })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_synthetique() {
        let mut buf = [0u8; HEADER_LEN];
        buf[0..4].copy_from_slice(b"G4MT");
        buf[4..6].copy_from_slice(&0x0040u16.to_le_bytes());
        buf[6..8].copy_from_slice(&0x0068u16.to_le_bytes());
        buf[10..12].copy_from_slice(&0x0010u16.to_le_bytes());
        buf[12..16].copy_from_slice(&0u32.to_le_bytes());
        let g = parse(&buf).expect("parse");
        assert_eq!(g.header.magic, MAGIC);
        assert_eq!(g.header.header_size, 0x40);
        assert_eq!(g.header.type_id, 0x68);
        assert!(g.is_size_consistent());
    }

    #[test]
    fn rejette_magic_et_court() {
        assert!(matches!(parse(&[0u8; HEADER_LEN]), Err(FormatError::BadMagic { .. })));
        assert!(matches!(parse(b"G4MT"), Err(FormatError::TooShort { .. })));
        assert!(is_g4mt(b"G4MT____"));
        assert!(!is_g4mt(b"G4CM"));
    }

    /// Golden sur de VRAIS `.g4mt` du VFS (matériaux chr / motion d'événement).
    #[cfg(feature = "real-fixtures")]
    #[test]
    fn golden_g4mt_reels() {
        for (bytes, size) in [
            (include_bytes!("../tests/fixtures/g4mt/small.g4mt").as_slice(), 2176usize),
            (include_bytes!("../tests/fixtures/g4mt/med.g4mt").as_slice(), 41280usize),
        ] {
            let g = parse(bytes).expect("g4mt réel");
            assert_eq!(&g.header.magic.to_le_bytes(), b"G4MT");
            assert_eq!(g.header.header_size, 64);
            assert_eq!(g.header.type_id, 0x68);
            assert_eq!(g.file_size, size);
            assert!(g.is_size_consistent());
        }
    }
}
