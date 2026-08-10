//! `nie-pe` — modèle **byte-exact** du fichier PE64 `nie.exe`.
//!
//! Ce crate est le socle de la *forge* : la chaîne qui **génère** `nie.exe` depuis
//! le workspace Rust. Il ne « comprend » pas le jeu ; il garantit qu'un fichier
//! PE peut être :
//!
//! 1. **décomposé** en un recouvrement **total** d'unités (`units`) — chaque octet
//!    du fichier appartient à exactement une unité, en-têtes et bourrage compris ;
//! 2. **régénéré** octet pour octet depuis ces unités (`Assembler`), sans jamais
//!    relire l'original ;
//! 3. **ré-émis depuis les structures parsées** pour la région d'en-tête
//!    (`PeImage::emit_headers`) — première brique réellement *produite par du code
//!    Rust* plutôt que recopiée.
//!
//! ## Pourquoi un recouvrement total
//!
//! L'objectif du projet est un `nie.exe` **identique au byte près**. Une chaîne de
//! génération qui laisse des trous (bourrage inter-section, overlay, padding
//! d'en-tête) ne peut pas être vérifiée : elle produirait « presque » le binaire.
//! Ici l'invariant est mécanique — `sum(len(unit)) == len(fichier)`, offsets
//! contigus depuis 0 — et il est testé (`units::Cover::validate`).
//!
//! ## Ce que ce crate NE fait pas
//!
//! Il n'édite pas de liens, ne relocalise pas, ne connaît pas le contenu sémantique
//! des sections. Le remplacement d'une unité par du code compilé depuis Rust
//! (et sa comparaison byte-à-byte) est du ressort de `nie-forge` (registre de
//! correspondance) et de [`coff`] (lecture des objets `.o` produits par rustc).
#![forbid(unsafe_code)]
#![warn(missing_docs)]

pub mod checksum;
pub mod coff;
pub mod diff;
pub mod image;
pub mod pdata;
pub mod units;

pub use image::{CoffHeader, DataDirectory, OptionalHeader64, PeImage, SectionHeader};
pub use units::{Cover, Unit, UnitKind};

/// Erreurs de lecture/écriture PE.
#[derive(Debug, thiserror::Error)]
pub enum PeError {
    /// Le fichier est trop court pour contenir la structure lue.
    #[error("fichier tronqué : besoin de {need} octets à l'offset {at:#x}, taille {len}")]
    Truncated {
        /// Offset de la lecture.
        at: usize,
        /// Nombre d'octets requis.
        need: usize,
        /// Taille réelle du fichier.
        len: usize,
    },
    /// Signature `MZ` absente.
    #[error("signature DOS absente (attendu MZ, lu {0:#06x})")]
    NoDosMagic(u16),
    /// Signature `PE\0\0` absente.
    #[error("signature PE absente à l'offset {0:#x}")]
    NoPeSignature(usize),
    /// En-tête optionnel non PE32+.
    #[error("magic d'en-tête optionnel non supporté : {0:#06x} (attendu 0x20b = PE32+)")]
    NotPe32Plus(u16),
    /// Incohérence structurelle détectée pendant le découpage.
    #[error("recouvrement incohérent : {0}")]
    Cover(String),
    /// Objet COFF invalide.
    #[error("objet COFF invalide : {0}")]
    Coff(String),
}

/// Résultat spécialisé du crate.
pub type Result<T> = core::result::Result<T, PeError>;

/// Empreinte SHA-256 d'un tampon, en hexadécimal minuscule.
#[must_use]
pub fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(bytes);
    let d = h.finalize();
    let mut s = String::with_capacity(64);
    for b in d {
        s.push(char::from_digit(u32::from(b >> 4), 16).unwrap_or('0'));
        s.push(char::from_digit(u32::from(b & 0xf), 16).unwrap_or('0'));
    }
    s
}

/// Lit un `u16` petit-boutiste borné.
pub(crate) fn rd_u16(b: &[u8], at: usize) -> Result<u16> {
    let s = b.get(at..at + 2).ok_or(PeError::Truncated {
        at,
        need: 2,
        len: b.len(),
    })?;
    Ok(u16::from_le_bytes([s[0], s[1]]))
}

/// Lit un `u32` petit-boutiste borné.
pub(crate) fn rd_u32(b: &[u8], at: usize) -> Result<u32> {
    let s = b.get(at..at + 4).ok_or(PeError::Truncated {
        at,
        need: 4,
        len: b.len(),
    })?;
    Ok(u32::from_le_bytes([s[0], s[1], s[2], s[3]]))
}

/// Lit un `u64` petit-boutiste borné.
pub(crate) fn rd_u64(b: &[u8], at: usize) -> Result<u64> {
    let s = b.get(at..at + 8).ok_or(PeError::Truncated {
        at,
        need: 8,
        len: b.len(),
    })?;
    let mut a = [0u8; 8];
    a.copy_from_slice(s);
    Ok(u64::from_le_bytes(a))
}
