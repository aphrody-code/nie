//! French labels for IEVR character personalities.
//!
//! Source of truth: `packages/azalee/src/game/personality.ts`. The table is
//! intentionally total only for known game values: missing data is `Inconnu`
//! and an unseen numeric value remains visible as `Type <n>`.

/// Known `personalityType` values and their French labels.
pub const PERSONALITY_NAMES: [(i32, &str); 12] = [
    (0, "Inconnu"),
    (1, "Doux"),
    (2, "Cool"),
    (3, "Passionné"),
    (4, "Timide"),
    (5, "Mature"),
    (6, "Joyeux"),
    (7, "Sérieux"),
    (8, "Sauvage"),
    (9, "Mystérieux"),
    (10, "Élégant"),
    (11, "Espiègle"),
];

/// Returns the French personality label or preserves an unknown numeric value.
#[must_use]
pub fn get_personality_name(personality_type: Option<i32>) -> String {
    let Some(personality_type) = personality_type else {
        return "Inconnu".to_owned();
    };
    PERSONALITY_NAMES
        .iter()
        .find_map(|(value, label)| (*value == personality_type).then_some(*label))
        .map_or_else(|| format!("Type {personality_type}"), str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn covers_every_known_personality() {
        assert_eq!(PERSONALITY_NAMES.len(), 12);
        for (value, label) in PERSONALITY_NAMES {
            assert_eq!(get_personality_name(Some(value)), label);
        }
    }

    #[test]
    fn handles_missing_negative_and_unknown_values_without_hiding_them() {
        assert_eq!(get_personality_name(None), "Inconnu");
        assert_eq!(get_personality_name(Some(-1)), "Type -1");
        assert_eq!(get_personality_name(Some(99)), "Type 99");
    }
}
