//! UTF-8/base64 team sharing codes used by IEVR wiki URLs.

use std::string::String;
use std::vec::Vec;

/// An occupied team slot in a sharing code.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct TeamCodeSlot {
    /// Slot identifier.
    pub slot: String,
    /// Character identifier.
    pub chara_id: String,
}

/// Decoded team sharing code.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct DecodedTeamCode {
    /// Formation identifier.
    pub formation_id: String,
    /// Valid occupied slots, in encoded order.
    pub slots: Vec<TeamCodeSlot>,
}

/// Errors raised by browser-compatible `atob` behavior.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum TeamCodeError {
    /// The input is not valid standard base64.
    #[error("invalid base64 team code")]
    InvalidBase64,
    /// The decoded bytes are not valid UTF-8. The current implementation does
    /// not emit this variant, but retaining it documents the boundary.
    #[error("invalid UTF-8 team code")]
    InvalidUtf8,
}

/// Encodes UTF-8 text as standard base64.
#[must_use]
pub fn utf8_to_base64(text: &str) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let bytes = text.as_bytes();
    let mut output = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let a = chunk[0];
        let b = chunk.get(1).copied().unwrap_or(0);
        let c = chunk.get(2).copied().unwrap_or(0);
        output.push(ALPHABET[(a >> 2) as usize] as char);
        output.push(ALPHABET[((a & 0x03) << 4 | b >> 4) as usize] as char);
        output.push(if chunk.len() > 1 {
            ALPHABET[((b & 0x0f) << 2 | c >> 6) as usize] as char
        } else {
            '='
        });
        output.push(if chunk.len() > 2 {
            ALPHABET[(c & 0x3f) as usize] as char
        } else {
            '='
        });
    }
    output
}

/// Decodes standard base64 into UTF-8 text, replacing malformed UTF-8 like
/// the browser `TextDecoder` used by the TypeScript implementation.
pub fn base64_to_utf8(encoded: &str) -> Result<String, TeamCodeError> {
    let compact: Vec<u8> = encoded
        .bytes()
        .filter(|byte| !byte.is_ascii_whitespace())
        .collect();
    if compact.len() % 4 == 1 {
        return Err(TeamCodeError::InvalidBase64);
    }

    let mut bytes = Vec::with_capacity(compact.len() / 4 * 3);
    let mut index = 0;
    while index < compact.len() {
        let remaining = compact.len() - index;
        if remaining < 2 {
            return Err(TeamCodeError::InvalidBase64);
        }
        let a = decode_base64_byte(compact[index])?;
        let b = decode_base64_byte(compact[index + 1])?;
        let third_is_padding = remaining >= 3 && compact[index + 2] == b'=';
        let fourth_is_padding = remaining >= 4 && compact[index + 3] == b'=';
        if third_is_padding && !fourth_is_padding {
            return Err(TeamCodeError::InvalidBase64);
        }
        if (third_is_padding || fourth_is_padding) && (remaining != 4 || index + 4 != compact.len())
        {
            return Err(TeamCodeError::InvalidBase64);
        }
        let c = if remaining >= 3 && !third_is_padding {
            decode_base64_byte(compact[index + 2])?
        } else {
            0
        };
        let d = if remaining >= 4 && !fourth_is_padding {
            decode_base64_byte(compact[index + 3])?
        } else {
            0
        };
        bytes.push((a << 2) | (b >> 4));
        if remaining >= 3 && compact[index + 2] != b'=' {
            bytes.push((b << 4) | (c >> 2));
        }
        if remaining >= 4 && compact[index + 3] != b'=' {
            bytes.push((c << 6) | d);
        }
        index += 4.min(remaining);
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

fn decode_base64_byte(byte: u8) -> Result<u8, TeamCodeError> {
    match byte {
        b'A'..=b'Z' => Ok(byte - b'A'),
        b'a'..=b'z' => Ok(byte - b'a' + 26),
        b'0'..=b'9' => Ok(byte - b'0' + 52),
        b'+' => Ok(62),
        b'/' => Ok(63),
        _ => Err(TeamCodeError::InvalidBase64),
    }
}

/// Encodes a formation and occupied slots, preserving slot order.
#[must_use]
pub fn encode_team_code(formation_id: &str, slots: &[TeamCodeSlot]) -> String {
    let mut text = formation_id.to_owned();
    for slot in slots {
        text.push('|');
        text.push_str(&slot.slot);
        text.push(':');
        text.push_str(&slot.chara_id);
    }
    utf8_to_base64(&text)
}

/// Decodes a sharing code. Segments without two non-empty colon-separated
/// fields are ignored, matching the partial recovery behavior of the wiki.
pub fn decode_team_code(encoded: &str) -> Result<DecodedTeamCode, TeamCodeError> {
    let decoded = base64_to_utf8(encoded)?;
    let parts: Vec<&str> = decoded.split('|').collect();
    let formation_id = parts.first().copied().unwrap_or_default().to_owned();
    let slots = parts
        .iter()
        .skip(1)
        .filter_map(|part| {
            let mut fields = part.split(':');
            let slot = fields.next().unwrap_or_default();
            let chara_id = fields.next().unwrap_or_default();
            (!slot.is_empty() && !chara_id.is_empty()).then(|| TeamCodeSlot {
                slot: slot.to_owned(),
                chara_id: chara_id.to_owned(),
            })
        })
        .collect();
    Ok(DecodedTeamCode {
        formation_id,
        slots,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_utf8_and_preserves_slots() {
        let slots = [
            TeamCodeSlot {
                slot: "field-0".into(),
                chara_id: "円堂".into(),
            },
            TeamCodeSlot {
                slot: "reserve-2".into(),
                chara_id: "whs01230".into(),
            },
        ];
        let encoded = encode_team_code("diamond442", &slots);
        assert_eq!(
            decode_team_code(&encoded).unwrap(),
            DecodedTeamCode {
                formation_id: "diamond442".into(),
                slots: slots.to_vec()
            }
        );
    }

    #[test]
    fn ignores_malformed_segments_and_rejects_bad_base64() {
        let encoded = utf8_to_base64("4-4-2|field-0:abc|broken|reserve-1:");
        let decoded = decode_team_code(&encoded).unwrap();
        assert_eq!(decoded.formation_id, "4-4-2");
        assert_eq!(decoded.slots.len(), 1);
        assert_eq!(decode_team_code("!!!"), Err(TeamCodeError::InvalidBase64));
    }
}
