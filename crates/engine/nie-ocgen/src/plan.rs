//! The assembly plan: what the generated document needs before anything can be rendered.
//!
//! Generation and assembly are separated on purpose. The generation stage runs entirely on the
//! decoded tables in the checkout; the assembly stage needs the editor's `20_EDIT` meshes,
//! skeletons and texture sheets, which live in the game's CPK archives. On a machine without the
//! game — the state this one is in — the honest output is not a broken model, it is a plan that
//! names every missing input by its expected path.
//!
//! A resource is reported `present` only when the file is on disk. `absent` never means "does not
//! exist": it means this checkout cannot see it.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::recipe::Generated;

/// Root of the character editor's assets inside the game data tree.
pub const EDIT_ROOT: &str = "common/chr/_face/20_EDIT";

/// One 3D resource the generated document refers to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Requirement {
    /// Resource name as the document stores it.
    pub resource: String,
    /// Slot the document puts it in.
    pub slot: i64,
    /// What the resource is, as far as its name says: `body`, `face`, `hair`, `costume`, `other`.
    pub role: String,
    /// Directories under `20_EDIT/` that would hold it, in the game's own layout.
    pub expected_dirs: Vec<String>,
    /// Files found for it in this checkout; empty when the checkout cannot see it.
    pub found: Vec<String>,
}

/// The full plan for one generated character.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AssemblyPlan {
    /// Character slug.
    pub slug: String,
    /// Morphology document the character started from.
    pub morphology_stem: String,
    /// Body type that morphology carries.
    pub body_type: String,
    /// One entry per model part.
    pub requirements: Vec<Requirement>,
    /// Requirements with at least one file in this checkout.
    pub present: usize,
    /// Requirements with none.
    pub absent: usize,
    /// What still has to happen before a mesh can be assembled.
    pub gates: Vec<String>,
}

/// Classifies a resource name by what the editor calls that family.
fn role_of(resource: &str) -> &'static str {
    match () {
        () if resource.starts_with("body_type") => "body",
        () if resource.starts_with("face") => "face",
        () if resource.starts_with("nose_type") => "nose",
        () if resource.starts_with("hair_type") => "hair",
        () if resource.starts_with('u') => "costume_upper",
        () if resource.starts_with('s') => "costume_lower",
        () if resource.starts_with("accessory") => "accessory",
        () => "other",
    }
}

/// Directories of `20_EDIT/` a family is stored under.
fn expected_dirs(role: &str) -> Vec<String> {
    let dirs: &[&str] = match role {
        "body" => &["_body", "_bodySK"],
        "face" | "nose" => &["_facebase", "_facetex"],
        "hair" => &["_hair"],
        "costume_upper" | "costume_lower" => &["_cloth"],
        "accessory" => &["_accessory"],
        _ => &[],
    };
    dirs.iter()
        .map(|dir| format!("{EDIT_ROOT}/{dir}"))
        .collect()
}

/// Files in the checkout whose stem is `resource`, under any of `dirs`.
fn find_files(dump_root: &Path, dirs: &[String], resource: &str) -> Vec<String> {
    let mut found = Vec::new();
    for dir in dirs {
        let Ok(entries) = std::fs::read_dir(dump_root.join(dir)) else {
            continue;
        };
        for entry in entries.filter_map(Result::ok) {
            let name = entry.file_name().to_string_lossy().to_string();
            let stem = name.split_once('.').map_or(name.as_str(), |(head, _)| head);
            if stem == resource {
                found.push(format!("{dir}/{name}"));
            }
        }
    }
    found.sort();
    found
}

/// Builds the plan for a generated character against the checkout at `dump_root`.
#[must_use]
pub fn plan(slug: &str, generated: &Generated, dump_root: &Path) -> AssemblyPlan {
    let mut requirements: Vec<Requirement> = generated
        .document
        .mdl_parts
        .iter()
        .filter(|part| !part.resource.is_empty() && !part.resource.starts_with("null("))
        .map(|part| {
            let role = role_of(&part.resource);
            let dirs = expected_dirs(role);
            let found = find_files(dump_root, &dirs, &part.resource);
            Requirement {
                resource: part.resource.clone(),
                slot: part.slot,
                role: role.to_string(),
                expected_dirs: dirs,
                found,
            }
        })
        .collect();
    requirements.sort_by(|left, right| {
        (left.role.as_str(), left.resource.as_str())
            .cmp(&(right.role.as_str(), right.resource.as_str()))
    });

    let present = requirements
        .iter()
        .filter(|req| !req.found.is_empty())
        .count();
    let absent = requirements.len() - present;

    let mut gates = Vec::new();
    if absent > 0 {
        gates.push(format!(
            "{absent} ressources de modèle ne sont pas dans ce checkout : monter le VFS du jeu \
             (NIE_GAME_DIR) ou extraire {EDIT_ROOT} avant tout assemblage"
        ));
    }
    if generated
        .document
        .mdl_parts
        .iter()
        .any(|part| part.resource_hash == 0)
    {
        gates.push(
            "au moins une part porte un hash de nom de ressource à 0 : la fonction de hachage des \
             noms de l'éditeur n'est pas mesurée, la valeur reste à établir avant écriture cfg.bin"
                .to_string(),
        );
    }
    if !generated.warnings.is_empty() {
        gates.push(format!(
            "{} avertissements de génération à lever",
            generated.warnings.len()
        ));
    }
    if !generated.unbound_roles.is_empty() {
        gates.push(format!(
            "{} couleurs mesurées sur les planches n'ont aucune place dans le document ({}) : \
             elles resteront hors du modèle tant qu'une couche de texture dédiée n'existe pas",
            generated.unbound_roles.len(),
            generated.unbound_roles.join(", ")
        ));
    }
    gates.push(
        "le document généré n'a pas été relu par le jeu : rien ici ne prouve qu'il se charge"
            .to_string(),
    );

    AssemblyPlan {
        slug: slug.to_string(),
        morphology_stem: generated.morphology_stem.clone(),
        body_type: generated.body_type.clone(),
        requirements,
        present,
        absent,
        gates,
    }
}
