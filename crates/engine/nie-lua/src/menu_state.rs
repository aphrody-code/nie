//! Portable menu state, independent of the native Lua VM.

use std::collections::{BTreeMap, BTreeSet};
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
/// Virtual list entry stored in native parallel arrays (handler 0x140CB0240).
pub struct MenuListItem {
    /// Positional dword columns supplied by SetListItemValues or SetListItemValuesMulti.
    pub values: Vec<i32>,
    /// Parameters keyed by hash, populated by SetItemParam.
    pub params: BTreeMap<u32, i32>,
}
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
/// Observed widget mutations. Optional values remain absent until a command writes them.
pub struct MenuObjectState {
    /// CRC32 identifier used as the map key.
    pub id: u32,
    /// Resolved name, absent while the identifier remains unknown.
    pub name: Option<String>,
    /// Default visibility; indexed visibility overrides apply to individual instances.
    pub visible: bool,
    /// Whether the object accepts interaction; initially true.
    pub active: bool,
    /// MAIN_MENU.SetUseSaveButton, command 0x555E4093: native handler 0x140CCC800 writes the boolean at +0xED and dirty flag at +0xEF.
    pub use_save_button: Option<bool>,
    /// Command 0xE57428CF(objectId, value, [index], [layerId]) writes native +0x124 and clears +0x168. Higher-level semantics remain unknown.
    pub native_field_0x124_by_index: BTreeMap<i32, i32>,
    /// Texture-path hash supplied by SetIconSprite, paired with sprite_region_hash.
    pub sprite_texture_hash: Option<u32>,
    /// Cell index supplied by SetSprite; this is not a texture-path CRC32.
    pub sprite_cell_id: Option<u32>,
    /// Atlas region-name hash paired with the texture-path hash.
    pub sprite_region_hash: Option<u32>,
    /// Atlas frame index.
    pub frame: Option<i32>,
    /// Palette or tint hash.
    pub color_hash: Option<u32>,
    /// Explicit color packed as 0xRRGGBBAA.
    pub color_rgba: Option<u32>,
    /// Displayed text; unresolved text hashes remain hexadecimal strings.
    pub text: Option<String>,
    /// Numeric display or item count at native +0x148.
    pub number: Option<i32>,
    /// Generic native +0x140 value written by command 0x988B5B82, distinct from the item count.
    pub value: Option<i32>,
    /// Scroll offset, independent of the selected item.
    pub scroll_index: Option<i32>,
    /// Command 0x6A06BC75, handler 0x140CE6B20: selected index at +0x154, clamped against count at +0x150.
    pub selected_index: Option<i32>,
    /// Observed object scale.
    pub scale: Option<f32>,
    /// Observed badge value.
    pub badge: Option<i32>,
    /// Observed progress-bar value.
    pub progress: Option<f32>,
    /// Virtual list entries keyed by zero-based item index; not separate OBJBIN objects.
    pub sub_items: BTreeMap<i32, MenuListItem>,
    /// Per-instance visibility overrides from indexed commands. The legacy field name is retained for compatibility.
    pub visible_par_index: BTreeMap<i32, bool>,
    /// Child visibility keyed by part hash, from Kizuna handler 0x140CCC930.
    pub part_visible: BTreeMap<u32, bool>,
    /// Child RGBA channels preserved as native floats, from Kizuna handler 0x140CDF9F0.
    pub part_color_rgba: BTreeMap<u32, [f32; 4]>,
    /// Raw texture mutation arguments; the complete native structure is unresolved.
    pub part_texture_args: BTreeMap<u32, Vec<u32>>,
    /// Raw parameter mutation arguments; the complete native structure is unresolved.
    pub part_param_args: BTreeMap<u32, Vec<u32>>,
    /// Raw flag mutation arguments; the complete native structure is unresolved.
    pub part_flag_args: BTreeMap<u32, Vec<u32>>,
}

impl MenuObjectState {
    pub(crate) fn new(id: u32) -> Self {
        Self {
            id,
            name: None,
            visible: true,
            active: true,
            use_save_button: None,
            native_field_0x124_by_index: BTreeMap::new(),
            sprite_texture_hash: None,
            sprite_cell_id: None,
            sprite_region_hash: None,
            frame: None,
            color_hash: None,
            color_rgba: None,
            text: None,
            number: None,
            value: None,
            scroll_index: None,
            selected_index: None,
            scale: None,
            badge: None,
            progress: None,
            sub_items: BTreeMap::new(),
            visible_par_index: BTreeMap::new(),
            part_visible: BTreeMap::new(),
            part_color_rgba: BTreeMap::new(),
            part_texture_args: BTreeMap::new(),
            part_param_args: BTreeMap::new(),
            part_flag_args: BTreeMap::new(),
        }
    }
    /// Return or create a virtual list item.
    pub fn sub_item(&mut self, idx: i32) -> &mut MenuListItem {
        self.sub_items.entry(idx).or_default()
    }
}
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
/// Observed menu layer and its objects.
pub struct MenuLayerState {
    /// CRC32 identifier used as the map key.
    pub id: u32,
    /// Resolved name, absent while the identifier remains unknown.
    pub name: Option<String>,
    /// Default visibility; indexed visibility overrides apply to individual instances.
    pub visible: bool,
    /// Whether the layer is enabled; initially true.
    pub enabled: bool,
    /// Current focus index.
    pub focus: Option<i32>,
    /// Current selected item.
    pub current_item: Option<i32>,
    /// Mutated or runtime-created objects keyed by hash within this layer.
    pub objects: BTreeMap<u32, MenuObjectState>,
}

impl MenuLayerState {
    pub(crate) fn new(id: u32) -> Self {
        Self {
            id,
            name: None,
            visible: true,
            enabled: true,
            focus: None,
            current_item: None,
            objects: BTreeMap::new(),
        }
    }
    /// Return or create an object within this layer.
    pub fn obj(&mut self, object_id: u32) -> &mut MenuObjectState {
        self.objects
            .entry(object_id)
            .or_insert_with(|| MenuObjectState::new(object_id))
    }
}
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
/// Observed Lua menu state and caller-supplied engine inputs. No missing game state is inferred.
pub struct MenuState {
    /// Layers in deterministic hash order (BTreeMap does not retain insertion order).
    pub layers: BTreeMap<u32, MenuLayerState>,
    /// Scene attributes read by GetObjectAttr (0x4612788B), including actual AttachLocator item-button counts injected before callbacks.
    pub object_attr: BTreeMap<u32, i32>,
    /// Localized labels supplied by menu_text.cfg.bin.
    pub text_by_id: BTreeMap<u32, String>,
    /// Observed game conditions available to IsConditionActive.
    pub condition_flags: BTreeMap<u32, bool>,
    /// Observed list counts and whether the list identifier was resolved.
    pub list_counts: BTreeMap<u32, (i32, bool)>,
    /// Resource identifiers known to the general engine predicate.
    pub resource_ids: BTreeSet<u32>,
    /// Last value written by funcLuaCommand 0x449E298B to native context+0x2728; its external consumer remains outside menu state.
    pub engine_int_2728: Option<i32>,
    /// Visibility keyed by group hash.
    pub groups: BTreeMap<u32, bool>,
    /// Unknown menu commands as (command ID, layer ID, argument representation).
    pub unknown_cmd_log: Vec<(u32, u32, String)>,
    /// Unknown general engine commands, kept separate from rendering commands.
    pub unknown_general_cmd_log: Vec<(u32, u32, String)>,
    /// Known calls as (command name, layer ID).
    pub known_cmd_log: Vec<(String, u32)>,
    /// Default target for object commands without a layer ID; updated by SetLayerActive.
    pub current_layer: u32,
}

impl MenuState {
    /// Return or create a layer.
    pub fn layer(&mut self, layer_id: u32) -> &mut MenuLayerState {
        self.layers
            .entry(layer_id)
            .or_insert_with(|| MenuLayerState::new(layer_id))
    }
    /// Inject an observed scene attribute before menu callbacks.
    pub fn set_object_attr(&mut self, id: u32, value: i32) {
        self.object_attr.insert(id, value);
    }
    /// Inject a localized label read from the VFS.
    pub fn set_text(&mut self, id: u32, text: String) {
        self.text_by_id.insert(id, text);
    }
    /// Inject an observed game condition.
    pub fn set_condition(&mut self, id: u32, active: bool) {
        self.condition_flags.insert(id, active);
    }
    /// Inject a list count and its resolution status.
    pub fn set_list_count(&mut self, id: u32, count: i32, resolved: bool) {
        self.list_counts.insert(id, (count, resolved));
    }
    /// Update the set of resolved resources.
    pub fn set_resource_available(&mut self, id: u32, available: bool) {
        if available {
            self.resource_ids.insert(id);
        } else {
            self.resource_ids.remove(&id);
        }
    }
    /// Inject the observed native context+0x2728 value.
    pub fn set_engine_int_2728(&mut self, value: i32) {
        self.engine_int_2728 = Some(value);
    }
}
