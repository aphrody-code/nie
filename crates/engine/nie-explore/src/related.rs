//! Exact VFS relationships and the preserved desktop substring-search compatibility policy.
#[cfg(not(target_arch = "wasm32"))]
use nie_formats::vfs::Vfs;
use serde::Serialize;

/// Preserve the existing desktop search policy, including case sensitivity and lexical order.
#[must_use]
#[cfg(not(target_arch = "wasm32"))]
pub fn legacy_search(vfs: &Vfs, needle: &str, limit: usize) -> Vec<(String, u32, String)> {
    let mut entries: Vec<_> = vfs
        .iter()
        .filter(|(path, _)| path.contains(needle))
        .map(|(path, entry)| (path.to_owned(), entry.file_size, entry.cpk_filename.clone()))
        .collect();
    entries.sort_by(|a, b| a.0.cmp(&b.0));
    entries.truncate(limit.max(1));
    entries
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reference {
    pub role: &'static str,
    pub logical_path: String,
    pub resolved_path: Option<String>,
    pub source_bytes: Option<u32>,
    pub readable: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Relationships {
    pub path: String,
    pub declared: Vec<Reference>,
    pub naming_candidates: Vec<Reference>,
    pub unresolved: Vec<&'static str>,
}

#[cfg(not(target_arch = "wasm32"))]
fn declared_reference(vfs: &Vfs, role: &'static str, logical: String, locale: &str) -> Reference {
    let normalized = logical
        .trim_start_matches('#')
        .trim_start_matches('/')
        .replace("<LG>", locale);
    let candidate = if normalized.starts_with("data/") {
        normalized
    } else {
        format!("data/{normalized}")
    };
    let entry = vfs.find(&candidate);
    Reference {
        role,
        logical_path: logical,
        source_bytes: entry.map(|entry| entry.file_size),
        readable: entry.is_some() && vfs.is_readable(&candidate),
        resolved_path: entry.map(|_| candidate),
    }
}

/// Inspect actual OBJBIN declarations. Model peers retain the desktop's same-stem policy,
/// clearly separated from declared dependencies and never silently chosen by basename.
#[cfg(not(target_arch = "wasm32"))]
pub fn inspect(vfs: &Vfs, path: &str, locale: &str) -> Result<Relationships, String> {
    let entry = vfs.find(path).ok_or("VFS resource not found")?;
    let mut result = Relationships {
        path: path.to_owned(),
        declared: vec![],
        naming_candidates: vec![],
        unresolved: vec![],
    };
    if path.ends_with(".objbin") {
        if entry.file_size > 1024 * 1024 {
            return Err("Object declaration exceeds its size budget".into());
        }
        let bytes = vfs.read(path).map_err(|error| error.to_string())?;
        if bytes.len() > 1024 * 1024 {
            return Err("Object declaration exceeds its size budget".into());
        }
        let object = nie_formats::objbin::parse(&bytes).map_err(|error| error.to_string())?;
        for (role, logical) in [
            ("animationPackage", object.g4pkm_path),
            ("texture", object.g4tx_path),
            ("skeleton", object.skeleton_path),
            ("animation", object.anime_path),
        ] {
            if let Some(logical) = logical {
                result
                    .declared
                    .push(declared_reference(vfs, role, logical, locale));
            }
        }
        result.unresolved.push("Only direct declarations and explicit locale substitution are resolved; missing paths do not fall back to an unrelated basename.");
    } else if path.ends_with(".g4md") || path.ends_with(".g4mg") {
        let stem = path.rsplit_once('.').map_or(path, |(stem, _)| stem);
        // Existing assemble_glb_for_preview sibling policy. Presence proves index membership,
        // not material assignment or an animation/skeleton binding.
        for (role, extension) in [("model", "g4md"), ("mesh", "g4mg"), ("texture", "g4tx")] {
            let candidate = format!("{stem}.{extension}");
            if candidate != path && vfs.find(&candidate).is_some() {
                result
                    .naming_candidates
                    .push(declared_reference(vfs, role, candidate, locale));
            }
        }
        let texture = format!("{stem}.g4tx").replace("/common/", "/dx11/");
        if vfs.find(&texture).is_some()
            && !result
                .naming_candidates
                .iter()
                .any(|candidate| candidate.logical_path == texture)
        {
            result
                .naming_candidates
                .push(declared_reference(vfs, "texture", texture, locale));
        }
        result.unresolved.push("Same-stem candidates are the desktop preview policy; decoded material and motion dependency bindings are not established.");
    } else {
        result.unresolved.push("No decoded dependency declaration adapter is registered for this resource, including font atlas and motion target pairing.");
    }
    Ok(result)
}
