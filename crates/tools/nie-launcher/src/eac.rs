//! Easy Anti-Cheat (EAC) bypass signature scanner and patcher for `nie.exe`.
//!
//! Reconstructs and ports the reverse-engineered logic from `EACLauncher.exe`.
//! Scans executable memory or binary buffers for the three canonical EAC integrity/runtime
//! check patterns, and patches conditional jump instructions (`0x74` / `je`) into unconditional
//! jumps (`0xeb` / `jmp`).

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::{LauncherError, Result};

/// Canonical AOB pattern 1 recovered from `EACLauncher.exe` (@`0x140015440`).
pub const EAC_PATTERN_1: &str = "85 * * * 80 3D * * * * 00 74 * B2 01 E8 * * * * * 8B * FF";
/// Patch byte offset relative to the start of pattern 1 match (index of `0x74`).
pub const EAC_PATCH_OFFSET_1: usize = 11;

/// Canonical AOB pattern 2 recovered from `EACLauncher.exe` (@`0x140015480`).
pub const EAC_PATTERN_2: &str = "80 3D * * * * 00 74 * B2 01 B9 * * * * E8 * * * * * 8B * 24";
/// Patch byte offset relative to the start of pattern 2 match (index of `0x74`).
pub const EAC_PATCH_OFFSET_2: usize = 7;

/// Canonical AOB pattern 3 recovered from `EACLauncher.exe` (@`0x1400154C0`).
pub const EAC_PATTERN_3: &str = "80 3D * * * * 00 74 * BA 01 00 00 00 * 8D * * * * * * * * * * * E8 * * * * F7 * B2 * * * E8";
/// Patch byte offset relative to the start of pattern 3 match (index of `0x74`).
pub const EAC_PATCH_OFFSET_3: usize = 7;

/// Parsed pattern element for fast matching.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PatternToken {
    Exact(u8),
    Wildcard,
}

/// Compiled AOB pattern.
#[derive(Debug, Clone)]
pub struct CompiledPattern {
    pub name: &'static str,
    pub tokens: Vec<PatternToken>,
    pub patch_offset: usize,
}

impl CompiledPattern {
    /// Compile a pattern string with hex bytes and wildcard tokens (`*` or `?`).
    pub fn parse(name: &'static str, pattern: &str, patch_offset: usize) -> Result<Self> {
        let mut tokens = Vec::new();
        for piece in pattern.split_whitespace() {
            if piece == "*" || piece == "?" || piece == "??" {
                tokens.push(PatternToken::Wildcard);
            } else {
                let byte = u8::from_str_radix(piece, 16).map_err(|e| {
                    LauncherError::General(format!("invalid hex byte '{piece}' in pattern: {e}"))
                })?;
                tokens.push(PatternToken::Exact(byte));
            }
        }
        if patch_offset >= tokens.len() {
            return Err(LauncherError::General(format!(
                "patch offset {patch_offset} exceeds pattern length {}",
                tokens.len()
            )));
        }
        Ok(Self {
            name,
            tokens,
            patch_offset,
        })
    }

    /// Search for matches in a slice of bytes, tolerating either original `0x74` or patched `0xeb`.
    pub fn find_matches(&self, data: &[u8]) -> Vec<usize> {
        let pattern_len = self.tokens.len();
        if data.len() < pattern_len {
            return Vec::new();
        }

        let mut matches = Vec::new();
        'outer: for i in 0..=data.len() - pattern_len {
            for (j, token) in self.tokens.iter().enumerate() {
                let byte = data[i + j];
                match token {
                    PatternToken::Wildcard => {}
                    PatternToken::Exact(expected) => {
                        // At the patch location, allow either original 0x74 or patched 0xeb
                        if j == self.patch_offset {
                            if byte != *expected && byte != 0xeb {
                                continue 'outer;
                            }
                        } else if byte != *expected {
                            continue 'outer;
                        }
                    }
                }
            }
            matches.push(i);
        }
        matches
    }
}

/// The set of standard EAC bypass patterns.
pub fn standard_patterns() -> Result<Vec<CompiledPattern>> {
    Ok(vec![
        CompiledPattern::parse("EAC_CHECK_1", EAC_PATTERN_1, EAC_PATCH_OFFSET_1)?,
        CompiledPattern::parse("EAC_CHECK_2", EAC_PATTERN_2, EAC_PATCH_OFFSET_2)?,
        CompiledPattern::parse("EAC_CHECK_3", EAC_PATTERN_3, EAC_PATCH_OFFSET_3)?,
    ])
}

/// Identified EAC check site in binary or memory.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EacCheckSite {
    pub pattern_name: String,
    pub match_offset: usize,
    pub patch_offset: usize,
    pub current_byte: u8,
    pub is_patched: bool,
}

/// Summary report of an EAC scanning or patching operation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EacScanReport {
    pub total_sites_found: usize,
    pub unpatched_count: usize,
    pub patched_count: usize,
    pub sites: Vec<EacCheckSite>,
}

/// Scans a byte buffer for EAC check sites without modifying it.
pub fn scan_eac_sites(data: &[u8]) -> Result<EacScanReport> {
    let patterns = standard_patterns()?;
    let mut sites = Vec::new();
    let mut unpatched = 0;
    let mut patched = 0;

    for pat in &patterns {
        let offsets = pat.find_matches(data);
        for m in offsets {
            let p_off = m + pat.patch_offset;
            let cur = data[p_off];
            let is_p = cur == 0xeb;
            if is_p {
                patched += 1;
            } else if cur == 0x74 {
                unpatched += 1;
            }
            sites.push(EacCheckSite {
                pattern_name: pat.name.to_string(),
                match_offset: m,
                patch_offset: p_off,
                current_byte: cur,
                is_patched: is_p,
            });
        }
    }

    Ok(EacScanReport {
        total_sites_found: sites.len(),
        unpatched_count: unpatched,
        patched_count: patched,
        sites,
    })
}

/// Patches all unpatched EAC check sites in a mutable byte buffer (`0x74` -> `0xeb`).
/// Returns the number of sites patched.
pub fn patch_eac_buffer(data: &mut [u8]) -> Result<usize> {
    let report = scan_eac_sites(data)?;
    let mut count = 0;

    for site in report.sites {
        if !site.is_patched && site.current_byte == 0x74 {
            data[site.patch_offset] = 0xeb;
            count += 1;
        }
    }

    Ok(count)
}

/// Scans and patches a game executable on disk (`nie.exe` -> `nie_eacpatched.exe`).
pub fn patch_eac_file<P: AsRef<Path>, Q: AsRef<Path>>(
    input_path: P,
    output_path: Q,
) -> Result<EacScanReport> {
    let mut bytes = fs::read(&input_path)?;
    let initial_report = scan_eac_sites(&bytes)?;

    let mut modified = 0;
    for site in &initial_report.sites {
        if !site.is_patched && site.current_byte == 0x74 {
            bytes[site.patch_offset] = 0xeb;
            modified += 1;
        }
    }

    if modified > 0 || input_path.as_ref() != output_path.as_ref() {
        if let Some(parent) = output_path.as_ref().parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&output_path, &bytes)?;
    }

    let final_report = scan_eac_sites(&bytes)?;
    Ok(final_report)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_eac_pattern_matching_and_patching() {
        let pattern = CompiledPattern::parse("TEST_EAC", EAC_PATTERN_1, EAC_PATCH_OFFSET_1).unwrap();

        // Synthesize a buffer containing pattern 1
        let mut buffer = vec![
            0x90, 0x90, // NOPs
            0x85, 0x11, 0x22, 0x33, // 85 * * *
            0x80, 0x3D, 0xAA, 0xBB, 0xCC, 0xDD, 0x00, // 80 3D * * * * 00
            0x74, 0x18, // 74 * (je target)
            0xB2, 0x01, // B2 01
            0xE8, 0x55, 0x66, 0x77, 0x88, // E8 * * * *
            0x99, 0x8B, 0xAA, 0xFF, // * 8B * FF
            0xCC, 0xCC,
        ];

        let matches = pattern.find_matches(&buffer);
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0], 2);

        let report = scan_eac_sites(&buffer).unwrap();
        assert_eq!(report.total_sites_found, 1);
        assert_eq!(report.unpatched_count, 1);
        assert_eq!(report.patched_count, 0);
        assert_eq!(report.sites[0].patch_offset, 2 + 11);
        assert_eq!(report.sites[0].current_byte, 0x74);

        let patched_count = patch_eac_buffer(&mut buffer).unwrap();
        assert_eq!(patched_count, 1);
        assert_eq!(buffer[2 + 11], 0xeb);

        let post_report = scan_eac_sites(&buffer).unwrap();
        assert_eq!(post_report.total_sites_found, 1);
        assert_eq!(post_report.unpatched_count, 0);
        assert_eq!(post_report.patched_count, 1);
    }
}
