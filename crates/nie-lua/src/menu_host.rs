//! Hôte de menu Lua — `MenuState` + `install_menu_host` + `run_menu`.
//!
//! Reproduit le comportement de `GameLuaHost.cs` (iecode) : enregistre les
//! fonctions hôtes comme globals Lua, chacune mutant un [`MenuState`] partagé.
//!
//! ## Dispatch `funcLuaMenuCommand`
//!
//! Le jeu appelle `funcLuaMenuCommand(cmdId, layerId, …args)` où `cmdId` est
//! un hash 32 bits d'un nom de commande interne du moteur C++. Ces hashes sont
//! reversés depuis `nie.exe` et documentés dans `re/lua/funclua-cmdids.json`
//! (iecode) ; les valeurs confirmées sont codées en dur ici.
//!
//! Pour les `cmdId` non encore reversés, l'appel est journalisé et ignoré
//! (retour `0.0`) — le script continue sans crash, conformément au comportement
//! du stub `DefaultLuaHost`.
//!
//! ## Hashes connus (source : `GameLuaHostTests.cs`)
//!
//! | Hash         | Opération          |
//! |:-------------|:-------------------|
//! | `0x2A64B198` | `SetObjectVisible` |
//! | `0xE15FD945` | `SetSprite`        |
//! | `0x4096E67E` | `SetText`          |

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::rc::Rc;

use mlua::{Lua, Value, Variadic};

use crate::LuaError;

// ---------------------------------------------------------------------------
// Modèle MenuState (miroir de MenuState.cs / MenuLayerState.cs / MenuObjectState.cs)
// ---------------------------------------------------------------------------

/// État d'un objet (widget) dans un layer de menu, muté par `funcLuaMenuCommand`.
///
/// Les champs `Option<_>` ne sont renseignés que lorsqu'une commande les a
/// touchés — un consommateur en aval n'applique que les mutations réelles.
#[derive(Debug, Clone)]
pub struct MenuObjectState {
    /// Hash CRC32 de l'objet (clé dans le layer).
    pub id: u32,
    /// Nom résolu de l'objet (ou `None` si inconnu).
    pub name: Option<String>,
    /// Visibilité (`SetObjectVisible` / `SetObjectFlag`). Défaut : `true`.
    pub visible: bool,
    /// Actif / interactif (`SetObjectActive` / `SetButtonEnabled`). Défaut : `true`.
    pub active: bool,
    /// Hash de texture du sprite (`SetSprite` / `SetIconTexture`).
    pub sprite_texture_hash: Option<u32>,
    /// Index de frame dans l'atlas (`SetSprite`).
    pub frame: Option<i32>,
    /// Teinte couleur, hash de palette (`SetSprite` / `SetColorTint`).
    pub color_hash: Option<u32>,
    /// Couleur RGBA explicite, packée `0xRRGGBBAA` (`SetObjectColorRGBA`).
    pub color_rgba: Option<u32>,
    /// Texte affiché (`SetText` / `SetTextMulti`). Hash stocké en hex si non résolu.
    pub text: Option<String>,
    /// Valeur numérique (`SetNumericDisplay` / `SetObjectNum`).
    pub number: Option<i32>,
    /// Index de défilement (`SetScrollIndex`).
    pub scroll_index: Option<i32>,
    /// Échelle (`SetObjectScale`).
    pub scale: Option<f32>,
    /// Valeur de badge (`SetBadge`).
    pub badge: Option<i32>,
    /// Barre de progression (`SetProgressBar`).
    pub progress: Option<f32>,
}

impl MenuObjectState {
    fn new(id: u32) -> Self {
        Self {
            id,
            name: None,
            visible: true,
            active: true,
            sprite_texture_hash: None,
            frame: None,
            color_hash: None,
            color_rgba: None,
            text: None,
            number: None,
            scroll_index: None,
            scale: None,
            badge: None,
            progress: None,
        }
    }
}

/// État d'un layer de menu (fenêtre/écran logique). Contient ses objets mutés.
#[derive(Debug, Clone)]
pub struct MenuLayerState {
    /// Hash CRC32 du layer.
    pub id: u32,
    /// Nom résolu du layer (ou `None` si inconnu).
    pub name: Option<String>,
    /// Visibilité du layer (`SetLayerVisible`). Défaut : `true`.
    pub visible: bool,
    /// Activé (`SetLayerEnabled`). Défaut : `true`.
    pub enabled: bool,
    /// Index focus courant (`SetFocus`).
    pub focus: Option<i32>,
    /// Item courant sélectionné (`SetCurrentItem`).
    pub current_item: Option<i32>,
    /// Objets du layer, par hash.
    pub objects: BTreeMap<u32, MenuObjectState>,
}

impl MenuLayerState {
    fn new(id: u32) -> Self {
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

    /// Récupère ou crée l'état d'un objet par son hash.
    pub fn obj(&mut self, object_id: u32) -> &mut MenuObjectState {
        self.objects.entry(object_id).or_insert_with(|| MenuObjectState::new(object_id))
    }
}

/// État de menu reconstruit en exécutant la logique Lua du jeu.
///
/// Équivalent Rust de l'état que `nie.exe` construit en mémoire — consommé
/// ensuite par le rendu (azalee) pour afficher le menu interactif piloté par
/// les vrais scripts.
#[derive(Debug, Clone, Default)]
pub struct MenuState {
    /// Layers par hash, dans l'ordre d'insertion (BTreeMap = ordre déterministe).
    pub layers: BTreeMap<u32, MenuLayerState>,
    /// Visibilité par groupe (`SetGroupVisible`).
    pub groups: BTreeMap<u32, bool>,
    /// Journal des appels `funcLuaMenuCommand` non reconnus :
    /// `(cmdId, layerId, args_repr)` pour la découverte de nouveaux hashes.
    pub unknown_cmd_log: Vec<(u32, u32, String)>,
    /// Journal de TOUS les appels connus (nom, layerId) — télémétrie légère.
    pub known_cmd_log: Vec<(String, u32)>,
}

impl MenuState {
    /// Récupère ou crée l'état d'un layer par son hash.
    pub fn layer(&mut self, layer_id: u32) -> &mut MenuLayerState {
        self.layers.entry(layer_id).or_insert_with(|| MenuLayerState::new(layer_id))
    }
}

// ---------------------------------------------------------------------------
// Hashes de commandes reversés (source : GameLuaHostTests.cs)
// ---------------------------------------------------------------------------

// Confirmés par les tests iecode (GameLuaHostTests.cs) :
const CMD_SET_OBJECT_VISIBLE: u32  = 0x2A64B198;
const CMD_SET_SPRITE: u32          = 0xE15FD945;
const CMD_SET_TEXT: u32            = 0x4096E67E;

// ---------------------------------------------------------------------------
// Helpers de décodage des arguments Lua (tous les nombres arrivent en f64)
// ---------------------------------------------------------------------------

fn lua_to_u32(v: Option<&Value>) -> u32 {
    match v {
        Some(Value::Number(n)) => *n as i64 as u32,
        Some(Value::Integer(i)) => *i as u32,
        _ => 0,
    }
}

fn lua_to_i32(v: Option<&Value>) -> i32 {
    match v {
        Some(Value::Number(n)) => *n as i64 as i32,
        Some(Value::Integer(i)) => *i as i32,
        _ => 0,
    }
}

fn lua_to_bool(v: Option<&Value>, default: bool) -> bool {
    match v {
        None => default,
        Some(Value::Boolean(b)) => *b,
        Some(Value::Number(n))  => *n != 0.0,
        Some(Value::Integer(i)) => *i != 0,
        Some(Value::Nil)        => false,
        _                       => default,
    }
}

fn lua_to_u32_or_none(v: Option<&Value>) -> Option<u32> {
    match v {
        Some(Value::Number(n)) => Some(*n as i64 as u32),
        Some(Value::Integer(i)) => Some(*i as u32),
        _ => None,
    }
}

/// Représentation textuelle d'une valeur Lua (pour le journal de découverte).
fn value_repr(v: &Value) -> String {
    match v {
        Value::Nil         => "nil".to_string(),
        Value::Boolean(b)  => b.to_string(),
        Value::Integer(i)  => format!("{i}"),
        Value::Number(n)   => {
            let u = *n as i64 as u32;
            if u as f64 == *n { format!("0x{u:08X}") } else { format!("{n}") }
        }
        Value::String(s)   => format!("{:?}", s.to_string_lossy()),
        Value::Table(_)    => "<table>".to_string(),
        Value::Function(_) => "<function>".to_string(),
        _                  => "<other>".to_string(),
    }
}

fn args_repr(args: &[Value]) -> String {
    args.iter().map(value_repr).collect::<Vec<_>>().join(", ")
}

// ---------------------------------------------------------------------------
// install_menu_host
// ---------------------------------------------------------------------------

/// Installe les fonctions hôtes de menu comme globals Lua et retourne le
/// [`MenuState`] partagé qu'elles vont muter.
///
/// Enregistre :
/// - `funcLuaMenuCommand(cmdId, layerId, …)` — dispatch principal menu.
/// - `funcLuaCommand(cmdId, …)` — no-op retournant `0` (stub traçant).
/// - `funcLuaActionCommand(…)` — no-op `0`.
/// - `funcLuaCameraCommand(…)` — no-op `0`.
/// - `funcLuaSpTacticsCommand(…)` — no-op `0`.
/// - `NameSettingBegin`, `AddNames`, `NameSettingEnd` — no-ops (retour nil).
/// - `IsCloseEndListLayer()` → `false`.
/// - `SetGuideStatusToLua`, `waitTrue`, `waitFalse` — no-ops.
/// - Stubs observés dans les scripts décompilés (iecode `LuaRuntime.cs`) :
///   `UpdateDetailWindowAttachBase`, `SaveAndShowWaitWindow`, `UploadSaveData`,
///   `OnCloseEndLayerCommon`, `OnChangeLayerGroupCommon`.
///
/// Note : `INCLUDE` n'est PAS installé ici — appelez [`crate::install_include`]
/// séparément pour connecter le résolveur VFS.
///
/// # Errors
/// [`mlua::Error`] si l'enregistrement d'un global échoue.
pub fn install_menu_host(lua: &Lua) -> mlua::Result<Rc<RefCell<MenuState>>> {
    let state = Rc::new(RefCell::new(MenuState::default()));

    // ── funcLuaMenuCommand(cmdId, layerId, …args) ─────────────────────────────
    {
        let state = Rc::clone(&state);
        let f = lua.create_function(move |_lua, args: Variadic<Value>| {
            let cmd_id   = lua_to_u32(args.first());
            let layer_id = lua_to_u32(args.get(1));
            let rest: Vec<Value> = args.into_iter().skip(2).collect();

            dispatch_menu_command(&mut state.borrow_mut(), cmd_id, layer_id, &rest);
            Ok(Value::Number(0.0))
        })?;
        lua.globals().set("funcLuaMenuCommand", f)?;
    }

    // ── funcLuaCommand(cmdId, …args) — stub traçant, retourne 0 ──────────────
    {
        let f = lua.create_function(|_lua, _args: Variadic<Value>| {
            Ok(Value::Number(0.0))
        })?;
        lua.globals().set("funcLuaCommand", f)?;
    }

    // ── funcLuaActionCommand / funcLuaCameraCommand / funcLuaSpTacticsCommand ─
    for name in &["funcLuaActionCommand", "funcLuaCameraCommand", "funcLuaSpTacticsCommand"] {
        let f = lua.create_function(|_lua, _args: Variadic<Value>| Ok(Value::Number(0.0)))?;
        lua.globals().set(*name, f)?;
    }

    // ── NameSettingBegin / AddNames / NameSettingEnd ──────────────────────────
    for name in &["NameSettingBegin", "AddNames", "NameSettingEnd"] {
        let f = lua.create_function(|_lua, _args: Variadic<Value>| Ok(()))?;
        lua.globals().set(*name, f)?;
    }

    // ── IsCloseEndListLayer() → false ─────────────────────────────────────────
    {
        let f = lua.create_function(|_lua, _args: ()| Ok(false))?;
        lua.globals().set("IsCloseEndListLayer", f)?;
    }

    // ── SetGuideStatusToLua / waitTrue / waitFalse — no-ops ───────────────────
    for name in &["SetGuideStatusToLua", "waitTrue", "waitFalse"] {
        let f = lua.create_function(|_lua, _args: Variadic<Value>| Ok(()))?;
        lua.globals().set(*name, f)?;
    }

    // ── Stubs supplémentaires observés dans les scripts (iecode LuaRuntime.cs) ─
    for name in &[
        "UpdateDetailWindowAttachBase",
        "SaveAndShowWaitWindow",
        "UploadSaveData",
        "OnCloseEndLayerCommon",
        "OnChangeLayerGroupCommon",
    ] {
        let f = lua.create_function(|_lua, _args: Variadic<Value>| Ok(()))?;
        lua.globals().set(*name, f)?;
    }

    Ok(state)
}

// ---------------------------------------------------------------------------
// Dispatch funcLuaMenuCommand
// ---------------------------------------------------------------------------

/// Dispatch principal : mute `state` en fonction du `cmd_id`.
///
/// Pour les commandes non encore reversées, l'appel est enregistré dans
/// `state.unknown_cmd_log` sans crasher le script.
fn dispatch_menu_command(
    state: &mut MenuState,
    cmd_id: u32,
    layer_id: u32,
    args: &[Value],
) {
    match cmd_id {
        // ── SetObjectVisible(objectId, visible) ────────────────────────────
        CMD_SET_OBJECT_VISIBLE => {
            state.known_cmd_log.push(("SetObjectVisible".to_string(), layer_id));
            let obj_id = lua_to_u32(args.first());
            let visible = lua_to_bool(args.get(1), true);
            state.layer(layer_id).obj(obj_id).visible = visible;
        }

        // ── SetSprite(objectId, texHash, frame?, colorHash?) ───────────────
        CMD_SET_SPRITE => {
            state.known_cmd_log.push(("SetSprite".to_string(), layer_id));
            let obj_id   = lua_to_u32(args.first());
            let tex_hash = lua_to_u32(args.get(1));
            let frame    = lua_to_i32(args.get(2));
            let color    = lua_to_u32_or_none(args.get(3));
            let obj = state.layer(layer_id).obj(obj_id);
            obj.sprite_texture_hash = Some(tex_hash);
            obj.frame               = Some(frame);
            obj.color_hash          = color;
        }

        // ── SetText / SetTextMulti(objectId, textHashOrString) ────────────
        CMD_SET_TEXT => {
            state.known_cmd_log.push(("SetText".to_string(), layer_id));
            let obj_id = lua_to_u32(args.first());
            let text = match args.get(1) {
                Some(Value::String(s)) => Some(s.to_string_lossy()),
                Some(v @ Value::Number(_)) | Some(v @ Value::Integer(_)) => {
                    let h = lua_to_u32(Some(v));
                    Some(format!("0x{h:08X}"))
                }
                _ => None,
            };
            state.layer(layer_id).obj(obj_id).text = text;
        }

        // ── Commande non reversée : journal pour découverte ────────────────
        _ => {
            let repr = args_repr(args);
            state.unknown_cmd_log.push((cmd_id, layer_id, repr));
        }
    }
}

// ---------------------------------------------------------------------------
// run_menu
// ---------------------------------------------------------------------------

/// Charge et exécute un script de menu `.lua.bin`, puis appelle `OnOpenLayer`
/// si le script l'a défini — c'est la convention moteur qui déclenche la
/// construction du menu.
///
/// Pré-condition : les globals hôtes doivent déjà être installés sur `lua`
/// (via [`install_menu_host`] et [`crate::install_include`]).
///
/// # Arguments
/// - `lua`          — VM Lua instrumentée.
/// - `script_bytes` — bytecode `.lua.bin` du script.
/// - `name`         — nom lisible (pour les messages d'erreur Lua).
/// - `layer_id`     — identifiant du layer à ouvrir (passé à `OnOpenLayer`).
///
/// # Retour
/// `Ok(true)` si `OnOpenLayer` a été trouvé et appelé ;
/// `Ok(false)` si le script ne définit pas `OnOpenLayer`.
///
/// # Errors
/// [`LuaError`] si le bytecode est invalide ou si la VM remonte une erreur.
pub fn run_menu(
    lua: &Lua,
    script_bytes: &[u8],
    name: &str,
    layer_id: u32,
) -> Result<bool, LuaError> {
    let func = crate::load_bytecode(lua, script_bytes, name)?;
    func.call::<()>(())?;

    // Convention moteur : le script définit OnOpenLayer(layerId) et/ou
    // OnSetupLayer(layerId). On appelle d'abord OnSetupLayer si présent, puis
    // OnOpenLayer (iecode LuaRuntime.cs).
    let setup: mlua::Value = lua.globals().get("OnSetupLayer")?;
    if let mlua::Value::Function(f) = setup {
        // tolérance : une erreur ici ne doit pas masquer OnOpenLayer
        let _ = f.call::<mlua::MultiValue>(layer_id as f64);
    }

    let on_open: mlua::Value = lua.globals().get("OnOpenLayer")?;
    if let mlua::Value::Function(f) = on_open {
        f.call::<()>(layer_id as f64)?;
        Ok(true)
    } else {
        Ok(false)
    }
}
