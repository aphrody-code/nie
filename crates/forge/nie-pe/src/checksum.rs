//! Somme de contrôle PE (`OptionalHeader.CheckSum`).
//!
//! Algorithme `CheckSumMappedFile` : somme en complément à un sur 16 bits de tout
//! le fichier, le champ `CheckSum` lui-même étant traité comme nul, puis addition
//! de la taille du fichier. `nie.exe` porte `CheckSum = 0` (le loader ne l'exige
//! que pour les pilotes et certaines DLL système) : la forge doit donc être
//! capable de **reproduire zéro**, pas seulement de calculer une valeur.

use crate::image::PeImage;

/// Offset du champ `CheckSum` dans l'en-tête optionnel PE32+.
pub const CHECKSUM_FIELD_OFFSET_IN_OPT: usize = 64;

/// Calcule la somme de contrôle d'une image complète.
///
/// `checksum_field_off` est l'offset fichier du champ `CheckSum` (4 octets), qui
/// est neutralisé pendant le calcul.
#[must_use]
pub fn compute(bytes: &[u8], checksum_field_off: usize) -> u32 {
    let mut sum: u64 = 0;
    let mut i = 0usize;
    while i + 1 < bytes.len() {
        if i == checksum_field_off || i == checksum_field_off + 2 {
            i += 2;
            continue;
        }
        let w = u64::from(u16::from_le_bytes([bytes[i], bytes[i + 1]]));
        sum += w;
        sum = (sum & 0xffff) + (sum >> 16);
        i += 2;
    }
    if i < bytes.len() {
        sum += u64::from(bytes[i]);
        sum = (sum & 0xffff) + (sum >> 16);
    }
    sum = (sum & 0xffff) + (sum >> 16);
    let checksum = u32::try_from(sum & 0xffff).unwrap_or_default();
    checksum.wrapping_add(u32::try_from(bytes.len()).unwrap_or(u32::MAX))
}

/// Offset fichier du champ `CheckSum` d'une image parsée.
#[must_use]
pub fn field_offset(img: &PeImage) -> usize {
    img.pe_offset + 4 + 20 + CHECKSUM_FIELD_OFFSET_IN_OPT
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn somme_ignore_le_champ_checksum() {
        let mut a = vec![0u8; 64];
        a[10] = 0xAB;
        let b_off = 20;
        let s1 = compute(&a, b_off);
        a[b_off] = 0xFF;
        a[b_off + 1] = 0xFF;
        a[b_off + 2] = 0xFF;
        a[b_off + 3] = 0xFF;
        let s2 = compute(&a, b_off);
        assert_eq!(s1, s2, "le champ CheckSum ne doit pas influencer la somme");
    }

    #[test]
    fn somme_inclut_la_taille_du_fichier() {
        let a = vec![0u8; 100];
        assert_eq!(compute(&a, 0), 100);
    }
}
