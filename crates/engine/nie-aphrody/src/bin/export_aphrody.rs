//! Generate the complete Aphrody (Byron Love) dossier from native game data.
//!
//! Crosses chara_param + skill_config + aura_skill_config via
//! [`nie_aphrody::gisement::build_aphrody_dossier`]. The output contains only native game/VFS
//! data and the embedded Aphrody pet package; no website, wiki, or network enrichment is used.
//!
//! # Usage
//! ```text
//! cargo run --bin export_aphrody --features serde,std -- \
//!     --data $NIE_GAME_DIR/data --out export/aphrody-dossier.json
//! ```

use std::fs;
use std::path::{Path, PathBuf};

/// Racine des données décodées, sans chemin de poste en dur : `NIE_GAME_DIR/data` si la
/// variable est posée, sinon `./data` (le dépôt est fusionné avec l'installation du jeu).
fn default_data_root() -> PathBuf {
    std::env::var("NIE_GAME_DIR")
        .map(|d| PathBuf::from(d).join("data"))
        .unwrap_or_else(|_| PathBuf::from("data"))
}

use nie_aphrody::{BUNDLED_ANIMATIONS_JSON, BUNDLED_PET_JSON, gisement::build_aphrody_dossier};
use serde_json::Value;

fn main() {
    // `--data` sinon `NIE_GAME_DIR/data` sinon `./data` : aucun chemin de poste en dur.
    let data_root = std::env::args()
        .skip_while(|a| a != "--data")
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(default_data_root);
    // `--out` sinon à côté des données, dans `export/`.
    let out_path = std::env::args()
        .skip_while(|a| a != "--out")
        .nth(1)
        .unwrap_or_else(|| {
            data_root
                .join("../export/aphrody-dossier.json")
                .to_string_lossy()
                .into_owned()
        });

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

    // Dialogues are extracted from the game's localized event files. They remain VFS data.
    let dialogues = extract_dialogues(&data_root);
    let n_lines: usize = dialogues
        .iter()
        .filter_map(|d| d.get("lines").and_then(Value::as_array).map(Vec::len))
        .sum();
    let pet: Value = serde_json::from_str(BUNDLED_PET_JSON).expect("embedded pet manifest");
    let animations: Value =
        serde_json::from_str(BUNDLED_ANIMATIONS_JSON).expect("embedded animation manifest");
    let identity = json
        .get("identity")
        .cloned()
        .expect("native dossier identity");
    let stats = json.get("stats").cloned().expect("native dossier stats");
    let series = json.get("series").cloned().expect("native dossier series");
    let assets = json.get("assets").cloned().expect("native dossier assets");
    let variants = json
        .get("variants")
        .cloned()
        .expect("native dossier variants");
    let primary = variants
        .as_array()
        .and_then(|items| items.iter().find(|item| item["is_primary"] == true))
        .cloned()
        .unwrap_or_else(|| Value::Object(serde_json::Map::new()));
    let internal_codes = series
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item["code"].as_str().map(str::to_owned))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let native_data = json;
    let dialogues = Value::Array(dialogues);
    json = serde_json::json!({
        "schema_version": 1,
        "slug": "byron-love-aphrody",
        "generated_at": "native-vfs-export",
        "identity": identity,
        "internal_codes": internal_codes,
        "game": {
            "source": "local game VFS",
            "data": native_data,
            "dialogues": dialogues.clone(),
        },
        "stats": stats,
        "series": series,
        "assets": assets,
        "variants": variants,
        "techniques": primary["techniques"].clone(),
        "auras": primary["auras"].clone(),
        "dialogues": dialogues,
        "pet": {
            "manifest": pet,
            "animations": animations,
        },
        "sources": {
            "game_vfs": {
                "root": "data/",
                "character": "data/common/gamedata/character/",
                "skills": "data/common/gamedata/skill/",
                "events": "data/common/text/{ja,fr,en}/event/"
            },
            "pet_package": "crates/engine/nie-aphrody/assets/aphrody/"
        }
    });

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
