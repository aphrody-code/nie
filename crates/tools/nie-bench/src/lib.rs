//! Portable deterministic inputs shared by the repository benchmark harnesses.
//!
//! Wall-clock measurement and filesystem access stay in the `nie-bench` host binding. This
//! library owns the byte generator and bounded CRC sample used by every surface, including the
//! browser.

#![forbid(unsafe_code)]

use serde::Serialize;
use thiserror::Error;

/// Seed fixed by the cross-language benchmark protocol.
pub const BENCHMARK_SEED: u64 = 0x2545_F491_4F6C_DD1D;

/// Largest sample that an interactive caller may allocate in one request.
pub const MAX_SAMPLE_BYTES: usize = 16 * 1024 * 1024;

/// A precision-safe summary of one deterministic CRC32 input.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Crc32Sample {
    pub byte_length: usize,
    pub seed_hex: String,
    pub checksum_hex: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum BenchmarkInputError {
    #[error("sample length {requested} exceeds the {maximum}-byte limit")]
    SampleTooLarge { requested: usize, maximum: usize },
    #[error("a median requires at least one value")]
    EmptySample,
    #[error("median samples must be finite")]
    NonFiniteSample,
}

/// Fills a caller-owned buffer with the protocol's exact xorshift64* byte stream.
pub fn fill_xorshift(buffer: &mut [u8]) {
    let mut state = BENCHMARK_SEED;
    for chunk in buffer.chunks_mut(8) {
        state ^= state >> 12;
        state ^= state << 25;
        state ^= state >> 27;
        let value = state.wrapping_mul(BENCHMARK_SEED).to_le_bytes();
        chunk.copy_from_slice(&value[..chunk.len()]);
    }
}

/// Builds and hashes one bounded deterministic sample without a clock or host access.
pub fn crc32_sample(byte_length: usize) -> Result<Crc32Sample, BenchmarkInputError> {
    if byte_length > MAX_SAMPLE_BYTES {
        return Err(BenchmarkInputError::SampleTooLarge {
            requested: byte_length,
            maximum: MAX_SAMPLE_BYTES,
        });
    }
    let mut bytes = vec![0_u8; byte_length];
    fill_xorshift(&mut bytes);
    let checksum = nie_formats::cfgbin::crc32(&bytes);
    Ok(Crc32Sample {
        byte_length,
        seed_hex: format!("0x{BENCHMARK_SEED:016x}"),
        checksum_hex: format!("0x{checksum:08x}"),
    })
}

/// Returns the upper middle value used by the existing odd-sized benchmark protocol.
pub fn median(mut values: Vec<f64>) -> Result<f64, BenchmarkInputError> {
    if values.is_empty() {
        return Err(BenchmarkInputError::EmptySample);
    }
    if values.iter().any(|value| !value.is_finite()) {
        return Err(BenchmarkInputError::NonFiniteSample);
    }
    values.sort_by(f64::total_cmp);
    Ok(values[values.len() / 2])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generator_is_deterministic_and_keeps_the_protocol_prefix() {
        let mut first = [0_u8; 16];
        let mut second = [0_u8; 16];
        fill_xorshift(&mut first);
        fill_xorshift(&mut second);
        assert_eq!(first, second);
        assert_eq!(
            first,
            [
                212, 69, 93, 76, 11, 182, 93, 173, 110, 144, 7, 135, 93, 246, 218, 190
            ]
        );
    }

    #[test]
    fn crc_sample_is_bounded_and_precision_safe() {
        let report = crc32_sample(64).expect("small deterministic sample should be accepted");
        assert_eq!(report.byte_length, 64);
        assert_eq!(report.seed_hex, "0x2545f4914f6cdd1d");
        assert!(report.checksum_hex.starts_with("0x"));
        assert_eq!(report.checksum_hex.len(), 10);
        assert_eq!(
            crc32_sample(MAX_SAMPLE_BYTES + 1),
            Err(BenchmarkInputError::SampleTooLarge {
                requested: MAX_SAMPLE_BYTES + 1,
                maximum: MAX_SAMPLE_BYTES,
            })
        );
    }

    #[test]
    fn median_rejects_invalid_samples() {
        assert_eq!(median(vec![3.0, 1.0, 2.0]), Ok(2.0));
        assert_eq!(median(Vec::new()), Err(BenchmarkInputError::EmptySample));
        assert_eq!(
            median(vec![1.0, f64::NAN]),
            Err(BenchmarkInputError::NonFiniteSample)
        );
    }
}
