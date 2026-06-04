//! Lecteur de squelettes G4SK (Level-5 « Graphics 4 Skeleton »).
//!
//! Port Rust de `IECODE.Core/Formats/Level5/G4skParser.cs`.
//!
//! ## En-tête : DÉTERMINISTE et vérifiable
//!
//! `ParseHeader` (G4skParser.cs L51) lit des champs à offsets fixes :
//! magic `0x4B533447` "G4SK", header_size u16 @0x04, type_id u16 @0x06, file_size u32 @0x0C,
//! bone_count u16 @0x20. C'est garanti et porté tel quel.
//!
//! ## Hiérarchie d'os : INCOMPLET (heuristique, non recoupée au réel)
//!
//! Le parser C# `ParseBones` (L69) est explicitement HEURISTIQUE : `FindParentIndicesOffset`
//! scanne à partir de 0x1000 pour trouver `bone_count` shorts ∈ [-1, bone_count), et
//! `IsValidStringTable` devine la table de noms. Le vrai layout d'os IEVR n'a PAS pu être
//! recoupé : les `.g4sk` réels vivent dans les `.cpk` chr chiffrés (absents/illisibles ici), et
//! la ref `StudioElevenLib` ne couvre que les anciens formats IE (XPCK/XPVB/RES), pas G4SK.
//!
//! On expose donc :
//! - [`parse_header`] — header garanti (magic + bone_count) ;
//! - [`parse_parents_heuristic`] — la MÊME heuristique bornée que le C#, marquée non fiable.
//!
//! On NE fabrique PAS de layout d'os inventé. Tant que la disposition réelle n'est pas recoupée
//! contre un dump connu, la hiérarchie reste marquée INCOMPLET (`heuristic = true`).
//!
//! Compatible `no_std + alloc`.

extern crate alloc;
use alloc::{string::String, vec::Vec};

use crate::FormatError;

/// Magic « G4SK » little-endian (`0x4B533447`).
pub const MAGIC: u32 = 0x4B53_3447;
/// Magic « G4SK » en octets.
pub const MAGIC_BYTES: [u8; 4] = *b"G4SK";

/// En-tête G4SK (déterministe, vérifiable).
#[derive(Debug, Clone, Copy)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct G4skHeader {
    /// Taille de l'en-tête (@0x04).
    pub header_size: u16,
    /// Identifiant de type (@0x06).
    pub type_id: u16,
    /// Taille totale du fichier (@0x0C).
    pub file_size: u32,
    /// Nombre d'os (@0x20).
    pub bone_count: u16,
}

/// Os décodé. `parent_index`/`name` ne sont fiables que si `heuristic == false` (jamais le cas
/// actuellement : le vrai layout n'est pas recoupé).
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Bone {
    /// Index de l'os.
    pub index: usize,
    /// Index du parent (-1 = racine), via heuristique.
    pub parent_index: i16,
    /// Nom (peut être `Bone_<i>` si non résolu).
    pub name: String,
}

/// Hiérarchie d'os extraite par heuristique (marquée non fiable).
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct G4skBones {
    /// Os résolus (heuristiquement).
    pub bones: Vec<Bone>,
    /// Toujours `true` ici : layout non recoupé au réel ⇒ résultat INDICATIF.
    pub heuristic: bool,
}

/// Vrai si `data` commence par le magic G4SK.
#[must_use]
pub fn is_g4sk(data: &[u8]) -> bool {
    data.starts_with(&MAGIC_BYTES)
}

/// Parse l'en-tête G4SK (garanti).
///
/// # Erreurs
///
/// - [`FormatError::TooShort`] si `data` < 0x22 octets.
/// - [`FormatError::BadMagic`] si le magic n'est pas G4SK.
pub fn parse_header(data: &[u8]) -> Result<G4skHeader, FormatError> {
    if data.len() < 0x22 {
        return Err(FormatError::TooShort { got: data.len(), need: 0x22 });
    }
    if !is_g4sk(data) {
        return Err(FormatError::BadMagic { format: "G4SK" });
    }
    Ok(G4skHeader {
        header_size: read_u16(data, 0x04)?,
        type_id: read_u16(data, 0x06)?,
        file_size: read_u32(data, 0x0C)?,
        bone_count: read_u16(data, 0x20)?,
    })
}

/// Heuristique de parent-indices (port de `FindParentIndicesOffset`, G4skParser.cs L147).
///
/// Cherche, à partir de 0x1000, une suite de `bone_count` i16 ∈ [-1, bone_count) contenant au
/// moins un 0 ou un -1. **Non fiable** — voir le module-doc. Renvoie l'offset trouvé ou `None`.
#[must_use]
pub fn find_parent_indices_offset(data: &[u8], bone_count: usize) -> Option<usize> {
    if bone_count == 0 {
        return None;
    }
    let array_size = bone_count * 2;
    let start = 0x1000usize;
    if data.len() < array_size {
        return None;
    }
    let mut i = start;
    while i + array_size <= data.len() {
        let mut valid = true;
        let mut zero_or_neg = false;
        for j in 0..bone_count {
            let val = read_u16(data, i + j * 2).unwrap_or(0) as i16;
            if val < -1 || (val as i64) >= bone_count as i64 {
                valid = false;
                break;
            }
            if val == 0 || val == -1 {
                zero_or_neg = true;
            }
        }
        if valid && zero_or_neg {
            return Some(i);
        }
        i += 2;
    }
    None
}

/// Extrait les parents d'os par heuristique bornée (port de `ParseBones`). Marqué non fiable.
/// Les noms ne sont pas devinés ici (la table de chaînes n'est pas recoupée) : `Bone_<i>`.
#[must_use]
pub fn parse_parents_heuristic(data: &[u8], header: &G4skHeader) -> G4skBones {
    let bone_count = header.bone_count as usize;
    let parents_off = find_parent_indices_offset(data, bone_count);

    let mut bones = Vec::with_capacity(bone_count);
    for i in 0..bone_count {
        let parent_index = match parents_off {
            Some(off) => read_u16(data, off + i * 2).unwrap_or(0) as i16,
            None => -1,
        };
        bones.push(Bone { index: i, parent_index, name: alloc::format!("Bone_{i}") });
    }

    G4skBones { bones, heuristic: true }
}

fn read_u16(data: &[u8], off: usize) -> Result<u16, FormatError> {
    let b: [u8; 2] = data
        .get(off..off + 2)
        .and_then(|s| s.try_into().ok())
        .ok_or(FormatError::Corrupt("G4SK : lecture u16 hors limites"))?;
    Ok(u16::from_le_bytes(b))
}

fn read_u32(data: &[u8], off: usize) -> Result<u32, FormatError> {
    let b: [u8; 4] = data
        .get(off..off + 4)
        .and_then(|s| s.try_into().ok())
        .ok_or(FormatError::Corrupt("G4SK : lecture u32 hors limites"))?;
    Ok(u32::from_le_bytes(b))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Construit un en-tête G4SK synthétique (header DÉTERMINISTE : c'est ce qu'on garantit).
    fn build_header(bone_count: u16, file_size: u32) -> Vec<u8> {
        let mut buf = alloc::vec![0u8; 0x22];
        buf[0..4].copy_from_slice(&MAGIC_BYTES);
        buf[0x04..0x06].copy_from_slice(&0x20u16.to_le_bytes()); // header_size
        buf[0x06..0x08].copy_from_slice(&0x64u16.to_le_bytes()); // type_id
        buf[0x0C..0x10].copy_from_slice(&file_size.to_le_bytes());
        buf[0x20..0x22].copy_from_slice(&bone_count.to_le_bytes());
        buf
    }

    #[test]
    fn is_g4sk_detection() {
        assert!(is_g4sk(b"G4SK...."));
        assert!(!is_g4sk(b"G4MD"));
    }

    #[test]
    fn header_deterministe_golden() {
        let buf = build_header(42, 0x1234);
        let h = parse_header(&buf).expect("header G4SK");
        assert_eq!(h.header_size, 0x20);
        assert_eq!(h.type_id, 0x64);
        assert_eq!(h.file_size, 0x1234);
        assert_eq!(h.bone_count, 42);
    }

    #[test]
    fn rejette_petit_et_mauvais_magic() {
        assert!(matches!(parse_header(&[0u8; 8]), Err(FormatError::TooShort { .. })));
        let mut buf = build_header(1, 1);
        buf[..4].copy_from_slice(b"XXXX");
        assert!(matches!(parse_header(&buf), Err(FormatError::BadMagic { .. })));
    }

    #[test]
    fn heuristique_parents_marquee_non_fiable() {
        // Place 3 parents [-1, 0, 1] à 0x1000 et vérifie que l'heuristique les retrouve.
        let mut buf = alloc::vec![0u8; 0x1000 + 6];
        buf[0..4].copy_from_slice(&MAGIC_BYTES);
        buf[0x20..0x22].copy_from_slice(&3u16.to_le_bytes());
        buf[0x1000..0x1002].copy_from_slice(&(-1i16).to_le_bytes());
        buf[0x1002..0x1004].copy_from_slice(&0i16.to_le_bytes());
        buf[0x1004..0x1006].copy_from_slice(&1i16.to_le_bytes());

        let h = G4skHeader { header_size: 0x20, type_id: 0, file_size: 0, bone_count: 3 };
        let res = parse_parents_heuristic(&buf, &h);
        assert!(res.heuristic, "la hiérarchie DOIT être marquée heuristique/INCOMPLET");
        assert_eq!(res.bones.len(), 3);
        assert_eq!(res.bones[0].parent_index, -1);
        assert_eq!(res.bones[1].parent_index, 0);
        assert_eq!(res.bones[2].parent_index, 1);
        assert_eq!(res.bones[0].name, "Bone_0");
    }

    #[test]
    fn find_parents_absent_renvoie_none() {
        let buf = alloc::vec![0xFFu8; 0x1000 + 8];
        // Valeurs 0xFFFF = -1 partout : valides mais bone_count grand → dépend ; ici 2 os.
        // 0xFFFF as i16 = -1 → valide. zero_or_neg = true → trouvé. Pour tester None, bone_count
        // tel qu'aucune fenêtre ne soit valide : on met des valeurs hors plage.
        let mut b2 = buf.clone();
        for x in b2.iter_mut().skip(0x1000) {
            *x = 0x7F; // 0x7F7F = 32639 ≥ bone_count(2) → invalide
        }
        assert_eq!(find_parent_indices_offset(&b2, 2), None);
    }
}
