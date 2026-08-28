//! Parseur **G4CM** — données de **caméra** Level-5 (`.g4cm`), cutscenes/événements
//! (`common/event/**/ev*_camera.g4cm`).
//!
//! En-tête commun Level-5 (cf. [`crate::level5`]), **reversé + validé byte sur 1210 `.g4cm` réels**
//! du VFS : magic `G4CM` 1210/1210 + invariant `header_size + data_size == file_size` 1210/1210
//! (`header_size`=0x40, `type_id`=0x68, `align`=16 constants). Une table de descripteurs de canaux
//! caméra suit à 0x20 (sémantique non confirmée, pas de réf iecode) → non interprétée. Les keyframes
//! caméra ne sont pas décodées faute de vérité terrain.

use crate::level5::{self, Level5Header};
use crate::FormatError;

/// Magic « G4CM » en little-endian.
const MAGIC: u32 = 0x4D43_3447;
/// Taille de l'en-tête fixe Level-5 pour ce format.
const HEADER_LEN: usize = 0x40;

/// Fichier G4CM parsé : en-tête commun + taille fichier.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct G4cm {
    pub header: Level5Header,
    pub file_size: usize,
}

impl G4cm {
    /// Invariant structurel : `header_size + data_size == file_size`.
    #[must_use]
    pub fn is_size_consistent(&self) -> bool {
        self.header.is_size_consistent(self.file_size)
    }
}

/// `true` si les 4 premiers octets sont le magic « G4CM ».
#[must_use]
pub fn is_g4cm(data: &[u8]) -> bool {
    level5::read_u32_le(data, 0).is_ok_and(|m| m == MAGIC)
}

/// Parse l'en-tête d'un `.g4cm` (données caméra non interprétées).
///
/// # Errors
/// [`FormatError::TooShort`] si < 0x40 octets, [`FormatError::BadMagic`] si le magic ≠ « G4CM ».
pub fn parse(data: &[u8]) -> Result<G4cm, FormatError> {
    if data.len() < HEADER_LEN {
        return Err(FormatError::TooShort { got: data.len(), need: HEADER_LEN });
    }
    let header = level5::parse_header(data, MAGIC, "G4CM")?;
    Ok(G4cm { header, file_size: data.len() })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_synthetique() {
        let mut buf = [0u8; HEADER_LEN];
        buf[0..4].copy_from_slice(b"G4CM");
        buf[4..6].copy_from_slice(&0x0040u16.to_le_bytes());
        buf[6..8].copy_from_slice(&0x0068u16.to_le_bytes());
        buf[10..12].copy_from_slice(&0x0010u16.to_le_bytes());
        buf[12..16].copy_from_slice(&0u32.to_le_bytes()); // 0x40 + 0 == 0x40 = file
        let g = parse(&buf).expect("parse");
        assert_eq!(g.header.magic, MAGIC);
        assert_eq!(g.header.header_size, 0x40);
        assert_eq!(g.header.type_id, 0x68);
        assert_eq!(g.header.align, 0x10);
        assert!(g.is_size_consistent());
    }

    #[test]
    fn rejette_magic_et_court() {
        assert!(matches!(parse(&[0u8; HEADER_LEN]), Err(FormatError::BadMagic { .. })));
        assert!(matches!(parse(b"G4CM"), Err(FormatError::TooShort { .. })));
        assert!(is_g4cm(b"G4CM____"));
        assert!(!is_g4cm(b"NAVM"));
    }

    /// Golden sur de VRAIS `.g4cm` du VFS (caméras d'événement).
    #[cfg(feature = "real-fixtures")]
    #[test]
    fn golden_g4cm_reels() {
        for (bytes, size) in [
            (include_bytes!("../tests/fixtures/g4cm/ev63_00010_camera.g4cm").as_slice(), 10752usize),
            (include_bytes!("../tests/fixtures/g4cm/ev74_01170_camera.g4cm").as_slice(), 1472usize),
        ] {
            let g = parse(bytes).expect("g4cm réel");
            assert_eq!(&g.header.magic.to_le_bytes(), b"G4CM");
            assert_eq!(g.header.header_size, 64);
            assert_eq!(g.header.type_id, 0x68);
            assert_eq!(g.header.align, 16);
            assert_eq!(g.file_size, size);
            assert!(g.is_size_consistent());
        }
    }
}
