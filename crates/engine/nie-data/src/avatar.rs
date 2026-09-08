//! Shared avatar selections and resource composition, without VFS, HTTP or rendering.
//!
//! The resolved catalogue is the existing `niers avatar export` contract. Resource selection
//! is extracted from Azalée's `app/avatar/composition.ts`; all hosts can consume the same result.
//! The original first-part fallback is retained, but explicitly reported as an unverified
//! initial recipe. Native share-code mappings and approximate face/clothing deformations are
//! deliberately not implemented here. A resolved resource list is not a native rendering proof.

use alloc::{
    collections::{BTreeMap, BTreeSet},
    format,
    string::{String, ToString},
    vec::Vec,
};
use core::fmt;

use crate::{hash::HashId, unlock_condition::crc32_str};

/// Fields used from the existing resolved catalogue; unrelated export fields remain compatible.
#[derive(Debug, Clone, Default, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct AvatarCatalog {
    pub categories: Vec<AvatarCategory>,
    #[cfg_attr(feature = "serde", serde(rename = "modelesDeBase"))]
    pub base_models: AvatarBaseModels,
    #[cfg_attr(feature = "serde", serde(default, rename = "couleursRgb"))]
    pub palette_colors: BTreeMap<String, AvatarPaletteColor>,
    #[cfg_attr(feature = "serde", serde(default))]
    pub presets: Vec<AvatarPreset>,
}

/// Native preset records retain exact part identifiers; names alone are ambiguous across slots.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct AvatarPreset {
    #[cfg_attr(feature = "serde", serde(rename = "presetID"))]
    pub id: String,
    #[cfg_attr(feature = "serde", serde(default, rename = "recette"))]
    pub recipe: Vec<AvatarRecipeEntry>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct AvatarRecipeEntry {
    #[cfg_attr(feature = "serde", serde(rename = "emplacement"))]
    pub slot: u32,
    #[cfg_attr(feature = "serde", serde(rename = "valeur"))]
    pub value: i64,
    #[cfg_attr(feature = "serde", serde(rename = "couleur"))]
    pub color: i64,
    pub part: Option<String>,
    #[cfg_attr(feature = "serde", serde(default, rename = "partId"))]
    pub part_id: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct AvatarCategory {
    #[cfg_attr(feature = "serde", serde(rename = "faceSettingType"))]
    pub setting_type: u32,
    pub parts: Vec<AvatarPart>,
    #[cfg_attr(feature = "serde", serde(default, rename = "couleurs"))]
    pub colors: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct AvatarPart {
    pub id: String,
    #[cfg_attr(feature = "serde", serde(default, rename = "itemNo"))]
    pub item_no: u32,
    #[cfg_attr(feature = "serde", serde(default))]
    pub resource: String,
    #[cfg_attr(feature = "serde", serde(default, rename = "modeles"))]
    pub models: Vec<String>,
    #[cfg_attr(feature = "serde", serde(default, rename = "modeles2"))]
    pub secondary_models: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct AvatarBaseModels {
    #[cfg_attr(feature = "serde", serde(rename = "morphologies"))]
    pub morphologies: Vec<String>,
    #[cfg_attr(feature = "serde", serde(rename = "visages"))]
    pub faces: Vec<AvatarFaceBase>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct AvatarFaceBase {
    #[cfg_attr(feature = "serde", serde(rename = "noseType"))]
    pub nose_type: String,
    pub resources: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct AvatarPaletteColor {
    pub rgb: String,
    pub alpha: f64,
}

/// Editable settings currently consumed by the shared resource pipeline.
///
/// Category 17, when explicitly selected, overrides `morphology` by its named resource;
/// `gender` then chooses male/female within that pair. Hosts should clear category 17 when
/// changing the morphology control. Other gender variants have no established body mapping.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(default, rename_all = "camelCase"))]
pub struct AvatarState {
    pub selections: BTreeMap<u32, String>,
    pub gender: u8,
    pub morphology: usize,
    pub height: Option<u8>,
    pub palette_selections: BTreeMap<u32, usize>,
    pub custom_colors: BTreeMap<u32, String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct AvatarPiece {
    pub directory: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "snake_case"))]
pub enum AvatarWarningCode {
    UnverifiedDefaultPart,
    UnresolvedGenderVariant,
    UnresolvedFaceVariant,
    UnresolvedPresetRecipe,
    UnsupportedPresetParameter,
    UnsupportedSetting,
    UnsupportedColor,
    UnresolvedPaletteColor,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct AvatarWarning {
    pub code: AvatarWarningCode,
    pub category: Option<u32>,
}

/// Transport-neutral inputs for the existing mesh/texture assembler.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct AvatarComposition {
    pub pieces: Vec<AvatarPiece>,
    pub face_layers: Vec<String>,
    pub morphology: String,
    pub morphology_index: usize,
    pub skeleton: String,
    pub height: Option<u8>,
    pub skin_color: Option<String>,
    pub iris_color: Option<String>,
    pub hair_color: Option<String>,
    pub warnings: Vec<AvatarWarning>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(tag = "code", rename_all = "snake_case"))]
pub enum AvatarResolveError {
    InvalidState { field: String },
    InvalidCatalog { reason: String },
    UnknownCategory { category: u32 },
    UnknownPart { category: u32, id: String },
    InvalidResource { path: String },
    MissingResource { kind: String },
    InvalidColor { category: u32 },
}

impl fmt::Display for AvatarResolveError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidState { field } => write!(f, "Invalid avatar setting: {field}"),
            Self::InvalidCatalog { reason } => write!(f, "Invalid avatar catalogue: {reason}"),
            Self::UnknownCategory { category } => write!(f, "Unknown avatar category: {category}"),
            Self::UnknownPart { category, id } => {
                write!(f, "Unknown part {id} in category {category}")
            }
            Self::InvalidResource { path } => write!(f, "Invalid avatar resource: {path}"),
            Self::MissingResource { kind } => write!(f, "Missing avatar resource: {kind}"),
            Self::InvalidColor { category } => {
                write!(f, "Invalid avatar color in category {category}")
            }
        }
    }
}

impl core::error::Error for AvatarResolveError {}

fn invalid_state(field: &str) -> AvatarResolveError {
    AvatarResolveError::InvalidState {
        field: field.to_string(),
    }
}

fn missing(kind: &str) -> AvatarResolveError {
    AvatarResolveError::MissingResource {
        kind: kind.to_string(),
    }
}

fn category(catalog: &AvatarCatalog, setting: u32) -> Result<&AvatarCategory, AvatarResolveError> {
    catalog
        .categories
        .iter()
        .find(|c| c.setting_type == setting)
        .ok_or(AvatarResolveError::UnknownCategory { category: setting })
}

fn selected<'a>(
    category: &'a AvatarCategory,
    state: &AvatarState,
) -> Result<Option<&'a AvatarPart>, AvatarResolveError> {
    match state
        .selections
        .get(&category.setting_type)
        .filter(|id| !id.is_empty())
    {
        Some(id) => category
            .parts
            .iter()
            .find(|p| p.id == *id)
            .map(Some)
            .ok_or_else(|| AvatarResolveError::UnknownPart {
                category: category.setting_type,
                id: id.clone(),
            }),
        None => Ok(None),
    }
}

fn warn(warnings: &mut Vec<AvatarWarning>, code: AvatarWarningCode, category: Option<u32>) {
    let warning = AvatarWarning { code, category };
    if !warnings.contains(&warning) {
        warnings.push(warning);
    }
}

fn selected_or_default<'a>(
    category: &'a AvatarCategory,
    state: &AvatarState,
    warnings: &mut Vec<AvatarWarning>,
) -> Result<Option<&'a AvatarPart>, AvatarResolveError> {
    if let Some(part) = selected(category, state)? {
        return Ok(Some(part));
    }
    let first = category.parts.first();
    if first.is_some() {
        warn(
            warnings,
            AvatarWarningCode::UnverifiedDefaultPart,
            Some(category.setting_type),
        );
    }
    Ok(first)
}

fn token(value: &str, max: usize) -> bool {
    !value.is_empty()
        && value.len() <= max
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

fn validate_path(path: &str) -> Result<(), AvatarResolveError> {
    if path.len() > 512
        || !path.starts_with("data/")
        || path.split('/').any(|segment| {
            segment.is_empty()
                || segment == "."
                || segment == ".."
                || !segment
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'.')
        })
    {
        return Err(AvatarResolveError::InvalidResource {
            path: path.to_string(),
        });
    }
    Ok(())
}

fn add_piece(
    pieces: &mut Vec<AvatarPiece>,
    directory: &str,
    name: &str,
) -> Result<(), AvatarResolveError> {
    if !token(directory, 48) || !token(name, 48) {
        return Err(AvatarResolveError::InvalidResource {
            path: format!("{directory}/{name}"),
        });
    }
    let piece = AvatarPiece {
        directory: directory.to_string(),
        name: name.to_string(),
    };
    if !pieces.contains(&piece) {
        pieces.push(piece);
    }
    Ok(())
}

fn color(
    catalog: &AvatarCatalog,
    state: &AvatarState,
    setting: u32,
    warnings: &mut Vec<AvatarWarning>,
) -> Result<Option<String>, AvatarResolveError> {
    let value = if let Some(value) = state.custom_colors.get(&setting) {
        Some(value.as_str())
    } else if let Some(index) = state.palette_selections.get(&setting) {
        let cat = category(catalog, setting)?;
        let id = cat
            .colors
            .get(*index)
            .ok_or(AvatarResolveError::InvalidColor { category: setting })?;
        match catalog.palette_colors.get(id) {
            Some(color) => Some(color.rgb.as_str()),
            None => {
                warn(
                    warnings,
                    AvatarWarningCode::UnresolvedPaletteColor,
                    Some(setting),
                );
                None
            }
        }
    } else {
        None
    };
    value
        .map(|value| {
            if value.len() != 6 || !value.bytes().all(|b| b.is_ascii_hexdigit()) {
                Err(AvatarResolveError::InvalidColor { category: setting })
            } else {
                Ok(value.to_ascii_uppercase())
            }
        })
        .transpose()
}

fn preset_state(
    catalog: &AvatarCatalog,
    state: &AvatarState,
    warnings: &mut Vec<AvatarWarning>,
) -> Result<AvatarState, AvatarResolveError> {
    let mut effective = state.clone();
    if !state.selections.get(&1).is_some_and(|id| !id.is_empty()) {
        return Ok(effective);
    }
    let Some(part) = selected(category(catalog, 1)?, state)? else {
        return Ok(effective);
    };
    let preset_hash = crc32_str(&part.resource);
    let Some(preset) = catalog
        .presets
        .iter()
        .find(|preset| HashId::parse_hex(&preset.id).is_some_and(|id| id.0 == preset_hash))
    else {
        warn(warnings, AvatarWarningCode::UnresolvedPresetRecipe, Some(1));
        return Ok(effective);
    };
    for entry in &preset.recipe {
        if let Some(id) = entry
            .part_id
            .as_deref()
            .and_then(HashId::parse_hex)
            .filter(|id| !id.is_zero())
        {
            let mut matches = catalog.categories.iter().flat_map(|category| {
                category
                    .parts
                    .iter()
                    .filter(move |part| HashId::parse_hex(&part.id) == Some(id))
                    .map(move |part| (category.setting_type, part))
            });
            let Some((setting, selected_part)) = matches.next() else {
                return Err(missing("preset part"));
            };
            if matches.next().is_some() {
                return Err(AvatarResolveError::InvalidCatalog {
                    reason: "Ambiguous preset part identifier".to_string(),
                });
            }
            effective
                .selections
                .entry(setting)
                .or_insert_with(|| selected_part.id.clone());
        } else if entry.part.is_some() {
            // Older exports discarded partsId. A name such as hairF003 occurs in both hair
            // categories, so treating its first match as identity would select the wrong slot.
            warn(warnings, AvatarWarningCode::UnresolvedPresetRecipe, Some(1));
        } else {
            warn(
                warnings,
                AvatarWarningCode::UnsupportedPresetParameter,
                Some(1),
            );
        }
    }
    Ok(effective)
}

/// Resolve all supported settings with one morphology index for both body and head.
/// Invalid explicit selections never silently turn into an unrelated first part.
pub fn resolve_avatar(
    catalog: &AvatarCatalog,
    state: &AvatarState,
) -> Result<AvatarComposition, AvatarResolveError> {
    let mut warnings = Vec::new();
    let effective_state = preset_state(catalog, state, &mut warnings)?;
    let state = &effective_state;
    if state.gender > 1 {
        return Err(invalid_state("gender"));
    }
    if state.height.is_some_and(|height| height > 14) {
        return Err(invalid_state("height"));
    }
    let initial_morphology = catalog
        .base_models
        .morphologies
        .get(state.morphology)
        .ok_or_else(|| invalid_state("morphology"))?;
    let mut seen_categories = BTreeSet::new();
    for cat in &catalog.categories {
        if !seen_categories.insert(cat.setting_type)
            || cat
                .parts
                .iter()
                .map(|p| &p.id)
                .collect::<BTreeSet<_>>()
                .len()
                != cat.parts.len()
        {
            return Err(AvatarResolveError::InvalidCatalog {
                reason: "Duplicate category or part identifier".to_string(),
            });
        }
    }
    for setting in state.selections.keys() {
        selected(category(catalog, *setting)?, state)?;
    }
    let body_category = category(catalog, 17)?;
    let explicit_body = selected(body_category, state)?;
    let base_morphology = match explicit_body {
        Some(part) => part
            .resource
            .strip_prefix("edit_body_")
            .ok_or_else(|| invalid_state("selections.17"))?,
        None => initial_morphology.as_str(),
    };
    let morphology = match (base_morphology, state.gender) {
        ("male", 1) => "female",
        ("female", 0) => "male",
        (name, _) => name,
    };
    let morphology_index = catalog
        .base_models
        .morphologies
        .iter()
        .position(|name| name == morphology)
        .ok_or_else(|| invalid_state("selections.17"))?;
    if state.gender == 1 && morphology != "female" {
        warn(
            &mut warnings,
            AvatarWarningCode::UnresolvedGenderVariant,
            Some(17),
        );
    }
    let body_name = format!("edit_body_{morphology}");
    let body = body_category
        .parts
        .iter()
        .find(|part| part.resource == body_name)
        .ok_or_else(|| missing("body morphology"))?;
    let skeleton_path = body
        .secondary_models
        .iter()
        .find(|path| path.ends_with(".g4sk"))
        .ok_or_else(|| missing("body skeleton"))?;
    validate_path(skeleton_path)?;
    let skeleton = skeleton_path
        .rsplit('/')
        .next()
        .and_then(|name| name.strip_suffix(".g4sk"))
        .ok_or_else(|| missing("body skeleton"))?;
    if !skeleton_path.contains("/20_EDIT/_bodySK/") {
        return Err(AvatarResolveError::InvalidResource {
            path: skeleton_path.clone(),
        });
    }
    let mut pieces = Vec::new();
    add_piece(&mut pieces, "_bodySK", skeleton)?;

    let nose = selected_or_default(category(catalog, 9)?, state, &mut warnings)?
        .ok_or_else(|| missing("nose selection"))?;
    let nose_hash = HashId::parse_hex(&nose.id).ok_or_else(|| missing("nose identifier"))?;
    let mut face_resource = None;
    for face in catalog
        .base_models
        .faces
        .iter()
        .filter(|face| crc32_str(&face.nose_type) == nose_hash.0)
    {
        let resource = face
            .resources
            .get(morphology_index)
            .filter(|name| !name.is_empty())
            .ok_or_else(|| missing("face morphology"))?;
        if face_resource.is_some_and(|previous| previous != resource) {
            // The export flattened face-type groups. Preserve the former first-group choice,
            // while exposing the missing native face-type mapping instead of inventing one.
            warn(
                &mut warnings,
                AvatarWarningCode::UnresolvedFaceVariant,
                Some(2),
            );
        }
        face_resource.get_or_insert(resource);
    }
    add_piece(
        &mut pieces,
        "_facebase",
        face_resource.ok_or_else(|| missing("face base"))?,
    )?;

    let mut layers = BTreeSet::new();
    for cat in &catalog.categories {
        if matches!(cat.setting_type, 1 | 2 | 16..=21) {
            if selected(cat, state)?.is_some() && !matches!(cat.setting_type, 1 | 17) {
                warn(
                    &mut warnings,
                    AvatarWarningCode::UnsupportedSetting,
                    Some(cat.setting_type),
                );
            }
            continue;
        }
        let Some(part) = selected_or_default(cat, state, &mut warnings)? else {
            continue;
        };
        let before = (pieces.len(), layers.len());
        for path in part.models.iter().chain(&part.secondary_models) {
            validate_path(path)?;
            let Some(relative) = path.split_once("/20_EDIT/").map(|(_, relative)| relative) else {
                continue;
            };
            if let Some(mesh) = relative.strip_suffix(".g4md") {
                let (directory, name) = mesh
                    .split_once('/')
                    .ok_or_else(|| AvatarResolveError::InvalidResource { path: path.clone() })?;
                add_piece(&mut pieces, directory, name)?;
            } else if let Some(layer) = relative
                .strip_prefix("_facetex/")
                .and_then(|p| p.strip_suffix(".g4tx"))
            {
                if layer.len() > 40
                    || layer.split('/').count() != 2
                    || !layer.split('/').all(|segment| token(segment, 40))
                {
                    return Err(AvatarResolveError::InvalidResource { path: path.clone() });
                }
                layers.insert(layer.to_string());
            }
        }
        if before == (pieces.len(), layers.len())
            && cat.setting_type != 9
            && selected(cat, state)?.is_some()
            && part.models.is_empty()
            && part.secondary_models.is_empty()
        {
            warn(
                &mut warnings,
                AvatarWarningCode::UnsupportedSetting,
                Some(cat.setting_type),
            );
        }
    }
    if pieces.len() > 64 || layers.len() > 12 {
        return Err(AvatarResolveError::InvalidCatalog {
            reason: "Avatar resource limit exceeded".to_string(),
        });
    }
    for setting in state
        .palette_selections
        .keys()
        .chain(state.custom_colors.keys())
    {
        category(catalog, *setting)?;
        color(catalog, state, *setting, &mut warnings)?;
        if !matches!(*setting, 3 | 4 | 6) {
            warn(
                &mut warnings,
                AvatarWarningCode::UnsupportedColor,
                Some(*setting),
            );
        }
    }
    Ok(AvatarComposition {
        pieces,
        face_layers: layers.into_iter().collect(),
        morphology: morphology.to_string(),
        morphology_index,
        skeleton: skeleton.to_string(),
        height: state.height,
        skin_color: color(catalog, state, 3, &mut warnings)?,
        iris_color: color(catalog, state, 6, &mut warnings)?,
        hair_color: color(catalog, state, 4, &mut warnings)?,
        warnings,
    })
}
