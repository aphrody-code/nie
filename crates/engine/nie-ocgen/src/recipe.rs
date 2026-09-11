//! The generation step: a shipped morphology document plus measured colours becomes a character.
//!
//! ## What is derived and what is declared
//!
//! Colour slots are hashes whose preimages the repository has not recovered, so the pipeline can
//! neither name them nor guess which one is the skin. Two things follow.
//!
//! *Declared*: a recipe binds a measured role (`hair`) to a slot hash. A human made that call
//! once, and [`SlotSurvey`] is the evidence they made it on — every colour slot, how many shipped
//! documents carry it, and the colours those documents put in it.
//!
//! *Derived*: everything else. The starting document, its part set, its bone edits and every slot
//! the recipe does not bind are taken from the shipped morphology unchanged. A generated document
//! therefore differs from a real one only where a measurement justified the difference, and
//! [`Generated::applied`] lists exactly those places.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::{
    Error,
    morphology::{Morphology, MorphologyQuery},
    palette::{Probe, Swatch},
    param::CharaEditParam,
    sources::EditorSources,
};

/// What a recipe binds a measured role to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ColorTarget {
    /// Every `TEX_PARTS_COLOR` row carrying this slot hash, in every texture part.
    TexSlot {
        /// Colour slot hash, as stored in the document.
        slot: i64,
    },
    /// The rows carrying `slot` inside one texture part only, mirror included.
    ///
    /// The three colour slots repeat on every texture part, so a bare [`ColorTarget::TexSlot`] on
    /// the middle slot repaints the eyebrows and the iris at once. Naming the part is what keeps a
    /// measured eye colour on the eyes.
    TexPartSlot {
        /// `TEX_PARTS` slot hash identifying the layer.
        part: i64,
        /// Colour slot hash inside that layer.
        slot: i64,
    },
    /// The `MDL_COLOR` of the model part at this slot.
    ///
    /// Matching on the resource name would not do: the two hair parts of a shipped document both
    /// carry `hair_type_01`, and only their slots tell them apart.
    MdlSlot {
        /// `MDL_PART` slot hash.
        slot: i64,
    },
}

/// One measured role written into one document target.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ColorBinding {
    /// Palette role, matching a [`Probe::role`].
    pub role: String,
    /// Where the colour goes.
    pub target: ColorTarget,
}

/// Replaces the resource of the model part sitting at one slot.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PartOverride {
    /// `MDL_PART` slot hash of the part to replace.
    pub slot: i64,
    /// New resource name; must exist in the editor catalogue or the run reports it.
    pub resource: String,
}

/// One bone edit written over the morphology's own.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct BoneOverride {
    /// Bone hash, as carried by the starting document.
    pub bone: i64,
    /// Replacement scale.
    pub scale: [f64; 3],
}

/// How the morphology is chosen.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum MorphologyChoice {
    /// Pick the shipped document by file stem — exact, no scoring.
    Stem {
        /// `mdl_editpreview_avatar_tallmuscle01`, for instance.
        stem: String,
    },
    /// Score the catalogue against the traits read from the character's sheets and lore.
    Traits(MorphologyQuery),
}

/// A complete generation recipe.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Recipe {
    /// Character slug the recipe belongs to.
    pub slug: String,
    /// Internal code this recipe produces a document for, e.g. `c99019010`.
    ///
    /// A character can hold several: Astro Lor exists as `c99019010` (Inazuma Eleven) and
    /// `c99019020` (Victory Road), drawn a decade apart with different kits and a different
    /// build. One recipe per code, one document per code.
    pub internal_code: String,
    /// Name written into the generated document.
    pub name: String,
    /// Starting morphology.
    pub morphology: MorphologyChoice,
    /// Regions to measure on the reference sheets.
    pub probes: Vec<Probe>,
    /// Measured roles routed into document slots.
    pub colors: Vec<ColorBinding>,
    /// Model parts replaced on the starting document.
    #[serde(default)]
    pub parts: Vec<PartOverride>,
    /// Bone edits written over the morphology's own.
    #[serde(default)]
    pub bones: Vec<BoneOverride>,
    /// Portrait icon containers to produce, one per character variant.
    #[serde(default)]
    pub icons: Vec<crate::icon::IconSpec>,
}

/// One change the generator actually made.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Applied {
    /// Which stage made it: `color`, `part` or `bone`.
    pub stage: String,
    /// Human-readable target.
    pub target: String,
    /// Value before.
    pub before: String,
    /// Value after.
    pub after: String,
    /// Where the new value comes from — a sheet and region, or the recipe itself.
    pub evidence: String,
}

/// Something the generator could not do, reported rather than silently skipped.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Warning {
    /// Stage that raised it.
    pub stage: String,
    /// What was asked for.
    pub subject: String,
    /// Why it did not happen.
    pub reason: String,
}

/// The generated character.
#[derive(Debug, Clone)]
pub struct Generated {
    /// The document, ready to be written back as a `cfg.bin` JSON.
    pub document: CharaEditParam,
    /// The morphology it started from.
    pub morphology_stem: String,
    /// Body type read from that morphology.
    pub body_type: String,
    /// Every change made, with its evidence.
    pub applied: Vec<Applied>,
    /// Every change asked for and not made.
    pub warnings: Vec<Warning>,
    /// Roles that were measured on the sheets and that no binding routes anywhere.
    ///
    /// These are not failures: the editor document has three colour slots per texture layer and a
    /// single colour per model part, so a design with a jersey trim, an under-sleeve and a sock
    /// band has more measured colours than the format has places to put them. Reporting them keeps
    /// the difference between the drawing and the model visible instead of quietly dropping it.
    pub unbound_roles: Vec<String>,
}

/// Where a colour slot was seen and what colour was in it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SlotObservation {
    /// Slot hash.
    pub slot: i64,
    /// Number of shipped documents carrying this slot.
    pub documents: usize,
    /// Number of colour rows carrying it, across those documents.
    pub rows: usize,
    /// Distinct `#rrggbb` values seen, sorted, capped at eight for readability.
    pub colors: Vec<String>,
}

/// Every colour slot observed across the shipped documents.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SlotSurvey {
    /// Documents inspected.
    pub documents: usize,
    /// One row per slot, sorted by descending row count then by slot.
    pub slots: Vec<SlotObservation>,
}

/// Surveys the colour slots of every shipped morphology document plus the saved-avatar template.
///
/// This is the evidence a human binds roles on: a slot that always holds a skin tone across the
/// sixteen morphologies is a skin slot, and the survey shows that without naming the hash.
#[must_use]
pub fn survey_slots(sources: &EditorSources) -> SlotSurvey {
    let mut rows: BTreeMap<i64, (usize, Vec<String>, Vec<usize>)> = BTreeMap::new();
    let documents: Vec<&CharaEditParam> = sources
        .morphologies
        .entries
        .iter()
        .map(|entry| &entry.document)
        .chain(std::iter::once(&sources.template))
        .collect();
    for (index, document) in documents.iter().enumerate() {
        for part in &document.tex_parts {
            let colors = part
                .colors
                .iter()
                .chain(part.mirror.iter().flat_map(|mirror| mirror.colors.iter()));
            for color in colors {
                let entry = rows
                    .entry(color.slot)
                    .or_insert_with(|| (0, Vec::new(), Vec::new()));
                entry.0 += 1;
                entry.1.push(format!(
                    "#{:02x}{:02x}{:02x}",
                    color.rgba[0].clamp(0, 255),
                    color.rgba[1].clamp(0, 255),
                    color.rgba[2].clamp(0, 255)
                ));
                if !entry.2.contains(&index) {
                    entry.2.push(index);
                }
            }
        }
    }
    let mut slots: Vec<SlotObservation> = rows
        .into_iter()
        .map(|(slot, (count, mut colors, docs))| {
            colors.sort();
            colors.dedup();
            colors.truncate(8);
            SlotObservation {
                slot,
                documents: docs.len(),
                rows: count,
                colors,
            }
        })
        .collect();
    slots.sort_by_key(|row| (std::cmp::Reverse(row.rows), row.slot));
    SlotSurvey {
        documents: documents.len(),
        slots,
    }
}

/// Formats a swatch RGB as `#rrggbb`.
fn hex(rgb: [u8; 3]) -> String {
    format!("#{:02x}{:02x}{:02x}", rgb[0], rgb[1], rgb[2])
}

/// Formats a document colour row as `#rrggbb`.
fn hex_row(rgba: [i64; 4]) -> String {
    format!(
        "#{:02x}{:02x}{:02x}",
        rgba[0].clamp(0, 255),
        rgba[1].clamp(0, 255),
        rgba[2].clamp(0, 255)
    )
}

/// Applies `recipe` and `swatches` to the morphology the recipe selects.
///
/// The alpha channel of every rewritten colour is preserved: it carries the editor's own
/// enable/disable convention (a part disabled by `A = 0` must stay disabled), and overwriting it
/// with an opaque value turns hidden geometry back on.
///
/// # Errors
///
/// Returns [`Error::Morphology`] when the recipe names a morphology the catalogue does not hold.
pub fn generate(
    sources: &EditorSources,
    recipe: &Recipe,
    swatches: &[Swatch],
) -> Result<Generated, Error> {
    let morphology: &Morphology = match &recipe.morphology {
        MorphologyChoice::Stem { stem } => sources.morphologies.by_stem(stem).ok_or_else(|| {
            Error::Morphology(format!("morphologie « {stem} » absente du catalogue"))
        })?,
        MorphologyChoice::Traits(query) => sources.morphologies.select(query)?,
    };

    let mut document = morphology.document.clone();
    document.name.clone_from(&recipe.name);
    let mut applied = Vec::new();
    let mut warnings = Vec::new();

    let known_resources: std::collections::BTreeSet<&str> = sources
        .catalog
        .parts
        .iter()
        .flat_map(|part| {
            [
                part.resource_name_str1.as_str(),
                part.resource_name_str2.as_str(),
            ]
        })
        .filter(|name| !name.is_empty())
        .collect();

    for over in &recipe.parts {
        let mut hit = false;
        for part in &mut document.mdl_parts {
            if part.slot != over.slot {
                continue;
            }
            hit = true;
            let before = part.resource.clone();
            // The resource-name hash is a hash of the old name; the pipeline does not know the
            // function, so it is zeroed and the plan stage reports it as a value to measure
            // rather than a value to trust.
            part.resource.clone_from(&over.resource);
            part.resource_hash = 0;
            applied.push(Applied {
                stage: "part".to_string(),
                target: format!("MDL_PART slot {}", part.slot),
                before,
                after: over.resource.clone(),
                evidence: "recette".to_string(),
            });
        }
        if !hit {
            warnings.push(Warning {
                stage: "part".to_string(),
                subject: over.slot.to_string(),
                reason: "aucune part du document de départ n'occupe ce slot".to_string(),
            });
        }
        if !known_resources.contains(over.resource.as_str()) {
            warnings.push(Warning {
                stage: "part".to_string(),
                subject: over.resource.clone(),
                reason: "ressource absente du catalogue chara_edit : le jeu ne la connaît pas"
                    .to_string(),
            });
        }
    }

    for binding in &recipe.colors {
        let Some(swatch) = swatches.iter().find(|swatch| swatch.role == binding.role) else {
            warnings.push(Warning {
                stage: "color".to_string(),
                subject: binding.role.clone(),
                reason: "aucune mesure ne porte ce rôle".to_string(),
            });
            continue;
        };
        let evidence = format!(
            "{} rect({:.3},{:.3},{:.3},{:.3}) {:.0} % de {} pixels retenus",
            swatch.sheet,
            swatch.rect.x,
            swatch.rect.y,
            swatch.rect.w,
            swatch.rect.h,
            swatch.share * 100.0,
            swatch.kept
        );
        let channels = [
            i64::from(swatch.rgb[0]),
            i64::from(swatch.rgb[1]),
            i64::from(swatch.rgb[2]),
        ];
        let mut hit = 0_usize;
        match &binding.target {
            ColorTarget::TexSlot { slot } => {
                for part in &mut document.tex_parts {
                    let rows = part
                        .colors
                        .iter_mut()
                        .chain(part.mirror.iter_mut().flat_map(|m| m.colors.iter_mut()));
                    for row in rows {
                        if row.slot != *slot {
                            continue;
                        }
                        let before = hex_row(row.rgba);
                        row.rgba[0] = channels[0];
                        row.rgba[1] = channels[1];
                        row.rgba[2] = channels[2];
                        hit += 1;
                        applied.push(Applied {
                            stage: "color".to_string(),
                            target: format!("TEX_PARTS_COLOR slot {slot}"),
                            before,
                            after: hex(swatch.rgb),
                            evidence: evidence.clone(),
                        });
                    }
                }
            }
            ColorTarget::TexPartSlot {
                part: part_slot,
                slot,
            } => {
                for part in &mut document.tex_parts {
                    if part.slot != *part_slot {
                        continue;
                    }
                    let rows = part
                        .colors
                        .iter_mut()
                        .chain(part.mirror.iter_mut().flat_map(|m| m.colors.iter_mut()));
                    for row in rows {
                        if row.slot != *slot {
                            continue;
                        }
                        let before = hex_row(row.rgba);
                        row.rgba[0] = channels[0];
                        row.rgba[1] = channels[1];
                        row.rgba[2] = channels[2];
                        hit += 1;
                        applied.push(Applied {
                            stage: "color".to_string(),
                            target: format!("TEX_PARTS {part_slot} / COLOR {slot}"),
                            before,
                            after: hex(swatch.rgb),
                            evidence: evidence.clone(),
                        });
                    }
                }
            }
            ColorTarget::MdlSlot { slot } => {
                for part in &mut document.mdl_parts {
                    if part.slot != *slot {
                        continue;
                    }
                    let before = hex_row(part.rgba);
                    part.rgba[0] = channels[0];
                    part.rgba[1] = channels[1];
                    part.rgba[2] = channels[2];
                    hit += 1;
                    applied.push(Applied {
                        stage: "color".to_string(),
                        target: format!("MDL_COLOR {}", part.resource),
                        before,
                        after: hex(swatch.rgb),
                        evidence: evidence.clone(),
                    });
                }
            }
        }
        if hit == 0 {
            warnings.push(Warning {
                stage: "color".to_string(),
                subject: binding.role.clone(),
                reason: "la cible n'existe pas dans le document de départ".to_string(),
            });
        }
    }

    for over in &recipe.bones {
        match document
            .bones
            .iter_mut()
            .find(|bone| bone.bone == over.bone)
        {
            Some(bone) => {
                let before = format!("{:?}", bone.scale);
                bone.scale = over.scale;
                applied.push(Applied {
                    stage: "bone".to_string(),
                    target: format!("MDL_BONE {}", over.bone),
                    before,
                    after: format!("{:?}", over.scale),
                    evidence: "recette".to_string(),
                });
            }
            None => warnings.push(Warning {
                stage: "bone".to_string(),
                subject: over.bone.to_string(),
                reason: "os absent du document de départ".to_string(),
            }),
        }
    }

    let bound: std::collections::BTreeSet<&str> = recipe
        .colors
        .iter()
        .map(|binding| binding.role.as_str())
        .collect();
    let mut unbound_roles: Vec<String> = swatches
        .iter()
        .map(|swatch| swatch.role.clone())
        .filter(|role| !bound.contains(role.as_str()))
        .collect();
    unbound_roles.sort();
    unbound_roles.dedup();

    Ok(Generated {
        document,
        morphology_stem: morphology.stem.clone(),
        body_type: morphology.body_type.clone(),
        applied,
        warnings,
        unbound_roles,
    })
}
