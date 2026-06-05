//! Déchiffrement, lecture et édition des **saves IEVR** (Inazuma Eleven: Victory Road).
//!
//! ## Format « Lives »
//!
//! Chaque fichier de sauvegarde (ex. `002AB8F4-SYSTEMLIVE`, `002AB8F4-USERDATALIVE`) est un
//! conteneur chiffré par un **stream cipher maison basé CRC32** — aucun AES, aucun Salsa.
//!
//! ### Chiffrement (port de `CriwareCrypt.cs` / `NativeCrypto.cs`, vérifié sur octets réels)
//!
//! ```text
//! clé = CRC32_ISO3309(nom_de_fichier_ASCII_complet_avec_préfixe_hex)
//! ex. CRC32("002AB8F4-SYSTEMLIVE")   = 0x7787C706
//! ex. CRC32("002AB8F4-USERDATALIVE") = 0x4EAD4023
//! ```
//!
//! Le keystream est généré par mots de 4 octets : pour chaque quartet à l'offset `i`,
//! `acc = ~CRC32_round(~i, key_bytes[0..3])` ; chaque octet est XORé par 2 bits extraits de
//! `acc` (réarrangement bit non trivial identique à `ComputeXorByte`). Voir [`cpk::decrypt_block`].
//!
//! ### Structure (décryptée, vérifiée au réel)
//!
//! ```text
//! [0x00..0x04]  magic u32 LE = 0x9DCE66C3  ← sentinelle de déchiffrement correct
//! [0x04..0x08]  crc32_header u32 LE = CRC32(data[0x08..0x800])
//! [0x08..0x0C]  const2 u32 LE = 0x2EC3031F (octets `1F 03 C3 2E`)
//! [0x0C..0x10]  padding zéro
//! [0x10..0x50]  slot_name   : UTF-8 null-terminé (64 octets)
//! [0x50..]      directory   : entrées de 128 octets (stride 0x80) :
//!                 [0:4]  crc32_blob u32 LE = CRC32(données du blob)
//!                 [4:8]  blob_size  u32 LE
//!                 [8:12] blob_offset u32 LE (offset relatif à 0x800)
//!                 [12..] filename   : UTF-8 null-terminé (116 octets max)
//! [0x800..]     blobs concaténés (chacun démarre par un en-tête de 12 octets) :
//!                 [0:2]  magic u16 BE = 0xEEFF
//!                 [2:4]  subtype u16 BE (0xF010=SYSTEM, 0x0110=AUTOSAVE, 0xF210=HEADERSAVE)
//!                 [4:8]  payload_size u32 LE = taille_blob_total - 12
//!                 [8:12] field8 u32 LE (build_id candidat)
//!                 [12..] données brutes (structs jeu)
//! ```
//!
//! ## Anti-hallucination
//!
//! Toute opération de déchiffrement exige que le magic `0x9DCE66C3` soit présent à l'offset 0
//! après XOR. Si ce n'est pas le cas, [`SaveError::BadMagic`] est retourné. Idem pour
//! l'intégrité du header (CRC32 vérifié). Le round-trip déchiffre→rechiffre est octet-identique
//! (prouvé par test — XOR involutif).
//!
//! ## Aucune dépendance `std::io`
//!
//! Ce crate travaille uniquement sur des slices en mémoire et des `Vec<u8>`. Compatible
//! `no_std + alloc` (sauf les fonctions utilitaires `std::fs::*` dans [`io`]).
#![forbid(unsafe_code)]
#![allow(clippy::pedantic)]

extern crate alloc;
use alloc::{string::String, vec::Vec};

use thiserror::Error;

pub mod body;
pub mod io;

// Ré-exporte `decrypt_block` et `key_from_filename` depuis nie-formats pour que les
// consommateurs n'aient pas besoin de dépendre directement de nie-formats.
pub use nie_formats::cpk::{decrypt_block, key_from_filename};

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/// Magic du conteneur « Lives » (u32 LE, plaintext après déchiffrement).
pub const LIVES_MAGIC: u32 = 0x9DCE6_6C3;

/// Constante à l'offset [8..12] du header, stockée en little-endian (octets `1F 03 C3 2E`).
pub const LIVES_CONST2: u32 = 0x2EC3_031F;

/// Magic des blocs internes (u16 big-endian, octets [0..2] de chaque blob).
pub const BLOB_MAGIC: u16 = 0xEEFF;

/// Sous-type `SYSTEM_data.bin`.
pub const BLOB_SUBTYPE_SYSTEM: u16 = 0xF010;

/// Sous-type `AUTOSAVE_data.bin`.
pub const BLOB_SUBTYPE_AUTOSAVE: u16 = 0x0110;

/// Sous-type `HEADERSAVE_data.bin`.
pub const BLOB_SUBTYPE_HEADERSAVE: u16 = 0xF210;

/// Offset où commencent les blobs (2048 octets de header + répertoire).
pub const DATA_START: usize = 0x800;

/// Taille d'une entrée de répertoire (stride).
pub const DIR_ENTRY_STRIDE: usize = 0x80;

/// Offset du début du répertoire dans le header.
pub const DIR_OFFSET: usize = 0x50;

/// Taille de l'en-tête de chaque blob interne (octets avant le corps).
pub const BLOB_HEADER_SIZE: usize = 12;

// ---------------------------------------------------------------------------
// Erreurs
// ---------------------------------------------------------------------------

/// Erreurs du module `nie-save`.
#[derive(Debug, Error)]
pub enum SaveError {
    /// Tampon trop court.
    #[error("tampon trop court : {got} octets, {need} attendus")]
    TooShort { got: usize, need: usize },

    /// Magic invalide (mauvaise clé ou format non-Lives).
    #[error("magic invalide : attendu 0x{expected:08X}, obtenu 0x{got:08X}")]
    BadMagic { expected: u32, got: u32 },

    /// Intégrité CRC32 échouée.
    #[error("CRC32 invalide : attendu 0x{expected:08X}, calculé 0x{computed:08X} ({context})")]
    BadCrc { expected: u32, computed: u32, context: &'static str },

    /// Données corrompues.
    #[error("données corrompues : {0}")]
    Corrupt(&'static str),
}

// ---------------------------------------------------------------------------
// Types publics
// ---------------------------------------------------------------------------

/// Sous-type d'un blob interne.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum BlobSubtype {
    /// Données système (`SYSTEM_data.bin`).
    System,
    /// Sauvegarde automatique (`AUTOSAVE_data.bin`).
    Autosave,
    /// En-tête de sauvegarde (`HEADERSAVE_data.bin`).
    Headersave,
    /// Sous-type non reconnu (valeur brute conservée).
    Unknown(u16),
}

impl BlobSubtype {
    fn from_raw(v: u16) -> Self {
        match v {
            BLOB_SUBTYPE_SYSTEM => Self::System,
            BLOB_SUBTYPE_AUTOSAVE => Self::Autosave,
            BLOB_SUBTYPE_HEADERSAVE => Self::Headersave,
            other => Self::Unknown(other),
        }
    }

    fn to_raw(self) -> u16 {
        match self {
            Self::System => BLOB_SUBTYPE_SYSTEM,
            Self::Autosave => BLOB_SUBTYPE_AUTOSAVE,
            Self::Headersave => BLOB_SUBTYPE_HEADERSAVE,
            Self::Unknown(v) => v,
        }
    }
}

/// Entrée du répertoire du conteneur « Lives ».
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct DirEntry {
    /// CRC32 LE du blob correspondant (vérifié au parsing).
    pub crc32: u32,
    /// Taille du blob en octets.
    pub size: u32,
    /// Offset du blob relatif à [`DATA_START`].
    pub offset: u32,
    /// Nom du fichier interne (ex. `SYSTEM_data.bin`).
    pub filename: String,
}

/// En-tête d'un blob interne (12 octets).
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct BlobHeader {
    /// Sous-type du blob.
    pub subtype: BlobSubtype,
    /// Taille du corps (blob total - 12 octets d'en-tête).
    pub payload_size: u32,
    /// Champ à l'offset 8 (build_id candidat ou checksum interne).
    pub field8: u32,
}

/// Blob interne décodé (en-tête + corps).
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Blob {
    /// En-tête du blob.
    pub header: BlobHeader,
    /// Corps brut du blob (données jeu, sans les 12 octets d'en-tête).
    pub body: Vec<u8>,
}

impl Blob {
    /// Sérialise le blob en octets (en-tête 12 o + corps).
    ///
    /// Le champ `payload_size` de l'en-tête est préservé tel quel depuis le parsing original :
    /// pour AUTOSAVE ce champ n'est PAS la taille du corps (c'est un champ interne moteur),
    /// donc on le copie fidèlement pour garantir le round-trip bit-à-bit.
    #[must_use]
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(BLOB_HEADER_SIZE + self.body.len());
        // magic u16 BE
        out.extend_from_slice(&BLOB_MAGIC.to_be_bytes());
        // subtype u16 BE
        out.extend_from_slice(&self.header.subtype.to_raw().to_be_bytes());
        // payload_size u32 LE (préservé depuis le parsing — ne pas recalculer depuis body.len())
        out.extend_from_slice(&self.header.payload_size.to_le_bytes());
        // field8 u32 LE
        out.extend_from_slice(&self.header.field8.to_le_bytes());
        out.extend_from_slice(&self.body);
        out
    }
}

/// Conteneur Lives parsé et déchiffré.
///
/// Représente l'état plaintext d'un fichier de sauvegarde IEVR. Peut être modifié
/// puis rechiffré via [`LivesContainer::encrypt`].
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct LivesContainer {
    /// Nom du slot (ex. `002AB8F4-SYSTEMLIVE`), sert à dériver la clé.
    pub slot_name: String,
    /// Clé CRC32 dérivée du nom de fichier.
    pub key: u32,
    /// Entrées de répertoire (ordre de l'original).
    pub entries: Vec<DirEntry>,
    /// Blobs internes, dans le même ordre que les entrées de répertoire.
    pub blobs: Vec<Blob>,
}

impl LivesContainer {
    /// Rechiffre le conteneur et produit les octets du fichier prêts à être écrits.
    ///
    /// Recalcule le CRC32 de chaque blob et du header avant chiffrement.
    /// Le résultat est octet-identique à l'original si aucun blob n'a été modifié
    /// (round-trip garanti par le XOR involutif).
    ///
    /// # Erreurs
    ///
    /// Retourne une erreur si les données internes sont incohérentes.
    pub fn encrypt(&self) -> Result<Vec<u8>, SaveError> {
        let mut plain = self.serialize_plaintext()?;
        decrypt_block(&mut plain, 0, self.key);
        Ok(plain)
    }

    /// Accède au blob par sous-type.
    #[must_use]
    pub fn blob_by_subtype(&self, subtype: BlobSubtype) -> Option<&Blob> {
        self.blobs.iter().find(|b| b.header.subtype == subtype)
    }

    /// Accède au blob mutablement par sous-type.
    #[must_use]
    pub fn blob_by_subtype_mut(&mut self, subtype: BlobSubtype) -> Option<&mut Blob> {
        self.blobs.iter_mut().find(|b| b.header.subtype == subtype)
    }

    /// Sérialise le conteneur en plaintext (avant chiffrement).
    ///
    /// Reconstruit le header + répertoire (0x800 octets) + blobs concaténés,
    /// recalculant les CRC32 et les tailles.
    fn serialize_plaintext(&self) -> Result<Vec<u8>, SaveError> {
        // 1. Sérialiser chaque blob en octets
        let blob_bytes: Vec<Vec<u8>> = self.blobs.iter().map(|b| b.to_bytes()).collect();
        // 2. Calculer les offsets cumulatifs
        let mut offsets = Vec::with_capacity(blob_bytes.len());
        let mut cumul: u32 = 0;
        for bv in &blob_bytes {
            offsets.push(cumul);
            cumul = cumul
                .checked_add(bv.len() as u32)
                .ok_or(SaveError::Corrupt("dépassement de taille des blobs"))?;
        }

        // 3. Construire le header plaintext (0x800 octets)
        let mut hdr = vec![0u8; DATA_START];

        // [0:4] magic placeholder (sera rempli après CRC)
        // [4:8] CRC32 header (sera calculé sur hdr[8..0x800])
        // [8:12] const2 LE (stocké en little-endian malgré l'apparence)
        hdr[8..12].copy_from_slice(&LIVES_CONST2.to_le_bytes());
        // [12:16] zéros (déjà)

        // [0x10..0x50] slot_name null-terminé
        let name_bytes = self.slot_name.as_bytes();
        let name_len = name_bytes.len().min(63);
        hdr[0x10..0x10 + name_len].copy_from_slice(&name_bytes[..name_len]);
        // hdr[0x10 + name_len] = 0 (déjà)

        // [0x50..] répertoire (stride 0x80 par entrée)
        for (i, blob_vec) in blob_bytes.iter().enumerate() {
            let e_off = DIR_OFFSET + i * DIR_ENTRY_STRIDE;
            if e_off + DIR_ENTRY_STRIDE > DATA_START {
                return Err(SaveError::Corrupt("trop d'entrées dans le répertoire"));
            }
            let entry = &self.entries[i];
            let blob_crc = crc32_of(blob_vec);
            let blob_size = blob_vec.len() as u32;
            let blob_offset = offsets[i];

            hdr[e_off..e_off + 4].copy_from_slice(&blob_crc.to_le_bytes());
            hdr[e_off + 4..e_off + 8].copy_from_slice(&blob_size.to_le_bytes());
            hdr[e_off + 8..e_off + 12].copy_from_slice(&blob_offset.to_le_bytes());

            let fname = entry.filename.as_bytes();
            let fname_len = fname.len().min(DIR_ENTRY_STRIDE - 13);
            hdr[e_off + 12..e_off + 12 + fname_len].copy_from_slice(&fname[..fname_len]);
            // null terminator déjà dans les zéros
        }

        // CRC32 du header (octets [8..0x800])
        let hdr_crc = crc32_of(&hdr[8..DATA_START]);
        hdr[4..8].copy_from_slice(&hdr_crc.to_le_bytes());

        // Magic VIENT EN PREMIER (offset [0..4])
        hdr[0..4].copy_from_slice(&LIVES_MAGIC.to_le_bytes());

        // 4. Assembler : header + blobs
        let total = DATA_START + cumul as usize;
        let mut out = Vec::with_capacity(total);
        out.extend_from_slice(&hdr);
        for bv in &blob_bytes {
            out.extend_from_slice(bv);
        }
        Ok(out)
    }
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/// Déchiffre et parse un fichier de sauvegarde « Lives ».
///
/// `filename` doit être le **nom de base** du fichier (ex. `002AB8F4-SYSTEMLIVE`) —
/// c'est à partir de ce nom que la clé CRC32 est dérivée. La casse est préservée.
///
/// # Erreurs
///
/// - [`SaveError::TooShort`] si le tampon est < [`DATA_START`].
/// - [`SaveError::BadMagic`] si le magic `0x9DCE66C3` est absent après déchiffrement.
/// - [`SaveError::BadCrc`] si le CRC32 du header ou d'un blob est invalide.
/// - [`SaveError::Corrupt`] pour toute incohérence structurelle.
pub fn parse(data: &[u8], filename: &str) -> Result<LivesContainer, SaveError> {
    if data.len() < DATA_START {
        return Err(SaveError::TooShort { got: data.len(), need: DATA_START });
    }

    let key = key_from_filename(filename);

    // Déchiffrer une copie (on ne modifie pas l'original).
    let mut plain = data.to_vec();
    decrypt_block(&mut plain, 0, key);

    // Vérifier le magic.
    // SAFETY: plain.len() >= DATA_START (0x800) >= 8, les slices [0..4] et [4..8] sont valides.
    let magic = u32::from_le_bytes(
        plain.get(0..4)
            .and_then(|s| s.try_into().ok())
            .ok_or(SaveError::Corrupt("lecture magic: slice invalide"))?,
    );
    if magic != LIVES_MAGIC {
        return Err(SaveError::BadMagic { expected: LIVES_MAGIC, got: magic });
    }

    // Vérifier le CRC32 du header.
    let stored_hdr_crc = u32::from_le_bytes(
        plain.get(4..8)
            .and_then(|s| s.try_into().ok())
            .ok_or(SaveError::Corrupt("lecture hdr_crc: slice invalide"))?,
    );
    let computed_hdr_crc = crc32_of(&plain[8..DATA_START]);
    if stored_hdr_crc != computed_hdr_crc {
        return Err(SaveError::BadCrc {
            expected: stored_hdr_crc,
            computed: computed_hdr_crc,
            context: "header CRC32",
        });
    }

    // Lire le nom du slot.
    let slot_name_bytes = &plain[0x10..0x50];
    let nul = slot_name_bytes.iter().position(|&b| b == 0).unwrap_or(slot_name_bytes.len());
    let slot_name = String::from_utf8_lossy(&slot_name_bytes[..nul]).into_owned();

    // Parser le répertoire.
    let mut entries = Vec::new();
    let mut off = DIR_OFFSET;
    while off + DIR_ENTRY_STRIDE <= DATA_START {
        // Les slices sont garanties valides par la condition de boucle (off + 0x80 <= 0x800).
        let crc32 = u32::from_le_bytes(
            plain.get(off..off + 4)
                .and_then(|s| s.try_into().ok())
                .ok_or(SaveError::Corrupt("répertoire: lecture crc32"))?,
        );
        let size = u32::from_le_bytes(
            plain.get(off + 4..off + 8)
                .and_then(|s| s.try_into().ok())
                .ok_or(SaveError::Corrupt("répertoire: lecture size"))?,
        );
        let blob_offset = u32::from_le_bytes(
            plain.get(off + 8..off + 12)
                .and_then(|s| s.try_into().ok())
                .ok_or(SaveError::Corrupt("répertoire: lecture offset"))?,
        );
        // Nom : null-terminé dans les 116 octets restants de l'entrée
        let name_slice = &plain[off + 12..off + DIR_ENTRY_STRIDE];
        let name_nul = name_slice.iter().position(|&b| b == 0).unwrap_or(name_slice.len());
        let filename_entry = String::from_utf8_lossy(&name_slice[..name_nul]).into_owned();

        // Une entrée avec size=0 ET nom vide = fin du répertoire
        if filename_entry.is_empty() {
            break;
        }

        entries.push(DirEntry { crc32, size, offset: blob_offset, filename: filename_entry });
        off += DIR_ENTRY_STRIDE;
    }

    if entries.is_empty() {
        return Err(SaveError::Corrupt("répertoire vide"));
    }

    // Parser chaque blob.
    let mut blobs = Vec::with_capacity(entries.len());
    for entry in &entries {
        // Utiliser checked_add pour éviter l'overflow sur wasm32 (usize = 32 bits).
        let abs_start = DATA_START
            .checked_add(entry.offset as usize)
            .ok_or(SaveError::Corrupt("dépassement d'offset dans le répertoire"))?;
        let abs_end = abs_start
            .checked_add(entry.size as usize)
            .ok_or(SaveError::Corrupt("dépassement de taille de blob"))?;

        if abs_end > plain.len() {
            return Err(SaveError::TooShort { got: plain.len(), need: abs_end });
        }

        let blob_bytes = &plain[abs_start..abs_end];

        // Vérifier le CRC32 du blob.
        let computed_blob_crc = crc32_of(blob_bytes);
        if computed_blob_crc != entry.crc32 {
            return Err(SaveError::BadCrc {
                expected: entry.crc32,
                computed: computed_blob_crc,
                context: "blob CRC32",
            });
        }

        // Parser l'en-tête du blob (12 octets).
        if blob_bytes.len() < BLOB_HEADER_SIZE {
            return Err(SaveError::TooShort { got: blob_bytes.len(), need: BLOB_HEADER_SIZE });
        }

        // blob_bytes.len() >= BLOB_HEADER_SIZE (12) est vérifié juste avant.
        let blob_magic = u16::from_be_bytes(
            blob_bytes.get(0..2)
                .and_then(|s| s.try_into().ok())
                .ok_or(SaveError::Corrupt("blob: lecture magic"))?,
        );
        if blob_magic != BLOB_MAGIC {
            return Err(SaveError::BadMagic {
                expected: u32::from(BLOB_MAGIC),
                got: u32::from(blob_magic),
            });
        }

        let subtype_raw = u16::from_be_bytes(
            blob_bytes.get(2..4)
                .and_then(|s| s.try_into().ok())
                .ok_or(SaveError::Corrupt("blob: lecture subtype"))?,
        );
        let payload_size = u32::from_le_bytes(
            blob_bytes.get(4..8)
                .and_then(|s| s.try_into().ok())
                .ok_or(SaveError::Corrupt("blob: lecture payload_size"))?,
        );
        let field8 = u32::from_le_bytes(
            blob_bytes.get(8..12)
                .and_then(|s| s.try_into().ok())
                .ok_or(SaveError::Corrupt("blob: lecture field8"))?,
        );

        // Note : pour AUTOSAVE, le champ `payload_size` dans l'en-tête interne NE correspond
        // PAS à `taille_blob - 12` (c'est un champ interne du moteur, probablement un
        // nombre d'enregistrements ou un offset). La taille réelle du corps est
        // `entry.size - BLOB_HEADER_SIZE`, dérivée du répertoire du conteneur.
        let body = blob_bytes[BLOB_HEADER_SIZE..].to_vec();

        blobs.push(Blob {
            header: BlobHeader {
                subtype: BlobSubtype::from_raw(subtype_raw),
                payload_size,
                field8,
            },
            body,
        });
    }

    Ok(LivesContainer { slot_name, key, entries, blobs })
}

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

/// Calcule CRC32 ISO-3309 (même table que `nie-formats/cpk`, poly `0xEDB88320`).
///
/// Version publique pour les tests d'intégration (notamment `io.rs`).
#[must_use]
pub fn crc32_of_pub(data: &[u8]) -> u32 {
    crc32_of(data)
}

/// Calcule CRC32 ISO-3309 (même table que `nie-formats/cpk`, poly `0xEDB88320`).
///
/// Réimplémenté ici pour éviter d'exposer des détails internes de `nie-formats`.
#[must_use]
fn crc32_of(data: &[u8]) -> u32 {
    const POLY: u32 = 0xEDB8_8320;
    let mut crc = 0xFFFF_FFFFu32;
    for &b in data {
        let idx = ((crc ^ u32::from(b)) & 0xFF) as usize;
        let mut entry = idx as u32;
        for _ in 0..8 {
            entry = if entry & 1 == 1 { (entry >> 1) ^ POLY } else { entry >> 1 };
        }
        crc = (crc >> 8) ^ entry;
    }
    !crc
}

// ---------------------------------------------------------------------------
// SaveSummary : agrégat des champs parsés (headersave + autosave)
// ---------------------------------------------------------------------------

/// Résumé complet d'une sauvegarde IEVR, agrégeant les champs confirmés
/// extraits du HEADERSAVE et de l'AUTOSAVE.
///
/// Seuls les champs **validés sur octets réels** sont exposés. Les régions
/// OPAQUE (argent, équipe, progression, inventaire) ne sont PAS représentées.
///
/// ## Utilisation
///
/// ```rust,no_run
/// # use nie_save::{parse, summarize};
/// # let bytes = &[];
/// # let filename = "002AB8F4-USERDATALIVE";
/// let container = parse(bytes, filename).expect("parsing");
/// let summary = summarize(&container);
/// println!("joueur={} niveau={}", summary.player_name, summary.level_str);
/// ```
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct SaveSummary {
    /// Nom du fichier (slot_name du conteneur, ex. `002AB8F4-USERDATALIVE`).
    pub slot_name: String,

    /// Nom du joueur extrait du HEADERSAVE (ancre validée : `"AstraJinWoo"`).
    /// Chaîne vide si le blob HEADERSAVE est absent ou non parsable.
    pub player_name: String,

    /// Niveau du joueur sous forme de chaîne ASCII (ancre validée : `"218"`).
    /// Chaîne vide si absent ou non parsable.
    pub level_str: String,

    /// Temps de jeu total en secondes, priorité au scalaire AUTOSAVE
    /// (ancré : 323895 ≈ 89h58m), sinon premier slot HEADERSAVE horodaté.
    /// `None` si aucune source disponible.
    pub playtime_secs: Option<u32>,

    /// Identifiant unique de la save (UUID hexadécimal ASCII 32 chars).
    /// Ancre validée : `"00023798fc9b4d49b9a36b6b0cb8d50b"`.
    /// Chaîne vide si absent.
    pub unique_id: String,

    /// Horodatage de dernière sauvegarde (depuis HEADERSAVE).
    /// `None` si le blob HEADERSAVE est absent.
    pub last_save: Option<body::headersave::NativeDateTime>,

    /// Nombre de slots utilisés (HEADERSAVE). `None` si absent.
    pub used_slots: Option<u32>,

    /// Nombre maximal de slots (HEADERSAVE). `None` si absent.
    pub max_slots: Option<u32>,

    /// Identifiants des personnages possédés (depuis le roster AUTOSAVE,
    /// blob imbriqué EEFF 0x0510, TLV hash `0xBA162C11`).
    ///
    /// Chaque `CharaId` correspond à la colonne `id` de `inagle_characters`
    /// (miroir SQLite azalee). Vecteur vide si le blob AUTOSAVE est absent.
    ///
    /// Validation forte (VPS 2026-06-05) : 4534 ids non-nuls, tous présents
    /// dans `inagle_characters`. Aucun faux positif.
    pub roster: Vec<body::autosave_roster::CharaId>,

    /// Nombre total de slots du roster (incluant les vides).
    /// Typiquement 6000 sur une save réelle. 0 si AUTOSAVE absent.
    pub roster_slots: usize,

    /// Scalaires AUTOSAVE (datetime + playtime), `None` si non parsables.
    pub autosave_scalars: Option<body::autosave_roster::AutosaveScalars>,
}

/// Construit un [`SaveSummary`] depuis un [`LivesContainer`] déchiffré.
///
/// Parse les blobs HEADERSAVE et AUTOSAVE si présents, en extrayant les champs
/// confirmés. Les régions OPAQUE sont ignorées silencieusement.
///
/// Ne retourne jamais d'erreur : les échecs partiels (blob absent, corps trop
/// court, hash introuvable) produisent des champs `None` / vecteurs vides.
///
/// # Exemple
///
/// ```rust,no_run
/// # use nie_save::{parse, summarize, io::read_save};
/// # use std::path::Path;
/// let container = read_save(Path::new("data/saves/002AB8F4-USERDATALIVE"))
///     .expect("lecture");
/// let summary = summarize(&container);
/// assert_eq!(summary.player_name, "AstraJinWoo");
/// assert_eq!(summary.level_str, "218");
/// assert!(!summary.roster.is_empty());
/// ```
#[must_use]
pub fn summarize(container: &LivesContainer) -> SaveSummary {
    use body::{
        autosave_roster::parse_autosave_roster,
        headersave::parse_headersave,
    };

    // --- HEADERSAVE ---
    let hs = container
        .blob_by_subtype(BlobSubtype::Headersave)
        .and_then(|blob| parse_headersave(&blob.body).ok());

    let player_name   = hs.as_ref().map(|h| h.player_name.clone()).unwrap_or_default();
    let level_str     = hs.as_ref().map(|h| h.level_str.clone()).unwrap_or_default();
    let unique_id     = hs.as_ref().map(|h| h.unique_id.clone()).unwrap_or_default();
    let last_save     = hs.as_ref().map(|h| h.save_timestamp.clone());
    let used_slots    = hs.as_ref().map(|h| h.used_slots);
    let max_slots_v   = hs.as_ref().map(|h| h.max_slots);

    // playtime depuis les slots HEADERSAVE si AUTOSAVE ne l'a pas encore
    let hs_playtime: Option<u32> = hs.as_ref().and_then(|h| {
        h.slots.iter().find_map(|s| s.playtime_secs)
    });

    // --- AUTOSAVE ---
    let autosave = container
        .blob_by_subtype(BlobSubtype::Autosave)
        .and_then(|blob| parse_autosave_roster(&blob.body).ok());

    let (roster, roster_slots, autosave_scalars) = match autosave {
        Some(r) => {
            let sc = r.scalars;
            (r.owned, r.roster_slots, sc)
        }
        None => (Vec::new(), 0, None),
    };

    // Temps de jeu : scalaire AUTOSAVE prioritaire, sinon slot HEADERSAVE.
    let playtime_secs = autosave_scalars
        .as_ref()
        .map(|s| s.playtime_secs)
        .or(hs_playtime);

    SaveSummary {
        slot_name: container.slot_name.clone(),
        player_name,
        level_str,
        playtime_secs,
        unique_id,
        last_save,
        used_slots,
        max_slots: max_slots_v,
        roster,
        roster_slots,
        autosave_scalars,
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // -----------------------------------------------------------------------
    // Fixture synthétique : mini-conteneur Lives valide (1 blob SYSTEM)
    // -----------------------------------------------------------------------

    const FAKE_SLOT_NAME: &str = "DEADBEEF-SYSTEMLIVE";

    fn build_synthetic_lives() -> Vec<u8> {
        // Corps du blob (données quelconques, 8 octets)
        let body: Vec<u8> = vec![0x01, 0x02, 0x03, 0x04, 0xAA, 0xBB, 0xCC, 0xDD];

        // En-tête blob (12 octets) : magic BE + subtype BE + payload_size LE + field8 LE
        let mut blob: Vec<u8> = Vec::new();
        blob.extend_from_slice(&BLOB_MAGIC.to_be_bytes());           // EE FF
        blob.extend_from_slice(&BLOB_SUBTYPE_SYSTEM.to_be_bytes());  // F0 10
        blob.extend_from_slice(&(body.len() as u32).to_le_bytes());  // 08 00 00 00
        blob.extend_from_slice(&0xDEAD_BEEFu32.to_le_bytes());       // field8
        blob.extend_from_slice(&body);

        let blob_crc = crc32_of(&blob);
        let blob_size = blob.len() as u32;

        // Header plaintext (0x800 octets)
        let mut hdr = vec![0u8; DATA_START];

        // const2 @ [8..12] LE
        hdr[8..12].copy_from_slice(&LIVES_CONST2.to_le_bytes());

        // slot_name @ [0x10..0x50]
        let sn = FAKE_SLOT_NAME.as_bytes();
        hdr[0x10..0x10 + sn.len()].copy_from_slice(sn);

        // Répertoire @ 0x50
        hdr[0x50..0x54].copy_from_slice(&blob_crc.to_le_bytes());   // crc32
        hdr[0x54..0x58].copy_from_slice(&blob_size.to_le_bytes());  // size
        hdr[0x58..0x5C].copy_from_slice(&0u32.to_le_bytes());       // offset=0
        let fname = b"SYSTEM_data.bin";
        hdr[0x5C..0x5C + fname.len()].copy_from_slice(fname);

        // CRC32 header @ [4..8]
        let hdr_crc = crc32_of(&hdr[8..DATA_START]);
        hdr[4..8].copy_from_slice(&hdr_crc.to_le_bytes());

        // Magic @ [0..4]
        hdr[0..4].copy_from_slice(&LIVES_MAGIC.to_le_bytes());

        // Assembler
        let mut plain = hdr;
        plain.extend_from_slice(&blob);
        plain
    }

    fn encrypt_buf(plain: &[u8], name: &str) -> Vec<u8> {
        let key = key_from_filename(name);
        let mut enc = plain.to_vec();
        decrypt_block(&mut enc, 0, key);
        enc
    }

    #[test]
    fn parse_fixture_synthetique() {
        let plain = build_synthetic_lives();
        let enc = encrypt_buf(&plain, FAKE_SLOT_NAME);

        let container = parse(&enc, FAKE_SLOT_NAME).expect("parse doit réussir");

        assert_eq!(container.slot_name, FAKE_SLOT_NAME);
        assert_eq!(container.key, key_from_filename(FAKE_SLOT_NAME));
        assert_eq!(container.entries.len(), 1);
        assert_eq!(container.entries[0].filename, "SYSTEM_data.bin");
        assert_eq!(container.blobs.len(), 1);
        assert_eq!(container.blobs[0].header.subtype, BlobSubtype::System);
        assert_eq!(container.blobs[0].body, vec![0x01, 0x02, 0x03, 0x04, 0xAA, 0xBB, 0xCC, 0xDD]);
    }

    #[test]
    fn round_trip_encrypt_decrypt_identique() {
        let plain = build_synthetic_lives();
        let enc = encrypt_buf(&plain, FAKE_SLOT_NAME);

        let container = parse(&enc, FAKE_SLOT_NAME).unwrap();
        let reenc = container.encrypt().expect("rechiffrement doit réussir");

        assert_eq!(reenc, enc, "round-trip doit produire des octets identiques");
    }

    #[test]
    fn mauvaise_cle_retourne_bad_magic() {
        let plain = build_synthetic_lives();
        // On chiffre avec le bon nom mais on parse avec un nom différent → mauvaise clé
        let enc = encrypt_buf(&plain, FAKE_SLOT_NAME);
        let result = parse(&enc, "CAFEBABE-SYSTEMLIVE");
        assert!(
            matches!(result, Err(SaveError::BadMagic { .. })),
            "mauvaise clé doit retourner BadMagic"
        );
    }

    #[test]
    fn tampon_trop_court_retourne_erreur() {
        let short = vec![0u8; 16];
        let result = parse(&short, FAKE_SLOT_NAME);
        assert!(matches!(result, Err(SaveError::TooShort { .. })));
    }

    #[test]
    fn crc32_of_valeurs_connues() {
        // CRC32("") = 0x00000000
        assert_eq!(crc32_of(b""), 0x0000_0000);
        // CRC32("123456789") = 0xCBF43926 (vecteur de test standard CRC32)
        assert_eq!(crc32_of(b"123456789"), 0xCBF4_3926);
    }

    #[test]
    fn blob_to_bytes_puis_reparse_round_trip() {
        let blob = Blob {
            header: BlobHeader {
                subtype: BlobSubtype::Autosave,
                payload_size: 4,
                field8: 0xABCD_EF01,
            },
            body: vec![1, 2, 3, 4],
        };
        let bytes = blob.to_bytes();
        assert_eq!(bytes.len(), BLOB_HEADER_SIZE + 4);

        // Re-parser manuellement les champs
        let magic = u16::from_be_bytes(bytes[0..2].try_into().unwrap());
        let subtype = u16::from_be_bytes(bytes[2..4].try_into().unwrap());
        let payload_size = u32::from_le_bytes(bytes[4..8].try_into().unwrap());
        let field8 = u32::from_le_bytes(bytes[8..12].try_into().unwrap());
        let body = &bytes[12..];

        assert_eq!(magic, BLOB_MAGIC);
        assert_eq!(subtype, BLOB_SUBTYPE_AUTOSAVE);
        assert_eq!(payload_size, 4);
        assert_eq!(field8, 0xABCD_EF01);
        assert_eq!(body, &[1, 2, 3, 4]);
    }

    #[test]
    fn edition_corps_blob_et_round_trip() {
        let plain = build_synthetic_lives();
        let enc = encrypt_buf(&plain, FAKE_SLOT_NAME);

        let mut container = parse(&enc, FAKE_SLOT_NAME).unwrap();

        // Modifier le premier octet du corps du blob SYSTEM
        if let Some(blob) = container.blob_by_subtype_mut(BlobSubtype::System) {
            blob.body[0] = 0xFF;
        }

        let reenc = container.encrypt().unwrap();
        // Re-parser pour vérifier la modification
        let container2 = parse(&reenc, FAKE_SLOT_NAME).unwrap();
        assert_eq!(container2.blobs[0].body[0], 0xFF, "la modification doit survivre au round-trip");
        // Les autres octets ne doivent pas avoir changé
        assert_eq!(container2.blobs[0].body[1..], vec![0x02, 0x03, 0x04, 0xAA, 0xBB, 0xCC, 0xDD]);
    }

    #[test]
    fn cle_saves_reelles_connues() {
        // Valeurs recoupées empiriquement sur les fichiers réels du VPS (non fabriquées).
        assert_eq!(key_from_filename("002AB8F4-SYSTEMLIVE"), 0x7787_C706);
        assert_eq!(key_from_filename("002AB8F4-USERDATALIVE"), 0x4EAD_4023);
    }

    // -----------------------------------------------------------------------
    // Tests de robustesse : garantit zéro panic sur input arbitraire
    // -----------------------------------------------------------------------

    /// Fuzz léger : itère sur des inputs tronqués de taille 0..DATA_START+20.
    ///
    /// Aucun de ces appels ne doit paniquer ; tous doivent retourner `Err`.
    #[test]
    fn robustesse_inputs_tronques() {
        let plain = build_synthetic_lives();
        let enc = encrypt_buf(&plain, FAKE_SLOT_NAME);
        // Tester des troncations progressives : 0 octet → DATA_START + 20 octets.
        for len in 0..DATA_START + 20 {
            let input = &enc[..len.min(enc.len())];
            // Toujours un Err (trop court ou CRC invalide), jamais un panic.
            let _ = parse(input, FAKE_SLOT_NAME);
        }
    }

    /// Fuzz léger : buffer plein de 0x00 (longueur DATA_START + 100).
    #[test]
    fn robustesse_buffer_nul() {
        let input = vec![0u8; DATA_START + 100];
        // 0x00000000 != LIVES_MAGIC → BadMagic (pas de panic).
        let result = parse(&input, "FAKE-SLOT");
        assert!(matches!(result, Err(SaveError::BadMagic { .. })));
    }

    /// Fuzz léger : buffer plein de 0xFF (longueur DATA_START + 100).
    #[test]
    fn robustesse_buffer_ff() {
        let input = vec![0xFFu8; DATA_START + 100];
        let result = parse(&input, "FAKE-SLOT");
        // Doit retourner BadMagic ou BadCrc, jamais paniquer.
        assert!(result.is_err());
    }

    /// Overflow d'offset : entrée de répertoire avec blob_offset = u32::MAX.
    ///
    /// Sur wasm32 (usize=32 bits), DATA_START + u32::MAX déborderait sans checked_add.
    /// Doit retourner Corrupt ou TooShort, jamais paniquer ni produire un conteneur invalide.
    #[test]
    fn robustesse_overflow_blob_offset() {
        let mut plain = build_synthetic_lives();
        // Injecter blob_offset = u32::MAX dans l'entrée de répertoire [0x58..0x5C].
        plain[0x58..0x5C].copy_from_slice(&u32::MAX.to_le_bytes());
        // Recalculer le CRC header (octets [8..0x800]) car on a modifié le header.
        let hdr_crc = crc32_of(&plain[8..DATA_START]);
        plain[4..8].copy_from_slice(&hdr_crc.to_le_bytes());
        // Chiffrer avec la bonne clé.
        let enc = encrypt_buf(&plain, FAKE_SLOT_NAME);
        let result = parse(&enc, FAKE_SLOT_NAME);
        // TooShort ou Corrupt selon le chemin d'exécution — jamais panic.
        assert!(
            matches!(result, Err(SaveError::TooShort { .. }) | Err(SaveError::Corrupt(_)) | Err(SaveError::BadCrc { .. })),
            "blob_offset=u32::MAX doit retourner une erreur, pas paniquer"
        );
    }

    /// Overflow de taille : entrée de répertoire avec blob_size = u32::MAX.
    #[test]
    fn robustesse_overflow_blob_size() {
        let mut plain = build_synthetic_lives();
        // Injecter blob_size = u32::MAX dans l'entrée de répertoire [0x54..0x58].
        plain[0x54..0x58].copy_from_slice(&u32::MAX.to_le_bytes());
        // Recalculer le CRC header.
        let hdr_crc = crc32_of(&plain[8..DATA_START]);
        plain[4..8].copy_from_slice(&hdr_crc.to_le_bytes());
        let enc = encrypt_buf(&plain, FAKE_SLOT_NAME);
        let result = parse(&enc, FAKE_SLOT_NAME);
        // Doit retourner TooShort ou Corrupt — jamais panic.
        assert!(
            matches!(result, Err(SaveError::TooShort { .. }) | Err(SaveError::Corrupt(_)) | Err(SaveError::BadCrc { .. })),
            "blob_size=u32::MAX doit retourner une erreur"
        );
    }

    /// Fuzz léger : variations aléatoires déterministes du conteneur chiffré.
    ///
    /// Mute chaque octet de la fixture à 0x00/0xFF/0x41 sur les 512 premiers octets.
    /// Aucun appel ne doit paniquer.
    #[test]
    fn robustesse_mutations_deterministiques() {
        let plain = build_synthetic_lives();
        let enc = encrypt_buf(&plain, FAKE_SLOT_NAME);
        let limit = enc.len().min(512);
        for i in 0..limit {
            for &mutation in &[0x00u8, 0xFFu8, 0x41u8] {
                let mut mutated = enc.clone();
                mutated[i] = mutation;
                // Jamais paniquer, quel que soit le résultat.
                let _ = parse(&mutated, FAKE_SLOT_NAME);
            }
        }
    }

    /// Fuzz body autosave : itère sur des inputs tronqués → zéro panic.
    #[test]
    fn robustesse_autosave_inputs_tronques() {
        use crate::body::autosave::parse_autosave_layout;
        use crate::body::autosave_roster::parse_autosave_roster;
        // Tester des tailles de 0 à 100 octets (zéro, sous-taille, etc.)
        for len in 0..=100usize {
            let input = vec![0u8; len];
            let _ = parse_autosave_layout(&input);
            let _ = parse_autosave_roster(&input);
        }
        // Body de taille DATA_START : version=1 BE, reste nul → ne doit pas paniquer.
        let mut buf = vec![0u8; DATA_START];
        buf[3] = 0x01; // version=1
        let _ = parse_autosave_layout(&buf);
        let _ = parse_autosave_roster(&buf);
    }

    /// Fuzz body headersave : itère sur des inputs tronqués → zéro panic.
    #[test]
    fn robustesse_headersave_inputs_tronques() {
        use crate::body::headersave::parse_headersave;
        for len in 0..=100usize {
            let input = vec![0u8; len];
            let _ = parse_headersave(&input);
        }
        // Body juste à la taille minimale avec format_version=1 et champs nuls.
        use crate::body::headersave::HEADERSAVE_MIN_LEN;
        let mut buf = vec![0u8; HEADERSAVE_MIN_LEN];
        buf[3] = 0x01; // format_version=1 BE
        buf[8] = 10;   // max_slots=10
        buf[12] = 0;   // used_slots=0
        let _ = parse_headersave(&buf);
    }
}
