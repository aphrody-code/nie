//! Fuzzy and multilingual search without web dependencies.
//!
//! This is the deterministic part of Azalee's `fuzzy-match.ts`. It uses Rust
//! Unicode scalar values rather than JavaScript UTF-16 code units. Common
//! identifiers and names remain equivalent, with safer behavior for non-BMP
//! characters. The `wanakana` romaji dictionary is deliberately not embedded:
//! callers that have that adapter can pass its katakana result to
//! [`detect_matched_language_with_kana`].

/// Language of the label that satisfied a search.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MatchedLanguage {
    /// French.
    French,
    /// English.
    English,
    /// Japanese.
    Japanese,
}

/// Optional names for one item in the three wiki languages.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct MultilingualNames<'a> {
    /// French name.
    pub french: Option<&'a str>,
    /// English name.
    pub english: Option<&'a str>,
    /// Japanese name.
    pub japanese: Option<&'a str>,
}

/// Candidate selected by [`find_closest_match`].
#[derive(Debug, Clone, PartialEq)]
pub struct ClosestMatch {
    /// Original value, preserved for display.
    pub value: String,
    /// Similarity score in the theoretical `0..=1` range.
    pub score: f32,
}

/// Text segment intended for a highlighting component.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HighlightPart {
    /// Original text with accents and case preserved.
    pub text: String,
    /// Whether this segment matches the query.
    pub highlighted: bool,
}

/// Normalizes text for search comparisons.
///
/// Normalization removes common Latin diacritics, lowercases, and trims outer
/// whitespace. It does not transliterate Japanese.
#[must_use]
pub fn normalize_text(text: &str) -> String {
    text.chars()
        .flat_map(char::to_lowercase)
        .filter_map(fold_latin_diacritic)
        .collect::<String>()
        .trim()
        .to_owned()
}

/// Computes the Unicode Levenshtein edit distance between two texts.
#[must_use]
pub fn levenshtein_distance(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();

    if a.is_empty() {
        return b.len();
    }
    if b.is_empty() {
        return a.len();
    }

    let mut previous: Vec<usize> = (0..=b.len()).collect();
    let mut current = vec![0; b.len() + 1];

    for (i, a_char) in a.iter().enumerate() {
        current[0] = i + 1;
        for (j, b_char) in b.iter().enumerate() {
            let substitution = previous[j] + usize::from(a_char != b_char);
            current[j + 1] = (previous[j + 1] + 1).min(current[j] + 1).min(substitution);
        }
        std::mem::swap(&mut previous, &mut current);
    }

    previous[b.len()]
}

/// Computes a score insensitive to case.
///
/// Accent folding is intentionally a separate `normalize_text` stage, matching
/// `fuzzy-match.ts`: `find_closest_match` normalizes candidates before scoring,
/// while direct score calls only lowercase their arguments.
#[must_use]
pub fn similarity_score(a: &str, b: &str) -> f32 {
    // `fuzzy-match.ts` lowercases here, but accent folding is performed by
    // `findClosestMatch` before calling this function. Keep those two stages
    // separate so direct score calls preserve the source behavior.
    let a = lowercase(a);
    let b = lowercase(b);
    let max_len = a.chars().count().max(b.chars().count());
    if max_len == 0 {
        return 1.0;
    }

    1.0 - levenshtein_distance(&a, &b) as f32 / max_len as f32
}

/// Returns whether two texts reach the requested similarity threshold.
#[must_use]
pub fn is_similar(a: &str, b: &str, threshold: f32) -> bool {
    similarity_score(a, b) >= threshold
}

/// Returns the first best candidate above the threshold.
#[must_use]
pub fn find_closest_match(
    query: &str,
    candidates: &[&str],
    threshold: f32,
) -> Option<ClosestMatch> {
    let normalized_query = normalize_text(query);
    let mut best: Option<ClosestMatch> = None;
    for candidate in candidates {
        let normalized_candidate = normalize_text(candidate);
        let score = similarity_score(&normalized_query, &normalized_candidate);
        if score >= threshold && best.as_ref().is_none_or(|current| score > current.score) {
            best = Some(ClosestMatch {
                value: (*candidate).to_owned(),
                score,
            });
        }
    }
    best
}

/// Extracts non-empty, normalized variants in FR/EN/JP order.
#[must_use]
pub fn name_variations(names: MultilingualNames<'_>) -> Vec<String> {
    [names.french, names.english, names.japanese]
        .into_iter()
        .flatten()
        .filter(|name| !name.is_empty())
        .map(normalize_text)
        .filter(|name| !name.is_empty())
        .collect()
}

/// Detects the language of the first name matching the query.
#[must_use]
pub fn detect_matched_language(
    query: &str,
    names: MultilingualNames<'_>,
) -> Option<MatchedLanguage> {
    detect_matched_language_with_kana(query, names, None)
}

/// Detects a matching language, optionally using a caller-provided katakana
/// transliteration of the query.
///
/// The optional value is the narrow adapter boundary for `wanakana` (or a
/// different romaji dictionary). The core does not guess transliterations and
/// therefore remains deterministic and dictionary-free.
#[must_use]
pub fn detect_matched_language_with_kana(
    query: &str,
    names: MultilingualNames<'_>,
    romaji_katakana: Option<&str>,
) -> Option<MatchedLanguage> {
    let query = normalize_text(query);
    if query.is_empty() {
        return None;
    }

    let direct = [
        (MatchedLanguage::French, names.french),
        (MatchedLanguage::English, names.english),
        (MatchedLanguage::Japanese, names.japanese),
    ];
    for (language, name) in direct {
        if name.is_some_and(|name| normalize_text(name).contains(&query)) {
            return Some(language);
        }
    }

    if let (Some(japanese), Some(katakana)) = (names.japanese, romaji_katakana)
        && !katakana.is_empty()
        && japanese.contains(katakana)
    {
        return Some(MatchedLanguage::Japanese);
    }

    for (language, name) in direct {
        if name.is_some_and(|name| is_similar(&query, &normalize_text(name), 0.7)) {
            return Some(language);
        }
    }
    None
}

/// Highlights the first occurrence, ignoring accents.
#[must_use]
pub fn highlight_matches(text: &str, query: &str) -> Vec<HighlightPart> {
    let (normalized_text, offsets) = normalized_with_offsets(text);
    let normalized_query = normalize_text(query);
    if normalized_query.is_empty() {
        return vec![HighlightPart {
            text: text.to_owned(),
            highlighted: false,
        }];
    }

    let Some(normalized_start) = normalized_text.find(&normalized_query) else {
        return vec![HighlightPart {
            text: text.to_owned(),
            highlighted: false,
        }];
    };
    let start_char = normalized_text[..normalized_start].chars().count();
    let matched_char_count = normalized_query.chars().count();
    let end_char = start_char + matched_char_count;
    let Some((start, _)) = offsets.get(start_char).copied() else {
        return vec![HighlightPart {
            text: text.to_owned(),
            highlighted: false,
        }];
    };
    let Some((_, end)) = offsets.get(end_char.saturating_sub(1)).copied() else {
        return vec![HighlightPart {
            text: text.to_owned(),
            highlighted: false,
        }];
    };

    let mut parts = Vec::with_capacity(3);
    if start > 0 {
        parts.push(HighlightPart {
            text: text[..start].to_owned(),
            highlighted: false,
        });
    }
    parts.push(HighlightPart {
        text: text[start..end].to_owned(),
        highlighted: true,
    });
    if end < text.len() {
        parts.push(HighlightPart {
            text: text[end..].to_owned(),
            highlighted: false,
        });
    }
    parts
}

fn normalized_with_offsets(text: &str) -> (String, Vec<(usize, usize)>) {
    let mut normalized = String::new();
    let mut offsets = Vec::new();

    for (start, original) in text.char_indices() {
        let end = start + original.len_utf8();
        for lowered in original.to_lowercase() {
            if let Some(folded) = fold_latin_diacritic(lowered) {
                normalized.push(folded);
                offsets.push((start, end));
            }
        }
    }
    (normalized, offsets)
}

fn lowercase(text: &str) -> String {
    text.chars().flat_map(char::to_lowercase).collect()
}

fn fold_latin_diacritic(character: char) -> Option<char> {
    if ('\u{300}'..='\u{36f}').contains(&character) {
        return None;
    }

    Some(match character {
        'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'ā' | 'ă' | 'ą' => 'a',
        'ç' | 'ć' | 'ĉ' | 'ċ' | 'č' => 'c',
        'ď' | 'đ' => 'd',
        'è' | 'é' | 'ê' | 'ë' | 'ē' | 'ĕ' | 'ė' | 'ę' | 'ě' => 'e',
        'ğ' | 'ĝ' | 'ġ' | 'ģ' => 'g',
        'ĥ' => 'h',
        'ì' | 'í' | 'î' | 'ï' | 'ĩ' | 'ī' | 'ĭ' | 'į' | 'ı' => 'i',
        'ĵ' => 'j',
        'ķ' => 'k',
        'ĺ' | 'ļ' | 'ľ' | 'ŀ' | 'ł' => 'l',
        'ñ' | 'ń' | 'ņ' | 'ň' => 'n',
        'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ø' | 'ō' | 'ŏ' | 'ő' => 'o',
        'ŕ' | 'ŗ' | 'ř' => 'r',
        'ś' | 'ŝ' | 'ş' | 'š' => 's',
        'ť' | 'ţ' => 't',
        'ù' | 'ú' | 'û' | 'ü' | 'ũ' | 'ū' | 'ŭ' | 'ů' | 'ű' | 'ų' => 'u',
        'ŵ' => 'w',
        'ý' | 'ÿ' | 'ŷ' => 'y',
        'ź' | 'ż' | 'ž' => 'z',
        'æ' => 'æ',
        'œ' => 'œ',
        other => other,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_accents_case_and_outer_whitespace() {
        assert_eq!(
            normalize_text("  L'Étoffe des Héros  "),
            "l'etoffe des heros"
        );
        assert_eq!(normalize_text("カタカナ"), "カタカナ");
    }

    #[test]
    fn computes_unicode_levenshtein_and_similarity() {
        assert_eq!(levenshtein_distance("kitten", "sitting"), 3);
        assert_eq!(levenshtein_distance("é", "e"), 1);
        assert!((similarity_score("Étoile", "etoile") - 5.0 / 6.0).abs() < f32::EPSILON);
        assert_eq!(similarity_score("éTOILE", "Étoile"), 1.0);
    }

    #[test]
    fn finds_first_best_match_and_keeps_original_spelling() {
        let candidates = ["L'Étoffe des Héros", "L'Étoile"];
        let result = find_closest_match("etoffe des heros", &candidates, 0.6).unwrap();
        assert_eq!(result.value, "L'Étoffe des Héros");
        assert!(result.score > 0.6);
    }

    #[test]
    fn detects_direct_and_fuzzy_language_matches() {
        let names = MultilingualNames {
            french: Some("Tir du Dragon"),
            english: Some("Dragon Shot"),
            japanese: Some("ドラゴンショット"),
        };
        assert_eq!(
            detect_matched_language("dragon shot", names),
            Some(MatchedLanguage::English)
        );
        assert_eq!(
            detect_matched_language("Tir du Dragn", names),
            Some(MatchedLanguage::French)
        );
        assert_eq!(detect_matched_language("", names), None);
        assert_eq!(name_variations(names)[0], "tir du dragon");
    }

    #[test]
    fn highlights_accented_match_using_original_boundaries() {
        assert_eq!(
            highlight_matches("L'Étoffe", "etoffe"),
            vec![
                HighlightPart {
                    text: "L'".to_owned(),
                    highlighted: false
                },
                HighlightPart {
                    text: "Étoffe".to_owned(),
                    highlighted: true
                },
            ]
        );
        assert!(!highlight_matches("Dragon", "xyz")[0].highlighted);
    }

    #[test]
    fn detects_dictionary_transliteration_only_when_adapter_supplies_it() {
        let names = MultilingualNames {
            japanese: Some("ファイアトルネード"),
            ..Default::default()
        };
        assert_eq!(
            detect_matched_language("faiatorunedo", names),
            None,
            "the core must not invent a romaji dictionary"
        );
        assert_eq!(
            detect_matched_language_with_kana("faiatorunedo", names, Some("ファイアトルネード")),
            Some(MatchedLanguage::Japanese)
        );
    }
}
