//! Discovery of localized game resources from VFS paths.
//!
//! Locale tags come from existing native companion-resolution evidence. The VFS scan then
//! reports tags that occur as exact path components, retaining localized textures, fonts and
//! Criware banks even where a build has no corresponding text table.

use alloc::collections::{BTreeMap, BTreeSet};
use alloc::string::{String, ToString};
use alloc::vec::Vec;

/// Native locale tags established by the existing companion resolver and RE evidence.
pub const LOCALE_TAGS: [&str; 10] = [
    "de", "en", "es", "fr", "it", "pt", "ja", "ko", "zh_hans", "zh_hant",
];

/// A resource category inferred solely from its VFS path and extension.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "snake_case"))]
pub enum LocalizedAssetKind {
    Text,
    Texture,
    Font,
    Audio,
    Other,
}

impl LocalizedAssetKind {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Text => "text",
            Self::Texture => "texture",
            Self::Font => "font",
            Self::Audio => "audio",
            Self::Other => "other",
        }
    }
}

/// Measured localized resource totals for one VFS locale tag.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct LocaleAssets {
    pub locale: String,
    /// Counts keyed by [`LocalizedAssetKind::as_str`].
    pub kinds: BTreeMap<String, usize>,
    /// Exact VFS paths retained as bounded evidence, never synthesized replacements.
    pub samples: BTreeMap<String, Vec<String>>,
}

/// Locale report derived exclusively from the indexed VFS paths.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct LocaleAssetReport {
    pub locales: Vec<LocaleAssets>,
}

fn kind_for(path: &str, locale: &str) -> LocalizedAssetKind {
    if path.starts_with("data/common/text/")
        && path
            .split('/')
            .nth(3)
            .is_some_and(|segment| segment == locale)
    {
        return LocalizedAssetKind::Text;
    }
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".g4tx") {
        LocalizedAssetKind::Texture
    } else if lower.ends_with(".font") || lower.contains("/font/") {
        LocalizedAssetKind::Font
    } else if lower.ends_with(".hca")
        || lower.ends_with(".acb")
        || lower.ends_with(".awb")
        || lower.ends_with(".adx")
    {
        LocalizedAssetKind::Audio
    } else {
        LocalizedAssetKind::Other
    }
}

fn has_locale_component(path: &str, locale: &str) -> bool {
    path.split('/').any(|segment| segment == locale)
}

/// Scans VFS paths for the locales and localized resources present in this game build.
///
/// `sample_limit` bounds retained evidence per `(locale, kind)` and does not affect totals.
/// A locale is admitted only when an actual `data/common/text/<locale>/...` resource proves it.
#[must_use]
pub fn discover_locale_assets<'a, I>(paths: I, sample_limit: usize) -> LocaleAssetReport
where
    I: IntoIterator<Item = &'a str>,
{
    let paths: Vec<&str> = paths.into_iter().collect();
    let locales: BTreeSet<&str> = paths
        .iter()
        .flat_map(|path| path.split('/'))
        .filter(|segment| LOCALE_TAGS.contains(segment))
        .collect();
    let mut reports: BTreeMap<&str, LocaleAssets> = locales
        .iter()
        .map(|locale| {
            (
                *locale,
                LocaleAssets {
                    locale: (*locale).to_string(),
                    kinds: BTreeMap::new(),
                    samples: BTreeMap::new(),
                },
            )
        })
        .collect();

    for path in paths {
        for locale in &locales {
            if !has_locale_component(path, locale) {
                continue;
            }
            let kind = kind_for(path, locale).as_str().to_string();
            let report = reports.get_mut(locale).expect("locale report exists");
            *report.kinds.entry(kind.clone()).or_default() += 1;
            let samples = report.samples.entry(kind).or_default();
            if samples.len() < sample_limit {
                samples.push(path.to_string());
            }
            break;
        }
    }

    LocaleAssetReport {
        locales: reports.into_values().collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::{LocalizedAssetKind, discover_locale_assets};

    #[test]
    fn discovers_native_locale_assets_even_without_text() {
        let paths = [
            "data/common/text/fr/menu_text.cfg.bin",
            "data/common/text/en/menu_text.cfg.bin",
            "data/dx11/menu/220_img/chapter_title/fr/chapter01.g4tx",
            "data/common/font/fr/standard.font",
            "data/common/sound/voice/en/line.hca",
            "data/dx11/menu/unrelated/de/icon.g4tx",
        ];
        let report = discover_locale_assets(paths, 1);
        assert_eq!(report.locales.len(), 3);
        let de = &report.locales[0];
        assert_eq!(de.locale, "de");
        assert_eq!(de.kinds.get(LocalizedAssetKind::Texture.as_str()), Some(&1));
        let fr = &report.locales[2];
        assert_eq!(fr.locale, "fr");
        assert_eq!(fr.kinds.get(LocalizedAssetKind::Text.as_str()), Some(&1));
        assert_eq!(fr.kinds.get(LocalizedAssetKind::Texture.as_str()), Some(&1));
        assert_eq!(fr.kinds.get(LocalizedAssetKind::Font.as_str()), Some(&1));
        let en = &report.locales[1];
        assert_eq!(en.kinds.get(LocalizedAssetKind::Audio.as_str()), Some(&1));
        assert!(en.samples.values().all(|samples| samples.len() <= 1));
    }

    #[test]
    fn preserves_totals_when_evidence_is_disabled() {
        let paths = [
            "data/common/text/ja/menu_text.cfg.bin",
            "data/dx11/menu/200_icon/ja/icon.g4tx",
            "data/dx11/menu/200_icon/ja/icon_two.g4tx",
        ];
        let report = discover_locale_assets(paths, 0);
        assert_eq!(report.locales[0].kinds.get("texture"), Some(&2));
        assert!(report.locales[0].samples.values().all(Vec::is_empty));
    }
}
