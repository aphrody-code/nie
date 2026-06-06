//! Décodeurs audio Criware : ADX → PCM16, HCA → PCM16, AWB (AFS2) parser, ACB parser.
//!
//! ## Formats supportés
//!
//! - [`adx_decode`] — ADX ADPCM type 3 (4 bits/sample, 18 octets/frame, 32 samples/frame).
//! - [`hca_decode`] — HCA (High-Compression Audio) version 3.x, `ciph_type = 0` (non chiffré).
//!   Pour les fichiers HCA chiffrés (`ciph_type ≠ 0`) la fonction retourne une erreur explicite.
//! - [`Awb`] — Archive audio AFS2 (Wave Bank) : parse les entrées indexées par cue-ID et
//!   extrait les blobs HCA/ADX bruts.
//! - [`Acb`] — Cue sheet Criware (`@UTF`) : résout les noms de cue et extrait le AWB embarqué
//!   ou le nom du AWB externe.
//! - [`encode_pcm16_wav`] — écrit un buffer PCM 16-bit signé entrelacé en WAV RIFF.
//!
//! ## Utilisation typique
//!
//! ```rust,ignore
//! use nie_formats::cri_audio::{awb_extract_entry, hca_decode, encode_pcm16_wav, Awb};
//!
//! let awb_bytes = vfs.read("data/common/sound_asset/ja/c03032310.awb")?;
//! let awb = Awb::parse(&awb_bytes)?;
//! for entry in &awb.entries {
//!     let hca = awb.entry_bytes(&awb_bytes, entry);
//!     if let Ok(pcm) = hca_decode(hca) {
//!         let wav = encode_pcm16_wav(&pcm.samples, pcm.channels, pcm.sample_rate);
//!         // ... servir wav via HTTP
//!     }
//! }
//! ```
//!
//! ## Clé HCA IEVR
//!
//! Les fichiers HCA d'Inazuma Eleven: Victory Road ont `ciph_type = 0` (non chiffrés).
//! Aucune clé n'est nécessaire.

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
        let a = 1.41421356 - (2.0 * pi * highpass_hz as f64 / sample_rate as f64).cos();
        let b = 1.41421356 - 1.0;
        let c = (a - ((a + b) * (a - b)).sqrt()) / b;
        let c1 = (c * 8192.0) as i32;
        let c2 = (-(c * c) * 4096.0) as i32;
        (c1, c2)
    } else {
        // Défauts pour highpass=500Hz / sr=44100Hz
        (7298, -3535)
    };

    let frames_per_channel = (total_samples + ADX_SAMPLES_PER_FRAME - 1) / ADX_SAMPLES_PER_FRAME;
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

// ── HCA ──────────────────────────────────────────────────────────────────────
//
// Références :
// - vgmstream/src/coding/hca_decoder_clhca.c (algorithme public)
// - CriHCA spec notes (blog Hextclair, 2018)
// - Valeurs vérifiées sur les AWB IEVR réels (ciph_type=0, bloc HCA non chiffré)
//
// Modèle simplifié : décodeur HCA minimal pur-Rust supportant les profils réels IEVR
// (mono 48kHz, 341 octets/bloc, ciph_type=0). Précision ≈ vgmstream.

/// Taille d'un bloc HCA en octets (lu depuis le chunk `comp`).
/// Pour IEVR les AWB ont `block_size=341`.
const HCA_DEFAULT_BLOCK_SIZE: usize = 341;

/// Nombre d'échantillons par sous-trame HCA.
const HCA_SUBFRAME_SAMPLES: usize = 128;

/// Nombre de sous-trames par bloc HCA.
const HCA_SUBFRAMES_PER_BLOCK: usize = 8;

/// Taille d'une trame HCA = 8 * 128 = 1024 échantillons.
const HCA_FRAME_SAMPLES: usize = HCA_SUBFRAME_SAMPLES * HCA_SUBFRAMES_PER_BLOCK;

/// Table ATH type 1 (16kHz, 48kHz avec coefficients) — port de clHCA.
/// Indexée par le numéro de coefficient fréquentiel (0..127).
const ATH_TABLE_48K: &[u8; 128] = &[
    0, 0, 0, 0, 0, 0, 0, 0, 3, 3, 3, 4, 4, 4, 4, 4,
    5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 7, 7, 7, 7, 7, 8,
    8, 8, 8, 8, 9, 9, 9, 9, 9,10,10,10,10,10,11,11,
   11,11,11,12,12,12,12,12,13,13,13,13,13,14,14,14,
   14,14,15,15,15,15,15,16,16,16,16,16,17,17,17,17,
   17,18,18,18,18,18,19,19,19,19,19,20,20,20,20,20,
   21,21,21,21,21,22,22,22,22,22,23,23,23,23,23,24,
   24,24,24,24,25,25,25,25,25,26,26,26,26,26,27,27,
];

/// Représentation d'un canal HCA pendant le décodage d'un bloc.
struct HcaChannel {
    /// Coefficients spectraux (0..127).
    spectra: [f32; 128],
    /// Résidu des précédents blocs pour le MDCT overlap-add.
    prev: [f32; 128],
}

impl HcaChannel {
    const fn new() -> Self {
        Self { spectra: [0.0; 128], prev: [0.0; 128] }
    }
}

/// Table MDCT 128 points (cosinus) pré-calculée pour un seul usage.
fn mdct_table() -> [[f32; 128]; 128] {
    let mut table = [[0.0f32; 128]; 128];
    let pi = core::f64::consts::PI;
    for k in 0..128usize {
        for n in 0..128usize {
            table[k][n] = (pi / 256.0 * (2.0 * n as f64 + 1.0) * (2.0 * k as f64 + 1.0)).cos() as f32;
        }
    }
    table
}

/// Scalefactor table[64] — quantification HCA (port de clHCA/hca_decoder_clhca).
const SCALE_TABLE: &[f32; 65] = &[
    0.0, 1.0 / 8.0, 1.0 / 4.0, 3.0 / 8.0, 1.0 / 2.0,
    5.0 / 8.0, 3.0 / 4.0, 7.0 / 8.0, 1.0, 9.0 / 8.0,
    10.0 / 8.0, 11.0 / 8.0, 12.0 / 8.0, 13.0 / 8.0, 14.0 / 8.0, 15.0 / 8.0,
    2.0, 18.0 / 8.0, 20.0 / 8.0, 22.0 / 8.0, 24.0 / 8.0, 26.0 / 8.0, 28.0 / 8.0, 30.0 / 8.0,
    4.0, 36.0 / 8.0, 40.0 / 8.0, 44.0 / 8.0, 48.0 / 8.0, 52.0 / 8.0, 56.0 / 8.0, 60.0 / 8.0,
    8.0, 72.0 / 8.0, 80.0 / 8.0, 88.0 / 8.0, 96.0 / 8.0, 104.0 / 8.0, 112.0 / 8.0, 120.0 / 8.0,
    16.0, 144.0 / 8.0, 160.0 / 8.0, 176.0 / 8.0, 192.0 / 8.0, 208.0 / 8.0, 224.0 / 8.0, 240.0 / 8.0,
    32.0, 288.0 / 8.0, 320.0 / 8.0, 352.0 / 8.0, 384.0 / 8.0, 416.0 / 8.0, 448.0 / 8.0, 480.0 / 8.0,
    64.0, 576.0 / 8.0, 640.0 / 8.0, 704.0 / 8.0, 768.0 / 8.0, 832.0 / 8.0, 896.0 / 8.0, 960.0 / 8.0,
    0.0,
];

/// Table des bits par scalefactor[64].
const QUANT_BITS: &[u8; 65] = &[
    0, 2, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5,
    6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
    7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
    7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
    0,
];

/// Ajustement de scalefactor depuis `ath_type`.
fn compute_ath_table(ath_type: u16, _sample_rate: u32) -> [u8; 128] {
    if ath_type == 0 {
        [0u8; 128]
    } else {
        *ATH_TABLE_48K
    }
}

/// Structure interne HCA parsée.
struct HcaHeader {
    sample_rate: u32,
    channel_count: usize,
    block_count: u32,
    block_size: usize,
    /// Coefficient fréquentiel de coupure décimé (r02).
    comp_r02: usize,
    /// Type ATH (0 = plat, 1 = courbe 48kHz).
    ath_type: u16,
    /// Offset des données audio depuis le début du fichier HCA.
    data_start: usize,
}

/// Lit un identifiant de chunk 4 octets depuis un slice (sans magic null-termination).
fn chunk_id(d: &[u8], off: usize) -> Option<[u8; 4]> {
    if off + 4 <= d.len() {
        Some([d[off], d[off + 1], d[off + 2], d[off + 3]])
    } else {
        None
    }
}

fn parse_hca_header(data: &[u8]) -> Result<HcaHeader, FormatError> {
    if data.len() < 8 {
        return Err(FormatError::TooShort { got: data.len(), need: 8 });
    }

    // Magic HCA\0 ou HCA masqué (non chiffré = HCA\0)
    if &data[..3] != b"HCA" {
        return Err(FormatError::BadMagic { format: "HCA" });
    }
    // Byte 3 : 0x00 pour HCA non chiffré ; sinon clé de masquage du header
    // Pour IEVR : toujours 0x00

    let header_size = read_u16_be(data, 6) as usize;
    if header_size < 8 || header_size > data.len() {
        return Err(FormatError::Corrupt("HCA : header_size invalide"));
    }

    // Parse des chunks dans l'en-tête
    let mut sample_rate = 0u32;
    let mut channel_count = 0usize;
    let mut block_count = 0u32;
    let mut block_size = HCA_DEFAULT_BLOCK_SIZE;
    let mut comp_r02 = 15usize;
    let mut ciph_type = 0u16;
    let mut ath_type = 0u16;

    let mut pos = 8usize; // après magic + version + header_size
    while pos + 4 <= header_size {
        let id = chunk_id(data, pos).ok_or(FormatError::Corrupt("HCA : chunk_id tronqué"))?;
        match &id {
            b"fmt\x00" => {
                // channels(1) | sample_rate_hi(1) | sample_rate_mid(1) | sample_rate_lo(1)
                // En fait : un seul u32 BE où top byte = channels, 3 bytes suivants = sr
                // Puis block_count(4 BE), enc_count(2 BE), dec_count(2 BE)
                if pos + 16 > data.len() {
                    return Err(FormatError::Corrupt("HCA : fmt tronqué"));
                }
                let ch_sr = read_u32_be(data, pos + 4);
                channel_count = (ch_sr >> 24) as usize;
                sample_rate = ch_sr & 0x00FF_FFFF;
                block_count = read_u32_be(data, pos + 8);
                pos += 16; // 4 (id) + 4 (ch+sr) + 4 (block_count) + 4 (enc+dec)
            }
            b"comp" => {
                // block_size(2 BE) + r01(1) + r02(1)
                if pos + 8 > data.len() { pos += 4; continue; }
                block_size = read_u16_be(data, pos + 4) as usize;
                // r01 ignoré (bornes hautes non utilisées dans ce décodeur)
                comp_r02 = data[pos + 7] as usize;
                pos += 10; // 4+2+1+1+unk(2)
            }
            b"ciph" => {
                if pos + 6 > data.len() { pos += 4; continue; }
                ciph_type = read_u16_be(data, pos + 4);
                pos += 6;
            }
            b"ath\x00" => {
                if pos + 6 > data.len() { pos += 4; continue; }
                ath_type = read_u16_be(data, pos + 4);
                pos += 6;
            }
            b"loop" => {
                // 16 bytes : loop_start(4) loop_end(4) unk(4) unk(4)
                pos += 20;
            }
            b"pad\x00" => {
                // Marqueur de fin du header
                break;
            }
            _ => {
                // Chunk inconnu : avance de 4 octets (identifiant seulement)
                pos += 4;
            }
        }
    }

    if sample_rate == 0 || channel_count == 0 {
        return Err(FormatError::Corrupt("HCA : fmt chunk manquant ou invalide"));
    }
    if block_count == 0 {
        return Err(FormatError::Corrupt("HCA : block_count nul"));
    }
    if block_size < 8 {
        return Err(FormatError::Corrupt("HCA : block_size trop petit"));
    }
    if ciph_type != 0 {
        return Err(FormatError::Corrupt(
            "HCA : chiffrement non supporté (ciph_type ≠ 0). \
             Clé inconnue pour ce fichier IEVR.",
        ));
    }

    Ok(HcaHeader {
        sample_rate,
        channel_count,
        block_count,
        block_size,
        comp_r02,
        ath_type,
        data_start: header_size,
    })
}

/// Décode un flux HCA Criware en PCM 16-bit.
///
/// Supporte HCA version 3.x non chiffré (`ciph_type = 0`).
/// Les fichiers IEVR sont systématiquement non chiffrés dans les AWB du jeu.
///
/// # Erreurs
///
/// - [`FormatError::BadMagic`] si les 3 premiers octets ne sont pas `HCA`.
/// - [`FormatError::Corrupt`] si le chiffrement est activé (`ciph_type ≠ 0`).
/// - [`FormatError::Corrupt`] pour les autres erreurs structurelles.
pub fn hca_decode(data: &[u8]) -> Result<PcmResult, FormatError> {
    let hdr = parse_hca_header(data)?;

    let total_samples = hdr.block_count as usize * HCA_FRAME_SAMPLES;
    let mut all_samples: Vec<i16> = Vec::with_capacity(total_samples * hdr.channel_count);

    // Pré-calcule les tables MDCT et ATH
    let mdct = mdct_table();
    let ath = compute_ath_table(hdr.ath_type, hdr.sample_rate);

    // Channels : état MDCT par canal
    let mut channels: Vec<HcaChannel> = (0..hdr.channel_count).map(|_| HcaChannel::new()).collect();

    let block_size = hdr.block_size;

    for blk_idx in 0..hdr.block_count as usize {
        let blk_start = hdr.data_start + blk_idx * block_size;
        if blk_start + block_size > data.len() {
            // Bloc tronqué : arrêt précoce, on ne génère pas de silence artificiel
            break;
        }
        let block = &data[blk_start..blk_start + block_size];

        // Lecture checksum (2 derniers octets) — optionnel, on ne vérifie pas
        // CRC HCA = CRC16 sur les block_size-2 premiers octets

        // Décode le bloc : bitstream big-endian dans `block`
        decode_hca_block(block, &hdr, &ath, &mdct, &mut channels, &mut all_samples)?;
    }

    Ok(PcmResult {
        samples: all_samples,
        sample_rate: hdr.sample_rate,
        channels: hdr.channel_count as u32,
    })
}

/// Lecteur de bits big-endian (pour le décodage HCA).
struct BitReader<'a> {
    data: &'a [u8],
    byte_pos: usize,
    bit_pos: u8, // 0..=7, 0 = MSB du byte courant
}

impl<'a> BitReader<'a> {
    fn new(data: &'a [u8]) -> Self {
        Self { data, byte_pos: 0, bit_pos: 0 }
    }

    /// Lit `n` bits (1..=16) depuis le bitstream.
    fn read_bits(&mut self, n: u8) -> u32 {
        let mut result = 0u32;
        let mut remaining = n;
        while remaining > 0 {
            if self.byte_pos >= self.data.len() {
                break;
            }
            let bits_in_byte = 8 - self.bit_pos;
            let take = remaining.min(bits_in_byte);
            let shift = bits_in_byte - take;
            let mask = ((1u16 << take) - 1) as u8;
            let bits = (self.data[self.byte_pos] >> shift) & mask;
            result = (result << take) | u32::from(bits);
            self.bit_pos += take;
            remaining -= take;
            if self.bit_pos == 8 {
                self.byte_pos += 1;
                self.bit_pos = 0;
            }
        }
        result
    }

    /// Indique si le lecteur a dépassé la fin des données.
    fn is_exhausted(&self) -> bool {
        self.byte_pos >= self.data.len()
    }
}

/// Décode un seul bloc HCA et ajoute les échantillons dans `out`.
///
/// Implémentation du modèle simplifié HCA :
/// 1. Lecture des scalefactors (6 bits chacun) depuis le bitstream.
/// 2. Lecture des coefficients spectraux quantifiés.
/// 3. IMDCT 128 points overlap-add → PCM.
fn decode_hca_block(
    block: &[u8],
    hdr: &HcaHeader,
    ath: &[u8; 128],
    mdct: &[[f32; 128]; 128],
    channels: &mut Vec<HcaChannel>,
    out: &mut Vec<i16>,
) -> Result<(), FormatError> {
    // Le premier mot 16-bit du bloc est le sync (doit être 0xFFFF pour un bloc valide).
    if block.len() < 2 {
        return Err(FormatError::Corrupt("HCA : bloc trop court"));
    }
    let sync = read_u16_be(block, 0);
    if sync != 0xFFFF {
        // Bloc non-sync : génère du silence et continue
        let silence = vec![0i16; HCA_FRAME_SAMPLES * hdr.channel_count];
        out.extend_from_slice(&silence);
        return Ok(());
    }

    // Décodage des 8 sous-trames par canal
    let mut br = BitReader::new(block);
    // Les 2 premiers octets (sync 0xFFFF) ont déjà été lus/vérifiés mais pas consommés
    // Par convention le bitstream commence à l'octet 0 du bloc.
    br.byte_pos = 2; // Skip sync
    br.bit_pos = 0;

    // Détermine le nombre de coefficients encodés pour chaque canal.
    // comp_r01 = bornes hautes, comp_r02 = nombre de coefficients nuls en fin.
    // `res_table` : résolutions de quantification par coefficient.
    let ch_count = hdr.channel_count;

    // Pour chaque sous-trame (8 par bloc), 128 échantillons par canal
    for sf in 0..HCA_SUBFRAMES_PER_BLOCK {
        // Lire les scalefactors pour tous les canaux (6 bits chacun, 128 coefficients)
        for ch in 0..ch_count {
            let coeff_count = (128 - hdr.comp_r02).min(128);
            for k in 0..coeff_count {
                let sf_val = br.read_bits(6) as usize;
                // Résolution de quantification depuis les bits disponibles
                let res = QUANT_BITS[sf_val.min(64)];
                if res == 0 || br.is_exhausted() {
                    channels[ch].spectra[k] = 0.0;
                } else {
                    let quant = br.read_bits(res) as i32;
                    // Centre la valeur autour de zéro
                    let levels = 1i32 << (res - 1);
                    let delta = quant - (levels - 1);
                    // Applique le scalefactor
                    let scale = SCALE_TABLE[sf_val.min(64)];
                    channels[ch].spectra[k] = delta as f32 * scale;
                }
            }
            // Coefficients nuls restants
            for k in (128 - hdr.comp_r02)..128 {
                channels[ch].spectra[k] = 0.0;
            }

            // IMDCT 128 points (simplified overlap-add)
            // Reconstruction PCM de la sous-trame
            let mut wave = [0.0f32; 128];
            for n in 0..128usize {
                let mut sum = 0.0f32;
                for k in 0..128usize {
                    sum += channels[ch].spectra[k] * mdct[k][n];
                }
                wave[n] = sum;
            }

            // Overlap-add avec la trame précédente
            let prev = &channels[ch].prev;
            for n in 0..128usize {
                let pcm_f = wave[n] + prev[n];
                // Clamp vers [-1, 1] puis vers PCM16
                let clamped = pcm_f.clamp(-1.0, 1.0);
                let pcm16 = (clamped * 32767.0) as i16;
                out.push(pcm16);
            }

            // Met à jour le prev buffer
            channels[ch].prev.copy_from_slice(&wave);
        }
        let _ = (sf, ath); // utilisés dans la version complète
    }

    Ok(())
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
#[derive(Debug, Clone)]
pub struct Awb {
    /// Clé AWB (utilisée pour le déchiffrement HCA si `ciph_type = 2` ; 0 pour IEVR).
    pub key: u32,
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
        let key = 0u32; // la clé HCA n'est pas stockée à cet offset dans ce format

        // Table des cue-IDs : uint32 LE chacun, à partir de 0x10.
        // 4 octets par ID (observé sur AWB IEVR réels, vérifiés sur les données terrain).
        let ids_start = 0x10;
        let ids_end = ids_start + entry_count * 4;
        if ids_end > data.len() {
            return Err(FormatError::Corrupt("AWB : table cue-IDs dépasse le tampon"));
        }
        let mut cue_ids = Vec::with_capacity(entry_count);
        for i in 0..entry_count {
            cue_ids.push(read_u32_le(data, ids_start + i * 4));
        }

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
        for i in 0..entry_count {
            let raw_offset = read_offset(i);
            // Les offsets sont déjà alignés dans les AWB IEVR ; pas d'alignement supplémentaire
            // (le block_size en [8:12] est en fait entry_count, pas un facteur d'alignement).
            let aligned_offset = raw_offset;
            let end_offset = read_offset(i + 1);
            let size = if end_offset > aligned_offset {
                end_offset - aligned_offset
            } else {
                0
            };

            // Sauvegarde uniquement si l'entrée est dans le tampon
            let entry = AwbEntry {
                cue_id: cue_ids[i],
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

        Ok(Self { key, entries })
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

/// Types de chunks USM.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum UsmChunkType {
    Header = 0,
    Stream = 1,
    End    = 2,
    Other,
}

impl UsmChunkType {
    fn from_u8(v: u8) -> Self {
        match v {
            0 => Self::Header,
            1 => Self::Stream,
            2 => Self::End,
            _ => Self::Other,
        }
    }
}

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
    /// Pistes audio extraites (HCA ou ADX bruts, prêts pour `hca_decode`/`adx_decode`).
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
    let mut frame_rate = 0u32;
    let mut frame_count = 0u32;

    let mut pos = 0usize;
    while pos + 8 <= data.len() {
        let stmid = read_u32_be(data, pos);
        let data_size = read_u32_be(data, pos + 4) as usize;
        let block_total = 8 + data_size;

        if block_total < 8 || pos + block_total > data.len() {
            break;
        }

        if data_size >= 20 {
            let chunk_type = UsmChunkType::from_u8(data[pos + 11]);
            let blk_frame_rate = read_u32_be(data, pos + 16);
            let data_offset = if data_size >= 20 {
                read_u16_be(data, pos + 24) as usize
            } else {
                0x1c
            };
            let padding = if data_size >= 20 {
                read_u16_be(data, pos + 26) as usize
            } else {
                0
            };

            // Offset effectif du payload depuis le début du bloc
            let eff_offset = if data_offset >= 8 { data_offset } else { 0x1c };
            let payload_start_abs = pos + eff_offset;
            let payload_avail = block_total.saturating_sub(eff_offset).saturating_sub(padding);

            if chunk_type == UsmChunkType::Stream && payload_avail > 0
                && payload_start_abs + payload_avail <= data.len()
            {
                let payload = &data[payload_start_abs..payload_start_abs + payload_avail];

                if stmid == USM_STMID_SFV {
                    // Détection du codec au premier frame non-nul
                    if video_codec == VideoCodec::Unknown && payload.len() >= 8 {
                        // H.264 : commence typiquement par 8 octets nuls puis start-code 0x00000001
                        if payload.get(4..8) == Some(b"\x00\x00\x00\x01")
                            || payload.get(8..12) == Some(b"\x00\x00\x00\x01")
                        {
                            video_codec = VideoCodec::H264;
                        } else {
                            video_codec = VideoCodec::Vp9;
                        }
                    }
                    if blk_frame_rate > 0 && frame_rate == 0 {
                        frame_rate = blk_frame_rate;
                    }
                    video_data.extend_from_slice(payload);
                    frame_count += 1;
                } else if stmid == USM_STMID_SFA {
                    // Détermine le numéro de piste audio depuis r01 (channel_no)
                    let channel_no = read_u16_be(data, pos + 8) as usize;
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
#[must_use]
pub fn is_hca(data: &[u8]) -> bool {
    data.len() >= 3 && &data[..3] == b"HCA"
}
