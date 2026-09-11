//! **`nie-ocgen`** — the 3D generation pipeline for an original character.
//!
//! An OC exists as drawings and lore, and the game only knows `cfg.bin` documents and `20_EDIT`
//! meshes. This crate is the chain between the two, and it is deliberately made of stages that
//! each produce a file a human can read and check:
//!
//! | Stage | Input | Output |
//! |---|---|---|
//! | [`sources`] | `data/common/` dumps, `data/oc/<slug>/source/` | editor tables, decoded sheets |
//! | [`palette`] | sheets + declared regions | measured swatches, with provenance |
//! | [`morphology`] | the 16 `mdl_editpreview_avatar_*` documents | a starting model |
//! | [`recipe`] | starting model + swatches + bindings | a `CHARA_EDIT_PARAM` document |
//! | [`plan`] | the document + the checkout | what is still missing to assemble a mesh |
//!
//! ## What this crate claims, and what it does not
//!
//! It claims that the emitted document is in the game's own format: [`param`] parses the shipped
//! `edit_parameter.cfg.bin.json` and the sixteen morphology documents and re-emits each of them
//! **identically**, which is what the round-trip test checks. Everything the generator changes is
//! listed with the measurement that justified it.
//!
//! It does not claim the character renders, resembles its sheets, or loads in the game. No mesh is
//! assembled here: assembly needs the `20_EDIT` archives, and [`plan`] reports their absence
//! instead of substituting anything for them.

#![forbid(unsafe_code)]

#[cfg(feature = "cli")]
pub mod cli;
pub mod icon;
pub mod morphology;
pub mod palette;
pub mod param;
pub mod plan;
pub mod recipe;
pub mod sources;

use std::path::Path;

use serde::{Deserialize, Serialize};

/// Everything that can go wrong in the pipeline, kept separate so a report can say which stage.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// A file could not be read or a directory walked.
    #[error("entrée/sortie : {0}")]
    Io(String),
    /// A document did not decode, or a node carried the wrong variables.
    #[error("format : {0}")]
    Format(String),
    /// An image did not decode.
    #[error("image : {0}")]
    Image(String),
    /// A probe measured nothing usable.
    #[error("palette : {0}")]
    Palette(String),
    /// A morphology was asked for and the catalogue does not hold it.
    #[error("morphologie : {0}")]
    Morphology(String),
}

/// Everything one pipeline run produced, ready to be serialised as the run report.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunReport {
    /// Report schema, versioned like the other machine-readable artefacts of the repository.
    pub schema: String,
    /// Character slug.
    pub slug: String,
    /// Version string of the editor catalogue the run read.
    pub catalog_version: String,
    /// Reference images decoded, `relative path -> width x height`.
    pub references: Vec<String>,
    /// Colours measured on those references.
    pub swatches: Vec<palette::Swatch>,
    /// Morphology the generation started from.
    pub morphology_stem: String,
    /// Body type that morphology carries.
    pub body_type: String,
    /// Changes made, with their evidence.
    pub applied: Vec<recipe::Applied>,
    /// Changes asked for and not made.
    pub warnings: Vec<recipe::Warning>,
    /// What still stands between this document and an assembled mesh.
    pub plan: plan::AssemblyPlan,
}

/// Runs the whole chain: load, measure, generate, plan.
///
/// `dump_root` is the decoded game-data root (the repository's `data/`), `oc_root` the character's
/// directory under `data/oc/`.
///
/// # Errors
///
/// Propagates the first stage that fails. A probe that measures nothing is an error, not a
/// warning: a swatch silently defaulting to white would travel all the way into the document.
pub fn run(
    dump_root: &Path,
    oc_root: &Path,
    recipe: &recipe::Recipe,
) -> Result<(RunReport, recipe::Generated), Error> {
    let sources = sources::EditorSources::load(dump_root)?;
    let references = sources::ReferenceSet::load(&oc_root.join("source"))?;
    let sheets = references.sheets();
    let rejection = palette::Rejection::default();
    let mut swatches = Vec::new();
    for probe in &recipe.probes {
        swatches.push(measure_against(probe, &sheets, rejection)?);
    }

    let generated = recipe::generate(&sources, recipe, &swatches)?;
    let plan = plan::plan(&recipe.slug, &generated, dump_root);

    let report = RunReport {
        schema: "niers.ocgen.run/v1".to_string(),
        slug: recipe.slug.clone(),
        catalog_version: sources.catalog_version.clone(),
        references: references
            .images
            .iter()
            .map(|image| {
                format!(
                    "{} {}x{} ({} o)",
                    image.relative, image.sheet.width, image.sheet.height, image.bytes
                )
            })
            .collect(),
        swatches,
        morphology_stem: generated.morphology_stem.clone(),
        body_type: generated.body_type.clone(),
        applied: generated.applied.clone(),
        warnings: generated.warnings.clone(),
        plan,
    };
    Ok((report, generated))
}

/// Measures one probe against borrowed sheets.
fn measure_against(
    probe: &palette::Probe,
    sheets: &[&palette::Sheet],
    rejection: palette::Rejection,
) -> Result<palette::Swatch, Error> {
    let sheet = sheets
        .iter()
        .copied()
        .find(|sheet| sheet.name == probe.sheet)
        .ok_or_else(|| Error::Palette(format!("planche \u{ab} {} \u{bb} absente", probe.sheet)))?;
    palette::measure_one(probe, sheet, rejection)
}
