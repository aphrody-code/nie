#![allow(clippy::pedantic)]
//! Tests golden `event_subtitle` — port 1:1 d'inagle `packages/inagle/src/parsers/event-subtitles.ts`
//! (parseurs par-fichier `parseSubtitleFile` / `loadTextMap` / `loadWashaMap`).
//!
//! Vérité terrain = l'event voicé réel `ev09_05000` (VFS IEVR), via
//! `cargo run -p nie-game --example extract_event_subtitle` : 22 lignes Subtitle (ja), 22 washa,
//! 22 dialogues (fr) — **jointure hash 22/22**. Ligne 0 : hash `0x6540D3B6`, start `1.1666667`,
//! end `6.9166665`, washa.label `"ev09_05000_010_010"`, dialogue fr brut commençant par
//! « Les champions en titre sont tombés !\n<MNT:NAGUMOHARA>… » (tags **conservés**).

use nie_data::event_subtitle::{
    find_event_text, parse_event_text, parse_subtitle_file, parse_washa_map,
};
use nie_data::hash::HashId;
use serde_json::{json, Value};

fn ivar(v: i64) -> Value {
    json!({ "type": "Int", "value": v.to_string() })
}
fn fvar(v: &str) -> Value {
    json!({ "type": "Float", "value": v })
}
fn svar(v: &str) -> Value {
    json!({ "type": "String", "value": v })
}

const H: i64 = 0x6540_D3B6;

#[test]
fn subtitle_timings() {
    let root = json!({ "entries": [{
        "name": "EV_SUBTITLE_DATA_LIST_BEG_0", "variables": [ivar(22)],
        "children": [{
            "name": "EV_SUBTITLE_DATA_0",
            "variables": [ivar(H), fvar("1.1666667"), fvar("6.9166665"), fvar("0"), fvar("0")],
            "children": []
        }]
    }]});
    let rows = parse_subtitle_file(&root);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].text_hash, HashId(0x6540_D3B6));
    assert!((rows[0].show_start - 1.1666667).abs() < 1e-6);
    assert!((rows[0].show_end - 6.9166665).abs() < 1e-6);
    // < 5 variables → ignoré.
    let short = json!({ "entries": [{
        "name": "EV_SUBTITLE_DATA_LIST_BEG_0", "variables": [ivar(1)],
        "children": [{ "name": "EV_SUBTITLE_DATA_0",
            "variables": [ivar(1), fvar("0"), fvar("0")], "children": [] }]
    }]});
    assert!(parse_subtitle_file(&short).is_empty());
}

#[test]
fn washa_label_and_lip() {
    // 16 variables : hash@0, lip@5, label@15.
    let mut vars: Vec<Value> = (0..16).map(|_| svar("")).collect();
    vars[0] = ivar(H);
    vars[5] = svar("no_lip");
    vars[15] = svar("ev09_05000_010_010");
    let root = json!({ "entries": [{
        "name": "TEXT_WASHA_MAP_BEGIN_0", "variables": [ivar(22)],
        "children": [{ "name": "TEXT_WASHA_MAP_0", "variables": vars, "children": [] }]
    }]});
    let entries = parse_washa_map(&root);
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].text_hash, HashId(0x6540_D3B6));
    assert_eq!(entries[0].lip_sync.as_deref(), Some("no_lip"));
    assert_eq!(entries[0].label.as_deref(), Some("ev09_05000_010_010"));

    // Champs vides → None ; < 16 variables → ignoré.
    let mut v2: Vec<Value> = (0..16).map(|_| svar("")).collect();
    v2[0] = ivar(7);
    let root2 = json!({ "entries": [{
        "name": "TEXT_WASHA_MAP_BEGIN_0", "variables": [ivar(1)],
        "children": [{ "name": "TEXT_WASHA_MAP_0", "variables": v2, "children": [] }]
    }]});
    let e2 = parse_washa_map(&root2);
    assert_eq!(e2[0].lip_sync, None);
    assert_eq!(e2[0].label, None);
}

#[test]
fn dialogue_raw_text_preserved_and_join() {
    let raw = "Les champions en titre sont tombés !\\n<MNT:NAGUMOHARA> récupère le ballon.";
    let root = json!({ "entries": [{
        "name": "TEXT_INFO_BEGIN_0", "variables": [ivar(22)],
        "children": [{ "name": "TEXT_INFO_0",
            "variables": [ivar(H), ivar(0), svar(raw)], "children": [] }]
    }]});
    let lines = parse_event_text(&root);
    assert_eq!(lines.len(), 1);
    assert_eq!(lines[0].text_hash, HashId(0x6540_D3B6));
    // Texte BRUT : les tags `<MNT:…>` et `\n` littéral sont conservés (pas de sanitize).
    assert_eq!(lines[0].raw_text, raw);
    assert!(lines[0].raw_text.contains("<MNT:NAGUMOHARA>"));

    // Jointure par hash (la clé partagée subtitle ↔ washa ↔ dialogue).
    assert_eq!(
        find_event_text(&lines, HashId(0x6540_D3B6)),
        Some(raw)
    );
    assert_eq!(find_event_text(&lines, HashId(0xDEAD_BEEF)), None);
}
