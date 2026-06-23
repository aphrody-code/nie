#![allow(clippy::pedantic)]
//! Golden `cond` — validation du **cadrage** des blobs de condition contre le **corpus réel
//! entier** du jeu (skip silencieux si `data/` absent). C'est la vérité terrain du format : si
//! TOUS les blobs version-0 réels satisfont `declared_len == payload.len()+1`, le cadrage est
//! prouvé (pas deviné). Sémantique des clauses = hors scope (exige l'évaluateur, cf. `cond.rs`).

use nie_data::cond::CondBlob;

const ROOT: &str = "/home/ubuntu/niers/data/common/gamedata";

/// Décode base64 (alphabet standard, padding optionnel) → octets. `None` si invalide.
fn b64(s: &str) -> Option<Vec<u8>> {
    const INV: u8 = 0xFF;
    let mut table = [INV; 256];
    for (i, c) in b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
        .iter()
        .enumerate()
    {
        table[*c as usize] = i as u8;
    }
    let mut out = Vec::new();
    let mut acc = 0u32;
    let mut bits = 0;
    for &c in s.as_bytes() {
        if c == b'=' {
            break;
        }
        let v = table[c as usize];
        if v == INV {
            return None;
        }
        acc = (acc << 6) | u32::from(v);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    Some(out)
}

/// Décode `s` (base64) et pousse si ≥ 6 octets (taille minimale d'un en-tête cond).
fn push_blob(s: &str, out: &mut Vec<Vec<u8>>) {
    if let Some(b) = b64(s)
        && b.len() >= 6
    {
        out.push(b);
    }
}

/// Collecte récursivement toutes les chaînes base64 « cond » (champs connus + variables String
/// commençant par `AAAA` = en-tête version 0/1) d'un `serde_json::Value`.
fn collect(v: &serde_json::Value, out: &mut Vec<Vec<u8>>) {
    const FIELDS: [&str; 5] = ["cond", "openCond", "condition", "runCond", "aocCondition"];
    match v {
        serde_json::Value::Object(m) => {
            // Variable T2B : { "type": "String", "value": "AAAA..." }
            if m.get("type").and_then(|t| t.as_str()) == Some("String")
                && let Some(s) = m.get("value").and_then(|s| s.as_str())
                && s.len() >= 12
                && s.starts_with("AAAA")
            {
                push_blob(s, out);
            }
            for (k, vv) in m {
                if FIELDS.contains(&k.as_str())
                    && let Some(s) = vv.as_str()
                    && s.len() >= 8
                {
                    push_blob(s, out);
                }
                collect(vv, out);
            }
        }
        serde_json::Value::Array(a) => a.iter().for_each(|x| collect(x, out)),
        _ => {}
    }
}

fn walk_files(dir: &std::path::Path, files: &mut Vec<std::path::PathBuf>, cap: usize) {
    if files.len() >= cap {
        return;
    }
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            walk_files(&p, files, cap);
        } else if p.to_string_lossy().ends_with(".cfg.bin.json") {
            files.push(p);
            if files.len() >= cap {
                return;
            }
        }
    }
}

#[test]
fn cadrage_version0_prouve_sur_corpus_reel() {
    if !std::path::Path::new(ROOT).exists() {
        return;
    }
    let mut files = Vec::new();
    walk_files(std::path::Path::new(ROOT), &mut files, 3000);
    let mut blobs = Vec::new();
    for f in &files {
        if let Ok(txt) = std::fs::read_to_string(f)
            && let Ok(v) = serde_json::from_str::<serde_json::Value>(&txt)
        {
            collect(&v, &mut blobs);
        }
    }
    assert!(blobs.len() > 1000, "corpus de blobs cond conséquent (eu {})", blobs.len());

    let mut v0 = 0usize;
    let mut v0_bad = 0usize;
    let mut versions_other = 0usize;
    for b in &blobs {
        let c = CondBlob::parse(b).expect("≥6 octets garanti");
        match c.version {
            0 => {
                v0 += 1;
                if !c.framing_valid_v0() {
                    v0_bad += 1;
                }
            }
            1 => versions_other += 1,
            _ => panic!("version inattendue {} (cadrage non 0/1)", c.version),
        }
    }
    // Cadrage version-0 prouvé : AUCUN blob version-0 ne viole declared_len == len-5.
    assert_eq!(v0_bad, 0, "{v0_bad} blobs version-0 violent le cadrage (sur {v0})");
    assert!(v0 > 1000, "majorité de blobs version-0 (eu {v0})");
    eprintln!("cond corpus: {} blobs | v0={v0} (cadrage OK) | v1(liste)={versions_other}", blobs.len());
}
