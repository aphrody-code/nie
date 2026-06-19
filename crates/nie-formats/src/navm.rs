//! Parseur **G4NV** — maillage de navigation (navmesh) Level-5, extension `.g4nv`.
//!
//! Le magic réel n'est pas « G4NV » mais **« NAVM »** (`0x4D56414E` LE). En-tête commun Level-5
//! (cf. [`crate::level5`]) suivi d'une table de **comptes de sections** (5 × u32 @ 0x20).
//! Porté de iecode `NavmParser.cs`, **validé byte sur 156 `.g4nv` réels** du VFS : magic NAVM
//! 156/156 + invariant `header_size + data_size == file_size` 156/156 (`s82g001` =
//! `{120,102,30,40,51}` = la réf iecode s28g001b).
//!
//! La **sémantique** de chaque section n'est pas confirmée (iecode ne l'expose pas) → on lit
//! l'en-tête + les comptes, byte-exacts, sans fabriquer de données.

use crate::level5::{self, Level5Header};
use crate::FormatError;

/// Magic « NAVM » en little-endian.
const MAGIC: u32 = 0x4D56_414E;
/// Nombre de comptes de sections lus à `0x20`.
pub const SECTION_COUNT: usize = 5;
/// Longueur minimale : en-tête (0x20) + table de sections (5 × u32).
const MIN_LEN: usize = 0x20 + SECTION_COUNT * 4;

/// Fichier G4NV parsé : en-tête commun + comptes de sections + taille fichier.
#[derive(Debug, Clone)]
pub struct Navm {
    pub header: Level5Header,
    pub section_counts: [u32; SECTION_COUNT],
    pub file_size: usize,
}

impl Navm {
    /// Invariant structurel : `header_size + data_size == file_size`.
    #[must_use]
    pub fn is_size_consistent(&self) -> bool {
        self.header.is_size_consistent(self.file_size)
    }

    /// Compte de la section d'index `i` (0 si hors borne).
    #[must_use]
    pub fn section_count(&self, i: usize) -> u32 {
        self.section_counts.get(i).copied().unwrap_or(0)
    }
}

/// `true` si les 4 premiers octets sont le magic « NAVM ».
#[must_use]
pub fn is_navm(data: &[u8]) -> bool {
    level5::read_u32_le(data, 0).is_ok_and(|m| m == MAGIC)
}

/// Parse l'en-tête + les comptes de sections d'un `.g4nv` (données non interprétées).
///
/// # Errors
/// [`FormatError::TooShort`] si < 0x34 octets, [`FormatError::BadMagic`] si le magic ≠ « NAVM ».
pub fn parse(data: &[u8]) -> Result<Navm, FormatError> {
    if data.len() < MIN_LEN {
        return Err(FormatError::TooShort { got: data.len(), need: MIN_LEN });
    }
    let header = level5::parse_header(data, MAGIC, "G4NV")?;
    let mut section_counts = [0u32; SECTION_COUNT];
    for (i, c) in section_counts.iter_mut().enumerate() {
        *c = level5::read_u32_le(data, 0x20 + i * 4)?;
    }
    Ok(Navm { header, section_counts, file_size: data.len() })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_synthetique() {
        // header_size=0x60, data_size=0x40 → invariant 0x60+0x40==0xA0=file_size.
        let mut buf = [0u8; 0xA0];
        buf[0..4].copy_from_slice(b"NAVM");
        buf[4..6].copy_from_slice(&0x0060u16.to_le_bytes());
        buf[6..8].copy_from_slice(&0x0066u16.to_le_bytes());
        buf[10..12].copy_from_slice(&0x0018u16.to_le_bytes());
        buf[12..16].copy_from_slice(&0x40u32.to_le_bytes());
        for i in 0..SECTION_COUNT {
            let v = ((i as u32) + 1) * 10;
            buf[0x20 + i * 4..0x20 + i * 4 + 4].copy_from_slice(&v.to_le_bytes());
        }
        let n = parse(&buf).expect("parse");
        assert_eq!(n.header.magic, MAGIC);
        assert_eq!(n.header.header_size, 0x60);
        assert_eq!(n.header.type_id, 0x66);
        assert_eq!(n.header.align, 0x18);
        assert!(n.is_size_consistent());
        assert_eq!(n.section_counts, [10, 20, 30, 40, 50]);
        assert_eq!(n.section_count(4), 50);
        assert_eq!(n.section_count(9), 0);
    }

    #[test]
    fn rejette_magic_et_court() {
        assert!(matches!(parse(&[0u8; 0x40]), Err(FormatError::BadMagic { .. })));
        assert!(matches!(parse(b"NAVM"), Err(FormatError::TooShort { .. })));
        assert!(!is_navm(b"G4SK"));
        assert!(is_navm(b"NAVM____"));
    }

    /// Golden sur de VRAIS `.g4nv` du VFS (s82g001 = 4640 o = réf iecode s28g001b ; w10g030).
    #[cfg(feature = "real-fixtures")]
    #[test]
    fn golden_g4nv_reels() {
        let s82: &[u8] = include_bytes!("../tests/fixtures/navm/s82g001.g4nv");
        let n = parse(s82).expect("s82g001");
        assert_eq!(&n.header.magic.to_le_bytes(), b"NAVM");
        assert_eq!(n.header.header_size, 96);
        assert_eq!(n.header.type_id, 0x66);
        assert_eq!(n.header.align, 24);
        assert_eq!(n.file_size, 4640);
        assert!(n.is_size_consistent());
        assert_eq!(n.section_counts, [120, 102, 30, 40, 51]);

        let w10: &[u8] = include_bytes!("../tests/fixtures/navm/w10g030.g4nv");
        let m = parse(w10).expect("w10g030");
        assert_eq!(m.file_size, 13664);
        assert!(m.is_size_consistent());
        assert_eq!(m.section_counts, [351, 310, 93, 117, 149]);
    }
}
