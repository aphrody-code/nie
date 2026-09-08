//! Shared discovery and indexing of named menu icons in G4TX atlases.

use nie_formats::vfs::Vfs;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
pub struct IconRect {
    pub x: i16,
    pub y: i16,
    pub w: i16,
    pub h: i16,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct MenuIcon {
    pub name: String,
    pub atlas: String,
    pub texture: String,
    pub rect: Option<IconRect>,
    pub width: i32,
    pub height: i32,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct IconIndexStats {
    pub atlases: usize,
    pub skipped: BTreeMap<String, usize>,
    pub unreadable: usize,
}

#[derive(Debug, Clone, Default)]
pub struct MenuIconIndex {
    pub icons: BTreeMap<String, MenuIcon>,
    pub stats: IconIndexStats,
}

#[derive(Debug, Clone, Copy)]
pub struct IconIndexPolicy<'a> {
    pub root: &'a str,
    pub suffix: &'a str,
    pub skipped_families: &'a [&'a str],
}

impl<'a> IconIndexPolicy<'a> {
    #[must_use]
    pub const fn new(root: &'a str, suffix: &'a str, skipped_families: &'a [&'a str]) -> Self {
        Self {
            root,
            suffix,
            skipped_families,
        }
    }
}

enum Candidate<'a> {
    Keep,
    Skip(&'a str),
    Ignore,
}

fn candidate<'a>(path: &str, policy: &IconIndexPolicy<'a>) -> Candidate<'a> {
    if !path.ends_with(policy.suffix) || !path.contains(policy.root) {
        return Candidate::Ignore;
    }
    policy
        .skipped_families
        .iter()
        .find(|family| path.contains(**family))
        .map_or(Candidate::Keep, |family| Candidate::Skip(family))
}

fn is_real_texture(name: &str, width: i32, height: i32) -> bool {
    !name.contains("dmy") && !(width <= 4 && height <= 4)
}

fn is_real_region(name: &str, width: i16) -> bool {
    !name.contains("dmy") && width > 4
}

/// Builds an index from an existing path inventory. Duplicate names keep the first atlas.
#[must_use]
pub fn build_icon_index<I, P>(vfs: &Vfs, paths: I, policy: &IconIndexPolicy<'_>) -> MenuIconIndex
where
    I: IntoIterator<Item = P>,
    P: AsRef<str>,
{
    let mut out = MenuIconIndex::default();
    let mut selected = Vec::new();
    for path in paths {
        match candidate(path.as_ref(), policy) {
            Candidate::Keep => selected.push(path.as_ref().to_owned()),
            Candidate::Skip(family) => {
                *out.stats.skipped.entry(family.to_owned()).or_default() += 1
            }
            Candidate::Ignore => {}
        }
    }
    for path in selected {
        let Ok(raw) = vfs.read(&path) else {
            out.stats.unreadable += 1;
            continue;
        };
        let Ok(atlas) = nie_formats::g4tx::parse(&raw) else {
            out.stats.unreadable += 1;
            continue;
        };
        out.stats.atlases += 1;
        for texture in &atlas.textures {
            if !is_real_texture(&texture.name, texture.width, texture.height) {
                continue;
            }
            out.icons
                .entry(texture.name.clone())
                .or_insert_with(|| MenuIcon {
                    name: texture.name.clone(),
                    atlas: path.clone(),
                    texture: texture.name.clone(),
                    rect: None,
                    width: texture.width,
                    height: texture.height,
                });
            for region in &texture.sub_textures {
                if !is_real_region(&region.name, region.width) {
                    continue;
                }
                out.icons
                    .entry(region.name.clone())
                    .or_insert_with(|| MenuIcon {
                        name: region.name.clone(),
                        atlas: path.clone(),
                        texture: texture.name.clone(),
                        rect: Some(IconRect {
                            x: region.x,
                            y: region.y,
                            w: region.width,
                            h: region.height,
                        }),
                        width: i32::from(region.width),
                        height: i32::from(region.height),
                    });
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{Candidate, IconIndexPolicy, candidate, is_real_region, is_real_texture};
    const SKIPPED: &[&str] = &["10_icon_chr", "01_icon_emblem"];
    const POLICY: IconIndexPolicy<'_> = IconIndexPolicy::new("menu/200_icon/", ".g4tx", SKIPPED);

    #[test]
    fn policy_distinguishes_kept_skipped_and_unrelated_paths() {
        assert!(matches!(
            candidate("data/dx11/menu/200_icon/02_icon_item/a.g4tx", &POLICY),
            Candidate::Keep
        ));
        assert!(matches!(
            candidate("data/dx11/menu/200_icon/10_icon_chr/a.g4tx", &POLICY),
            Candidate::Skip("10_icon_chr")
        ));
        assert!(matches!(
            candidate("data/dx11/menu/220_img/a.g4tx", &POLICY),
            Candidate::Ignore
        ));
        assert!(matches!(
            candidate("data/dx11/menu/200_icon/02_icon_item/a.g4pkm", &POLICY),
            Candidate::Ignore
        ));
    }

    #[test]
    fn placeholders_and_only_tiny_images_are_rejected() {
        assert!(is_real_texture("bar", 4, 64));
        assert!(is_real_texture("bar", 64, 4));
        assert!(!is_real_texture("bar", 4, 4));
        assert!(!is_real_texture("dmy_icon", 256, 256));
        assert!(!is_real_region("bar", 4));
        assert!(is_real_region("bar", 5));
        assert!(!is_real_region("dmy_icon", 64));
    }
}
