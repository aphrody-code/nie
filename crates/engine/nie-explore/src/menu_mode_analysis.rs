//! Shared VFS aggregation and Lua bytecode analysis for menu modes.

use std::collections::{BTreeMap, BTreeSet};

use nie_formats::cfgbin::{self, CfgEntry, Value};
use nie_formats::{objbin, vfs::Vfs};
use nie_lua::bytecode;

use crate::menu_modes::{ModeDef, matches_stem};

pub const SCREENS_ROOT: &str = "data/common/gamedata/menu/cfg/";
pub const SCREEN_SUFFIX: &str = "_setting.cfg.bin";
pub const OBJECTS_ROOT: &str = "data/common/gamedata/menu/obj/";
pub const OBJECT_SUFFIX: &str = ".objbin";
pub const SCRIPTS_ROOT: &str = "/script/lua/";
pub const SCRIPT_SUFFIX: &str = ".lua.bin";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScriptPath {
    pub path: String,
    pub stem: String,
    pub versionless_stem: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MenuPaths {
    pub screens: Vec<String>,
    pub objects: BTreeMap<String, String>,
    pub scripts: Vec<ScriptPath>,
}

impl MenuPaths {
    #[must_use]
    pub fn from_paths<I, P>(paths: I) -> Self
    where
        I: IntoIterator<Item = P>,
        P: AsRef<str>,
    {
        let mut out = Self::default();
        for path in paths {
            let path = path.as_ref();
            if path.starts_with(SCREENS_ROOT) && path.ends_with(SCREEN_SUFFIX) {
                out.screens.push(path.to_owned());
            } else if path.starts_with(OBJECTS_ROOT) && path.ends_with(OBJECT_SUFFIX) {
                if let Some(name) = stem(path, OBJECT_SUFFIX) {
                    out.objects.insert(name, path.to_owned());
                }
            } else if path.contains(SCRIPTS_ROOT)
                && path.ends_with(SCRIPT_SUFFIX)
                && let Some(name) = stem(path, SCRIPT_SUFFIX)
            {
                out.scripts.push(ScriptPath {
                    path: path.to_owned(),
                    versionless_stem: versionless(&name),
                    stem: name,
                });
            }
        }
        out
    }
}

#[must_use]
pub fn stem(path: &str, suffix: &str) -> Option<String> {
    path.rsplit('/')
        .next()?
        .strip_suffix(suffix)
        .map(str::to_owned)
}

#[must_use]
pub fn versionless(name: &str) -> String {
    name.split_once(char::is_numeric)
        .map_or(name, |(head, _)| head.trim_end_matches('_'))
        .to_owned()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModeScreen {
    pub screen: String,
    pub cfg: String,
    pub bytes: usize,
    pub layers: Vec<String>,
    pub focus: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModeCommand {
    pub cmd_id: u32,
    pub handler: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModeScript {
    pub path: String,
    pub bytes: usize,
    pub instructions: usize,
    pub functions: usize,
    pub includes: Vec<String>,
    pub commands: Vec<ModeCommand>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct ModeFacts {
    pub screens: Vec<ModeScreen>,
    pub layers: BTreeSet<String>,
    pub objbins: BTreeSet<String>,
    pub g4pkm: BTreeSet<String>,
    pub g4tx: BTreeSet<String>,
    pub components: BTreeMap<String, usize>,
    pub scripts: Vec<ModeScript>,
    pub text_slots: BTreeSet<(String, String, u32)>,
    pub focus: usize,
    pub unreadable: usize,
}

fn first_string(entry: &CfgEntry) -> Option<&str> {
    entry.variables.iter().find_map(|value| match value {
        Value::String(value) if !value.is_empty() => Some(value.as_str()),
        _ => None,
    })
}

fn walk<'a>(entries: &'a [CfgEntry], visit: &mut impl FnMut(&'a CfgEntry)) {
    for entry in entries {
        visit(entry);
        walk(&entry.children, visit);
    }
}

fn component_type_name(component: &objbin::MenuComponent) -> &str {
    use objbin::MenuComponent as M;
    match component {
        M::Render(value) => &value.type_name,
        M::Animation(value) => &value.type_name,
        M::Text(value) => &value.type_name,
        M::Primitive(value) => &value.type_name,
        M::AttachLocator(value) => &value.type_name,
        M::Collision(value) => &value.type_name,
        M::SoundCmd(value) => &value.type_name,
        M::MeshVisible(value) => &value.type_name,
        M::Unknown(value) => &value.type_name,
    }
}

#[must_use]
pub fn collect_mode(
    vfs: &Vfs,
    paths: &MenuPaths,
    definition: &ModeDef,
    handlers: &BTreeMap<u32, u64>,
) -> ModeFacts {
    let mut facts = ModeFacts::default();
    for path in &paths.screens {
        let Some(name) = stem(path, SCREEN_SUFFIX) else {
            continue;
        };
        if !matches_stem(definition, &name) {
            continue;
        }
        let Ok(bytes) = vfs.read(path) else {
            facts.unreadable += 1;
            continue;
        };
        let Ok(file) = cfgbin::parse_t2b(&bytes) else {
            facts.unreadable += 1;
            continue;
        };
        let (mut layers, mut focus) = (Vec::new(), 0);
        walk(&file.entries, &mut |entry| {
            if entry.name.contains("LIST_BEG") || entry.name.contains("LIST_END") {
                return;
            }
            if entry.name.starts_with("MENU_LAYER_INFO") {
                if let Some(name) = first_string(entry) {
                    layers.push(name.to_owned());
                }
            } else if entry.name.starts_with("MENU_FOCUS_BASE_INFO") {
                focus += 1;
            }
        });
        facts.focus += focus;
        facts.layers.extend(layers.iter().cloned());
        facts.screens.push(ModeScreen {
            screen: name,
            cfg: path.clone(),
            bytes: bytes.len(),
            layers,
            focus,
        });
    }
    facts
        .screens
        .sort_by(|left, right| left.screen.cmp(&right.screen));

    for layer in facts.layers.clone() {
        let Some(path) = paths.objects.get(&layer) else {
            continue;
        };
        facts.objbins.insert(path.clone());
        let Ok(bytes) = vfs.read(path) else {
            facts.unreadable += 1;
            continue;
        };
        let Ok(object) = objbin::parse(&bytes) else {
            facts.unreadable += 1;
            continue;
        };
        if let Some(path) = &object.g4pkm_path {
            facts.g4pkm.insert(path.clone());
        }
        if let Some(path) = &object.g4tx_path {
            facts.g4tx.insert(path.clone());
        }
        for component in &object.components {
            *facts
                .components
                .entry(component_type_name(component).to_owned())
                .or_default() += 1;
            match component {
                objbin::MenuComponent::Unknown(value) => {
                    for path in value.strings().filter(|path| path.ends_with(".g4tx")) {
                        facts.g4tx.insert(path.to_owned());
                    }
                }
                objbin::MenuComponent::Text(value) => {
                    for entry in &value.entries {
                        for hash in &entry.hashes {
                            if *hash != 0 {
                                facts.text_slots.insert((
                                    object.name.clone(),
                                    entry.key.clone(),
                                    *hash,
                                ));
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    }
    for script in &paths.scripts {
        if !matches_stem(definition, &script.stem)
            && !matches_stem(definition, &script.versionless_stem)
        {
            continue;
        }
        let Ok(bytes) = vfs.read(&script.path) else {
            facts.unreadable += 1;
            facts.scripts.push(ModeScript {
                path: script.path.clone(),
                bytes: 0,
                instructions: 0,
                functions: 0,
                includes: Vec::new(),
                commands: Vec::new(),
                error: Some("script indexed but unreadable in this VFS".to_owned()),
            });
            continue;
        };
        facts
            .scripts
            .push(analyze_mode_script(&script.path, &bytes, handlers));
    }
    facts
        .scripts
        .sort_by(|left, right| left.path.cmp(&right.path));
    facts
}

#[must_use]
pub fn analyze_mode_script(path: &str, bytes: &[u8], handlers: &BTreeMap<u32, u64>) -> ModeScript {
    let chunk = match bytecode::parse(bytes) {
        Ok(chunk) => chunk,
        Err(error) => {
            return ModeScript {
                path: path.to_owned(),
                bytes: bytes.len(),
                instructions: 0,
                functions: 0,
                includes: Vec::new(),
                commands: Vec::new(),
                error: Some(format!("Lua 5.2 bytecode not recognized: {error}")),
            };
        }
    };
    let mut includes = BTreeSet::new();
    let mut command_ids = BTreeSet::new();
    walk_prototype(&chunk.main, &mut includes, &mut command_ids, handlers);
    ModeScript {
        path: path.to_owned(),
        bytes: bytes.len(),
        instructions: chunk.main.total_instructions(),
        functions: chunk.main.total_protos() + 1,
        includes: includes.into_iter().collect(),
        commands: command_ids
            .into_iter()
            .filter_map(|cmd_id| {
                handlers.get(&cmd_id).map(|handler| ModeCommand {
                    cmd_id,
                    handler: *handler,
                })
            })
            .collect(),
        error: None,
    }
}

fn walk_prototype(
    prototype: &bytecode::Prototype,
    includes: &mut BTreeSet<String>,
    command_ids: &mut BTreeSet<u32>,
    handlers: &BTreeMap<u32, u64>,
) {
    for constant in &prototype.constants {
        match constant {
            bytecode::Constant::String(bytes) => {
                if let Ok(value) = core::str::from_utf8(bytes)
                    && value.starts_with("LUA_")
                {
                    includes.insert(value.to_owned());
                }
            }
            bytecode::Constant::Number(value)
                if *value >= 0.0 && value.fract() == 0.0 && *value <= f64::from(u32::MAX) =>
            {
                #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
                let id = *value as u32;
                if handlers.contains_key(&id) {
                    command_ids.insert(id);
                }
            }
            _ => {}
        }
    }
    for child in &prototype.protos {
        walk_prototype(child, includes, command_ids, handlers);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_inventory_preserves_versioned_scripts_and_object_stems() {
        let paths = MenuPaths::from_paths([
            "data/common/gamedata/menu/cfg/story_mode_top_setting.cfg.bin",
            "data/common/gamedata/menu/obj/story_layer.objbin",
            "data/common/script/lua/story_mode_top_1.2.3.lua.bin",
            "data/unrelated.bin",
        ]);
        assert_eq!(paths.screens.len(), 1);
        assert_eq!(
            paths.objects["story_layer"],
            "data/common/gamedata/menu/obj/story_layer.objbin"
        );
        assert_eq!(paths.scripts[0].versionless_stem, "story_mode_top");
    }

    #[test]
    fn invalid_bytecode_is_explicit_in_the_shared_result() {
        let script = analyze_mode_script("data/x.lua.bin", b"not bytecode", &BTreeMap::new());
        assert_eq!(script.bytes, 12);
        assert_eq!(script.instructions, 0);
        assert!(
            script
                .error
                .as_deref()
                .is_some_and(|error| error.contains("Lua 5.2"))
        );
    }
}
