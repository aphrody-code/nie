//! Thin JSON adapters for the shared roster filter and seeded field generator.

use nie_core::azalee::team_generator as owner;
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

fn parse<T: serde::de::DeserializeOwned>(json: &str) -> Result<T, String> {
    serde_json::from_str(json).map_err(|error| error.to_string())
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn team_generator_filter(
    roster_json: &str,
    filters_json: &str,
    minimum: u32,
) -> Result<String, String> {
    let roster: Vec<owner::Candidate> = parse(roster_json)?;
    let filters: owner::Filters = parse(filters_json)?;
    serde_json::to_string(&owner::filter_candidates(
        &roster,
        &filters,
        minimum as usize,
    ))
    .map_err(|error| error.to_string())
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn team_generator_generate(
    roster_json: &str,
    positions_json: &str,
    filters_json: &str,
    locks_json: &str,
    seed: u32,
) -> Result<String, String> {
    let roster: Vec<owner::Candidate> = parse(roster_json)?;
    let positions: Vec<owner::FieldSlot> = parse(positions_json)?;
    let filters: owner::Filters = parse(filters_json)?;
    let locks: Vec<(String, String)> = parse(locks_json)?;
    let generated = owner::generate(&roster, &positions, &filters, &locks, seed)?;
    serde_json::to_string(&generated).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    #[test]
    fn filter_matches_frozen_legacy_cases_without_normalizing_unicode_or_nulls() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../../packages/nie-game/test/fixtures/team-generator.json"
        ))
        .unwrap();
        let roster = fixture["roster"].as_array().unwrap().iter().map(|player| json!({
            "id": player["id"], "position": player["poste"], "element": player["element"],
            "gender": player["genre"], "rarity": player["rarete"], "series": player["serie"],
        })).collect::<Vec<_>>();
        for case in fixture["cases"].as_array().unwrap() {
            let filters = &case["filters"];
            let filters = json!({"element": filters["element"], "gender": filters["genre"], "rarity": filters["rarete"], "series": filters["serie"]});
            let actual: owner::FilteredPool = serde_json::from_str(
                &team_generator_filter(
                    &serde_json::to_string(&roster).unwrap(),
                    &filters.to_string(),
                    case["minimum"].as_u64().unwrap() as u32,
                )
                .unwrap(),
            )
            .unwrap();
            let ids = actual
                .indices
                .iter()
                .map(|&index| roster[index]["id"].clone())
                .collect::<Vec<_>>();
            let ignored = actual
                .ignored
                .iter()
                .map(|key| match key {
                    owner::FilterKey::Element => "élément",
                    owner::FilterKey::Gender => "genre",
                    owner::FilterKey::Rarity => "rareté",
                    owner::FilterKey::Series => "série",
                })
                .collect::<Vec<_>>();
            assert_eq!(json!(ids), case["expected"]["ids"]);
            assert_eq!(json!(ignored), case["expected"]["ignored"]);
        }
    }

    #[test]
    fn native_adapter_uses_the_same_seeded_owner_and_rejects_malformed_data() {
        let roster = (0..4)
            .map(|id| owner::Candidate {
                id: id.to_string(),
                position: "FW".into(),
                element: "Fire".into(),
                gender: None,
                rarity: "Normal".into(),
                series: None,
            })
            .collect::<Vec<_>>();
        let positions = vec![
            owner::FieldSlot {
                index: 0,
                role: "FW".into(),
            },
            owner::FieldSlot {
                index: 1,
                role: "FW".into(),
            },
        ];
        let expected =
            owner::generate(&roster, &positions, &owner::Filters::default(), &[], 5489).unwrap();
        let actual = team_generator_generate(
            &serde_json::to_string(&roster).unwrap(),
            &serde_json::to_string(&positions).unwrap(),
            "{}",
            "[]",
            5489,
        )
        .unwrap();
        assert_eq!(
            serde_json::from_str::<Vec<owner::Assignment>>(&actual).unwrap(),
            expected
        );
        assert_eq!(expected[0].roster_index, Some(3));
        assert_eq!(expected[1].roster_index, Some(0));
        assert!(team_generator_filter("{}", "{}", 1).is_err());
        assert!(team_generator_generate("[]", "{}", "{}", "[]", 0).is_err());
    }
}
