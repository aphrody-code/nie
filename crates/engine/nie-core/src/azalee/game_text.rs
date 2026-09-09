//! Deterministic formatting of decoded IEVR rich text.
//!
//! This ports Azalee's `game-text/format.ts`. It removes Level-5 `[C...]`
//! control codes and only unmatched brackets while preserving real balanced
//! labels, position glyphs, CJK spacing, and line breaks. It has no decoder,
//! filesystem, or web-runtime dependency.

const POSITION_GLYPHS: [&str; 5] = ["GK", "DF", "MF", "FW", "PG"];
const GLYPH_SENTINEL_BASE: u32 = 0xf8f0;

/// Formats decoded IEVR text for wiki display.
///
/// Rust's standard library does not provide a complete Unicode normalization
/// implementation. The local NFC pass composes the Latin combining-mark
/// sequences found in game text and leaves all other already-composed/CJK
/// scalars untouched. A host decoder may normalize the full string before
/// calling this function when it handles additional Unicode normalization
/// forms.
#[must_use]
pub fn format_game_text(raw: &str) -> String {
    if raw.is_empty() {
        return raw.to_owned();
    }

    let mut text = normalize_nfc_for_game_text(raw);
    text = protect_glyphs(&text);
    text = strip_control_codes(&text);
    text = strip_orphan_brackets(&text);
    text = restore_glyphs(&text);
    normalize_whitespace(&text)
}

fn protect_glyphs(input: &str) -> String {
    let mut output = input.to_owned();
    for (index, glyph) in POSITION_GLYPHS.iter().enumerate() {
        output = output.replace(
            &format!("[{glyph}]"),
            &char::from_u32(GLYPH_SENTINEL_BASE + index as u32)
                .expect("position sentinel is a valid Unicode scalar")
                .to_string(),
        );
    }
    output
}

fn restore_glyphs(input: &str) -> String {
    let mut output = input.to_owned();
    for (index, glyph) in POSITION_GLYPHS.iter().enumerate() {
        let sentinel = char::from_u32(GLYPH_SENTINEL_BASE + index as u32)
            .expect("position sentinel is a valid Unicode scalar")
            .to_string();
        output = output.replace(&sentinel, &format!("[{glyph}]"));
    }
    output
}

fn strip_control_codes(input: &str) -> String {
    let mut output = input.to_owned();
    for _ in 0..8 {
        let next =
            remove_open_keywords(&remove_keyword_closers(&remove_well_formed_codes(&output)));
        if next == output {
            break;
        }
        output = next;
    }
    output
}

fn remove_well_formed_codes(input: &str) -> String {
    let chars: Vec<char> = input.chars().collect();
    let mut output = String::with_capacity(input.len());
    let mut index = 0;
    while index < chars.len() {
        if chars[index] == '['
            && chars.get(index + 1) == Some(&'C')
            && let Some(close) = keyword_close(&chars, index + 1)
        {
            index = close + 1;
            continue;
        }
        output.push(chars[index]);
        index += 1;
    }
    output
}

fn remove_keyword_closers(input: &str) -> String {
    let chars: Vec<char> = input.chars().collect();
    let mut output = String::with_capacity(input.len());
    let mut index = 0;
    while index < chars.len() {
        if chars[index] == 'C'
            && (index == 0 || !chars[index - 1].is_ascii_alphabetic())
            && let Some(close) = keyword_close(&chars, index)
        {
            index = close + 1;
            continue;
        }
        output.push(chars[index]);
        index += 1;
    }
    output
}

fn remove_open_keywords(input: &str) -> String {
    let chars: Vec<char> = input.chars().collect();
    let mut output = String::with_capacity(input.len());
    let mut index = 0;
    while index < chars.len() {
        if chars[index] == '[' && chars.get(index + 1) == Some(&'C') {
            index = keyword_end(&chars, index + 1);
            continue;
        }
        output.push(chars[index]);
        index += 1;
    }
    output
}

/// Returns the index of `]` when `start` points to the `C` of a control code.
fn keyword_close(chars: &[char], start: usize) -> Option<usize> {
    let end = keyword_end(chars, start);
    (end < chars.len() && chars[end] == ']').then_some(end)
}

/// Returns the index immediately after the `C...` keyword.
fn keyword_end(chars: &[char], start: usize) -> usize {
    let mut index = start + 1;
    while index < chars.len() && is_keyword_char(chars[index]) {
        index += 1;
    }
    index
}

fn is_keyword_char(character: char) -> bool {
    character.is_ascii_uppercase() || character.is_ascii_digit() || character == '_'
}

fn strip_orphan_brackets(input: &str) -> String {
    if !input.contains(['[', ']']) {
        return input.to_owned();
    }

    let chars: Vec<char> = input.chars().collect();
    let mut stack = Vec::new();
    let mut dropped = vec![false; chars.len()];
    for (index, character) in chars.iter().enumerate() {
        match character {
            '[' => stack.push(index),
            ']' if stack.pop().is_none() => dropped[index] = true,
            _ => {}
        }
    }
    for index in stack {
        dropped[index] = true;
    }

    chars
        .into_iter()
        .enumerate()
        .filter_map(|(index, character)| (!dropped[index]).then_some(character))
        .collect()
}

fn normalize_whitespace(input: &str) -> String {
    input
        .split('\n')
        .map(|line| {
            let mut normalized = String::with_capacity(line.len());
            let mut previous_space = false;
            for character in line.chars() {
                if character == ' ' {
                    if !previous_space {
                        normalized.push(character);
                    }
                    previous_space = true;
                } else {
                    normalized.push(character);
                    previous_space = false;
                }
            }
            normalized.trim_end_matches(' ').to_owned()
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn normalize_nfc_for_game_text(input: &str) -> String {
    let mut output: Vec<char> = Vec::with_capacity(input.chars().count());
    for character in input.chars() {
        if let Some(previous) = output.last_mut()
            && let Some(composed) = compose_latin(*previous, character)
        {
            *previous = composed;
            continue;
        }
        output.push(character);
    }
    output.into_iter().collect()
}

fn compose_latin(base: char, combining: char) -> Option<char> {
    let composed = match (base, combining) {
        ('a', '\u{300}') => 'à',
        ('a', '\u{301}') => 'á',
        ('a', '\u{302}') => 'â',
        ('a', '\u{303}') => 'ã',
        ('a', '\u{308}') => 'ä',
        ('a', '\u{30a}') => 'å',
        ('c', '\u{327}') => 'ç',
        ('e', '\u{300}') => 'è',
        ('e', '\u{301}') => 'é',
        ('e', '\u{302}') => 'ê',
        ('e', '\u{308}') => 'ë',
        ('i', '\u{300}') => 'ì',
        ('i', '\u{301}') => 'í',
        ('i', '\u{302}') => 'î',
        ('i', '\u{308}') => 'ï',
        ('n', '\u{303}') => 'ñ',
        ('o', '\u{300}') => 'ò',
        ('o', '\u{301}') => 'ó',
        ('o', '\u{302}') => 'ô',
        ('o', '\u{303}') => 'õ',
        ('o', '\u{308}') => 'ö',
        ('u', '\u{300}') => 'ù',
        ('u', '\u{301}') => 'ú',
        ('u', '\u{302}') => 'û',
        ('u', '\u{308}') => 'ü',
        ('y', '\u{301}') => 'ý',
        ('y', '\u{308}') => 'ÿ',
        ('A', '\u{300}') => 'À',
        ('A', '\u{301}') => 'Á',
        ('A', '\u{302}') => 'Â',
        ('A', '\u{303}') => 'Ã',
        ('A', '\u{308}') => 'Ä',
        ('A', '\u{30a}') => 'Å',
        ('C', '\u{327}') => 'Ç',
        ('E', '\u{300}') => 'È',
        ('E', '\u{301}') => 'É',
        ('E', '\u{302}') => 'Ê',
        ('E', '\u{308}') => 'Ë',
        ('I', '\u{300}') => 'Ì',
        ('I', '\u{301}') => 'Í',
        ('I', '\u{302}') => 'Î',
        ('I', '\u{308}') => 'Ï',
        ('N', '\u{303}') => 'Ñ',
        ('O', '\u{300}') => 'Ò',
        ('O', '\u{301}') => 'Ó',
        ('O', '\u{302}') => 'Ô',
        ('O', '\u{303}') => 'Õ',
        ('O', '\u{308}') => 'Ö',
        ('U', '\u{300}') => 'Ù',
        ('U', '\u{301}') => 'Ú',
        ('U', '\u{302}') => 'Û',
        ('U', '\u{308}') => 'Ü',
        ('Y', '\u{301}') => 'Ý',
        _ => return None,
    };
    Some(composed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn removes_well_formed_and_scrambled_control_codes() {
        assert_eq!(
            format_game_text("Vous avez trouvé une [CG]cannette abandonnée[C]."),
            "Vous avez trouvé une cannette abandonnée."
        );
        assert_eq!(
            format_game_text("は　１０００円をわたして\nCG2][卵C]と[CG2][牛乳C]を[買った！"),
            "は　１０００円をわたして\n卵と牛乳を買った！"
        );
        assert_eq!(
            format_game_text("ヘルプのなかには　CR][長押しC]で\nすぐに　[見られるものもあります。"),
            "ヘルプのなかには　長押しで\nすぐに　見られるものもあります。"
        );
    }

    #[test]
    fn preserves_position_glyphs_and_balanced_non_control_brackets() {
        assert_eq!(
            format_game_text("[GK] [DF] [$gaiji_c11010010] [WARNING]"),
            "[GK] [DF] [$gaiji_c11010010] [WARNING]"
        );
        assert_eq!(format_game_text("left [right"), "left right");
        assert_eq!(format_game_text("right]"), "right");
    }

    #[test]
    fn normalizes_spaces_but_keeps_lines_and_cjk_spacing() {
        assert_eq!(
            format_game_text("  Deux   mots  \n三　文字  "),
            " Deux mots\n三　文字"
        );
    }

    #[test]
    fn composes_common_decomposed_latin_text() {
        assert_eq!(format_game_text("Cafe\u{301}"), "Café");
    }
}
