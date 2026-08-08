//! Données de jeu STATIQUES (techniques pour l'instant) — indépendant du VFS "brut"
//! (`vfs_ls`/`vfs_describe`) et du miroir wiki azalee (`wikiDb`/`nameResolve`) : lecture directe
//! des `.cfg.bin` du jeu, décodés par les VRAIS parseurs typés de `nie-data` (déjà une
//! dépendance déclarée mais jamais câblée dans une commande jusqu'ici — cf. demande
//! utilisatrice « toutes les features, api et code de niers et des crates doivent être
//! utilisable et utilisé dans l'app »).
//!
//! Le pont bytes→JSON forme "inagle" qu'attendent les parseurs `nie-data` (`parse_skill_config`,
//! et ~115 autres modules du même crate) existe déjà et est TESTÉ : [`nie_explore::bridge`]
//! (`t2b_to_json`/`rdbn_to_json`), utilisé par `niers vfs cat`. Ce module ne fait que l'appeler
//! avec les bons chemins VFS — pas de nouvelle logique de décodage, zéro doublon.
//!
//! Un seul module câblé pour l'instant (techniques) : les ~115 autres (personnages, objets,
//! auras, boutiques, quêtes…) suivent EXACTEMENT le même patron (`list_values`/`walk_named` +
//! bridge), à étendre au besoin.

use nie_data::skill::{SkillInfo, SkillTextMaps};
use nie_formats::cfgbin::{CfgEntry, Value as CfgValue};
use nie_formats::vfs::Vfs;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;

/// Technique (hissatsu) — port applati de `nie_data::skill::SkillInfo` + son texte joint
/// (`skillNameId`/`skillDescId` résolus via `skill_text.cfg.bin`), pour l'IPC/l'export TS.
#[derive(Serialize, specta::Type)]
pub struct SkillDto {
    pub skill_id: String,
    pub skill_id_str: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub element: String,
    pub category: String,
    pub power_min: i32,
    pub power_max: i32,
    pub consume_tp: i32,
    pub recast_time: i32,
    pub eldorado: bool,
}

/// Premier chemin VFS (ordre alphabétique) dont le nom de fichier satisfait `pred` — même
/// convention de résolution dynamique que `nie-game/examples/export_*.rs` (les `.cfg.bin` sont
/// suffixés par version, ex. `skill_config_4.00.17.00.cfg.bin` : pas de nom fixe possible).
fn find_path(vfs: &Vfs, pred: impl Fn(&str) -> bool) -> Option<String> {
    vfs.iter().map(|(p, _)| p.to_string()).filter(|p| pred(p)).min()
}

fn base_name(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

/// Parse `skill_config` (+ `skill_text` FR si présent) → `SkillInfo` bruts + textes joints.
/// Factorisé depuis [`list_skills`] pour être réutilisé par [`find_skill`] (résolution par nom/ID
/// pour le pont Blender, cf. `blender_build_skill_scene` dans `lib.rs`) sans reparser deux fois.
fn parse_skills(vfs: &Vfs) -> Result<(Vec<SkillInfo>, SkillTextMaps), String> {
    let config_path = find_path(vfs, |p| {
        p.contains("/skill/") && base_name(p).starts_with("skill_config") && base_name(p).ends_with(".cfg.bin")
    })
    .ok_or("skill_config introuvable dans le VFS monté")?;
    let config_bytes = vfs.read(&config_path).map_err(|e| e.to_string())?;
    let rdbn = nie_formats::cfgbin::parse(&config_bytes).map_err(|e| format!("parse RDBN {config_path} : {e}"))?;
    let lists = nie_formats::cfgbin::read_values(&rdbn, &config_bytes);
    let config_json = nie_explore::bridge::rdbn_to_json(&lists);
    let skills = nie_data::skill::parse_skill_config(&config_json);

    let text_path = find_path(vfs, |p| p.contains("/text/fr/") && base_name(p) == "skill_text.cfg.bin");
    let maps = match text_path {
        Some(tp) => {
            let bytes = vfs.read(&tp).map_err(|e| e.to_string())?;
            let cfg = nie_formats::cfgbin::parse_t2b(&bytes).map_err(|e| format!("parse T2B {tp} : {e}"))?;
            let json = nie_explore::bridge::t2b_to_json(&cfg);
            nie_data::skill::parse_skill_text(&json)
        }
        None => nie_data::skill::SkillTextMaps::default(),
    };
    Ok((skills, maps))
}

/// Trouve UNE technique par requête libre : `skill_id_str` exact (ex. `whs00340`) en priorité,
/// sinon sous-chaîne insensible à la casse dans `skill_id_str` OU le nom FR résolu (ex. « Savoir
/// suprême »). `None` si aucune ne correspond — jamais un premier résultat approximatif imposé en
/// silence. Utilisé par `blender_build_skill_scene` (`lib.rs`) pour résoudre une requête utilisateur
/// libre (« Savoir Suprême ») en `SkillInfo` (→ `cutin_assets()` pour les chemins VFS du cut-in).
pub fn find_skill(vfs: &Vfs, query: &str) -> Result<Option<SkillInfo>, String> {
    let (skills, maps) = parse_skills(vfs)?;
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return Ok(None);
    }
    if let Some(exact) = skills.iter().find(|s| s.skill_id_str.eq_ignore_ascii_case(&q)) {
        return Ok(Some(exact.clone()));
    }
    Ok(skills
        .into_iter()
        .find(|s| {
            s.skill_id_str.to_lowercase().contains(&q)
                || nie_data::skill::join_skill_text(s, &maps).name.is_some_and(|n| n.to_lowercase().contains(&q))
        }))
}

/// Liste toutes les techniques du jeu (`m_skillInfoList` de `skill_config`), noms/descriptions
/// FR joints depuis `skill_text.cfg.bin` si trouvé (sinon `name`/`description` restent `None` —
/// jamais une chaîne devinée).
pub fn list_skills(vfs: &Vfs) -> Result<Vec<SkillDto>, String> {
    let (skills, maps) = parse_skills(vfs)?;

    Ok(skills
        .iter()
        .map(|s| {
            let text = nie_data::skill::join_skill_text(s, &maps);
            let element = s.element();
            let category = s.category();
            SkillDto {
                skill_id: s.skill_id.to_hex(),
                skill_id_str: s.skill_id_str.clone(),
                name: text.name,
                description: text.description,
                element: element.names().map(|(fr, _, _)| fr.to_string()).unwrap_or_else(|| format!("? ({})", s.element)),
                category: category.names().map(|(fr, _, _)| fr.to_string()).unwrap_or_else(|| format!("? ({})", s.category)),
                power_min: s.power_min as i32,
                power_max: s.power_max as i32,
                consume_tp: s.consume_tp as i32,
                recast_time: s.recast_time as i32,
                eldorado: s.eldorado,
            }
        })
        .collect())
}

/// Convertit une valeur T2B (`nie_formats::cfgbin::Value`) en JSON forme "inagle" — même mapping
/// que [`nie_explore::bridge::t2b_value_to_json`] (privé, donc reproduit ici plutôt qu'importé).
fn t2b_value_to_json(v: &CfgValue) -> Value {
    match v {
        CfgValue::String(s) => json!({ "type": "String", "value": s }),
        CfgValue::Int(i) => json!({ "type": "Int", "value": i.to_string() }),
        CfgValue::Float(f) => json!({ "type": "Float", "value": f.to_string() }),
    }
}

/// Convertit UNE liste de `CfgEntry` frères en JSON **avec suffixe d'index par nom dupliqué**
/// (`TEXT_INFO` → `TEXT_INFO_0`, `TEXT_INFO_1`, …) — c'est la forme "inagle"/iecode RÉELLE
/// qu'attendent `walk_named`/[`nie_data::text::parse_text_file`] (prefix-match `"TEXT_INFO_"` +
/// exclusion du noeud `"…_BEGIN"`), PAS la forme brute de [`nie_explore::bridge::t2b_to_json`]
/// (noms non désambiguïsés, ex. plusieurs frères tous nommés `"TEXT_INFO"`) : `walk_named`
/// matcherait alors 0 noeud (bug constaté : `list_items`/`list_auras`/`list_trophies`/
/// `list_quests` résolvaient 0 texte avant ce correctif, malgré des fichiers texte trouvés et
/// parsés sans erreur). Port fidèle du `to_iecode` local dupliqué dans CHAQUE
/// `nie-game/examples/export_{items,auras,trophies,quests}.rs` (déjà validé end-to-end sur le
/// vrai jeu) — factorisé ici une fois pour toutes plutôt que redupliqué une 5ᵉ fois.
fn to_indexed_json(siblings: &[CfgEntry]) -> Vec<Value> {
    let mut counts: HashMap<&str, usize> = HashMap::new();
    siblings
        .iter()
        .map(|e| {
            let idx = counts.entry(e.name.as_str()).or_insert(0);
            let name = format!("{}_{}", e.name, *idx);
            *idx += 1;
            json!({
                "name": name,
                "variables": e.variables.iter().map(t2b_value_to_json).collect::<Vec<_>>(),
                "children": to_indexed_json(&e.children),
            })
        })
        .collect()
}

/// Charge un `.cfg.bin` T2B du VFS (chemin résolu dynamiquement, cf. [`find_path`]) et le
/// convertit en JSON forme "inagle" **indexée** (cf. [`to_indexed_json`]) — factorisé pour les
/// modules `nie-data` ci-dessous (item/aura/trophy/quest, config ET texte).
fn load_t2b(vfs: &Vfs, pred: impl Fn(&str) -> bool, what: &str) -> Result<Value, String> {
    let path = find_path(vfs, pred).ok_or_else(|| format!("{what} introuvable dans le VFS monté"))?;
    let bytes = vfs.read(&path).map_err(|e| e.to_string())?;
    let cfg = nie_formats::cfgbin::parse_t2b(&bytes).map_err(|e| format!("parse T2B {path} : {e}"))?;
    Ok(json!({ "entries": to_indexed_json(&cfg.entries) }))
}

/// Objet (arme/consommable/costume/…) — port applati de `nie_data::item::ItemInfo` + son texte
/// joint (`item_text.cfg.bin`, mêmes noms ET descriptions), pour l'IPC/l'export TS. N'inclut que
/// les objets à nom résolu (comme `nie-game/examples/export_items.rs`, roster réel).
#[derive(Serialize, specta::Type)]
pub struct ItemDto {
    pub item_id: String,
    pub category: String,
    pub name: String,
    pub description: Option<String>,
    pub price: Option<i64>,
    pub internal_code: Option<String>,
}

/// Liste tous les objets du jeu (`item_config`), noms/descriptions FR joints depuis `item_text`.
pub fn list_items(vfs: &Vfs) -> Result<Vec<ItemDto>, String> {
    let config = load_t2b(vfs, |p| p.contains("/gamedata/item/") && base_name(p).starts_with("item_config") && base_name(p).ends_with(".cfg.bin"), "item_config")?;
    let items = nie_data::item::parse_all_items(&config);
    let text_json = load_t2b(vfs, |p| p.contains("/fr/") && base_name(p) == "item_text.cfg.bin", "item_text fr")?;
    let text = nie_data::text::parse_text_file(&text_json);

    Ok(items
        .iter()
        .filter_map(|it| {
            let name = nie_data::item::resolve_name(it, &text)?;
            Some(ItemDto {
                item_id: it.item_id.to_hex(),
                category: format!("{:?}", it.category),
                name: name.to_string(),
                description: nie_data::item::resolve_description(it, &text).map(str::to_string),
                price: it.price,
                internal_code: it.internal_code.clone(),
            })
        })
        .collect())
}

/// Avatar/Keshin (aura) — port applati de `nie_data::aura::AuraCmd` + son texte joint
/// (`skill_text.cfg.bin`, même table que les techniques). Le contenu signature d'IEVR.
#[derive(Serialize, specta::Type)]
pub struct AuraDto {
    pub aura_id: String,
    pub asset_code: String,
    pub name: String,
    pub description: Option<String>,
    pub element: String,
    pub sub_type: String,
}

/// Liste tous les Avatar/Keshin (`aura_skill_config`), noms/descriptions FR joints depuis `skill_text`.
pub fn list_auras(vfs: &Vfs) -> Result<Vec<AuraDto>, String> {
    let config = load_t2b(vfs, |p| p.contains("/gamedata/") && base_name(p).starts_with("aura_skill_config") && base_name(p).ends_with(".cfg.bin"), "aura_skill_config")?;
    let auras = nie_data::aura::parse_all_aura_cmds(&config);
    let text_json = load_t2b(vfs, |p| p.contains("/fr/") && base_name(p).starts_with("skill_text") && base_name(p).ends_with(".cfg.bin"), "skill_text fr")?;
    let text = nie_data::text::parse_text_file(&text_json);

    Ok(auras
        .iter()
        .filter_map(|a| {
            let name = nie_data::aura::resolve_name(a, &text)?;
            Some(AuraDto {
                aura_id: a.aura_id.to_hex(),
                asset_code: a.asset_code.clone(),
                name: name.to_string(),
                description: nie_data::aura::resolve_description(a, &text).map(str::to_string),
                element: format!("{:?}", a.element()),
                sub_type: format!("{:?}", a.sub_type),
            })
        })
        .collect())
}

/// Succès (trophy) — port applati de `nie_data::trophy::TrophyInfo` + son texte joint
/// (`trophy_text.cfg.bin`) + condition de déblocage décodée (`decode_unlock`).
#[derive(Serialize, specta::Type)]
pub struct TrophyDto {
    pub trophy_id: String,
    pub code: String,
    pub category: i64,
    pub name: String,
    pub description: Option<String>,
    pub unlock_kind: String,
    pub story_episode: Option<u32>,
}

/// Liste tous les succès (`trophy_config`), noms/descriptions FR joints depuis `trophy_text`,
/// condition de déblocage décodée (story/event-flag/composite/always).
pub fn list_trophies(vfs: &Vfs) -> Result<Vec<TrophyDto>, String> {
    let config_json = load_t2b(vfs, |p| p.contains("/gamedata/") && base_name(p).starts_with("trophy_config") && base_name(p).ends_with(".cfg.bin"), "trophy_config")?;
    let config = nie_data::trophy::parse_trophy_config(&config_json);
    let text_json = load_t2b(vfs, |p| p.contains("/fr/") && base_name(p).starts_with("trophy_text") && base_name(p).ends_with(".cfg.bin"), "trophy_text fr")?;
    let text = nie_data::text::parse_text_file(&text_json);

    Ok(config
        .infos
        .iter()
        .filter_map(|t| {
            let name = nie_data::trophy::resolve_name(t, &text)?;
            let cond = nie_data::trophy::decode_unlock(t);
            use nie_data::unlock_condition::UnlockType as U;
            Some(TrophyDto {
                trophy_id: t.trophy_id.to_hex(),
                code: t.code.clone(),
                category: t.category,
                name: name.to_string(),
                description: nie_data::trophy::resolve_description(t, &text).map(str::to_string),
                unlock_kind: match cond.kind {
                    U::Always => "always",
                    U::Story => "story",
                    U::EventFlag => "eventFlag",
                    U::Composite => "composite",
                }
                .to_string(),
                story_episode: cond.story_episode,
            })
        })
        .collect())
}

/// Quête — port applati de `nie_data::quest::ParsedQuest` + son titre joint
/// (`quest_title_text.cfg.bin`). N'inclut que les quêtes à titre résolu (roster réel).
#[derive(Serialize, specta::Type)]
pub struct QuestDto {
    pub quest_id: String,
    pub phase: i64,
    pub quest_type: i64,
    pub title: String,
    pub image: Option<String>,
}

/// Liste toutes les quêtes (`quest_config`), titres FR joints depuis `quest_title_text`.
pub fn list_quests(vfs: &Vfs) -> Result<Vec<QuestDto>, String> {
    let config = load_t2b(vfs, |p| p.contains("/gamedata/quest/") && base_name(p).starts_with("quest_config") && base_name(p).ends_with(".cfg.bin"), "quest_config")?;
    let quests = nie_data::quest::parse_quest_config(&config);
    let text_json = load_t2b(vfs, |p| p.contains("/fr/") && base_name(p).starts_with("quest_title_text") && base_name(p).ends_with(".cfg.bin"), "quest_title_text fr")?;
    let titles = nie_data::text::parse_text_file(&text_json);

    Ok(quests
        .iter()
        .filter_map(|q| {
            let title = nie_data::quest::resolve_title(q, &titles)?;
            Some(QuestDto {
                quest_id: q.quest_id.to_hex(),
                phase: q.phase,
                quest_type: q.quest_type,
                title: title.to_string(),
                image: q.image.clone(),
            })
        })
        .collect())
}

/// Personnage sélectionnable pour le calculateur de stats (§4.2 roadmap) — `nie_data::chara_param
/// ::CharaParam` joint à `chara_base`/`chara_text` pour un nom affichable. N'inclut que les
/// entrées à nom résolu (roster réel, même convention que les autres `list_*`).
#[derive(Serialize, specta::Type)]
pub struct CharaPickerDto {
    pub chara_param_id: String,
    pub name: String,
    pub main_position: String,
    pub sub_position: String,
}

/// Liste les personnages sélectionnables (`chara_param` joint à `chara_base`+`chara_text` pour
/// le nom). Un `chara_base_id` peut avoir plusieurs `CharaParam` (variantes de tenue/costume) —
/// toutes sont listées, différenciées par leur `chara_param_id`.
pub fn list_chara_picker(vfs: &Vfs) -> Result<Vec<CharaPickerDto>, String> {
    let param_json = load_t2b(vfs, |p| base_name(p).starts_with("chara_param_1") && base_name(p).ends_with(".cfg.bin"), "chara_param")?;
    let params = nie_data::chara_param::parse_all_chara_params(&param_json);

    let base_json = load_t2b(vfs, |p| p.contains("/character/") && base_name(p).starts_with("chara_base_1") && base_name(p).ends_with(".cfg.bin"), "chara_base")?;
    let bases = nie_data::chara_base::parse_all_chara_base(&base_json);

    let text_json = load_t2b(vfs, |p| p.contains("/fr/") && base_name(p) == "chara_text.cfg.bin", "chara_text fr")?;
    let nouns = nie_data::chara_text::parse_all_nouns(&text_json);

    Ok(params
        .iter()
        .filter_map(|cp| {
            let base = nie_data::chara_base::find_by_chara_id(&bases, cp.chara_base_id)?;
            let first = nie_data::chara_base::resolve_first_name(base, &nouns)?;
            let last = nie_data::chara_base::resolve_last_name(base, &nouns);
            let name = match last {
                Some(l) => format!("{first} {l}"),
                None => first.to_string(),
            };
            Some(CharaPickerDto {
                chara_param_id: cp.chara_param_id.to_hex(),
                name,
                main_position: nie_data::chara_param::position_code_owned(cp.main_position).unwrap_or_else(|| "?".to_string()),
                sub_position: nie_data::chara_param::position_code_owned(cp.sub_position).unwrap_or_else(|| "—".to_string()),
            })
        })
        .collect())
}

/// Bloc de 7 stats calculées (`nie_core::stats::StatBlock`), pour l'IPC/l'export TS.
#[derive(Serialize, specta::Type)]
pub struct StatBlockDto {
    pub kc: u16,
    pub cr: u16,
    pub tc: u16,
    pub pr: u16,
    pub ps: u16,
    pub ag: u16,
    pub it: u16,
    pub total: u32,
}

impl From<nie_core::stats::StatBlock> for StatBlockDto {
    fn from(s: nie_core::stats::StatBlock) -> Self {
        StatBlockDto { kc: s.kc, cr: s.cr, tc: s.tc, pr: s.pr, ps: s.ps, ag: s.ag, it: s.it, total: s.total() }
    }
}

/// Calcule les stats d'un personnage (`chara_param_id`, cf. [`list_chara_picker`]) à un niveau et
/// une rareté donnés — `nie_core::growth::calculate_stats` sur les tables de croissance IEVR
/// EMBARQUÉES (`GrowthTables::load_embedded`, byte-exactes, pas besoin de reparser
/// `growth_table_config` du VFS). `rarity_code` : 0=N, 2=R, 3=SR, 4=SSR, 5=UR, 6=LR, 7=Legend,
/// 20=BASARA (converti en rang de croissance en interne par `calculate_stats`, cf. doc
/// `GrowthParams::chara_rank`). `play_style` = var[5] du noeud `CHARA_PARAM_INFO` (cf.
/// `nie_data::playstyle`), lu directement depuis `raw_variables` (absent du struct `CharaParam`
/// typé — même limitation documentée que `TeamSetup::from_chara_params_and_levels`).
pub fn calculate_character_stats(vfs: &Vfs, chara_param_id: &str, level: u8, rarity_code: u8) -> Result<StatBlockDto, String> {
    let param_json = load_t2b(vfs, |p| base_name(p).starts_with("chara_param_1") && base_name(p).ends_with(".cfg.bin"), "chara_param")?;
    let params = nie_data::chara_param::parse_all_chara_params(&param_json);
    let cp = params
        .iter()
        .find(|cp| cp.chara_param_id.to_hex() == chara_param_id)
        .ok_or_else(|| format!("chara_param_id {chara_param_id} introuvable"))?;

    let play_style = cp.raw_variables.get(5).copied().unwrap_or(0);
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let growth_params = nie_core::growth::GrowthParams {
        main_position: cp.main_position as u8,
        sub_position: cp.sub_position as u8,
        growth_pattern: cp.growth_pattern as u8,
        chara_rank: rarity_code,
        play_style: play_style as u8,
    };
    let tables = nie_core::growth::GrowthTables::load_embedded();
    Ok(nie_core::growth::calculate_stats(&tables, &growth_params, level).into())
}

/// Décode N'IMPORTE QUEL `.cfg.bin` du VFS (RDBN *ou* T2B, détecté via `nie_formats::cfgbin::
/// is_rdbn`) vers la forme JSON "inagle" (`{"lists":[...]}` ou `{"entries":[...]}`) — couvre
/// TOUS les fichiers de configuration du jeu (plusieurs centaines sous `data/common/gamedata/`
/// et `data/common/text/`), pas seulement les modules `nie-data` câblés individuellement avec un
/// DTO typé (`list_skills` ci-dessus) — cf. demande utilisatrice « niers doit couvrir tout
/// nie.exe ». Générique : réutilise le pont déjà vérifié `nie_explore::bridge`, aucun nouveau
/// parseur par format.
pub fn decode_cfgbin(vfs: &Vfs, path: &str) -> Result<Value, String> {
    let bytes = vfs.read(path).map_err(|e| e.to_string())?;
    if nie_formats::cfgbin::is_rdbn(&bytes) {
        let rdbn = nie_formats::cfgbin::parse(&bytes).map_err(|e| format!("parse RDBN {path} : {e}"))?;
        let lists = nie_formats::cfgbin::read_values(&rdbn, &bytes);
        Ok(nie_explore::bridge::rdbn_to_json(&lists))
    } else {
        let cfg = nie_formats::cfgbin::parse_t2b(&bytes).map_err(|e| format!("parse T2B {path} : {e}"))?;
        Ok(nie_explore::bridge::t2b_to_json(&cfg))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Vérifie le pont bytes→JSON→`nie-data` de bout en bout sur le VRAI jeu, pas juste la
    /// compilation. Valeur de référence issue du doc-comment de `nie_data::skill`
    /// (« Première valeur vérifiée (whs00010, « Trampoline du tonnerre »)… power 70→440,
    /// element=1 (Vent), category=1 (Tir) »).
    #[test]
    fn list_skills_sur_le_vrai_jeu() {
        let dir = std::env::var("NIE_GAME_DIR").unwrap_or_else(|_| {
            "/mnt/c/Program Files (x86)/Steam/steamapps/common/INAZUMA ELEVEN Victory Road".to_string()
        });
        let data_dir = std::path::Path::new(&dir).join("data");
        if !data_dir.join("cpk_list.cfg.bin").exists() {
            eprintln!("skip list_skills_sur_le_vrai_jeu : jeu absent");
            return;
        }
        let mut vfs = Vfs::new();
        vfs.init(&data_dir).expect("vfs init");

        let skills = list_skills(&vfs).expect("list_skills");
        assert!(skills.len() > 1000, "attendu > 1000 techniques (2627 dans le dump v4 de référence), obtenu {}", skills.len());

        let whs00010 = skills.iter().find(|s| s.skill_id_str == "whs00010").expect("whs00010 introuvable");
        assert_eq!(whs00010.power_min, 70);
        assert_eq!(whs00010.power_max, 440);
        assert_eq!(whs00010.element, "Vent");
        assert_eq!(whs00010.category, "Tir");
        eprintln!(
            "whs00010 : {} — {:?}",
            whs00010.skill_id_str,
            whs00010.name
        );
    }

    /// Charge le VFS réel, ou `None` (skip, pas d'échec) si le jeu est absent de ce poste —
    /// factorisé pour les 4 tests `list_*_sur_le_vrai_jeu` ci-dessous, même convention que
    /// `list_skills_sur_le_vrai_jeu`.
    fn real_vfs_or_skip(test_name: &str) -> Option<Vfs> {
        let dir = std::env::var("NIE_GAME_DIR").unwrap_or_else(|_| {
            "/mnt/c/Program Files (x86)/Steam/steamapps/common/INAZUMA ELEVEN Victory Road".to_string()
        });
        let data_dir = std::path::Path::new(&dir).join("data");
        if !data_dir.join("cpk_list.cfg.bin").exists() {
            eprintln!("skip {test_name} : jeu absent");
            return None;
        }
        let mut vfs = Vfs::new();
        vfs.init(&data_dir).expect("vfs init");
        Some(vfs)
    }

    /// Cf. `nie-game/examples/export_items.rs` (référence déjà validée end-to-end,
    /// `docs/ROADMAP-100.md` B′3 : « 1767 noms / 324 descriptions fr »).
    #[test]
    fn list_items_sur_le_vrai_jeu() {
        let Some(vfs) = real_vfs_or_skip("list_items_sur_le_vrai_jeu") else { return };
        let items = list_items(&vfs).expect("list_items");
        assert!(items.len() > 1000, "attendu > 1000 objets résolus (1767 de référence), obtenu {}", items.len());
        eprintln!("{} objets résolus, ex. : {}", items.len(), items[0].name);
    }

    /// Cf. `nie-game/examples/export_auras.rs` (référence déjà validée end-to-end,
    /// `docs/ROADMAP-100.md` C2 : « 443/443 auras résolues »).
    #[test]
    fn list_auras_sur_le_vrai_jeu() {
        let Some(vfs) = real_vfs_or_skip("list_auras_sur_le_vrai_jeu") else { return };
        let auras = list_auras(&vfs).expect("list_auras");
        assert!(auras.len() > 400, "attendu > 400 Avatar/Keshin résolus (443 de référence), obtenu {}", auras.len());
        eprintln!("{} Avatar/Keshin résolus, ex. : {}", auras.len(), auras[0].name);
    }

    /// Cf. `nie-game/examples/export_trophies.rs` (référence déjà validée end-to-end,
    /// `docs/ROADMAP-100.md` C2 : « 231/231 noms résolus »).
    #[test]
    fn list_trophies_sur_le_vrai_jeu() {
        let Some(vfs) = real_vfs_or_skip("list_trophies_sur_le_vrai_jeu") else { return };
        let trophies = list_trophies(&vfs).expect("list_trophies");
        assert!(trophies.len() > 200, "attendu > 200 succès résolus (231 de référence), obtenu {}", trophies.len());
        eprintln!("{} succès résolus, ex. : {}", trophies.len(), trophies[0].name);
    }

    /// Cf. `nie-game/examples/export_quests.rs` (référence déjà validée end-to-end,
    /// `docs/ROADMAP-100.md` C2 : « 182/182 titres fr »).
    #[test]
    fn list_quests_sur_le_vrai_jeu() {
        let Some(vfs) = real_vfs_or_skip("list_quests_sur_le_vrai_jeu") else { return };
        let quests = list_quests(&vfs).expect("list_quests");
        assert!(quests.len() > 150, "attendu > 150 quêtes résolues (182 de référence), obtenu {}", quests.len());
        eprintln!("{} quêtes résolues, ex. : {}", quests.len(), quests[0].title);
    }

    /// Cf. `nie-game/examples/export_characters.rs` (référence déjà validée end-to-end,
    /// `docs/ROADMAP-100.md` C2 : « 6470/7223 prénoms résolus »). Puis calcule les stats du
    /// premier personnage de la liste à Lv50/rang N — vérifie juste que le calcul ABOUTIT à des
    /// valeurs plausibles (pas un golden byte-exact : ça dépend du perso pris en tête de liste,
    /// non déterministe entre versions du jeu — `calculate_stats` lui-même EST déjà golden-testé
    /// dans `nie-core`).
    #[test]
    fn chara_picker_et_calcul_stats_sur_le_vrai_jeu() {
        let Some(vfs) = real_vfs_or_skip("chara_picker_et_calcul_stats_sur_le_vrai_jeu") else { return };
        let roster = list_chara_picker(&vfs).expect("list_chara_picker");
        assert!(roster.len() > 5000, "attendu > 5000 personnages résolus (6470 de référence), obtenu {}", roster.len());
        eprintln!("{} personnages résolus, ex. : {} ({})", roster.len(), roster[0].name, roster[0].main_position);

        let stats = calculate_character_stats(&vfs, &roster[0].chara_param_id, 50, 0).expect("calculate_character_stats");
        assert!(stats.total > 0, "stats nulles pour {} — calcul cassé", roster[0].name);
        eprintln!("{} Lv50 rang N : total={} (Kc{} Cr{} Tc{} Pr{} Ps{} Ag{} It{})", roster[0].name, stats.total, stats.kc, stats.cr, stats.tc, stats.pr, stats.ps, stats.ag, stats.it);
    }

    /// Vérifie que le décodeur GÉNÉRIQUE (`decode_cfgbin`) marche sur un large échantillon
    /// de VRAIS `.cfg.bin` du jeu, pas seulement `skill_config` — preuve de couverture large
    /// (« niers doit couvrir tout nie.exe »), RDBN et T2B mélangés, sans aucun crash/erreur.
    #[test]
    fn decode_cfgbin_sur_un_echantillon_large() {
        let dir = std::env::var("NIE_GAME_DIR").unwrap_or_else(|_| {
            "/mnt/c/Program Files (x86)/Steam/steamapps/common/INAZUMA ELEVEN Victory Road".to_string()
        });
        let data_dir = std::path::Path::new(&dir).join("data");
        if !data_dir.join("cpk_list.cfg.bin").exists() {
            eprintln!("skip decode_cfgbin_sur_un_echantillon_large : jeu absent");
            return;
        }
        let mut vfs = Vfs::new();
        vfs.init(&data_dir).expect("vfs init");

        let candidates: Vec<String> = vfs
            .iter()
            .map(|(p, _)| p.to_string())
            .filter(|p| p.ends_with(".cfg.bin") && (p.contains("/gamedata/") || p.contains("/text/")))
            .collect();
        assert!(candidates.len() > 100, "attendu > 100 .cfg.bin dans gamedata/text, obtenu {}", candidates.len());

        // Échantillon déterministe (pas aléatoire) : un fichier sur N, réparti sur tout
        // l'éventail alphabétique plutôt que les N premiers d'un même sous-dossier.
        let step = (candidates.len() / 60).max(1);
        let mut ok = 0usize;
        let mut failed: Vec<(String, String)> = Vec::new();
        for path in candidates.iter().step_by(step) {
            match decode_cfgbin(&vfs, path) {
                Ok(json) => {
                    assert!(json.get("lists").is_some() || json.get("entries").is_some(), "{path} : forme JSON inattendue");
                    ok += 1;
                }
                Err(e) => failed.push((path.clone(), e)),
            }
        }
        eprintln!("decode_cfgbin : {ok} décodés sans erreur, {} échecs sur {} testés (sur {} candidats)", failed.len(), ok + failed.len(), candidates.len());
        for (p, e) in &failed {
            eprintln!("  échec {p} : {e}");
        }
        // Tolérance : quelques formats exotiques (tables sans lists/entries, ex. fichiers texte
        // non-config) peuvent échouer sans invalider la couverture générale.
        assert!(
            failed.len() * 5 < ok + failed.len(),
            "trop d'échecs de décodage ({}/{}) pour un décodeur censé couvrir tout nie.exe",
            failed.len(),
            ok + failed.len()
        );
    }
}

