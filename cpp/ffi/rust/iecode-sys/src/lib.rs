//! Raw FFI bindings to libiecode — Level-5 / Inazuma Eleven Victory Road RE toolkit.
//!
//! This crate provides two layers:
//! - **Raw bindings** (`extern "C"` declarations) matching `iecode/ffi.h` one-to-one.
//! - **Safe wrappers** in the [`safe`] module with RAII handles, `Option`-based error
//!   handling, and zero-copy slices where possible.
//!
//! # Linking
//!
//! By default the crate links against `iecode.dll` / `libiecode.so` (dynamic).
//! Enable the `static-link` feature to link `iecode_core` statically instead.
//! Set `IECODE_LIB_DIR` to override the search path.

#![deny(unsafe_op_in_unsafe_fn)]

pub mod safe;

use std::ffi::{c_char, c_void};

// ── Opaque handle types ────────────────────────────────────────────

/// Opaque handle returned by cfg.bin parsing.
#[repr(C)]
pub struct IecodeResult {
    _private: [u8; 0],
}

/// Opaque handle for a parsed G4TX texture file.
#[repr(C)]
pub struct IecodeG4tx {
    _private: [u8; 0],
}

/// Opaque handle for an opened CPK archive.
#[repr(C)]
pub struct IecodeCpk {
    _private: [u8; 0],
}

/// Opaque handle for a loaded game database.
#[repr(C)]
pub struct IecodeGameDb {
    _private: [u8; 0],
}

/// Opaque handle for a parsed AWB (AFS2) file.
#[repr(C)]
pub struct IecodeAwb {
    _private: [u8; 0],
}

/// Opaque handle for a parsed G4PK archive.
#[repr(C)]
pub struct IecodeG4pk {
    _private: [u8; 0],
}

// ── Raw FFI declarations ───────────────────────────────────────────

unsafe extern "C" {
    // ── Lifecycle ──────────────────────────────────────────────────

    /// Returns the iecode version string (static, do not free).
    pub fn iecode_version() -> *const c_char;

    /// Frees a buffer previously allocated by iecode.
    pub fn iecode_free(ptr: *mut u8);

    // ── cfg.bin ────────────────────────────────────────────────────

    /// Parses a cfg.bin buffer (T2B or RDBN, auto-detected).
    /// Returns a handle, or null on error. Free with `iecode_result_free`.
    pub fn iecode_cfgbin_parse(data: *const u8, size: u32) -> *mut IecodeResult;

    /// Returns the JSON string from a parse result (static, do not free).
    pub fn iecode_result_json(result: *const IecodeResult) -> *const c_char;

    /// Returns the detected format: "t2b", "rdbn", or "unknown".
    pub fn iecode_result_format(result: *const IecodeResult) -> *const c_char;

    /// Frees a parse result handle.
    pub fn iecode_result_free(result: *mut IecodeResult);

    /// Serialises a CfgBinFile back to binary (original Level-5 format).
    /// Returns the size, or 0 on error. Free `out_buf` with `iecode_free`.
    pub fn iecode_cfgbin_write(
        result: *const IecodeResult,
        out_buf: *mut *mut u8,
    ) -> u32;

    // ── G4TX (textures) ────────────────────────────────────────────

    /// Parses a G4TX file. Returns a handle, or null. Free with `iecode_g4tx_free`.
    pub fn iecode_g4tx_parse(data: *const u8, size: u32) -> *mut IecodeG4tx;

    /// Returns the number of textures in the G4TX.
    pub fn iecode_g4tx_count(g4tx: *const IecodeG4tx) -> i32;

    /// Exports texture at `idx` to a PNG file. Returns non-zero on success.
    pub fn iecode_g4tx_export_png(
        g4tx: *const IecodeG4tx,
        idx: i32,
        output_path: *const c_char,
    ) -> i32;

    /// Exports texture at `idx` to a WebP file. Returns non-zero on success.
    pub fn iecode_g4tx_export_webp(
        g4tx: *const IecodeG4tx,
        idx: i32,
        output_path: *const c_char,
        quality: i32,
    ) -> i32;

    /// Decodes texture at `idx` to RGBA8.
    /// Returns an allocated buffer (width * height * 4 bytes). Free with `iecode_free`.
    pub fn iecode_g4tx_decode_rgba(
        g4tx: *const IecodeG4tx,
        idx: i32,
        out_width: *mut i32,
        out_height: *mut i32,
    ) -> *mut u8;

    /// Returns JSON info for texture at `idx` (static, do not free).
    pub fn iecode_g4tx_info(g4tx: *const IecodeG4tx, idx: i32) -> *const c_char;

    /// Frees a G4TX handle.
    pub fn iecode_g4tx_free(g4tx: *mut IecodeG4tx);

    // ── Compression ────────────────────────────────────────────────

    /// Decompresses LZ10 data. Returns decompressed size, 0 on error.
    /// Free `out_buf` with `iecode_free`.
    pub fn iecode_lz10_decompress(
        data: *const u8,
        size: u32,
        out_buf: *mut *mut u8,
    ) -> u32;

    /// Decompresses CRILAYLA data. Returns decompressed size, 0 on error.
    /// Free `out_buf` with `iecode_free`.
    pub fn iecode_crilayla_decompress(
        data: *const u8,
        size: u32,
        out_buf: *mut *mut u8,
    ) -> u32;

    /// Decompresses an LZ4 block. Returns decompressed size, 0 on error.
    /// Free `out_buf` with `iecode_free`.
    pub fn iecode_lz4_decompress(
        data: *const u8,
        size: u32,
        decompressed_size: u32,
        out_buf: *mut *mut u8,
    ) -> u32;

    // ── Level-5 Compression (unified dispatcher) ───────────────────

    /// Decompresses Level-5 data with automatic method dispatch.
    /// Returns decompressed size, 0 on error. Free `out_buf` with `iecode_free`.
    pub fn iecode_level5_decompress(
        data: *const u8,
        size: u32,
        out_buf: *mut *mut u8,
    ) -> u32;

    /// Detects the Level-5 compression method from the first byte.
    /// Returns: 0=NONE, 1=LZ10, 2=HUFFMAN4, 3=HUFFMAN8, 4=RLE, 5=ZLIB.
    pub fn iecode_level5_detect_method(data: *const u8, size: u32) -> u8;

    /// Reads the decompressed size from the Level-5 header.
    pub fn iecode_level5_decompressed_size(data: *const u8, size: u32) -> u32;

    // ── Huffman ────────────────────────────────────────────────────

    /// Decompresses Huffman 4-bit data (Level-5 method #2).
    /// Free `out_buf` with `iecode_free`.
    pub fn iecode_huffman4_decompress(
        data: *const u8,
        size: u32,
        out_buf: *mut *mut u8,
    ) -> u32;

    /// Decompresses Huffman 8-bit data (Level-5 method #3).
    /// Free `out_buf` with `iecode_free`.
    pub fn iecode_huffman8_decompress(
        data: *const u8,
        size: u32,
        out_buf: *mut *mut u8,
    ) -> u32;

    // ── RLE ────────────────────────────────────────────────────────

    /// Decompresses RLE data (Level-5 method #4).
    /// Free `out_buf` with `iecode_free`.
    pub fn iecode_rle_decompress(
        data: *const u8,
        size: u32,
        out_buf: *mut *mut u8,
    ) -> u32;

    // ── ZLib ───────────────────────────────────────────────────────

    /// Decompresses ZLib/deflate data (Level-5 method #5).
    /// Free `out_buf` with `iecode_free`.
    pub fn iecode_zlib_decompress(
        data: *const u8,
        size: u32,
        out_buf: *mut *mut u8,
    ) -> u32;

    // ── InazumaLZSS ───────────────────────────────────────────────

    /// Detects if data uses InazumaLZSS compression (magic "SSZL").
    /// Returns 1 if yes, 0 otherwise.
    pub fn iecode_is_inazuma_lzss(data: *const u8, size: u32) -> i32;

    /// Decompresses InazumaLZSS data. Returns decompressed size, 0 on error.
    /// Free `out_buf` with `iecode_free`.
    pub fn iecode_inazuma_lzss_decompress(
        data: *const u8,
        size: u32,
        out_buf: *mut *mut u8,
    ) -> u32;

    // ── Crypto ─────────────────────────────────────────────────────

    /// Computes CRC32 of a buffer.
    pub fn iecode_crc32(data: *const u8, size: u32) -> u32;

    /// Decrypts/encrypts a buffer in-place using CRI XOR (symmetric).
    pub fn iecode_cri_decrypt(data: *mut u8, size: u32, key: u32);

    /// Derives a CRI key from a filename.
    pub fn iecode_cri_derive_key(filename: *const c_char) -> u32;

    // ── CPK ────────────────────────────────────────────────────────

    /// Opens a CPK archive from a memory buffer. Returns a handle, or null.
    /// Free with `iecode_cpk_free`.
    pub fn iecode_cpk_open(data: *const u8, size: u32) -> *mut IecodeCpk;

    /// Returns the number of files in the CPK.
    pub fn iecode_cpk_count(cpk: *const IecodeCpk) -> i32;

    /// Returns the filename at index `idx` (static, do not free).
    pub fn iecode_cpk_filename(cpk: *const IecodeCpk, idx: i32) -> *const c_char;

    /// Extracts a file from the CPK by index.
    /// Returns an allocated buffer. Free with `iecode_free`.
    pub fn iecode_cpk_extract(
        cpk: *const IecodeCpk,
        idx: i32,
        out_size: *mut u32,
    ) -> *mut u8;

    /// Frees a CPK handle.
    pub fn iecode_cpk_free(cpk: *mut IecodeCpk);

    // ── G4PK ───────────────────────────────────────────────────────

    /// Parses a G4PK archive from a memory buffer. Returns a handle, or null.
    /// Free with `iecode_g4pk_free`.
    pub fn iecode_g4pk_open(data: *const u8, size: u32) -> *mut IecodeG4pk;

    /// Returns the number of files in the G4PK.
    pub fn iecode_g4pk_count(g4pk: *const IecodeG4pk) -> i32;

    /// Returns the entry name at index `idx` (static, do not free).
    pub fn iecode_g4pk_entry_name(g4pk: *const IecodeG4pk, idx: i32) -> *const c_char;

    /// Extracts a file from the G4PK by index.
    /// Returns an allocated buffer. Free with `iecode_free`.
    pub fn iecode_g4pk_extract(
        g4pk: *const IecodeG4pk,
        idx: i32,
        out_size: *mut u32,
    ) -> *mut u8;

    /// Frees a G4PK handle.
    pub fn iecode_g4pk_free(g4pk: *mut IecodeG4pk);

    // ── AWB (AFS2) ─────────────────────────────────────────────────

    /// Parses an AWB file from a memory buffer. Returns a handle, or null.
    /// Free with `iecode_awb_free`.
    pub fn iecode_awb_open(data: *const u8, size: u32) -> *mut IecodeAwb;

    /// Returns the number of entries in the AWB.
    pub fn iecode_awb_count(awb: *const IecodeAwb) -> i32;

    /// Returns JSON info for an entry (static, do not free).
    pub fn iecode_awb_entry_info(awb: *const IecodeAwb, idx: i32) -> *const c_char;

    /// Extracts all tracks to a directory. Returns the number of files extracted.
    pub fn iecode_awb_extract_all(awb: *const IecodeAwb, output_dir: *const c_char) -> i32;

    /// Frees an AWB handle.
    pub fn iecode_awb_free(awb: *mut IecodeAwb);

    // ── ACB ────────────────────────────────────────────────────────

    /// Returns JSON info for an ACB file. Free the returned string with `iecode_free`.
    pub fn iecode_acb_info(data: *const u8, size: u32) -> *const c_char;

    /// Extracts the embedded AWB from an ACB. Free with `iecode_free`.
    pub fn iecode_acb_extract_awb(
        data: *const u8,
        size: u32,
        out_size: *mut u32,
    ) -> *mut u8;

    // ── USM (video CRI Sofdec2) ────────────────────────────────────

    /// Returns USM file metadata as JSON. Free with `iecode_free`.
    pub fn iecode_usm_info(data: *const u8, size: u32) -> *const c_char;

    /// Demuxes a USM file to a directory. Returns bytes written, 0 on error.
    pub fn iecode_usm_demux(
        data: *const u8,
        size: u32,
        output_dir: *const c_char,
    ) -> u64;

    // ── G4MD (model metadata) ──────────────────────────────────────

    /// Parses a G4MD buffer and returns metadata as JSON. Free with `iecode_free`.
    pub fn iecode_g4md_parse(data: *const u8, size: u32) -> *const c_char;

    // ── G4CM (character model container) ───────────────────────────

    /// Lists sub-files in a G4CM container as a JSON array. Free with `iecode_free`.
    pub fn iecode_g4cm_list(data: *const u8, size: u32) -> *const c_char;

    /// Extracts all sub-files from a G4CM to a directory.
    /// Returns the number of files extracted.
    pub fn iecode_g4cm_extract(
        data: *const u8,
        size: u32,
        output_dir: *const c_char,
    ) -> i32;

    // ── DDS ────────────────────────────────────────────────────────

    /// Checks if data is a valid DDS file (magic "DDS "). Returns 1/0.
    pub fn iecode_dds_is_valid(data: *const u8, size: u32) -> i32;

    /// Returns DDS metadata as JSON. Free with `iecode_free`.
    pub fn iecode_dds_info(data: *const u8, size: u32) -> *const c_char;

    // ── FNT (font) ─────────────────────────────────────────────────

    /// Returns FNT metadata as JSON. Free with `iecode_free`.
    pub fn iecode_fnt_info(data: *const u8, size: u32) -> *const c_char;

    // ── ANMx (animation) ──────────────────────────────────────────

    /// Checks if data is a valid ANMx file. Returns 1/0.
    pub fn iecode_anm_is_valid(data: *const u8, size: u32) -> i32;

    /// Returns ANMx metadata as JSON. Free with `iecode_free`.
    pub fn iecode_anm_info(data: *const u8, size: u32) -> *const c_char;

    // ── EventText ──────────────────────────────────────────────────

    /// Extracts event texts from a raw cfg.bin buffer as a JSON array.
    /// Free with `iecode_free`.
    pub fn iecode_event_text_extract(data: *const u8, size: u32) -> *const c_char;

    // ── Format detection ───────────────────────────────────────────

    /// Detects file format from magic bytes.
    /// Returns a readable name ("CPK", "G4TX", "RDBN", etc.) or "Unknown".
    /// Free with `iecode_free`.
    pub fn iecode_detect_format(data: *const u8, size: u32) -> *const c_char;

    // ── Game Database ──────────────────────────────────────────────

    /// Loads a complete game database.
    /// `load_text` != 0 loads localised text (slower). Free with `iecode_gamedb_free`.
    pub fn iecode_gamedb_load(
        data_root: *const c_char,
        load_text: i32,
    ) -> *mut IecodeGameDb;

    /// Returns the number of characters in the database.
    pub fn iecode_gamedb_chara_count(db: *const IecodeGameDb) -> i32;

    /// Returns the number of skills in the database.
    pub fn iecode_gamedb_skill_count(db: *const IecodeGameDb) -> i32;

    /// Returns the number of teams in the database.
    pub fn iecode_gamedb_team_count(db: *const IecodeGameDb) -> i32;

    /// Returns the full database as JSON (cached, do not free).
    pub fn iecode_gamedb_json(db: *const IecodeGameDb) -> *const c_char;

    /// Returns JSON for a character by index (cached, do not free).
    pub fn iecode_gamedb_chara_json(db: *const IecodeGameDb, idx: i32) -> *const c_char;

    /// Returns JSON for a skill by index (cached, do not free).
    pub fn iecode_gamedb_skill_json(db: *const IecodeGameDb, idx: i32) -> *const c_char;

    /// Finds a character by charaParamId (e.g. "0xABCD1234"). Returns index, or -1.
    pub fn iecode_gamedb_find_chara(
        db: *const IecodeGameDb,
        chara_param_id: *const c_char,
    ) -> i32;

    /// Finds a skill by skillId. Returns index, or -1.
    pub fn iecode_gamedb_find_skill(
        db: *const IecodeGameDb,
        skill_id: *const c_char,
    ) -> i32;

    /// Frees a game database handle.
    pub fn iecode_gamedb_free(db: *mut IecodeGameDb);

    // ── Batch conversion ───────────────────────────────────────────

    /// Batch-converts all G4TX files in a directory to PNG/WebP/DDS.
    /// `threads` = 0 for auto. Returns the number of files converted.
    pub fn iecode_batch_convert(
        input_dir: *const c_char,
        output_dir: *const c_char,
        format: *const c_char,
        threads: i32,
        recursive: i32,
        flat: i32,
    ) -> i32;

    // ── VFS ────────────────────────────────────────────────────────

    /// Initializes the Virtual File System from the game data directory.
    pub fn iecode_vfs_init(game_data_dir: *const c_char) -> *mut c_void;

    /// Shuts down the Virtual File System.
    pub fn iecode_vfs_shutdown(vfs: *mut c_void);

    /// Finds an asset in the VFS.
    pub fn iecode_vfs_find(
        vfs: *mut c_void,
        path: *const c_char,
        out_cpk_name: *mut c_char,
        out_cpk_name_cap: usize,
    ) -> i32;

    /// Reads an asset from the VFS.
    pub fn iecode_vfs_read(
        vfs: *mut c_void,
        path: *const c_char,
        out_size: *mut u32,
    ) -> *mut u8;

    /// Gets the number of assets in the VFS.
    pub fn iecode_vfs_asset_count(vfs: *mut c_void) -> u32;

    // ── Simulation WASM (ievr_game) ──────────────────────────────────
    pub fn wasm_sim_kickoff() -> *mut c_void;
    pub fn wasm_sim_advance(match_ptr: *mut c_void, dt: f32);
    pub fn wasm_sim_read_state(match_ptr: *mut c_void, out_positions: *mut f32) -> i32;
    pub fn wasm_sim_free(match_ptr: *mut c_void);
}

