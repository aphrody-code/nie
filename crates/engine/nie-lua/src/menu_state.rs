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
    /// Optional native host observations used by proven general state queries.
    #[serde(default)]
    pub observed_native: ObservedMenuNativeState,
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
    /// Supply an observed native snapshot; missing fields remain unresolved.
    pub fn set_observed_native_state(&mut self, observed: ObservedMenuNativeState) {
        self.observed_native = observed;
    }

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

/// Sparse native observations: an absent descriptor key is unobserved, while an
/// explicit `null` descriptor proves that native lookup found no entry. Values
/// are indexed separately so missing saved data never becomes an invented zero.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(bound(deserialize = "T: serde::Deserialize<'de>"))]
pub struct ObservedMenuFlags<T, const CAPACITY: usize> {
    #[serde(default, deserialize_with = "deserialize_flag_descriptors")]
    pub descriptors: BTreeMap<u32, Option<u16>>,
    #[serde(
        default,
        deserialize_with = "deserialize_flag_values::<_, T, CAPACITY>"
    )]
    pub values: BTreeMap<u16, T>,
}

fn deserialize_bounded_flag_map<'de, D, K, V, F>(
    deserializer: D,
    capacity: usize,
    valid_key: F,
) -> Result<BTreeMap<K, V>, D::Error>
where
    D: serde::Deserializer<'de>,
    K: serde::Deserialize<'de> + Ord,
    V: serde::Deserialize<'de>,
    F: Fn(&K) -> bool,
{
    struct MapVisitor<K, V, F> {
        capacity: usize,
        valid_key: F,
        marker: std::marker::PhantomData<(K, V)>,
    }
    impl<'de, K, V, F> serde::de::Visitor<'de> for MapVisitor<K, V, F>
    where
        K: serde::Deserialize<'de> + Ord,
        V: serde::Deserialize<'de>,
        F: Fn(&K) -> bool,
    {
        type Value = BTreeMap<K, V>;
        fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            formatter.write_str("a bounded map of observed native flags")
        }
        fn visit_map<A: serde::de::MapAccess<'de>>(
            self,
            mut access: A,
        ) -> Result<Self::Value, A::Error> {
            let mut result = BTreeMap::new();
            while let Some((key, value)) = access.next_entry::<K, V>()? {
                if result.len() >= self.capacity || !(self.valid_key)(&key) {
                    return Err(serde::de::Error::custom(
                        "observed flag map exceeds its native/input bounds",
                    ));
                }
                if result.insert(key, value).is_some() {
                    return Err(serde::de::Error::custom("duplicate observed flag key"));
                }
            }
            Ok(result)
        }
    }
    deserializer.deserialize_map(MapVisitor {
        capacity,
        valid_key,
        marker: std::marker::PhantomData,
    })
}

fn deserialize_flag_descriptors<'de, D>(
    deserializer: D,
) -> Result<BTreeMap<u32, Option<u16>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    // Input resource bound, not a claim about native hash-table capacity.
    deserialize_bounded_flag_map(deserializer, 65_536, |_: &u32| true)
}

fn deserialize_flag_values<'de, D, T, const CAPACITY: usize>(
    deserializer: D,
) -> Result<BTreeMap<u16, T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::Deserialize<'de>,
{
    deserialize_bounded_flag_map(deserializer, CAPACITY, |index: &u16| {
        usize::from(*index) < CAPACITY
    })
}

impl<T: Copy + Default, const CAPACITY: usize> ObservedMenuFlags<T, CAPACITY> {
    fn resolve(&self, key: u32) -> Option<T> {
        if key == 0 {
            // Native descriptor lookup rejects zero hashes before accessing its table.
            return Some(T::default());
        }
        match self.descriptors.get(&key)? {
            None => Some(T::default()),
            Some(index) => {
                // All three native getters read index zero for an out-of-range descriptor.
                let index = if usize::from(*index) < CAPACITY {
                    *index
                } else {
                    0
                };
                self.values.get(&index).copied()
            }
        }
    }
}

/// Observed C-string bytes, excluding the terminator. The 4096-byte limit is a
/// host input bound, not a claim about the native save buffer capacity.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(transparent)]
pub struct ObservedMenuCString(Vec<u8>);
impl ObservedMenuCString {
    pub fn as_bytes(&self) -> &[u8] {
        &self.0
    }

    pub fn from_bytes(bytes: Vec<u8>) -> Option<Self> {
        (bytes.len() <= 4096 && !bytes.contains(&0)).then_some(Self(bytes))
    }
}

impl<'de> serde::Deserialize<'de> for ObservedMenuCString {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct BytesVisitor;
        impl<'de> serde::de::Visitor<'de> for BytesVisitor {
            type Value = ObservedMenuCString;
            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("at most 4096 nonzero C-string bytes")
            }
            fn visit_seq<A: serde::de::SeqAccess<'de>>(
                self,
                mut seq: A,
            ) -> Result<Self::Value, A::Error> {
                let mut bytes = Vec::new();
                while let Some(byte) = seq.next_element::<u8>()? {
                    if byte == 0 || bytes.len() >= 4096 {
                        return Err(serde::de::Error::custom("invalid observed C-string bytes"));
                    }
                    bytes.push(byte);
                }
                Ok(ObservedMenuCString(bytes))
            }
        }
        deserializer.deserialize_seq(BytesVisitor)
    }
}

/// Result of the native primary-slot override search, shared by slots 0 and 1.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ObservedMenuStringOverride {
    SavedFallback,
    Value { bytes: ObservedMenuCString },
}

/// Inputs for command 0x3D935467 selector 6. Native 140ea51f0 searches the first
/// qualifying override for primary slots, otherwise 140da20a0 uses saved data.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ObservedMenuStringQuery {
    pub primary_override: Option<ObservedMenuStringOverride>,
    /// Key = mapped saved slot * 3 + secondary slot. Missing keys are unobserved;
    /// null means an observed null result pointer, [] a nonnull empty C string.
    #[serde(
        default,
        deserialize_with = "deserialize_flag_values::<_, Option<ObservedMenuCString>, 48>"
    )]
    pub saved_slots: BTreeMap<u16, Option<ObservedMenuCString>>,
}

/// Native numeric argument narrowing for the proven finite conversion domain.
/// Nonfinite and out-of-range machine conversions remain unresolved.
pub fn observed_menu_argument_byte(value: f64) -> Option<u8> {
    if !value.is_finite() || value < f64::from(i32::MIN) || value >= 9_223_372_036_854_775_808.0 {
        return None;
    }
    Some((value as i64) as u8)
}

/// Native menu inputs observed by a host; absent values remain unresolved.
///
/// The offsets deliberately retain native names: the handlers prove these loads,
/// but do not establish a product-level meaning for the bytes. Sources are
/// `data/re/funclua-cmdid-handlers.json` and the corresponding functions in
/// `data/re/30-ghidra/exports/decompiled-c/nie.exe.c`.
/// Binary SHA256: `b1fa04ea365868e5c8933aca393366f82d0d446187e2187f2737dc4fa2acd40c`.
/// Dispatch entries were verified at file offsets 0x1cb8430, 0x1cb8420,
/// 0x1cb8400 and 0x1cb83b0; disassembly confirms unsigned byte loads.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ObservedMenuNativeState {
    /// Optional observations for the selector-6 raw string query.
    pub string_query: Option<ObservedMenuStringQuery>,
    /// Byte at `*(context + 0x69c8) + 0x2cac6f`.
    pub context_69c8_field_2cac6f: Option<u8>,
    /// Byte at `*(context + 0x69a8) + 0x9f10`.
    pub context_69a8_field_9f10: Option<u8>,
    /// Byte at `*(context + 0x69a8) + 0x9f13`.
    pub context_69a8_field_9f13: Option<u8>,
    /// Category 0 bit storage at `*(context + 0x69b8) + 8` (5120 bits).
    /// Command 0x381D0910 → handler 0x140c5d260 → getter 0x140e88ee0.
    /// Dispatch pair verified at binary file offset 0x1cb74a0.
    pub category_0_flags: Option<ObservedMenuFlags<bool, 5120>>,
    /// Category 1 byte storage at `*(context + 0x69b8) + 0x288` (640 bytes).
    /// Command 0xA50C0747 → handler 0x140c5d1f0 → getter 0x140e89310.
    /// Dispatch pair verified at binary file offset 0x1cb74b0.
    pub category_1_values: Option<ObservedMenuFlags<u8, 640>>,
    /// Category 5 bit storage at `*(context + 0x69b8) + 0x19560` (256 bits).
    /// Command 0x88154DF4 → handler 0x140c5d110 → getter 0x140e8b850.
    /// Dispatch pair verified at binary file offset 0x1cb74d0.
    pub category_5_flags: Option<ObservedMenuFlags<bool, 256>>,
}

/// Typed Lua result for an observed native-state query.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ObservedMenuQueryValue {
    Boolean(bool),
    Byte(u8),
}

impl ObservedMenuNativeState {
    /// Resolve the native string-query branch. Outer None means unresolved;
    /// inner None is the single false return; bytes mean true plus a raw string.
    /// 140be9cc0 returns the stack delta, not the handler status byte.
    pub fn resolve_general_string_query(&self, args: &[u8]) -> Option<Option<&[u8]>> {
        if args.len() < 3 || args[0] > 15 || args[1] > 2 {
            return Some(None);
        }
        if args[2] != 6 {
            return None;
        }
        let query = self.string_query.as_ref()?;
        if args[0] < 2 {
            match query.primary_override.as_ref()? {
                ObservedMenuStringOverride::Value { bytes } => return Some(Some(&bytes.0)),
                ObservedMenuStringOverride::SavedFallback => {}
            }
        }
        // Native table VA1419d7e28, binary file offset 0x19d6a28.
        const SLOTS: [u16; 16] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 14, 15, 11, 12, 13];
        let key = SLOTS[usize::from(args[0])] * 3 + u16::from(args[1]);
        Some(
            query
                .saved_slots
                .get(&key)?
                .as_ref()
                .map(|bytes| bytes.0.as_slice()),
        )
    }

    /// Count supplied observations without treating absent bytes as zero.
    pub fn observed_field_count(&self) -> usize {
        [
            self.context_69c8_field_2cac6f,
            self.context_69a8_field_9f10,
            self.context_69a8_field_9f13,
        ]
        .iter()
        .filter(|value| value.is_some())
        .count()
            + usize::from(self.category_0_flags.is_some())
            + usize::from(self.category_1_values.is_some())
            + usize::from(self.category_5_flags.is_some())
            + usize::from(self.string_query.is_some())
    }

    /// Resolve observed keyed flags without requiring unrelated native mode bytes.
    /// Descriptor absence is resolved only when explicitly observed as `null`.
    pub fn resolve_general_command_with_key(
        &self,
        command_id: u32,
        key: Option<u32>,
    ) -> Option<ObservedMenuQueryValue> {
        use ObservedMenuQueryValue::{Boolean, Byte};
        match command_id {
            0x381D_0910 => self.category_0_flags.as_ref()?.resolve(key?).map(Boolean),
            0xA50C_0747 => self.category_1_values.as_ref()?.resolve(key?).map(Byte),
            0x8815_4DF4 => self.category_5_flags.as_ref()?.resolve(key?).map(Boolean),
            _ => self.resolve_general_command(command_id),
        }
    }

    /// Resolve only commands whose complete read/branch behavior is known.
    /// Missing host observations return `None`, never an invented state value.
    pub fn resolve_general_command(&self, command_id: u32) -> Option<ObservedMenuQueryValue> {
        use ObservedMenuQueryValue::{Boolean, Byte};
        let native_byte = self.context_69c8_field_2cac6f?;
        match command_id {
            // Handler 0x140c4d210: pushboolean(native byte == 2).
            0x1953_DBC1 => Some(Boolean(native_byte == 2)),
            // Handler 0x140c4d250: pushinteger(native byte).
            0xB314_C568 => Some(Byte(native_byte)),
            // Handler 0x140c4d2c0: pushinteger(native byte == 2 ? 0 : 2).
            0xEF7B_C853 => Some(Byte(if native_byte == 2 { 0 } else { 2 })),
            // Handler 0x140c4d500: select a save-context byte with the same predicate.
            0xDD5C_4CD4 => {
                if native_byte == 2 {
                    self.context_69a8_field_9f13.map(Byte)
                } else {
                    self.context_69a8_field_9f10.map(Byte)
                }
            }
            _ => None,
        }
    }
}

#[cfg(test)]
mod observed_native_tests {
    use super::*;

    #[test]
    fn string_observations_require_override_outcome_and_map_saved_slots() {
        let mut state = ObservedMenuNativeState {
            string_query: Some(ObservedMenuStringQuery {
                primary_override: None,
                saved_slots: BTreeMap::from([
                    (0, Some(ObservedMenuCString(vec![65]))),
                    (42, Some(ObservedMenuCString(vec![66]))),
                    (47, None),
                ]),
            }),
            ..Default::default()
        };
        assert_eq!(state.resolve_general_string_query(&[0, 0, 6]), None);
        assert_eq!(
            state.resolve_general_string_query(&[11, 0, 6]),
            Some(Some(&b"B"[..]))
        );
        assert_eq!(state.resolve_general_string_query(&[12, 2, 6]), Some(None));
        assert_eq!(state.resolve_general_string_query(&[13, 0, 6]), None);
        assert_eq!(state.resolve_general_string_query(&[16, 0, 7]), Some(None));
        assert_eq!(state.resolve_general_string_query(&[0, 0, 7]), None);
        state.string_query.as_mut().unwrap().primary_override =
            Some(ObservedMenuStringOverride::SavedFallback);
        assert_eq!(
            state.resolve_general_string_query(&[0, 0, 6]),
            Some(Some(&b"A"[..]))
        );
        state.string_query.as_mut().unwrap().primary_override =
            Some(ObservedMenuStringOverride::Value {
                bytes: ObservedMenuCString(vec![]),
            });
        assert_eq!(
            state.resolve_general_string_query(&[1, 2, 6]),
            Some(Some(&b""[..]))
        );
        assert_eq!(
            state.resolve_general_string_query(&[11, 0, 6]),
            Some(Some(&b"B"[..]))
        );
    }

    #[test]
    fn string_observations_reject_unbounded_or_non_c_string_input() {
        use serde::Deserialize;
        use serde::de::value::{Error, SeqDeserializer};
        for bytes in [vec![0], vec![1; 4097]] {
            let input = SeqDeserializer::<_, Error>::new(bytes.into_iter());
            assert!(ObservedMenuCString::deserialize(input).is_err());
        }
        assert!(ObservedMenuCString::from_bytes(vec![1; 4096]).is_some());
        assert!(ObservedMenuCString::from_bytes(vec![1; 4097]).is_none());
        assert!(ObservedMenuCString::from_bytes(vec![0]).is_none());
        assert_eq!(
            ObservedMenuCString::from_bytes(vec![255])
                .unwrap()
                .as_bytes(),
            &[255]
        );
        assert_eq!(observed_menu_argument_byte(-256.9), Some(0));
        assert_eq!(observed_menu_argument_byte(-1.9), Some(255));
        assert_eq!(observed_menu_argument_byte(262.9), Some(6));
        for input in [
            f64::NAN,
            f64::INFINITY,
            -2147483649.0,
            9223372036854775808.0,
        ] {
            assert_eq!(observed_menu_argument_byte(input), None);
        }
    }

    #[test]
    fn flag_queries_distinguish_unobserved_missing_and_saved_false() {
        use ObservedMenuQueryValue::Boolean;
        let mut state = ObservedMenuNativeState::default();
        assert_eq!(
            state.resolve_general_command_with_key(0x8815_4DF4, Some(42)),
            None
        );
        let mut flags = ObservedMenuFlags::<bool, 256>::default();
        flags.descriptors.insert(42, None);
        state.category_5_flags = Some(flags);
        assert_eq!(
            state.resolve_general_command_with_key(0x8815_4DF4, Some(42)),
            Some(Boolean(false))
        );
        let flags = state.category_5_flags.as_mut().unwrap();
        flags.descriptors.insert(42, Some(7));
        assert_eq!(
            state.resolve_general_command_with_key(0x8815_4DF4, Some(42)),
            None
        );
        state
            .category_5_flags
            .as_mut()
            .unwrap()
            .values
            .insert(7, false);
        assert_eq!(
            state.resolve_general_command_with_key(0x8815_4DF4, Some(42)),
            Some(Boolean(false))
        );
        state
            .category_5_flags
            .as_mut()
            .unwrap()
            .values
            .insert(7, true);
        assert_eq!(
            state.resolve_general_command_with_key(0x8815_4DF4, Some(42)),
            Some(Boolean(true))
        );
        assert_eq!(
            state.resolve_general_command_with_key(0x8815_4DF4, Some(43)),
            None
        );
        assert_eq!(
            state.resolve_general_command_with_key(0x8815_4DF4, None),
            None
        );
    }

    #[test]
    fn flag_categories_do_not_alias_or_require_a_mode_byte() {
        use ObservedMenuQueryValue::{Boolean, Byte};
        let state = ObservedMenuNativeState {
            category_0_flags: Some(ObservedMenuFlags {
                descriptors: BTreeMap::from([(42, Some(1))]),
                values: BTreeMap::from([(1, true)]),
            }),
            category_1_values: Some(ObservedMenuFlags {
                descriptors: BTreeMap::from([(42, Some(2))]),
                values: BTreeMap::from([(2, 255)]),
            }),
            category_5_flags: Some(ObservedMenuFlags {
                descriptors: BTreeMap::from([(42, Some(3))]),
                values: BTreeMap::from([(3, false)]),
            }),
            ..Default::default()
        };
        assert_eq!(
            state.resolve_general_command_with_key(0x381D_0910, Some(42)),
            Some(Boolean(true))
        );
        assert_eq!(
            state.resolve_general_command_with_key(0xA50C_0747, Some(42)),
            Some(Byte(255))
        );
        assert_eq!(
            state.resolve_general_command_with_key(0x8815_4DF4, Some(42)),
            Some(Boolean(false))
        );
        assert_eq!(state.observed_field_count(), 3);
    }

    #[test]
    fn descriptor_bounds_use_observed_index_zero_without_defaulting_missing_storage() {
        fn check<const CAPACITY: usize>() {
            let last = (CAPACITY - 1) as u16;
            let mut flags = ObservedMenuFlags::<u8, CAPACITY> {
                descriptors: BTreeMap::from([
                    (1, Some(last)),
                    (2, Some(CAPACITY as u16)),
                    (3, Some(u16::MAX)),
                ]),
                values: BTreeMap::from([(last, 255)]),
            };
            assert_eq!(flags.resolve(1), Some(255));
            assert_eq!(flags.resolve(2), None);
            assert_eq!(flags.resolve(3), None);
            flags.values.insert(0, 42);
            assert_eq!(flags.resolve(2), Some(42));
            assert_eq!(flags.resolve(3), Some(42));
            assert_eq!(flags.resolve(0), Some(0));
        }
        check::<256>();
        check::<640>();
        check::<5120>();
    }

    #[test]
    fn observed_flag_deserialization_rejects_out_of_bounds_and_duplicate_entries() {
        use serde::de::value::{Error, MapDeserializer};
        let valid = MapDeserializer::<_, Error>::new([(255u16, true)].into_iter());
        assert_eq!(
            deserialize_flag_values::<_, bool, 256>(valid)
                .unwrap()
                .get(&255),
            Some(&true)
        );
        let invalid = MapDeserializer::<_, Error>::new([(256u16, true)].into_iter());
        assert!(deserialize_flag_values::<_, bool, 256>(invalid).is_err());
        let duplicate = MapDeserializer::<_, Error>::new([(1u16, true), (1, false)].into_iter());
        assert!(deserialize_flag_values::<_, bool, 256>(duplicate).is_err());
        let excessive = MapDeserializer::<_, Error>::new((0..65_537u32).map(|key| (key, ())));
        assert!(deserialize_flag_descriptors(excessive).is_err());
    }

    #[test]
    fn native_queries_preserve_unsigned_bytes_and_both_state_branches() {
        use ObservedMenuQueryValue::{Boolean, Byte};
        for native_byte in [0, 1, 2, 3, u8::MAX] {
            let observed = ObservedMenuNativeState {
                context_69c8_field_2cac6f: Some(native_byte),
                context_69a8_field_9f10: Some(200),
                context_69a8_field_9f13: Some(255),
                ..Default::default()
            };
            assert_eq!(
                observed.resolve_general_command(0x1953_DBC1),
                Some(Boolean(native_byte == 2))
            );
            assert_eq!(
                observed.resolve_general_command(0xB314_C568),
                Some(Byte(native_byte))
            );
            assert_eq!(
                observed.resolve_general_command(0xEF7B_C853),
                Some(Byte(if native_byte == 2 { 0 } else { 2 }))
            );
            assert_eq!(
                observed.resolve_general_command(0xDD5C_4CD4),
                Some(Byte(if native_byte == 2 { 255 } else { 200 }))
            );
        }
    }

    #[test]
    fn native_queries_require_only_the_observed_selected_branch() {
        let mut observed = ObservedMenuNativeState::default();
        for id in [0x1953_DBC1, 0xB314_C568, 0xEF7B_C853, 0xDD5C_4CD4] {
            assert_eq!(observed.resolve_general_command(id), None);
        }
        observed.context_69c8_field_2cac6f = Some(2);
        observed.context_69a8_field_9f10 = Some(10);
        assert_eq!(observed.resolve_general_command(0xDD5C_4CD4), None);
        observed.context_69a8_field_9f13 = Some(13);
        assert_eq!(
            observed.resolve_general_command(0xDD5C_4CD4),
            Some(ObservedMenuQueryValue::Byte(13))
        );
        observed.context_69c8_field_2cac6f = Some(1);
        observed.context_69a8_field_9f13 = None;
        assert_eq!(
            observed.resolve_general_command(0xDD5C_4CD4),
            Some(ObservedMenuQueryValue::Byte(10))
        );
        assert_eq!(observed.resolve_general_command(0xDEAD_BEEF), None);
    }
}
