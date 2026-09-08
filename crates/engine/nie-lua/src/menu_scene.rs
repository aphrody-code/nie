//! Asset-independent projection used by the native menu layout host.
//!
//! This compatibility compiler preserves the existing object-hash merge policy:
//! visibility is intersected and the first supplied value wins. It is not a proof
//! that equal object hashes in different native layers denote the same instance.

use crate::MenuObjectState;

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
/// Compatibility projection keyed by object hash for the native asset join.
pub struct CompiledMenuObject {
    /// Default visibility; indexed visibility overrides apply to individual instances.
    pub visible: bool,
    /// Per-instance visibility overrides from indexed commands. The legacy field name is retained for compatibility.
    pub visible_par_index: std::collections::BTreeMap<i32, bool>,
    /// Child visibility keyed by part hash, from Kizuna handler 0x140CCC930.
    pub part_visible: std::collections::BTreeMap<u32, bool>,
    /// Child RGBA channels preserved as native floats, from Kizuna handler 0x140CDF9F0.
    pub part_color_rgba: std::collections::BTreeMap<u32, [f32; 4]>,
    /// Raw texture mutation arguments; the complete native structure is unresolved.
    pub part_texture_args: std::collections::BTreeMap<u32, Vec<u32>>,
    /// Raw parameter mutation arguments; the complete native structure is unresolved.
    pub part_param_args: std::collections::BTreeMap<u32, Vec<u32>>,
    /// Raw flag mutation arguments; the complete native structure is unresolved.
    pub part_flag_args: std::collections::BTreeMap<u32, Vec<u32>>,
    /// Texture-path hash, paired with sprite_region.
    pub sprite_hash: Option<u32>,
    /// Cell index supplied by SetSprite; this is not a texture-path CRC32.
    pub sprite_cell_id: Option<u32>,
    /// Atlas region-name hash, paired with sprite_hash.
    pub sprite_region: Option<u32>,
    /// Displayed text; unresolved text hashes remain hexadecimal strings.
    pub text: Option<String>,
    /// Numeric display or item count at native +0x148.
    pub number: Option<i32>,
}

impl Default for CompiledMenuObject {
    fn default() -> Self {
        Self {
            visible: true,
            visible_par_index: std::collections::BTreeMap::new(),
            part_visible: std::collections::BTreeMap::new(),
            part_color_rgba: std::collections::BTreeMap::new(),
            part_texture_args: std::collections::BTreeMap::new(),
            part_param_args: std::collections::BTreeMap::new(),
            part_flag_args: std::collections::BTreeMap::new(),
            sprite_hash: None,
            sprite_cell_id: None,
            sprite_region: None,
            text: None,
            number: None,
        }
    }
}

impl CompiledMenuObject {
    /// Merge an observed object without replacing earlier optional mutations.
    pub fn merge(&mut self, object: &MenuObjectState) {
        self.visible = self.visible && object.visible;
        for (idx, v) in &object.visible_par_index {
            self.visible_par_index.entry(*idx).or_insert(*v);
        }
        for (part, v) in &object.part_visible {
            self.part_visible.entry(*part).or_insert(*v);
        }
        for (part, rgba) in &object.part_color_rgba {
            self.part_color_rgba.entry(*part).or_insert(*rgba);
        }
        for (part, args) in &object.part_texture_args {
            self.part_texture_args
                .entry(*part)
                .or_insert_with(|| args.clone());
        }
        for (part, args) in &object.part_param_args {
            self.part_param_args
                .entry(*part)
                .or_insert_with(|| args.clone());
        }
        for (part, args) in &object.part_flag_args {
            self.part_flag_args
                .entry(*part)
                .or_insert_with(|| args.clone());
        }
        if self.sprite_hash.is_none() {
            self.sprite_hash = object.sprite_texture_hash;
            self.sprite_region = object.sprite_region_hash;
        }
        if self.sprite_cell_id.is_none() {
            self.sprite_cell_id = object.sprite_cell_id;
        }
        if self.text.is_none() {
            self.text = object.text.clone();
        }
        if self.number.is_none() {
            self.number = object.number;
        }
    }
}

/// Lossless renderer state, preserving layer identity and runtime-created objects.
///
/// Hosts may resolve assets and geometry separately. Absence of a transform in this
/// contract must not be interpreted as a resolved native placement.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuScene {
    pub schema_version: u32,
    pub layers: std::collections::BTreeMap<u32, crate::MenuLayerState>,
    pub groups: std::collections::BTreeMap<u32, bool>,
}

impl MenuScene {
    pub const SCHEMA_VERSION: u32 = 1;

    /// Snapshot only renderer state; host telemetry and save inputs stay outside it.
    pub fn from_state(state: &crate::MenuState) -> Self {
        Self {
            schema_version: Self::SCHEMA_VERSION,
            layers: state.layers.clone(),
            groups: state.groups.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::MenuState;

    #[test]
    fn snapshot_preserves_layer_identity_and_runtime_mutations() {
        let mut state = MenuState::default();
        let object = state.layer(10).obj(20);
        object.visible = false;
        object.active = false;
        object.scale = Some(1.5);
        object.selected_index = Some(2);
        object.native_field_0x124_by_index.insert(3, 42);
        object.sub_item(2).values = vec![12, 34];
        object.part_color_rgba.insert(4, [0.1, 0.2, 0.3, 1.0]);
        state.layer(11).obj(20).text = Some("Independent instance".into());
        state.groups.insert(12, false);

        let scene = MenuScene::from_state(&state);
        assert_eq!(scene.schema_version, 1);
        assert_eq!(scene.layers, state.layers);
        assert_eq!(scene.groups, state.groups);
        state.layer(10).obj(20).scale = Some(2.0);
        assert_eq!(scene.layers[&10].objects[&20].scale, Some(1.5));
        assert!(scene.layers[&11].objects[&20].visible);
    }

    #[test]
    fn compatibility_projection_preserves_first_values_and_index_overrides() {
        let mut state = MenuState::default();
        let first = state.layer(1).obj(2);
        first.sprite_texture_hash = Some(100);
        first.sprite_region_hash = Some(101);
        first.sprite_cell_id = Some(3);
        first.text = Some("First".into());
        first.visible_par_index.insert(2, false);
        first.part_texture_args.insert(4, vec![5, 6]);
        let mut compiled = CompiledMenuObject::default();
        compiled.merge(first);
        let second = state.layer(3).obj(2);
        second.visible = false;
        second.sprite_texture_hash = Some(200);
        second.sprite_region_hash = Some(201);
        second.sprite_cell_id = Some(4);
        second.text = Some("Second".into());
        second.number = Some(7);
        second.visible_par_index.insert(2, true);
        second.visible_par_index.insert(3, true);
        second.part_texture_args.insert(4, vec![9]);
        compiled.merge(second);
        assert!(!compiled.visible);
        assert_eq!(compiled.sprite_hash, Some(100));
        assert_eq!(compiled.sprite_region, Some(101));
        assert_eq!(compiled.sprite_cell_id, Some(3));
        assert_eq!(compiled.text.as_deref(), Some("First"));
        assert_eq!(compiled.number, Some(7));
        assert_eq!(compiled.visible_par_index.get(&2), Some(&false));
        assert_eq!(compiled.visible_par_index.get(&3), Some(&true));
        assert_eq!(compiled.part_texture_args[&4], vec![5, 6]);
    }
}
