//! Safe Rust port of `FUN_14066371c` — CRILAYLA magic check.
//!
//! Original Ghidra source: `decomp/functions/crilayla_decompress.c`
//! Address: `0x14066371c`
//!
//! CriWare's CRILAYLA compression scheme prefixes its bitstream with the
//! 8-byte ASCII magic `"CRILAYLA"`. The native helper takes a `(void*, int)`
//! and returns 1 if the magic matches, 0 otherwise — including when the
//! buffer is shorter than the magic.
//!
//! In Rust this collapses to a single slice comparison.

#![forbid(unsafe_code)]

/// 8-byte CRILAYLA magic prefix.
pub const CRILAYLA_MAGIC: &[u8; 8] = b"CRILAYLA";

/// Returns `true` iff `buf` starts with the CRILAYLA magic.
///
/// Short buffers (fewer than 8 bytes) always return `false`.
pub fn has_crilayla_magic(buf: &[u8]) -> bool {
    buf.starts_with(CRILAYLA_MAGIC)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_exact_magic() {
        assert!(has_crilayla_magic(b"CRILAYLA"));
    }

    #[test]
    fn matches_magic_with_payload() {
        assert!(has_crilayla_magic(b"CRILAYLA\x00\x01\x02\x03"));
    }

    #[test]
    fn rejects_short_buffer() {
        assert!(!has_crilayla_magic(b""));
        assert!(!has_crilayla_magic(b"CRILAYL"));
    }

    #[test]
    fn rejects_other_magic() {
        assert!(!has_crilayla_magic(b"CPK \x00\x00\x00\x00"));
        assert!(!has_crilayla_magic(b"@UTF\x00\x00\x00\x00"));
        assert!(!has_crilayla_magic(b"crilayla")); // case sensitive
    }
}
