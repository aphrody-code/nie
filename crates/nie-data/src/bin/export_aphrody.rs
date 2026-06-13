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

    let chara = read_json(&find_cfg(&data_root, "common/gamedata/character", "chara_param_"));
    let skill = read_json(&find_cfg(&data_root, "common/gamedata/skill", "skill_config_"));
    let aura = read_json(&find_cfg(&data_root, "common/gamedata/skill", "aura_skill_config_"));

    let dossier = build_aphrody_dossier(&chara, &skill, &aura);
    let json = serde_json::to_value(&dossier).expect("sérialisation dossier");

    let variants = json.get("variants").and_then(Value::as_array).map_or(0, Vec::len);
    let bytes = serde_json::to_vec_pretty(&json).expect("to_vec_pretty");
    if let Some(parent) = Path::new(&out_path).parent() {
        fs::create_dir_all(parent).expect("création dossier de sortie");
    }
    fs::write(&out_path, &bytes).expect("écriture JSON");
    eprintln!("[export_aphrody] OK — {variants} variantes, {}o → {out_path}", bytes.len());
    println!("variants={variants} size={} out={out_path}", bytes.len());
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
    assert!(!candidates.is_empty(), "[export_aphrody] introuvable : {subdir}/{prefix}*.cfg.bin.json");
    candidates.sort_unstable_by(|a, b| b.cmp(a));
    candidates.remove(0)
}

fn read_json(path: &Path) -> Value {
    let raw = fs::read_to_string(path).unwrap_or_else(|e| panic!("[export_aphrody] lecture {path:?}: {e}"));
    serde_json::from_str(&raw).unwrap_or_else(|e| panic!("[export_aphrody] parse {path:?}: {e}"))
}
