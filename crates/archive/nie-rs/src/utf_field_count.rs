//! Safe Rust port of `FUN_140663cf0` — UTF table field count helper.
//!
//! Original Ghidra source: `decomp/functions/utf_field_count.c`
//! Address: `0x140663cf0`
//!
//! CriWare UTF tables store their field count as a big-endian `u16` at
//! offset `0x18` of the table header. The original native function takes a
//! raw pointer + length and returns `0` when the buffer is too short to
//! contain the field-count word.
//!
//! In Rust we take a slice and return `None` for the "too short" case so
//! callers can distinguish an empty table from a malformed one.

#![forbid(unsafe_code)]

/// Offset of the big-endian `u16` field-count word inside a UTF table header.
const FIELD_COUNT_OFFSET: usize = 0x18;

/// Minimum header length that contains the field-count word.
const MIN_HEADER_LEN: usize = 0x1a;

/// Read the field count from a UTF table header.
///
/// Returns `None` if `buf` is shorter than [`MIN_HEADER_LEN`] (the original
/// native function returned `0` in this case, but `None` lets callers
/// disambiguate a legitimately empty table).
pub fn utf_field_count(buf: &[u8]) -> Option<u16> {
    if buf.len() < MIN_HEADER_LEN {
        return None;
    }
    Some(u16::from_be_bytes([
        buf[FIELD_COUNT_OFFSET],
        buf[FIELD_COUNT_OFFSET + 1],
    ]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_short_buffer() {
        assert!(utf_field_count(&[]).is_none());
        assert!(utf_field_count(&[0_u8; MIN_HEADER_LEN - 1]).is_none());
    }

    #[test]
    fn reads_be_u16_at_offset_0x18() {
        let mut buf = [0_u8; MIN_HEADER_LEN];
        buf[FIELD_COUNT_OFFSET] = 0x12;
        buf[FIELD_COUNT_OFFSET + 1] = 0x34;
        assert_eq!(utf_field_count(&buf), Some(0x1234));
    }

    #[test]
    fn accepts_minimum_header() {
        let buf = [0_u8; MIN_HEADER_LEN];
        assert_eq!(utf_field_count(&buf), Some(0));
    }

    #[test]
    fn ignores_trailing_bytes() {
        let mut buf = vec![0_u8; 1024];
        buf[FIELD_COUNT_OFFSET] = 0xff;
        buf[FIELD_COUNT_OFFSET + 1] = 0xff;
        assert_eq!(utf_field_count(&buf), Some(0xffff));
    }
}
