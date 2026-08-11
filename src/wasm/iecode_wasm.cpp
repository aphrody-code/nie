#ifdef IECODE_WASM

#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <emscripten/emscripten.h>

#include "iecode/ffi.h"

// ============================================================================
// WASM FFI Bridge - Zero-Copy Optimized
// ============================================================================
// This module provides Emscripten exports for all iecode FFI functions.
//
// Memory Model:
// - JavaScript allocates memory via Module._malloc() and passes pointers
// - C++ reads directly from those pointers (zero-copy)
// - Output buffers are allocated by iecode and returned as (ptr, size) pairs
// - JavaScript is responsible for freeing output buffers via Module._free()
//
// Design Principles:
// 1. No global buffers - eliminates memcpy overhead for large files
// 2. Direct pointer passing - JS allocates, C++ reads
// 3. Consistent with Rust FFI - same signatures as iecode-sys
// 4. Explicit memory ownership - "Allocate-in-C, Free-in-JS" contract
// ============================================================================

extern "C" {

// ============================================================================
// Memory Management Helpers
// ============================================================================

/// Allocates a buffer of the given size using the Emscripten heap allocator.
/// Equivalent to Module._malloc() in JavaScript.
/// The returned pointer must be freed with buffer_free() or Module._free().
EMSCRIPTEN_KEEPALIVE
uint8_t* buffer_alloc(size_t size) {
    return static_cast<uint8_t*>(std::malloc(size));
}

/// Frees a buffer previously allocated by buffer_alloc() or any iecode function.
/// This is a wrapper around iecode_free() for API consistency.
EMSCRIPTEN_KEEPALIVE
void buffer_free(void* ptr) {
    iecode_free(ptr);
}

/// Gets the version string of the iecode library.
/// Returns a static string - do not free.
EMSCRIPTEN_KEEPALIVE
const char* wasm_version() {
    return iecode_version();
}

// ============================================================================
// cfg.bin (T2B/RDBN) Parser
// ============================================================================

/// Parses a cfg.bin buffer (T2B or RDBN, auto-detected).
/// @param data Pointer to the input buffer (allocated by JS)
/// @param size Size of the input buffer
/// @return Opaque handle to the parse result, or nullptr on error
EMSCRIPTEN_KEEPALIVE
iecode_result_t* wasm_cfgbin_parse(const uint8_t* data, uint32_t size) {
    if (!data || size == 0) return nullptr;
    return iecode_cfgbin_parse(data, size);
}

/// Returns the JSON string from a parse result.
/// The string is tied to the handle lifetime - do not free.
EMSCRIPTEN_KEEPALIVE
const char* wasm_result_json(iecode_result_t* result) {
    if (!result) return nullptr;
    return iecode_result_json(result);
}

/// Returns the detected format: "t2b", "rdbn", or "unknown".
/// The string is tied to the handle lifetime - do not free.
EMSCRIPTEN_KEEPALIVE
const char* wasm_result_format(iecode_result_t* result) {
    if (!result) return nullptr;
    return iecode_result_format(result);
}

/// Frees a parse result handle.
EMSCRIPTEN_KEEPALIVE
void wasm_result_free(iecode_result_t* result) {
    iecode_result_free(result);
}

/// Serializes a CfgBinFile back to binary (original Level-5 format).
/// @param result Handle obtained via wasm_cfgbin_parse()
/// @param out_size Receives the size of the output buffer
/// @return Pointer to the allocated output buffer, or nullptr on error
///         The caller must free this buffer with buffer_free()
EMSCRIPTEN_KEEPALIVE
uint8_t* wasm_cfgbin_write(iecode_result_t* result, uint32_t* out_size) {
    if (!result || !out_size) return nullptr;

    uint8_t* out_buf = nullptr;
    uint32_t size = iecode_cfgbin_write(result, &out_buf);

    if (size == 0 || !out_buf) return nullptr;

    *out_size = size;
    return out_buf;
}

// ============================================================================
// G4TX (Textures)
// ============================================================================

/// Parses a G4TX file from a memory buffer.
/// @param data Pointer to the input buffer (allocated by JS)
/// @param size Size of the input buffer
/// @return Opaque handle, or nullptr on error
EMSCRIPTEN_KEEPALIVE
iecode_g4tx_t* wasm_g4tx_parse(const uint8_t* data, uint32_t size) {
    if (!data || size == 0) return nullptr;
    return iecode_g4tx_parse(data, size);
}

/// Returns the number of textures in the G4TX.
EMSCRIPTEN_KEEPALIVE
int32_t wasm_g4tx_count(iecode_g4tx_t* g4tx) {
    if (!g4tx) return 0;
    return iecode_g4tx_count(g4tx);
}

/// Decodes a texture to RGBA8 format.
/// @param g4tx Handle obtained via wasm_g4tx_parse()
/// @param idx Texture index
/// @param out_width Receives the texture width
/// @param out_height Receives the texture height
/// @param out_size Receives the buffer size (width * height * 4)
/// @return Pointer to RGBA8 buffer (size = width * height * 4), or nullptr on error
///         The caller must free this buffer with buffer_free()
EMSCRIPTEN_KEEPALIVE
uint8_t* wasm_g4tx_decode_rgba(iecode_g4tx_t* g4tx, int32_t idx,
                                int32_t* out_width, int32_t* out_height,
                                uint32_t* out_size) {
    if (!g4tx || !out_width || !out_height || !out_size) return nullptr;

    uint8_t* buf = iecode_g4tx_decode_rgba(g4tx, idx, out_width, out_height);
    if (!buf || *out_width <= 0 || *out_height <= 0) return nullptr;

    *out_size = static_cast<uint32_t>((*out_width) * (*out_height) * 4);
    return buf;
}

/// Returns JSON info for a texture.
/// The string is tied to the handle - do not free.
EMSCRIPTEN_KEEPALIVE
const char* wasm_g4tx_info(iecode_g4tx_t* g4tx, int32_t idx) {
    if (!g4tx) return nullptr;
    return iecode_g4tx_info(g4tx, idx);
}

/// Gets raw surface data (BCn compressed) for GPU upload.
/// @param g4tx Handle
/// @param idx Texture index
/// @param out_data Receives pointer to BCn data (valid while handle lives)
/// @param out_size Receives size of BCn data
/// @param out_width Receives texture width
/// @param out_height Receives texture height
/// @param out_format Receives BCn format (1=BC1, 3=BC3, 7=BC7, 0x1F=RGBA8)
/// @return 0 on success, -1 on error
EMSCRIPTEN_KEEPALIVE
int wasm_g4tx_get_surface(iecode_g4tx_t* g4tx, int32_t idx,
                           const uint8_t** out_data, uint32_t* out_size,
                           int32_t* out_width, int32_t* out_height,
                           int32_t* out_format) {
    if (!g4tx || !out_data || !out_size || !out_width || !out_height || !out_format)
        return -1;

    iecode_surface_t surface;
    int ret = iecode_g4tx_get_surface(g4tx, idx, &surface);
    if (ret != 0) return ret;

    *out_data = surface.data;
    *out_size = surface.data_size;
    *out_width = surface.width;
    *out_height = surface.height;
    *out_format = surface.format;
    return 0;
}

/// Converts BCn format value to DXGI_FORMAT for WebGPU/D3D11.
EMSCRIPTEN_KEEPALIVE
uint32_t wasm_bcn_to_dxgi(int32_t bcn_format) {
    return iecode_bcn_to_dxgi(bcn_format);
}

/// Frees a G4TX handle.
EMSCRIPTEN_KEEPALIVE
void wasm_g4tx_free(iecode_g4tx_t* g4tx) {
    iecode_g4tx_free(g4tx);
}

// ============================================================================
// Compression - Level-5
// ============================================================================

/// Decompresses LZ10 data.
/// @param input Pointer to compressed data (JS-allocated)
/// @param input_size Size of compressed data
/// @param out_size Receives decompressed size
/// @return Pointer to decompressed buffer, or nullptr on error
///         The caller must free this buffer with buffer_free()
EMSCRIPTEN_KEEPALIVE
uint8_t* wasm_decompress_lz10(const uint8_t* input, uint32_t input_size,
                               uint32_t* out_size) {
    if (!input || !out_size || input_size == 0) return nullptr;

    uint8_t* out_buf = nullptr;
    uint32_t size = iecode_lz10_decompress(input, input_size, &out_buf);

    if (size == 0 || !out_buf) return nullptr;

    *out_size = size;
    return out_buf;
}

/// Decompresses CRILAYLA data.
EMSCRIPTEN_KEEPALIVE
uint8_t* wasm_decompress_crilayla(const uint8_t* input, uint32_t input_size,
                                   uint32_t* out_size) {
    if (!input || !out_size || input_size == 0) return nullptr;

    uint8_t* out_buf = nullptr;
    uint32_t size = iecode_crilayla_decompress(input, input_size, &out_buf);

    if (size == 0 || !out_buf) return nullptr;

    *out_size = size;
    return out_buf;
}

/// Decompresses LZ4 block data.
/// @param decompressed_size Expected decompressed size (must be known in advance)
EMSCRIPTEN_KEEPALIVE
uint8_t* wasm_decompress_lz4(const uint8_t* input, uint32_t input_size,
                              uint32_t decompressed_size, uint32_t* out_size) {
    if (!input || !out_size || input_size == 0) return nullptr;

    uint8_t* out_buf = nullptr;
    uint32_t size = iecode_lz4_decompress(input, input_size, decompressed_size, &out_buf);

    if (size == 0 || !out_buf) return nullptr;

    *out_size = size;
    return out_buf;
}

/// Decompresses Level-5 data with automatic method detection.
EMSCRIPTEN_KEEPALIVE
uint8_t* wasm_decompress_level5(const uint8_t* input, uint32_t input_size,
                                 uint32_t* out_size) {
    if (!input || !out_size || input_size == 0) return nullptr;

    uint8_t* out_buf = nullptr;
    uint32_t size = iecode_level5_decompress(input, input_size, &out_buf);

    if (size == 0 || !out_buf) return nullptr;

    *out_size = size;
    return out_buf;
}

/// Detects the Level-5 compression method from the first byte.
/// Returns: 0=NONE, 1=LZ10, 2=HUFFMAN4, 3=HUFFMAN8, 4=RLE, 5=ZLIB
EMSCRIPTEN_KEEPALIVE
uint8_t wasm_detect_level5_method(const uint8_t* data, uint32_t size) {
    if (!data || size == 0) return 0;
    return iecode_level5_detect_method(data, size);
}

/// Reads the decompressed size from a Level-5 header.
EMSCRIPTEN_KEEPALIVE
uint32_t wasm_level5_decompressed_size(const uint8_t* data, uint32_t size) {
    if (!data || size == 0) return 0;
    return iecode_level5_decompressed_size(data, size);
}

/// Decompresses Huffman 4-bit data.
EMSCRIPTEN_KEEPALIVE
uint8_t* wasm_decompress_huffman4(const uint8_t* input, uint32_t input_size,
                                    uint32_t* out_size) {
    if (!input || !out_size || input_size == 0) return nullptr;

    uint8_t* out_buf = nullptr;
    uint32_t size = iecode_huffman4_decompress(input, input_size, &out_buf);

    if (size == 0 || !out_buf) return nullptr;

    *out_size = size;
    return out_buf;
}

/// Decompresses Huffman 8-bit data.
EMSCRIPTEN_KEEPALIVE
uint8_t* wasm_decompress_huffman8(const uint8_t* input, uint32_t input_size,
                                    uint32_t* out_size) {
    if (!input || !out_size || input_size == 0) return nullptr;

    uint8_t* out_buf = nullptr;
    uint32_t size = iecode_huffman8_decompress(input, input_size, &out_buf);

    if (size == 0 || !out_buf) return nullptr;

    *out_size = size;
    return out_buf;
}

/// Decompresses RLE data.
EMSCRIPTEN_KEEPALIVE
uint8_t* wasm_decompress_rle(const uint8_t* input, uint32_t input_size,
                              uint32_t* out_size) {
    if (!input || !out_size || input_size == 0) return nullptr;

    uint8_t* out_buf = nullptr;
    uint32_t size = iecode_rle_decompress(input, input_size, &out_buf);

    if (size == 0 || !out_buf) return nullptr;

    *out_size = size;
    return out_buf;
}

/// Decompresses ZLib/deflate data.
EMSCRIPTEN_KEEPALIVE
uint8_t* wasm_decompress_zlib(const uint8_t* input, uint32_t input_size,
                               uint32_t* out_size) {
    if (!input || !out_size || input_size == 0) return nullptr;

    uint8_t* out_buf = nullptr;
    uint32_t size = iecode_zlib_decompress(input, input_size, &out_buf);

    if (size == 0 || !out_buf) return nullptr;

    *out_size = size;
    return out_buf;
}

// ============================================================================
// InazumaLZSS
// ============================================================================

/// Checks if data uses InazumaLZSS compression (magic "SSZL").
/// Returns 1 if yes, 0 otherwise.
EMSCRIPTEN_KEEPALIVE
int wasm_is_inazuma_lzss(const uint8_t* data, uint32_t size) {
    if (!data || size == 0) return 0;
    return iecode_is_inazuma_lzss(data, size);
}

/// Decompresses InazumaLZSS data.
EMSCRIPTEN_KEEPALIVE
uint8_t* wasm_decompress_inazuma_lzss(const uint8_t* input, uint32_t input_size,
                                        uint32_t* out_size) {
    if (!input || !out_size || input_size == 0) return nullptr;

    uint8_t* out_buf = nullptr;
    uint32_t size = iecode_inazuma_lzss_decompress(input, input_size, &out_buf);

    if (size == 0 || !out_buf) return nullptr;

    *out_size = size;
    return out_buf;
}

// ============================================================================
// Crypto
// ============================================================================

/// Computes CRC32 of a buffer.
EMSCRIPTEN_KEEPALIVE
uint32_t wasm_crc32(const uint8_t* data, uint32_t size) {
    if (!data || size == 0) return 0;
    return iecode_crc32(data, size);
}

/// Decrypts/encrypts a buffer in-place using CRI XOR (symmetric).
/// The data is modified in-place.
EMSCRIPTEN_KEEPALIVE
void wasm_cri_decrypt(uint8_t* data, uint32_t size, uint32_t key) {
    if (!data || size == 0) return;
    iecode_cri_decrypt(data, size, key);
}

/// Derives a CRI key from a filename.
EMSCRIPTEN_KEEPALIVE
uint32_t wasm_cri_derive_key(const char* filename) {
    if (!filename) return 0;
    return iecode_cri_derive_key(filename);
}

// ============================================================================
// CPK Archive
// ============================================================================

/// Opens a CPK archive from a memory buffer.
EMSCRIPTEN_KEEPALIVE
iecode_cpk_t* wasm_cpk_open(const uint8_t* data, uint32_t size) {
    if (!data || size == 0) return nullptr;
    return iecode_cpk_open(data, size);
}

/// Returns the number of files in the CPK.
EMSCRIPTEN_KEEPALIVE
int32_t wasm_cpk_count(iecode_cpk_t* cpk) {
    if (!cpk) return 0;
    return iecode_cpk_count(cpk);
}

/// Returns the filename at index (static string, do not free).
EMSCRIPTEN_KEEPALIVE
const char* wasm_cpk_filename(iecode_cpk_t* cpk, int32_t idx) {
    if (!cpk) return nullptr;
    return iecode_cpk_filename(cpk, idx);
}

/// Extracts a file from the CPK by index.
/// @param out_size Receives the size of the extracted file
/// @return Pointer to the extracted buffer, or nullptr on error
///         The caller must free this buffer with buffer_free()
EMSCRIPTEN_KEEPALIVE
uint8_t* wasm_cpk_extract(iecode_cpk_t* cpk, int32_t idx, uint32_t* out_size) {
    if (!cpk || !out_size) return nullptr;
    return iecode_cpk_extract(cpk, idx, out_size);
}

/// Finds an entry by internal path. Returns index (>=0) or -1 if not found.
EMSCRIPTEN_KEEPALIVE
int32_t wasm_cpk_find_entry(iecode_cpk_t* cpk, const char* internal_path) {
    if (!cpk || !internal_path) return -1;
    return iecode_cpk_find_entry(cpk, internal_path);
}

/// Reads a specific file by internal path (e.g., "common/chara/chr001.g4tx").
/// @param out_size Receives the size of the file
/// @return Pointer to the file buffer (decrypted/decompressed), or nullptr
///         The caller must free this buffer with buffer_free()
EMSCRIPTEN_KEEPALIVE
uint8_t* wasm_cpk_read_file(iecode_cpk_t* cpk, const char* internal_path,
                             uint32_t* out_size) {
    if (!cpk || !internal_path || !out_size) return nullptr;
    return iecode_cpk_read_file(cpk, internal_path, out_size);
}

/// Gets the compressed size of an entry.
EMSCRIPTEN_KEEPALIVE
uint32_t wasm_cpk_entry_size(iecode_cpk_t* cpk, int32_t index) {
    if (!cpk) return 0;
    return iecode_cpk_entry_size(cpk, index);
}

/// Gets the decompressed size of an entry.
EMSCRIPTEN_KEEPALIVE
uint32_t wasm_cpk_entry_extract_size(iecode_cpk_t* cpk, int32_t index) {
    if (!cpk) return 0;
    return iecode_cpk_entry_extract_size(cpk, index);
}

/// Checks if an entry is compressed (1=yes, 0=no, -1=error).
EMSCRIPTEN_KEEPALIVE
int32_t wasm_cpk_entry_is_compressed(iecode_cpk_t* cpk, int32_t index) {
    if (!cpk) return -1;
    return iecode_cpk_entry_is_compressed(cpk, index);
}

/// Frees a CPK handle.
EMSCRIPTEN_KEEPALIVE
void wasm_cpk_free(iecode_cpk_t* cpk) {
    iecode_cpk_free(cpk);
}

// ============================================================================
// G4PK Archive
// ============================================================================

/// Opens a G4PK archive from a memory buffer.
EMSCRIPTEN_KEEPALIVE
iecode_g4pk_t* wasm_g4pk_open(const uint8_t* data, uint32_t size) {
    if (!data || size == 0) return nullptr;
    return iecode_g4pk_open(data, size);
}

/// Returns the number of files in the G4PK.
EMSCRIPTEN_KEEPALIVE
int32_t wasm_g4pk_count(iecode_g4pk_t* g4pk) {
    if (!g4pk) return 0;
    return iecode_g4pk_count(g4pk);
}

/// Returns the entry name at index (static string, do not free).
EMSCRIPTEN_KEEPALIVE
const char* wasm_g4pk_entry_name(iecode_g4pk_t* g4pk, int32_t idx) {
    if (!g4pk) return nullptr;
    return iecode_g4pk_entry_name(g4pk, idx);
}

/// Extracts a file from the G4PK by index.
/// @param out_size Receives the size of the extracted file
/// @return Pointer to the extracted buffer, or nullptr on error
///         The caller must free this buffer with buffer_free()
EMSCRIPTEN_KEEPALIVE
uint8_t* wasm_g4pk_extract(iecode_g4pk_t* g4pk, int32_t idx, uint32_t* out_size) {
    if (!g4pk || !out_size) return nullptr;
    return iecode_g4pk_extract(g4pk, idx, out_size);
}

/// Frees a G4PK handle.
EMSCRIPTEN_KEEPALIVE
void wasm_g4pk_free(iecode_g4pk_t* g4pk) {
    iecode_g4pk_free(g4pk);
}

// ============================================================================
// AWB (AFS2) Audio
// ============================================================================

/// Opens an AWB file from a memory buffer.
EMSCRIPTEN_KEEPALIVE
iecode_awb_t* wasm_awb_open(const uint8_t* data, uint32_t size) {
    if (!data || size == 0) return nullptr;
    return iecode_awb_open(data, size);
}

/// Returns the number of entries in the AWB.
EMSCRIPTEN_KEEPALIVE
int32_t wasm_awb_count(iecode_awb_t* awb) {
    if (!awb) return 0;
    return iecode_awb_count(awb);
}

/// Returns JSON info for an entry (static string tied to handle).
EMSCRIPTEN_KEEPALIVE
const char* wasm_awb_entry_info(iecode_awb_t* awb, int32_t idx) {
    if (!awb) return nullptr;
    return iecode_awb_entry_info(awb, idx);
}

/// Frees an AWB handle.
EMSCRIPTEN_KEEPALIVE
void wasm_awb_free(iecode_awb_t* awb) {
    iecode_awb_free(awb);
}

// ============================================================================
// ACB (Audio Container Binary)
// ============================================================================

/// Returns JSON info for an ACB file.
/// The returned string must be freed with buffer_free().
EMSCRIPTEN_KEEPALIVE
const char* wasm_acb_info(const uint8_t* data, uint32_t size) {
    if (!data || size == 0) return nullptr;
    return iecode_acb_info(data, size);
}

/// Extracts the embedded AWB from an ACB.
/// @param out_size Receives the size of the AWB buffer
/// @return Pointer to the AWB buffer, or nullptr on error
///         The caller must free this buffer with buffer_free()
EMSCRIPTEN_KEEPALIVE
uint8_t* wasm_acb_extract_awb(const uint8_t* data, uint32_t size, uint32_t* out_size) {
    if (!data || !out_size || size == 0) return nullptr;
    return iecode_acb_extract_awb(data, size, out_size);
}

// ============================================================================
// USM (Video)
// ============================================================================

/// Returns USM file metadata as JSON.
/// The returned string must be freed with buffer_free().
EMSCRIPTEN_KEEPALIVE
const char* wasm_usm_info(const uint8_t* data, uint32_t size) {
    if (!data || size == 0) return nullptr;
    return iecode_usm_info(data, size);
}

// ============================================================================
// G4MD (Model Metadata)
// ============================================================================

/// Parses a G4MD buffer and returns metadata as JSON.
/// The returned string must be freed with buffer_free().
EMSCRIPTEN_KEEPALIVE
const char* wasm_g4md_parse(const uint8_t* data, uint32_t size) {
    if (!data || size == 0) return nullptr;
    return iecode_g4md_parse(data, size);
}

// ============================================================================
// G4CM (Character Model Container)
// ============================================================================

/// Lists sub-files in a G4CM container as a JSON array.
/// The returned string must be freed with buffer_free().
EMSCRIPTEN_KEEPALIVE
const char* wasm_g4cm_list(const uint8_t* data, uint32_t size) {
    if (!data || size == 0) return nullptr;
    return iecode_g4cm_list(data, size);
}

// ============================================================================
// DDS
// ============================================================================

/// Checks if data is a valid DDS file (magic "DDS ").
/// Returns 1 if yes, 0 otherwise.
EMSCRIPTEN_KEEPALIVE
int wasm_dds_is_valid(const uint8_t* data, uint32_t size) {
    if (!data || size == 0) return 0;
    return iecode_dds_is_valid(data, size);
}

/// Returns DDS metadata as JSON.
/// The returned string must be freed with buffer_free().
EMSCRIPTEN_KEEPALIVE
const char* wasm_dds_info(const uint8_t* data, uint32_t size) {
    if (!data || size == 0) return nullptr;
    return iecode_dds_info(data, size);
}

// ============================================================================
// FNT (Font)
// ============================================================================

/// Returns FNT metadata as JSON.
/// The returned string must be freed with buffer_free().
EMSCRIPTEN_KEEPALIVE
const char* wasm_fnt_info(const uint8_t* data, uint32_t size) {
    if (!data || size == 0) return nullptr;
    return iecode_fnt_info(data, size);
}

// ============================================================================
// ANMx (Animation)
// ============================================================================

/// Checks if data is a valid ANMx file.
/// Returns 1 if yes, 0 otherwise.
EMSCRIPTEN_KEEPALIVE
int wasm_anm_is_valid(const uint8_t* data, uint32_t size) {
    if (!data || size == 0) return 0;
    return iecode_anm_is_valid(data, size);
}

/// Returns ANMx metadata as JSON.
/// The returned string must be freed with buffer_free().
EMSCRIPTEN_KEEPALIVE
const char* wasm_anm_info(const uint8_t* data, uint32_t size) {
    if (!data || size == 0) return nullptr;
    return iecode_anm_info(data, size);
}

// ============================================================================
// Event Text
// ============================================================================

/// Extracts event texts from a raw cfg.bin buffer as a JSON array.
/// The returned string must be freed with buffer_free().
EMSCRIPTEN_KEEPALIVE
const char* wasm_event_text_extract(const uint8_t* data, uint32_t size) {
    if (!data || size == 0) return nullptr;
    return iecode_event_text_extract(data, size);
}

// ============================================================================
// Format Detection
// ============================================================================

/// Detects file format from magic bytes.
/// Returns a readable name ("CPK", "G4TX", "RDBN", etc.) or "Unknown".
/// The returned string must be freed with buffer_free().
EMSCRIPTEN_KEEPALIVE
const char* wasm_detect_format(const uint8_t* data, uint32_t size) {
    if (!data || size == 0) return nullptr;
    return iecode_detect_format(data, size);
}

// ============================================================================
// VFS (Virtual File System)
// ============================================================================

/// Initializes the VFS from a game data directory.
/// @param game_data_dir Path to the "data/" folder
/// @return VFS handle, or nullptr on error
EMSCRIPTEN_KEEPALIVE
void* wasm_vfs_init(const char* game_data_dir) {
    if (!game_data_dir) return nullptr;
    return iecode_vfs_init(game_data_dir);
}

/// Shuts down the VFS and frees all resources.
EMSCRIPTEN_KEEPALIVE
void wasm_vfs_shutdown(void* vfs) {
    iecode_vfs_shutdown(vfs);
}

/// Finds which CPK contains an asset.
/// @param path Internal path (e.g., "data/common/chr/.../file.g4md")
/// @param cpk_out Buffer to receive the CPK name
/// @param cpk_out_size Size of cpk_out buffer
/// @return File size (>0 if found), 0 if not found, -1 on error
EMSCRIPTEN_KEEPALIVE
int32_t wasm_vfs_find(void* vfs, const char* path,
                       char* cpk_out, uint32_t cpk_out_size) {
    if (!vfs || !path || !cpk_out || cpk_out_size == 0) return -1;
    return iecode_vfs_find(vfs, path, cpk_out, cpk_out_size);
}

/// Reads a file directly from the appropriate CPK.
/// @param out_size Receives the size of the data
/// @return Pointer to the file buffer, or nullptr on error
///         The caller must free this buffer with buffer_free()
EMSCRIPTEN_KEEPALIVE
uint8_t* wasm_vfs_read(void* vfs, const char* path, uint32_t* out_size) {
    if (!vfs || !path || !out_size) return nullptr;
    return iecode_vfs_read(vfs, path, out_size);
}

/// Returns the number of assets indexed in the VFS.
EMSCRIPTEN_KEEPALIVE
uint32_t wasm_vfs_asset_count(void* vfs) {
    if (!vfs) return 0;
    return iecode_vfs_asset_count(vfs);
}

// ============================================================================
// UTF Parser (CriWare)
// ============================================================================

/// Parses a @UTF table from a buffer.
EMSCRIPTEN_KEEPALIVE
iecode_utf_t* wasm_utf_parse(const uint8_t* data, size_t size) {
    if (!data || size == 0) return nullptr;
    return iecode_utf_parse(data, size);
}

/// Frees a UTF handle.
EMSCRIPTEN_KEEPALIVE
void wasm_utf_free(iecode_utf_t* utf) {
    iecode_utf_free(utf);
}

/// Returns the number of rows in the UTF table.
EMSCRIPTEN_KEEPALIVE
uint32_t wasm_utf_row_count(iecode_utf_t* utf) {
    if (!utf) return 0;
    return iecode_utf_row_count(utf);
}

/// Returns the number of columns in the UTF table.
EMSCRIPTEN_KEEPALIVE
uint32_t wasm_utf_col_count(iecode_utf_t* utf) {
    if (!utf) return 0;
    return iecode_utf_col_count(utf);
}

/// Returns the name of a column (static string, do not free).
EMSCRIPTEN_KEEPALIVE
const char* wasm_utf_col_name(iecode_utf_t* utf, uint32_t col) {
    if (!utf) return nullptr;
    return iecode_utf_col_name(utf, col);
}

/// Returns a string value at (row, col), or nullptr if not a string.
/// The returned string is tied to the handle - do not free.
EMSCRIPTEN_KEEPALIVE
const char* wasm_utf_get_string(iecode_utf_t* utf, uint32_t row, uint32_t col) {
    if (!utf) return nullptr;
    return iecode_utf_get_string(utf, row, col);
}

/// Returns an integer value at (row, col), or 0 if not numeric.
EMSCRIPTEN_KEEPALIVE
int32_t wasm_utf_get_int(iecode_utf_t* utf, uint32_t row, uint32_t col) {
    if (!utf) return 0;
    return iecode_utf_get_int(utf, row, col);
}

/// Converts the entire UTF table to JSON.
/// @param out_json Receives a pointer to the JSON string
/// @return 0 on success, -1 on error
/// The returned string must be freed with buffer_free().
EMSCRIPTEN_KEEPALIVE
int wasm_utf_to_json(iecode_utf_t* utf, char** out_json) {
    if (!utf || !out_json) return -1;
    return iecode_utf_to_json(utf, out_json);
}

// ============================================================================
// G4RA (Animation Resource Archive)
// ============================================================================

/// Opens a G4RA archive from a buffer.
EMSCRIPTEN_KEEPALIVE
iecode_g4ra_t* wasm_g4ra_open(const uint8_t* data, size_t size) {
    if (!data || size == 0) return nullptr;
    return iecode_g4ra_open(data, size);
}

/// Frees a G4RA handle.
EMSCRIPTEN_KEEPALIVE
void wasm_g4ra_free(iecode_g4ra_t* ra) {
    iecode_g4ra_free(ra);
}

/// Returns the number of entries in the G4RA.
EMSCRIPTEN_KEEPALIVE
uint32_t wasm_g4ra_entry_count(iecode_g4ra_t* ra) {
    if (!ra) return 0;
    return iecode_g4ra_entry_count(ra);
}

/// Returns the name of an entry (static string, do not free).
EMSCRIPTEN_KEEPALIVE
const char* wasm_g4ra_entry_name(iecode_g4ra_t* ra, uint32_t idx) {
    if (!ra) return nullptr;
    return iecode_g4ra_entry_name(ra, idx);
}

/// Extracts raw data from an entry.
/// @param out Receives pointer to the data buffer
/// @param out_size Receives the size of the data
/// @return 0 on success, -1 on error
/// The returned buffer must be freed with buffer_free().
EMSCRIPTEN_KEEPALIVE
int wasm_g4ra_extract(iecode_g4ra_t* ra, uint32_t idx,
                       uint8_t** out, size_t* out_size) {
    if (!ra || !out || !out_size) return -1;
    return iecode_g4ra_extract(ra, idx, out, out_size);
}

// ============================================================================
// SIMULATION (IEVR Match) - Exported to WASM
// ============================================================================

#include "iecode/game/soccer/ball_component.h"
#include "iecode/game/soccer/soccer_player_component.h"
#include "iecode/game/soccer/csoccer_ctrl.h"

#include <vector>

struct wasm_sim_match_t {
    game::BallComponent ball;
    std::vector<game::SoccerPlayerComponent> players;
    game::CSoccerTeamAi ai_home;
    game::CSoccerTeamAi ai_away;
    float clock_s = 0.0f;
    
    wasm_sim_match_t() {
        players.resize(22);
        
        ai_home.target_goal_x_ = +50.0f;
        ai_away.target_goal_x_ = -50.0f;
        
        ball.reset_at({0.0f, 0.0f, 0.0f});
        
        // Formations (scaled from SceneSoccer)
        const float gk[1]        = {0.0f};
        const float defenders[4] = {-20.0f, -7.0f, 7.0f, 20.0f};
        const float mids[4]      = {-20.0f, -7.0f, 7.0f, 20.0f};
        const float forwards[2]  = {-8.0f, 8.0f};

        auto push_line = [&](int team, int& idx, float x, const float* zs, int n) {
            for (int i = 0; i < n; ++i) {
                players[idx].player_id_ = (team == 0 ? 0 : 100) + idx;
                players[idx].team_id_ = team;
                players[idx].position_ = {x, 0.0f, zs[i]};
                players[idx].state_ = game::SoccerPlayerComponent::State::IDLE;
                idx++;
            }
        };

        int p_idx = 0;
        // Home
        push_line(0, p_idx, -45.0f, gk, 1);
        push_line(0, p_idx, -30.0f, defenders, 4);
        push_line(0, p_idx, -15.0f, mids, 4);
        push_line(0, p_idx, -5.0f, forwards, 2);
        
        // Away
        push_line(1, p_idx, +45.0f, gk, 1);
        push_line(1, p_idx, +30.0f, defenders, 4);
        push_line(1, p_idx, +15.0f, mids, 4);
        push_line(1, p_idx, +5.0f, forwards, 2);
    }
};

extern "C" {

EMSCRIPTEN_KEEPALIVE
wasm_sim_match_t* wasm_sim_kickoff() {
    return new wasm_sim_match_t();
}

EMSCRIPTEN_KEEPALIVE
void wasm_sim_advance(wasm_sim_match_t* match, float dt) {
    if (!match) return;
    match->clock_s += dt;
    
    // Split players array
    std::span<game::SoccerPlayerComponent> home_span(match->players.data(), 11);
    std::span<game::SoccerPlayerComponent> away_span(match->players.data() + 11, 11);
    
    match->ai_home.update_team(dt, match->ball, home_span);
    match->ai_away.update_team(dt, match->ball, away_span);
    
    // Physics
    for (auto& p : match->players) {
        p.update(dt);
    }
    match->ball.update_physics(dt);
}

// Memory layout exactly matches Rust Player struct + Ball
EMSCRIPTEN_KEEPALIVE
int wasm_sim_read_state(wasm_sim_match_t* match, float* out_positions) {
    if (!match || !out_positions) return 0;
    
    // out_positions needs to hold (22 + 1) * 2 = 46 floats (X, Z) scaled back to pitch units
    int out_idx = 0;
    for (int i = 0; i < 22; ++i) {
        // scale from 50x34 to 1.0x0.65 (divide by 50 approx)
        out_positions[out_idx++] = match->players[i].position_.x / 50.0f;
        out_positions[out_idx++] = match->players[i].position_.z / 50.0f;
    }
    
    out_positions[out_idx++] = match->ball.position_.x / 50.0f;
    out_positions[out_idx++] = match->ball.position_.z / 50.0f;
    
    return 23;
}

EMSCRIPTEN_KEEPALIVE
void wasm_sim_free(wasm_sim_match_t* match) {
    delete match;
}

} // extern "C"

#endif // IECODE_WASM
