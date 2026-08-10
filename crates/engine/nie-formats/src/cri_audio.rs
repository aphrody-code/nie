//! Parsers audio Criware : ADX → PCM16, AWB (AFS2), ACB, USM.
//!
//! ## Formats supportés
//!
//! - [`adx_decode`] — ADX ADPCM type 3 (4 bits/sample, 18 octets/frame, 32 samples/frame).
//! - [`Awb`] — Archive audio AFS2 (Wave Bank) : parse les entrées indexées par cue-ID et
//!   extrait les blobs HCA/ADX bruts.
//! - [`acb_parse`] — Cue sheet Criware (`@UTF`) : résout les noms de cue et extrait le AWB
//!   embarqué ou le nom du AWB externe.
//! - [`encode_pcm16_wav`] — écrit un buffer PCM 16-bit signé entrelacé en WAV RIFF.
//!
//! ## Utilisation typique
//!
//! ```rust,ignore
//! use nie_formats::cri_audio::{Awb, encode_pcm16_wav};
//!
//! let awb_bytes = vfs.read("data/common/sound_asset/ja/c03032310.awb")?;
//! let awb = Awb::parse(&awb_bytes)?;
//! for entry in &awb.entries {
//!     let hca_raw = awb.entry_bytes(&awb_bytes, entry);
//!     // Décodage HCA chiffré IEVR (ciph_type=56) : utiliser cridecoder::HcaDecoder
//!     // avec set_encryption_key(IEVR_HCA_KEY, awb.subkey as u64) depuis nie-model-serve.
//! }
//! ```
//!
//! ## Chiffrement HCA IEVR
//!
//! Les fichiers HCA d'Inazuma Eleven: Victory Road ont `ciph_type = 56` (chiffrés XOR).
//! La clé principale (`IEVR_HCA_KEY = 59_278_503_195_307_634`, source : `SoundPlayManager.DecryptionKey`
//! dans le dump il2cpp) et la sous-clé AWB (u16 LE à l'offset `0x0E` de l'en-tête AFS2,
//! exposée par [`Awb::subkey`]) doivent être transmises à
//! `cridecoder::HcaDecoder::set_encryption_key` avant de décoder la première trame.
//! Cette logique vit dans `nie-model-serve` (dépendance std `cridecoder`) ;
//! `nie-formats` ne fait que le parsing du conteneur AWB/ACB.

extern crate alloc;
use alloc::{string::String, vec::Vec};

use crate::FormatError;

// ── Helpers de lecture big-endian ─────────────────────────────────────────────

#[inline]
fn read_u16_be(d: &[u8], off: usize) -> u16 {
    u16::from_be_bytes([d[off], d[off + 1]])
}

#[inline]
fn read_i16_be(d: &[u8], off: usize) -> i16 {
    i16::from_be_bytes([d[off], d[off + 1]])
}

#[inline]
fn read_u32_be(d: &[u8], off: usize) -> u32 {
    u32::from_be_bytes([d[off], d[off + 1], d[off + 2], d[off + 3]])
}

#[inline]
fn read_u16_le(d: &[u8], off: usize) -> u16 {
    u16::from_le_bytes([d[off], d[off + 1]])
}

#[inline]
fn read_u32_le(d: &[u8], off: usize) -> u32 {
    u32::from_le_bytes([d[off], d[off + 1], d[off + 2], d[off + 3]])
}

// ── Résultat PCM ──────────────────────────────────────────────────────────────

/// Résultat d'un décodage audio.
#[derive(Debug, Clone)]
pub struct PcmResult {
    /// Échantillons PCM 16-bit signés, entrelacés (L R L R…).
    pub samples: Vec<i16>,
    /// Fréquence d'échantillonnage (Hz).
    pub sample_rate: u32,
    /// Nombre de canaux.
    pub channels: u32,
}

// ── WAV RIFF ──────────────────────────────────────────────────────────────────

/// Encode un buffer PCM 16-bit en WAV RIFF (little-endian).
///
/// Les `samples` sont supposés entrelacés (L R L R…) et de longueur exactement
/// `N * channels`. Le résultat est un `Vec<u8>` prêt à être envoyé en HTTP avec
/// `Content-Type: audio/wav`.
#[must_use]
pub fn encode_pcm16_wav(samples: &[i16], channels: u32, sample_rate: u32) -> Vec<u8> {
    let num_samples = samples.len() as u32;
    let byte_rate = sample_rate * channels * 2;
    let block_align = (channels * 2) as u16;
    let data_len = num_samples * 2;
    let riff_size = 36 + data_len; // taille après RIFF+size = 8 + 28 + data_len

    let mut out = Vec::with_capacity(44 + data_len as usize);

    // RIFF header
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&riff_size.to_le_bytes());
    out.extend_from_slice(b"WAVE");

    // fmt chunk
    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&16u32.to_le_bytes()); // chunk size
    out.extend_from_slice(&1u16.to_le_bytes());  // PCM
    out.extend_from_slice(&(channels as u16).to_le_bytes());
    out.extend_from_slice(&sample_rate.to_le_bytes());
    out.extend_from_slice(&byte_rate.to_le_bytes());
    out.extend_from_slice(&block_align.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes()); // bits per sample

    // data chunk
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for &s in samples {
        out.extend_from_slice(&s.to_le_bytes());
    }

    out
}

// ── ADX ──────────────────────────────────────────────────────────────────────

/// Taille d'une trame ADX type 3 en octets (toujours 18).
const ADX_FRAME_BYTES: usize = 18;

/// Nombre d'échantillons par trame ADX (toujours 32).
const ADX_SAMPLES_PER_FRAME: usize = 32;

/// Signature marquant la fin de l'en-tête ADX : `(c)CRI`.
const ADX_COPYRIGHT_MARKER: &[u8; 6] = b"(c)CRI";

/// Extrait un nibble signé 4 bits (-8..=7).
#[inline]
fn signed_nibble(nib: u8) -> i32 {
    let v = i32::from(nib & 0x0F);
    if v & 0x08 != 0 { v - 16 } else { v }
}

/// Décode un flux ADX CRI en PCM 16-bit.
///
/// Supporte uniquement le type d'encodage 3 (standard ADPCM),
/// `block_size=18`, `bitdepth=4`, canaux 1 ou 2.
///
/// # Erreurs
///
/// Retourne [`FormatError::BadMagic`] si le magic `0x8000` est absent.
/// Retourne [`FormatError::Corrupt`] pour tout autre problème structurel.
pub fn adx_decode(data: &[u8]) -> Result<PcmResult, FormatError> {
    if data.len() < 20 {
        return Err(FormatError::TooShort { got: data.len(), need: 20 });
    }
    // Magic ADX : octets 0-1 = 0x80 0x00
    if data[0] != 0x80 || data[1] != 0x00 {
        return Err(FormatError::BadMagic { format: "ADX" });
    }

    // data_offset (BE u16) = offset depuis le début de l'en-tête vers les données audio
    // incluant 2 octets supplémentaires (le champ magic + lui-même) donc :
    // adresse absolue = data_offset_field + 4
    let data_offset_field = u32::from(read_u16_be(data, 2));
    let audio_data_start = (data_offset_field + 4) as usize;

    // Vérifie le marqueur copyright juste avant le début des données
    let copyright_pos = audio_data_start.saturating_sub(2);
    if copyright_pos + 6 <= data.len()
        && &data[copyright_pos..copyright_pos + 6] != ADX_COPYRIGHT_MARKER
    {
        // Tolérance : si le copyright marker est absent, on continue quand même
        // (certains ADX de test ne l'ont pas).
    }

    let encoding = data[4];
    let block_size = data[5] as usize;
    let bitdepth = data[6];
    let channels = data[7] as u32;
    let sample_rate = read_u32_be(data, 8);
    let total_samples = read_u32_be(data, 12) as usize;
    let highpass_hz = u32::from(read_u16_be(data, 16));

    if encoding != 3 {
        return Err(FormatError::Corrupt("ADX : seul l'encodage type 3 est supporté"));
    }
    if block_size != ADX_FRAME_BYTES || bitdepth != 4 {
        return Err(FormatError::Corrupt("ADX : block_size ou bitdepth invalide (attendu 18/4)"));
    }
    if channels == 0 || channels > 2 {
        return Err(FormatError::Corrupt("ADX : nombre de canaux invalide (1 ou 2 seulement)"));
    }
    if sample_rate == 0 || total_samples == 0 {
        return Err(FormatError::Corrupt("ADX : sample_rate ou total_samples nul"));
    }
    if audio_data_start >= data.len() {
        return Err(FormatError::Corrupt("ADX : data_offset hors des limites du fichier"));
    }

    // Coefficients ADX (filtre ADPCM linéaire 2e ordre).
    // Formule (C++ iecode référence) :
    //   a = sqrt(2) - cos(2π·fc/fs)
    //   b = sqrt(2) - 1
    //   coeff1 = (a - sqrt(a²-b²)) / b * 8192
    //   coeff2 = -(coeff1 / 8192)² * 4096
    let (coeff1, coeff2): (i32, i32) = if highpass_hz > 0 && sample_rate > 0 {
        let pi = core::f64::consts::PI;
        let sqrt2 = core::f64::consts::SQRT_2;
        let a = sqrt2 - (2.0 * pi * highpass_hz as f64 / sample_rate as f64).cos();
        let b = sqrt2 - 1.0;
        let c = (a - ((a + b) * (a - b)).sqrt()) / b;
        let c1 = (c * 8192.0) as i32;
        let c2 = (-(c * c) * 4096.0) as i32;
        (c1, c2)
    } else {
        // Défauts pour highpass=500Hz / sr=44100Hz
        (7298, -3535)
    };

    let frames_per_channel = total_samples.div_ceil(ADX_SAMPLES_PER_FRAME);
    let mut samples = vec![0i16; total_samples * channels as usize];
    let mut prev1 = [0i32; 2];
    let mut prev2 = [0i32; 2];

    let stream = &data[audio_data_start..];
    let channels_usize = channels as usize;

    for f in 0..frames_per_channel {
        for ch in 0..channels_usize {
            let frame_off = (f * channels_usize + ch) * ADX_FRAME_BYTES;
            if frame_off + ADX_FRAME_BYTES > stream.len() {
                break;
            }
            let frame = &stream[frame_off..];
            let scale = i32::from(read_i16_be(frame, 0)) + 1;

            for s in 0..ADX_SAMPLES_PER_FRAME {
                let abs_idx = f * ADX_SAMPLES_PER_FRAME + s;
                if abs_idx >= total_samples {
                    break;
                }
                let byte = frame[2 + (s >> 1)];
                let nib = if s & 1 == 0 {
                    signed_nibble(byte >> 4)
                } else {
                    signed_nibble(byte)
                };

                let predicted = (coeff1 * prev1[ch] + coeff2 * prev2[ch]) >> 12;
                let raw = nib * scale + predicted;
                let sample = raw.clamp(-32768, 32767);

                prev2[ch] = prev1[ch];
                prev1[ch] = sample;

                samples[abs_idx * channels_usize + ch] = sample as i16;
            }
        }
    }

    Ok(PcmResult { samples, sample_rate, channels })
}

// ── AWB (AFS2) ────────────────────────────────────────────────────────────────

/// Entrée d'un archive AWB (AFS2).
#[derive(Debug, Clone)]
pub struct AwbEntry {
    /// Identifiant de cue (index dans le ACB/CueTable).
    pub cue_id: u32,
    /// Offset absolu de l'entrée dans les données AWB.
    pub offset: u32,
    /// Taille de l'entrée en octets.
    pub size: u32,
}

/// Archive audio AWB (AFS2).
///
/// La sous-clé de déchiffrement HCA ([`Awb::subkey`], u16 LE à l'offset `0x0E` de
/// l'en-tête AFS2) doit être transmise à `cridecoder::HcaDecoder::set_encryption_key`
/// pour déchiffrer les entrées HCA (`ciph_type = 56`). Varie par fichier AWB ;
/// ex. `c00001001.awb` (IEVR) → `0xC62A`.
#[derive(Debug, Clone)]
pub struct Awb {
    /// Sous-clé de déchiffrement HCA, u16 LE lue à l'offset `0x0E` de l'en-tête AFS2.
    ///
    /// À transmettre à `cridecoder::HcaDecoder::set_encryption_key(IEVR_HCA_KEY, subkey as u64)`
    /// avant de décoder les trames HCA (`ciph_type = 56`).
    pub subkey: u16,
    /// Entrées indexées par cue-ID.
    pub entries: Vec<AwbEntry>,
}

impl Awb {
    /// Parse un AWB AFS2 depuis un slice de bytes.
    ///
    /// Layout AFS2 (little-endian) :
    /// ```text
    /// [0:4]  = "AFS2"
    /// [4]    = version
    /// [5]    = offset_size (2 ou 4 octets par offset)
    /// [6:8]  = entry_count (uint16 LE)
    /// [8:12] = block_size (uint32 LE) — alignement des données
    /// [12:16]= key (uint32 LE)
    /// [16:16+entry_count*2] = cue_ids (uint16 LE chacun)
    /// [aligned]+ = offset table (entry_count+1 entrées)
    /// ```
    pub fn parse(data: &[u8]) -> Result<Self, FormatError> {
        if data.len() < 16 {
            return Err(FormatError::TooShort { got: data.len(), need: 16 });
        }
        if &data[..4] != b"AFS2" {
            return Err(FormatError::BadMagic { format: "AWB/AFS2" });
        }

        let offset_size = data[5] as usize;
        if offset_size != 2 && offset_size != 4 {
            return Err(FormatError::Corrupt("AWB : offset_size invalide (2 ou 4 attendu)"));
        }

        // Champ [6:8] ignoré (flags/padding selon version).
        // entry_count = uint32 LE à l'offset [8:12].
        // alignment = uint32 LE à l'offset [12:16] (utilisé pour aligner la table d'offsets).
        let entry_count = read_u32_le(data, 8) as usize;
        let _alignment = read_u32_le(data, 12) as usize; // champ de structure, non utilisé par la table d'offsets
        // Sous-clé de déchiffrement HCA : u16 LE à l'offset 0x0E de l'en-tête AFS2.
        // Situé dans le champ [12:16] (alignment/flags) ; les 2 octets de poids fort
        // [0x0E:0x10] portent la sous-clé AWB utilisée avec la clé principale IEVR.
        let subkey = read_u16_le(data, 0x0E);

        // Table des cue-IDs : uint32 LE chacun, à partir de 0x10.
        // 4 octets par ID (observé sur AWB IEVR réels, vérifiés sur les données terrain).
        let ids_start = 0x10;
        let ids_end = ids_start + entry_count * 4;
        if ids_end > data.len() {
            return Err(FormatError::Corrupt("AWB : table cue-IDs dépasse le tampon"));
        }
        let cue_ids: Vec<u32> = (0..entry_count)
            .map(|i| read_u32_le(data, ids_start + i * 4))
            .collect();

        // Table des offsets : suit DIRECTEMENT les IDs, sans alignement.
        // L'`alignment` s'applique aux données (entrées audio), pas à la table d'offsets.
        // Vérification terrain :
        //   - AWB 27 entrées : ids_end=0x7c, off_table=0x7c, data[0x7c:0x80]=offsets ✓
        //   - AWB 1 entrée   : ids_end=0x14, off_table=0x14, data[0x14:0x1c]=offsets ✓
        let off_table_start = ids_end;
        let off_table_end = off_table_start + (entry_count + 1) * offset_size;
        if off_table_end > data.len() {
            return Err(FormatError::Corrupt("AWB : table d'offsets dépasse le tampon"));
        }

        let read_offset = |i: usize| -> u32 {
            let p = off_table_start + i * offset_size;
            if offset_size == 2 {
                u32::from(read_u16_le(data, p))
            } else {
                read_u32_le(data, p)
            }
        };

        let mut entries = Vec::with_capacity(entry_count);
        for (i, &cue_id) in cue_ids.iter().enumerate() {
            let raw_offset = read_offset(i);
            // Les offsets sont déjà alignés dans les AWB IEVR ; pas d'alignement supplémentaire
            // (le block_size en [8:12] est en fait entry_count, pas un facteur d'alignement).
            let aligned_offset = raw_offset;
            let end_offset = read_offset(i + 1);
            let size = end_offset.saturating_sub(aligned_offset);

            // Sauvegarde uniquement si l'entrée est dans le tampon
            let entry = AwbEntry {
                cue_id,
                offset: aligned_offset,
                size: if aligned_offset as usize + size as usize <= data.len() {
                    size
                } else if (aligned_offset as usize) < data.len() {
                    (data.len() - aligned_offset as usize) as u32
                } else {
                    0
                },
            };
            entries.push(entry);
        }

        Ok(Self { subkey, entries })
    }

    /// Extrait les bytes d'une entrée depuis le tampon AWB.
    ///
    /// Saute les octets nuls en début d'entrée pour trouver les données HCA/ADX réelles
    /// (les AWB IEVR ont un padding nul de quelques octets avant le magic HCA).
    pub fn entry_bytes<'d>(&self, data: &'d [u8], entry: &AwbEntry) -> &'d [u8] {
        let start = entry.offset as usize;
        let end = (entry.offset + entry.size) as usize;
        if start >= data.len() {
            return &[];
        }
        let end = end.min(data.len());
        let raw = &data[start..end];
        // Saute les octets nuls en tête (padding d'alignement AWB)
        let skip = raw.iter().take_while(|&&b| b == 0).count();
        // Mais pas plus de 64 octets de padding
        let skip = skip.min(64);
        &raw[skip..]
    }
}

// ── ACB ───────────────────────────────────────────────────────────────────────

/// Informations extraites d'un ACB (Atom Cue Bank).
#[derive(Debug, Clone)]
pub struct AcbInfo {
    /// Nom du cue sheet.
    pub name: String,
    /// Version.
    pub version: u32,
    /// Nombre de cues.
    pub cue_count: usize,
    /// Noms des cues (depuis CueNameTable).
    pub cue_names: Vec<String>,
    /// AWB embarqué (colonne `AwbFile`), si présent.
    pub embedded_awb: Vec<u8>,
    /// Nom du AWB externe (colonne `StreamAwbHash`), si présent.
    pub external_awb_name: Option<String>,
}

/// Parse un fichier ACB (`@UTF` table) et extrait les métadonnées + AWB embarqué.
///
/// Un ACB est une table `@UTF` dont la première (et unique) ligne de données
/// contient des colonnes de type `Bytes` qui elles-mêmes contiennent des sous-tables
/// `@UTF` imbriquées (CueTable, CueNameTable, WaveformTable, etc.).
pub fn acb_parse(data: &[u8]) -> Result<AcbInfo, FormatError> {
    use crate::cpk::{UtfValue, parse_utf};

    let table = parse_utf(data).map_err(|_| FormatError::BadMagic { format: "ACB/@UTF" })?;

    if table.rows.is_empty() {
        return Err(FormatError::Corrupt("ACB : table @UTF vide"));
    }

    let row = &table.rows[0];

    // Récupère une valeur string depuis la table
    let get_str = |name: &str| -> Option<String> {
        match table.get(0, name)? {
            UtfValue::String(s) => Some(s.clone()),
            _ => None,
        }
    };
    // Récupère un entier u32 depuis la table
    let get_u32 = |name: &str| -> Option<u32> {
        table.get(0, name).and_then(|v| v.as_i64()).map(|v| v as u32)
    };
    // Récupère un blob Bytes depuis la table
    let get_bytes = |name: &str| -> Option<Vec<u8>> {
        match table.get(0, name)? {
            UtfValue::Bytes(b) => Some(b.clone()),
            _ => None,
        }
    };

    let name = get_str("Name").unwrap_or_default();
    let version = get_u32("Version").unwrap_or(0);

    // AWB embarqué
    let embedded_awb = get_bytes("AwbFile").unwrap_or_default();

    // AWB externe : colonne StreamAwbHash ou StreamAwbAfs2Header
    let external_awb_name = get_str("StreamAwbHash");

    // CueNameTable (sous-table @UTF embarquée dans la colonne de type Bytes)
    let cue_names = get_bytes("CueNameTable")
        .and_then(|b| crate::cpk::parse_utf(&b).ok())
        .map(|sub_table| {
            sub_table
                .rows
                .iter()
                .filter_map(|r| {
                    let ci = sub_table.column_index("CueName")?;
                    match r.get(ci)? {
                        UtfValue::String(s) => Some(s.clone()),
                        _ => None,
                    }
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    // CueCount depuis CueTable
    let cue_count = get_bytes("CueTable")
        .and_then(|b| crate::cpk::parse_utf(&b).ok())
        .map(|sub| sub.rows.len())
        .unwrap_or(cue_names.len());

    let _ = row; // row utilisé via les closures

    Ok(AcbInfo {
        name,
        version,
        cue_count,
        cue_names,
        embedded_awb,
        external_awb_name,
    })
}

// ── USM (Sofdec2) ─────────────────────────────────────────────────────────────

/// Identifiants de flux USM (big-endian).
const USM_STMID_CRID: u32 = 0x4352_4944; // "CRID"
const USM_STMID_SFV: u32  = 0x4053_4656; // "@SFV"
const USM_STMID_SFA: u32  = 0x4053_4641; // "@SFA"


/// Codec vidéo détecté dans le flux @SFV.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VideoCodec {
    /// H.264 (NAL units — start codes 0x000001 ou 0x00000001).
    H264,
    /// VP9.
    Vp9,
    /// Codec inconnu.
    Unknown,
}

/// Résultat du démultiplexage d'un USM.
#[derive(Debug, Clone)]
pub struct UsmResult {
    /// Codec vidéo détecté.
    pub video_codec: VideoCodec,
    /// Frames vidéo brutes concaténées (H.264 NAL bitstream ou VP9 frames).
    /// Vide si aucun flux vidéo.
    pub video_data: Vec<u8>,
    /// Pistes audio extraites (HCA ou ADX bruts, prêts pour `adx_decode` ou `cridecoder::HcaDecoder`).
    /// Vide si aucun flux @SFA.
    pub audio_tracks: Vec<Vec<u8>>,
    /// Largeur vidéo (0 si inconnue).
    pub width: u32,
    /// Hauteur vidéo (0 si inconnue).
    pub height: u32,
    /// Framerate nominatif (0 si inconnu).
    pub frame_rate: u32,
    /// Nombre de frames vidéo.
    pub frame_count: u32,
}

/// Démultiplexe un fichier USM Sofdec2.
///
/// Structure d'un bloc USM :
/// ```text
/// [0:4]   stmid (uint32 BE) : CRID / @SFV / @SFA
/// [4:8]   data_size (uint32 BE) : taille du reste du bloc après ces 8 octets
/// [8:10]  r01 (uint16 BE)
/// [10]    r02 (uint8)
/// [11]    type (uint8) : 0=header, 1=stream, 2=end
/// [12:16] frame_time (uint32 BE)
/// [16:20] frame_rate (uint32 BE)
/// [20:24] r04 (uint32 BE)
/// [24:26] data_offset (uint16 BE) : offset du payload depuis le début du bloc
/// [26:28] padding_size (uint16 BE) : octets de padding en fin de payload
/// ```
/// Taille totale d'un bloc = 8 + data_size.
pub fn usm_demux(data: &[u8]) -> Result<UsmResult, FormatError> {
    if data.len() < 8 {
        return Err(FormatError::TooShort { got: data.len(), need: 8 });
    }
    let magic = read_u32_be(data, 0);
    if magic != USM_STMID_CRID {
        return Err(FormatError::BadMagic { format: "USM/CRID" });
    }

    let mut video_data = Vec::new();
    let mut audio_tracks: Vec<Vec<u8>> = Vec::new();
    let mut video_codec = VideoCodec::Unknown;
    let width = 0u32;
    let height = 0u32;
    let frame_rate = 0u32;
    let mut frame_count = 0u32;

    let mut pos = 0usize;
    while pos + 8 <= data.len() {
        let stmid = read_u32_be(data, pos);
        let data_size = read_u32_be(data, pos + 4) as usize;
        let block_total = 8 + data_size;

        if block_total < 8 || pos + block_total > data.len() {
            break;
        }

        // En-tête de bloc CRI USM (Sofdec2) : `data_offset` u8 @0x09 (depuis 0x08),
        // `padding` u16 BE @0x0A, `channel` u8 @0x0C, `block_type` u8 @0x0F
        // (0 = données, 1 = header, 2 = fin de section, 3 = métadonnées/seek). Le flux
        // H.264 Annex-B (AUD + SPS + PPS + slices) vit dans les blocs `type == 0`.
        if data_size >= 0x18 {
            let data_offset = data[pos + 0x09] as usize;
            let padding = read_u16_be(data, pos + 0x0A) as usize;
            let channel_no = data[pos + 0x0C] as usize;
            let block_type = data[pos + 0x0F];

            let payload_start_abs = pos + 8 + data_offset;
            let payload_avail = data_size.saturating_sub(data_offset).saturating_sub(padding);

            if block_type == 0
                && payload_avail > 0
                && payload_start_abs + payload_avail <= data.len()
            {
                let payload = &data[payload_start_abs..payload_start_abs + payload_avail];

                if stmid == USM_STMID_SFV {
                    if video_codec == VideoCodec::Unknown && payload.len() >= 5 {
                        // H.264 Annex-B : start-code `00 00 00 01` en tête de bloc.
                        video_codec = if payload.starts_with(&[0, 0, 0, 1]) {
                            VideoCodec::H264
                        } else {
                            VideoCodec::Vp9
                        };
                    }
                    video_data.extend_from_slice(payload);
                    frame_count += 1;
                } else if stmid == USM_STMID_SFA {
                    while audio_tracks.len() <= channel_no {
                        audio_tracks.push(Vec::new());
                    }
                    audio_tracks[channel_no].extend_from_slice(payload);
                }
            }
        }

        pos += block_total;
    }

    Ok(UsmResult {
        video_codec,
        video_data,
        audio_tracks,
        width,
        height,
        frame_rate,
        frame_count,
    })
}

// ── Détection de format audio ─────────────────────────────────────────────────

/// Détecte si un slice commence par un en-tête ADX valide.
#[must_use]
pub fn is_adx(data: &[u8]) -> bool {
    data.len() >= 4 && data[0] == 0x80 && data[1] == 0x00
}

/// Détecte si un slice commence par un en-tête HCA valide.
///
/// Accepte les deux formes : le magic clair `HCA\0` **et** le magic **masqué**
/// `0xC8 0xC3 0xC1` (`'HCA' | 0x80` octet par octet), utilisé par tous les HCA
/// d'IEVR. On ne dé-masque PAS le tampon ici (cridecoder le fait en interne) —
/// on reconnaît seulement l'entrée comme HCA.
#[must_use]
pub fn is_hca(data: &[u8]) -> bool {
    data.len() >= 3 && (&data[..3] == b"HCA" || data[..3] == [0xC8, 0xC3, 0xC1])
}

// ─────────────────────────────────────────────────────────────────────────────
// Décodage audio → WAV (feature `audio-decode`, tire `cridecoder` std).
//
// SOURCE UNIQUE du workspace (dédup Phase 1d) : le décode HCA chiffré IEVR + le
// dispatch HCA/ADX/AWB/ACB → WAV vivaient DUPLIQUÉS dans nie-model-serve (`/audio`)
// ET nie-wasm (`audio_to_wav`). Centralisés ici, les deux callers délèguent.
// Gardé derrière une feature off-par-défaut : `cridecoder` (std) ne doit pas alourdir
// le build par défaut de nie-formats. `cridecoder` en `default-features=false` compile
// en wasm32 (nie-wasm le prouve), donc la feature est utilisable côté navigateur.
// ─────────────────────────────────────────────────────────────────────────────

/// Clé HCA principale d'IEVR (`ciph_type=56`), extraite du dump il2cpp
/// (`SoundPlayManager.DecryptionKey`). Valeur hex : `0x00D2997C0DC5EE72`.
#[cfg(feature = "audio-decode")]
pub const IEVR_HCA_KEY: u64 = 59_278_503_195_307_634;

/// Décode un flux HCA Criware chiffré (ciph_type=56) en PCM 16-bit entrelacé,
/// renvoie `(samples, channels, sample_rate)`.
///
/// `IEVR_HCA_KEY` est fixe ; `subkey` = sous-clé AWB (u16 LE @0x0E de l'AFS2), `0` pour
/// les HCA hors AWB. `set_encryption_key` DOIT être appelé avant la première trame.
#[cfg(feature = "audio-decode")]
pub fn hca_decode_to_pcm16(raw: &[u8], subkey: u16) -> Result<(Vec<i16>, u32, u32), String> {
    use cridecoder::{HcaDecoder, HcaDecoderError};
    use std::io::Cursor;

    let mut decoder =
        HcaDecoder::from_reader(Cursor::new(raw)).map_err(|e| format!("HCA init: {e}"))?;
    decoder.set_encryption_key(IEVR_HCA_KEY, u64::from(subkey));
    let info = decoder.info().clone();
    let channels = info.channel_count;
    let sample_rate = info.sampling_rate;
    let frame_samples = info.samples_per_block * info.channel_count as usize;
    let mut pcm_buf = vec![0i16; frame_samples];
    let mut all: Vec<i16> = Vec::with_capacity(info.block_count as usize * frame_samples);
    loop {
        match decoder.decode_frame_i16(&mut pcm_buf) {
            Ok(0) => {} // trame delay (encoder delay initial)
            Ok(n) => all.extend_from_slice(&pcm_buf[..n * channels as usize]),
            Err(HcaDecoderError::Eof) => break,
            Err(e) => return Err(format!("HCA frame: {e}")),
        }
    }
    Ok((all, channels, sample_rate))
}

/// Décode **une** entrée d'un AWB (AFS2) en WAV PCM16. `which` = index d'entrée (`?cue=N`) ;
/// par défaut (`None`) choisit l'entrée la **plus volumineuse** (pour une banque de voix, la 1re
/// entrée est souvent un court grognement, la plus grosse une vraie réplique). La sous-clé AWB
/// est propagée au déchiffrement HCA IEVR.
#[cfg(feature = "audio-decode")]
pub fn decode_awb_entry(data: &[u8], which: Option<usize>) -> Result<Vec<u8>, String> {
    let awb = Awb::parse(data).map_err(|e| format!("AWB parse: {e}"))?;
    if awb.entries.is_empty() {
        return Err("AWB sans entrée".into());
    }
    let subkey = awb.subkey;
    let mut order: Vec<usize> = (0..awb.entries.len()).collect();
    match which {
        Some(i) if i < awb.entries.len() => {
            order.retain(|&k| k != i);
            order.insert(0, i);
        }
        Some(i) => return Err(format!("cue {i} hors limites ({} entrées)", awb.entries.len())),
        None => order
            .sort_by_key(|&k| core::cmp::Reverse(awb.entry_bytes(data, &awb.entries[k]).len())),
    }
    for k in order {
        let entry = &awb.entries[k];
        let ed = awb.entry_bytes(data, entry);
        if ed.is_empty() {
            continue;
        }
        if is_hca(ed) {
            let (s, c, sr) =
                hca_decode_to_pcm16(ed, subkey).map_err(|e| format!("HCA cue={}: {e}", entry.cue_id))?;
            return Ok(encode_pcm16_wav(&s, c, sr));
        }
        if is_adx(ed) {
            let pcm = adx_decode(ed).map_err(|e| format!("ADX cue={}: {e}", entry.cue_id))?;
            return Ok(encode_pcm16_wav(&pcm.samples, pcm.channels, pcm.sample_rate));
        }
        if which.is_some() {
            return Err(format!("cue {k} non décodable (ni HCA ni ADX)"));
        }
    }
    Err("AWB : aucune entrée HCA/ADX valide".into())
}

/// Décode n'importe quel audio Criware (HCA/ADX direct, ou conteneur AWB/ACB) en WAV PCM16.
/// Dispatch par magic. Point d'entrée unique de `/audio` (model-serve) et `audio_to_wav` (wasm).
#[cfg(feature = "audio-decode")]
pub fn decode_to_wav(raw: &[u8]) -> Result<Vec<u8>, String> {
    if is_hca(raw) {
        let (s, c, sr) = hca_decode_to_pcm16(raw, 0)?;
        return Ok(encode_pcm16_wav(&s, c, sr));
    }
    if is_adx(raw) {
        let pcm = adx_decode(raw).map_err(|e| format!("ADX: {e}"))?;
        return Ok(encode_pcm16_wav(&pcm.samples, pcm.channels, pcm.sample_rate));
    }
    if raw.starts_with(b"AFS2") {
        return decode_awb_entry(raw, None);
    }
    if raw.starts_with(b"@UTF") {
        let acb = acb_parse(raw).map_err(|e| format!("ACB parse: {e}"))?;
        if !acb.embedded_awb.is_empty() {
            return decode_awb_entry(&acb.embedded_awb, None);
        }
        return Err("ACB sans AWB embarqué".into());
    }
    Err(format!("format audio non reconnu (magic: {:02x?})", &raw[..raw.len().min(4)]))
}
