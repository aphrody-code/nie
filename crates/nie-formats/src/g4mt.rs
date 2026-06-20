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

// ============================================================================
// Décodage des PISTES D'ANIMATION SQUELETTIQUE du corps G4MT (spec workflow anim-re-crack,
// confiance moyenne ; les quaternions dé-quantifiés i16/32767 sont UNITAIRES = check validable).
// Corps = `data[0x40..]`. frame_count u16@corps+0x02 ; table de tracks @corps+0xA4 (8 o/track :
// u32, u16 bone_idx, u16) ; canaux marqués par `01 00 00 00 | u32 value_off | u32 key_count` dans
// [0x144, table_temps) ; descripteur 4 o avant le marqueur = [type, _, n_comp, stride] (type 0x09 =
// 4-vec/quaternion, 0x0a/0b/0c = scalaire tx/ty/tz ; stride 8 ou 2) ; table des temps @corps+0xD00
// (u32 count + count×i16) ; VALUE_BASE = align16(fin temps) ; data canal @ VALUE_BASE+value_off.
// ============================================================================

extern crate alloc;
use alloc::{string::String, vec::Vec};

/// Un canal d'animation : suite de samples (61 pour 60 frames, key0 = frame 0 implicite).
#[derive(Debug, Clone)]
pub struct AnimChannel {
    /// Type Level-5 : `0x09` = 4-vecteur (quaternion de rotation), `0x0a/0b/0c` = scalaire (tx/ty/tz).
    pub kind: u8,
    /// Pas en octets d'un sample (`8` = 4×i16, `2` = 1×i16).
    pub stride: u8,
    /// Décalage de la donnée du canal depuis `VALUE_BASE`.
    pub value_offset: u32,
    /// Samples dé-quantifiés (i16/32767). 4-vec → `[x,y,z,w]` ; scalaire → `[v,0,0,0]`.
    pub samples: Vec<[f32; 4]>,
}

impl AnimChannel {
    /// `true` si c'est un canal de rotation (4-vec type 0x09, stride 8).
    #[must_use]
    pub fn is_rotation(&self) -> bool {
        self.kind == 0x09 && self.stride == 8
    }
}

/// Animation squelettique décodée d'un G4MT.
#[derive(Debug, Clone)]
pub struct Animation {
    pub frame_count: u16,
    /// Nom du clip (ASCIIZ @corps+0x84), ex. `b_flt001wlk001l`.
    pub clip_name: String,
    /// Indices d'os (réfèrent le g4sk) de la table de tracks @corps+0xA4.
    pub bone_indices: Vec<u16>,
    /// Canaux dans l'ordre du fichier.
    pub channels: Vec<AnimChannel>,
}

fn ru16(d: &[u8], o: usize) -> u16 {
    u16::from_le_bytes([d[o], d[o + 1]])
}
fn ru32(d: &[u8], o: usize) -> u32 {
    u32::from_le_bytes([d[o], d[o + 1], d[o + 2], d[o + 3]])
}

/// Décode les pistes d'animation squelettique d'un corps G4MT. Renvoie `None` si la structure ne
/// correspond pas (offsets hors limites, pas de table de temps cohérente).
#[must_use]
#[allow(clippy::missing_panics_doc)]
pub fn parse_animation(data: &[u8]) -> Option<Animation> {
    const BODY: usize = 0x40;
    if data.len() < BODY + 0xD08 {
        return None;
    }
    let body = &data[BODY..];
    let frame_count = ru16(body, 0x02);
    let track_count = ru16(body, 0x06) as usize;

    // Nom de clip ASCIIZ @0x84.
    let name_start = 0x84;
    let mut name_end = name_start;
    while name_end < body.len() && body[name_end] != 0 {
        name_end += 1;
    }
    let clip_name = String::from_utf8_lossy(&body[name_start..name_end]).into_owned();

    // Table de tracks @0xA4 : 8 o/track {u32, u16 bone_idx, u16}.
    let mut bone_indices = Vec::new();
    for t in 0..track_count.min(64) {
        let o = 0xA4 + t * 8;
        if o + 8 > body.len() {
            break;
        }
        bone_indices.push(ru16(body, o + 4));
    }

    // Table des temps @0xD00 : u32 count + count×i16 ; VALUE_BASE = align16(fin).
    let times_off = 0xD00;
    let times_count = ru32(body, times_off) as usize;
    if times_count == 0 || times_count > 4096 {
        return None;
    }
    let times_end = times_off + 4 + times_count * 2;
    let value_base = times_end.div_ceil(16) * 16;

    // Scan des marqueurs de canaux `01 00 00 00` dans [0x144, times_off).
    let mut channels = Vec::new();
    let mut m = 0x144usize;
    while m + 12 <= times_off {
        if ru32(body, m) == 1 {
            let value_offset = ru32(body, m + 4);
            let key_count = ru32(body, m + 8) as usize;
            // Descripteur : (n_composantes, stride) aux octets m-4, m-3 (calé byte-à-byte sur le
            // réel : quaternion `04 08`, scalaire `01 02`). kind dérivé du stride.
            let (n_comp, stride) =
                if m >= 4 { (body[m - 4] as usize, body[m - 3]) } else { (0, 0) };
            let valid = (n_comp == 4 && stride == 8) || (n_comp == 1 && stride == 2);
            let kind = if stride == 8 { 0x09 } else { 0x0a };
            if valid && (2..=4096).contains(&key_count) {
                let base = value_base + value_offset as usize;
                if base + key_count * stride as usize <= body.len() {
                    let mut samples = Vec::with_capacity(key_count);
                    for k in 0..key_count {
                        let so = base + k * stride as usize;
                        let mut s = [0.0f32; 4];
                        for (c, slot) in s.iter_mut().enumerate().take(n_comp) {
                            *slot = f32::from(ru16(body, so + c * 2) as i16) / 32767.0;
                        }
                        samples.push(s);
                    }
                    channels.push(AnimChannel { kind, stride, value_offset, samples });
                    m += 12;
                    continue;
                }
            }
        }
        m += 1;
    }
    if channels.is_empty() {
        return None;
    }
    Some(Animation { frame_count, clip_name, bone_indices, channels })
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
