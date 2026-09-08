//! Transport-neutral policy for public VFS paths and representations.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PathError {
    Empty,
    Invalid,
    NonNormalized,
    Traversal,
}

pub fn normalize_path(raw: &str) -> Result<String, PathError> {
    let raw = raw.trim_start_matches('/');
    if raw.is_empty() {
        return Err(PathError::Empty);
    }
    if raw.contains('\0') || raw.contains('\\') {
        return Err(PathError::Invalid);
    }
    let mut segments = Vec::new();
    for segment in raw.split('/') {
        match segment {
            "" | "." => return Err(PathError::NonNormalized),
            ".." => return Err(PathError::Traversal),
            other => segments.push(other),
        }
    }
    Ok(segments.join("/"))
}

pub fn normalize_prefix(raw: &str) -> Result<String, PathError> {
    let raw = raw.trim_matches('/');
    if raw.is_empty() {
        Ok(String::new())
    } else {
        normalize_path(raw)
    }
}

#[must_use]
pub fn content_type(path: &str) -> &'static str {
    match path
        .rsplit_once('.')
        .map(|(_, ext)| ext.to_ascii_lowercase())
        .unwrap_or_default()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "dds" => "image/vnd-ms.dds",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "json" => "application/json",
        "txt" | "csv" | "log" | "cfg" => "text/plain; charset=utf-8",
        "xml" => "application/xml; charset=utf-8",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_escape_and_ambiguous_segments() {
        assert_eq!(normalize_path("/data/a.g4tx").unwrap(), "data/a.g4tx");
        assert_eq!(normalize_prefix("//").unwrap(), "");
        assert_eq!(normalize_path("data/../a"), Err(PathError::Traversal));
        assert_eq!(normalize_path("data//a"), Err(PathError::NonNormalized));
    }
    #[test]
    fn maps_content_types() {
        assert_eq!(content_type("a.PNG"), "image/png");
        assert_eq!(content_type("build.log"), "text/plain; charset=utf-8");
        assert_eq!(content_type("a.g4tx"), "application/octet-stream");
    }
}
