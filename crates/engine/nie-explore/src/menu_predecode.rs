//! Portable selection policy for menu sprite predecoding.

use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PredecodePlan {
    pub paths: Vec<String>,
    pub by_archive: BTreeMap<String, Vec<String>>,
    pub missing_archive: Vec<String>,
}

#[must_use]
pub fn should_include(path: &str, target_locales: &[&str]) -> bool {
    let Some(parent) = path.rsplit('/').nth(1) else {
        return false;
    };
    if target_locales.contains(&parent) {
        return true;
    }
    const KNOWN: &[&str] = &[
        "fr", "en", "de", "es", "it", "pt", "ko", "ja", "zh_hans", "zh_hant", "ar", "ru",
    ];
    !KNOWN.contains(&parent)
}

/// Builds a deterministic decoding plan from injected index rows.
#[must_use]
pub fn plan(
    priority_paths: &[String],
    indexed: &[(String, String)],
    include_all_menu: bool,
    target_locales: &[&str],
) -> PredecodePlan {
    let archive_by_path: BTreeMap<&str, &str> = indexed
        .iter()
        .filter_map(|(field, archive)| {
            field
                .strip_prefix("data/")
                .map(|path| (path, archive.as_str()))
        })
        .collect();
    let mut seen = BTreeSet::new();
    let mut paths = Vec::new();
    for path in priority_paths {
        if archive_by_path.contains_key(path.as_str()) && seen.insert(path.clone()) {
            paths.push(path.clone());
        }
    }
    if include_all_menu {
        for path in archive_by_path.keys().copied() {
            if path.starts_with("dx11/menu/")
                && path.ends_with(".g4tx")
                && should_include(path, target_locales)
                && seen.insert(path.to_string())
            {
                paths.push(path.to_string());
            }
        }
    }
    let mut by_archive: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut missing_archive = Vec::new();
    for path in &paths {
        if let Some(archive) = archive_by_path.get(path.as_str()) {
            by_archive
                .entry((*archive).to_string())
                .or_default()
                .push(path.clone());
        } else {
            missing_archive.push(path.clone());
        }
    }
    PredecodePlan {
        paths,
        by_archive,
        missing_archive,
    }
}

#[cfg(test)]
mod tests {
    use super::{plan, should_include};
    #[test]
    fn locale_policy_keeps_requested_and_base_paths_only() {
        assert!(should_include("dx11/menu/a/fr/a.g4tx", &["fr", "en"]));
        assert!(should_include("dx11/menu/a/a.g4tx", &["fr", "en"]));
        assert!(!should_include("dx11/menu/a/de/a.g4tx", &["fr", "en"]));
    }

    #[test]
    fn plan_prioritizes_deduplicates_filters_and_groups() {
        let priority = vec!["dx11/menu/a/fr/a.g4tx".into(), "missing.g4tx".into()];
        let indexed = vec![
            ("data/dx11/menu/a/de/no.g4tx".into(), "b.cpk".into()),
            ("data/dx11/menu/a/base.g4tx".into(), "a.cpk".into()),
            ("data/dx11/menu/a/fr/a.g4tx".into(), "b.cpk".into()),
        ];
        let result = plan(&priority, &indexed, true, &["fr"]);
        assert_eq!(
            result.paths,
            vec!["dx11/menu/a/fr/a.g4tx", "dx11/menu/a/base.g4tx"]
        );
        assert_eq!(result.by_archive["b.cpk"], vec!["dx11/menu/a/fr/a.g4tx"]);
        assert!(result.missing_archive.is_empty());
    }
}
