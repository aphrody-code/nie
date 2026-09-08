//! Bounded, portable VFS menu replay shared by native hosts and HTTP adapters.
use std::{cell::RefCell, collections::BTreeMap, rc::Rc};

use serde::{Deserialize, Serialize};

use crate::{
    CallbackArg, MenuCallback, MenuEvent,
    host::{HostRegistry, LogSink},
    menu_scene::MenuScene,
    menu_state::ObservedMenuNativeState,
    session::LuaSession,
};

pub const MAX_EVENTS: usize = 64;
pub const MAX_SCRIPT_BYTES: usize = 8 * 1024 * 1024;
const INSTRUCTION_LIMIT: u32 = 2_000_000;

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum EventValue {
    Number(f64),
    Boolean(bool),
    String(String),
    Nil,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReplayEvent {
    pub callback: String,
    #[serde(default)]
    pub args: Vec<EventValue>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReplayRequest {
    #[serde(default = "default_locale")]
    pub locale: String,
    #[serde(default)]
    pub events: Vec<ReplayEvent>,
    /// Explicit scene observations, never guessed from an unrelated screenshot.
    #[serde(default)]
    pub item_counts: BTreeMap<u32, i32>,
    #[serde(default)]
    pub observed_native: ObservedMenuNativeState,
}

fn default_locale() -> String {
    "fr".into()
}

impl Default for ReplayRequest {
    fn default() -> Self {
        Self {
            locale: default_locale(),
            events: Vec::new(),
            item_counts: BTreeMap::new(),
            observed_native: ObservedMenuNativeState::default(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayOutput {
    pub scene: MenuScene,
    /// Callback replay completeness only; this is never a visual or gameplay parity verdict.
    /// False whenever known host gaps or requested callbacks remain unresolved.
    pub complete: bool,
    pub events_applied: usize,
    pub callbacks: Vec<String>,
}

impl ReplayRequest {
    pub fn events(&self) -> Result<Vec<MenuEvent>, String> {
        if !["fr", "en", "ja"].contains(&self.locale.as_str()) {
            return Err("Unsupported menu locale".into());
        }
        if self.events.len() > MAX_EVENTS
            || self.item_counts.len() > 256
            || self
                .item_counts
                .values()
                .any(|count| !(0..=256).contains(count))
            || self
                .item_counts
                .values()
                .map(|count| i64::from(*count))
                .sum::<i64>()
                > 512
        {
            return Err("Menu replay exceeds input limits".into());
        }
        self.events
            .iter()
            .map(|event| {
                let callback = MenuCallback::ALL
                    .into_iter()
                    .find(|value| value.as_str() == event.callback)
                    .ok_or("Unknown menu callback")?;
                if event.args.len() > 8 {
                    return Err("Too many callback arguments".into());
                }
                let args = event
                    .args
                    .iter()
                    .map(|arg| match arg {
                        EventValue::Number(value) if value.is_finite() => {
                            Ok(CallbackArg::Number(*value))
                        }
                        EventValue::Boolean(value) => Ok(CallbackArg::Boolean(*value)),
                        EventValue::String(value) if value.len() <= 1024 => {
                            Ok(CallbackArg::String(value.clone()))
                        }
                        EventValue::Nil => Ok(CallbackArg::Nil),
                        _ => Err("Invalid callback argument".to_string()),
                    })
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(MenuEvent::new(callback).with_args(args))
            })
            .collect()
    }
}

/// Execute only trusted, indexed game chunks. The caller supplies VFS reads, never source text.
/// Replaying a bounded input history keeps requests isolated without serializing VM internals.
pub fn replay<I, F>(
    paths: I,
    reader: F,
    script: &str,
    layers: &[u32],
    localized_text: BTreeMap<u32, String>,
    request: ReplayRequest,
) -> Result<ReplayOutput, String>
where
    I: IntoIterator<Item = String>,
    F: Fn(&str) -> Option<Vec<u8>> + 'static,
{
    let events = request.events()?;
    if layers.is_empty() || layers.len() > 256 {
        return Err("Invalid menu layer count".into());
    }
    let logs: LogSink = Rc::new(RefCell::new(Vec::new()));
    let registry = HostRegistry::standard(Rc::clone(&logs));
    let mut session = LuaSession::with_script_paths(registry, logs, true, paths, move |path| {
        let bytes = reader(path)?;
        (bytes.len() <= MAX_SCRIPT_BYTES && crate::is_lua52_bytecode(&bytes)).then_some(bytes)
    })
    .map_err(|e| e.to_string())?;
    session
        .lua()
        .set_memory_limit(64 * 1024 * 1024)
        .map_err(|e| e.to_string())?;
    // VFS INCLUDE is the only loader. Host execution never exposes filesystem/process primitives.
    for name in [
        "io",
        "os",
        "debug",
        "package",
        "require",
        "dofile",
        "loadfile",
        "load",
        "loadstring",
    ] {
        session
            .lua()
            .globals()
            .set(name, mlua::Value::Nil)
            .map_err(|e| e.to_string())?;
    }
    let state = session.menu_state().ok_or("Menu state unavailable")?;
    state
        .borrow_mut()
        .set_observed_native_state(request.observed_native);
    state.borrow_mut().text_by_id = localized_text;
    let drive = session
        .drive_menu_vfs_for_frames_with_limit(
            script,
            layers,
            &request.item_counts,
            1,
            Some(INSTRUCTION_LIMIT),
        )
        .map_err(|e| e.to_string())?;
    if !drive.top_level_ok {
        return Err("Menu initialization failed".into());
    }
    let report = session
        .dispatch_menu_events_with_limit(&events, Some(INSTRUCTION_LIMIT))
        .map_err(|e| e.to_string())?;
    let state = state.borrow();
    if state
        .layers
        .values()
        .map(|layer| layer.objects.len())
        .sum::<usize>()
        > 8192
    {
        return Err("Menu scene exceeds object limit".into());
    }
    let complete = drive.on_init != Some(false)
        && drive.callback_errors.is_empty()
        && drive.missing_host_calls.is_empty()
        && drive.missing_host_paths.is_empty()
        && report.events_succeeded == events.len()
        && report.callback_errors.is_empty()
        && session.api_report().missing.is_empty()
        && session.take_missing_includes().is_empty()
        && state.unknown_cmd_log.is_empty()
        && state.unknown_general_cmd_log.is_empty();
    let callbacks = MenuCallback::ALL
        .into_iter()
        .filter(|callback| {
            matches!(
                session
                    .lua()
                    .globals()
                    .raw_get::<mlua::Value>(callback.as_str()),
                Ok(mlua::Value::Function(_))
            )
        })
        .map(|callback| callback.as_str().to_owned())
        .collect();
    Ok(ReplayOutput {
        scene: MenuScene::from_state(&state),
        complete,
        events_applied: report.events_succeeded,
        callbacks,
    })
}
