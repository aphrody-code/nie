// SPDX-License-Identifier: Apache-2.0
//! Conteneur et flux **IVF** (Indeo Video Format / format de test VP8/VP9/AV1).
//!
//! Utilisé nativement par CRI Sofdec2 pour encapsuler les flux vidéo VP9 dans les blocs `@SFV`,
//! et par les outils de référence (libvpx, ffmpeg, ffprobe) comme conteneur élémentaire brut.
//!
//! ## Spécification du conteneur IVF
//!
//! En-tête de fichier (32 octets, Little-Endian) :
//! ```text
//! Offset  Taille  Description
//! 0x00    4       Signature "DKIF" (0x44 0x4B 0x49 0x46)
//! 0x04    2       Version (0)
//! 0x06    2       Longueur de l'en-tête (32 octets = 0x0020)
//! 0x08    4       FourCC ("VP90", "VP80", "AV01")
//! 0x0C    2       Largeur en pixels (u16 LE)
//! 0x0E    2       Hauteur en pixels (u16 LE)
//! 0x10    4       Numérateur de cadence / échelle temporelle (u32 LE)
//! 0x14    4       Dénominateur de cadence (u32 LE)
//! 0x18    4       Nombre total d'images (u32 LE)
//! 0x1C    4       Réservé (0)
//! ```
//!
//! En-tête de chaque trame (12 octets, Little-Endian) :
//! ```text
//! Offset  Taille  Description
//! 0x00    4       Taille de la trame en octets (u32 LE)
//! 0x04    8       Horodatage / numéro d'image séquentiel (u64 LE)
//! 0x0C    ...     Données brutes de la trame vidéo (VP9 compressed frame)
//! ```

extern crate alloc;

use alloc::vec::Vec;

use crate::FormatError;

/// Signature magique d'un fichier IVF (`DKIF`).
pub const IVF_MAGIC: [u8; 4] = *b"DKIF";

/// FourCC pour VP9 ("VP90").
pub const FOURCC_VP90: [u8; 4] = *b"VP90";

/// En-tête d'un fichier IVF.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IvfHeader {
    /// Version du conteneur (généralement 0).
    pub version: u16,
    /// FourCC du codec vidéo (par ex. `b"VP90"`).
    pub fourcc: [u8; 4],
    /// Largeur codée en pixels.
    pub largeur: u16,
    /// Hauteur codée en pixels.
    pub hauteur: u16,
    /// Numérateur de cadence (framerate numerator).
    pub cadence_num: u32,
    /// Dénominateur de cadence (framerate denominator).
    pub cadence_den: u32,
    /// Nombre d'images dans le fichier.
    pub total_images: u32,
}

impl IvfHeader {
    /// Crée un en-tête IVF pour un flux VP9 avec la résolution et la cadence données.
    #[must_use]
    pub fn vp9(largeur: u16, hauteur: u16, cadence_num: u32, cadence_den: u32, total_images: u32) -> Self {
        Self {
            version: 0,
            fourcc: FOURCC_VP90,
            largeur,
            hauteur,
            cadence_num: if cadence_num > 0 { cadence_num } else { 30 },
            cadence_den: if cadence_den > 0 { cadence_den } else { 1 },
            total_images,
        }
    }

    /// Cadence en images par seconde.
    #[must_use]
    pub fn images_par_seconde(&self) -> f64 {
        if self.cadence_den > 0 {
            f64::from(self.cadence_num) / f64::from(self.cadence_den)
        } else {
            30.0
        }
    }

    /// Sérialise l'en-tête IVF sur ses 32 octets canoniques.
    #[must_use]
    pub fn to_bytes(&self) -> [u8; 32] {
        let mut out = [0u8; 32];
        out[..4].copy_from_slice(&IVF_MAGIC);
        out[4..6].copy_from_slice(&self.version.to_le_bytes());
        out[6..8].copy_from_slice(&32u16.to_le_bytes()); // longueur d'en-tête
        out[8..12].copy_from_slice(&self.fourcc);
        out[12..14].copy_from_slice(&self.largeur.to_le_bytes());
        out[14..16].copy_from_slice(&self.hauteur.to_le_bytes());
        out[16..20].copy_from_slice(&self.cadence_num.to_le_bytes());
        out[20..24].copy_from_slice(&self.cadence_den.to_le_bytes());
        out[24..28].copy_from_slice(&self.total_images.to_le_bytes());
        // 28..32 réservé = 0
        out
    }
}

/// Description d'une trame IVF lue dans le flux.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IvfTrame<'a> {
    /// Horodatage (pts) ou indice d'image.
    pub timestamp: u64,
    /// Charge utile compressée (trame VP9 brute).
    pub donnees: &'a [u8],
}

/// Décode l'en-tête IVF depuis un tampon de données.
///
/// # Erreurs
///
/// [`FormatError::TooShort`] si le tampon fait moins de 32 octets,
/// [`FormatError::BadMagic`] si la signature n'est pas `DKIF`.
pub fn lire_entete_ivf(data: &[u8]) -> Result<IvfHeader, FormatError> {
    if data.len() < 32 {
        return Err(FormatError::TooShort {
            got: data.len(),
            need: 32,
        });
    }
    if data[..4] != IVF_MAGIC {
        return Err(FormatError::BadMagic { format: "IVF/DKIF" });
    }
    let version = u16::from_le_bytes([data[4], data[5]]);
    let header_len = u16::from_le_bytes([data[6], data[7]]) as usize;
    if header_len < 32 || data.len() < header_len {
        return Err(FormatError::TooShort {
            got: data.len(),
            need: header_len,
        });
    }

    let mut fourcc = [0u8; 4];
    fourcc.copy_from_slice(&data[8..12]);
    let largeur = u16::from_le_bytes([data[12], data[13]]);
    let hauteur = u16::from_le_bytes([data[14], data[15]]);
    let cadence_num = u32::from_le_bytes([data[16], data[17], data[18], data[19]]);
    let cadence_den = u32::from_le_bytes([data[20], data[21], data[22], data[23]]);
    let total_images = u32::from_le_bytes([data[24], data[25], data[26], data[27]]);

    Ok(IvfHeader {
        version,
        fourcc,
        largeur,
        hauteur,
        cadence_num,
        cadence_den,
        total_images,
    })
}

/// Itérateur zéro-copie sur les trames d'un fichier IVF.
pub struct IvfIter<'a> {
    tampon: &'a [u8],
    pos: usize,
}

impl<'a> IvfIter<'a> {
    /// Crée un nouvel itérateur après l'en-tête IVF de 32 octets.
    #[must_use]
    pub fn new(data: &'a [u8]) -> Self {
        let debut = if data.len() >= 32 && data[..4] == IVF_MAGIC {
            let hlen = u16::from_le_bytes([data[6], data[7]]) as usize;
            if hlen >= 32 && hlen <= data.len() { hlen } else { 32 }
        } else {
            0
        };
        Self {
            tampon: data,
            pos: debut,
        }
    }
}

impl<'a> Iterator for IvfIter<'a> {
    type Item = IvfTrame<'a>;

    fn next(&mut self) -> Option<Self::Item> {
        if self.pos + 12 > self.tampon.len() {
            return None;
        }
        let taille = u32::from_le_bytes([
            self.tampon[self.pos],
            self.tampon[self.pos + 1],
            self.tampon[self.pos + 2],
            self.tampon[self.pos + 3],
        ]) as usize;
        let timestamp = u64::from_le_bytes([
            self.tampon[self.pos + 4],
            self.tampon[self.pos + 5],
            self.tampon[self.pos + 6],
            self.tampon[self.pos + 7],
            self.tampon[self.pos + 8],
            self.tampon[self.pos + 9],
            self.tampon[self.pos + 10],
            self.tampon[self.pos + 11],
        ]);

        let debut_trame = self.pos + 12;
        let fin_trame = debut_trame + taille;
        if fin_trame > self.tampon.len() {
            return None;
        }

        self.pos = fin_trame;
        Some(IvfTrame {
            timestamp,
            donnees: &self.tampon[debut_trame..fin_trame],
        })
    }
}

/// Décode un conteneur IVF complet : en-tête + toutes les trames.
///
/// # Erreurs
///
/// Remonte les erreurs de [`lire_entete_ivf`].
pub fn demuxer_ivf<'a>(data: &'a [u8]) -> Result<(IvfHeader, Vec<IvfTrame<'a>>), FormatError> {
    let header = lire_entete_ivf(data)?;
    let iter = IvfIter::new(data);
    let trames = iter.collect();
    Ok((header, trames))
}

/// Emballe une liste de trames VP9 dans un conteneur IVF complet.
///
/// `cadence` est le tuple `(num, den)` en i/s (ex. `(60, 1)` ou `(30000, 1001)`).
#[must_use]
pub fn emballer_ivf(
    largeur: u16,
    hauteur: u16,
    cadence: (u32, u32),
    trames: &[&[u8]],
) -> Vec<u8> {
    let header = IvfHeader::vp9(
        largeur,
        hauteur,
        cadence.0,
        cadence.1,
        trames.len() as u32,
    );
    let mut out = Vec::with_capacity(32 + trames.len() * 12 + trames.iter().map(|t| t.len()).sum::<usize>());
    out.extend_from_slice(&header.to_bytes());

    for (i, &trame) in trames.iter().enumerate() {
        let taille = trame.len() as u32;
        let timestamp = i as u64;
        out.extend_from_slice(&taille.to_le_bytes());
        out.extend_from_slice(&timestamp.to_le_bytes());
        out.extend_from_slice(trame);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ivf_header_round_trip() {
        let hdr = IvfHeader::vp9(1920, 1080, 60, 1, 120);
        assert_eq!(hdr.images_par_seconde(), 60.0);
        let bytes = hdr.to_bytes();
        assert_eq!(bytes.len(), 32);
        assert_eq!(&bytes[..4], &IVF_MAGIC);

        let parsed = lire_entete_ivf(&bytes).expect("parse ivf");
        assert_eq!(parsed.largeur, 1920);
        assert_eq!(parsed.hauteur, 1080);
        assert_eq!(parsed.cadence_num, 60);
        assert_eq!(parsed.cadence_den, 1);
        assert_eq!(parsed.total_images, 120);
        assert_eq!(parsed.fourcc, FOURCC_VP90);
    }

    #[test]
    fn emballer_et_demuxer_ivf_round_trip() {
        let f1 = b"trame_vp9_numero_1_donnees_arbitraires";
        let f2 = b"trame_vp9_numero_2";
        let f3 = b"trame_3";
        let trames: [&[u8]; 3] = [f1, f2, f3];

        let ivf_bytes = emballer_ivf(1280, 720, (30, 1), &trames);
        assert!(ivf_bytes.len() > 32 + 3 * 12);

        let (hdr, lues) = demuxer_ivf(&ivf_bytes).expect("demux ivf");
        assert_eq!(hdr.largeur, 1280);
        assert_eq!(hdr.hauteur, 720);
        assert_eq!(hdr.total_images, 3);
        assert_eq!(lues.len(), 3);
        assert_eq!(lues[0].donnees, f1);
        assert_eq!(lues[0].timestamp, 0);
        assert_eq!(lues[1].donnees, f2);
        assert_eq!(lues[1].timestamp, 1);
        assert_eq!(lues[2].donnees, f3);
        assert_eq!(lues[2].timestamp, 2);
    }
}