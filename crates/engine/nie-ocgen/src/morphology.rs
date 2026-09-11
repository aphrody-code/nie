//! Morphologies — the sixteen `mdl_editpreview_avatar_*` documents the editor previews.
//!
//! Each one is a complete [`CharaEditParam`](crate::param::CharaEditParam): a body type, a full
//! part set, a colour set and eight bone edits. That is what makes them usable as a **starting
//! model**: generating a character does not begin from an empty document whose slot hashes would
//! have to be invented, it begins from a shipped document and substitutes what is justified.
//!
//! The `body_type_NN` resource is read from the document, never derived from the file name. Two
//! file names can land on the same body type — `tall01` and `tallfemale01` both carry
//! `body_type_05` — and a name-based mapping would have hidden that.

use serde::{Deserialize, Serialize};

use crate::{Error, param::CharaEditParam};

/// How tall the character reads on its reference sheets.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Stature {
    /// Below the shared adult baseline.
    Small,
    /// The baseline build the editor opens on.
    Normal,
    /// Above the baseline.
    Tall,
}

/// How heavy the silhouette reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Build {
    /// No added mass.
    Normal,
    /// Athletic mass.
    Muscle,
    /// Rounded mass.
    Fat,
    /// Large frame.
    Big,
}

/// Which gendered variant of a morphology to prefer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Gender {
    /// Male variants.
    Male,
    /// Female variants.
    Female,
}

/// The traits a caller asks for; the catalogue answers with the closest shipped document.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct MorphologyQuery {
    /// Preferred gendered variant.
    pub gender: Gender,
    /// Height band.
    pub stature: Stature,
    /// Mass band.
    pub build: Build,
}

/// One shipped morphology document, decoded.
#[derive(Debug, Clone)]
pub struct Morphology {
    /// File stem, e.g. `mdl_editpreview_avatar_tallmuscle01`.
    pub stem: String,
    /// Key parsed from the stem, e.g. `tallmuscle` (empty stem suffix reads as `default`).
    pub key: String,
    /// Numeric variant suffix, e.g. `01`.
    pub variant: String,
    /// Height band the key encodes.
    pub stature: Stature,
    /// Mass band the key encodes.
    pub build: Build,
    /// Gendered variant the key encodes; `None` when the key says nothing about it.
    pub gender: Option<Gender>,
    /// `body_type_NN`, read from the document's model parts.
    pub body_type: String,
    /// The document itself, ready to be used as a starting model.
    pub document: CharaEditParam,
}

/// Splits `mdl_editpreview_avatar_<key><NN>` into its key and its numeric variant.
fn split_stem(stem: &str) -> (String, String) {
    let tail = stem
        .strip_prefix("mdl_editpreview_avatar_")
        .or_else(|| stem.strip_prefix("mdl_editpreview_avatar"))
        .unwrap_or(stem);
    let digits = tail.len() - tail.trim_end_matches(|c: char| c.is_ascii_digit()).len();
    let (key, variant) = tail.split_at(tail.len() - digits);
    let key = match key.is_empty() {
        true => "default",
        false => key,
    };
    (key.to_string(), variant.to_string())
}

/// Reads the height, mass and gender bands a morphology key encodes.
fn bands(key: &str) -> (Stature, Build, Option<Gender>) {
    let gender = match key.contains("female") {
        true => Some(Gender::Female),
        false => match key.contains("male") {
            true => Some(Gender::Male),
            false => None,
        },
    };
    let stature = match () {
        () if key.starts_with("small") => Stature::Small,
        () if key.starts_with("tall") => Stature::Tall,
        () => Stature::Normal,
    };
    let build = match () {
        () if key.contains("muscle") => Build::Muscle,
        () if key.contains("fat") => Build::Fat,
        () if key.starts_with("big") => Build::Big,
        () => Build::Normal,
    };
    (stature, build, gender)
}

impl Morphology {
    /// Decodes one morphology document.
    ///
    /// # Errors
    ///
    /// Returns [`Error::Format`] when the document does not parse, or [`Error::Morphology`] when it
    /// carries no `body_type_*` model part — a preview without a body type is not a morphology.
    pub fn from_document(stem: &str, root: &serde_json::Value) -> Result<Self, Error> {
        let document = CharaEditParam::parse(root)?;
        let body_type = document
            .mdl_parts
            .iter()
            .find(|part| part.resource.starts_with("body_type_"))
            .map(|part| part.resource.clone())
            .ok_or_else(|| {
                Error::Morphology(format!("{stem} : aucun body_type_* dans le document"))
            })?;
        let (key, variant) = split_stem(stem);
        let (stature, build, gender) = bands(&key);
        Ok(Self {
            stem: stem.to_string(),
            key,
            variant,
            stature,
            build,
            gender,
            body_type,
            document,
        })
    }

    /// How well this morphology answers `query`; higher is closer, `0` is no shared trait.
    #[must_use]
    pub fn score(&self, query: &MorphologyQuery) -> u32 {
        let mut score = 0;
        if self.stature == query.stature {
            score += 4;
        }
        if self.build == query.build {
            score += 2;
        }
        match self.gender {
            // An exact match outranks a key that says nothing, which outranks the wrong variant.
            // Without that middle rank, `smallfat01` and `smallfatfemale01` tie on a female query
            // and the alphabetical tie-break hands back the wrong one.
            Some(gender) if gender == query.gender => score += 2,
            None => score += 1,
            Some(_) => {}
        }
        score
    }
}

/// The decoded morphology catalogue.
#[derive(Debug, Clone)]
pub struct MorphologyCatalog {
    /// Every decoded document, sorted by stem.
    pub entries: Vec<Morphology>,
}

impl MorphologyCatalog {
    /// Builds the catalogue from `(stem, document)` pairs.
    ///
    /// # Errors
    ///
    /// Propagates the first document that fails to decode.
    pub fn new(documents: &[(String, serde_json::Value)]) -> Result<Self, Error> {
        let mut entries = documents
            .iter()
            .map(|(stem, root)| Morphology::from_document(stem, root))
            .collect::<Result<Vec<_>, _>>()?;
        entries.sort_by(|left, right| left.stem.cmp(&right.stem));
        Ok(Self { entries })
    }

    /// Best match for `query`, with deterministic tie-breaking by stem.
    ///
    /// # Errors
    ///
    /// Returns [`Error::Morphology`] when the catalogue is empty.
    pub fn select(&self, query: &MorphologyQuery) -> Result<&Morphology, Error> {
        self.entries
            .iter()
            .max_by_key(|entry| (entry.score(query), std::cmp::Reverse(entry.stem.clone())))
            .ok_or_else(|| Error::Morphology("catalogue de morphologies vide".to_string()))
    }

    /// Looks a morphology up by file stem.
    #[must_use]
    pub fn by_stem(&self, stem: &str) -> Option<&Morphology> {
        self.entries.iter().find(|entry| entry.stem == stem)
    }
}
