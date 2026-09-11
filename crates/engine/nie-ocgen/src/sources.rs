//! Where the pipeline reads from: the decoded editor tables and the character's own references.
//!
//! Everything here comes from files already in the checkout. The editor tables are the `*.cfg.bin`
//! dumps converted to iecode JSON under `data/common/`; the references are the character's own
//! sheets under `data/oc/<slug>/source/`. Nothing in this module opens the game's VFS, so the
//! whole chain runs on a machine where the game is not installed — which is the state this one is
//! in, and the reason the generation stage is separated from the assembly stage.

use std::{fs, path::Path};

use nie_data::chara_edit::{
    CharaEditConfig, CharaEditPartsTypeConfig, parse_chara_edit, parse_chara_edit_parts_type_config,
};
use serde_json::Value;

use crate::{Error, morphology::MorphologyCatalog, palette::Sheet, param::CharaEditParam};

/// Relative path of the character-editor tables inside the dump root.
const GAMEDATA: &str = "common/gamedata/character";
/// Relative path of the editor's preview documents inside the dump root.
const PREVIEWS: &str = "common/chr/_test/default";

/// Reads a JSON file.
fn read_json(path: &Path) -> Result<Value, Error> {
    let bytes =
        fs::read(path).map_err(|error| Error::Io(format!("{}: {error}", path.display())))?;
    serde_json::from_slice(&bytes)
        .map_err(|error| Error::Format(format!("{}: {error}", path.display())))
}

/// Lists a directory, sorted, so a run is reproducible whatever the filesystem order is.
fn entries(dir: &Path) -> Result<Vec<std::path::PathBuf>, Error> {
    let mut out = fs::read_dir(dir)
        .map_err(|error| Error::Io(format!("{}: {error}", dir.display())))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .collect::<Vec<_>>();
    out.sort();
    Ok(out)
}

/// Finds the first file in `dir` whose name starts with `prefix`, ends with `suffix`, and does not
/// start with `reject`.
fn find_one(
    dir: &Path,
    prefix: &str,
    suffix: &str,
    reject: Option<&str>,
) -> Result<std::path::PathBuf, Error> {
    entries(dir)?
        .into_iter()
        .find(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| {
                    name.starts_with(prefix)
                        && name.ends_with(suffix)
                        && !reject.is_some_and(|reject| name.starts_with(reject))
                })
        })
        .ok_or_else(|| {
            Error::Io(format!(
                "{prefix}*{suffix} introuvable dans {}",
                dir.display()
            ))
        })
}

/// The editor tables and preview documents the pipeline needs.
pub struct EditorSources {
    /// `chara_edit_<version>.cfg.bin` — the sixteen part lists.
    pub catalog: CharaEditConfig,
    /// `chara_edit_parts_type_config_<version>.cfg.bin` — face and accessory models per morphology.
    pub parts_types: CharaEditPartsTypeConfig,
    /// The sixteen `mdl_editpreview_avatar_*` documents.
    pub morphologies: MorphologyCatalog,
    /// `edit_parameter.cfg.bin` — the saved-avatar template whose slot hashes the pipeline reuses.
    pub template: CharaEditParam,
    /// Version string carried by the catalogue file name, kept for the run report.
    pub catalog_version: String,
}

impl EditorSources {
    /// Loads every editor input from a decoded dump root (the repository's `data/`).
    ///
    /// # Errors
    ///
    /// Returns [`Error::Io`] when a required file is missing and [`Error::Format`] when one does
    /// not decode.
    pub fn load(dump_root: &Path) -> Result<Self, Error> {
        let gamedata = dump_root.join(GAMEDATA);
        // `chara_edit_parts_type_config_*` also starts with `chara_edit_`; rejecting that prefix
        // is what keeps the catalogue lookup from picking it up by alphabetical accident.
        let catalog_path = find_one(
            &gamedata,
            "chara_edit_",
            ".cfg.bin.json",
            Some("chara_edit_parts_type_config"),
        )?;
        let types_path = find_one(
            &gamedata,
            "chara_edit_parts_type_config",
            ".cfg.bin.json",
            None,
        )?;
        let catalog_version = catalog_path
            .file_name()
            .and_then(|name| name.to_str())
            .and_then(|name| name.strip_prefix("chara_edit_"))
            .and_then(|name| name.strip_suffix(".cfg.bin.json"))
            .unwrap_or("inconnue")
            .to_string();

        let catalog = parse_chara_edit(&read_json(&catalog_path)?);
        let parts_types = parse_chara_edit_parts_type_config(&read_json(&types_path)?);

        let previews = dump_root.join(PREVIEWS);
        let mut documents = Vec::new();
        for path in entries(&previews)? {
            let Some(stem) = path
                .file_name()
                .and_then(|name| name.to_str())
                .and_then(|name| name.strip_suffix(".cfg.bin.json"))
            else {
                continue;
            };
            if stem.starts_with("mdl_editpreview_avatar") {
                documents.push((stem.to_string(), read_json(&path)?));
            }
        }
        let morphologies = MorphologyCatalog::new(&documents)?;
        let template =
            CharaEditParam::parse(&read_json(&previews.join("edit_parameter.cfg.bin.json"))?)?;

        Ok(Self {
            catalog,
            parts_types,
            morphologies,
            template,
            catalog_version,
        })
    }
}

/// One decoded reference image plus what the checkout knows about it.
pub struct Reference {
    /// Path relative to the character's `source/` directory, e.g. `sheets/03-og-anatomy.jpg`.
    pub relative: String,
    /// Decoded pixels.
    pub sheet: Sheet,
    /// Size on disk, reported so a run can be matched against `provenance/SHA256SUMS`.
    pub bytes: u64,
}

/// Every reference image of one character.
pub struct ReferenceSet {
    /// Decoded images, sorted by relative path.
    pub images: Vec<Reference>,
}

impl ReferenceSet {
    /// Decodes every image under `source_dir`, recursively.
    ///
    /// File extensions are not trusted: two of the recorded comic pages carry WebP bytes behind a
    /// `.jpg` name, so the decoder sniffs the content instead.
    ///
    /// # Errors
    ///
    /// Returns [`Error::Io`] when the directory cannot be walked, and [`Error::Image`] when a file
    /// that looks like an image does not decode.
    pub fn load(source_dir: &Path) -> Result<Self, Error> {
        let mut images = Vec::new();
        walk(source_dir, source_dir, &mut images)?;
        images.sort_by(|left, right| left.relative.cmp(&right.relative));
        Ok(Self { images })
    }

    /// The decoded sheets, in the shape [`crate::palette::measure`] expects.
    #[must_use]
    pub fn sheets(&self) -> Vec<&Sheet> {
        self.images.iter().map(|image| &image.sheet).collect()
    }
}

/// Recursively decodes every image file below `dir`.
fn walk(root: &Path, dir: &Path, out: &mut Vec<Reference>) -> Result<(), Error> {
    for path in entries(dir)? {
        if path.is_dir() {
            walk(root, &path, out)?;
            continue;
        }
        let relative = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        let bytes = fs::read(&path).map_err(|error| Error::Io(format!("{relative}: {error}")))?;
        // A directory can hold notes next to the artwork; only what decodes is a reference.
        let Ok(sheet) = Sheet::decode(&relative, &bytes) else {
            continue;
        };
        out.push(Reference {
            relative,
            sheet,
            bytes: bytes.len() as u64,
        });
    }
    Ok(())
}
