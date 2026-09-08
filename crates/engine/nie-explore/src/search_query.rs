//! Transport-neutral normalization for VFS search requests.

/// Facet dimensions supported by the VFS index.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FacetField {
    Extension,
    Cpk,
}

impl FacetField {
    pub const NAMES: [&'static str; 2] = ["ext", "cpk"];

    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Self::Extension => "ext",
            Self::Cpk => "cpk",
        }
    }
}

/// Parse, validate, and deduplicate a comma-separated facet request.
pub fn parse_facet_fields(raw: Option<&str>) -> Result<Vec<FacetField>, String> {
    let mut fields = Vec::new();
    for name in raw
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|name| !name.is_empty())
    {
        let field = match name {
            "ext" => FacetField::Extension,
            "cpk" => FacetField::Cpk,
            _ => {
                return Err(format!(
                    "`facets={name}` : seuls {} se comptent sur le VFS",
                    FacetField::NAMES.join(" et ")
                ));
            }
        };
        if !fields.contains(&field) {
            fields.push(field);
        }
    }
    Ok(fields)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn facets_are_validated_ordered_and_deduplicated() {
        assert_eq!(
            parse_facet_fields(Some("cpk, ext,cpk")).unwrap(),
            [FacetField::Cpk, FacetField::Extension]
        );
        assert!(parse_facet_fields(Some("size")).is_err());
        assert!(parse_facet_fields(None).unwrap().is_empty());
    }
}
