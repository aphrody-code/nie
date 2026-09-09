//! Canonical IEVR roster identifiers.
//!
//! Source of truth: the native IEVR roster contract.
//!
//! Save importers expose character identifiers as either JavaScript numbers or
//! strings. The string grammar is deliberately kept here, instead of in a
//! transport adapter: decimal strings stay decimal, `0x` strings are
//! hexadecimal, and an unprefixed string is hexadecimal only when it contains
//! an `A`–`F` digit. The canonical representation is always `0xXXXXXXXX`.

/// Largest identifier accepted by the IEVR save format.
pub const MAX_ROSTER_IDENTIFIER: u64 = u32::MAX as u64;

/// Default transport limit for one roster lookup.
pub const DEFAULT_MAX_ROSTER_IDENTIFIERS: usize = 8_000;

/// One of the runtime representations accepted by the TypeScript contract.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum RosterIdentifierInput<'a> {
    /// A JavaScript-like number. It must be finite, integral, and in `u32`.
    Number(f64),
    /// A decimal or hexadecimal string.
    Text(&'a str),
}

impl<'a> From<&'a str> for RosterIdentifierInput<'a> {
    fn from(value: &'a str) -> Self {
        Self::Text(value)
    }
}

impl From<f64> for RosterIdentifierInput<'_> {
    fn from(value: f64) -> Self {
        Self::Number(value)
    }
}

impl From<u32> for RosterIdentifierInput<'_> {
    fn from(value: u32) -> Self {
        Self::Number(f64::from(value))
    }
}

/// Normalizes one roster identifier to `0xXXXXXXXX`.
#[must_use]
pub fn normalize_roster_identifier(input: RosterIdentifierInput<'_>) -> Option<String> {
    let value = match input {
        RosterIdentifierInput::Number(value) => {
            if !value.is_finite()
                || value.fract() != 0.0
                || !(0.0..=MAX_ROSTER_IDENTIFIER as f64).contains(&value)
            {
                return None;
            }
            value as u64
        }
        RosterIdentifierInput::Text(value) => parse_text(value)?,
    };

    Some(format!("0x{value:08X}"))
}

/// Convenience overload for a string input.
#[must_use]
pub fn normalize_roster_identifier_str(value: &str) -> Option<String> {
    normalize_roster_identifier(RosterIdentifierInput::Text(value))
}

/// Convenience overload for a numeric input.
#[must_use]
pub fn normalize_roster_identifier_number(value: f64) -> Option<String> {
    normalize_roster_identifier(RosterIdentifierInput::Number(value))
}

/// Normalizes, de-duplicates, and caps identifiers while preserving first use.
#[must_use]
pub fn normalize_roster_identifiers<'a, I>(values: I, max: usize) -> Vec<String>
where
    I: IntoIterator<Item = RosterIdentifierInput<'a>>,
{
    // The `max === 0` branch in the TypeScript implementation returns before
    // inspecting any input. Keep that behavior explicit for callers that use
    // a zero-sized transport budget.
    if max == 0 {
        return Vec::new();
    }

    let mut identifiers = Vec::new();
    for value in values {
        let Some(identifier) = normalize_roster_identifier(value) else {
            continue;
        };
        if identifiers.iter().any(|current| current == &identifier) {
            continue;
        }
        identifiers.push(identifier);
        if identifiers.len() >= max {
            break;
        }
    }
    identifiers
}

fn parse_text(raw: &str) -> Option<u64> {
    let value = raw.trim();
    if value.is_empty() {
        return None;
    }

    let (digits, radix) = if value.len() >= 2
        && value.as_bytes()[0] == b'0'
        && matches!(value.as_bytes()[1], b'x' | b'X')
    {
        (&value[2..], 16)
    } else if value.as_bytes().iter().all(u8::is_ascii_digit) {
        (value, 10)
    } else if value.len() <= 8
        && value.as_bytes().iter().all(u8::is_ascii_hexdigit)
        && value
            .as_bytes()
            .iter()
            .any(|byte| matches!(byte, b'a'..=b'f' | b'A'..=b'F'))
    {
        (value, 16)
    } else {
        return None;
    };

    if digits.is_empty() || digits.len() > 8 && radix == 16 {
        return None;
    }
    let parsed = u64::from_str_radix(digits, radix).ok()?;
    (parsed <= MAX_ROSTER_IDENTIFIER).then_some(parsed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_numeric_boundaries_and_rejects_non_integers() {
        assert_eq!(
            normalize_roster_identifier_number(0.0).as_deref(),
            Some("0x00000000")
        );
        assert_eq!(
            normalize_roster_identifier_number(4_294_967_295.0).as_deref(),
            Some("0xFFFFFFFF")
        );
        for value in [-1.0, 1.5, f64::NAN, f64::INFINITY, 4_294_967_296.0] {
            assert_eq!(normalize_roster_identifier_number(value), None);
        }
    }

    #[test]
    fn parses_decimal_and_prefixed_hex_strings() {
        assert_eq!(
            normalize_roster_identifier_str(" 42 ").as_deref(),
            Some("0x0000002A")
        );
        assert_eq!(
            normalize_roster_identifier_str("00042").as_deref(),
            Some("0x0000002A")
        );
        assert_eq!(
            normalize_roster_identifier_str("0x2a").as_deref(),
            Some("0x0000002A")
        );
        assert_eq!(
            normalize_roster_identifier_str("0XFFFFFFFF").as_deref(),
            Some("0xFFFFFFFF")
        );
        assert_eq!(
            normalize_roster_identifier_str("ABCDEF12").as_deref(),
            Some("0xABCDEF12")
        );
    }

    #[test]
    fn preserves_decimal_hex_ambiguity_rule_and_rejects_malformed_text() {
        // Digits only are decimal, even when their hexadecimal interpretation differs.
        assert_eq!(
            normalize_roster_identifier_str("123").as_deref(),
            Some("0x0000007B")
        );
        for value in [
            "",
            "0x",
            "0x100000000",
            "4294967296",
            "-1",
            "+1",
            "0g10",
            "deadbeef0",
            "G123",
        ] {
            assert_eq!(normalize_roster_identifier_str(value), None, "{value}");
        }
    }

    #[test]
    fn normalizes_in_first_seen_order_deduplicates_and_caps() {
        let values = [
            RosterIdentifierInput::Text("1"),
            RosterIdentifierInput::Text("0x00000001"),
            RosterIdentifierInput::Number(2.0),
            RosterIdentifierInput::Text("zz"),
            RosterIdentifierInput::Text("3"),
        ];
        assert_eq!(
            normalize_roster_identifiers(values, 2),
            ["0x00000001", "0x00000002"]
        );
        assert!(normalize_roster_identifiers(values, 0).is_empty());
        assert_eq!(normalize_roster_identifiers(values, 8_000).len(), 3);
    }
}
