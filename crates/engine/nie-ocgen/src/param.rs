//! `CHARA_EDIT_PARAM` — the avatar document the character editor saves and the runtime loads.
//!
//! ## Ground truth
//!
//! `data/common/chr/_test/default/edit_parameter.cfg.bin.json`, decoded to the iecode JSON form.
//! The tree is one `CHARA_EDIT_PARAM_LIST_BEG` holding flat sibling runs; grouping is carried by
//! **order**, not by nesting:
//!
//! ```text
//! CHARA_EDIT_PARAM_LIST_BEG           [Int]                 list flag
//!   CHARA_EDIT_PARAM                  [String]              document name
//!   CHARA_EDIT_PARAM_TEX_PARTS_LIST_BEG
//!     CHARA_EDIT_PARAM_TEX_PARTS      [Int Int F F F F F]   slot, texture, 5 params
//!     CHARA_EDIT_PARAM_TEX_PARTS_COLOR[Int Int Int Int Int] colour slot, R, G, B, A   (0..n)
//!     CHARA_EDIT_PARAM_TEX_PARTS_LEFT [Int F F F F F]       mirrored half, optional
//!     CHARA_EDIT_PARAM_TEX_PARTS_COLOR...                   colours of the mirrored half
//!     CHARA_EDIT_PARAM_TEX_PARTS_RIGHT[F F F F F]           closes the mirrored half
//!   CHARA_EDIT_PARAM_MDL_PARTS_LIST_BEG
//!     CHARA_EDIT_PARAM_MDL_PART       [Int Int String]      slot, resource hash, resource name
//!     CHARA_EDIT_PARAM_MDL_COLOR      [Int Int Int Int]     R, G, B, A
//!   CHARA_EDIT_PARAM_MDL_BONE         [Int]                 bone hash
//!   MDL_BONE_TRANS / MDL_BONE_ROT / MDL_BONE_SCALE  [F F F]
//!   CHARA_EDIT_PARAM_SETTING_LIST_BEG                       trailing, optional
//!     CHARA_EDIT_PARAM_SETTING        [Int Int]             setting hash, value
//! ```
//!
//! The `SETTING` list closes the document and is absent from `edit_parameter`; the sixteen
//! `mdl_editpreview_avatar_*` morphology documents all carry one. It is therefore modelled as an
//! `Option`, so a template without the list does not gain one on the way out.
//!
//! Node suffixes `_N` count occurrences of one name **inside one sibling group**, restarting at
//! every level — the converter's own rule
//! (`nie_formats::cfgbin::t2b_siblings_to_iecode_json`). On these documents a global tally would
//! give the same names, because no node kind appears in two groups; the two rules are still not
//! the same rule, and the coincidence is not something to build on.
//!
//! Every slot identifier here is a hash whose preimage the repository has not measured. Parsing a
//! real template and re-emitting the same document is the only claim this module makes; it never
//! synthesises a slot hash.

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::Error;

/// A colour row attached to the texture part that precedes it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TexColor {
    /// First `Int` — the colour slot hash (skin, hair, iris... preimage unmeasured).
    pub slot: i64,
    /// `[R, G, B, A]`, stored as read: the dumps use `Int`, not a byte type.
    pub rgba: [i64; 4],
}

/// The mirrored half of a texture part: `LEFT`, its own colours, then `RIGHT`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TexMirror {
    /// `LEFT` first `Int` — slot hash of the mirrored placement.
    pub slot: i64,
    /// `LEFT` five floats.
    pub left: [f64; 5],
    /// Colour rows between `LEFT` and `RIGHT`.
    pub colors: Vec<TexColor>,
    /// `RIGHT` five floats — no leading `Int` in this node.
    pub right: [f64; 5],
}

/// One texture part: the head node, its colours, and an optional mirrored half.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TexPart {
    /// Slot hash.
    pub slot: i64,
    /// Texture hash.
    pub texture: i64,
    /// Five floats — placement/scale, semantics unmeasured.
    pub params: [f64; 5],
    /// Colour rows owned by this part.
    pub colors: Vec<TexColor>,
    /// Mirrored half, when the part has one.
    pub mirror: Option<TexMirror>,
}

/// One model part and the colour row that follows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MdlPart {
    /// Slot hash.
    pub slot: i64,
    /// Resource name hash.
    pub resource_hash: i64,
    /// Resource name as stored (`body_type_02`, `u010101_10`...).
    pub resource: String,
    /// `[R, G, B, A]` of the following `MDL_COLOR`.
    pub rgba: [i64; 4],
}

/// One bone edit: the bone hash and its translation, rotation and scale triples.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BoneEdit {
    /// Bone hash.
    pub bone: i64,
    /// `MDL_BONE_TRANS`.
    pub trans: [f64; 3],
    /// `MDL_BONE_ROT`.
    pub rot: [f64; 3],
    /// `MDL_BONE_SCALE`.
    pub scale: [f64; 3],
}

/// One `CHARA_EDIT_PARAM_SETTING` row: a setting hash and its value.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Setting {
    /// Setting hash.
    pub key: i64,
    /// Stored value.
    pub value: i64,
}

/// A complete avatar document.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CharaEditParam {
    /// `CHARA_EDIT_PARAM_LIST_BEG` single `Int`.
    pub list_flag: i64,
    /// `CHARA_EDIT_PARAM` single `String` — empty in the shipped template.
    pub name: String,
    /// Texture parts, in document order.
    pub tex_parts: Vec<TexPart>,
    /// Model parts, in document order.
    pub mdl_parts: Vec<MdlPart>,
    /// Bone edits, in document order.
    pub bones: Vec<BoneEdit>,
    /// Trailing setting list — `None` when the document carries no `SETTING_LIST_BEG` at all.
    pub settings: Option<Vec<Setting>>,
}

/// A flattened `(name-without-suffix, variables)` node.
struct Node<'a> {
    kind: &'a str,
    vars: &'a [Value],
}

/// Strips the `_N` counter a converted node carries.
fn kind_of(name: &str) -> &str {
    match name.rsplit_once('_') {
        Some((head, tail)) if !tail.is_empty() && tail.bytes().all(|b| b.is_ascii_digit()) => head,
        _ => name,
    }
}

/// Flattens the tree depth-first, preserving document order.
fn flatten<'a>(value: &'a Value, out: &mut Vec<Node<'a>>) {
    if let Some(items) = value.as_array() {
        for item in items {
            flatten(item, out);
        }
        return;
    }
    let Some(object) = value.as_object() else {
        return;
    };
    if let Some(name) = object.get("name").and_then(Value::as_str) {
        let vars = object
            .get("variables")
            .and_then(Value::as_array)
            .map_or(&[][..], Vec::as_slice);
        out.push(Node {
            kind: kind_of(name),
            vars,
        });
    }
    if let Some(children) = object.get("children") {
        flatten(children, out);
    }
}

/// Reads a `value` field, which the converter always stores as a string.
fn raw(vars: &[Value], index: usize, kind: &str) -> Result<String, Error> {
    let value = vars
        .get(index)
        .and_then(|v| v.get("value"))
        .ok_or_else(|| Error::Format(format!("{kind}: variable {index} absente")))?;
    match value {
        Value::String(text) => Ok(text.clone()),
        other => Ok(other.to_string()),
    }
}

/// Reads an integer variable.
fn int(vars: &[Value], index: usize, kind: &str) -> Result<i64, Error> {
    let text = raw(vars, index, kind)?;
    text.parse::<i64>().map_err(|_| {
        Error::Format(format!(
            "{kind}: variable {index} \u{ab} {text} \u{bb} n'est pas un entier"
        ))
    })
}

/// Reads a float variable.
fn float(vars: &[Value], index: usize, kind: &str) -> Result<f64, Error> {
    let text = raw(vars, index, kind)?;
    text.parse::<f64>().map_err(|_| {
        Error::Format(format!(
            "{kind}: variable {index} \u{ab} {text} \u{bb} n'est pas un flottant"
        ))
    })
}

/// Reads `N` consecutive floats starting at `start`.
fn floats<const N: usize>(vars: &[Value], start: usize, kind: &str) -> Result<[f64; N], Error> {
    let mut out = [0.0; N];
    for (offset, slot) in out.iter_mut().enumerate() {
        *slot = float(vars, start + offset, kind)?;
    }
    Ok(out)
}

/// Reads the four `Int` channels of a colour node.
fn rgba(vars: &[Value], start: usize, kind: &str) -> Result<[i64; 4], Error> {
    let mut out = [0; 4];
    for (offset, slot) in out.iter_mut().enumerate() {
        *slot = int(vars, start + offset, kind)?;
    }
    Ok(out)
}

impl CharaEditParam {
    /// Parses a decoded `edit_parameter.cfg.bin.json` document.
    ///
    /// # Errors
    ///
    /// Returns [`Error::Format`] when a node carries fewer variables than its type requires, or
    /// when a colour, `LEFT` or `RIGHT` node appears before the part that would own it.
    pub fn parse(root: &Value) -> Result<Self, Error> {
        let entries = root.get("entries").unwrap_or(root);
        let mut nodes = Vec::new();
        flatten(entries, &mut nodes);

        let mut out = Self {
            list_flag: 0,
            name: String::new(),
            tex_parts: Vec::new(),
            mdl_parts: Vec::new(),
            bones: Vec::new(),
            settings: None,
        };
        for node in &nodes {
            let (kind, vars) = (node.kind, node.vars);
            match kind {
                "CHARA_EDIT_PARAM_LIST_BEG" => out.list_flag = int(vars, 0, kind)?,
                "CHARA_EDIT_PARAM" => out.name = raw(vars, 0, kind)?,
                "CHARA_EDIT_PARAM_TEX_PARTS" => out.tex_parts.push(TexPart {
                    slot: int(vars, 0, kind)?,
                    texture: int(vars, 1, kind)?,
                    params: floats::<5>(vars, 2, kind)?,
                    colors: Vec::new(),
                    mirror: None,
                }),
                "CHARA_EDIT_PARAM_TEX_PARTS_LEFT" => {
                    let mirror = TexMirror {
                        slot: int(vars, 0, kind)?,
                        left: floats::<5>(vars, 1, kind)?,
                        colors: Vec::new(),
                        right: [0.0; 5],
                    };
                    out.tex_parts
                        .last_mut()
                        .ok_or_else(|| Error::Format(format!("{kind} sans TEX_PARTS parent")))?
                        .mirror = Some(mirror);
                }
                "CHARA_EDIT_PARAM_TEX_PARTS_RIGHT" => {
                    let right = floats::<5>(vars, 0, kind)?;
                    out.tex_parts
                        .last_mut()
                        .and_then(|part| part.mirror.as_mut())
                        .ok_or_else(|| Error::Format(format!("{kind} sans LEFT parent")))?
                        .right = right;
                }
                "CHARA_EDIT_PARAM_TEX_PARTS_COLOR" => {
                    let color = TexColor {
                        slot: int(vars, 0, kind)?,
                        rgba: rgba(vars, 1, kind)?,
                    };
                    let part = out
                        .tex_parts
                        .last_mut()
                        .ok_or_else(|| Error::Format(format!("{kind} sans TEX_PARTS parent")))?;
                    match part.mirror.as_mut() {
                        Some(mirror) => mirror.colors.push(color),
                        None => part.colors.push(color),
                    }
                }
                "CHARA_EDIT_PARAM_MDL_PART" => out.mdl_parts.push(MdlPart {
                    slot: int(vars, 0, kind)?,
                    resource_hash: int(vars, 1, kind)?,
                    resource: raw(vars, 2, kind)?,
                    rgba: [0; 4],
                }),
                "CHARA_EDIT_PARAM_MDL_COLOR" => {
                    let channels = rgba(vars, 0, kind)?;
                    out.mdl_parts
                        .last_mut()
                        .ok_or_else(|| Error::Format(format!("{kind} sans MDL_PART parent")))?
                        .rgba = channels;
                }
                "CHARA_EDIT_PARAM_MDL_BONE" => out.bones.push(BoneEdit {
                    bone: int(vars, 0, kind)?,
                    trans: [0.0; 3],
                    rot: [0.0; 3],
                    scale: [1.0; 3],
                }),
                "MDL_BONE_TRANS" | "MDL_BONE_ROT" | "MDL_BONE_SCALE" => {
                    let triple = floats::<3>(vars, 0, kind)?;
                    let bone = out
                        .bones
                        .last_mut()
                        .ok_or_else(|| Error::Format(format!("{kind} sans MDL_BONE parent")))?;
                    match kind {
                        "MDL_BONE_TRANS" => bone.trans = triple,
                        "MDL_BONE_ROT" => bone.rot = triple,
                        _ => bone.scale = triple,
                    }
                }
                "CHARA_EDIT_PARAM_SETTING_LIST_BEG" => out.settings = Some(Vec::new()),
                "CHARA_EDIT_PARAM_SETTING" => {
                    let setting = Setting {
                        key: int(vars, 0, kind)?,
                        value: int(vars, 1, kind)?,
                    };
                    out.settings.get_or_insert_with(Vec::new).push(setting);
                }
                _ => {}
            }
        }
        Ok(out)
    }

    /// Re-emits the document in the same iecode JSON form the converter produces.
    ///
    /// The `_N` suffix is counted **per sibling group**, which is the converter's own rule
    /// (`nie_formats::cfgbin::t2b_siblings_to_iecode_json` restarts its tally at every level).
    /// On these documents a global tally gives the same names, because no node kind appears in
    /// two different groups — but the two rules are not the same rule, and following the wrong
    /// one would only show up on the first document that breaks that coincidence.
    #[must_use]
    pub fn to_value(&self) -> Value {
        let mut root_counters = Counters::default();
        let mut top_counters = Counters::default();
        let mut top = vec![top_counters.leaf("CHARA_EDIT_PARAM", &[text(&self.name)])];

        let mut tex_counters = Counters::default();
        let mut tex = Vec::new();
        for part in &self.tex_parts {
            let mut vars = vec![number(part.slot), number(part.texture)];
            vars.extend(part.params.iter().map(|value| real(*value)));
            tex.push(tex_counters.leaf("CHARA_EDIT_PARAM_TEX_PARTS", &vars));
            for color in &part.colors {
                tex.push(tex_counters.leaf("CHARA_EDIT_PARAM_TEX_PARTS_COLOR", &color_vars(color)));
            }
            if let Some(mirror) = &part.mirror {
                let mut left = vec![number(mirror.slot)];
                left.extend(mirror.left.iter().map(|value| real(*value)));
                tex.push(tex_counters.leaf("CHARA_EDIT_PARAM_TEX_PARTS_LEFT", &left));
                for color in &mirror.colors {
                    tex.push(
                        tex_counters.leaf("CHARA_EDIT_PARAM_TEX_PARTS_COLOR", &color_vars(color)),
                    );
                }
                let right: Vec<Value> = mirror.right.iter().map(|value| real(*value)).collect();
                tex.push(tex_counters.leaf("CHARA_EDIT_PARAM_TEX_PARTS_RIGHT", &right));
            }
        }
        let tex_name = top_counters.name("CHARA_EDIT_PARAM_TEX_PARTS_LIST_BEG");
        top.push(node(tex_name, &[], tex));

        let mut mdl_counters = Counters::default();
        let mut mdl = Vec::new();
        for part in &self.mdl_parts {
            mdl.push(mdl_counters.leaf(
                "CHARA_EDIT_PARAM_MDL_PART",
                &[
                    number(part.slot),
                    number(part.resource_hash),
                    text(&part.resource),
                ],
            ));
            let colors: Vec<Value> = part.rgba.iter().map(|value| number(*value)).collect();
            mdl.push(mdl_counters.leaf("CHARA_EDIT_PARAM_MDL_COLOR", &colors));
        }
        let mdl_name = top_counters.name("CHARA_EDIT_PARAM_MDL_PARTS_LIST_BEG");
        top.push(node(mdl_name, &[], mdl));

        for bone in &self.bones {
            top.push(top_counters.leaf("CHARA_EDIT_PARAM_MDL_BONE", &[number(bone.bone)]));
            for (kind, triple) in [
                ("MDL_BONE_TRANS", bone.trans),
                ("MDL_BONE_ROT", bone.rot),
                ("MDL_BONE_SCALE", bone.scale),
            ] {
                let vars: Vec<Value> = triple.iter().map(|value| real(*value)).collect();
                top.push(top_counters.leaf(kind, &vars));
            }
        }

        if let Some(settings) = &self.settings {
            let mut setting_counters = Counters::default();
            let rows: Vec<Value> = settings
                .iter()
                .map(|setting| {
                    setting_counters.leaf(
                        "CHARA_EDIT_PARAM_SETTING",
                        &[number(setting.key), number(setting.value)],
                    )
                })
                .collect();
            let name = top_counters.name("CHARA_EDIT_PARAM_SETTING_LIST_BEG");
            top.push(node(name, &[], rows));
        }

        let root_name = root_counters.name("CHARA_EDIT_PARAM_LIST_BEG");
        json!({ "entries": [node(root_name, &[number(self.list_flag)], top)] })
    }
}

impl CharaEditParam {
    /// Encodes the document as a real `cfg.bin` T2B, through the shared encoder.
    ///
    /// What this establishes is bounded and worth stating exactly: the repository writes a file
    /// that the repository reads back identically — [`CharaEditParam::to_value`] on the re-decoded
    /// bytes returns this document. It does **not** establish that the game accepts the file. The
    /// repository's parser is more permissive than the game's, and only starting the game settles
    /// that.
    ///
    /// # Errors
    ///
    /// Returns [`Error::Format`] when the emitted tree cannot be encoded — in practice, a node
    /// that carries children without being named as a container, which the encoder refuses rather
    /// than dropping them.
    pub fn to_cfgbin(&self) -> Result<Vec<u8>, Error> {
        nie_formats::cfgbin::encode_iecode_t2b(&self.to_value())
            .map_err(|error| Error::Format(format!("encodage T2B : {error}")))
    }

    /// Decodes a `cfg.bin` T2B back into a document.
    ///
    /// # Errors
    ///
    /// Returns [`Error::Format`] when the bytes are not a T2B the repository can read, or when the
    /// decoded tree is not a `CHARA_EDIT_PARAM` document.
    pub fn from_cfgbin(bytes: &[u8]) -> Result<Self, Error> {
        let value = nie_formats::cfgbin::t2b_to_iecode_json(bytes).ok_or_else(|| {
            Error::Format("les octets ne se relisent pas comme du T2B".to_string())
        })?;
        Self::parse(&value)
    }
}

/// `_N` counters for one sibling group, so emitted names match the converter's numbering.
#[derive(Default)]
struct Counters(std::collections::BTreeMap<String, usize>);

impl Counters {
    /// Next name for `kind`, consuming one counter step.
    fn name(&mut self, kind: &str) -> String {
        let slot = self.0.entry(kind.to_string()).or_default();
        let index = *slot;
        *slot += 1;
        format!("{kind}_{index}")
    }

    /// A childless node of `kind` carrying `vars`.
    fn leaf(&mut self, kind: &str, vars: &[Value]) -> Value {
        let name = self.name(kind);
        node(name, vars, Vec::new())
    }
}

/// Builds one converted node.
fn node(name: String, vars: &[Value], children: Vec<Value>) -> Value {
    json!({ "children": children, "name": name, "variables": vars })
}

/// A `String` variable.
fn text(value: &str) -> Value {
    json!({ "type": "String", "value": value })
}

/// An `Int` variable — the converter stores the digits as a string.
fn number(value: i64) -> Value {
    json!({ "type": "Int", "value": value.to_string() })
}

/// A `Float` variable, formatted the way the converter does (shortest round-trip form).
fn real(value: f64) -> Value {
    json!({ "type": "Float", "value": format_float(value) })
}

/// Formats a float the way the converter does.
///
/// `Display` for `f64` is already the right function: it emits the shortest decimal that reads
/// back to the same value, drops the trailing `.0` on whole numbers, never falls back to
/// scientific notation, and keeps the sign of negative zero. That covers every value the dumps
/// hold — `0`, `1`, `-0`, `0.02`, `-0.004`, `0.19635001` — and the round-trip test is what says
/// so, on all seventeen documents rather than on this reasoning.
fn format_float(value: f64) -> String {
    format!("{value}")
}

/// The five variables of a colour node.
fn color_vars(color: &TexColor) -> Vec<Value> {
    let mut vars = vec![number(color.slot)];
    vars.extend(color.rgba.iter().map(|value| number(*value)));
    vars
}
