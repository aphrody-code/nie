//! Thin browser adapters for the canonical team sharing-code rules.

use nie_core::azalee::team_code as owner;
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Slot {
    slot: String,
    chara_id: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DecodedCode {
    formation_id: String,
    slots: Vec<Slot>,
}

/// Encode the historical UTF-8 share format through its Rust owner.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn team_code_encode(formation_id: &str, slots_json: &str) -> Result<String, String> {
    let slots: Vec<Slot> = serde_json::from_str(slots_json).map_err(|error| error.to_string())?;
    let slots = slots
        .into_iter()
        .map(|slot| owner::TeamCodeSlot {
            slot: slot.slot,
            chara_id: slot.chara_id,
        })
        .collect::<Vec<_>>();
    Ok(owner::encode_team_code(formation_id, &slots))
}

/// Decode using the owner's exact malformed-segment recovery behavior.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn team_code_decode(encoded: &str) -> Result<String, String> {
    let decoded = owner::decode_team_code(encoded).map_err(|error| error.to_string())?;
    let decoded = DecodedCode {
        formation_id: decoded.formation_id,
        slots: decoded
            .slots
            .into_iter()
            .map(|slot| Slot {
                slot: slot.slot,
                chara_id: slot.chara_id,
            })
            .collect(),
    };
    serde_json::to_string(&decoded).map_err(|error| error.to_string())
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
#[must_use]
pub fn team_code_utf8_to_base64(text: &str) -> String {
    owner::utf8_to_base64(text)
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn team_code_base64_to_utf8(encoded: &str) -> Result<String, String> {
    owner::base64_to_utf8(encoded).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adapters_match_frozen_browser_codes_and_native_owner() {
        let fixtures: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../packages/nie-game/test/fixtures/team-code.json"
        ))
        .unwrap();
        for fixture in fixtures["roundTrips"].as_array().unwrap() {
            let formation = fixture["formationId"].as_str().unwrap();
            let slots_json = fixture["slots"].to_string();
            let encoded = team_code_encode(formation, &slots_json).unwrap();
            assert_eq!(encoded, fixture["encoded"].as_str().unwrap());
            let decoded: serde_json::Value =
                serde_json::from_str(&team_code_decode(&encoded).unwrap()).unwrap();
            assert_eq!(decoded["formationId"], fixture["formationId"]);
            assert_eq!(decoded["slots"], fixture["slots"]);
            let native = owner::decode_team_code(&encoded).unwrap();
            assert_eq!(native.formation_id, formation);
            assert_eq!(
                native.slots.len(),
                fixture["slots"].as_array().unwrap().len()
            );
        }
        for fixture in fixtures["decodeOnly"].as_array().unwrap() {
            let actual: serde_json::Value = serde_json::from_str(
                &team_code_decode(fixture["encoded"].as_str().unwrap()).unwrap(),
            )
            .unwrap();
            assert_eq!(actual, fixture["decoded"]);
        }
        assert!(team_code_decode("!").is_err());
        assert!(team_code_encode("f", "not JSON").is_err());
        assert_eq!(team_code_base64_to_utf8("/w==").unwrap(), "\u{fffd}");
    }
}
