//! Browser DTO conversion only; all team-rule calculations belong to nie-core.

use nie_core::azalee::{formations, team_rules as owner, team_types};
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

#[derive(serde::Deserialize)]
struct Formation {
    id: String,
    name: String,
    label: String,
    positions: Vec<Position>,
}

#[derive(serde::Deserialize)]
struct Position {
    index: u8,
    top: f64,
    left: f64,
    role: String,
}

fn formation(input: &str) -> Result<formations::Formation, String> {
    let input: Formation = serde_json::from_str(input).map_err(|error| error.to_string())?;
    let positions = input
        .positions
        .into_iter()
        .map(|position| {
            let role = match position.role.as_str() {
                "FW" => formations::PositionRole::Fw,
                "MF" => formations::PositionRole::Mf,
                "DF" => formations::PositionRole::Df,
                "GK" => formations::PositionRole::Gk,
                _ => return Err("Invalid formation role".to_owned()),
            };
            Ok(formations::PositionCoord {
                index: position.index,
                top: position.top,
                left: position.left,
                role,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(formations::Formation {
        id: input.id,
        name: input.name,
        label: input.label,
        positions,
    })
}

#[derive(serde::Deserialize)]
struct Member {
    position: String,
    element: String,
    stats: Option<team_types::TeamMemberStats>,
}

impl From<Member> for team_types::TeamMember {
    fn from(member: Member) -> Self {
        Self {
            position: member.position,
            element: member.element,
            stats: member.stats,
            ..Self::default()
        }
    }
}

fn json(value: &impl serde::Serialize) -> Result<String, String> {
    serde_json::to_string(value).map_err(|error| error.to_string())
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn team_position_factor(
    position: &str,
    slot: &str,
    formation_json: &str,
) -> Result<String, String> {
    json(&owner::get_position_match_factor(
        position,
        slot,
        &formation(formation_json)?,
    ))
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn team_recalculate_stats(
    member_json: &str,
    level: f64,
    slot: &str,
    formation_json: &str,
    dominant_element: Option<String>,
    has_harmony: bool,
) -> Result<String, String> {
    if !level.is_finite() {
        return Err("Team level must be finite".to_owned());
    }
    let member: Member = serde_json::from_str(member_json).map_err(|error| error.to_string())?;
    json(&owner::recalculate_member_stats(
        &member.into(),
        level,
        slot,
        &formation(formation_json)?,
        dominant_element.as_deref(),
        has_harmony,
    ))
}

/// Member pairs retain JavaScript Object.entries order for the observable link ordering.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn team_element_synergies(members_json: &str, formation_json: &str) -> Result<String, String> {
    let members: Vec<(String, Member)> =
        serde_json::from_str(members_json).map_err(|error| error.to_string())?;
    let members = members
        .into_iter()
        .map(|(slot, member)| (slot, member.into()))
        .collect::<Vec<_>>();
    json(&owner::calculate_element_synergies(
        &members,
        &formation(formation_json)?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn assert_browser_json(actual: &Value, expected: &Value) {
        match (actual, expected) {
            (Value::Number(a), Value::Number(b)) => assert_eq!(a.as_f64(), b.as_f64()),
            (Value::Array(a), Value::Array(b)) => {
                assert_eq!(a.len(), b.len());
                for (a, b) in a.iter().zip(b) {
                    assert_browser_json(a, b);
                }
            }
            (Value::Object(a), Value::Object(b)) => {
                assert_eq!(a.len(), b.len());
                for (key, value) in a {
                    assert_browser_json(value, &b[key]);
                }
            }
            _ => assert_eq!(actual, expected),
        }
    }

    #[test]
    fn adapters_match_frozen_typescript_fixtures() {
        let fixtures: Value = serde_json::from_str(include_str!(
            "../../../../packages/nie-game/test/fixtures/team-rules.json"
        ))
        .unwrap();
        let formation = fixtures["formation"].to_string();
        for case in fixtures["positions"].as_array().unwrap() {
            let actual = team_position_factor(
                case["position"].as_str().unwrap(),
                case["slot"].as_str().unwrap(),
                &formation,
            )
            .unwrap();
            assert_browser_json(
                &serde_json::from_str::<Value>(&actual).unwrap(),
                &case["expected"],
            );
        }
        for case in fixtures["stats"].as_array().unwrap() {
            let actual = team_recalculate_stats(
                &case["member"].to_string(),
                case["level"].as_f64().unwrap(),
                case["slot"].as_str().unwrap(),
                &formation,
                case["dominant"].as_str().map(str::to_owned),
                case["harmony"].as_bool().unwrap(),
            )
            .unwrap();
            assert_browser_json(
                &serde_json::from_str::<Value>(&actual).unwrap(),
                &case["expected"],
            );
        }
        for case in fixtures["synergies"].as_array().unwrap() {
            let pairs = case["members"]
                .as_object()
                .unwrap()
                .iter()
                .collect::<Vec<_>>();
            let actual =
                team_element_synergies(&serde_json::to_string(&pairs).unwrap(), &formation)
                    .unwrap();
            assert_browser_json(
                &serde_json::from_str::<Value>(&actual).unwrap(),
                &case["expected"],
            );
        }
    }

    #[test]
    fn malformed_inputs_fail_without_substituting_rules() {
        assert!(team_position_factor("MF", "field-0", "{}").is_err());
        assert!(team_element_synergies("{}", "{}").is_err());
        assert!(team_recalculate_stats("{}", f64::NAN, "field-0", "{}", None, false).is_err());
    }
}
