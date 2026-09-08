//! Portable asset lookup primitives shared by static menu-layout compilers.
//!
//! This module deliberately stops before parsing or rendering a menu.  It owns the
//! deterministic VFS-path rules only, so a browser, an in-memory fixture, and the
//! native VFS can all provide the same asset catalogue without exposing filesystem
//! APIs to WebAssembly.

use std::collections::BTreeMap;

/// Read-only source of menu assets.
///
/// Implementations may be backed by a native VFS, a browser cache, or an in-memory
/// test fixture.  The compiler-facing contract intentionally exposes logical paths
/// and bytes only; it does not require files, CPKs, or a host feature.
pub trait MenuAssetSource {
    /// Iterates the logical paths known to this source.
    fn asset_paths(&self) -> Box<dyn Iterator<Item = &str> + '_>;

    /// Reads one logical asset.  Missing and unreadable assets are represented by
    /// `None`, matching the best-effort behaviour of the existing static exporter.
    fn read_asset(&self, path: &str) -> Option<Vec<u8>>;
}

/// Deterministic lookup index for static menu assets.
///
/// It is built from logical paths alone.  Parsing menu settings, OBJBINs, G4PKMs,
/// and G4TX files remains the responsibility of the next compiler extraction.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MenuAssetIndex {
    assets_by_basename: BTreeMap<String, Vec<String>>,
    objbin_paths: Vec<String>,
    setting_paths: BTreeMap<String, String>,
}

impl MenuAssetIndex {
    /// Builds an index from a portable menu asset source.
    #[must_use]
    pub fn from_source(source: &impl MenuAssetSource) -> Self {
        Self::from_paths(source.asset_paths())
    }

    /// Builds an index from logical paths.
    #[must_use]
    pub fn from_paths<'a>(paths: impl IntoIterator<Item = &'a str>) -> Self {
        let mut index = Self::default();
        for path in paths {
            index.insert_path(path);
        }
        index.finish();
        index
    }

    /// Adds one logical path before finalising the index.
    fn insert_path(&mut self, path: &str) {
        if let Some(basename) = path.rsplit('/').next() {
            self.assets_by_basename
                .entry(basename.to_owned())
                .or_default()
                .push(path.to_owned());
        }
        if path.contains("/menu/obj/") && path.ends_with(".objbin") {
            self.objbin_paths.push(path.to_owned());
        }
        if path.contains("/menu/cfg/")
            && let Some(name) = path.rsplit('/').next()
            && let Some(stem) = name.strip_suffix("_setting.cfg.bin")
            && !stem.is_empty()
        {
            self.setting_paths
                .entry(stem.to_owned())
                .or_insert_with(|| path.to_owned());
        }
    }

    /// Sorts all lookup candidates so results do not depend on source iteration order.
    fn finish(&mut self) {
        for paths in self.assets_by_basename.values_mut() {
            paths.sort_unstable();
        }
        self.objbin_paths.sort_unstable();
    }

    /// Resolves an asset path using the game's locale fallback order.
    #[must_use]
    pub fn resolve_asset(&self, logical_path: &str, locale: &str) -> Option<String> {
        let basename = logical_path.rsplit('/').next().filter(|value| !value.is_empty())?;
        choose_asset_basename(self.assets_by_basename.get(basename)?.clone(), basename, locale)
    }

    /// Resolves an OBJBIN path, accepting the setting's prefix form when necessary.
    #[must_use]
    pub fn resolve_objbin(&self, logical_path: &str) -> Option<String> {
        let basename = logical_path.rsplit('/').next().filter(|value| !value.is_empty())?;
        let stem = basename.strip_suffix(".objbin").unwrap_or(basename);
        let prefix = format!("{stem}_");
        self.objbin_paths
            .iter()
            .filter(|path| {
                let candidate = path.rsplit('/').next().unwrap_or(path);
                candidate == basename
                    || candidate
                        .strip_suffix(".objbin")
                        .is_some_and(|name| name == stem || name.starts_with(&prefix))
            })
            .min_by_key(|path| path.rsplit('/').next().unwrap_or(path).len())
            .cloned()
    }

    /// Returns the exact `*_setting.cfg.bin` path for a screen, if present.
    #[must_use]
    pub fn setting_path(&self, setting: &str) -> Option<&str> {
        self.setting_paths.get(setting).map(String::as_str)
    }
}

/// Resolves one asset from arbitrary logical paths without constructing an index.
///
/// This is appropriate for one-off native lookups; repeated compilation should use
/// [`MenuAssetIndex`] instead.
#[must_use]
pub fn resolve_asset_basename<'a>(
    paths: impl IntoIterator<Item = &'a str>,
    logical_path: &str,
    locale: &str,
) -> Option<String> {
    let basename = logical_path.rsplit('/').next().filter(|value| !value.is_empty())?;
    let matches = paths
        .into_iter()
        .filter(|path| {
            path.ends_with(basename)
                && (path.len() == basename.len()
                    || path.as_bytes().get(path.len() - basename.len() - 1) == Some(&b'/'))
        })
        .map(str::to_owned)
        .collect();
    choose_asset_basename(matches, basename, locale)
}

/// Chooses among same-basename paths with the game-compatible locale fallback order.
#[must_use]
pub fn choose_asset_basename(
    mut matches: Vec<String>,
    basename: &str,
    locale: &str,
) -> Option<String> {
    matches.sort_unstable();

    if let Some(path) = matches
        .iter()
        .find(|path| parent_segment(path, basename.len()) == locale)
    {
        return Some(path.clone());
    }
    if let Some(path) = matches
        .iter()
        .find(|path| !is_locale_tag(parent_segment(path, basename.len())))
    {
        return Some(path.clone());
    }
    for fallback in ["common", "en"] {
        if let Some(path) = matches
            .iter()
            .find(|path| parent_segment(path, basename.len()) == fallback)
        {
            return Some(path.clone());
        }
    }
    matches.into_iter().next()
}

fn parent_segment(path: &str, basename_len: usize) -> &str {
    let Some(directory_end) = path.len().checked_sub(basename_len + 1) else {
        return "";
    };
    path.get(..directory_end)
        .and_then(|directory| directory.rsplit('/').next())
        .unwrap_or("")
}

/// Known locale directory names used by IEVR menu assets.
#[must_use]
pub fn is_locale_tag(segment: &str) -> bool {
    matches!(
        segment,
        "de" | "en" | "es" | "fr" | "it" | "pt" | "ja" | "ko" | "zh_hans" | "zh_hant" | "common"
    )
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::{MenuAssetIndex, MenuAssetSource, resolve_asset_basename};

    struct MemoryAssets {
        assets: BTreeMap<String, Vec<u8>>,
    }

    impl MenuAssetSource for MemoryAssets {
        fn asset_paths(&self) -> Box<dyn Iterator<Item = &str> + '_> {
            Box::new(self.assets.keys().map(String::as_str))
        }

        fn read_asset(&self, path: &str) -> Option<Vec<u8>> {
            self.assets.get(path).cloned()
        }
    }

    #[test]
    fn locale_choice_is_deterministic_and_prefers_requested_locale() {
        let paths = [
            "data/menu/texture/en/title.g4tx",
            "data/menu/texture/fr/title.g4tx",
            "data/menu/texture/common/title.g4tx",
        ];
        assert_eq!(
            resolve_asset_basename(paths, "ignored/title.g4tx", "fr"),
            Some("data/menu/texture/fr/title.g4tx".to_owned())
        );
        assert_eq!(
            resolve_asset_basename(paths, "ignored/title.g4tx", "ja"),
            Some("data/menu/texture/common/title.g4tx".to_owned())
        );
    }

    #[test]
    fn index_uses_exact_setting_and_shortest_objbin_prefix_match() {
        let source = MemoryAssets {
            assets: BTreeMap::from([
                (
                    "data/common/gamedata/menu/cfg/main_menu_setting.cfg.bin".to_owned(),
                    vec![1],
                ),
                (
                    "data/common/gamedata/menu/cfg/victory_road_main_menu_setting.cfg.bin"
                        .to_owned(),
                    vec![2],
                ),
                (
                    "data/common/gamedata/menu/obj/btl01_10_battle_title.objbin".to_owned(),
                    vec![3],
                ),
                (
                    "data/common/gamedata/menu/obj/btl01_10_extra_long.objbin".to_owned(),
                    vec![4],
                ),
            ]),
        };
        let index = MenuAssetIndex::from_source(&source);
        assert_eq!(
            index.setting_path("main_menu"),
            Some("data/common/gamedata/menu/cfg/main_menu_setting.cfg.bin")
        );
        assert_eq!(
            index.resolve_objbin("menu/obj/btl01_10.objbin"),
            Some("data/common/gamedata/menu/obj/btl01_10_extra_long.objbin".to_owned())
        );
        assert_eq!(source.read_asset("missing"), None);
    }
}
