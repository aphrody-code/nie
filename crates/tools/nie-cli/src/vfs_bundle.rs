//! Deterministic initial browser bundle generated from a caller-owned game VFS.
//!
//! This module is public so native tools can reuse the selection and measurement logic without
//! invoking the CLI. It never embeds game bytes in the repository: bytes enter through
//! [`BundleSource`] and leave only in the returned `nie.vfs.bundle/v1` container.

use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{Context, anyhow, bail};
use clap::ValueEnum;
use serde::Serialize;
use sha2::{Digest, Sha256};

const COMPLETE_PLAYER_CODES: [&str; 5] = [
    "c01001900",
    "c01000010",
    "c02023290",
    "c02023370",
    "c02023380",
];
const APHRODY_PLAYER_CODE: &str = "c01001900";
const GOD_KNOWS_ID: &str = "whs00340";
const GOD_KNOWS_HASH: u32 = 0x1C8C_E2B8;
const PEGASUS_SOUL_ID: &str = "soul_0xF5FFD1E5";
const PEGASUS_SOUL_ASSET: &str = "wso000560";
const ARCH_PEGASUS_KESHIN_ID: &str = "keshin_0x62256EE2";
const ARCH_PEGASUS_KESHIN_ASSET: &str = "wks00330";
const APHRODY_CHANGE_MODE_ID: &str = "modechange_0x03D98821";
const APHRODY_CHANGE_MODE_ASSET: &str = "mode_change_c11150120";
const CHRONO_MODE_AWAKENING_ID: &str = "aura_0xA17C3D72";
const CHRONO_MODE_AWAKENING_ASSET: &str = "wap01005";
const BEST_ITEMS: [BestItemDef; 4] = [
    BestItemDef {
        category: "shoes",
        id: 0x68D5_15E4,
        asset_code: "eq_sh1106101",
        additive_bonus: 70,
    },
    BestItemDef {
        category: "misanga",
        id: 0xD0A5_B1F0,
        asset_code: "eq_mi0107901",
        additive_bonus: 70,
    },
    BestItemDef {
        category: "accessory",
        id: 0xAF89_CD7F,
        asset_code: "eq_ac0107401",
        additive_bonus: 70,
    },
    BestItemDef {
        category: "accessory",
        id: 0xB426_9BF5,
        asset_code: "eq_ac0104801",
        additive_bonus: 70,
    },
];
const SHIPPED_LOCALES: [&str; 9] = [
    "de", "en", "es", "fr", "it", "ja", "pt", "zh_hans", "zh_hant",
];

/// Read-only VFS surface needed by the generator and by synthetic tests.
pub trait BundleSource {
    fn paths(&self) -> Vec<String>;
    fn read(&self, path: &str) -> Result<Vec<u8>, String>;
}

impl BundleSource for nie_formats::vfs::Vfs {
    fn paths(&self) -> Vec<String> {
        self.iter().map(|(path, _)| path.to_owned()).collect()
    }

    fn read(&self, path: &str) -> Result<Vec<u8>, String> {
        self.read(path).map_err(|error| error.to_string())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ValueEnum)]
#[serde(rename_all = "snake_case")]
pub enum InitialBundleProfile {
    /// Existing broad profile retained for compatibility and non-critical deferred loading.
    Complete,
    /// Initial critical path centered on Aphrody and measured, explicitly selected content.
    #[value(name = "aphrody_lean")]
    AphrodyLean,
}

impl InitialBundleProfile {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Complete => "complete",
            Self::AphrodyLean => "aphrody_lean",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InitialBundleOptions {
    pub screen: String,
    pub locale: String,
    pub profile: InitialBundleProfile,
}

impl Default for InitialBundleOptions {
    fn default() -> Self {
        Self {
            screen: "main_menu".to_owned(),
            locale: "fr".to_owned(),
            profile: InitialBundleProfile::Complete,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectedFile {
    pub path: String,
    pub bytes: usize,
    pub crc32: u32,
    pub reasons: Vec<String>,
    pub categories: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryMeasurements {
    pub entries: usize,
    pub bytes: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSelection {
    pub category: String,
    pub id: String,
    pub asset_code: Option<String>,
    pub bundled_paths: Vec<String>,
    pub deferred_vfs_paths: Vec<String>,
    pub selection_rule: String,
    pub score: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleMeasurements {
    pub entries: usize,
    pub payload_bytes: usize,
    pub bundle_bytes: usize,
    pub menu_companions: usize,
    pub scripts: usize,
    pub player_assets: usize,
    pub categories: BTreeMap<String, CategoryMeasurements>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationReport {
    pub schema_version: u32,
    pub bundle_format: &'static str,
    pub screen: String,
    pub locale: String,
    pub profile: &'static str,
    pub sha256: String,
    pub main_script: String,
    pub loaded_include_names: Vec<String>,
    pub missing_include_names: Vec<String>,
    pub script_execution_error: Option<String>,
    pub profile_selections: Vec<ProfileSelection>,
    pub unranked_item_categories: Vec<String>,
    pub files: Vec<SelectedFile>,
    pub measurements: BundleMeasurements,
}

pub struct GeneratedBundle {
    pub bytes: Vec<u8>,
    pub report: GenerationReport,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveReference {
    pub id: String,
    pub url: String,
    pub sha256: String,
    pub bytes: usize,
    pub entries: usize,
    pub startup: bool,
    pub paths: Vec<String>,
}

/// Physically separate startup resources, the selected profile, tables and item atlases.
/// Shared startup dependencies win over cold classification and are never duplicated.
pub fn split_archives(bundle: &GeneratedBundle) -> anyhow::Result<BTreeMap<String, Vec<u8>>> {
    let parsed = nie_formats::preloaded_vfs::PreloadedVfsBundle::parse(&bundle.bytes)
        .map_err(anyhow::Error::msg)?;
    let assignments = bundle
        .report
        .files
        .iter()
        .map(|file| {
            let group = if file
                .categories
                .iter()
                .any(|category| category.starts_with("startup."))
            {
                "menu"
            } else if file
                .categories
                .iter()
                .any(|category| category == "cold.item_atlas")
            {
                "item_atlas"
            } else if file
                .categories
                .iter()
                .any(|category| category == "cold.native_table")
            {
                "native_tables"
            } else {
                "profile"
            };
            (file.path.clone(), group.to_owned())
        })
        .collect();
    parsed.partition(&assignments).map_err(anyhow::Error::msg)
}

/// Publish only into a new candidate directory. The manifest is written last.
pub fn write_split_archives(bundle: &GeneratedBundle, directory: &Path) -> anyhow::Result<()> {
    fs::create_dir(directory)
        .with_context(|| format!("create fresh bundle directory {}", directory.display()))?;
    let mut references = Vec::new();
    for (id, bytes) in split_archives(bundle)? {
        let parsed = nie_formats::preloaded_vfs::PreloadedVfsBundle::parse(&bytes)
            .map_err(anyhow::Error::msg)?;
        let sha256 = hex::encode(Sha256::digest(&bytes));
        let file_name = format!("{id}_{sha256}.nievfs");
        write_atomic(&directory.join(&file_name), &bytes)?;
        references.push(ArchiveReference {
            startup: id == "menu",
            id,
            url: format!("/static/game/vfs/{file_name}"),
            sha256,
            bytes: bytes.len(),
            entries: parsed.len(),
            paths: bundle
                .report
                .files
                .iter()
                .filter(|file| parsed.read(&file.path).is_some())
                .map(|file| file.path.clone())
                .collect(),
        });
    }
    let manifest = serde_json::json!({
        "schemaVersion": 1,
        "screen": bundle.report.screen,
        "locale": bundle.report.locale,
        "profile": bundle.report.profile,
        "sourceSha256": bundle.report.sha256,
        "archives": references,
    });
    write_atomic(
        &directory.join("manifest.json"),
        &serde_json::to_vec_pretty(&manifest)?,
    )
}

fn validate_options(options: &InitialBundleOptions) -> anyhow::Result<()> {
    if options.screen.is_empty()
        || options.screen.len() > 96
        || !options
            .screen
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
    {
        bail!("invalid menu screen: {}", options.screen);
    }
    if !SHIPPED_LOCALES.contains(&options.locale.as_str()) {
        bail!(
            "unsupported game locale: {} (expected {})",
            options.locale,
            SHIPPED_LOCALES.join(", ")
        );
    }
    Ok(())
}

fn is_locale_tag(value: &str) -> bool {
    SHIPPED_LOCALES.contains(&value)
}

fn parent_directory_name(path: &str) -> &str {
    path.rsplit_once('/')
        .and_then(|(directory, _)| directory.rsplit('/').next())
        .unwrap_or("")
}

fn companion_path(paths: &[String], logical: &str, locale: &str) -> Option<String> {
    let logical = logical
        .trim()
        .trim_start_matches('#')
        .trim_start_matches('/');
    if logical.is_empty() {
        return None;
    }
    let direct = if logical.starts_with("data/") {
        logical.to_owned()
    } else {
        format!("data/{logical}")
    };
    if paths.binary_search(&direct).is_ok() {
        return Some(direct);
    }
    if direct.contains("<LG>") {
        let localized = direct.replace("<LG>", locale);
        if paths.binary_search(&localized).is_ok() {
            return Some(localized);
        }
    }
    let basename = logical.rsplit('/').next()?;
    if basename.contains("<LG>") {
        return None;
    }
    let candidates: Vec<&String> = paths
        .iter()
        .filter(|path| {
            path.rsplit('/')
                .next()
                .is_some_and(|name| name.eq_ignore_ascii_case(basename))
        })
        .collect();
    candidates
        .iter()
        .find(|path| parent_directory_name(path) == locale)
        .or_else(|| {
            candidates
                .iter()
                .find(|path| !is_locale_tag(parent_directory_name(path)))
        })
        .or_else(|| {
            candidates
                .iter()
                .find(|path| parent_directory_name(path) == "common")
        })
        .or_else(|| {
            candidates
                .iter()
                .find(|path| parent_directory_name(path) == "en")
        })
        .or_else(|| candidates.first())
        .map(|path| (*path).clone())
}

fn add_reason(
    selected: &mut BTreeMap<String, BTreeSet<String>>,
    path: impl Into<String>,
    reason: impl Into<String>,
) {
    selected
        .entry(path.into())
        .or_default()
        .insert(reason.into());
}

fn category_for_reason(reason: &str) -> String {
    if reason == "menuSetting" || reason == "menuCompanionClosure" {
        "startup.menu".to_owned()
    } else if reason.starts_with("nativeFont") {
        "startup.font".to_owned()
    } else if reason == "localizedMenuText" {
        "startup.text".to_owned()
    } else if reason == "versionedScript" || reason == "runtimeIncludeClosure" {
        "startup.script".to_owned()
    } else if reason.starts_with("featuredPlayer:") {
        "profile.player".to_owned()
    } else if reason.starts_with("aphrodyLean:playerIndex:") {
        "profile.player_index".to_owned()
    } else if reason == "featuredPlayerData" {
        "profile.player_data".to_owned()
    } else if reason.starts_with("aphrodyLean:cold:nativeTable:") {
        "cold.native_table".to_owned()
    } else if reason.starts_with("aphrodyLean:cold:itemAtlas:") {
        "cold.item_atlas".to_owned()
    } else if reason.starts_with("aphrodyLean:skill:") {
        "profile.skill".to_owned()
    } else if reason.starts_with("aphrodyLean:soul:") {
        "profile.soul".to_owned()
    } else if reason.starts_with("aphrodyLean:keshin:") {
        "profile.keshin".to_owned()
    } else if reason.starts_with("aphrodyLean:changeMode:") {
        "profile.change_mode".to_owned()
    } else if reason.starts_with("aphrodyLean:awakening:") {
        "profile.awakening".to_owned()
    } else if let Some(category) = reason
        .strip_prefix("aphrodyLean:bestItem:")
        .and_then(|rest| rest.split(':').next())
    {
        format!("profile.item.{category}")
    } else {
        "profile.other".to_owned()
    }
}

fn categories_for_reasons(reasons: &BTreeSet<String>) -> Vec<String> {
    reasons
        .iter()
        .map(|reason| category_for_reason(reason))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn require_path(
    paths: &[String],
    selected: &mut BTreeMap<String, BTreeSet<String>>,
    path: &str,
    reason: &str,
) -> anyhow::Result<()> {
    if paths
        .binary_search_by(|candidate| candidate.as_str().cmp(path))
        .is_err()
    {
        bail!("required VFS path is absent: {path} ({reason})");
    }
    add_reason(selected, path, reason);
    Ok(())
}

#[derive(Clone, Copy)]
struct ProfileDescriptor {
    category: &'static str,
    id: &'static str,
    asset_code: Option<&'static str>,
    reason: &'static str,
}

fn latest_config_path(paths: &[String], directory: &str, stem: &str) -> anyhow::Result<String> {
    let prefix = format!("{directory}/{stem}_");
    let path = paths
        .iter()
        .filter(|path| {
            path.starts_with(&prefix)
                && path.ends_with(".cfg.bin")
                && !(stem == "chara_param" && path.contains("table_config"))
        })
        .max()
        .ok_or_else(|| anyhow!("versioned VFS config is absent: {prefix}*.cfg.bin"))?;
    Ok(path.clone())
}

fn select_aphrody_lean_profile(
    paths: &[String],
    selected: &mut BTreeMap<String, BTreeSet<String>>,
    locale: &str,
) -> anyhow::Result<Vec<ProfileDescriptor>> {
    const DESCRIPTORS: [ProfileDescriptor; 6] = [
        ProfileDescriptor {
            category: "player",
            id: APHRODY_PLAYER_CODE,
            asset_code: Some(APHRODY_PLAYER_CODE),
            reason: "featuredPlayer:c01001900",
        },
        ProfileDescriptor {
            category: "skill",
            id: GOD_KNOWS_ID,
            asset_code: Some(GOD_KNOWS_ID),
            reason: "aphrodyLean:skill:whs00340",
        },
        ProfileDescriptor {
            category: "soul",
            id: PEGASUS_SOUL_ID,
            asset_code: Some(PEGASUS_SOUL_ASSET),
            reason: "aphrodyLean:soul:soul_0xF5FFD1E5",
        },
        ProfileDescriptor {
            category: "keshin",
            id: ARCH_PEGASUS_KESHIN_ID,
            asset_code: Some(ARCH_PEGASUS_KESHIN_ASSET),
            reason: "aphrodyLean:keshin:keshin_0x62256EE2",
        },
        ProfileDescriptor {
            category: "change_mode",
            id: APHRODY_CHANGE_MODE_ID,
            asset_code: Some(APHRODY_CHANGE_MODE_ASSET),
            reason: "aphrodyLean:changeMode:modechange_0x03D98821",
        },
        ProfileDescriptor {
            category: "awakening",
            id: CHRONO_MODE_AWAKENING_ID,
            asset_code: Some(CHRONO_MODE_AWAKENING_ASSET),
            reason: "aphrodyLean:awakening:aura_0xA17C3D72",
        },
    ];

    let localized = |stem: &str| format!("data/dx11/menu/220_img/telop_waza/{locale}/{stem}.g4tx");
    let selections: [(&str, Vec<String>); 5] = [
        (
            DESCRIPTORS[1].reason,
            vec![
                "data/common/gamedata/menu/obj/soccer10_01_whs00340.objbin".to_owned(),
                localized("whs00340"),
            ],
        ),
        (
            DESCRIPTORS[2].reason,
            vec![
                "data/common/chr/_waza/a000560/a000560.g4mg".to_owned(),
                "data/common/chr/_waza/a000560/a000560.g4pkm".to_owned(),
                "data/common/chr/_waza/a000560/a000560.objbin".to_owned(),
                "data/dx11/chr/_waza/a000560/a000560.g4tx".to_owned(),
                "data/dx11/menu/200_icon/10_icon_chr/aura_soul/a000560_l.g4tx".to_owned(),
                "data/dx11/menu/220_img/soul_effect/ef_wso000560.g4tx".to_owned(),
                "data/common/gamedata/menu/obj/soccer10_01_a000560.objbin".to_owned(),
                localized("a000560"),
                "data/common/gamedata/menu/obj/soccer10_01_who01390_a000560.objbin".to_owned(),
                localized("who01390_a000560"),
            ],
        ),
        (
            DESCRIPTORS[3].reason,
            vec![
                "data/common/chr/_keshin/k000330/k000330.g4mg".to_owned(),
                "data/common/chr/_keshin/k000330/k000330.g4pkm".to_owned(),
                "data/common/chr/_keshin/k000330/k000330.objbin".to_owned(),
                "data/common/chr/_keshin/k000330/k000330_p010.g4pk".to_owned(),
                "data/dx11/chr/_keshin/k000330/k000330.g4tx".to_owned(),
                "data/dx11/menu/200_icon/10_icon_chr/aura_fs/k000330_l.g4tx".to_owned(),
                "data/common/gamedata/menu/obj/soccer10_01_k000330.objbin".to_owned(),
                localized("k000330"),
                "data/common/gamedata/menu/obj/soccer10_01_whs01820.objbin".to_owned(),
                localized("whs01820"),
            ],
        ),
        (
            DESCRIPTORS[4].reason,
            vec![
                "data/common/gamedata/menu/obj/soccer10_01_mode_change_c11150120.objbin".to_owned(),
                localized("mode_change_c11150120"),
                "data/common/chr/_face/11_VICTORY/c11150120/c11150120.g4md".to_owned(),
                "data/common/chr/_face/11_VICTORY/c11150120/c11150120.g4mg".to_owned(),
                "data/dx11/chr/_face/11_VICTORY/c11150120/c11150120.g4tx".to_owned(),
                "data/dx11/menu/200_icon/10_icon_chr/face/c11150120_l.g4tx".to_owned(),
            ],
        ),
        (
            DESCRIPTORS[5].reason,
            vec![
                "data/common/gamedata/menu/obj/soccer10_01_aura_power_wap01005.objbin".to_owned(),
                localized("aura_power_wap01005"),
            ],
        ),
    ];
    for (reason, selected_paths) in selections {
        for path in selected_paths {
            require_path(paths, selected, &path, reason)?;
        }
    }

    Ok(DESCRIPTORS.to_vec())
}

fn profile_selections(
    selected: &BTreeMap<String, BTreeSet<String>>,
    descriptors: &[ProfileDescriptor],
) -> Vec<ProfileSelection> {
    descriptors
        .iter()
        .map(|descriptor| ProfileSelection {
            category: descriptor.category.to_owned(),
            id: descriptor.id.to_owned(),
            asset_code: descriptor.asset_code.map(str::to_owned),
            bundled_paths: selected
                .iter()
                .filter(|(_, reasons)| reasons.contains(descriptor.reason))
                .map(|(path, _)| path.clone())
                .collect(),
            deferred_vfs_paths: Vec::new(),
            selection_rule: "measured_exact_id".to_owned(),
            score: None,
        })
        .collect()
}

fn read_cfg_json<S: BundleSource>(source: &S, path: &str) -> anyhow::Result<serde_json::Value> {
    let bytes = source.read(path).map_err(anyhow::Error::msg)?;
    nie_formats::cfgbin::to_iecode_json(&bytes)
        .ok_or_else(|| anyhow!("VFS config is not a decodable cfg.bin: {path}"))
}

fn deferred_existing_path(paths: &[String], path: String) -> anyhow::Result<String> {
    if paths.binary_search(&path).is_err() {
        bail!("deferred VFS dependency is absent: {path}");
    }
    Ok(path)
}

fn raw_profile_hash(id: &str) -> anyhow::Result<nie_data::hash::HashId> {
    let raw = id.rsplit('_').next().unwrap_or(id);
    nie_data::hash::HashId::parse(raw).ok_or_else(|| anyhow!("invalid measured profile ID: {id}"))
}

fn find_item_atlases<S: BundleSource>(
    source: &S,
    paths: &[String],
    codes: &BTreeSet<String>,
) -> anyhow::Result<BTreeMap<String, Vec<String>>> {
    let mut by_code = codes
        .iter()
        .map(|code| (code.clone(), Vec::new()))
        .collect::<BTreeMap<_, _>>();
    for path in paths.iter().filter(|path| {
        path.starts_with("data/dx11/menu/200_icon/02_icon_item/") && path.ends_with(".g4tx")
    }) {
        let bytes = source.read(path).map_err(anyhow::Error::msg)?;
        let atlas = nie_formats::g4tx::parse(&bytes)
            .map_err(|error| anyhow!("invalid item icon atlas {path}: {error}"))?;
        for code in codes {
            if atlas.named(code).is_some() {
                by_code.entry(code.clone()).or_default().push(path.clone());
            }
        }
    }
    let missing: Vec<_> = by_code
        .iter()
        .filter(|(_, atlas_paths)| atlas_paths.is_empty())
        .map(|(code, _)| code.clone())
        .collect();
    if !missing.is_empty() {
        bail!(
            "native item icon atlas is absent for asset codes: {}",
            missing.join(", ")
        );
    }
    Ok(by_code)
}

#[derive(Clone, Copy)]
struct BestItemDef {
    category: &'static str,
    id: u32,
    asset_code: &'static str,
    additive_bonus: i64,
}

struct MeasuredBestItem<'a> {
    definition: BestItemDef,
    item: &'a nie_data::item::ItemInfo,
}

fn measured_best_items(
    items: &[nie_data::item::ItemInfo],
) -> anyhow::Result<(Vec<MeasuredBestItem<'_>>, Vec<String>)> {
    let ranked_categories = ["shoes", "misanga", "accessory"];
    let mut unranked_categories: Vec<String> = items
        .iter()
        .map(|item| item.category.as_str().to_owned())
        .filter(|category| !ranked_categories.contains(&category.as_str()))
        .collect();
    unranked_categories.sort_unstable();
    unranked_categories.dedup();

    let mut winners = Vec::with_capacity(BEST_ITEMS.len());
    for definition in BEST_ITEMS {
        let item = items
            .iter()
            .find(|item| item.item_id.get() == definition.id)
            .ok_or_else(|| anyhow!("measured best item is absent: 0x{:08X}", definition.id))?;
        if item.category.as_str() != definition.category
            || item.internal_code.as_deref() != Some(definition.asset_code)
        {
            bail!(
                "measured best item drift for 0x{:08X}: expected {}/{}, got {}/{:?}",
                definition.id,
                definition.category,
                definition.asset_code,
                item.category.as_str(),
                item.internal_code
            );
        }
        winners.push(MeasuredBestItem { definition, item });
    }
    Ok((winners, unranked_categories))
}

fn enrich_aphrody_profile<S: BundleSource>(
    source: &S,
    paths: &[String],
    selected: &mut BTreeMap<String, BTreeSet<String>>,
    descriptors: &[ProfileDescriptor],
    locale: &str,
) -> anyhow::Result<(Vec<ProfileSelection>, Vec<String>)> {
    let skill_config = latest_config_path(paths, "data/common/gamedata/skill", "skill_config")?;
    let aura_config = latest_config_path(paths, "data/common/gamedata/skill", "aura_skill_config")?;
    let item_config = latest_config_path(paths, "data/common/gamedata/item", "item_config")?;
    let chara_config = latest_config_path(paths, "data/common/gamedata/character", "chara_param")?;
    let skill_text = deferred_existing_path(
        paths,
        format!("data/common/text/{locale}/skill_text.cfg.bin"),
    )?;
    let item_text = deferred_existing_path(
        paths,
        format!("data/common/text/{locale}/item_text.cfg.bin"),
    )?;

    let skills = nie_data::skill::parse_skill_config(&read_cfg_json(source, &skill_config)?);
    let god_knows = skills
        .iter()
        .find(|skill| skill.skill_id_str == GOD_KNOWS_ID)
        .ok_or_else(|| anyhow!("God Knows is absent from {skill_config}"))?;
    if god_knows.skill_id.get() != GOD_KNOWS_HASH {
        bail!(
            "God Knows ID drift: expected 0x{GOD_KNOWS_HASH:08X}, got {}",
            god_knows.skill_id
        );
    }
    for path in [&skill_config, &skill_text] {
        add_reason(selected, path, descriptors[1].reason);
        add_reason(selected, path, "aphrodyLean:cold:nativeTable:skill");
    }

    let auras = nie_data::aura::parse_all_aura_cmds(&read_cfg_json(source, &aura_config)?);
    for descriptor in &descriptors[2..] {
        let aura_id = raw_profile_hash(descriptor.id)?;
        let aura = auras
            .iter()
            .find(|aura| aura.aura_id == aura_id)
            .ok_or_else(|| {
                anyhow!(
                    "measured aura is absent from {aura_config}: {}",
                    descriptor.id
                )
            })?;
        if descriptor.asset_code != Some(aura.asset_code.as_str()) {
            bail!(
                "measured aura asset drift for {}: expected {:?}, got {}",
                descriptor.id,
                descriptor.asset_code,
                aura.asset_code
            );
        }
        for path in [&aura_config, &item_config, &item_text] {
            add_reason(selected, path, descriptor.reason);
            add_reason(selected, path, "aphrodyLean:cold:nativeTable:aura_item");
        }
    }
    add_reason(selected, &chara_config, "aphrodyLean:playerIndex:c01001900");
    add_reason(
        selected,
        &chara_config,
        "aphrodyLean:cold:nativeTable:chara",
    );

    let items = nie_data::item::parse_all_items(&read_cfg_json(source, &item_config)?);
    let (winners, unranked_categories) = measured_best_items(&items)?;
    let winner_codes: BTreeSet<String> = winners
        .iter()
        .map(|winner| winner.definition.asset_code.to_owned())
        .collect();
    let item_atlases = find_item_atlases(source, paths, &winner_codes)?;
    let mut selections = profile_selections(selected, descriptors);
    let player = selections
        .iter_mut()
        .find(|selection| selection.id == APHRODY_PLAYER_CODE)
        .ok_or_else(|| anyhow!("Aphrody player profile descriptor is absent"))?;
    player.bundled_paths.push(chara_config);
    for winner in winners {
        let asset_code = winner.definition.asset_code;
        let reason = format!(
            "aphrodyLean:bestItem:{}:{}",
            winner.definition.category,
            winner.item.item_id.to_hex()
        );
        let mut bundled_paths = vec![item_config.clone(), item_text.clone()];
        bundled_paths.extend(item_atlases[asset_code].clone());
        bundled_paths.sort_unstable();
        bundled_paths.dedup();
        for path in &bundled_paths {
            add_reason(selected, path, &reason);
            if path.contains("/200_icon/02_icon_item/") {
                add_reason(
                    selected,
                    path,
                    format!("aphrodyLean:cold:itemAtlas:{asset_code}"),
                );
            } else {
                add_reason(selected, path, "aphrodyLean:cold:nativeTable:item");
            }
        }
        selections.push(ProfileSelection {
            category: format!("item.{}", winner.definition.category),
            id: winner.item.item_id.to_hex(),
            asset_code: Some(asset_code.to_owned()),
            bundled_paths,
            deferred_vfs_paths: Vec::new(),
            selection_rule: "measured_max_additive_bonus_keep_all_ties".to_owned(),
            score: Some(winner.definition.additive_bonus),
        });
    }
    selections.sort_by(|left, right| {
        left.category
            .cmp(&right.category)
            .then_with(|| left.id.cmp(&right.id))
    });
    Ok((selections, unranked_categories))
}

fn initial_plan_exact_paths(
    options: &InitialBundleOptions,
) -> anyhow::Result<Vec<(String, String)>> {
    let plan_json = nie_formats::preloaded_vfs::startup_plan_json(&options.locale)
        .map_err(anyhow::Error::msg)?;
    let plan: serde_json::Value =
        serde_json::from_str(&plan_json).context("decode shared initial VFS plan")?;
    if plan["bundleFormat"] != "nie.vfs.bundle/v1" {
        bail!("shared initial VFS plan has an unsupported bundle format");
    }
    let planned_screen = plan["startupScreen"]
        .as_str()
        .ok_or_else(|| anyhow!("shared initial VFS plan has no startup screen"))?;
    let planned_setting = format!("data/common/gamedata/menu/cfg/{planned_screen}_setting.cfg.bin");
    let requested_setting = format!(
        "data/common/gamedata/menu/cfg/{}_setting.cfg.bin",
        options.screen
    );
    plan["exactPaths"]
        .as_array()
        .ok_or_else(|| anyhow!("shared initial VFS plan has no exact paths"))?
        .iter()
        .map(|value| {
            let planned_path = value
                .as_str()
                .ok_or_else(|| anyhow!("shared initial VFS plan contains a non-string path"))?;
            let path = if planned_path == planned_setting {
                requested_setting.clone()
            } else {
                planned_path.to_owned()
            };
            let reason = if planned_path == planned_setting {
                "menuSetting"
            } else if planned_path.contains("/font/") && planned_path.ends_with("font.cfg.bin") {
                "nativeFontMetrics"
            } else if planned_path.ends_with("font_color.cfg.bin") {
                "nativeFontPalette"
            } else if planned_path.ends_with("font.g4tx") {
                "nativeFontAtlas"
            } else if planned_path.ends_with("menu_text.cfg.bin") {
                "localizedMenuText"
            } else {
                "initialVfsPlan"
            };
            Ok((path, reason.to_owned()))
        })
        .collect()
}

fn select_menu_companions<S: BundleSource>(
    source: &S,
    paths: &[String],
    selected: &mut BTreeMap<String, BTreeSet<String>>,
    setting_path: &str,
    locale: &str,
) -> anyhow::Result<usize> {
    let setting_bytes = source.read(setting_path).map_err(anyhow::Error::msg)?;
    let root = nie_formats::cfgbin::to_iecode_json(&setting_bytes)
        .ok_or_else(|| anyhow!("menu setting is not a decodable cfg.bin: {setting_path}"))?;
    let setting = nie_data::menu_setting::parse(&root);
    let mut companions = BTreeSet::new();

    for resource in setting.resources {
        let resolved = companion_path(paths, &resource.logical_path, locale).ok_or_else(|| {
            anyhow!(
                "menu resource companion is absent: {}",
                resource.logical_path
            )
        })?;
        companions.insert(resolved);
    }
    for layer in setting.layers {
        let objbin_path = companion_path(paths, &layer.objbin_path, locale)
            .ok_or_else(|| anyhow!("menu layer objbin is absent: {}", layer.objbin_path))?;
        let objbin_bytes = source.read(&objbin_path).map_err(anyhow::Error::msg)?;
        let object = nie_formats::objbin::parse(&objbin_bytes)
            .map_err(|error| anyhow!("invalid menu objbin {objbin_path}: {error}"))?;
        companions.insert(objbin_path);
        for logical in [object.g4pkm_path.as_deref(), object.g4tx_path.as_deref()]
            .into_iter()
            .flatten()
        {
            let resolved = companion_path(paths, logical, locale)
                .ok_or_else(|| anyhow!("menu object companion is absent: {logical}"))?;
            companions.insert(resolved);
        }
    }
    let count = companions.len();
    for path in companions {
        add_reason(selected, path, "menuCompanionClosure");
    }
    Ok(count)
}

struct ScriptSelection {
    main_script: String,
    loaded_include_names: Vec<String>,
    missing_include_names: Vec<String>,
    execution_error: Option<String>,
}

fn select_scripts<S: BundleSource>(
    source: &S,
    paths: &[String],
    selected: &mut BTreeMap<String, BTreeSet<String>>,
    screen: &str,
) -> anyhow::Result<ScriptSelection> {
    let script_paths: Vec<String> = paths
        .iter()
        .filter(|path| path.starts_with("data/common/script/lua/") && path.ends_with(".lua.bin"))
        .cloned()
        .collect();
    let (by_name, by_logical) =
        nie_lua::index_script_paths(script_paths.iter().map(String::as_str));
    let main_script = nie_lua::resolve_script_path(screen, &by_name, &by_logical)
        .cloned()
        .ok_or_else(|| anyhow!("versioned Lua script is absent for screen: {screen}"))?;
    add_reason(selected, &main_script, "versionedScript");

    let mut script_bytes = BTreeMap::new();
    for path in &script_paths {
        script_bytes.insert(path.clone(), source.read(path).map_err(anyhow::Error::msg)?);
    }
    let script_bytes = Arc::new(script_bytes);
    let main_bytes = script_bytes
        .get(&main_script)
        .cloned()
        .ok_or_else(|| anyhow!("resolved main script could not be read: {main_script}"))?;
    let reader_bytes = Arc::clone(&script_bytes);
    let output = nie_lua::runtime::execute_with_script_paths(
        &main_bytes,
        &nie_lua::runtime::ExecOptions {
            chunk_name: main_script.clone(),
            instruction_limit: Some(20_000_000),
            with_menu_host: true,
            ..Default::default()
        },
        script_paths,
        move |path| reader_bytes.get(path).cloned(),
    )
    .map_err(|error| anyhow!("Lua include discovery failed: {error}"))?;
    let mut loaded_names = output.loaded_includes;
    loaded_names.sort_unstable();
    loaded_names.dedup();
    for name in &loaded_names {
        let path = nie_lua::resolve_script_path(name, &by_name, &by_logical)
            .ok_or_else(|| anyhow!("loaded include no longer resolves: {name}"))?;
        add_reason(selected, path, "runtimeIncludeClosure");
    }
    Ok(ScriptSelection {
        main_script,
        loaded_include_names: loaded_names,
        missing_include_names: output.missing_includes,
        execution_error: output.error,
    })
}

fn select_player_assets(
    paths: &[String],
    selected: &mut BTreeMap<String, BTreeSet<String>>,
    player_codes: &[&str],
    include_native_table: bool,
) -> anyhow::Result<usize> {
    let mut matched_codes = BTreeSet::new();
    let mut count = 0;
    for path in paths {
        let Some(code) = player_codes.iter().find(|code| path.contains(**code)) else {
            continue;
        };
        let file_name = path.rsplit('/').next().unwrap_or("");
        let is_face = path.contains("/chr/_face/")
            && ["g4md", "g4mg", "g4tx"]
                .iter()
                .any(|extension| file_name == format!("{code}.{extension}"));
        let is_icon = path.contains("/menu/200_icon/10_icon_chr/face/")
            && path.ends_with(&format!("{code}_l.g4tx"));
        if is_face || is_icon {
            matched_codes.insert(*code);
            add_reason(selected, path, format!("featuredPlayer:{code}"));
            count += 1;
        }
    }
    let missing: Vec<_> = player_codes
        .iter()
        .filter(|code| !matched_codes.contains(**code))
        .copied()
        .collect();
    if !missing.is_empty() {
        bail!(
            "featured player assets are absent for: {}",
            missing.join(", ")
        );
    }
    if include_native_table {
        for path in paths.iter().filter(|path| {
            path.starts_with("data/common/gamedata/character/chara_param_")
                && path.ends_with(".cfg.bin")
                && !path.contains("table_config")
        }) {
            add_reason(selected, path, "featuredPlayerData");
        }
    }
    Ok(count)
}

/// Select, read, measure and pack the initial browser VFS from a licensed local source.
pub fn generate<S: BundleSource>(
    source: &S,
    options: &InitialBundleOptions,
) -> anyhow::Result<GeneratedBundle> {
    validate_options(options)?;
    let mut paths = source.paths();
    paths.sort_unstable();
    paths.dedup();
    let mut selected = BTreeMap::<String, BTreeSet<String>>::new();
    let setting_path = format!(
        "data/common/gamedata/menu/cfg/{}_setting.cfg.bin",
        options.screen
    );
    for (path, reason) in initial_plan_exact_paths(options)? {
        require_path(&paths, &mut selected, &path, &reason)?;
    }
    let menu_companions = select_menu_companions(
        source,
        &paths,
        &mut selected,
        &setting_path,
        &options.locale,
    )?;
    let script_selection = select_scripts(source, &paths, &mut selected, &options.screen)?;
    if !script_selection.missing_include_names.is_empty() {
        bail!(
            "initial Lua include closure is incomplete: {}",
            script_selection.missing_include_names.join(", ")
        );
    }
    let lean_descriptors = if options.profile == InitialBundleProfile::AphrodyLean {
        Some(select_aphrody_lean_profile(
            &paths,
            &mut selected,
            &options.locale,
        )?)
    } else {
        None
    };
    let player_codes: &[&str] = match options.profile {
        InitialBundleProfile::Complete => &COMPLETE_PLAYER_CODES,
        InitialBundleProfile::AphrodyLean => &[APHRODY_PLAYER_CODE],
    };
    let player_assets = select_player_assets(
        &paths,
        &mut selected,
        player_codes,
        options.profile == InitialBundleProfile::Complete,
    )?;
    let (profile_selections, unranked_item_categories) = if let Some(descriptors) = lean_descriptors
    {
        enrich_aphrody_profile(source, &paths, &mut selected, &descriptors, &options.locale)?
    } else {
        (Vec::new(), Vec::new())
    };

    let mut files = Vec::with_capacity(selected.len());
    let mut manifest_files = Vec::with_capacity(selected.len());
    let mut payload_bytes = 0_usize;
    let mut scripts = 0_usize;
    let mut category_measurements = BTreeMap::<String, CategoryMeasurements>::new();
    for (path, reasons) in selected {
        let bytes = source
            .read(&path)
            .map_err(anyhow::Error::msg)
            .with_context(|| format!("read selected VFS path {path}"))?;
        payload_bytes = payload_bytes
            .checked_add(bytes.len())
            .ok_or_else(|| anyhow!("selected VFS payload size overflow"))?;
        scripts += usize::from(path.ends_with(".lua.bin"));
        let categories = categories_for_reasons(&reasons);
        for category in &categories {
            let measurement = category_measurements.entry(category.clone()).or_default();
            measurement.entries += 1;
            measurement.bytes = measurement
                .bytes
                .checked_add(bytes.len())
                .ok_or_else(|| anyhow!("category payload size overflow: {category}"))?;
        }
        manifest_files.push(SelectedFile {
            path: path.clone(),
            bytes: bytes.len(),
            crc32: nie_formats::cfgbin::crc32(&bytes),
            reasons: reasons.into_iter().collect(),
            categories,
        });
        files.push((path, bytes));
    }
    let bundle = nie_formats::preloaded_vfs::pack(files).map_err(anyhow::Error::msg)?;
    let sha256 = hex::encode(Sha256::digest(&bundle));
    let report = GenerationReport {
        schema_version: 1,
        bundle_format: "nie.vfs.bundle/v1",
        screen: options.screen.clone(),
        locale: options.locale.clone(),
        profile: options.profile.as_str(),
        sha256,
        main_script: script_selection.main_script,
        loaded_include_names: script_selection.loaded_include_names,
        missing_include_names: script_selection.missing_include_names,
        script_execution_error: script_selection.execution_error,
        profile_selections,
        unranked_item_categories,
        measurements: BundleMeasurements {
            entries: manifest_files.len(),
            payload_bytes,
            bundle_bytes: bundle.len(),
            menu_companions,
            scripts,
            player_assets,
            categories: category_measurements,
        },
        files: manifest_files,
    };
    Ok(GeneratedBundle {
        bytes: bundle,
        report,
    })
}

/// Write one artifact through a unique sibling temporary file and an atomic rename.
/// Existing destinations are refused so no generated or user-owned bundle is overwritten.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> anyhow::Result<()> {
    if path.exists() {
        bail!("refusing to overwrite existing output: {}", path.display());
    }
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)
        .with_context(|| format!("create output directory {}", parent.display()))?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| anyhow!("output path has no UTF-8 file name: {}", path.display()))?;
    let temporary = parent.join(format!(".{file_name}.{}.tmp", std::process::id()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .with_context(|| format!("create temporary output {}", temporary.display()))?;
        file.write_all(bytes)
            .with_context(|| format!("write temporary output {}", temporary.display()))?;
        file.sync_all()
            .with_context(|| format!("sync temporary output {}", temporary.display()))?;
        fs::rename(&temporary, path).with_context(|| {
            format!(
                "atomically publish {} as {}",
                temporary.display(),
                path.display()
            )
        })
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

pub fn default_manifest_path(bundle_path: &Path) -> PathBuf {
    let name = bundle_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("initial-vfs.bundle");
    bundle_path.with_file_name(format!("{name}.manifest.json"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use nie_data::hash::HashId;
    use nie_data::item::{ItemCategory, ItemInfo, ItemStats};

    fn split_fixture() -> GeneratedBundle {
        let definitions = [
            ("data/menu", vec!["startup.font", "cold.item_atlas"]),
            ("data/atlas", vec!["cold.item_atlas"]),
            ("data/table", vec!["cold.native_table"]),
            ("data/player", vec!["profile.player"]),
        ];
        let files: Vec<_> = definitions
            .iter()
            .enumerate()
            .map(|(index, (path, categories))| SelectedFile {
                path: (*path).to_owned(),
                bytes: 1,
                crc32: nie_formats::cfgbin::crc32(&[index as u8]),
                reasons: Vec::new(),
                categories: categories
                    .iter()
                    .map(|category| (*category).to_owned())
                    .collect(),
            })
            .collect();
        let bytes = nie_formats::preloaded_vfs::pack(
            definitions
                .iter()
                .enumerate()
                .map(|(index, (path, _))| ((*path).to_owned(), vec![index as u8]))
                .collect(),
        )
        .unwrap();
        GeneratedBundle {
            report: GenerationReport {
                schema_version: 1,
                bundle_format: "nie.vfs.bundle/v1",
                screen: "main_menu".into(),
                locale: "fr".into(),
                profile: "aphrody_lean",
                sha256: hex::encode(Sha256::digest(&bytes)),
                main_script: String::new(),
                loaded_include_names: Vec::new(),
                missing_include_names: Vec::new(),
                script_execution_error: None,
                profile_selections: Vec::new(),
                unranked_item_categories: Vec::new(),
                measurements: BundleMeasurements {
                    entries: 4,
                    payload_bytes: 4,
                    bundle_bytes: bytes.len(),
                    menu_companions: 0,
                    scripts: 0,
                    player_assets: 1,
                    categories: BTreeMap::new(),
                },
                files,
            },
            bytes,
        }
    }

    #[test]
    fn archive_split_keeps_startup_priority_and_exact_disjoint_payloads() {
        let fixture = split_fixture();
        let archives = split_archives(&fixture).unwrap();
        assert_eq!(archives.len(), 4);
        assert_eq!(split_archives(&fixture).unwrap(), archives);
        let mut entries = 0;
        for (id, path, value) in [
            ("menu", "data/menu", 0),
            ("item_atlas", "data/atlas", 1),
            ("native_tables", "data/table", 2),
            ("profile", "data/player", 3),
        ] {
            let archive =
                nie_formats::preloaded_vfs::PreloadedVfsBundle::parse(&archives[id]).unwrap();
            assert_eq!(archive.len(), 1);
            assert_eq!(archive.read(path), Some(&[value][..]));
            for file in &fixture.report.files {
                assert_eq!(archive.read(&file.path).is_some(), file.path == path);
            }
            entries += archive.len();
        }
        assert_eq!(entries, fixture.report.files.len());
    }

    #[test]
    fn archive_split_rejects_incomplete_metadata_and_corrupt_bytes() {
        let mut fixture = split_fixture();
        fixture.report.files.pop();
        assert!(split_archives(&fixture).is_err());
        let mut fixture = split_fixture();
        fixture.report.files[0].path = "data/unknown".to_owned();
        assert!(split_archives(&fixture).is_err());
        let mut fixture = split_fixture();
        *fixture.bytes.last_mut().unwrap() ^= 1;
        assert!(split_archives(&fixture).is_err());
    }

    #[derive(Default)]
    struct SyntheticSource(BTreeMap<String, Vec<u8>>);

    impl BundleSource for SyntheticSource {
        fn paths(&self) -> Vec<String> {
            self.0.keys().cloned().collect()
        }

        fn read(&self, path: &str) -> Result<Vec<u8>, String> {
            self.0
                .get(path)
                .cloned()
                .ok_or_else(|| format!("missing: {path}"))
        }
    }

    #[test]
    fn companion_resolution_is_locale_aware_and_deterministic() {
        let paths = vec![
            "data/dx11/menu/en/icon.g4tx".to_owned(),
            "data/dx11/menu/fr/icon.g4tx".to_owned(),
            "data/dx11/menu/icon.g4tx".to_owned(),
        ];
        assert_eq!(
            companion_path(&paths, "dx11/menu/<LG>/icon.g4tx", "fr").as_deref(),
            Some("data/dx11/menu/fr/icon.g4tx")
        );
        assert_eq!(
            companion_path(&paths, "unknown/icon.g4tx", "ja").as_deref(),
            Some("data/dx11/menu/icon.g4tx")
        );
    }

    #[test]
    fn exact_inputs_come_from_the_shared_startup_plan() {
        let options = InitialBundleOptions {
            screen: "chara_edit_menu".to_owned(),
            locale: "ja".to_owned(),
            profile: InitialBundleProfile::Complete,
        };
        let paths = initial_plan_exact_paths(&options).unwrap();
        assert_eq!(paths.len(), 5);
        assert!(paths.iter().any(|(path, reason)| {
            path == "data/common/gamedata/menu/cfg/chara_edit_menu_setting.cfg.bin"
                && reason == "menuSetting"
        }));
        assert!(paths.iter().any(|(path, reason)| {
            path == "data/common/text/ja/menu_text.cfg.bin" && reason == "localizedMenuText"
        }));
        assert!(!paths.iter().any(|(path, _)| path.contains("main_menu")));
    }

    #[test]
    fn script_selection_follows_runtime_include_resolution() {
        let mut source = SyntheticSource::default();
        source.0.insert(
            "data/common/script/lua/menu/main_menu_1.00.00.lua.bin".to_owned(),
            br#"INCLUDE('LUA_SHARED_INC'); started = shared_value"#.to_vec(),
        );
        source.0.insert(
            "data/common/script/lua/menu/shared_inc_2.00.00.lua.bin".to_owned(),
            b"shared_value = 7".to_vec(),
        );
        let paths = source.paths();
        let mut selected = BTreeMap::new();
        let selection = select_scripts(&source, &paths, &mut selected, "main_menu").unwrap();
        assert_eq!(
            selection.main_script,
            "data/common/script/lua/menu/main_menu_1.00.00.lua.bin"
        );
        assert_eq!(selection.loaded_include_names, ["LUA_SHARED_INC"]);
        assert!(selection.missing_include_names.is_empty());
        assert!(selection.execution_error.is_none());
        assert!(selected.contains_key("data/common/script/lua/menu/shared_inc_2.00.00.lua.bin"));
    }

    #[test]
    fn player_selection_keeps_canonical_variants_and_icons_only() {
        let mut paths = Vec::new();
        for code in COMPLETE_PLAYER_CODES {
            paths.push(format!("data/dx11/chr/_face/test/{code}/{code}.g4tx"));
            paths.push(format!(
                "data/dx11/menu/200_icon/10_icon_chr/face/{code}_l.g4tx"
            ));
        }
        paths.push("data/dx11/chr/_face/test/c01000010/c01000010_13.g4tx".to_owned());
        paths.sort_unstable();
        let mut selected = BTreeMap::new();
        assert_eq!(
            select_player_assets(&paths, &mut selected, &COMPLETE_PLAYER_CODES, true).unwrap(),
            10
        );
        assert!(!selected.keys().any(|path| path.contains("_13.g4tx")));
    }

    fn item(id: u32, category: ItemCategory, code: &str, stats: Option<(i64, i64)>) -> ItemInfo {
        ItemInfo {
            item_id: HashId(id),
            category,
            name_id: HashId::ZERO,
            desc_id: HashId::ZERO,
            price: None,
            stats: stats.map(|(stat1, stat2)| ItemStats { stat1, stat2 }),
            internal_code: Some(code.to_owned()),
            uniform_id: None,
        }
    }

    #[test]
    fn measured_best_items_keep_the_accessory_tie_and_reject_drift() {
        let items = vec![
            item(
                0x68D5_15E4,
                ItemCategory::Shoes,
                "eq_sh1106101",
                Some((30, 31)),
            ),
            item(
                0xD0A5_B1F0,
                ItemCategory::Misanga,
                "eq_mi0107901",
                Some((40, 32)),
            ),
            item(
                0xAF89_CD7F,
                ItemCategory::Accessory,
                "eq_ac0107401",
                Some((50, 33)),
            ),
            item(
                0xB426_9BF5,
                ItemCategory::Accessory,
                "eq_ac0104801",
                Some((50, 33)),
            ),
            item(6, ItemCategory::Consume, "consume", None),
        ];
        let (winners, unranked) = measured_best_items(&items).unwrap();
        assert_eq!(
            winners
                .iter()
                .map(|winner| winner.item.item_id.get())
                .collect::<Vec<_>>(),
            [0x68D5_15E4, 0xD0A5_B1F0, 0xAF89_CD7F, 0xB426_9BF5]
        );
        assert!(
            winners
                .iter()
                .all(|winner| winner.definition.additive_bonus == 70)
        );
        assert_eq!(unranked, ["consume"]);

        let mut drifted = items;
        drifted[0].internal_code = Some("wrong".to_owned());
        assert!(measured_best_items(&drifted).is_err());
    }

    #[test]
    fn aphrody_profile_reasons_have_explicit_manifest_categories() {
        for (reason, category) in [
            ("featuredPlayer:c01001900", "profile.player"),
            ("aphrodyLean:skill:whs00340", "profile.skill"),
            ("aphrodyLean:soul:soul_0xF5FFD1E5", "profile.soul"),
            ("aphrodyLean:keshin:keshin_0x62256EE2", "profile.keshin"),
            (
                "aphrodyLean:changeMode:modechange_0x03D98821",
                "profile.change_mode",
            ),
            ("aphrodyLean:awakening:aura_0xA17C3D72", "profile.awakening"),
        ] {
            assert_eq!(category_for_reason(reason), category);
        }
    }

    #[test]
    fn atomic_writer_refuses_overwrite_and_leaves_no_temporary_file() {
        let root = std::env::temp_dir().join(format!(
            "nie-vfs-bundle-test-{}-{}",
            std::process::id(),
            std::thread::current().name().unwrap_or("worker")
        ));
        fs::create_dir_all(&root).unwrap();
        let output = root.join("initial.vfs");
        write_atomic(&output, b"first").unwrap();
        assert_eq!(fs::read(&output).unwrap(), b"first");
        assert!(write_atomic(&output, b"second").is_err());
        assert_eq!(fs::read(&output).unwrap(), b"first");
        let leftovers: Vec<_> = fs::read_dir(&root)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty());
        fs::remove_file(output).unwrap();
        fs::remove_dir(root).unwrap();
    }
}
