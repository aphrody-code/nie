//! Host-neutral visual-novel casting policy.

use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VoiceBank {
    pub code: String,
    pub acb: String,
    pub awb_bytes: u64,
}

pub fn discover_voice_banks(
    entries: impl IntoIterator<Item = (String, u64)>,
    language: &str,
) -> Vec<VoiceBank> {
    let prefix = format!("data/common/sound_asset/{language}/");
    let mut sizes = BTreeMap::new();
    let mut acbs = Vec::new();
    for (path, size) in entries {
        let Some(rest) = path.strip_prefix(&prefix) else {
            continue;
        };
        let Some(stem) = rest
            .strip_suffix(".acb")
            .or_else(|| rest.strip_suffix(".awb"))
        else {
            continue;
        };
        if !stem.starts_with('c')
            || !stem[1..]
                .chars()
                .all(|character| character.is_ascii_digit())
        {
            continue;
        }
        if rest.ends_with(".awb") {
            sizes.insert(stem.to_owned(), size);
        } else {
            acbs.push((stem.to_owned(), path));
        }
    }
    let mut banks: Vec<_> = acbs
        .into_iter()
        .map(|(code, acb)| VoiceBank {
            awb_bytes: sizes.get(&code).copied().unwrap_or(0),
            code,
            acb,
        })
        .collect();
    banks.sort_by(|a, b| {
        b.awb_bytes
            .cmp(&a.awb_bytes)
            .then_with(|| a.code.cmp(&b.code))
    });
    banks
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CharacterIdentity {
    pub code: String,
    pub name: String,
    pub gender: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CastingOptions {
    pub limit: usize,
    pub search: Option<String>,
    pub gender: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct CastingEntry {
    pub code: String,
    pub name: Option<String>,
    pub gender: Option<String>,
    pub acb: String,
    pub awb_bytes: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ExportOptions {
    pub codes: Vec<String>,
    pub names: Vec<String>,
    pub language: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExportPlan {
    pub banks: Vec<VoiceBank>,
    pub warnings: Vec<String>,
}

pub fn plan_export(
    banks: &[VoiceBank],
    identities: &[CharacterIdentity],
    options: &ExportOptions,
) -> Result<ExportPlan, String> {
    if options.codes.is_empty() && options.names.is_empty() {
        return Err(format!(
            "désigner le casting avec --noms ou --casting ({} personnages doublés disponibles ; `niers vn casting --chercher <nom>` aide à les trouver)",
            banks.len()
        ));
    }
    let by_code: BTreeMap<_, _> = identities
        .iter()
        .map(|item| (item.code.as_str(), item))
        .collect();
    let mut selected = Vec::new();
    let mut warnings = Vec::new();
    for requested in &options.names {
        let pattern = fold_name(requested);
        match banks.iter().find(|bank| {
            by_code
                .get(bank.code.as_str())
                .is_some_and(|identity| fold_name(&identity.name).contains(&pattern))
        }) {
            Some(bank) => selected.push(bank.clone()),
            None => warnings.push(format!(
                "« {requested} » — aucun personnage doublé de ce nom, ignoré"
            )),
        }
    }
    for code in &options.codes {
        match banks.iter().find(|bank| &bank.code == code) {
            Some(bank) => selected.push(bank.clone()),
            None => {
                warnings.push(format!(
                    "{code} — aucune banque de voix, textures et dialogue seuls"
                ));
                selected.push(VoiceBank {
                    code: code.clone(),
                    acb: String::new(),
                    awb_bytes: 0,
                });
            }
        }
    }
    if selected.is_empty() {
        return Err(format!(
            "aucun des personnages demandés n'a de banque de voix en « {} »",
            options.language
        ));
    }
    Ok(ExportPlan {
        banks: selected,
        warnings,
    })
}

pub fn casting_entries(
    banks: impl IntoIterator<Item = VoiceBank>,
    identities: impl IntoIterator<Item = CharacterIdentity>,
    options: &CastingOptions,
) -> Vec<CastingEntry> {
    let identities: BTreeMap<_, _> = identities
        .into_iter()
        .map(|identity| (identity.code.clone(), identity))
        .collect();
    let search = options.search.as_deref().map(fold_name);
    let mut banks: Vec<_> = banks.into_iter().collect();
    banks.sort_by(|a, b| {
        b.awb_bytes
            .cmp(&a.awb_bytes)
            .then_with(|| a.code.cmp(&b.code))
    });
    banks
        .into_iter()
        .filter(|bank| {
            let identity = identities.get(&bank.code);
            if let Some(gender) = options.gender.as_deref()
                && identity.map(|item| item.gender.as_str()) != Some(gender)
            {
                return false;
            }
            match (&search, identity) {
                (Some(pattern), Some(item)) => fold_name(&item.name).contains(pattern),
                (Some(_), None) => false,
                (None, _) => true,
            }
        })
        .take(options.limit)
        .map(|bank| {
            let identity = identities.get(&bank.code);
            CastingEntry {
                code: bank.code,
                name: identity.map(|item| item.name.clone()),
                gender: identity.map(|item| item.gender.clone()),
                acb: bank.acb,
                awb_bytes: bank.awb_bytes,
            }
        })
        .collect()
}

pub fn fold_name(value: &str) -> String {
    value
        .chars()
        .flat_map(char::to_lowercase)
        .map(|character| match character {
            'à' | 'â' | 'ä' | 'á' | 'ã' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'î' | 'ï' | 'í' | 'ì' => 'i',
            'ô' | 'ö' | 'ó' | 'ò' | 'õ' => 'o',
            'û' | 'ü' | 'ú' | 'ù' => 'u',
            'ç' => 'c',
            'ñ' => 'n',
            other => other,
        })
        .filter(|character| character.is_alphanumeric() || *character == ' ')
        .collect()
}

pub fn t2b_to_iecode(entries: &[nie_formats::cfgbin::CfgEntry]) -> Vec<serde_json::Value> {
    use nie_formats::cfgbin::Value;
    entries.iter().map(|entry| {
        let variables = entry.variables.iter().map(|value| match value {
            Value::String(value) => serde_json::json!({"type":"String", "value":value}),
            Value::Int(value) => serde_json::json!({"type":"Int", "value":value.to_string()}),
            Value::Float(value) => serde_json::json!({"type":"Float", "value":value.to_string()}),
        }).collect::<Vec<_>>();
        serde_json::json!({"name":entry.name, "variables":variables, "children":t2b_to_iecode(&entry.children)})
    }).collect()
}

pub fn assemble_name(first: &str, last: &str) -> String {
    let first = first.trim();
    let last = last.trim();
    if last.is_empty() {
        return first.to_owned();
    }
    if first.is_empty() {
        return last.to_owned();
    }
    let first_words: Vec<_> = first.split_whitespace().map(fold_name).collect();
    let remaining: Vec<_> = last
        .split_whitespace()
        .filter(|word| !first_words.contains(&fold_name(word)))
        .collect();
    if remaining.is_empty() {
        first.to_owned()
    } else {
        format!("{first} {}", remaining.join(" "))
    }
}

pub fn identities_from_iecode(
    base: &serde_json::Value,
    text: &serde_json::Value,
) -> Vec<CharacterIdentity> {
    let nouns = nie_data::chara_text::parse_all_nouns(text);
    nie_data::chara_base::parse_all_chara_base(base)
        .into_iter()
        .filter_map(|character| {
            let first =
                nie_data::chara_base::resolve_first_name(&character, &nouns).unwrap_or_default();
            let last =
                nie_data::chara_base::resolve_last_name(&character, &nouns).unwrap_or_default();
            let name = assemble_name(first, last);
            if name.is_empty() || character.internal_code.is_empty() {
                return None;
            }
            Some(CharacterIdentity {
                code: character.internal_code,
                name,
                gender: if character.gender == 2 { "f" } else { "m" }.to_owned(),
            })
        })
        .collect()
}

pub fn capitalize_name(name: &str) -> String {
    if !name.chars().any(char::is_lowercase) && name.chars().any(char::is_alphabetic) {
        name.split(' ')
            .map(|word| {
                let mut chars = word.chars();
                match chars.next() {
                    Some(first) => {
                        first.to_uppercase().collect::<String>() + &chars.as_str().to_lowercase()
                    }
                    None => String::new(),
                }
            })
            .collect::<Vec<_>>()
            .join(" ")
    } else {
        name.to_owned()
    }
}

pub fn resolve_tags(text: &str, tags: &BTreeMap<String, String>) -> String {
    let mut output = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find('<') {
        output.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        let Some(end) = after.find('>') else {
            output.push_str(&rest[start..]);
            return output;
        };
        let content = &after[..end];
        match content.split_once(':') {
            Some((_, key)) if tags.contains_key(key) => output.push_str(&tags[key]),
            _ => {
                output.push('<');
                output.push_str(content);
                output.push('>');
            }
        }
        rest = &after[end + 1..];
    }
    output.push_str(rest);
    output
}

pub fn usable_dialogue(text: &str, tags: &BTreeMap<String, String>) -> Option<String> {
    let resolved = resolve_tags(text, tags).replace("\\n", "\n");
    if resolved.trim().is_empty() || has_unresolved_tag(&resolved) {
        None
    } else {
        Some(resolved)
    }
}

pub fn has_unresolved_tag(text: &str) -> bool {
    let mut rest = text;
    while let Some(start) = rest.find('<') {
        let after = &rest[start + 1..];
        match after.find('>') {
            Some(end) if after[..end].contains(':') => return true,
            Some(end) => rest = &after[end + 1..],
            None => return false,
        }
    }
    false
}

pub fn is_dialogue_line_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() < 8 {
        return false;
    }
    let suffix = &bytes[bytes.len() - 8..];
    suffix[0] == b'_'
        && suffix[4] == b'_'
        && suffix[1..4].iter().all(u8::is_ascii_digit)
        && suffix[5..8].iter().all(u8::is_ascii_digit)
}

pub fn dialogue_references(
    entries: &[nie_formats::cfgbin::CfgEntry],
    codes: &std::collections::BTreeSet<String>,
) -> Vec<(String, String)> {
    use nie_formats::cfgbin::Value;
    const DIALOGUE_OPCODE: u32 = 0xA4C7_132D;
    let mut references = Vec::new();
    let mut opcode = None;
    for entry in entries {
        match entry.name.as_str() {
            "EVENT_COMMAND_HEADER" => {
                opcode = match entry.variables.get(1) {
                    Some(Value::Int(value)) => Some(*value as u32),
                    _ => None,
                }
            }
            "EVENT_COMMAND_ARGS" => {
                if opcode == Some(DIALOGUE_OPCODE) {
                    let strings: Vec<_> = entry
                        .variables
                        .iter()
                        .filter_map(|value| match value {
                            Value::String(value) => Some(value.as_str()),
                            _ => None,
                        })
                        .collect();
                    let line = strings.iter().find(|value| is_dialogue_line_id(value));
                    let code = strings.iter().rev().find(|value| codes.contains(**value));
                    if let (Some(line), Some(code)) = (line, code) {
                        references.push(((*code).to_owned(), (*line).to_owned()));
                    }
                }
                opcode = None;
            }
            _ => {}
        }
    }
    references
}

pub fn collect_texts(
    entries: &[nie_formats::cfgbin::CfgEntry],
    output: &mut BTreeMap<u32, String>,
) {
    use nie_formats::cfgbin::Value;
    for entry in entries {
        if let Some(Value::Int(key)) = entry.variables.first()
            && let Some(Value::String(text)) = entry
                .variables
                .iter()
                .find(|value| matches!(value, Value::String(text) if !text.is_empty()))
        {
            output.entry(*key as u32).or_insert_with(|| text.clone());
        }
        collect_texts(&entry.children, output);
    }
}

pub fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '_' || character == '-' {
                character
            } else {
                '_'
            }
        })
        .collect()
}

pub fn catalogue(
    language: &str,
    characters: Vec<serde_json::Value>,
    music: Vec<serde_json::Value>,
) -> serde_json::Value {
    serde_json::json!({"version":1, "langue":language, "personnages":characters, "musique":music})
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn casting_is_ranked_then_filtered_with_folded_names() {
        let banks = [
            VoiceBank {
                code: "b".into(),
                acb: "b.acb".into(),
                awb_bytes: 20,
            },
            VoiceBank {
                code: "a".into(),
                acb: "a.acb".into(),
                awb_bytes: 10,
            },
        ];
        let identities = [
            CharacterIdentity {
                code: "a".into(),
                name: "Éric".into(),
                gender: "m".into(),
            },
            CharacterIdentity {
                code: "b".into(),
                name: "Alice".into(),
                gender: "f".into(),
            },
        ];
        let result = casting_entries(
            banks,
            identities,
            &CastingOptions {
                limit: 3,
                search: Some("eric".into()),
                gender: Some("m".into()),
            },
        );
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].code, "a");
    }

    #[test]
    fn voice_bank_discovery_pairs_awb_and_rejects_non_character_paths() {
        let banks = discover_voice_banks(
            [
                ("data/common/sound_asset/ja/c2.acb".into(), 3),
                ("data/common/sound_asset/ja/c2.awb".into(), 20),
                ("data/common/sound_asset/ja/c1.acb".into(), 2),
                ("data/common/sound_asset/ja/c1.awb".into(), 30),
                ("data/common/sound_asset/ja/bgm.acb".into(), 99),
            ],
            "ja",
        );
        assert_eq!(
            banks
                .iter()
                .map(|bank| bank.code.as_str())
                .collect::<Vec<_>>(),
            ["c1", "c2"]
        );
        assert_eq!(banks[0].awb_bytes, 30);
    }

    #[test]
    fn names_tags_and_paths_are_normalized_by_owner() {
        assert_eq!(assemble_name("Jude Sharp", "Jude"), "Jude Sharp");
        assert_eq!(capitalize_name("BYRON LOVE"), "Byron Love");
        let tags = BTreeMap::from([("BYRON".to_owned(), "Byron".to_owned())]);
        assert_eq!(
            usable_dialogue("Salut <FLC:BYRON>\\n!", &tags).as_deref(),
            Some("Salut Byron\n!")
        );
        assert!(usable_dialogue("Salut <FLC:UNKNOWN>", &tags).is_none());
        assert_eq!(sanitize_filename("c01/00.0010"), "c01_00_0010");
    }

    #[test]
    fn export_plan_keeps_explicit_unvoiced_characters() {
        let plan = plan_export(
            &[],
            &[],
            &ExportOptions {
                codes: vec!["c1".into()],
                names: vec![],
                language: "ja".into(),
            },
        )
        .expect("explicit code remains exportable");
        assert_eq!(plan.banks[0].code, "c1");
        assert!(plan.banks[0].acb.is_empty());
        assert_eq!(plan.warnings.len(), 1);
        let value = catalogue("ja", vec![], vec![]);
        assert_eq!(value["version"], 1);
        assert_eq!(value["langue"], "ja");
    }
}
