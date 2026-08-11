//! Génère le **dossier complet d'Aphrody** (Byron Love) vers `apps/azalee/data/aphrody-dossier.json`.
//!
//! Croise chara_param + skill_config + aura_skill_config via [`nie_data::aphrody::build_aphrody_dossier`]
//! (3 codes/séries, techniques+auras re-séparées, CutinAssets, assets par code). « Set up » du
//! personnage : données agrégées prêtes à servir l'UI / un RAG.
//!
//! # Usage
//! ```text
//! cargo run --bin export_aphrody --features serde,std -- \
//!     --data /home/ubuntu/niers/data --out /home/ubuntu/rg/apps/azalee/data/aphrody-dossier.json
//! ```

use std::fs;
use std::path::{Path, PathBuf};

use nie_data::aphrody::build_aphrody_dossier;
use serde_json::Value;

fn main() {
    let data_root = std::env::args()
        .skip_while(|a| a != "--data")
        .nth(1)
        .unwrap_or_else(|| "/home/ubuntu/niers/data".to_string());
    let out_path = std::env::args()
        .skip_while(|a| a != "--out")
        .nth(1)
        .unwrap_or_else(|| "/home/ubuntu/rg/apps/azalee/data/aphrody-dossier.json".to_string());
    let data_root = PathBuf::from(&data_root);

    let chara = read_json(&find_cfg(
        &data_root,
        "common/gamedata/character",
        "chara_param_",
    ));
    let skill = read_json(&find_cfg(
        &data_root,
        "common/gamedata/skill",
        "skill_config_",
    ));
    let aura = read_json(&find_cfg(
        &data_root,
        "common/gamedata/skill",
        "aura_skill_config_",
    ));

    let dossier = build_aphrody_dossier(&chara, &skill, &aura);
    let mut json = serde_json::to_value(&dossier).expect("sérialisation dossier");

    // Enrichissement texte (hors domaine nie-data) : dialogues trilingues, profil, références.
    let dialogues = extract_dialogues(&data_root);
    let n_lines: usize = dialogues
        .iter()
        .filter_map(|d| d.get("lines").and_then(Value::as_array).map(Vec::len))
        .sum();
    if let Value::Object(map) = &mut json {
        map.insert("profile".into(), aphrody_profile());
        map.insert("dialogues".into(), Value::Array(dialogues));
        map.insert("references".into(), aphrody_references());
    }

    let variants = json
        .get("variants")
        .and_then(Value::as_array)
        .map_or(0, Vec::len);
    let bytes = serde_json::to_vec_pretty(&json).expect("to_vec_pretty");
    if let Some(parent) = Path::new(&out_path).parent() {
        fs::create_dir_all(parent).expect("création dossier de sortie");
    }
    fs::write(&out_path, &bytes).expect("écriture JSON");
    eprintln!(
        "[export_aphrody] OK — {variants} variantes, {} dialogues / {n_lines} répliques, {}o → {out_path}",
        json.get("dialogues")
            .and_then(Value::as_array)
            .map_or(0, Vec::len),
        bytes.len()
    );
    println!(
        "variants={variants} dialogues={n_lines} size={} out={out_path}",
        bytes.len()
    );
}

/// Events de l'histoire où Aphrody apparaît (découverts par `grep アフロディ|亜風炉`
/// dans `data/common/text/ja/event/`). Scènes complètes, présentes en ja/fr/en.
const APHRODY_EVENTS: [&str; 11] = [
    "ev15_00600",
    "ev15_00650",
    "ev15_01000",
    "ev15_01600",
    "ev22_15202",
    "ev22_18234",
    "ev22_18236",
    "ev23_05000",
    "ev23_05250",
    "ev24_11000",
    "ev27_07210",
];

/// Nettoie un texte de dialogue : furigana `[漢字/かな]`→`漢字`, `\n`→espace, trim.
fn clean_text(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut chars = s.char_indices().peekable();
    while let Some((i, c)) = chars.next() {
        if c == '[' {
            // Cherche `/` puis `]` ; garde la partie kanji (avant `/`).
            if let Some(slash) = s[i + 1..].find('/')
                && let Some(close) = s[i + 1..].find(']')
                && slash < close
            {
                out.push_str(&s[i + 1..i + 1 + slash]);
                // Avance jusqu'après `]`.
                let target = i + 1 + close;
                while let Some(&(j, _)) = chars.peek() {
                    if j > target {
                        break;
                    }
                    chars.next();
                }
                continue;
            }
            out.push(c);
        } else if c == '\\' && bytes.get(i + 1) == Some(&b'n') {
            out.push(' ');
            chars.next(); // consomme le 'n'
        } else {
            out.push(c);
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Mentionne explicitement Aphrody (ja/fr/en) ?
fn mentions_aphrody(s: &str) -> bool {
    s.contains("アフロディ") || s.contains("亜風炉") || s.contains("Aphrod")
}

/// Extrait les répliques `TEXT_INFO_<n>` d'un fichier event : `(text_id_hex → texte)`.
fn event_lines(path: &Path) -> Vec<(String, String)> {
    use nie_data::cfgbin::walk_named;
    use nie_data::hash::HashId;
    let Ok(raw) = fs::read_to_string(path) else {
        return Vec::new();
    };
    let Ok(root) = serde_json::from_str::<Value>(&raw) else {
        return Vec::new();
    };
    let mut lines = Vec::new();
    walk_named(&root, "TEXT_INFO_", |node| {
        // Ignore TEXT_INFO_BEGIN_* (pas de chiffre direct après le préfixe).
        let suffix = &node.name()["TEXT_INFO_".len()..];
        if !suffix.starts_with(|c: char| c.is_ascii_digit()) {
            return;
        }
        // Premier Int = text-id (clé d'alignement multilingue) ; première String = réplique.
        let mut id = HashId::ZERO;
        let mut text = "";
        for i in 0..node.var_count() {
            if let Some(v) = node.var(i) {
                if v.ty == "Int" && id == HashId::ZERO {
                    id = v.as_hash();
                } else if v.ty == "String" && text.is_empty() {
                    text = v.value;
                }
            }
        }
        if !text.is_empty() {
            lines.push((id.to_hex(), clean_text(text)));
        }
    });
    lines
}

/// Construit les dialogues trilingues (alignés par text-id) des events d'Aphrody.
fn extract_dialogues(data_root: &Path) -> Vec<Value> {
    use serde_json::{Map, json};
    let mut out = Vec::new();
    for ev in APHRODY_EVENTS {
        let ja = event_lines(&data_root.join(format!("common/text/ja/event/{ev}.cfg.bin.json")));
        if ja.is_empty() {
            continue;
        }
        let fr: Map<String, Value> =
            event_lines(&data_root.join(format!("common/text/fr/event/{ev}.cfg.bin.json")))
                .into_iter()
                .map(|(id, t)| (id, Value::String(t)))
                .collect();
        let en: Map<String, Value> =
            event_lines(&data_root.join(format!("common/text/en/event/{ev}.cfg.bin.json")))
                .into_iter()
                .map(|(id, t)| (id, Value::String(t)))
                .collect();
        let lines: Vec<Value> = ja
            .iter()
            .map(|(id, ja_t)| {
                let fr_t = fr.get(id).and_then(Value::as_str).unwrap_or("");
                let en_t = en.get(id).and_then(Value::as_str).unwrap_or("");
                json!({
                    "id": id,
                    "ja": ja_t,
                    "fr": fr_t,
                    "en": en_t,
                    "mentions": mentions_aphrody(ja_t) || mentions_aphrody(fr_t) || mentions_aphrody(en_t),
                })
            })
            .collect();
        let mentions = lines
            .iter()
            .filter(|l| l.get("mentions").and_then(Value::as_bool).unwrap_or(false))
            .count();
        out.push(json!({
            "event_id": ev,
            "line_count": lines.len(),
            "aphrody_mentions": mentions,
            "lines": lines,
        }));
    }
    out
}

/// Profil / identité textuelle d'Aphrody (noms + épithète, vérifiés dans `chara_text`).
fn aphrody_profile() -> Value {
    serde_json::json!({
        "name_ja": "亜風炉 照美",
        "kana": "あふろ てるみ",
        "nickname_ja": "アフロディ",
        "nickname_en": "Aphrody",
        "epithet_ja": "アフロディ帝",
        "epithet_en": "Archon Aphrodite",
        "epithet_fr": "Archon Aphrodite",
    })
}

/// Références culturelles et easter eggs documentés (sourcés : noms, équipe, élément).
fn aphrody_references() -> Value {
    use serde_json::json;
    json!([
        {
            "title": "Étymologie — Aphrodite",
            "detail": "Le surnom アフロディ / Aphrody et l'épithète « Archon Aphrodite » renvoient à la déesse grecque Aphrodite ; le nom japonais 亜風炉 照美 (Afuro Terumi) est un calque phonétique de « Aphro ».",
        },
        {
            "title": "Titre « 帝 » / Archon",
            "detail": "Surnommé アフロディ帝 (« empereur Aphrodi »), localisé « Archon Aphrodite » — figure de chef quasi divin, cohérent avec l'imagerie gréco-mythologique.",
        },
        {
            "title": "Équipe Zeus",
            "detail": "Membre/figure de l'équipe Zeus (team_id 0x9BB9E791, name_en « Zeus ») — panthéon grec ; il revient ensuite comme entraîneur de la sélection coréenne Fire Dragon (event ev23_05000).",
        },
        {
            "title": "Élément Forêt",
            "detail": "Élément 2 (Forêt / 林) — sa palette de hissatsu et auras (Burning Overdrive wap01001, Instant Burst wap01005) s'y rattache.",
        },
        {
            "title": "Constellation Éclaris / Inazumis",
            "detail": "series_id 0x62E5F9CF, constellation « Éclaris » (FR) / « Inazumis » (EN), zukan #166 — décliné en 3 ères : IE1 (c01001900), GO (c05026590), Ares (c07080010).",
        },
    ])
}

fn find_cfg(data_root: &Path, subdir: &str, prefix: &str) -> PathBuf {
    let dir = data_root.join(subdir);
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(rd) = fs::read_dir(&dir) {
        for entry in rd.flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            // Le préfixe doit être suivi d'un chiffre de version : `chara_param_1.03…`
            // — exclut les voisins comme `chara_param_table_config_0.00…`.
            let versioned = name
                .strip_prefix(prefix)
                .is_some_and(|rest| rest.starts_with(|c: char| c.is_ascii_digit()));
            if versioned && name.ends_with(".cfg.bin.json") {
                candidates.push(entry.path());
            }
        }
    }
    assert!(
        !candidates.is_empty(),
        "[export_aphrody] introuvable : {subdir}/{prefix}*.cfg.bin.json"
    );
    candidates.sort_unstable_by(|a, b| b.cmp(a));
    candidates.remove(0)
}

fn read_json(path: &Path) -> Value {
    let raw = fs::read_to_string(path)
        .unwrap_or_else(|e| panic!("[export_aphrody] lecture {path:?}: {e}"));
    serde_json::from_str(&raw).unwrap_or_else(|e| panic!("[export_aphrody] parse {path:?}: {e}"))
}
