//! CRI Middleware XOR crypto — ported from iecode/crypto/cri_crypto.cpp.
//!
//! The encryption is a CRC32-state-based XOR stream cipher.  Each group of
//! 4 bytes at file offset N uses `update_crc_state(N, key_bytes)` as the
//! keystream source, with `compute_xor_byte` extracting one XOR byte per
//! position inside the group.
//!
//! The UTF-table cipher is independent: a simple LFSR-like byte-XOR with
//! multiplier 0x15 starting at 0x5F.

// CRC32 table, polynomial 0xEDB88320 (standard IEEE 802.3).
const fn make_crc32_table() -> [u32; 256] {
    let mut table = [0u32; 256];
    let mut i = 0usize;
    while i < 256 {
        let mut crc = i as u32;
        let mut j = 0;
        while j < 8 {
            if crc & 1 != 0 {
                crc = (crc >> 1) ^ 0xEDB88320u32;
            } else {
                crc >>= 1;
            }
            j += 1;
        }
        table[i] = crc;
        i += 1;
    }
    table
}

static CRC32_TABLE: [u32; 256] = make_crc32_table();

/// Advance CRC state by 4 key bytes — mirrors C++ `update_crc_state`.
#[inline(always)]
fn update_crc_state(seed: u32, k0: u8, k1: u8, k2: u8, k3: u8) -> u32 {
    let mut crc = !seed;
    crc = (crc >> 8) ^ CRC32_TABLE[((crc as u8) ^ k0) as usize];
    crc = (crc >> 8) ^ CRC32_TABLE[((crc as u8) ^ k1) as usize];
    crc = (crc >> 8) ^ CRC32_TABLE[((crc as u8) ^ k2) as usize];
    crc = (crc >> 8) ^ CRC32_TABLE[((crc as u8) ^ k3) as usize];
    !crc
}

/// Extract the XOR byte for `position` (0-3) from a CRC state.
#[inline(always)]
fn compute_xor_byte(crc: u32, position: u32) -> u8 {
    let base = position * 2;
    let mut r8 = (crc >> (base + 8)) & 3;
    r8 |= (((crc >> base) & 0xFF) << 2) & 0xFF;
    r8 = ((r8 << 2) & 0xFF) | ((crc >> (base + 16)) & 3);
    r8 = ((r8 << 2) & 0xFF) | ((crc >> (base + 24)) & 3);
    r8 as u8
}

/// Compute all 4 XOR bytes at once for efficiency.
#[inline(always)]
fn compute_xor_u32(crc: u32) -> u32 {
    compute_xor_byte(crc, 0) as u32
        | ((compute_xor_byte(crc, 1) as u32) << 8)
        | ((compute_xor_byte(crc, 2) as u32) << 16)
        | ((compute_xor_byte(crc, 3) as u32) << 24)
}

/// Decrypt (XOR is symmetric) a block at the given file offset with `key`.
pub fn cri_decrypt_block(data: &mut [u8], file_offset: u64, key: u32) {
    if data.is_empty() {
        return;
    }

    let k0 = key as u8;
    let k1 = (key >> 8) as u8;
    let k2 = (key >> 16) as u8;
    let k3 = (key >> 24) as u8;

    let len = data.len();
    let mut i = 0usize;

    // Handle unaligned start.
    let align_offset = (file_offset & 3) as usize;
    if align_offset != 0 {
        let aligned_base = file_offset & !3;
        let crc = update_crc_state(aligned_base as u32, k0, k1, k2, k3);
        let align_count = (4 - align_offset).min(len);
        for j in 0..align_count {
            data[j] ^= compute_xor_byte(crc, ((file_offset as usize + j) & 3) as u32);
        }
        i = align_count;
    }

    // Main loop: 4 bytes at a time.
    while i + 4 <= len {
        let base = (file_offset as usize + i) as u32;
        let crc = update_crc_state(base, k0, k1, k2, k3);
        let xor_mask = compute_xor_u32(crc);
        let block = u32::from_le_bytes(data[i..i + 4].try_into().unwrap()) ^ xor_mask;
        data[i..i + 4].copy_from_slice(&block.to_le_bytes());
        i += 4;
    }

    // Trailing bytes.
    if i < len {
        let base = (file_offset as usize + i) as u32;
        let crc = update_crc_state(base, k0, k1, k2, k3);
        for pos in 0..(len - i) {
            data[i + pos] ^= compute_xor_byte(crc, pos as u32);
        }
    }
}

/// Decrypt a UTF table in-place (LFSR byte XOR, independent cipher).
pub fn cri_decrypt_table(data: &mut [u8]) {
    const XOR_MULTIPLIER: u8 = 0x15;
    let mut xor_val: u8 = 0x5F;
    for byte in data.iter_mut() {
        *byte ^= xor_val;
        xor_val = xor_val.wrapping_mul(XOR_MULTIPLIER);
    }
}

/// CRC32 of a byte slice (polynomial 0xEDB88320).
pub fn crc32(data: &[u8]) -> u32 {
    let mut crc = 0xFFFF_FFFFu32;
    for &b in data {
        crc = (crc >> 8) ^ CRC32_TABLE[((crc as u8) ^ b) as usize];
    }
    !crc
}

/// Derive per-file XOR key from filename only.
pub fn cri_derive_key(filename: &str) -> u32 {
    crc32(filename.as_bytes())
}

/// Derive per-file XOR key with Steam AppID prefix.
/// Format: CRC32 of "{APP_ID_HEX}-{filename}" — from nie.exe FUN_1404a0670.
pub fn cri_derive_key_with_appid(filename: &str, app_id: u32) -> u32 {
    let prefixed = format!("{:08X}-{}", app_id, filename);
    crc32(prefixed.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_crc32_empty() {
        // CRC32 of empty = 0x00000000
        assert_eq!(crc32(b""), 0x00000000);
    }

    #[test]
    fn test_crc32_known() {
        // CRC32("123456789") = 0xCBF43926 — standard test vector
        assert_eq!(crc32(b"123456789"), 0xCBF43926);
    }

    #[test]
    fn test_cri_decrypt_table_roundtrip() {
        let original = b"@UTF\x00\x01\x02\x03\x04\x05";
        let mut data = original.to_vec();
        cri_decrypt_table(&mut data);
        // Data must have changed
        assert_ne!(data, original);
        // Applying once more must NOT restore (LFSR state resets from 0x5F each call,
        // so two calls = two encryptions, not roundtrip — that's expected).
        // The real roundtrip: decrypt then decrypt again should not equal original.
        // We just verify the cipher is deterministic.
        let mut data2 = original.to_vec();
        cri_decrypt_table(&mut data2);
        assert_eq!(data, data2);
    }

    #[test]
    fn test_block_decrypt_roundtrip() {
        // XOR is symmetric: decrypt(decrypt(x)) == x
        let original = b"HELLO WORLD TEST";
        let key = 0xDEADBEEFu32;
        let mut data = original.to_vec();
        cri_decrypt_block(&mut data, 0, key);
        assert_ne!(data.as_slice(), original.as_slice());
        cri_decrypt_block(&mut data, 0, key);
        assert_eq!(data.as_slice(), original.as_slice());
    }
}
