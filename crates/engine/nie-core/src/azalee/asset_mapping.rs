//! Transformations pures de codes d'assets IEVR.
//!
//! The former web image utility mixed game-code rules with URLs and
//! les manifests CDN. Ce module ne connaît ni CDN ni manifest : il porte uniquement les
//! transformations déterministes que tous les hosts peuvent réutiliser. La présence effective
//! d'un fichier reste une décision de l'index VFS ou d'un manifest vérifié par le host.

/// Dossier CPK qui porte une icône de famille d'aura.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuraIconFolder {
    /// Icône de Keshin ou de forme armée connue.
    AuraFs,
    /// Icône de Soul.
    AuraSoul,
}

impl AuraIconFolder {
    /// Nom du dossier dans `200_icon/10_icon_chr`.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::AuraFs => "aura_fs",
            Self::AuraSoul => "aura_soul",
        }
    }
}

/// Référence logique vers une icône d'aura, avant construction d'une URL.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuraIconReference {
    /// Dossier CPK.
    pub folder: AuraIconFolder,
    /// Code de famille (`k000020` ou `a000020`).
    pub base_code: String,
}

/// Résout le code d'icône de famille d'une aura.
///
/// Les formes `wk*`, `wak*`, `wao*` et `wad*` pointent vers `aura_fs/kNNNNNN`; les Souls
/// `ws*` pointent vers `aura_soul/aNNNNNN`. `was*` est volontairement refusé : le corpus réel
/// répartit ces formes armées dans deux familles sans règle dérivable. Le nombre est arrondi à
/// la dizaine inférieure, car les conteneurs d'icône du jeu ne portent que les familles.
#[must_use]
pub fn aura_icon_reference(asset_code: &str) -> Option<AuraIconReference> {
    let lower = asset_code.to_ascii_lowercase();
    let (folder, prefix, output_prefix) = if lower.starts_with("wk") {
        (AuraIconFolder::AuraFs, "wk", 'k')
    } else if lower.starts_with("wak") || lower.starts_with("wao") || lower.starts_with("wad") {
        (AuraIconFolder::AuraFs, "wa", 'k')
    } else if lower.starts_with("ws") {
        (AuraIconFolder::AuraSoul, "ws", 'a')
    } else {
        return None;
    };
    let digits = digits_after_three_byte_prefix(&lower, prefix)?;
    let family = family_number(&digits)?;
    Some(AuraIconReference {
        folder,
        base_code: format!("{output_prefix}{family:06}"),
    })
}

/// Produit le basename du télop d'aura, sans consulter l'index des fichiers.
///
/// `None` signifie qu'aucun mapping fiable n'existe (notamment Miximax `wmm*`). Le host doit
/// encore vérifier la présence du basename dans son catalogue `telop_waza` avant de construire
/// une URL, comme le faisait le manifest Azalée.
#[must_use]
pub fn aura_telop_code(asset_code: &str) -> Option<String> {
    let lower = asset_code.to_ascii_lowercase();
    if lower.starts_with("wmm") {
        return None;
    }
    if lower.starts_with("wk") {
        let digits = digits_after_three_byte_prefix(&lower, "wk")?;
        return Some(format!("k{:0>6}", digits));
    }
    if lower.starts_with("wap") {
        return Some(format!("aura_power_{asset_code}"));
    }
    if lower.starts_with("ws") || lower.starts_with("wa") {
        let prefix = if lower.starts_with("ws") { "ws" } else { "wa" };
        let digits = digits_after_three_byte_prefix(&lower, prefix)?;
        return Some(format!("a{:0>6}", digits));
    }
    if lower.starts_with("mode_change_") {
        return Some(asset_code.to_owned());
    }
    if lower.contains("awakening") {
        return Some("aura_power01".to_owned());
    }
    None
}

/// Extrait le premier code modèle `k` à six chiffres dans plusieurs sources textuelles.
///
/// Les limites numériques reproduisent le lookaround du helper TypeScript : `k000010` est
/// admis dans un chemin, mais `xk0000100` et `k0000100` ne le sont pas.
#[must_use]
pub fn extract_keshin_model_code<'a, I>(sources: I) -> Option<String>
where
    I: IntoIterator<Item = Option<&'a str>>,
{
    for source in sources {
        let Some(source) = source else {
            continue;
        };
        let bytes = source.as_bytes();
        for (index, &byte) in bytes.iter().enumerate() {
            if !matches!(byte, b'k' | b'K')
                || (index > 0 && bytes[index - 1].is_ascii_digit())
                || index + 7 > bytes.len()
            {
                continue;
            }
            let candidate = &bytes[index + 1..index + 7];
            if !candidate.iter().all(u8::is_ascii_digit)
                || (index + 7 < bytes.len() && bytes[index + 7].is_ascii_digit())
            {
                continue;
            }
            return core::str::from_utf8(&bytes[index..index + 7])
                .ok()
                .map(|value| value.to_ascii_lowercase());
        }
    }
    None
}

/// Retire un suffixe de variante de code personnage (`_5000`, `_5100`, …).
#[must_use]
pub fn strip_character_variant(code: &str) -> &str {
    let bytes = code.as_bytes();
    if bytes.len() >= 5
        && bytes[bytes.len() - 5] == b'_'
        && bytes[bytes.len() - 4..].iter().all(u8::is_ascii_digit)
    {
        &code[..code.len() - 5]
    } else {
        code
    }
}

fn digits_after_three_byte_prefix(value: &str, two_byte_prefix: &str) -> Option<String> {
    let bytes = value.as_bytes();
    if bytes.len() < 4 || !value.starts_with(two_byte_prefix) || !bytes[2].is_ascii_alphabetic() {
        return None;
    }
    let end = bytes[3..]
        .iter()
        .position(|byte| !byte.is_ascii_digit())
        .map_or(bytes.len(), |offset| offset + 3);
    (end > 3).then(|| value[3..end].to_owned())
}

fn family_number(digits: &str) -> Option<u64> {
    let value = digits.parse::<u64>().ok()?;
    Some((value / 10) * 10)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_aura_icon_families_and_preserves_undetermined_was() {
        assert_eq!(
            aura_icon_reference("wks00020"),
            Some(AuraIconReference {
                folder: AuraIconFolder::AuraFs,
                base_code: "k000020".to_owned()
            })
        );
        assert_eq!(
            aura_icon_reference("wad00651").map(|r| (r.folder, r.base_code)),
            Some((AuraIconFolder::AuraFs, "k000650".to_owned()))
        );
        assert_eq!(
            aura_icon_reference("wss00020").map(|r| (r.folder, r.base_code)),
            Some((AuraIconFolder::AuraSoul, "a000020".to_owned()))
        );
        assert_eq!(aura_icon_reference("was00020"), None);
        assert_eq!(
            aura_icon_reference("wks02060_st0901").unwrap().base_code,
            "k002060"
        );
    }

    #[test]
    fn maps_aura_telops_and_rejects_miximax() {
        assert_eq!(aura_telop_code("wks00020").as_deref(), Some("k000020"));
        assert_eq!(aura_telop_code("was00240_b1").as_deref(), Some("a000240"));
        assert_eq!(
            aura_telop_code("wap00010").as_deref(),
            Some("aura_power_wap00010")
        );
        assert_eq!(
            aura_telop_code("mode_change_fire").as_deref(),
            Some("mode_change_fire")
        );
        assert_eq!(
            aura_telop_code("some_awakening_01").as_deref(),
            Some("aura_power01")
        );
        assert_eq!(aura_telop_code("wmm00100"), None);
    }

    #[test]
    fn extracts_model_codes_with_numeric_boundaries() {
        assert_eq!(
            extract_keshin_model_code([
                Some("no model"),
                Some("aura_fs/k000010_l.g4tx/k000010_l00")
            ])
            .as_deref(),
            Some("k000010")
        );
        assert_eq!(
            extract_keshin_model_code([Some("xk000010")]),
            Some("k000010".to_owned())
        );
        assert_eq!(extract_keshin_model_code([Some("k0000100")]), None);
        assert_eq!(
            extract_keshin_model_code([None, Some("k000010")]),
            Some("k000010".to_owned())
        );
    }

    #[test]
    fn strips_only_four_digit_character_variants() {
        assert_eq!(strip_character_variant("c01000010_5000"), "c01000010");
        assert_eq!(strip_character_variant("c01000010"), "c01000010");
        assert_eq!(strip_character_variant("k000010_1"), "k000010_1");
    }
}
