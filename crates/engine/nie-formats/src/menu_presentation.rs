//! Portable VFS scene descriptions shared by native and WebAssembly hosts.
//!
//! These measured presentations do not imply that native callbacks, save data or
//! animations have been reconstructed. Their provenance and unresolved fields travel
//! with the scene instead of being replaced by guessed renderer values.

use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

/// A screen-space rectangle, already projected into the declared canvas.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Rect {
    fn valid(&self) -> bool {
        [self.x, self.y, self.w, self.h]
            .iter()
            .all(|n| n.is_finite() && n.abs() <= 16384.0)
            && self.w > 0.0
            && self.h > 0.0
    }
}

/// Logical rendering dimensions, independent of host CSS scaling.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Canvas {
    pub width: u32,
    pub height: u32,
}

/// Exact source and the method used to establish the presentation field.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Provenance {
    pub source: String,
    pub record: String,
    pub method: String,
}

impl Provenance {
    fn valid(&self) -> bool {
        [&self.source, &self.record, &self.method]
            .iter()
            .all(|value| !value.trim().is_empty())
    }
}

/// A named decoded texture region; the atlas itself is never a screen.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Layer {
    pub id: String,
    pub asset_path: String,
    pub region: String,
    pub rect: Rect,
    pub draw_order: i32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rotation_deg: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mask_region: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mask_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible_when: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub focused_region: Option<String>,
    pub provenance: Provenance,
}

/// A native action binding. Absent host action means the host cannot execute it.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Control {
    pub id: String,
    pub label: String,
    pub rect: Rect,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub native_action_hash: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host_action_id: Option<String>,
    pub provenance: Provenance,
}

/// Localized native text and its measured placement, rendered by the shared bitmap font.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Text {
    pub id: String,
    pub text: String,
    pub rect: Rect,
    pub draw_order: i32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    /// Packed 24-bit RGB. Hosts add opacity when calling the bitmap-font binding.
    pub color: Option<u32>,
    pub provenance: Provenance,
}

/// A native scene region occupied by live content such as an editable 3D avatar.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Slot {
    pub id: String,
    pub rect: Rect,
    pub provenance: Provenance,
}

/// Versioned shared scene, with evidence kept separate from execution completeness.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Scene {
    pub schema_version: u32,
    pub id: String,
    pub canvas: Canvas,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background: Option<String>,
    pub layers: Vec<Layer>,
    pub controls: Vec<Control>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub texts: Vec<Text>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub slots: Vec<Slot>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provenance: Option<Provenance>,
    #[serde(default)]
    pub unresolved: Vec<String>,
}

/// Validate before a host consumes externally supplied scene metadata.
pub fn parse_scene(json: &str) -> Result<Scene, String> {
    if json.len() > 1024 * 1024 {
        return Err("Scene exceeds 1 MiB".into());
    }
    let scene: Scene = serde_json::from_str(json).map_err(|e| e.to_string())?;
    if scene.schema_version != 1
        || scene.id.trim().is_empty()
        || !(1..=8192).contains(&scene.canvas.width)
        || !(1..=8192).contains(&scene.canvas.height)
        || scene.layers.len() > 512
        || scene.controls.len() > 128
        || scene.texts.len() > 256
        || scene.slots.len() > 32
    {
        return Err("Unsupported scene dimensions, version or object count".into());
    }
    // Hosts consume this value as a canvas color, never as a CSS image or URL.
    if scene.background.as_deref().is_some_and(|value| {
        !matches!(value.len(), 7 | 9)
            || !value.starts_with('#')
            || !value.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
    }) || scene
        .provenance
        .as_ref()
        .is_some_and(|value| !value.valid())
    {
        return Err("Invalid scene background or provenance".into());
    }
    let mut controls = BTreeSet::new();
    for control in &scene.controls {
        if control.id.trim().is_empty()
            || !controls.insert(&control.id)
            || !control.rect.valid()
            || control.label.trim().is_empty()
            || control
                .host_action_id
                .as_ref()
                .is_some_and(|id| id.trim().is_empty())
            || !control.provenance.valid()
        {
            return Err("Invalid or duplicate scene control".into());
        }
    }
    let mut text_ids = BTreeSet::new();
    for text in &scene.texts {
        if text.id.trim().is_empty()
            || !text_ids.insert(&text.id)
            || !text.rect.valid()
            || text.text.chars().count() > 512
            || text.color.is_some_and(|color| color > 0xffffff)
            || !text.provenance.valid()
        {
            return Err("Invalid or duplicate scene text".into());
        }
    }
    let mut slot_ids = BTreeSet::new();
    for slot in &scene.slots {
        if slot.id.trim().is_empty()
            || !slot_ids.insert(&slot.id)
            || !slot.rect.valid()
            || !slot.provenance.valid()
        {
            return Err("Invalid or duplicate scene slot".into());
        }
    }
    let mut layers = BTreeSet::new();
    for layer in &scene.layers {
        if layer.id.trim().is_empty()
            || !layers.insert(&layer.id)
            || !layer.rect.valid()
            || !layer.asset_path.starts_with("data/")
            || !layer.asset_path.ends_with(".g4tx")
            || layer
                .asset_path
                .split('/')
                .any(|part| part.is_empty() || part == "." || part == "..")
            || layer.asset_path.contains(['\\', '?', '#'])
            || layer.region.trim().is_empty()
            || !layer.provenance.valid()
            || layer.rotation_deg.is_some_and(|v| !v.is_finite())
            || layer
                .mask_mode
                .as_deref()
                .is_some_and(|v| v != "alpha" && v != "luminance")
            || layer
                .mask_region
                .as_deref()
                .is_some_and(|v| v.trim().is_empty())
            || (layer.mask_mode.is_some() && layer.mask_region.is_none())
            || layer
                .focused_region
                .as_deref()
                .is_some_and(|v| v.trim().is_empty())
            || ((layer.visible_when.is_some() || layer.focused_region.is_some())
                && layer.action_id.is_none())
            || layer
                .visible_when
                .as_deref()
                .is_some_and(|v| v != "focused")
            || layer
                .action_id
                .as_ref()
                .is_some_and(|id| !controls.contains(id))
        {
            return Err("Invalid scene region, geometry or action reference".into());
        }
    }
    Ok(scene)
}

/// Compile an engine-owned scene. Unknown identities fail instead of choosing another screen.
pub fn scene_json(id: &str) -> Result<String, String> {
    let source = match id {
        "loading" => include_str!("menu_scenes/loading.json"),
        "start" => include_str!("menu_scenes/start.json"),
        "autosave" => include_str!("menu_scenes/autosave.json"),
        "title-menu" => include_str!("menu_scenes/title-menu.json"),
        "options-row" => include_str!("menu_scenes/setting-row.json"),
        "avatar-top" => include_str!("menu_scenes/avatar-top.json"),
        "avatar-style" => include_str!("menu_scenes/avatar-style.json"),
        "avatar-hair" => include_str!("menu_scenes/avatar-hair.json"),
        "avatar-clothes" => include_str!("menu_scenes/avatar-clothes.json"),
        "avatar-stats" => include_str!("menu_scenes/avatar-stats.json"),
        "avatar-name" => include_str!("menu_scenes/avatar-name.json"),
        _ => return Err("Unknown native menu presentation".into()),
    };
    let mut scene = parse_scene(source)?;
    if id.starts_with("avatar-") {
        let common = parse_scene(include_str!("menu_scenes/avatar-common.json"))?;
        if common.canvas.width != scene.canvas.width || common.canvas.height != scene.canvas.height
        {
            return Err("Avatar scene dimensions disagree".into());
        }
        scene.layers.splice(0..0, common.layers);
        scene.controls.splice(0..0, common.controls);
        scene.texts.splice(0..0, common.texts);
        scene.slots.splice(0..0, common.slots);
        scene.unresolved.splice(0..0, common.unresolved);
        scene.background = scene.background.or(common.background);
    }
    let json = serde_json::to_string(&scene).map_err(|e| e.to_string())?;
    parse_scene(&json)?;
    Ok(json)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loading_keeps_the_native_ball_separate_from_localized_text() {
        let scene = parse_scene(&scene_json("loading").unwrap()).unwrap();
        assert_eq!(scene.id, "loading");
        assert_eq!((scene.canvas.width, scene.canvas.height), (1920, 1080));
        assert_eq!(scene.background.as_deref(), Some("#000000"));
        assert_eq!(scene.layers.len(), 1);
        assert_eq!(scene.layers[0].region, "load_ball01");
        assert_eq!(
            (scene.layers[0].rect.x, scene.layers[0].rect.y),
            (1392.0, 976.0)
        );
        assert_eq!(scene.texts.len(), 1);
        assert_eq!(scene.texts[0].text, "CHARGEMENT EN COURS…");
        assert_eq!(
            (scene.texts[0].rect.x, scene.texts[0].rect.y),
            (1472.0, 980.0)
        );
        assert!(scene.controls.is_empty());
        assert!(!scene.unresolved.is_empty());
    }

    #[test]
    fn all_compiled_scenes_satisfy_the_shared_host_contract() {
        for id in [
            "loading",
            "start",
            "autosave",
            "title-menu",
            "avatar-top",
            "avatar-style",
            "avatar-hair",
            "avatar-clothes",
            "avatar-stats",
            "avatar-name",
        ] {
            let scene = parse_scene(&scene_json(id).unwrap()).unwrap();
            assert_eq!(scene.id, id);
            assert!(!scene.layers.is_empty(), "{id}");
        }
    }

    #[test]
    fn rejects_unusable_focus_masks_and_missing_provenance() {
        let source = scene_json("loading").unwrap();
        for (field, value) in [
            ("visibleWhen", serde_json::json!("focused")),
            ("focusedRegion", serde_json::json!("focused")),
            ("focusedRegion", serde_json::json!(" ")),
            ("maskMode", serde_json::json!("alpha")),
            ("maskRegion", serde_json::json!(" ")),
            (
                "provenance",
                serde_json::json!({"source":"", "record":"record", "method":"measured"}),
            ),
        ] {
            let mut json: serde_json::Value = serde_json::from_str(&source).unwrap();
            json["layers"][0][field] = value;
            assert!(parse_scene(&json.to_string()).is_err(), "accepted {field}");
        }
    }

    #[test]
    fn rejects_non_color_backgrounds_and_non_rgb_text_colors() {
        let source = scene_json("loading").unwrap();
        for background in [
            "",
            "#",
            "#gggggg",
            "url(/capture.png)",
            "linear-gradient(black,white)",
        ] {
            let mut json: serde_json::Value = serde_json::from_str(&source).unwrap();
            json["background"] = serde_json::json!(background);
            assert!(
                parse_scene(&json.to_string()).is_err(),
                "accepted {background}"
            );
        }
        let mut json: serde_json::Value = serde_json::from_str(&source).unwrap();
        json["texts"][0]["color"] = serde_json::json!(0xffffffffu32);
        assert!(parse_scene(&json.to_string()).is_err());
    }

    #[test]
    fn avatar_stages_share_the_native_shell_and_keep_live_model_slots() {
        for id in [
            "avatar-top",
            "avatar-style",
            "avatar-hair",
            "avatar-clothes",
            "avatar-stats",
            "avatar-name",
        ] {
            let scene = parse_scene(&scene_json(id).unwrap()).unwrap();
            assert!(scene.layers.len() > 25, "{id}");
            assert!(
                scene.controls.iter().any(|control| control.id == "back"),
                "{id}"
            );
            assert!(scene.slots.iter().any(|slot| slot.id == "model"), "{id}");
            assert!(!scene.texts.is_empty());
            assert!(!scene.unresolved.is_empty());
        }
    }

    #[test]
    fn start_retains_independent_native_regions_and_unresolved_effects() {
        let scene = parse_scene(&scene_json("start").unwrap()).unwrap();
        assert_eq!((scene.canvas.width, scene.canvas.height), (1920, 1080));
        assert_eq!(scene.layers.len(), 4);
        assert_eq!(scene.layers[0].region, "bg_sky01_st");
        assert_eq!(scene.layers[0].rect.x, -360.0);
        assert_eq!(scene.layers[3].region, "logo02");
        assert!(!scene.unresolved.is_empty());
        assert!(scene_json("mainmenu01").is_err());
    }

    #[test]
    fn title_menu_preserves_all_native_controls_and_observed_bindings() {
        let scene = parse_scene(&scene_json("title-menu").unwrap()).unwrap();
        assert_eq!(scene.controls.len(), 12);
        assert_eq!(
            scene
                .controls
                .iter()
                .filter(|c| c.native_action_hash.is_some())
                .count(),
            11
        );
        let bindings: Vec<_> = scene
            .controls
            .iter()
            .filter_map(|c| c.host_action_id.as_deref())
            .collect();
        assert_eq!(bindings, ["settings", "avatar"]);
        assert!(
            scene
                .layers
                .iter()
                .all(|layer| !layer.provenance.source.is_empty())
        );
    }

    #[test]
    fn rejects_invalid_geometry_paths_and_dangling_actions() {
        let source = scene_json("start").unwrap();
        for (field, value) in [
            ("assetPath", serde_json::json!("data/../capture.g4tx")),
            (
                "assetPath",
                serde_json::json!("https://example.com/texture.g4tx"),
            ),
            ("actionId", serde_json::json!("missing")),
            ("rect", serde_json::json!({"x":0,"y":0,"w":0,"h":10})),
        ] {
            let mut json: serde_json::Value = serde_json::from_str(&source).unwrap();
            json["layers"][0][field] = value;
            assert!(parse_scene(&json.to_string()).is_err(), "accepted {field}");
        }
        let mut json: serde_json::Value = serde_json::from_str(&source).unwrap();
        json["layers"][1]["id"] = json["layers"][0]["id"].clone();
        assert!(parse_scene(&json.to_string()).is_err());
    }
}
