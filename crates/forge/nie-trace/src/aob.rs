//! Motifs **AOB** (array-of-bytes) à masque, pour la résolution dynamique d'adresses dans la mémoire
//! live d'`nie.exe`.
//!
//! Le scanner natif de [`crate::scan_regions`] est *exact-match* ; les signatures reversées
//! (cf. [`crate::catalog`]) comportent des wildcards façon Cheat-Engine (`44 8B ?? 10`). Ce module
//! porte le motif à masque (aligné sur `nie-re::dump::Pattern`) côté lecture live, plus quelques
//! décodeurs d'opérande pour récupérer un déplacement (`mov eax,[rax+0x1058]`) ou une cible
//! RIP-relative à partir d'un coup.

/// Échec de [`Pattern::parse`].
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum AobError {
    /// Un jeton non-wildcard n'est pas un octet hexadécimal valide.
    #[error("octet hex invalide « {0} » dans le motif AOB")]
    BadByte(String),
    /// Le motif ne contient aucun jeton.
    #[error("motif AOB vide")]
    Empty,
}

/// Maximum accepted UTF-8 byte length for a pattern passed to [`scan_bytes_bounded`].
pub const MAX_AOB_PATTERN_SOURCE_BYTES: usize = 1_024;
/// Maximum number of parsed pattern bytes accepted by [`scan_bytes_bounded`].
pub const MAX_AOB_PATTERN_BYTES: usize = 256;
/// Maximum haystack size accepted by [`scan_bytes_bounded`] (8 MiB).
pub const MAX_AOB_SCAN_BYTES: usize = 8 * 1024 * 1024;
/// Maximum number of offsets returned by [`scan_bytes_bounded`].
pub const MAX_AOB_SCAN_HITS: usize = 256;
/// Maximum candidate-byte comparisons admitted by [`scan_bytes_bounded`].
pub const MAX_AOB_SCAN_COMPARISONS: usize = 64 * 1024 * 1024;

/// A bounded, platform-independent AOB scan result.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AobScanReport {
    /// Number of bytes in the parsed pattern.
    pub pattern_bytes: usize,
    /// Number of haystack bytes inspected.
    pub scanned_bytes: usize,
    /// Matching byte offsets, in ascending order.
    pub offsets: Vec<usize>,
    /// Whether at least one additional match exists beyond `offsets`.
    pub truncated: bool,
}

/// Validation failure from [`scan_bytes_bounded`].
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum BoundedAobError {
    /// The textual pattern is too large to parse safely.
    #[error("AOB pattern source is {length} bytes; maximum is {max}")]
    PatternSourceTooLong { length: usize, max: usize },
    /// The parsed pattern contains too many byte positions.
    #[error("AOB pattern is {length} bytes; maximum is {max}")]
    PatternTooLong { length: usize, max: usize },
    /// The byte buffer is too large for the portable scanner contract.
    #[error("AOB haystack is {length} bytes; maximum is {max}")]
    HaystackTooLong { length: usize, max: usize },
    /// The caller requested too many returned matches.
    #[error("AOB hit limit is {limit}; maximum is {max}")]
    HitLimitTooHigh { limit: usize, max: usize },
    /// The worst-case scan work exceeds the portable CPU budget.
    #[error("AOB scan needs {comparisons} candidate comparisons; maximum is {max}")]
    WorkLimitExceeded { comparisons: usize, max: usize },
    /// The AOB syntax is invalid.
    #[error(transparent)]
    Pattern(#[from] AobError),
}

/// Un motif octet à scanner : `bytes[i]` n'est comparé que si `mask[i]` est vrai.
///
/// Parsé façon Cheat-Engine ; les jetons `??`, `?` ou `*` sont des wildcards.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pattern {
    /// Octets du motif (les positions wildcard valent `0` et sont ignorées au match).
    pub bytes: Vec<u8>,
    /// Masque : `true` = octet fixe, `false` = wildcard.
    pub mask: Vec<bool>,
}

impl Pattern {
    /// Parse un motif `"44 8B ?? 10 ?? C0"`.
    ///
    /// # Errors
    /// [`AobError::BadByte`] si un jeton fixe n'est pas un octet hex ; [`AobError::Empty`] si vide.
    pub fn parse(s: &str) -> Result<Self, AobError> {
        let mut bytes = Vec::new();
        let mut mask = Vec::new();
        for tok in s.split_whitespace() {
            if tok == "??" || tok == "?" || tok == "*" {
                bytes.push(0);
                mask.push(false);
            } else {
                let b =
                    u8::from_str_radix(tok, 16).map_err(|_| AobError::BadByte(tok.to_owned()))?;
                bytes.push(b);
                mask.push(true);
            }
        }
        if bytes.is_empty() {
            return Err(AobError::Empty);
        }
        Ok(Self { bytes, mask })
    }

    /// Longueur du motif en octets.
    #[must_use]
    pub fn len(&self) -> usize {
        self.bytes.len()
    }

    /// Le motif est-il vide ? (jamais le cas pour un `Pattern` issu de [`Pattern::parse`]).
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.bytes.is_empty()
    }

    /// Le motif correspond-il à `buf` à l'index `i` ? (suppose `i + len() <= buf.len()`).
    fn matches_at(&self, buf: &[u8], i: usize) -> bool {
        self.bytes
            .iter()
            .zip(&self.mask)
            .enumerate()
            .all(|(k, (b, &keep))| !keep || buf[i + k] == *b)
    }

    /// Première occurrence du motif dans `hay`, le cas échéant.
    #[must_use]
    pub fn find_in(&self, hay: &[u8]) -> Option<usize> {
        if self.bytes.is_empty() || self.bytes.len() > hay.len() {
            return None;
        }
        (0..=hay.len() - self.bytes.len()).find(|&i| self.matches_at(hay, i))
    }

    /// Jusqu'à `limit` occurrences (indices croissants) du motif dans `hay`.
    #[must_use]
    pub fn find_all(&self, hay: &[u8], limit: usize) -> Vec<usize> {
        let mut out = Vec::new();
        if self.bytes.is_empty() || self.bytes.len() > hay.len() {
            return out;
        }
        let mut i = 0usize;
        let last = hay.len() - self.bytes.len();
        while i <= last && out.len() < limit {
            if self.matches_at(hay, i) {
                out.push(i);
            }
            i += 1;
        }
        out
    }
}

/// Parse and scan an in-memory byte slice under explicit allocation and CPU bounds.
///
/// Offsets are relative to `haystack`. Overlapping matches are retained. To make truncation
/// observable without returning an unbounded vector, the scanner probes for at most one match
/// beyond `max_hits` and sets [`AobScanReport::truncated`] accordingly.
///
/// # Errors
///
/// Returns [`BoundedAobError`] when the pattern, haystack, requested hit count, or worst-case
/// comparison count exceeds its documented bound, or when `pattern_source` is malformed.
pub fn scan_bytes_bounded(
    pattern_source: &str,
    haystack: &[u8],
    max_hits: usize,
) -> Result<AobScanReport, BoundedAobError> {
    if pattern_source.len() > MAX_AOB_PATTERN_SOURCE_BYTES {
        return Err(BoundedAobError::PatternSourceTooLong {
            length: pattern_source.len(),
            max: MAX_AOB_PATTERN_SOURCE_BYTES,
        });
    }
    if haystack.len() > MAX_AOB_SCAN_BYTES {
        return Err(BoundedAobError::HaystackTooLong {
            length: haystack.len(),
            max: MAX_AOB_SCAN_BYTES,
        });
    }
    if max_hits > MAX_AOB_SCAN_HITS {
        return Err(BoundedAobError::HitLimitTooHigh {
            limit: max_hits,
            max: MAX_AOB_SCAN_HITS,
        });
    }

    let pattern = Pattern::parse(pattern_source)?;
    if pattern.len() > MAX_AOB_PATTERN_BYTES {
        return Err(BoundedAobError::PatternTooLong {
            length: pattern.len(),
            max: MAX_AOB_PATTERN_BYTES,
        });
    }

    let candidate_count = haystack
        .len()
        .checked_sub(pattern.len())
        .map_or(0, |remaining| remaining + 1);
    let comparisons = candidate_count.saturating_mul(pattern.len());
    if comparisons > MAX_AOB_SCAN_COMPARISONS {
        return Err(BoundedAobError::WorkLimitExceeded {
            comparisons,
            max: MAX_AOB_SCAN_COMPARISONS,
        });
    }

    let mut offsets = pattern.find_all(haystack, max_hits.saturating_add(1));
    let truncated = offsets.len() > max_hits;
    offsets.truncate(max_hits);
    Ok(AobScanReport {
        pattern_bytes: pattern.len(),
        scanned_bytes: haystack.len(),
        offsets,
        truncated,
    })
}

// ─── Décodeurs d'opérande ───────────────────────────────────────────────────────────
//
// À partir d'un coup AOB sur un site de code, on récupère souvent une *donnée* : le déplacement
// d'un `mov reg,[reg+disp]` (→ offset de champ dans un objet) ou la cible d'une instruction
// RIP-relative (`lea`, `mov reg,[rip+disp]`). Ces helpers décodent depuis les octets du site.

/// `i8` (disp8) à l'offset `at` dans `buf`, le cas échéant.
#[must_use]
pub fn disp8(buf: &[u8], at: usize) -> Option<i32> {
    buf.get(at).map(|&b| i32::from(b as i8))
}

/// `i32` little-endian (disp32) à l'offset `at` dans `buf`, le cas échéant.
#[must_use]
pub fn disp32(buf: &[u8], at: usize) -> Option<i32> {
    let s = buf.get(at..at.checked_add(4)?)?;
    Some(i32::from_le_bytes([s[0], s[1], s[2], s[3]]))
}

/// Cible d'une instruction RIP-relative : `hit_va + instr_len + disp32`.
///
/// `instr_len` est la longueur totale de l'instruction (le déplacement est relatif à *l'instruction
/// suivante*). Arithmétique en *wrapping* sur `u64` (calcul d'adresse effective modulo 2^64, exact
/// pour le RIP-relatif x86-64).
#[must_use]
pub fn rip_target(hit_va: u64, instr_len: usize, disp: i32) -> u64 {
    let next = hit_va.wrapping_add(instr_len as u64);
    if disp >= 0 {
        next.wrapping_add(disp as u64)
    } else {
        next.wrapping_sub(disp.unsigned_abs() as u64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_wildcards_and_mask() {
        let p = Pattern::parse("44 8B ?? 10 ?? C0").unwrap();
        assert_eq!(p.bytes, vec![0x44, 0x8B, 0, 0x10, 0, 0xC0]);
        assert_eq!(p.mask, vec![true, true, false, true, false, true]);
        assert_eq!(p.len(), 6);
        assert!(!p.is_empty());
    }

    #[test]
    fn parse_rejects_garbage_and_empty() {
        assert_eq!(
            Pattern::parse("44 ZZ"),
            Err(AobError::BadByte("ZZ".to_owned()))
        );
        assert_eq!(Pattern::parse("   "), Err(AobError::Empty));
    }

    #[test]
    fn find_in_respects_mask() {
        // « mov eax,[rax+0x1058] » : 8B 80 58 10 00 00.
        let p = Pattern::parse("8B 80 ?? ?? 00 00").unwrap();
        let hay = [0x00, 0x90, 0x8B, 0x80, 0x58, 0x10, 0x00, 0x00, 0xCC];
        assert_eq!(p.find_in(&hay), Some(2));
        assert_eq!(p.find_in(&hay[3..]), None);
    }

    #[test]
    fn find_all_caps_at_limit() {
        let p = Pattern::parse("AA ??").unwrap();
        let hay = [0xAA, 0x01, 0xAA, 0x02, 0xAA, 0x03];
        assert_eq!(p.find_all(&hay, 10), vec![0, 2, 4]);
        assert_eq!(p.find_all(&hay, 2), vec![0, 2]);
    }

    #[test]
    fn empty_and_too_long_patterns_find_nothing() {
        // motif vide (construit à la main) → aucun match, is_empty vrai.
        let empty = Pattern {
            bytes: vec![],
            mask: vec![],
        };
        assert!(empty.is_empty());
        assert_eq!(empty.find_in(b"abc"), None);
        assert!(empty.find_all(b"abc", 4).is_empty());
        // motif plus long que la botte de foin.
        let p = Pattern::parse("AA BB CC DD").unwrap();
        assert_eq!(p.find_in(b"AB"), None);
        assert!(p.find_all(b"AB", 4).is_empty());
    }

    #[test]
    fn decode_displacement_operands() {
        // 8B 80 58 10 00 00  → disp32 @ +2 == 0x1058 (offset jauge/tension).
        let site = [0x8B, 0x80, 0x58, 0x10, 0x00, 0x00];
        assert_eq!(disp32(&site, 2), Some(0x1058));
        assert_eq!(disp8(&[0x48, 0x8B, 0x40, 0xF8], 3), Some(-8));
        assert_eq!(disp32(&site, 4), None); // dépasse la fin
        assert_eq!(disp32(&site, usize::MAX), None); // `at + 4` ne déborde pas (checked_add)
    }

    #[test]
    fn rip_relative_target_math() {
        // lea rax,[rip+0x10] de 7 octets @ 0x1000 → 0x1000 + 7 + 0x10 = 0x1017.
        assert_eq!(rip_target(0x1000, 7, 0x10), 0x1017);
        // déplacement négatif.
        assert_eq!(rip_target(0x1000, 7, -0x10), 0x1000 + 7 - 0x10);
    }

    #[test]
    fn bounded_scan_reports_offsets_and_truncation() {
        let report = scan_bytes_bounded("AA ??", &[0xAA, 1, 0xAA, 2, 0xAA, 3], 2).unwrap();
        assert_eq!(report.pattern_bytes, 2);
        assert_eq!(report.scanned_bytes, 6);
        assert_eq!(report.offsets, vec![0, 2]);
        assert!(report.truncated);

        let complete = scan_bytes_bounded("AA ??", &[0xAA, 1, 0xAA, 2], 2).unwrap();
        assert_eq!(complete.offsets, vec![0, 2]);
        assert!(!complete.truncated);
    }

    #[test]
    fn bounded_scan_enforces_every_public_limit() {
        assert!(matches!(
            scan_bytes_bounded(&"A".repeat(MAX_AOB_PATTERN_SOURCE_BYTES + 1), &[], 1),
            Err(BoundedAobError::PatternSourceTooLong { .. })
        ));
        assert!(matches!(
            scan_bytes_bounded(&vec!["AA"; MAX_AOB_PATTERN_BYTES + 1].join(" "), &[], 1),
            Err(BoundedAobError::PatternTooLong { .. })
        ));
        assert!(matches!(
            scan_bytes_bounded("AA", &vec![0; MAX_AOB_SCAN_BYTES + 1], 1),
            Err(BoundedAobError::HaystackTooLong { .. })
        ));
        assert!(matches!(
            scan_bytes_bounded("AA", &[], MAX_AOB_SCAN_HITS + 1),
            Err(BoundedAobError::HitLimitTooHigh { .. })
        ));

        let pattern = vec!["??"; MAX_AOB_PATTERN_BYTES].join(" ");
        let haystack =
            vec![0; MAX_AOB_SCAN_COMPARISONS / MAX_AOB_PATTERN_BYTES + MAX_AOB_PATTERN_BYTES];
        assert!(matches!(
            scan_bytes_bounded(&pattern, &haystack, 1),
            Err(BoundedAobError::WorkLimitExceeded { .. })
        ));
    }

    #[test]
    fn bounded_scan_validates_before_allocating_or_scanning() {
        assert_eq!(
            scan_bytes_bounded("not-hex", &[], 1),
            Err(BoundedAobError::Pattern(AobError::BadByte(
                "not-hex".to_owned()
            )))
        );
        let report = scan_bytes_bounded("AA", &[0xAA], 0).unwrap();
        assert!(report.offsets.is_empty());
        assert!(report.truncated);
    }
}
