//! Safe Rust wrappers around the raw iecode FFI.
//!
//! Every opaque C handle is wrapped in an RAII struct whose [`Drop`] impl calls
//! the corresponding `iecode_*_free` function. Methods return [`Option`] or
//! [`String`] instead of raw pointers.
//!
//! # Example
//!
//! ```no_run
//! use iecode_sys::safe::*;
//!
//! let data = std::fs::read("test.cfg.bin").unwrap();
//! if let Some(result) = cfgbin_parse(&data) {
//!     println!("format: {}", result.format());
//!     println!("json:   {}", result.json());
//! }
//! ```

use crate::*;
use std::ffi::{CStr, CString, c_char};
use std::path::Path;

// ── Helpers ────────────────────────────────────────────────────────

/// Converts a `*const c_char` that is owned by iecode (static / handle-bound)
/// to a `&str`. Returns `None` if the pointer is null.
///
/// # Safety
///
/// The pointer must be valid for the lifetime `'a` and point to a
/// null-terminated UTF-8 string.
unsafe fn static_cstr<'a>(ptr: *const c_char) -> Option<&'a str> {
    if ptr.is_null() {
        return None;
    }
    // SAFETY: caller guarantees validity.
    unsafe { CStr::from_ptr(ptr) }.to_str().ok()
}

/// Converts a `*const c_char` that was **allocated by iecode** into an owned
/// `String`, then frees the C buffer.
///
/// # Safety
///
/// The pointer must have been allocated by `iecode` (freeable with
/// `iecode_free`) and point to a null-terminated UTF-8 string.
unsafe fn owned_cstr(ptr: *const c_char) -> Option<String> {
    if ptr.is_null() {
        return None;
    }
    // SAFETY: caller guarantees the pointer is valid and null-terminated.
    let s = unsafe { CStr::from_ptr(ptr) }.to_str().ok()?.to_owned();
    unsafe { iecode_free(ptr as *mut u8) };
    Some(s)
}

/// Helper: turn a `Path` into a `CString`. Returns `None` if the path contains
/// interior nul bytes.
fn path_to_cstring(p: &Path) -> Option<CString> {
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt;
        CString::new(p.as_os_str().as_bytes()).ok()
    }
    #[cfg(not(unix))]
    {
        CString::new(p.to_str()?).ok()
    }
}

// ── Lifecycle ──────────────────────────────────────────────────────

/// Returns the iecode library version string.
pub fn version() -> String {
    // SAFETY: iecode_version returns a static string.
    unsafe { static_cstr(iecode_version()) }
        .unwrap_or("unknown")
        .to_owned()
}

// ── CfgBinResult (iecode_result_t) ─────────────────────────────────

/// RAII wrapper around `iecode_result_t`.
pub struct CfgBinResult {
    handle: *mut IecodeResult,
}

// SAFETY: The C handle is not thread-local; access is &self (immutable).
unsafe impl Send for CfgBinResult {}

impl CfgBinResult {
    /// Returns the parsed JSON representation.
    pub fn json(&self) -> &str {
        // SAFETY: handle is valid while self is alive; string is tied to handle.
        unsafe { static_cstr(iecode_result_json(self.handle)) }.unwrap_or("")
    }

    /// Returns the detected format (`"t2b"`, `"rdbn"`, or `"unknown"`).
    pub fn format(&self) -> &str {
        // SAFETY: same as above.
        unsafe { static_cstr(iecode_result_format(self.handle)) }.unwrap_or("unknown")
    }

    /// Serialises the parsed result back to binary (Level-5 format).
    /// Returns the raw bytes, or `None` on error.
    pub fn write_binary(&self) -> Option<Vec<u8>> {
        let mut out_ptr: *mut u8 = std::ptr::null_mut();
        // SAFETY: handle is valid.
        let size = unsafe { iecode_cfgbin_write(self.handle, &mut out_ptr) };
        if size == 0 || out_ptr.is_null() {
            return None;
        }
        // SAFETY: iecode allocated `size` bytes at out_ptr.
        let vec = unsafe { std::slice::from_raw_parts(out_ptr, size as usize) }.to_vec();
        unsafe { iecode_free(out_ptr) };
        Some(vec)
    }

    /// Returns the raw handle for advanced use. The handle is still owned by
    /// this struct and will be freed on drop.
    pub fn as_raw(&self) -> *const IecodeResult {
        self.handle
    }
}

impl Drop for CfgBinResult {
    fn drop(&mut self) {
        if !self.handle.is_null() {
            // SAFETY: we own the handle.
            unsafe { iecode_result_free(self.handle) };
        }
    }
}

/// Parses a cfg.bin buffer (T2B or RDBN, auto-detected).
pub fn cfgbin_parse(data: &[u8]) -> Option<CfgBinResult> {
    // SAFETY: data slice is valid for the duration of the call.
    let handle = unsafe { iecode_cfgbin_parse(data.as_ptr(), data.len() as u32) };
    if handle.is_null() {
        None
    } else {
        Some(CfgBinResult { handle })
    }
}

// ── G4txHandle (iecode_g4tx_t) ─────────────────────────────────────

/// RAII wrapper around `iecode_g4tx_t`.
pub struct G4txHandle {
    handle: *mut IecodeG4tx,
}

unsafe impl Send for G4txHandle {}

impl G4txHandle {
    /// Number of textures in the G4TX file.
    pub fn count(&self) -> i32 {
        // SAFETY: handle is valid.
        unsafe { iecode_g4tx_count(self.handle) }
    }

    /// JSON info for the texture at `idx`.
    pub fn info(&self, idx: i32) -> Option<&str> {
        // SAFETY: handle valid, returned string tied to handle lifetime.
        unsafe { static_cstr(iecode_g4tx_info(self.handle, idx)) }
    }

    /// Exports texture at `idx` to a PNG file. Returns `true` on success.
    pub fn export_png(&self, idx: i32, path: &Path) -> bool {
        let cpath = match path_to_cstring(path) {
            Some(c) => c,
            None => return false,
        };
        // SAFETY: handle valid, path is a valid C string.
        unsafe { iecode_g4tx_export_png(self.handle, idx, cpath.as_ptr()) != 0 }
    }

    /// Exports texture at `idx` to a WebP file. Returns `true` on success.
    pub fn export_webp(&self, idx: i32, path: &Path, quality: i32) -> bool {
        let cpath = match path_to_cstring(path) {
            Some(c) => c,
            None => return false,
        };
        // SAFETY: handle valid, path is a valid C string.
        unsafe { iecode_g4tx_export_webp(self.handle, idx, cpath.as_ptr(), quality) != 0 }
    }

    /// Decodes texture at `idx` to RGBA8 pixel data.
    /// Returns `(width, height, pixels)` or `None`.
    pub fn decode_rgba(&self, idx: i32) -> Option<(i32, i32, Vec<u8>)> {
        let mut w: i32 = 0;
        let mut h: i32 = 0;
        // SAFETY: handle valid, out-pointers are valid stack locals.
        let ptr = unsafe { iecode_g4tx_decode_rgba(self.handle, idx, &mut w, &mut h) };
        if ptr.is_null() || w <= 0 || h <= 0 {
            return None;
        }
        let len = (w as usize) * (h as usize) * 4;
        // SAFETY: iecode allocated `len` bytes at ptr.
        let pixels = unsafe { std::slice::from_raw_parts(ptr, len) }.to_vec();
        unsafe { iecode_free(ptr) };
        Some((w, h, pixels))
    }
}

impl Drop for G4txHandle {
    fn drop(&mut self) {
        if !self.handle.is_null() {
            unsafe { iecode_g4tx_free(self.handle) };
        }
    }
}

/// Parses a G4TX texture file from a byte buffer.
pub fn g4tx_parse(data: &[u8]) -> Option<G4txHandle> {
    let handle = unsafe { iecode_g4tx_parse(data.as_ptr(), data.len() as u32) };
    if handle.is_null() {
        None
    } else {
        Some(G4txHandle { handle })
    }
}

// ── CpkHandle (iecode_cpk_t) ──────────────────────────────────────

/// RAII wrapper around `iecode_cpk_t`.
pub struct CpkHandle {
    handle: *mut IecodeCpk,
}

unsafe impl Send for CpkHandle {}

impl CpkHandle {
    /// Number of files in the CPK archive.
    pub fn count(&self) -> i32 {
        unsafe { iecode_cpk_count(self.handle) }
    }

    /// Filename of the entry at `idx`.
    pub fn filename(&self, idx: i32) -> Option<&str> {
        unsafe { static_cstr(iecode_cpk_filename(self.handle, idx)) }
    }

    /// Extracts the file at `idx` as a byte vector.
    pub fn extract(&self, idx: i32) -> Option<Vec<u8>> {
        let mut out_size: u32 = 0;
        let ptr = unsafe { iecode_cpk_extract(self.handle, idx, &mut out_size) };
        if ptr.is_null() || out_size == 0 {
            return None;
        }
        let vec = unsafe { std::slice::from_raw_parts(ptr, out_size as usize) }.to_vec();
        unsafe { iecode_free(ptr) };
        Some(vec)
    }
}

impl Drop for CpkHandle {
    fn drop(&mut self) {
        if !self.handle.is_null() {
            unsafe { iecode_cpk_free(self.handle) };
        }
    }
}

/// Opens a CPK archive from a memory buffer.
pub fn cpk_open(data: &[u8]) -> Option<CpkHandle> {
    let handle = unsafe { iecode_cpk_open(data.as_ptr(), data.len() as u32) };
    if handle.is_null() {
        None
    } else {
        Some(CpkHandle { handle })
    }
}

// ── G4pkHandle (iecode_g4pk_t) ─────────────────────────────────────

/// RAII wrapper around `iecode_g4pk_t`.
pub struct G4pkHandle {
    handle: *mut IecodeG4pk,
}

unsafe impl Send for G4pkHandle {}

impl G4pkHandle {
    /// Number of files in the G4PK archive.
    pub fn count(&self) -> i32 {
        unsafe { iecode_g4pk_count(self.handle) }
    }

    /// Entry name at `idx`.
    pub fn entry_name(&self, idx: i32) -> Option<&str> {
        unsafe { static_cstr(iecode_g4pk_entry_name(self.handle, idx)) }
    }

    /// Extracts the file at `idx` as a byte vector.
    pub fn extract(&self, idx: i32) -> Option<Vec<u8>> {
        let mut out_size: u32 = 0;
        let ptr = unsafe { iecode_g4pk_extract(self.handle, idx, &mut out_size) };
        if ptr.is_null() || out_size == 0 {
            return None;
        }
        let vec = unsafe { std::slice::from_raw_parts(ptr, out_size as usize) }.to_vec();
        unsafe { iecode_free(ptr) };
        Some(vec)
    }
}

impl Drop for G4pkHandle {
    fn drop(&mut self) {
        if !self.handle.is_null() {
            unsafe { iecode_g4pk_free(self.handle) };
        }
    }
}

/// Opens a G4PK archive from a memory buffer.
pub fn g4pk_open(data: &[u8]) -> Option<G4pkHandle> {
    let handle = unsafe { iecode_g4pk_open(data.as_ptr(), data.len() as u32) };
    if handle.is_null() {
        None
    } else {
        Some(G4pkHandle { handle })
    }
}

// ── AwbHandle (iecode_awb_t) ───────────────────────────────────────

/// RAII wrapper around `iecode_awb_t`.
pub struct AwbHandle {
    handle: *mut IecodeAwb,
}

unsafe impl Send for AwbHandle {}

impl AwbHandle {
    /// Number of entries in the AWB.
    pub fn count(&self) -> i32 {
        unsafe { iecode_awb_count(self.handle) }
    }

    /// JSON info for entry at `idx` (cue_id, offset, size).
    pub fn entry_info(&self, idx: i32) -> Option<&str> {
        unsafe { static_cstr(iecode_awb_entry_info(self.handle, idx)) }
    }

    /// Extracts all tracks to a directory. Returns the number of files extracted.
    pub fn extract_all(&self, output_dir: &Path) -> i32 {
        let cdir = match path_to_cstring(output_dir) {
            Some(c) => c,
            None => return 0,
        };
        unsafe { iecode_awb_extract_all(self.handle, cdir.as_ptr()) }
    }
}

impl Drop for AwbHandle {
    fn drop(&mut self) {
        if !self.handle.is_null() {
            unsafe { iecode_awb_free(self.handle) };
        }
    }
}

/// Opens an AWB (AFS2) file from a memory buffer.
pub fn awb_open(data: &[u8]) -> Option<AwbHandle> {
    let handle = unsafe { iecode_awb_open(data.as_ptr(), data.len() as u32) };
    if handle.is_null() {
        None
    } else {
        Some(AwbHandle { handle })
    }
}

// ── GameDbHandle (iecode_gamedb_t) ─────────────────────────────────

/// RAII wrapper around `iecode_gamedb_t`.
pub struct GameDbHandle {
    handle: *mut IecodeGameDb,
}

unsafe impl Send for GameDbHandle {}

impl GameDbHandle {
    /// Number of characters.
    pub fn chara_count(&self) -> i32 {
        unsafe { iecode_gamedb_chara_count(self.handle) }
    }

    /// Number of skills.
    pub fn skill_count(&self) -> i32 {
        unsafe { iecode_gamedb_skill_count(self.handle) }
    }

    /// Number of teams.
    pub fn team_count(&self) -> i32 {
        unsafe { iecode_gamedb_team_count(self.handle) }
    }

    /// Full database as JSON (cached by the C library).
    pub fn json(&self) -> Option<&str> {
        unsafe { static_cstr(iecode_gamedb_json(self.handle)) }
    }

    /// JSON for a character by index.
    pub fn chara_json(&self, idx: i32) -> Option<&str> {
        unsafe { static_cstr(iecode_gamedb_chara_json(self.handle, idx)) }
    }

    /// JSON for a skill by index.
    pub fn skill_json(&self, idx: i32) -> Option<&str> {
        unsafe { static_cstr(iecode_gamedb_skill_json(self.handle, idx)) }
    }

    /// Finds a character by `charaParamId` (e.g. `"0xABCD1234"`).
    /// Returns the index, or `None` if not found.
    pub fn find_chara(&self, chara_param_id: &str) -> Option<i32> {
        let cid = CString::new(chara_param_id).ok()?;
        let idx = unsafe { iecode_gamedb_find_chara(self.handle, cid.as_ptr()) };
        if idx < 0 { None } else { Some(idx) }
    }

    /// Finds a skill by `skillId`. Returns the index, or `None` if not found.
    pub fn find_skill(&self, skill_id: &str) -> Option<i32> {
        let cid = CString::new(skill_id).ok()?;
        let idx = unsafe { iecode_gamedb_find_skill(self.handle, cid.as_ptr()) };
        if idx < 0 { None } else { Some(idx) }
    }
}

impl Drop for GameDbHandle {
    fn drop(&mut self) {
        if !self.handle.is_null() {
            unsafe { iecode_gamedb_free(self.handle) };
        }
    }
}

/// Loads the complete game database from `data_root`.
/// If `load_text` is true, localised text is loaded (slower).
pub fn gamedb_load(data_root: &Path, load_text: bool) -> Option<GameDbHandle> {
    let croot = path_to_cstring(data_root)?;
    let handle = unsafe { iecode_gamedb_load(croot.as_ptr(), load_text as i32) };
    if handle.is_null() {
        None
    } else {
        Some(GameDbHandle { handle })
    }
}

// ── Compression (free functions) ───────────────────────────────────

/// Helper for decompression functions that follow the
/// `(data, size, out_buf) -> size` pattern.
unsafe fn decompress_generic(
    data: &[u8],
    f: unsafe extern "C" fn(*const u8, u32, *mut *mut u8) -> u32,
) -> Option<Vec<u8>> {
    let mut out_ptr: *mut u8 = std::ptr::null_mut();
    // SAFETY: data is a valid slice; out_ptr is a stack local.
    let size = unsafe { f(data.as_ptr(), data.len() as u32, &mut out_ptr) };
    if size == 0 || out_ptr.is_null() {
        return None;
    }
    // SAFETY: iecode allocated `size` bytes.
    let vec = unsafe { std::slice::from_raw_parts(out_ptr, size as usize) }.to_vec();
    unsafe { iecode_free(out_ptr) };
    Some(vec)
}

/// Decompresses LZ10 data.
pub fn lz10_decompress(data: &[u8]) -> Option<Vec<u8>> {
    // SAFETY: iecode_lz10_decompress follows the generic pattern.
    unsafe { decompress_generic(data, iecode_lz10_decompress) }
}

/// Decompresses CRILAYLA data.
pub fn crilayla_decompress(data: &[u8]) -> Option<Vec<u8>> {
    unsafe { decompress_generic(data, iecode_crilayla_decompress) }
}

/// Decompresses an LZ4 block. You must know the `decompressed_size` in advance.
pub fn lz4_decompress(data: &[u8], decompressed_size: u32) -> Option<Vec<u8>> {
    let mut out_ptr: *mut u8 = std::ptr::null_mut();
    let size = unsafe {
        iecode_lz4_decompress(data.as_ptr(), data.len() as u32, decompressed_size, &mut out_ptr)
    };
    if size == 0 || out_ptr.is_null() {
        return None;
    }
    let vec = unsafe { std::slice::from_raw_parts(out_ptr, size as usize) }.to_vec();
    unsafe { iecode_free(out_ptr) };
    Some(vec)
}

/// Decompresses Level-5 data with automatic method dispatch.
pub fn level5_decompress(data: &[u8]) -> Option<Vec<u8>> {
    unsafe { decompress_generic(data, iecode_level5_decompress) }
}

/// Level-5 compression method identifiers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Level5Method {
    /// No compression.
    None = 0,
    /// LZ10.
    Lz10 = 1,
    /// Huffman 4-bit.
    Huffman4 = 2,
    /// Huffman 8-bit.
    Huffman8 = 3,
    /// RLE.
    Rle = 4,
    /// ZLib / deflate.
    Zlib = 5,
}

impl Level5Method {
    /// Converts a raw byte to a `Level5Method`, returning `None` for unknown values.
    pub fn from_raw(v: u8) -> Option<Self> {
        match v {
            0 => Some(Self::None),
            1 => Some(Self::Lz10),
            2 => Some(Self::Huffman4),
            3 => Some(Self::Huffman8),
            4 => Some(Self::Rle),
            5 => Some(Self::Zlib),
            _ => Option::None,
        }
    }
}

/// Detects the Level-5 compression method from the header.
pub fn level5_detect_method(data: &[u8]) -> Option<Level5Method> {
    let raw = unsafe { iecode_level5_detect_method(data.as_ptr(), data.len() as u32) };
    Level5Method::from_raw(raw)
}

/// Reads the decompressed size from a Level-5 compression header.
pub fn level5_decompressed_size(data: &[u8]) -> u32 {
    unsafe { iecode_level5_decompressed_size(data.as_ptr(), data.len() as u32) }
}

/// Decompresses Huffman 4-bit data (Level-5 method #2).
pub fn huffman4_decompress(data: &[u8]) -> Option<Vec<u8>> {
    unsafe { decompress_generic(data, iecode_huffman4_decompress) }
}

/// Decompresses Huffman 8-bit data (Level-5 method #3).
pub fn huffman8_decompress(data: &[u8]) -> Option<Vec<u8>> {
    unsafe { decompress_generic(data, iecode_huffman8_decompress) }
}

/// Decompresses RLE data (Level-5 method #4).
pub fn rle_decompress(data: &[u8]) -> Option<Vec<u8>> {
    unsafe { decompress_generic(data, iecode_rle_decompress) }
}

/// Decompresses ZLib/deflate data (Level-5 method #5).
pub fn zlib_decompress(data: &[u8]) -> Option<Vec<u8>> {
    unsafe { decompress_generic(data, iecode_zlib_decompress) }
}

/// Checks whether data uses InazumaLZSS compression (magic `"SSZL"`).
pub fn is_inazuma_lzss(data: &[u8]) -> bool {
    unsafe { iecode_is_inazuma_lzss(data.as_ptr(), data.len() as u32) != 0 }
}

/// Decompresses InazumaLZSS data.
pub fn inazuma_lzss_decompress(data: &[u8]) -> Option<Vec<u8>> {
    unsafe { decompress_generic(data, iecode_inazuma_lzss_decompress) }
}

/// Decompresses data using automatic Level-5 method dispatch.
/// This is an alias for [`level5_decompress`] for discoverability.
pub fn decompress(data: &[u8]) -> Option<Vec<u8>> {
    level5_decompress(data)
}

// ── Crypto (free functions) ────────────────────────────────────────

/// Computes the CRC32 checksum of `data`.
pub fn crc32(data: &[u8]) -> u32 {
    unsafe { iecode_crc32(data.as_ptr(), data.len() as u32) }
}

/// Decrypts (or encrypts -- XOR is symmetric) `data` in place using a CRI key.
pub fn cri_decrypt(data: &mut [u8], key: u32) {
    unsafe { iecode_cri_decrypt(data.as_mut_ptr(), data.len() as u32, key) };
}

/// Derives a CRI encryption key from a filename.
pub fn cri_derive_key(filename: &str) -> Option<u32> {
    let cname = CString::new(filename).ok()?;
    Some(unsafe { iecode_cri_derive_key(cname.as_ptr()) })
}

// ── ACB (free functions) ───────────────────────────────────────────

/// Returns JSON info for an ACB file (name, cue_count, cue_names, ...).
pub fn acb_info(data: &[u8]) -> Option<String> {
    unsafe { owned_cstr(iecode_acb_info(data.as_ptr(), data.len() as u32)) }
}

/// Extracts the embedded AWB from an ACB file.
pub fn acb_extract_awb(data: &[u8]) -> Option<Vec<u8>> {
    let mut out_size: u32 = 0;
    let ptr = unsafe { iecode_acb_extract_awb(data.as_ptr(), data.len() as u32, &mut out_size) };
    if ptr.is_null() || out_size == 0 {
        return None;
    }
    let vec = unsafe { std::slice::from_raw_parts(ptr, out_size as usize) }.to_vec();
    unsafe { iecode_free(ptr) };
    Some(vec)
}

// ── USM (free functions) ───────────────────────────────────────────

/// Returns USM video metadata as a JSON string.
pub fn usm_info(data: &[u8]) -> Option<String> {
    unsafe { owned_cstr(iecode_usm_info(data.as_ptr(), data.len() as u32)) }
}

/// Demuxes a USM file to `output_dir`. Returns bytes written, or `None` on error.
pub fn usm_demux(data: &[u8], output_dir: &Path) -> Option<u64> {
    let cdir = path_to_cstring(output_dir)?;
    let bytes = unsafe { iecode_usm_demux(data.as_ptr(), data.len() as u32, cdir.as_ptr()) };
    if bytes == 0 { None } else { Some(bytes) }
}

// ── G4MD (free functions) ──────────────────────────────────────────

/// Parses G4MD model metadata and returns JSON.
pub fn g4md_parse(data: &[u8]) -> Option<String> {
    unsafe { owned_cstr(iecode_g4md_parse(data.as_ptr(), data.len() as u32)) }
}

// ── G4CM (free functions) ──────────────────────────────────────────

/// Lists sub-files in a G4CM container as a JSON array.
pub fn g4cm_list(data: &[u8]) -> Option<String> {
    unsafe { owned_cstr(iecode_g4cm_list(data.as_ptr(), data.len() as u32)) }
}

/// Extracts all sub-files from a G4CM container to `output_dir`.
/// Returns the number of files extracted.
pub fn g4cm_extract(data: &[u8], output_dir: &Path) -> i32 {
    let cdir = match path_to_cstring(output_dir) {
        Some(c) => c,
        None => return 0,
    };
    unsafe { iecode_g4cm_extract(data.as_ptr(), data.len() as u32, cdir.as_ptr()) }
}

// ── DDS (free functions) ───────────────────────────────────────────

/// Checks whether `data` is a valid DDS file.
pub fn dds_is_valid(data: &[u8]) -> bool {
    unsafe { iecode_dds_is_valid(data.as_ptr(), data.len() as u32) != 0 }
}

/// Returns DDS metadata as JSON.
pub fn dds_info(data: &[u8]) -> Option<String> {
    unsafe { owned_cstr(iecode_dds_info(data.as_ptr(), data.len() as u32)) }
}

// ── FNT (free functions) ───────────────────────────────────────────

/// Returns FNT (font) metadata as JSON.
pub fn fnt_info(data: &[u8]) -> Option<String> {
    unsafe { owned_cstr(iecode_fnt_info(data.as_ptr(), data.len() as u32)) }
}

// ── ANMx (free functions) ──────────────────────────────────────────

/// Checks whether `data` is a valid ANMx animation file.
pub fn anm_is_valid(data: &[u8]) -> bool {
    unsafe { iecode_anm_is_valid(data.as_ptr(), data.len() as u32) != 0 }
}

/// Returns ANMx animation metadata as JSON.
pub fn anm_info(data: &[u8]) -> Option<String> {
    unsafe { owned_cstr(iecode_anm_info(data.as_ptr(), data.len() as u32)) }
}

// ── EventText (free functions) ─────────────────────────────────────

/// Extracts event texts from a raw cfg.bin buffer as a JSON array.
pub fn event_text_extract(data: &[u8]) -> Option<String> {
    unsafe { owned_cstr(iecode_event_text_extract(data.as_ptr(), data.len() as u32)) }
}

// ── Format detection ───────────────────────────────────────────────

/// Detects the format of `data` from its magic bytes.
/// Returns a readable name like `"CPK"`, `"G4TX"`, `"RDBN"`, etc.
pub fn detect_format(data: &[u8]) -> String {
    unsafe { owned_cstr(iecode_detect_format(data.as_ptr(), data.len() as u32)) }
        .unwrap_or_else(|| "Unknown".to_owned())
}

// ── Batch conversion ───────────────────────────────────────────────

/// Batch-converts all G4TX files in `input_dir` to the specified format.
///
/// * `format` -- `"png"`, `"webp"`, or `"dds"`.
/// * `threads` -- number of worker threads (`0` = auto).
/// * `recursive` -- search sub-directories.
/// * `flat` -- flatten output (no sub-directories).
///
/// Returns the number of files converted.
pub fn batch_convert(
    input_dir: &Path,
    output_dir: &Path,
    format: &str,
    threads: i32,
    recursive: bool,
    flat: bool,
) -> i32 {
    let cin = match path_to_cstring(input_dir) {
        Some(c) => c,
        None => return 0,
    };
    let cout = match path_to_cstring(output_dir) {
        Some(c) => c,
        None => return 0,
    };
    let cfmt = match CString::new(format) {
        Ok(c) => c,
        Err(_) => return 0,
    };
    unsafe {
        iecode_batch_convert(
            cin.as_ptr(),
            cout.as_ptr(),
            cfmt.as_ptr(),
            threads,
            recursive as i32,
            flat as i32,
        )
    }
}

// ── VFS ────────────────────────────────────────────────────────────

/// Virtual File System wrapper.
pub struct Vfs {
    ptr: *mut std::ffi::c_void,
}

impl Vfs {
    /// Initializes the VFS from a game data directory.
    pub fn init(game_data_dir: &Path) -> Result<Self, String> {
        let c_dir = path_to_cstring(game_data_dir)
            .ok_or_else(|| "Invalid game data directory path".to_string())?;

        let ptr = unsafe { crate::iecode_vfs_init(c_dir.as_ptr()) };
        if ptr.is_null() {
            return Err("Failed to initialize VFS".to_string());
        }

        Ok(Self { ptr })
    }

    /// Finds an asset in the VFS and returns the name of the CPK containing it.
    pub fn find(&self, path: &str) -> Option<String> {
        let c_path = CString::new(path).ok()?;
        let mut buf = vec![0u8; 256];
        let res = unsafe {
            crate::iecode_vfs_find(
                self.ptr,
                c_path.as_ptr(),
                buf.as_mut_ptr() as *mut _,
                buf.len(),
            )
        };

        if res != 0 {
            return None;
        }

        if let Ok(c_str) = unsafe { std::ffi::CStr::from_ptr(buf.as_ptr() as *const _) }.to_str() {
            Some(c_str.to_string())
        } else {
            None
        }
    }

    /// Reads an asset directly from the VFS.
    pub fn read(&self, path: &str) -> Option<Vec<u8>> {
        let c_path = CString::new(path).ok()?;
        let mut size = 0u32;
        let ptr = unsafe { crate::iecode_vfs_read(self.ptr, c_path.as_ptr(), &mut size) };

        if ptr.is_null() {
            return None;
        }

        let data = unsafe { std::slice::from_raw_parts(ptr, size as usize) }.to_vec();
        unsafe { crate::iecode_free(ptr) };
        Some(data)
    }

    /// Returns the total number of indexed assets.
    pub fn asset_count(&self) -> u32 {
        unsafe { crate::iecode_vfs_asset_count(self.ptr) }
    }
}

impl Drop for Vfs {
    fn drop(&mut self) {
        if !self.ptr.is_null() {
            unsafe { crate::iecode_vfs_shutdown(self.ptr) };
            self.ptr = std::ptr::null_mut();
        }
    }
}

