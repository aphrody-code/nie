//! Parseur **G4MA** — **animation de matériau** Level-5 (`.g4ma`).
//!
//! Présent en standalone (35 fichiers au VFS) et de manière massive comme sous-fichiers
//! au sein des archives d'événements et de techniques `.g4pk` (`common/event/**/*.g4pk`),
//! où il accompagne systématiquement le fichier de squelette animé [`crate::g4mt`].
//!
//! ## Architecture commune Level-5 Graphics 4 Animation Container
//!
//! Le format G4MA partage **exactement la même architecture binaire** que [`crate::g4mt`]`::Motion` :
//! - En-tête fixe Level-5 (magic `G4MA` = `0x414D3447`, `header_size` = 0x40, `type_id` = 0x68).
//! - Table de décalages / sections `@0x20..0x37` : `clip_count`, `target_count`, `target_info_units`,
//!   `channel_units`, `section_units[6]`, `offset_shift`.
//! - Clips d'animation (nom, plage de frames, FPS=60, hash CRC32 du clip).
//! - Cibles (hash CRC32 du matériau ou du sous-objet).
//! - Canaux de propriétés (couleur RGBA, composante alpha, coordonnées UV, émission).
//! - Tables de clés (keyframes temporelles) et données interpolées (LERP/STEP).
//!
//! Grâce à cette unicité d'architecture, [`parse`] décode à la fois l'en-tête Level-5 et les
//! pistes d'animation structurelles via le moteur partagé [`crate::g4mt::Motion`].

extern crate alloc;

use crate::FormatError;
use crate::g4mt::{Clip, Motion};
use crate::level5::{self, Level5Header};

/// Magic « G4MA » en little-endian (`0x414D3447`).
pub const MAGIC: u32 = 0x414D_3447;
/// Taille de l'en-tête fixe Level-5 pour ce format (0x40 = 64 octets).
pub const HEADER_LEN: usize = 0x40;

/// Fichier G4MA parsé : en-tête commun + taille fichier + animation structurelle facultative.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct G4ma {
    /// En-tête Level-5 normalisé.
    pub header: Level5Header,
    /// Taille brute du fichier en octets.
    pub file_size: usize,
    /// Structure d'animation décodée (clips, cibles, canaux).
    pub motion: Option<Motion>,
}

impl G4ma {
    /// Invariant structurel : `header_size + data_size == file_size`.
    #[must_use]
    pub fn is_size_consistent(&self) -> bool {
        self.header.is_size_consistent(self.file_size)
    }

    /// Indique si les pistes d'animation ont pu être décodées structurellement.
    #[must_use]
    pub fn is_animated(&self) -> bool {
        self.motion.is_some()
    }

    /// Liste des clips d'animation définis dans ce conteneur de matériau.
    #[must_use]
    pub fn clips(&self) -> Option<&[Clip]> {
        self.motion.as_ref().map(|m| m.clips.as_slice())
    }

    /// Liste des hash CRC32 des cibles (matériaux / paramètres).
    #[must_use]
    pub fn target_hashes(&self) -> Option<&[u32]> {
        self.motion.as_ref().map(|m| m.target_hashes.as_slice())
    }

    /// Recherche un clip par son nom exact.
    #[must_use]
    pub fn find_clip_by_name(&self, name: &str) -> Option<&Clip> {
        self.motion.as_ref().and_then(|m| m.find_clip_by_name(name))
    }

    /// Recherche un clip par son hash CRC32.
    #[must_use]
    pub fn find_clip_by_hash(&self, crc32: u32) -> Option<&Clip> {
        self.motion
            .as_ref()
            .and_then(|m| m.find_clip_by_hash(crc32))
    }
}

/// `true` si les 4 premiers octets sont le magic « G4MA ».
#[must_use]
pub fn is_g4ma(data: &[u8]) -> bool {
    level5::read_u32_le(data, 0).is_ok_and(|m| m == MAGIC)
}

/// Parse le corps d'un fichier `.g4ma` en tant qu'animation structurelle [`Motion`].
#[must_use]
pub fn parse_motion(data: &[u8]) -> Option<Motion> {
    if !is_g4ma(data) {
        return None;
    }
    Motion::parse(data)
}

/// Parse un fichier `.g4ma` : en-tête Level-5 garanti et décodage structurel de l'animation.
///
/// # Errors
/// [`FormatError::TooShort`] si < 0x40 octets, [`FormatError::BadMagic`] si le magic ≠ « G4MA ».
pub fn parse(data: &[u8]) -> Result<G4ma, FormatError> {
    if data.len() < HEADER_LEN {
        return Err(FormatError::TooShort {
            got: data.len(),
            need: HEADER_LEN,
        });
    }
    let header = level5::parse_header(data, MAGIC, "G4MA")?;
    let motion = Motion::parse(data);
    Ok(G4ma {
        header,
        file_size: data.len(),
        motion,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_synthetique_entete() {
        let mut buf = [0u8; HEADER_LEN];
        buf[0..4].copy_from_slice(b"G4MA");
        buf[4..6].copy_from_slice(&0x0040u16.to_le_bytes());
        buf[6..8].copy_from_slice(&0x0068u16.to_le_bytes());
        buf[12..16].copy_from_slice(&0u32.to_le_bytes());
        let g = parse(&buf).expect("parse");
        assert_eq!(g.header.magic, MAGIC);
        assert_eq!(g.header.header_size, 0x40);
        assert_eq!(g.header.type_id, 0x68);
        assert!(g.is_size_consistent());
        assert!(!g.is_animated());
        assert!(g.clips().is_none());
        assert!(g.target_hashes().is_none());
    }

    #[test]
    fn rejette_magic_et_court() {
        assert!(matches!(
            parse(&[0u8; HEADER_LEN]),
            Err(FormatError::BadMagic { .. })
        ));
        assert!(matches!(parse(b"G4MA"), Err(FormatError::TooShort { .. })));
        assert!(is_g4ma(b"G4MA____"));
        assert!(!is_g4ma(b"G4MT"));
        assert!(parse_motion(b"G4MT____").is_none());
    }

    #[test]
    fn parse_synthetique_avec_motion() {
        const HEADER_WORDS: u16 = 16;
        const OFF_TARGET_INFO: usize = 0x50;
        const OFF_CHANNEL: usize = 0x58;
        const OFF_CLIP_HASH: usize = 0x70;
        const OFF_TARGET_HASH: usize = 0x74;
        const OFF_CLIP_NAMES: usize = 0x78;
        const OFF_KEYS: usize = 0x84;
        const OFF_DATA: usize = 0x90;

        let mut buf = alloc::vec![0u8; OFF_DATA + 16];
        buf[0..4].copy_from_slice(b"G4MA");
        buf[4..6].copy_from_slice(&0x40u16.to_le_bytes()); // header_size
        buf[6..8].copy_from_slice(&0x68u16.to_le_bytes()); // type_id
        buf[10..12].copy_from_slice(&HEADER_WORDS.to_le_bytes());
        let data_size = (buf.len() - 0x40) as u32;
        buf[12..16].copy_from_slice(&data_size.to_le_bytes());
        buf[0x20..0x22].copy_from_slice(&1u16.to_le_bytes()); // clip_count
        buf[0x22..0x24].copy_from_slice(&1u16.to_le_bytes()); // target_count
        let units = |off: usize| -> u16 { (off / 4 - HEADER_WORDS as usize) as u16 };
        buf[0x24..0x26].copy_from_slice(&units(OFF_TARGET_INFO).to_le_bytes());
        buf[0x26..0x28].copy_from_slice(&units(OFF_CHANNEL).to_le_bytes());
        buf[0x28..0x2A].copy_from_slice(&units(OFF_CLIP_HASH).to_le_bytes()); // scale (vide)
        buf[0x2A..0x2C].copy_from_slice(&units(OFF_CLIP_HASH).to_le_bytes());
        buf[0x2C..0x2E].copy_from_slice(&units(OFF_TARGET_HASH).to_le_bytes());
        buf[0x2E..0x30].copy_from_slice(&units(OFF_CLIP_NAMES).to_le_bytes());
        buf[0x30..0x32].copy_from_slice(&units(OFF_KEYS).to_le_bytes());
        buf[0x32..0x34].copy_from_slice(&units(OFF_DATA).to_le_bytes());
        buf[0x36] = 0; // offset_shift

        // clip row @0x40 : start=0 end=60 ti_start=0 ti_count=1 flags=0 fps=60.
        buf[0x40..0x42].copy_from_slice(&0u16.to_le_bytes());
        buf[0x42..0x44].copy_from_slice(&60u16.to_le_bytes());
        buf[0x44..0x46].copy_from_slice(&0u16.to_le_bytes());
        buf[0x46..0x48].copy_from_slice(&1u16.to_le_bytes());
        buf[0x48] = 0;
        buf[0x49] = 60;

        let expected_hash = 0x1234_5678u32;
        buf[OFF_CLIP_HASH..OFF_CLIP_HASH + 4].copy_from_slice(&expected_hash.to_le_bytes());
        let target_hash = crate::cfgbin::crc32(b"mat0");
        buf[OFF_TARGET_HASH..OFF_TARGET_HASH + 4].copy_from_slice(&target_hash.to_le_bytes());

        // Table de noms de clip : offset[0]=2 (relatif à OFF_CLIP_NAMES) → cstr "mat0".
        buf[OFF_CLIP_NAMES..OFF_CLIP_NAMES + 2].copy_from_slice(&2u16.to_le_bytes());
        buf[OFF_CLIP_NAMES + 2..OFF_CLIP_NAMES + 7].copy_from_slice(b"mat0\0");

        // target_info @OFF_TARGET_INFO
        buf[OFF_TARGET_INFO..OFF_TARGET_INFO + 2].copy_from_slice(&0u16.to_le_bytes());
        buf[OFF_TARGET_INFO + 2..OFF_TARGET_INFO + 4].copy_from_slice(&0u16.to_le_bytes());
        buf[OFF_TARGET_INFO + 4] = 1;
        buf[OFF_TARGET_INFO + 5] = 0;

        // channel @OFF_CHANNEL
        buf[OFF_CHANNEL..OFF_CHANNEL + 8].copy_from_slice(&[1, 0, 1, 4, 1, 4, 0, 0]);
        buf[OFF_CHANNEL + 8..OFF_CHANNEL + 12].copy_from_slice(&0u32.to_le_bytes());
        buf[OFF_CHANNEL + 12..OFF_CHANNEL + 16].copy_from_slice(&0u32.to_le_bytes());
        buf[OFF_CHANNEL + 16..OFF_CHANNEL + 20].copy_from_slice(&2u32.to_le_bytes());

        // keys @OFF_KEYS
        buf[OFF_KEYS..OFF_KEYS + 2].copy_from_slice(&0u16.to_le_bytes());
        buf[OFF_KEYS + 2..OFF_KEYS + 4].copy_from_slice(&60u16.to_le_bytes());

        // data @OFF_DATA
        buf[OFF_DATA..OFF_DATA + 4].copy_from_slice(&1.5f32.to_le_bytes());
        buf[OFF_DATA + 4..OFF_DATA + 8].copy_from_slice(&2.5f32.to_le_bytes());

        let g = parse(&buf).expect("parse g4ma avec motion");
        assert!(g.is_size_consistent());
        assert!(g.is_animated());
        assert_eq!(g.clips().unwrap().len(), 1);
        assert_eq!(g.target_hashes().unwrap(), &[target_hash]);

        let clip = g.find_clip_by_name("mat0").expect("clip trouvé par nom");
        assert_eq!(clip.crc32, expected_hash);
        assert_eq!(clip.frame_count(), 61);
        assert_eq!(clip.fps, 60);

        let clip_by_hash = g
            .find_clip_by_hash(expected_hash)
            .expect("clip trouvé par hash");
        assert_eq!(clip_by_hash.name, "mat0");
    }

    /// Golden sur de VRAIS `.g4ma` du VFS (anims de matériau).
    #[cfg(feature = "real-fixtures")]
    #[test]
    fn golden_g4ma_reels() {
        for bytes in [
            include_bytes!("../tests/fixtures/g4ma/f0.g4ma").as_slice(),
            include_bytes!("../tests/fixtures/g4ma/f1.g4ma").as_slice(),
        ] {
            let g = parse(bytes).expect("g4ma réel");
            assert_eq!(&g.header.magic.to_le_bytes(), b"G4MA");
            assert_eq!(g.header.header_size, 64);
            assert_eq!(g.header.type_id, 0x68);
            assert!(g.is_size_consistent());
        }
    }
}
