//! Pure IEVR team-position, stat, and elemental-synergy rules.

use std::string::String;
use std::vec::Vec;

use super::formations::{Formation, PositionRole};
use super::team_types::{TeamMember, TeamMemberStats};

/// Result status for a player/formation-slot comparison.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PositionMatchStatus {
    /// The player role matches the slot role.
    Match,
    /// The player is a midfielder/attacker/defender neighbor.
    Adjacent,
    /// The roles are incompatible.
    Mismatch,
    /// No player, slot, or formation position was available.
    None,
}

/// Position factor and status returned by [`get_position_match_factor`].
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PositionMatch {
    /// Multiplicative stat factor.
    pub factor: f64,
    /// Human-readable classification.
    pub status: PositionMatchStatus,
}

/// Computes the role factor for one team slot.
#[must_use]
pub fn get_position_match_factor(
    player_position: &str,
    slot_id: &str,
    formation: &Formation,
) -> PositionMatch {
    if player_position.is_empty() || slot_id.is_empty() {
        return PositionMatch {
            factor: 1.0,
            status: PositionMatchStatus::None,
        };
    }
    if slot_id.starts_with("reserve-")
        || slot_id.starts_with("manager-")
        || slot_id.starts_with("support-")
    {
        return PositionMatch {
            factor: 1.0,
            status: PositionMatchStatus::Match,
        };
    }

    let Some(slot_index) = slot_id
        .strip_prefix("field-")
        .and_then(parse_javascript_integer)
    else {
        return PositionMatch {
            factor: 1.0,
            status: PositionMatchStatus::None,
        };
    };
    let Some(position) = formation
        .positions
        .iter()
        .find(|position| usize::from(position.index) == slot_index)
    else {
        return PositionMatch {
            factor: 1.0,
            status: PositionMatchStatus::None,
        };
    };

    let player = player_position.to_ascii_uppercase();
    let slot = position.role.as_str();
    if player == slot {
        return PositionMatch {
            factor: 1.0,
            status: PositionMatchStatus::Match,
        };
    }
    if (player == "MF" && matches!(slot, "FW" | "DF"))
        || (slot == "MF" && matches!(player.as_str(), "FW" | "DF"))
    {
        return PositionMatch {
            factor: 0.85,
            status: PositionMatchStatus::Adjacent,
        };
    }
    PositionMatch {
        factor: 0.65,
        status: PositionMatchStatus::Mismatch,
    }
}

fn parse_javascript_integer(value: &str) -> Option<usize> {
    let digits = value.as_bytes();
    let end = digits
        .iter()
        .position(|byte| !byte.is_ascii_digit())
        .unwrap_or(digits.len());
    (end > 0).then(|| value[..end].parse().ok()).flatten()
}

/// Recalculated stats and combat power for one team member.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct RecalculatedStats {
    /// Kick.
    pub kick: i64,
    /// Control.
    pub control: i64,
    /// Technique.
    pub technique: i64,
    /// Pressure.
    pub pressure: i64,
    /// Physical.
    pub physical: i64,
    /// Agility.
    pub agility: i64,
    /// Intelligence.
    pub intelligence: i64,
    /// Sum of all seven recalculated stats.
    pub combat_power: i64,
}

impl RecalculatedStats {
    fn from_stats(stats: TeamMemberStats) -> Self {
        Self {
            kick: stats.kick,
            control: stats.control,
            technique: stats.technique,
            pressure: stats.pressure,
            physical: stats.physical,
            agility: stats.agility,
            intelligence: stats.intelligence,
            combat_power: stats.kick
                + stats.control
                + stats.technique
                + stats.pressure
                + stats.physical
                + stats.agility
                + stats.intelligence,
        }
    }
}

/// Applies level, position, dominant-element, and harmony factors to a member.
#[must_use]
pub fn recalculate_member_stats(
    member: &TeamMember,
    level: f64,
    slot_id: &str,
    formation: &Formation,
    dominant_element: Option<&str>,
    has_harmony: bool,
) -> RecalculatedStats {
    let base = member.stats.unwrap_or_default();
    let level_factor = 0.2 + 0.8 * (level - 1.0) / 98.0;
    let position_factor = get_position_match_factor(&member.position, slot_id, formation).factor;
    let element_factor = f64::from(u8::from(
        dominant_element.is_some_and(|element| member.element == element),
    ));
    let element_multiplier = if element_factor == 1.0 { 1.05 } else { 1.0 };
    let harmony_multiplier = if has_harmony { 1.03 } else { 1.0 };
    let multiplier = level_factor * position_factor * element_multiplier * harmony_multiplier;
    let recalculate = |value: i64| js_round(value as f64 * multiplier);
    RecalculatedStats::from_stats(TeamMemberStats {
        kick: recalculate(base.kick),
        control: recalculate(base.control),
        technique: recalculate(base.technique),
        pressure: recalculate(base.pressure),
        physical: recalculate(base.physical),
        agility: recalculate(base.agility),
        intelligence: recalculate(base.intelligence),
    })
}

fn js_round(value: f64) -> i64 {
    (value + 0.5).floor() as i64
}

/// Coordinates copied into one elemental link.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LinkCoordinate {
    /// Top percentage.
    pub top: f64,
    /// Left percentage.
    pub left: f64,
}

/// One pair of nearby field slots sharing an element.
#[derive(Debug, Clone, PartialEq)]
pub struct ElementLink {
    /// First slot in source member order.
    pub slot_a: String,
    /// Second slot in source member order.
    pub slot_b: String,
    /// Shared element.
    pub element: String,
    /// First projected coordinate.
    pub coord_a: LinkCoordinate,
    /// Second projected coordinate.
    pub coord_b: LinkCoordinate,
}

/// Result of evaluating the four-element field synergy.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ElementSynergyInfo {
    /// Most common field element when it has at least four players.
    pub dominant_element: Option<String>,
    /// Whether all four canonical elements are represented.
    pub has_harmony: bool,
    /// Nearby same-element field links.
    pub links: Vec<ElementLink>,
}

/// Evaluates synergies while preserving the input object's iteration order.
///
/// `members` is a slice rather than a hash map because JavaScript `Object.entries`
/// order is observable in the link order and must remain deterministic.
#[must_use]
pub fn calculate_element_synergies(
    members: &[(String, TeamMember)],
    formation: &Formation,
) -> ElementSynergyInfo {
    let elements = ["Fire", "Forest", "Mountain", "Wind"];
    let mut counts = [0_usize; 4];
    let field_members = members
        .iter()
        .filter(|(slot, _)| slot.starts_with("field-"))
        .collect::<Vec<_>>();
    for (_, member) in &field_members {
        if let Some(index) = elements
            .iter()
            .position(|element| *element == member.element)
        {
            counts[index] += 1;
        }
    }
    let mut dominant_index = None;
    let mut dominant_count = 0;
    for (index, count) in counts.iter().enumerate() {
        if *count >= 4 && *count > dominant_count {
            dominant_index = Some(index);
            dominant_count = *count;
        }
    }
    let dominant_element = dominant_index.map(|index| elements[index].to_owned());
    let has_harmony = counts.iter().all(|count| *count > 0);

    let mut links = Vec::new();
    for (index_a, (slot_a, member_a)) in field_members.iter().enumerate() {
        let Some(position_a) = field_position(slot_a, formation) else {
            continue;
        };
        if position_a.role == PositionRole::Gk {
            continue;
        }
        for (slot_b, member_b) in field_members.iter().skip(index_a + 1) {
            if member_a.element != member_b.element {
                continue;
            }
            let Some(position_b) = field_position(slot_b, formation) else {
                continue;
            };
            if position_b.role == PositionRole::Gk {
                continue;
            }
            let distance =
                (position_a.top - position_b.top).hypot(position_a.left - position_b.left);
            if distance < 25.0 {
                links.push(ElementLink {
                    slot_a: slot_a.to_owned(),
                    slot_b: slot_b.to_owned(),
                    element: member_a.element.clone(),
                    coord_a: LinkCoordinate {
                        top: position_a.top,
                        left: position_a.left,
                    },
                    coord_b: LinkCoordinate {
                        top: position_b.top,
                        left: position_b.left,
                    },
                });
            }
        }
    }
    ElementSynergyInfo {
        dominant_element,
        has_harmony,
        links,
    }
}

fn field_position<'a>(
    slot: &str,
    formation: &'a Formation,
) -> Option<&'a super::formations::PositionCoord> {
    let index = slot
        .strip_prefix("field-")
        .and_then(parse_javascript_integer)?;
    let index = u8::try_from(index).ok()?;
    formation
        .positions
        .iter()
        .find(|position| position.index == index)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::azalee::formations::legacy_formations;

    fn member(position: &str, element: &str) -> TeamMember {
        TeamMember {
            position: position.into(),
            element: element.into(),
            stats: Some(TeamMemberStats {
                kick: 100,
                control: 100,
                technique: 100,
                pressure: 100,
                physical: 100,
                agility: 100,
                intelligence: 100,
            }),
            ..TeamMember::default()
        }
    }

    #[test]
    fn matches_roles_and_neutralizes_non_field_slots() {
        let formation = legacy_formations().remove(0);
        assert_eq!(
            get_position_match_factor("GK", "field-10", &formation).status,
            PositionMatchStatus::Match
        );
        assert_eq!(
            get_position_match_factor("MF", "field-0", &formation).factor,
            0.85
        );
        assert_eq!(
            get_position_match_factor("GK", "field-0", &formation).factor,
            0.65
        );
        assert_eq!(
            get_position_match_factor("GK", "reserve-1", &formation).status,
            PositionMatchStatus::Match
        );
        assert_eq!(
            get_position_match_factor("FW", "field-99", &formation).status,
            PositionMatchStatus::None
        );
    }

    #[test]
    fn recalculates_level_position_element_and_harmony_factors() {
        let formation = legacy_formations().remove(0);
        let base = recalculate_member_stats(
            &member("FW", "Fire"),
            99.0,
            "field-0",
            &formation,
            None,
            false,
        );
        assert_eq!(base.kick, 100);
        assert_eq!(base.combat_power, 700);
        let boosted = recalculate_member_stats(
            &member("FW", "Fire"),
            99.0,
            "field-0",
            &formation,
            Some("Fire"),
            true,
        );
        assert_eq!(boosted.kick, 108);
    }

    #[test]
    fn counts_only_field_elements_and_ignores_goalkeeper_links() {
        let formation = legacy_formations().remove(0);
        let members = (0..4)
            .map(|i| (format!("field-{i}"), member("FW", "Fire")))
            .chain([("reserve-0".into(), member("FW", "Fire"))])
            .collect::<Vec<_>>();
        let synergy = calculate_element_synergies(&members, &formation);
        assert_eq!(synergy.dominant_element.as_deref(), Some("Fire"));
        assert!(!synergy.has_harmony);
        assert!(
            synergy
                .links
                .iter()
                .all(|link| link.slot_a != "field-10" && link.slot_b != "field-10")
        );
    }

    #[test]
    fn dominant_element_ties_keep_the_first_source_element() {
        let formation = legacy_formations().remove(0);
        let members = (0..8)
            .map(|i| {
                (
                    format!("field-{i}"),
                    member("FW", if i < 4 { "Fire" } else { "Forest" }),
                )
            })
            .collect::<Vec<_>>();
        assert_eq!(
            calculate_element_synergies(&members, &formation)
                .dominant_element
                .as_deref(),
            Some("Fire")
        );
    }
}
