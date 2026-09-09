//! Rust-side contracts for resolving IEVR save roster identifiers.
//!
//! Save bytes stay in the save adapter. This module owns the normalized DTOs
//! and the deterministic reconstruction of unknown entries; an HTTP/SQLite
//! host can fill the optional character fields without reimplementing rules.

use std::string::String;
use std::vec::Vec;

use super::roster_identifiers::{RosterIdentifierInput, normalize_roster_identifiers};

/// One roster character after mirror resolution.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct ResolvedChara {
    /// Canonical `0xXXXXXXXX` identifier.
    pub id: String,
    /// French name, or `None` when the mirror has no row/name.
    pub name: Option<String>,
    /// Base slug for `/chara/<baseSlug>`.
    pub base_slug: Option<String>,
    /// Element label.
    pub element: Option<String>,
    /// Position label.
    pub position: Option<String>,
    /// Rarity label.
    pub rarity: Option<String>,
}

/// Aggregate returned by roster resolution.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct RosterResolution {
    /// Entries reconstructed in normalized input order.
    pub resolved: Vec<ResolvedChara>,
    /// Number of entries with a non-empty mirror name.
    pub matched: usize,
    /// Number of unique normalized submitted identifiers.
    pub total: usize,
}

/// Builds the same result shape as the Azalee route after its database lookup.
///
/// `resolved_rows` may be in arbitrary database order and may omit unknown IDs.
/// Unknown IDs are retained with null fields, and output order follows the first
/// normalized input occurrence.
pub fn assemble_roster_resolution<'a, I>(
    ids: I,
    max: usize,
    resolved_rows: &[ResolvedChara],
) -> RosterResolution
where
    I: IntoIterator<Item = RosterIdentifierInput<'a>>,
{
    let identifiers = normalize_roster_identifiers(ids, max);
    let resolved = identifiers
        .iter()
        .map(|id| {
            resolved_rows
                .iter()
                .find(|row| row.id == *id)
                .cloned()
                .unwrap_or_else(|| ResolvedChara {
                    id: id.clone(),
                    ..ResolvedChara::default()
                })
        })
        .collect::<Vec<_>>();
    let matched = resolved.iter().filter(|row| row.name.is_some()).count();
    RosterResolution {
        total: resolved.len(),
        matched,
        resolved,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reconstructs_order_and_keeps_unknown_ids_visible() {
        let rows = [ResolvedChara {
            id: "0x00000002".into(),
            name: Some("Endou".into()),
            base_slug: Some("endou".into()),
            element: Some("Fire".into()),
            position: Some("GK".into()),
            rarity: Some("S".into()),
        }];
        let resolution = assemble_roster_resolution(
            [
                RosterIdentifierInput::Text("2"),
                RosterIdentifierInput::Text("0x3"),
                RosterIdentifierInput::Text("2"),
            ],
            8_000,
            &rows,
        );
        assert_eq!(resolution.total, 2);
        assert_eq!(resolution.matched, 1);
        assert_eq!(resolution.resolved[0].name.as_deref(), Some("Endou"));
        assert_eq!(resolution.resolved[1].name, None);
    }

    #[test]
    fn empty_input_is_a_zero_result_without_transport() {
        let resolution = assemble_roster_resolution([], 8_000, &[]);
        assert_eq!(resolution, RosterResolution::default());
    }
}
