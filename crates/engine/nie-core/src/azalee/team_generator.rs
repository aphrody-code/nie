//! Roster filtering and seeded field selection for the historical local team generator.
//! Persistence, localized presentation and transport remain host responsibilities.

use std::collections::{HashMap, HashSet};

use crate::crand::CRand;

/// Selection metadata; the host retains complete records and maps returned indices back to them.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Candidate {
    /// Stable identity; repeated rows with this identity cannot be selected twice.
    pub id: String,
    /// Canonical position code supplied by the roster adapter.
    pub position: String,
    /// Exact source element value, without localization or accent folding.
    pub element: String,
    /// Exact optional source gender value.
    pub gender: Option<String>,
    /// Exact source rarity value.
    pub rarity: String,
    /// Exact optional source series value.
    pub series: Option<String>,
}

/// Optional exact-match criteria in the legacy element/gender/rarity/series order.
#[derive(Debug, Clone, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Filters {
    /// Requested source element; empty means disabled.
    pub element: Option<String>,
    /// Requested source gender; empty means disabled.
    pub gender: Option<String>,
    /// Requested source rarity; empty means disabled.
    pub rarity: Option<String>,
    /// Requested source series; empty means disabled.
    pub series: Option<String>,
}

/// Stable machine key for a filter rejected by the minimum-size guard.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "snake_case"))]
pub enum FilterKey {
    /// Element constraint.
    Element,
    /// Gender constraint.
    Gender,
    /// Rarity constraint.
    Rarity,
    /// Series constraint.
    Series,
}

/// Ordered selection and rejected criteria, without duplicating roster records.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct FilteredPool {
    /// Indices into the exact input roster, in original order.
    pub indices: Vec<usize>,
    /// Rejected criteria in evaluation order.
    pub ignored: Vec<FilterKey>,
}

/// Filters run in historical order; a step below the minimum leaves its input intact.
#[must_use]
pub fn filter_candidates(roster: &[Candidate], filters: &Filters, minimum: usize) -> FilteredPool {
    filter_indices(roster, (0..roster.len()).collect(), filters, minimum)
}

fn filter_indices(
    roster: &[Candidate],
    mut indices: Vec<usize>,
    filters: &Filters,
    minimum: usize,
) -> FilteredPool {
    let mut ignored = Vec::new();
    for (key, value) in [
        (FilterKey::Element, &filters.element),
        (FilterKey::Gender, &filters.gender),
        (FilterKey::Rarity, &filters.rarity),
        (FilterKey::Series, &filters.series),
    ] {
        let Some(value) = value.as_deref().filter(|value| !value.is_empty()) else {
            continue;
        };
        let next = indices
            .iter()
            .copied()
            .filter(|&index| {
                let candidate = &roster[index];
                let actual = match key {
                    FilterKey::Element => Some(candidate.element.as_str()),
                    FilterKey::Gender => candidate.gender.as_deref(),
                    FilterKey::Rarity => Some(candidate.rarity.as_str()),
                    FilterKey::Series => candidate.series.as_deref(),
                };
                actual == Some(value)
            })
            .collect::<Vec<_>>();
        if next.len() >= minimum {
            indices = next;
        } else {
            ignored.push(key);
        }
    }
    FilteredPool { indices, ignored }
}

/// Selection-relevant projection of one formation position.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct FieldSlot {
    /// Native formation slot index.
    pub index: u8,
    /// Canonical required position code.
    pub role: String,
}

/// One field assignment, either retained from locks or selected from the roster.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct Assignment {
    /// Historical field slot key.
    pub slot: String,
    /// Selected input row, absent for locked slots whose full record stays in the host.
    pub roster_index: Option<usize>,
    /// Whether the exact existing locked record must be retained.
    pub locked: bool,
}

/// Deterministic for a fixed roster order, positions, filters, locks and seed.
///
/// CRand defines a new reproducible draw contract; historical Math.random had no seed contract.
/// Locks retain their exact records, reserve identities stay excluded, and unavailable roles stay empty.
pub fn generate(
    roster: &[Candidate],
    positions: &[FieldSlot],
    filters: &Filters,
    locks: &[(String, String)],
    seed: u32,
) -> Result<Vec<Assignment>, &'static str> {
    if roster.len() > u32::MAX as usize {
        return Err("Roster exceeds the engine random bound");
    }
    let mut pools = HashMap::new();
    for position in positions {
        pools.entry(position.role.as_str()).or_insert_with(|| {
            let required = positions
                .iter()
                .filter(|other| other.role == position.role)
                .count();
            let indices = roster
                .iter()
                .enumerate()
                .filter_map(|(index, candidate)| {
                    (candidate.position == position.role).then_some(index)
                })
                .collect();
            filter_indices(roster, indices, filters, required).indices
        });
    }
    let mut used = locks
        .iter()
        .map(|(_, id)| id.as_str())
        .collect::<HashSet<_>>();
    let mut random = CRand::new(seed);
    let mut assignments = Vec::new();
    for position in positions {
        let slot = format!("field-{}", position.index);
        if locks.iter().any(|(locked_slot, _)| *locked_slot == slot) {
            assignments.push(Assignment {
                slot,
                roster_index: None,
                locked: true,
            });
            continue;
        }
        let available = pools[position.role.as_str()]
            .iter()
            .copied()
            .filter(|&index| !used.contains(roster[index].id.as_str()))
            .collect::<Vec<_>>();
        if available.is_empty() {
            continue;
        }
        let bound =
            u32::try_from(available.len()).map_err(|_| "Pool exceeds the engine random bound")?;
        let index = available[random.bounded(bound) as usize];
        used.insert(roster[index].id.as_str());
        assignments.push(Assignment {
            slot,
            roster_index: Some(index),
            locked: false,
        });
    }
    Ok(assignments)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn candidate(id: &str, position: &str) -> Candidate {
        Candidate {
            id: id.into(),
            position: position.into(),
            element: "Forêt".into(),
            gender: Some("F".into()),
            rarity: "Normal".into(),
            series: None,
        }
    }

    #[test]
    fn deterministic_draws_preserve_locks_roles_and_duplicate_identity_exclusion() {
        let roster = vec![
            candidate("a", "FW"),
            candidate("b", "FW"),
            candidate("b", "FW"),
            candidate("c", "GK"),
        ];
        let positions = vec![
            FieldSlot {
                index: 0,
                role: "FW".into(),
            },
            FieldSlot {
                index: 1,
                role: "FW".into(),
            },
            FieldSlot {
                index: 10,
                role: "GK".into(),
            },
        ];
        let locks = vec![("field-0".into(), "a".into())];
        let expected = vec![
            Assignment {
                slot: "field-0".into(),
                roster_index: None,
                locked: true,
            },
            Assignment {
                slot: "field-1".into(),
                roster_index: Some(2),
                locked: false,
            },
            Assignment {
                slot: "field-10".into(),
                roster_index: Some(3),
                locked: false,
            },
        ];
        assert_eq!(
            generate(&roster, &positions, &Filters::default(), &locks, 5489).unwrap(),
            expected
        );
        assert_eq!(
            generate(&roster, &positions, &Filters::default(), &locks, 5489).unwrap(),
            expected
        );
        let empty = generate(&[], &positions, &Filters::default(), &locks, 0).unwrap();
        assert_eq!(empty.len(), 1);
        assert!(empty[0].locked);
    }

    #[test]
    fn restrictive_filters_are_reported_in_order_without_losing_the_pool() {
        let roster = vec![candidate("a", "FW"), candidate("b", "MF")];
        let filters = Filters {
            element: Some("missing".into()),
            gender: Some("M".into()),
            rarity: Some("Héros".into()),
            series: Some("missing".into()),
        };
        assert_eq!(
            filter_candidates(&roster, &filters, 2),
            FilteredPool {
                indices: vec![0, 1],
                ignored: vec![
                    FilterKey::Element,
                    FilterKey::Gender,
                    FilterKey::Rarity,
                    FilterKey::Series
                ]
            }
        );
        assert_eq!(
            filter_candidates(&roster, &filters, 0),
            FilteredPool {
                indices: vec![],
                ignored: vec![]
            }
        );
    }
}
