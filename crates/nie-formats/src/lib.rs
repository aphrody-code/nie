//! Parsers de formats Level-5 / Criware portés en Rust, `no_std`-friendly (alloc) pour
//! la portabilité wasm.
//!
//! ## Modules disponibles
//!
//! - [`crilayla`] — décompresseur CRILAYLA complet (LZ bitstream inversé).
//! - [`cpk`] — lecteur de tables `@UTF` et d'archives CPK Criware (big-endian).
//! - [`cfgbin`] — lecteur de fichiers RDBN (cfg.bin Level-5) + décodage des VALEURS typées.
//! - [`g4tx`] — conteneurs de textures G4TX (header + entrées + atlas + noms).
//! - [`nxtch`] — chunks de texture Switch NXTCH + déswizzle GOB Tegra X1.
//! - [`g4md`] — métadonnées de modèle G4MD (sous-mailles + attributs vertex + materials).
//! - [`g4mg`] — géométrie G4MG (positions/normales/UV0/indices) pilotée par le `.g4md`.
//! - [`g4sk`] — squelettes G4SK (header garanti + hiérarchie d'os RÉSOLUE via la table
//!   d'offsets de l'en-tête, recoupée sur un `.g4sk` réel ; fallback heuristique).
//! - [`g4pk`] — archives Level-5 G4PK / G4RA (table offsets/tailles/hashes/noms).
//!
//! ## Compatibilité `no_std`
//!
//! Ce crate utilise `alloc` (via `extern crate alloc`) mais n'a pas de dépendances
//! `std` directes en dehors de `thiserror` (qui requiert `std` pour
//! `std::error::Error`). Il est donc compatible `no_std + alloc + std`.
//!
//! ## Chiffrement CPK IEVR (déchiffré, vérifié au réel)
//!
//! Les CPK de `data/packs/` d'Inazuma Eleven: Victory Road sont chiffrés par l'enveloppe
//! CRI Middleware « position-based XOR », clé dérivée du **nom de fichier** (CRC32 standard).
//! [`cpk::decrypt_and_check_cpk`] déchiffre en place et vérifie que le résultat est un en-tête
//! `CPK ` + table `@UTF` (anti-hallucination). Porté de `CriwareCrypt.cs` / `NativeCrypto.cs`
//! et recoupé sur des octets réels du dump VPS. La constante d'audit `0x1717E18E`
//! ([`cpk::VIOLA_FIXED_KEY`]) est la clé Viola des `cfg.bin`, PAS celle des packs.
#![forbid(unsafe_code)]
#![allow(clippy::pedantic)]

use thiserror::Error;

pub mod assemble;
pub mod cfgbin;
pub mod objbin;
pub mod cpk;
pub mod crilayla;
pub mod cri_audio;
pub mod g4md;
pub mod g4mg;
pub mod g4pk;
pub mod g4sk;
pub mod g4tx;
pub mod lip;
pub mod nxtch;
pub mod vfs;

#[derive(Debug, Error)]
pub enum FormatError {
    #[error("tampon trop court : {got} octets, {need} attendus")]
    TooShort { got: usize, need: usize },
    #[error("magic invalide pour {format}")]
    BadMagic { format: &'static str },
    #[error("données corrompues : {0}")]
    Corrupt(&'static str),
}

/// Familles de formats reconnues dans l'écosystème IEVR.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum FileFormat {
    /// Archive Criware (`CPK `).
    Cpk,
    /// Table @UTF Criware (`@UTF`).
    Utf,
    /// Compression CriLayla (`CRILAYLA`).
    CriLayla,
    /// Audio HCA Criware (`HCA\0` ou chiffré).
    Hca,
    /// Banque audio ACB.
    Acb,
    /// Archive audio AWB (`AFS2`).
    Awb,
    /// Vidéo USM (`CRID`).
    Usm,
    /// Config binaire Level-5 (RDBN / cfg.bin).
    CfgBin,
    /// Mesh Level-5 (`G4MG`).
    G4mg,
    /// Métadonnées de modèle (`G4MD`).
    G4md,
    /// Texture (`G4TX`).
    G4tx,
    /// Squelette (`G4SK`).
    G4sk,
    /// Pack/anim Level-5 (`G4PK`).
    G4pk,
    /// Navmesh (`G4NV`).
    G4nv,
    /// Inconnu.
    Unknown,
}

impl FileFormat {
    /// Nom court lisible.
    #[must_use]
    pub fn name(self) -> &'static str {
        match self {
            Self::Cpk => "CPK",
            Self::Utf => "@UTF",
            Self::CriLayla => "CRILAYLA",
            Self::Hca => "HCA",
            Self::Acb => "ACB",
            Self::Awb => "AWB",
            Self::Usm => "USM",
            Self::CfgBin => "cfg.bin",
            Self::G4mg => "G4MG",
            Self::G4md => "G4MD",
            Self::G4tx => "G4TX",
            Self::G4sk => "G4SK",
            Self::G4pk => "G4PK",
            Self::G4nv => "G4NV",
            Self::Unknown => "?",
        }
    }
}

/// Détecte le format d'un tampon par ses octets de tête.
#[must_use]
pub fn detect(bytes: &[u8]) -> FileFormat {
    const fn starts(b: &[u8], m: &[u8]) -> bool {
        if b.len() < m.len() {
            return false;
        }
        let mut i = 0;
        while i < m.len() {
            if b[i] != m[i] {
                return false;
            }
            i += 1;
        }
        true
    }
    if starts(bytes, b"CRILAYLA") {
        FileFormat::CriLayla
    } else if starts(bytes, b"CPK ") {
        FileFormat::Cpk
    } else if starts(bytes, b"@UTF") {
        FileFormat::Utf
    } else if starts(bytes, b"AFS2") {
        FileFormat::Awb
    } else if starts(bytes, b"CRID") {
        FileFormat::Usm
    } else if starts(bytes, b"@HCA") || starts(bytes, b"HCA\0") {
        FileFormat::Hca
    } else if starts(bytes, b"G4MG") {
        FileFormat::G4mg
    } else if starts(bytes, b"G4MD") {
        FileFormat::G4md
    } else if starts(bytes, b"G4TX") {
        FileFormat::G4tx
    } else if starts(bytes, b"G4SK") {
        FileFormat::G4sk
    } else if starts(bytes, b"G4PK") {
        FileFormat::G4pk
    } else if starts(bytes, b"G4NV") {
        FileFormat::G4nv
    } else if starts(bytes, b"RDBN") {
        FileFormat::CfgBin
    } else {
        FileFormat::Unknown
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_known_magics() {
        assert_eq!(detect(b"CRILAYLA\x00\x00"), FileFormat::CriLayla);
        assert_eq!(detect(b"CPK \x00\x00"), FileFormat::Cpk);
        assert_eq!(detect(b"@UTF\x00"), FileFormat::Utf);
        assert_eq!(detect(b"G4MG....."), FileFormat::G4mg);
        assert_eq!(detect(b"AFS2...."), FileFormat::Awb);
        assert_eq!(detect(b"RDBN...."), FileFormat::CfgBin);
        assert_eq!(detect(b"random"), FileFormat::Unknown);
        assert_eq!(detect(b""), FileFormat::Unknown);
    }
}
