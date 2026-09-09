//! French labels for IEVR item categories.
//!
//! Source of truth: the native IEVR item-category contract. This is a
//! deterministic lookup table; unknown non-empty identifiers are returned
//! unchanged so a new game category is never silently hidden.

/// All known game category identifiers and their French display labels.
pub const ITEM_CATEGORY_LABELS_FR: [(&str, &str); 20] = [
    ("consume", "Consommable"),
    ("shoes", "Chaussures"),
    ("misanga", "Bracelet"),
    ("accessory", "Accessoire"),
    ("special", "Spécial"),
    ("formation", "Formation"),
    ("special_tactics", "Tactique spéciale"),
    ("super_tactics", "Super tactique"),
    ("special_skill", "Compétence spéciale"),
    ("title", "Titre"),
    ("fashion", "Mode"),
    ("costume", "Costume"),
    ("emblem", "Emblème"),
    ("unique", "Unique"),
    ("craft_obj", "Matériau"),
    ("animal", "Animal"),
    ("kizuna_link", "Lien Kizuna"),
    ("name_plate", "Plaque"),
    ("performance", "Performance"),
    ("important", "Objet clé"),
];

/// Returns a French label, the original unknown identifier, or `None` for a
/// missing/empty category.
#[must_use]
pub fn get_item_category_label(category: Option<&str>) -> Option<&str> {
    let category = category.filter(|value| !value.is_empty())?;
    ITEM_CATEGORY_LABELS_FR
        .iter()
        .find_map(|(key, label)| (key == &category).then_some(*label))
        .or(Some(category))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn translates_every_known_category() {
        let expected = [
            ("consume", "Consommable"),
            ("shoes", "Chaussures"),
            ("misanga", "Bracelet"),
            ("accessory", "Accessoire"),
            ("special", "Spécial"),
            ("formation", "Formation"),
            ("special_tactics", "Tactique spéciale"),
            ("super_tactics", "Super tactique"),
            ("special_skill", "Compétence spéciale"),
            ("title", "Titre"),
            ("fashion", "Mode"),
            ("costume", "Costume"),
            ("emblem", "Emblème"),
            ("unique", "Unique"),
            ("craft_obj", "Matériau"),
            ("animal", "Animal"),
            ("kizuna_link", "Lien Kizuna"),
            ("name_plate", "Plaque"),
            ("performance", "Performance"),
            ("important", "Objet clé"),
        ];
        assert_eq!(ITEM_CATEGORY_LABELS_FR.len(), expected.len());
        for (category, label) in expected {
            assert_eq!(get_item_category_label(Some(category)), Some(label));
        }
    }

    #[test]
    fn preserves_unknowns_and_rejects_missing_or_empty_values() {
        assert_eq!(
            get_item_category_label(Some("new_category")),
            Some("new_category")
        );
        assert_eq!(get_item_category_label(Some("")), None);
        assert_eq!(get_item_category_label(None), None);
    }
}
