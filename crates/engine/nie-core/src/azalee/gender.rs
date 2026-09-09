//! IEVR gender normalization.
//!
//! Source of truth: the native IEVR gender table. The data layer uses
//! numeric `0`/`1`, while database and API rows can use `M`/`F`, full English
//! words, or their numeric strings. Missing values are treated as male by the
//! historical normalization contract; unknown strings are neither gender.

/// Runtime forms accepted by the TypeScript `GenderValue` union.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum GenderValue<'a> {
    /// Missing (`null` or `undefined`) input.
    Missing,
    /// Numeric in-game representation.
    Number(f64),
    /// Database/API representation.
    Text(&'a str),
}

/// Returns whether `gender` is the female value.
#[must_use]
pub fn is_female_gender(gender: GenderValue<'_>) -> bool {
    match gender {
        GenderValue::Number(value) => value == 1.0,
        GenderValue::Text(value) => {
            matches!(value.to_ascii_lowercase().as_str(), "f" | "female" | "1")
        }
        GenderValue::Missing => false,
    }
}

/// Returns whether `gender` is the male value.
#[must_use]
pub fn is_male_gender(gender: GenderValue<'_>) -> bool {
    match gender {
        GenderValue::Number(value) => value == 0.0,
        GenderValue::Text(value) => {
            matches!(value.to_ascii_lowercase().as_str(), "m" | "male" | "0")
        }
        GenderValue::Missing => true,
    }
}

/// Normalizes a value to the game's numeric representation (`0` or `1`).
#[must_use]
pub fn normalize_gender(gender: GenderValue<'_>) -> u8 {
    u8::from(is_female_gender(gender))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_all_female_spellings() {
        for value in [
            GenderValue::Number(1.0),
            GenderValue::Text("F"),
            GenderValue::Text("f"),
            GenderValue::Text("Female"),
            GenderValue::Text("female"),
            GenderValue::Text("1"),
        ] {
            assert!(is_female_gender(value));
            assert!(!is_male_gender(value));
            assert_eq!(normalize_gender(value), 1);
        }
    }

    #[test]
    fn recognizes_all_male_spellings() {
        for value in [
            GenderValue::Number(0.0),
            GenderValue::Text("M"),
            GenderValue::Text("m"),
            GenderValue::Text("Male"),
            GenderValue::Text("male"),
            GenderValue::Text("0"),
        ] {
            assert!(!is_female_gender(value));
            assert!(is_male_gender(value));
            assert_eq!(normalize_gender(value), 0);
        }
    }

    #[test]
    fn defaults_missing_to_male_but_rejects_unknown_values() {
        assert!(!is_female_gender(GenderValue::Missing));
        assert!(is_male_gender(GenderValue::Missing));
        assert_eq!(normalize_gender(GenderValue::Missing), 0);
        for value in ["unknown", "2", " F", "female "] {
            let value = GenderValue::Text(value);
            assert!(!is_female_gender(value));
            assert!(!is_male_gender(value));
            assert_eq!(normalize_gender(value), 0);
        }
    }
}
