//! Static G4RA reference-animation bindings, without playback semantics.
//!
//! `FUN_140500b80` resolves state/resource hashes and skeletal/material targets.
//! `FUN_140501c80` joins 32-byte groups through a u16 index pool to 48-byte rows.
//! Section addresses are `(header_words + section_units) * 4`. The ordered-table
//! profile is verified against loading01; unsupported profiles fail closed.
//! Resource hashes resolve against motion **clip** hashes, not target hashes.
//! Row timing, blending, and flags remain exact uninterpreted bits.

use crate::{FormatError, level5};
use alloc::{string::ToString, vec::Vec};

pub const MAGIC: u32 = u32::from_le_bytes(*b"G4RA");
const MIN_HEADER: usize = 0x54;

/// One proven target/state/clip join. Hashes retain the native CRC32 identity.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
pub struct Binding {
    pub group_index: u16,
    /// Index within the corresponding skeletal or material row category.
    pub row_index: u16,
    pub target_hash: u32,
    pub state_hash: u32,
    pub clip_hash: u32,
    /// Exact little-endian words of the 48-byte record, including unknown fields.
    pub raw_words: [u32; 12],
}

impl Binding {
    /// Map native 60 Hz state ticks to a frame of the resolved motion clip.
    ///
    /// This is the bounded direct-motion path of `FUN_140504d60`. The caller
    /// supplies elapsed ticks including any native state-cycle accumulation;
    /// this helper does not advance state or derive elapsed time from a clock.
    /// Delay is measured in clip frames, before multiplying by row speed.
    /// The exact end frame is retained even for looping rows.
    ///
    /// Unknown loop-flag bits, invalid clip ranges, nonfinite values, and values
    /// outside the native integer wrap range return `None`.
    #[must_use]
    pub fn sample_frame(
        &self,
        elapsed_ticks_60hz: f32,
        clip_start: u16,
        clip_end: u16,
        clip_fps: u8,
    ) -> Option<f32> {
        let loop_flags = (self.raw_words[8] >> 24) as u8;
        let speed = f32::from_bits(self.raw_words[2]);
        if !elapsed_ticks_60hz.is_finite()
            || elapsed_ticks_60hz < 0.0
            || !speed.is_finite()
            || speed < 0.0
            || clip_end < clip_start
            || clip_fps == 0
            || loop_flags & !1 != 0
        {
            return None;
        }
        let range = u32::from(clip_end - clip_start);
        if range == 0 {
            return Some(f32::from(clip_start));
        }
        let delay = (self.raw_words[1] >> 16) as u16;
        // Keep native operation order: fps * (1/60), ticks, delay, speed.
        let relative =
            (f32::from(clip_fps) * 0.016_666_668 * elapsed_ticks_60hz - f32::from(delay)) * speed;
        if !relative.is_finite() {
            return None;
        }
        let frame = if relative <= 0.0 {
            0.0
        } else if relative <= range as f32 {
            relative
        } else if loop_flags == 0 {
            range as f32
        } else {
            // Native truncates the positive quotient, multiplies as an integer,
            // then subtracts. Reject overflow instead of inventing wrap behavior.
            let quotient = relative / range as f32;
            if quotient >= i32::MAX as f32 {
                return None;
            }
            let completed = (quotient as u32).checked_mul(range)?;
            relative - completed as f32
        };
        Some(f32::from(clip_start) + frame)
    }
}

/// Static skeletal and material joins; this is not an animation player.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
pub struct ReferenceAnimation {
    pub state_hashes: Vec<u32>,
    pub skeletal_bindings: Vec<Binding>,
    pub material_bindings: Vec<Binding>,
}

fn malformed(message: &str) -> FormatError {
    FormatError::Malformed(message.to_string())
}

fn u16_at(data: &[u8], offset: usize) -> usize {
    usize::from(u16::from_le_bytes([data[offset], data[offset + 1]]))
}

fn u32_at(data: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(
        data[offset..offset + 4]
            .try_into()
            .expect("validated table"),
    )
}

fn table_fits(start: usize, count: usize, stride: usize, end: usize) -> bool {
    count
        .checked_mul(stride)
        .and_then(|size| start.checked_add(size))
        .is_some_and(|limit| limit <= end)
}

struct Category {
    target_count: usize,
    resource_count: usize,
    row_count: usize,
    group_count: usize,
    targets: usize,
    resources: usize,
    rows: usize,
    groups: usize,
}

fn bindings(
    data: &[u8],
    category: Category,
    state_hashes: &[u32],
    pool: core::ops::Range<usize>,
) -> Result<Vec<Binding>, FormatError> {
    // Validate all rows, including unreferenced records, before expanding groups.
    for index in 0..category.row_count {
        let row = category.rows + index * 0x30;
        if u16_at(data, row) >= state_hashes.len()
            || u16_at(data, row + 2) >= category.resource_count
        {
            return Err(malformed(
                "G4RA row references an invalid state or resource",
            ));
        }
    }
    let mut result = Vec::new();
    for group_index in 0..category.group_count {
        let group = category.groups + group_index * 0x20;
        let target = u16_at(data, group);
        let pool_start = u16_at(data, group + 2);
        let count = u16_at(data, group + 4);
        if target >= category.target_count
            || !table_fits(pool.start + pool_start * 2, count, 2, pool.end)
        {
            return Err(malformed(
                "G4RA group references an invalid target or index range",
            ));
        }
        // Bound expansion by the physical index pool, even if groups overlap.
        if result
            .len()
            .checked_add(count)
            .is_none_or(|n| n > data.len() / 2)
        {
            return Err(malformed(
                "G4RA binding expansion exceeds the supported profile",
            ));
        }
        for offset in 0..count {
            let row_index = u16_at(data, pool.start + (pool_start + offset) * 2);
            if row_index >= category.row_count {
                return Err(malformed("G4RA index pool references an invalid row"));
            }
            let row = category.rows + row_index * 0x30;
            result.push(Binding {
                group_index: group_index as u16,
                row_index: row_index as u16,
                target_hash: u32_at(data, category.targets + target * 4),
                state_hash: state_hashes[u16_at(data, row)],
                clip_hash: u32_at(data, category.resources + u16_at(data, row + 2) * 4),
                raw_words: core::array::from_fn(|i| u32_at(data, row + i * 4)),
            });
        }
    }
    Ok(result)
}

/// Decode the verified ordered-table G4RA profile.
///
/// All consumed tables and references are checked before access. Third-category
/// bindings are unsupported and rejected, rather than silently omitted. Trailing
/// bytes beyond the declared Level-5 resource size are not used.
pub fn parse(data: &[u8]) -> Result<ReferenceAnimation, FormatError> {
    let header = level5::parse_header(data, MAGIC, "G4RA")?;
    let header_size = usize::from(header.header_size);
    if data.len() < MIN_HEADER
        || header_size < MIN_HEADER
        || header_size != usize::from(header.align) * 4
    {
        return Err(malformed(
            "G4RA header is truncated or has unsupported alignment",
        ));
    }
    let end = header_size
        .checked_add(header.data_size as usize)
        .filter(|&end| end <= data.len())
        .ok_or_else(|| malformed("G4RA declared size exceeds input"))?;
    if end < header_size {
        return Err(malformed("G4RA invalid declared size"));
    }
    let data = &data[..end];
    if [0x4c, 0x4e, 0x50]
        .iter()
        .any(|&field| u16_at(data, field) != 0)
    {
        return Err(malformed("G4RA third-category bindings are not supported"));
    }
    let sections: [usize; 10] =
        core::array::from_fn(|i| header_size + u16_at(data, 0x38 + i * 2) * 4);
    if sections[0] < header_size
        || sections[9] > end
        || sections.windows(2).any(|pair| pair[0] > pair[1])
    {
        return Err(malformed(
            "G4RA section offsets are outside the ordered-table profile",
        ));
    }
    let state_count = usize::from(data[0x22]);
    let bone_count = u16_at(data, 0x26);
    let material_count = u16_at(data, 0x28);
    let skeletal_resources = u16_at(data, 0x2a);
    let material_resources = u16_at(data, 0x2c);
    let skeletal_rows = u16_at(data, 0x2e);
    let material_rows = u16_at(data, 0x30);
    let skeletal_groups = u16_at(data, 0x32);
    let material_groups = u16_at(data, 0x34);
    let tables = [
        (sections[0], u16_at(data, 0x24), 0x20, sections[1]),
        (
            sections[1],
            skeletal_groups + material_groups,
            0x20,
            sections[2],
        ),
        (
            sections[2],
            skeletal_rows + material_rows,
            0x30,
            sections[3],
        ),
        (sections[4], usize::from(data[0x21]), 4, sections[5]),
        (sections[5], state_count, 4, sections[6]),
        (sections[6], bone_count, 4, sections[7]),
        (sections[7], material_count, 4, sections[8]),
        (
            sections[8],
            skeletal_resources + material_resources,
            4,
            sections[9],
        ),
    ];
    if tables
        .iter()
        .any(|&(start, count, stride, limit)| !table_fits(start, count, stride, limit))
    {
        return Err(malformed("G4RA table count exceeds its section"));
    }
    let state_hashes: Vec<_> = (0..state_count)
        .map(|i| u32_at(data, sections[5] + i * 4))
        .collect();
    let pool = sections[3]..sections[4];
    let skeletal_bindings = bindings(
        data,
        Category {
            target_count: bone_count,
            resource_count: skeletal_resources,
            row_count: skeletal_rows,
            group_count: skeletal_groups,
            targets: sections[6],
            resources: sections[8],
            rows: sections[2],
            groups: sections[1],
        },
        &state_hashes,
        pool.clone(),
    )?;
    let material_bindings = bindings(
        data,
        Category {
            target_count: material_count,
            resource_count: material_resources,
            row_count: material_rows,
            group_count: material_groups,
            targets: sections[7],
            resources: sections[8] + skeletal_resources * 4,
            rows: sections[2] + skeletal_rows * 0x30,
            groups: sections[1] + skeletal_groups * 0x20,
        },
        &state_hashes,
        pool,
    )?;
    Ok(ReferenceAnimation {
        state_hashes,
        skeletal_bindings,
        material_bindings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::vec;

    fn put16(data: &mut [u8], offset: usize, value: u16) {
        data[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
    }

    fn put32(data: &mut [u8], offset: usize, value: u32) {
        data[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
    }

    fn fixture() -> Vec<u8> {
        let mut data = vec![0; 0x140];
        put32(&mut data, 0, MAGIC);
        put16(&mut data, 4, 0x60);
        put16(&mut data, 10, 0x18);
        put32(&mut data, 12, 0xe0);
        data[0x21] = 1;
        data[0x22] = 1;
        for field in (0x24..=0x34).step_by(2) {
            put16(&mut data, field, 1);
        }
        for (i, offset) in [
            0x60, 0x80, 0xc0, 0x120, 0x124, 0x128, 0x12c, 0x130, 0x134, 0x13c,
        ]
        .into_iter()
        .enumerate()
        {
            put16(&mut data, 0x38 + i * 2, (offset - 0x60) / 4);
        }
        put16(&mut data, 0x84, 1);
        put16(&mut data, 0xa2, 1);
        put16(&mut data, 0xa4, 1);
        put32(&mut data, 0xc8, 0x7fc0_1234); // Preserve even unknown NaN payload bits.
        put32(&mut data, 0x128, 0x1111);
        put32(&mut data, 0x12c, 0x2222);
        put32(&mut data, 0x130, 0x3333);
        put32(&mut data, 0x134, 0x4444);
        put32(&mut data, 0x138, 0x5555);
        data
    }

    #[test]
    fn joins_separate_categories_and_preserves_raw_bits() {
        let parsed = parse(&fixture()).unwrap();
        assert_eq!(parsed.state_hashes, vec![0x1111]);
        assert_eq!(parsed.skeletal_bindings.len(), 1);
        assert_eq!(parsed.material_bindings.len(), 1);
        let skeletal = &parsed.skeletal_bindings[0];
        assert_eq!(
            (
                skeletal.target_hash,
                skeletal.state_hash,
                skeletal.clip_hash
            ),
            (0x2222, 0x1111, 0x4444)
        );
        assert_eq!(skeletal.raw_words[2], 0x7fc0_1234);
        let material = &parsed.material_bindings[0];
        assert_eq!(
            (material.target_hash, material.clip_hash, material.row_index),
            (0x3333, 0x5555, 0)
        );
    }

    #[test]
    fn native_frame_mapping_delays_scales_and_retains_exact_end() {
        let mut binding = parse(&fixture()).unwrap().skeletal_bindings.remove(0);
        binding.raw_words[1] = 2 << 16; // Two clip-frame delay.
        binding.raw_words[2] = 2.0_f32.to_bits();
        for (ticks, expected) in [
            (0.0, 5.0),
            (4.0, 5.0),
            (9.0, 10.0),
            (14.0, 15.0),
            (16.0, 15.0),
        ] {
            assert_eq!(binding.sample_frame(ticks, 5, 15, 30), Some(expected));
        }
        binding.raw_words[8] = 1 << 24;
        assert_eq!(binding.sample_frame(14.0, 5, 15, 30), Some(15.0));
        assert_eq!(binding.sample_frame(16.0, 5, 15, 30), Some(7.0));
        assert_eq!(binding.sample_frame(24.0, 5, 15, 30), Some(5.0));
    }

    #[test]
    fn native_frame_mapping_rejects_unsupported_inputs_and_handles_static_clips() {
        let mut binding = parse(&fixture()).unwrap().skeletal_bindings.remove(0);
        binding.raw_words[2] = 1.0_f32.to_bits();
        assert_eq!(binding.sample_frame(12.0, 7, 7, 30), Some(7.0));
        for ticks in [-1.0, f32::INFINITY, f32::NAN] {
            assert_eq!(binding.sample_frame(ticks, 0, 10, 30), None);
        }
        assert_eq!(binding.sample_frame(1.0, 10, 0, 30), None);
        assert_eq!(binding.sample_frame(1.0, 0, 10, 0), None);
        binding.raw_words[8] = 2 << 24;
        assert_eq!(binding.sample_frame(1.0, 0, 10, 30), None);
        binding.raw_words[8] = 1 << 24;
        assert_eq!(binding.sample_frame(f32::MAX, 0, 10, 30), None);
        binding.raw_words[2] = f32::NAN.to_bits();
        assert_eq!(binding.sample_frame(1.0, 0, 10, 30), None);
    }

    #[test]
    fn native_frame_mapping_matches_loading_loop_instruction_samples() {
        // FUN_140504d60 emulated with actual instructions; only resource lookup
        // is replaced with the supplied clip record. These are output frames,
        // not an inference from the clip or state names.
        let mut binding = parse(&fixture()).unwrap().skeletal_bindings.remove(0);
        binding.raw_words[1] = 0;
        binding.raw_words[2] = 0.3_f32.to_bits();
        binding.raw_words[8] = 1 << 24;
        for (ticks, expected) in [
            (0.0_f32, 0.0_f32),
            (30.0, 4.5),
            (60.0, 9.0),
            (66.666_664, 10.0),
            (90.0, 3.500_001),
            (120.0, 8.0),
        ] {
            assert_eq!(
                binding.sample_frame(ticks, 0, 10, 30).unwrap().to_bits(),
                expected.to_bits()
            );
        }
    }

    #[test]
    fn rejects_truncation_and_declared_size_overrun() {
        let data = fixture();
        for length in 0..data.len() {
            assert!(parse(&data[..length]).is_err(), "accepted prefix {length}");
        }
        let mut data = data;
        put32(&mut data, 12, u32::MAX);
        assert!(parse(&data).is_err());
    }

    #[test]
    fn rejects_bad_sections_counts_and_unsupported_category() {
        for (offset, value) in [
            (10, 0),
            (0x38, u16::MAX),
            (0x3a, 0),
            (0x2e, u16::MAX),
            (0x4c, 1),
        ] {
            let mut data = fixture();
            put16(&mut data, offset, value);
            assert!(parse(&data).is_err(), "accepted invalid field {offset:x}");
        }
        let mut data = fixture();
        data[0] = b'X';
        assert!(parse(&data).is_err());
    }

    #[test]
    fn rejects_invalid_group_pool_and_row_references() {
        for (offset, value) in [
            (0x80, 1),
            (0x82, u16::MAX),
            (0x84, 3),
            (0x120, 1),
            (0xc0, 1),
            (0xc2, 1),
        ] {
            let mut data = fixture();
            put16(&mut data, offset, value);
            assert!(
                parse(&data).is_err(),
                "accepted invalid reference {offset:x}"
            );
        }
    }
}
