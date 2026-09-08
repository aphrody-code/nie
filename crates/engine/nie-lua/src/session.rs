//! **Session Lua persistante** — VM qui vit entre les appels, comportements attachés, rechargement.
//!
//! ## Le problème que ça règle
//!
//! [`crate::runtime::execute`] crée une VM neuve à chaque appel. C'est la bonne propriété pour
//! *analyser* un script (deux analyses ne se contaminent pas), mais la mauvaise pour *travailler
//! avec* : une console où `x = 1` puis `x` répond `nil` n'est pas une console, et réexécuter tout
//! le script à chaque expression évaluée est aussi lent qu'incorrect.
//!
//! [`LuaSession`] garde la VM vivante : l'état survit d'une évaluation à l'autre, et le
//! rechargement est **explicite**.
//!
//! ## Ce qui vient d'Overload
//!
//! - **Rechargement par recréation du contexte.** `ScriptInterpreter::RefreshAll()` détruit puis
//!   recrée le `sol::state` entier, avec ce constat en commentaire : *« unconsidering a script is
//!   impossible with Lua, we have to reparse every behaviours »*. C'est exact — Lua n'a pas de
//!   « désenregistrer » : une fonction globale posée par un script reste après modification du
//!   fichier. [`LuaSession::reload`] fait donc la même chose : VM neuve, binders réinstallés,
//!   comportements ré-attachés.
//! - **Contrat d'attachement.** Chez Overload, un `Behaviour` charge `<nom>.lua`, **exige que le
//!   script retourne une table**, et y injecte `owner`. On reprend ce contrat ([`Behaviour`]).
//! - **Callback absent = ignoré silencieusement.** Overload appelle `OnStart`/`OnUpdate`/… et ne
//!   se plaint pas si la fonction n'existe pas. Indispensable : aucun script ne définit tous les
//!   points d'entrée.
//!
//! ## Ce qu'on ajoute
//!
//! Overload conçoit l'API que ses scripts consomment ; niers la retro-conçoit. La session tient
//! donc le compte de ce que les scripts **réclament sans l'obtenir** ([`LuaSession::api_report`]) :
//! c'est la liste de travail du portage moteur, produite par l'exécution elle-même.

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::rc::Rc;

use mlua::{Lua, MultiValue, Table, Value};

use crate::host::{HostRegistry, LogEntry, LogSink};
use crate::menu_host::{DriveReport, MenuState};
use crate::runtime::{
    GlobalEntry, RuntimeContext, install_host_stubs, install_print_capture, list_globals,
    value_to_string,
};
use crate::{
    ChunkMode, LuaError, index_script_paths, is_lua52_bytecode, resolve_script_path,
    validate_bytecode,
};

/// Points d'entrée standard d'un comportement, dans l'ordre du cycle de vie d'Overload.
///
/// Les noms sont ceux d'Overload (`OnAwake`, `OnStart`, …) : c'est une convention d'outillage pour
/// nos propres scripts, **pas** une prétention sur l'API de Level-5, dont les points d'entrée
/// réels sont ceux du reverse (cf. [`crate::menu_host`]).
pub const LIFECYCLE_CALLBACKS: [&str; 6] = [
    "OnAwake",
    "OnStart",
    "OnEnable",
    "OnUpdate",
    "OnDisable",
    "OnDestroy",
];

/// Limite par défaut du chemin d'exécution d'un chunk lu depuis le VFS.
pub const DEFAULT_VFS_INSTRUCTION_LIMIT: u32 = 20_000_000;

/// Valeur transportable par un événement host→Lua.
///
/// Le manager natif convertit les `uint` en nombres Lua et transmet aussi un argument optionnel
/// `nil` ; les callbacks de menus rencontrent également des booléens et des chaînes. Garder ces
/// variantes explicites évite de réduire tous les événements à des nombres et de changer leur
/// arité observable avec `select('#', ...)`.
#[derive(Debug, Clone, PartialEq)]
pub enum CallbackArg {
    /// Nombre Lua (les IDs moteur et hashes arrivent ici).
    Number(f64),
    /// Booléen Lua.
    Boolean(bool),
    /// Chaîne Lua.
    String(String),
    /// Valeur Lua `nil`, distincte de l’absence d’argument.
    Nil,
}

/// Menu-manager callback verified in the `CLuaMenuObject` vtable or in the inspected scripts.
///
/// This closes the scenario API over the entry points that are already mapped: a caller cannot
/// silently introduce a plausible name that is absent from `nie.exe`. The three vtable slots
/// identified as stubs are deliberately excluded.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum MenuCallback {
    /// Simulation tick executed before [`Self::Step`].
    PreStep,
    /// Main simulation tick.
    Step,
    /// Simulation tick executed after [`Self::Step`].
    PostStep,
    /// Menu scene tick.
    SceneStep,
    /// Menu initialization.
    OnInit,
    /// Primary enter action.
    OnEnter,
    /// Secondary enter action.
    OnSubEnter,
    /// Function action.
    OnFunction,
    /// Return from the current screen, defined by the inspected menu scripts.
    OnBack,
    /// Layer setup.
    OnSetupLayer,
    /// Layer opening.
    OnOpenLayer,
    /// Layer closing.
    OnCloseLayer,
    /// End of layer opening.
    OnOpenEndLayer,
    /// End of layer closing.
    OnCloseEndLayer,
    /// Layer update.
    OnUpdateLayer,
    /// Move focus to the previous value.
    MoveFocusDec,
    /// Move focus to the next value.
    MoveFocusInc,
    /// Move focus through a matrix.
    MoveFocusMtx,
    /// Focus change.
    OnChangeFocus,
    /// Focus decision.
    OnDecideFocus,
    /// Layer-group change.
    OnChangeLayerGroup,
    /// Mouse movement.
    OnMouseMove,
    /// Left mouse button pressed.
    OnMouseLDown,
    /// Left mouse button held over an object.
    OnMouseLOn,
    /// Left mouse button released.
    OnMouseLUp,
}

impl MenuCallback {
    /// The 25 mapped callbacks in menu-manager family order, including `OnBack`, which is
    /// verified in the inspected menu scripts.
    pub const ALL: [Self; 25] = [
        Self::PreStep,
        Self::Step,
        Self::PostStep,
        Self::SceneStep,
        Self::OnInit,
        Self::OnEnter,
        Self::OnSubEnter,
        Self::OnFunction,
        Self::OnBack,
        Self::OnSetupLayer,
        Self::OnOpenLayer,
        Self::OnCloseLayer,
        Self::OnOpenEndLayer,
        Self::OnCloseEndLayer,
        Self::OnUpdateLayer,
        Self::MoveFocusDec,
        Self::MoveFocusInc,
        Self::MoveFocusMtx,
        Self::OnChangeFocus,
        Self::OnDecideFocus,
        Self::OnChangeLayerGroup,
        Self::OnMouseMove,
        Self::OnMouseLDown,
        Self::OnMouseLOn,
        Self::OnMouseLUp,
    ];

    /// Exact global name read by the menu-manager Lua bridge.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::PreStep => "PreStep",
            Self::Step => "Step",
            Self::PostStep => "PostStep",
            Self::SceneStep => "SceneStep",
            Self::OnInit => "OnInit",
            Self::OnEnter => "OnEnter",
            Self::OnSubEnter => "OnSubEnter",
            Self::OnFunction => "OnFunction",
            Self::OnBack => "OnBack",
            Self::OnSetupLayer => "OnSetupLayer",
            Self::OnOpenLayer => "OnOpenLayer",
            Self::OnCloseLayer => "OnCloseLayer",
            Self::OnOpenEndLayer => "OnOpenEndLayer",
            Self::OnCloseEndLayer => "OnCloseEndLayer",
            Self::OnUpdateLayer => "OnUpdateLayer",
            Self::MoveFocusDec => "MoveFocusDec",
            Self::MoveFocusInc => "MoveFocusInc",
            Self::MoveFocusMtx => "MoveFocusMtx",
            Self::OnChangeFocus => "OnChangeFocus",
            Self::OnDecideFocus => "OnDecideFocus",
            Self::OnChangeLayerGroup => "OnChangeLayerGroup",
            Self::OnMouseMove => "OnMouseMove",
            Self::OnMouseLDown => "OnMouseLDown",
            Self::OnMouseLOn => "OnMouseLOn",
            Self::OnMouseLUp => "OnMouseLUp",
        }
    }
}

/// Explicit event in a menu scenario.
///
/// Arguments stay typed and preserve an explicit `nil`. When present, the optional context
/// replaces the scene/save context immediately before the event.
#[derive(Debug, Clone, PartialEq)]
pub struct MenuEvent {
    /// Verified entry point to invoke.
    pub callback: MenuCallback,
    /// Callback arguments in Lua order.
    pub args: Vec<CallbackArg>,
    /// Engine context associated with this event.
    pub context: Option<RuntimeContext>,
}

impl MenuEvent {
    /// Builds an event without arguments or a context replacement.
    #[must_use]
    pub const fn new(callback: MenuCallback) -> Self {
        Self {
            callback,
            args: Vec::new(),
            context: None,
        }
    }

    /// Adds the Lua arguments carried by the event.
    #[must_use]
    pub fn with_args(mut self, args: impl IntoIterator<Item = CallbackArg>) -> Self {
        self.args = args.into_iter().collect();
        self
    }

    /// Associates a scene/save context replacement with the event.
    #[must_use]
    pub fn with_context(mut self, context: RuntimeContext) -> Self {
        self.context = Some(context);
        self
    }
}

/// Builds the standard layer and frame events driven by the native menu runtime.
///
/// Each layer is expanded to its known item count, with one item retained when no count is
/// available. Frame events preserve the native `PreStep` -> `Step` -> `PostStep` order. Keeping
/// this scenario in the library lets the CLI, GUI, API and MCP surfaces replay the same sequence
/// instead of reimplementing the menu-manager lifecycle.
#[must_use]
pub fn build_menu_runtime_events(
    layer_ids: &[u32],
    item_counts: &BTreeMap<u32, i32>,
    frames: u32,
) -> Vec<MenuEvent> {
    let mut events = Vec::new();
    for &layer_id in layer_ids {
        let count = item_counts.get(&layer_id).copied().unwrap_or(0).max(1);
        for item_index in 0..count {
            let args = [
                CallbackArg::Number(layer_id as f64),
                CallbackArg::Number(f64::from(item_index)),
            ];
            events.push(MenuEvent::new(MenuCallback::OnSetupLayer).with_args(args.iter().cloned()));
            events.push(MenuEvent::new(MenuCallback::OnOpenLayer).with_args(args.iter().cloned()));
            events.push(MenuEvent::new(MenuCallback::OnEnter).with_args(args));
        }
    }
    for _ in 0..frames {
        events.push(MenuEvent::new(MenuCallback::PreStep));
        events.push(MenuEvent::new(MenuCallback::Step));
        events.push(MenuEvent::new(MenuCallback::PostStep));
    }
    events
}

/// Measurement of an event scenario replayed on a persistent session.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MenuEventReport {
    /// Number of events supplied by the caller.
    pub events_requested: usize,
    /// Number of events whose callback existed, including failed calls.
    pub events_dispatched: usize,
    /// Number of callbacks that completed without an error.
    pub events_succeeded: usize,
    /// Number of attempted invocations per existing callback.
    pub callback_invocations: BTreeMap<MenuCallback, usize>,
    /// Missing callbacks in scenario order, with duplicates preserved.
    pub missing_callbacks: Vec<MenuCallback>,
    /// Errors captured without hiding subsequent events.
    pub callback_errors: Vec<String>,
}

type IncludeResolver = Rc<dyn Fn(&str) -> Option<Vec<u8>>>;
type BuiltVm = (Lua, Option<Rc<RefCell<MenuState>>>);

/// Un script attaché, avec la table qu'il a renvoyée.
///
/// Contrat repris d'Overload : le chunk **doit renvoyer une table**, qui porte ses callbacks. Un
/// script qui ne renvoie rien n'est pas un comportement — c'est un script d'initialisation, et le
/// dire clairement évite de chercher pourquoi `OnUpdate` n'est jamais appelé.
pub struct Behaviour {
    /// Nom logique (chemin VFS ou étiquette d'éditeur).
    pub name: String,
    /// Table renvoyée par le script.
    table: Table,
}

impl Behaviour {
    /// Callbacks du cycle de vie effectivement définis par ce script.
    #[must_use]
    pub fn defined_callbacks(&self) -> Vec<&'static str> {
        LIFECYCLE_CALLBACKS
            .iter()
            .copied()
            .filter(|name| matches!(self.table.get::<Value>(*name), Ok(Value::Function(_))))
            .collect()
    }

    /// Appelle un callback s'il existe. **Absent = succès silencieux**, comme chez Overload.
    ///
    /// # Errors
    /// [`mlua::Error`] seulement si le callback existe ET échoue — une erreur réelle du script,
    /// qu'il ne faut surtout pas confondre avec « le script ne définit pas ce point d'entrée ».
    pub fn call(&self, callback: &str, args: MultiValue) -> mlua::Result<MultiValue> {
        match self.table.get::<Value>(callback) {
            Ok(Value::Function(f)) => f.call(args),
            _ => Ok(MultiValue::new()),
        }
    }
}

/// Ce qu'un script demande au moteur, et ce qu'il obtient.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ApiReport {
    /// Globals réclamés mais non définis — la liste de travail du portage.
    pub missing: Vec<String>,
    /// Globals fournis par les binders installés.
    pub provided: Vec<String>,
}

struct IncludeJournals {
    missing: Rc<RefCell<Vec<String>>>,
    loaded: Rc<RefCell<Vec<String>>>,
    decoded: Rc<RefCell<std::collections::BTreeMap<String, usize>>>,
}

impl ApiReport {
    /// Part de la surface réclamée qui est couverte, en pourcentage (100 si rien n'est réclamé).
    #[must_use]
    pub fn coverage_percent(&self) -> u32 {
        let total = self.missing.len() + self.provided.len();
        if total == 0 {
            return 100;
        }
        ((self.provided.len() * 100) / total) as u32
    }
}

/// Une VM Lua persistante, ses binders et ses comportements attachés.
pub struct LuaSession {
    lua: Lua,
    /// État du host de menu installé dans cette VM, quand `with_menu_host` est actif.
    ///
    /// Le conserver est essentiel pour une session live : les callbacks Lua mutent cet état
    /// entre deux appels, exactement comme le manager de menus natif conserve ses objets.
    menu_state: Option<Rc<RefCell<MenuState>>>,
    registry: HostRegistry,
    logs: LogSink,
    stdout: Rc<RefCell<Vec<String>>>,
    behaviours: Vec<Behaviour>,
    /// Sources attachées, conservées pour le rechargement — sans elles, `reload` ne pourrait pas
    /// ré-attacher ce qui était en place.
    attached_sources: Vec<(String, Vec<u8>)>,
    with_menu_host: bool,
    /// Résolveur persistant des `INCLUDE`, typiquement une fermeture adossée au VFS brut.
    include_resolver: Option<IncludeResolver>,
    /// Includes demandés mais absents depuis le dernier prélèvement.
    missing_includes: Rc<RefCell<Vec<String>>>,
    /// Includes effectivement résolus depuis le dernier prélèvement, dans l'ordre de chargement.
    loaded_includes: Rc<RefCell<Vec<String>>>,
    /// Instructions des includes binaires décodés sur le chemin live, cumulées par nom logique.
    decoded_include_instructions: Rc<RefCell<std::collections::BTreeMap<String, usize>>>,
    /// Contexte natif réappliqué après chaque reconstruction de VM.
    context: RuntimeContext,
    /// Chunk menu déjà initialisé dans cette VM (`top-level` + `OnInit`).
    ///
    /// La cellule permet aux méthodes de pilotage (`&self`) de conserver le cycle de vie natif
    /// sans rendre la session mutable à chaque frame.
    active_menu: RefCell<Option<(String, Vec<u8>)>>,
}

impl LuaSession {
    /// Crée une session : VM neuve, binders installés, stubs de globals actifs.
    ///
    /// `logs` DOIT être le tampon confié aux binders de `registry` (typiquement à
    /// [`crate::host::DebugBinder`]) : sans ça, [`Self::take_logs`] lirait un tampon que personne
    /// n'alimente et la session paraîtrait muette. [`Self::standard`] évite ce piège en
    /// construisant les deux ensemble.
    ///
    /// # Errors
    /// [`LuaError`] si l'installation de l'hôte échoue.
    pub fn new(
        registry: HostRegistry,
        logs: LogSink,
        with_menu_host: bool,
    ) -> Result<Self, LuaError> {
        Self::new_with_resolver(registry, logs, with_menu_host, None)
    }

    /// Crée une session dont `INCLUDE(name)` lit les chunks depuis le résolveur fourni.
    ///
    /// Le résolveur est conservé par la session : `reload()` reconstruit la VM et réinstalle
    /// exactement le même accès au VFS, au lieu de retomber silencieusement sur une console sans
    /// modules. Les chunks inclus sont exécutés dans la VM de la session, comme dans `nie.exe`.
    ///
    /// # Errors
    /// [`LuaError`] si l'installation de l'hôte ou de `INCLUDE` échoue.
    pub fn with_include<F>(
        registry: HostRegistry,
        logs: LogSink,
        with_menu_host: bool,
        resolver: F,
    ) -> Result<Self, LuaError>
    where
        F: Fn(&str) -> Option<Vec<u8>> + 'static,
    {
        Self::new_with_resolver(registry, logs, with_menu_host, Some(Rc::new(resolver)))
    }

    /// Crée une session dont `INCLUDE` lit directement un index de chemins VFS.
    ///
    /// `paths` doit contenir les chemins physiques des chunks (`.lua.bin`) et `reader` les lit
    /// depuis le VFS brut. La résolution accepte les noms physiques, les basenames et les noms
    /// logiques `LUA_*`, en sélectionnant la version numérique la plus récente.
    ///
    /// # Errors
    /// [`LuaError`] si l'installation de l'hôte ou de `INCLUDE` échoue.
    pub fn with_script_paths<I, F>(
        registry: HostRegistry,
        logs: LogSink,
        with_menu_host: bool,
        paths: I,
        reader: F,
    ) -> Result<Self, LuaError>
    where
        I: IntoIterator<Item = String>,
        F: Fn(&str) -> Option<Vec<u8>> + 'static,
    {
        let paths = paths.into_iter().collect::<Vec<_>>();
        let (by_name, by_logical) = index_script_paths(paths.iter().map(String::as_str));
        let by_name = Rc::new(by_name);
        let by_logical = Rc::new(by_logical);
        let reader = Rc::new(reader);
        Self::with_include(registry, logs, with_menu_host, move |name| {
            let path = resolve_script_path(name, &by_name, &by_logical)?;
            reader(path)
        })
    }

    fn new_with_resolver(
        registry: HostRegistry,
        logs: LogSink,
        with_menu_host: bool,
        include_resolver: Option<IncludeResolver>,
    ) -> Result<Self, LuaError> {
        let stdout = Rc::new(RefCell::new(Vec::new()));
        let missing_includes = Rc::new(RefCell::new(Vec::new()));
        let loaded_includes = Rc::new(RefCell::new(Vec::new()));
        let decoded_include_instructions = Rc::new(RefCell::new(std::collections::BTreeMap::new()));
        let journals = IncludeJournals {
            missing: Rc::clone(&missing_includes),
            loaded: Rc::clone(&loaded_includes),
            decoded: Rc::clone(&decoded_include_instructions),
        };
        let context = RuntimeContext::default();
        let (lua, menu_state) = Self::build_vm(
            &registry,
            &stdout,
            with_menu_host,
            include_resolver.as_ref(),
            &journals,
            &context,
        )?;
        Ok(Self {
            lua,
            menu_state,
            registry,
            logs,
            stdout,
            behaviours: Vec::new(),
            attached_sources: Vec::new(),
            with_menu_host,
            include_resolver,
            missing_includes,
            loaded_includes,
            decoded_include_instructions,
            context,
            active_menu: RefCell::new(None),
        })
    }

    /// Session prête à l'emploi : registre standard (`Debug` + `Math`) et tampon de journal
    /// correctement relié.
    ///
    /// # Errors
    /// [`LuaError`] si l'installation de l'hôte échoue.
    pub fn standard(with_menu_host: bool) -> Result<Self, LuaError> {
        let logs: LogSink = Rc::new(RefCell::new(Vec::new()));
        let registry = HostRegistry::standard(Rc::clone(&logs));
        Self::new(registry, logs, with_menu_host)
    }

    /// Reconstruit une VM complète. Le tampon de journal n'est pas repris ici : il est déjà
    /// capturé par les closures des binders de `registry`, qui survivent au rechargement.
    fn build_vm(
        registry: &HostRegistry,
        stdout: &Rc<RefCell<Vec<String>>>,
        with_menu_host: bool,
        include_resolver: Option<&IncludeResolver>,
        journals: &IncludeJournals,
        context: &RuntimeContext,
    ) -> Result<BuiltVm, LuaError> {
        let lua = crate::new_vm();
        install_print_capture(&lua, Rc::clone(stdout))?;
        registry.bind_all(&lua)?;
        let menu_state = if with_menu_host {
            Some(crate::install_menu_host(&lua)?)
        } else {
            None
        };
        if let Some(resolver) = include_resolver {
            let resolver = Rc::clone(resolver);
            let missing = Rc::clone(&journals.missing);
            let loaded = Rc::clone(&journals.loaded);
            let decoded = Rc::clone(&journals.decoded);
            crate::install_include_with_trace(
                &lua,
                move |name| match resolver(name) {
                    Some(bytes) => {
                        loaded.borrow_mut().push(name.to_string());
                        Some(bytes)
                    }
                    None => {
                        missing.borrow_mut().push(name.to_string());
                        None
                    }
                },
                Some(decoded),
            )?;
        }
        // Les stubs viennent EN DERNIER : la métatable de `_G` ne doit intercepter que ce qu'aucun
        // binder n'a fourni, sinon tout serait déclaré « manquant ».
        install_host_stubs(&lua)?;
        context.apply(&lua)?;
        Ok((lua, menu_state))
    }

    /// Accès à la VM, pour les usages avancés (ex. installer un binder supplémentaire).
    #[must_use]
    pub fn lua(&self) -> &Lua {
        &self.lua
    }

    /// État du menu partagé par la VM live, s’il a été demandé à la construction.
    #[must_use]
    pub fn menu_state(&self) -> Option<Rc<RefCell<MenuState>>> {
        self.menu_state.as_ref().map(Rc::clone)
    }

    /// Exécute un menu dans la VM persistante, avec ses includes VFS et son `MenuState`.
    ///
    /// Cette méthode conserve les globals, coroutines et mutations déjà produits par les
    /// évaluations précédentes. Elle est donc adaptée au pilotage « live » ; `reload()` reste
    /// l’opération explicite qui recrée le contexte.
    ///
    /// # Errors
    /// [`LuaError`] si le host menu n’a pas été activé ou si le bytecode est invalide.
    pub fn drive_menu_for_frames(
        &self,
        script_bytes: &[u8],
        name: &str,
        layer_ids: &[u32],
        item_counts: &std::collections::BTreeMap<u32, i32>,
        frames: u32,
    ) -> Result<DriveReport, LuaError> {
        self.drive_menu_for_frames_with_limit(
            script_bytes,
            name,
            layer_ids,
            item_counts,
            frames,
            Some(DEFAULT_VFS_INSTRUCTION_LIMIT),
        )
    }

    /// Résout et pilote un menu directement depuis le VFS indexé de la session.
    ///
    /// Le chunk principal passe par le même résolveur que `INCLUDE`: chemin physique, basename
    /// ou nom logique versionless sont acceptés, et la version numérique la plus récente est
    /// sélectionnée. Le bytecode principal et les includes sont donc validés/décodés sur le
    /// chemin live avant d'être exécutés dans la VM persistante.
    ///
    /// # Errors
    /// [`LuaError::VfsScriptNotFound`] si aucun résolveur VFS n'est installé ou si `path` est
    /// absent; les autres erreurs suivent [`Self::drive_menu_for_frames`].
    pub fn drive_menu_vfs_for_frames(
        &self,
        path: &str,
        layer_ids: &[u32],
        item_counts: &std::collections::BTreeMap<u32, i32>,
        frames: u32,
    ) -> Result<DriveReport, LuaError> {
        self.drive_menu_vfs_for_frames_with_limit(
            path,
            layer_ids,
            item_counts,
            frames,
            Some(DEFAULT_VFS_INSTRUCTION_LIMIT),
        )
    }

    /// Variante du pilotage VFS permettant de régler ou désactiver la limite d'instructions.
    pub fn drive_menu_vfs_for_frames_with_limit(
        &self,
        path: &str,
        layer_ids: &[u32],
        item_counts: &std::collections::BTreeMap<u32, i32>,
        frames: u32,
        instruction_limit: Option<u32>,
    ) -> Result<DriveReport, LuaError> {
        let bytes = self
            .include_resolver
            .as_ref()
            .and_then(|resolver| resolver(path))
            .ok_or_else(|| LuaError::VfsScriptNotFound(path.to_string()))?;
        self.drive_menu_for_frames_with_limit(
            &bytes,
            path,
            layer_ids,
            item_counts,
            frames,
            instruction_limit,
        )
    }

    /// Variante du driver live avec une limite d'instructions configurable.
    ///
    /// Le hook couvre toute la séquence du manager (`top-level`, callbacks de construction et
    /// frames), puis est retiré avant le retour afin que la session reste réutilisable.
    pub fn drive_menu_for_frames_with_limit(
        &self,
        script_bytes: &[u8],
        name: &str,
        layer_ids: &[u32],
        item_counts: &std::collections::BTreeMap<u32, i32>,
        frames: u32,
        instruction_limit: Option<u32>,
    ) -> Result<DriveReport, LuaError> {
        if self.menu_state.is_none() {
            return Err(LuaError::Vm(mlua::Error::RuntimeError(
                "LuaSession: with_menu_host=false, impossible de piloter un menu".to_string(),
            )));
        }
        // `item_counts` est la donnée de scène explicitement fournie au driver. Si le caller n'a
        // pas déjà injecté le même attribut détaillé, le rendre disponible ici garantit que
        // `GetObjectAttr`/`GetItemButtonNum` voient le compte attendu pendant `OnInit`, comme dans
        // le manager natif. Une valeur plus précise déjà injectée par le caller reste prioritaire.
        if let Some(state) = &self.menu_state {
            let mut state = state.borrow_mut();
            for (&object_id, &count) in item_counts {
                state.object_attr.entry(object_id).or_insert(count);
            }
        }
        if let Some(limit) = instruction_limit {
            let executed = std::cell::Cell::new(0_u32);
            self.lua.set_hook(
                mlua::HookTriggers::new().every_nth_instruction(10_000),
                move |_lua, _debug| {
                    executed.set(executed.get().saturating_add(10_000));
                    if executed.get() >= limit {
                        return Err(mlua::Error::RuntimeError(format!(
                            "limite d'exécution atteinte ({limit} instructions) — menu probablement en attente du moteur"
                        )));
                    }
                    Ok(mlua::VmState::Continue)
                },
            )?;
        }
        let already_initialized =
            self.active_menu
                .borrow()
                .as_ref()
                .is_some_and(|(loaded_name, loaded_bytes)| {
                    loaded_name == name && loaded_bytes.as_slice() == script_bytes
                });
        let decoded_includes_before = self.decoded_include_instructions.borrow().clone();
        let result = if already_initialized {
            crate::menu_host::drive_menu_for_frames_existing(
                &self.lua,
                script_bytes,
                name,
                layer_ids,
                item_counts,
                frames,
            )
        } else {
            crate::menu_host::drive_menu_for_frames(
                &self.lua,
                script_bytes,
                name,
                layer_ids,
                item_counts,
                frames,
            )
        };
        let decoded_includes_after = self.decoded_include_instructions.borrow().clone();
        let decoded_include_instructions = decoded_includes_after
            .into_iter()
            .filter_map(|(include_name, total)| {
                let previous = decoded_includes_before
                    .get(&include_name)
                    .copied()
                    .unwrap_or(0);
                (total > previous).then_some((include_name, total - previous))
            })
            .collect();
        let mut result = result;
        if let Ok(report) = &mut result {
            report.decoded_include_instructions = decoded_include_instructions;
            report.decoded_instructions_total = report
                .decoded_instructions
                .map(|main| main + report.decoded_include_instructions.values().sum::<usize>());
        }
        if instruction_limit.is_some() {
            self.lua.remove_hook();
        }
        if result.is_ok() && !already_initialized {
            *self.active_menu.borrow_mut() = Some((name.to_string(), script_bytes.to_vec()));
        }
        result
    }

    /// Appelle un callback host→Lua sur la VM persistante, comme le manager de menu natif.
    ///
    /// `args` sont convertis en nombres Lua (les IDs de layer/groupe et indices du moteur sont
    /// transportés ainsi). Si `context` est fourni, il remplace le contexte de scène avant
    /// l'appel ; cela permet d'associer les globals natifs au même événement que le jeu.
    /// Retourne `false` quand le callback n'est pas défini, sans considérer cela comme une erreur.
    pub fn call_menu_callback(
        &mut self,
        callback: &str,
        args: &[f64],
        context: Option<RuntimeContext>,
    ) -> Result<bool, LuaError> {
        let args = args
            .iter()
            .copied()
            .map(CallbackArg::Number)
            .collect::<Vec<_>>();
        self.call_menu_callback_typed(callback, &args, context)
    }

    /// Appelle un callback host→Lua avec les types de valeurs du pont natif.
    ///
    /// `CallbackArg::Nil` est volontairement conservé dans la liste : il reproduit un argument
    /// optionnel passé explicitement par le host C#, au lieu de le confondre avec un callback sans
    /// argument.
    pub fn call_menu_callback_typed(
        &mut self,
        callback: &str,
        args: &[CallbackArg],
        context: Option<RuntimeContext>,
    ) -> Result<bool, LuaError> {
        if let Some(context) = context {
            self.set_context(context)?;
        }
        // The native manager installs the event layer as current context before every layer
        // lifecycle callback. Object commands that omit their layer ID then read this slot;
        // keeping it aligned prevents them from silently mutating layer 0 in a live session.
        if matches!(
            callback,
            "OnSetupLayer"
                | "OnOpenLayer"
                | "OnCloseLayer"
                | "OnOpenEndLayer"
                | "OnCloseEndLayer"
                | "OnUpdateLayer"
        ) && let Some(CallbackArg::Number(layer_id)) = args.first()
            && let Some(state) = &self.menu_state
        {
            state.borrow_mut().current_layer = *layer_id as u32;
        }
        let Ok(Value::Function(function)) = self.lua.globals().raw_get::<Value>(callback) else {
            return Ok(false);
        };
        let values = args
            .iter()
            .map(|arg| match arg {
                CallbackArg::Number(value) => Ok(Value::Number(*value)),
                CallbackArg::Boolean(value) => Ok(Value::Boolean(*value)),
                CallbackArg::String(value) => self
                    .lua
                    .create_string(value)
                    .map(Value::String)
                    .map_err(LuaError::from),
                CallbackArg::Nil => Ok(Value::Nil),
            })
            .collect::<Result<MultiValue, LuaError>>()?;
        function.call::<MultiValue>(values)?;
        Ok(true)
    }

    /// Replays an explicit scenario made only of mapped menu callbacks.
    ///
    /// The session must have loaded the script first (for example with
    /// [`Self::drive_menu_for_frames`]). Missing and failing callbacks are measured in the report
    /// instead of interrupting the sequence, so an exporter can distinguish an incomplete
    /// scenario from one that was never executed. The default instruction budget protects the
    /// caller from a callback waiting indefinitely for engine state.
    ///
    /// # Errors
    /// [`LuaError`] if the instruction-limit hook cannot be installed.
    pub fn dispatch_menu_events(
        &mut self,
        events: &[MenuEvent],
    ) -> Result<MenuEventReport, LuaError> {
        self.dispatch_menu_events_with_limit(events, Some(DEFAULT_VFS_INSTRUCTION_LIMIT))
    }

    /// Scenario-driver variant with a configurable instruction budget.
    ///
    /// The budget covers the complete sequence and the hook is always removed before returning,
    /// including when callbacks fail. `None` disables the limit for scenarios whose termination
    /// is already guaranteed by the caller.
    ///
    /// # Errors
    /// [`LuaError`] if the instruction-limit hook cannot be installed.
    pub fn dispatch_menu_events_with_limit(
        &mut self,
        events: &[MenuEvent],
        instruction_limit: Option<u32>,
    ) -> Result<MenuEventReport, LuaError> {
        if let Some(limit) = instruction_limit {
            let executed = std::cell::Cell::new(0_u32);
            self.lua.set_hook(
                mlua::HookTriggers::new().every_nth_instruction(10_000),
                move |_lua, _debug| {
                    executed.set(executed.get().saturating_add(10_000));
                    if executed.get() >= limit {
                        return Err(mlua::Error::RuntimeError(format!(
                            "execution limit reached ({limit} instructions) — menu scenario probably waiting for the engine"
                        )));
                    }
                    Ok(mlua::VmState::Continue)
                },
            )?;
        }

        let mut report = MenuEventReport {
            events_requested: events.len(),
            ..MenuEventReport::default()
        };
        for event in events {
            let callback_name = event.callback.as_str();
            if !matches!(
                self.lua.globals().raw_get::<Value>(callback_name),
                Ok(Value::Function(_))
            ) {
                report.missing_callbacks.push(event.callback);
                continue;
            }

            report.events_dispatched += 1;
            *report
                .callback_invocations
                .entry(event.callback)
                .or_default() += 1;
            match self.call_menu_callback_typed(callback_name, &event.args, event.context.clone()) {
                Ok(true) => report.events_succeeded += 1,
                Ok(false) => report.missing_callbacks.push(event.callback),
                Err(error) => report
                    .callback_errors
                    .push(format!("{callback_name}: {error}")),
            }
        }

        if instruction_limit.is_some() {
            self.lua.remove_hook();
        }
        Ok(report)
    }

    /// Lignes de `print` accumulées depuis le dernier [`Self::take_output`].
    #[must_use]
    pub fn take_output(&self) -> Vec<String> {
        std::mem::take(&mut self.stdout.borrow_mut())
    }

    /// Includes VFS demandés mais absents depuis le dernier prélèvement, dédoublonnés et triés.
    #[must_use]
    pub fn take_missing_includes(&self) -> Vec<String> {
        let mut journal = self.missing_includes.borrow_mut();
        let mut missing = std::mem::take(&mut *journal);
        missing.sort_unstable();
        missing.dedup();
        missing
    }

    /// Includes VFS effectivement chargés depuis le dernier prélèvement, dans l'ordre réel.
    #[must_use]
    pub fn take_loaded_includes(&self) -> Vec<String> {
        std::mem::take(&mut self.loaded_includes.borrow_mut())
    }

    /// Messages `Debug.*` accumulés depuis le dernier appel.
    #[must_use]
    pub fn take_logs(&self) -> Vec<LogEntry> {
        std::mem::take(&mut self.logs.borrow_mut())
    }

    /// Exécute un chunk (source ou bytecode) dans la session, sans l'attacher.
    ///
    /// # Errors
    /// [`LuaError`] si le chunk échoue — ici l'erreur EST propagée : contrairement à une analyse,
    /// une exécution demandée explicitement doit dire qu'elle a raté.
    pub fn exec(&self, name: &str, data: &[u8]) -> Result<Vec<String>, LuaError> {
        self.exec_with_limit(name, data, None)
    }

    /// Exécute un chunk dans la VM persistante avec une limite d'instructions optionnelle.
    ///
    /// Le hook est installé uniquement pendant cet appel puis retiré, afin que la limite d'un
    /// chunk VFS ne contamine pas les callbacks live suivants ni le compteur d'une autre commande.
    pub fn exec_with_limit(
        &self,
        name: &str,
        data: &[u8],
        instruction_limit: Option<u32>,
    ) -> Result<Vec<String>, LuaError> {
        validate_bytecode(data)?;
        let mode = if is_lua52_bytecode(data) {
            ChunkMode::Binary
        } else {
            ChunkMode::Text
        };
        if let Some(limit) = instruction_limit {
            let executed = std::cell::Cell::new(0_u32);
            self.lua.set_hook(
                mlua::HookTriggers::new().every_nth_instruction(10_000),
                move |_lua, _debug| {
                    executed.set(executed.get().saturating_add(10_000));
                    if executed.get() >= limit {
                        return Err(mlua::Error::RuntimeError(format!(
                            "limite d'exécution atteinte ({limit} instructions) — script probablement en attente du moteur"
                        )));
                    }
                    Ok(mlua::VmState::Continue)
                },
            )?;
        }
        let result: mlua::Result<MultiValue> = self
            .lua
            .load(data)
            .set_name(name.to_string())
            .set_mode(mode)
            .call(());
        if instruction_limit.is_some() {
            self.lua.remove_hook();
        }
        let values = result?;
        Ok(values.iter().map(value_to_string).collect())
    }

    /// Lit et exécute un chunk directement depuis le résolveur VFS de la session.
    ///
    /// Avec [`Self::with_script_paths`], `path` accepte un chemin physique, un basename ou un
    /// nom logique `LUA_*`; la résolution de version est exactement celle des `INCLUDE`. Le
    /// bytecode est validé par [`crate::validate_bytecode`] avant d'entrer dans la VM persistante.
    ///
    /// # Errors
    /// [`LuaError::VfsScriptNotFound`] si aucun résolveur n'est installé ou si le chemin est
    /// absent ; les erreurs de validation/exécution suivent le contrat de [`Self::exec`].
    pub fn exec_vfs(&self, path: &str) -> Result<Vec<String>, LuaError> {
        self.exec_vfs_with_limit(path, Some(DEFAULT_VFS_INSTRUCTION_LIMIT))
    }

    /// Variante de [`Self::exec_vfs`] permettant de choisir ou désactiver la limite d'instructions.
    pub fn exec_vfs_with_limit(
        &self,
        path: &str,
        instruction_limit: Option<u32>,
    ) -> Result<Vec<String>, LuaError> {
        let bytes = self
            .include_resolver
            .as_ref()
            .and_then(|resolver| resolver(path))
            .ok_or_else(|| LuaError::VfsScriptNotFound(path.to_string()))?;
        self.exec_with_limit(path, &bytes, instruction_limit)
    }

    /// Attache un script comme comportement.
    ///
    /// Contrat d'Overload : le chunk doit **renvoyer une table**. Un chunk qui renvoie autre chose
    /// (ou rien) est refusé explicitement plutôt qu'attaché à vide — sinon ses callbacks ne
    /// seraient jamais appelés et rien ne dirait pourquoi.
    ///
    /// # Errors
    /// [`LuaError`] si le chunk échoue ou ne renvoie pas de table.
    pub fn attach(&mut self, name: &str, data: &[u8]) -> Result<&Behaviour, LuaError> {
        validate_bytecode(data)?;
        let mode = if is_lua52_bytecode(data) {
            ChunkMode::Binary
        } else {
            ChunkMode::Text
        };
        let value: Value = self
            .lua
            .load(data)
            .set_name(name.to_string())
            .set_mode(mode)
            .call(())?;

        let Value::Table(table) = value else {
            return Err(LuaError::Vm(mlua::Error::RuntimeError(format!(
                "« {name} » n'est pas un comportement : un script attaché doit renvoyer une table \
                 portant ses callbacks (OnStart, OnUpdate, …)"
            ))));
        };

        self.behaviours.push(Behaviour {
            name: name.to_string(),
            table,
        });
        self.attached_sources
            .push((name.to_string(), data.to_vec()));
        Ok(self.behaviours.last().expect("vient d'être poussé"))
    }

    /// Comportements attachés.
    #[must_use]
    pub fn behaviours(&self) -> &[Behaviour] {
        &self.behaviours
    }

    /// Diffuse un callback à tous les comportements attachés.
    ///
    /// Renvoie le nombre de comportements qui définissaient réellement ce callback — utile pour
    /// distinguer « diffusé à personne » de « diffusé et sans effet ».
    ///
    /// # Errors
    /// [`LuaError`] à la première erreur *réelle* d'un callback (un callback absent n'en est pas
    /// une).
    pub fn broadcast(&self, callback: &str) -> Result<usize, LuaError> {
        let mut called = 0;
        for behaviour in &self.behaviours {
            if behaviour.defined_callbacks().contains(&callback) {
                behaviour.call(callback, MultiValue::new())?;
                called += 1;
            }
        }
        Ok(called)
    }

    /// Recrée la VM et ré-attache les comportements — le `RefreshAll` d'Overload.
    ///
    /// Une VM neuve est la seule façon correcte de recharger : Lua ne sait pas retirer une
    /// définition. Recharger « par-dessus » laisserait les globals de l'ancienne version en place,
    /// et une fonction supprimée du script continuerait d'exister.
    ///
    /// # Errors
    /// [`LuaError`] si la reconstruction ou un ré-attachement échoue.
    pub fn reload(&mut self) -> Result<(), LuaError> {
        let journals = IncludeJournals {
            missing: Rc::clone(&self.missing_includes),
            loaded: Rc::clone(&self.loaded_includes),
            decoded: Rc::clone(&self.decoded_include_instructions),
        };
        let (lua, menu_state) = Self::build_vm(
            &self.registry,
            &self.stdout,
            self.with_menu_host,
            self.include_resolver.as_ref(),
            &journals,
            &self.context,
        )?;
        self.lua = lua;
        self.menu_state = menu_state;
        *self.active_menu.borrow_mut() = None;
        self.behaviours.clear();

        let sources = std::mem::take(&mut self.attached_sources);
        for (name, data) in sources {
            self.attach(&name, &data)?;
        }
        Ok(())
    }

    /// Évalue une expression dans l'état COURANT de la session — la console.
    ///
    /// # Errors
    /// Jamais : l'échec est rendu en texte, parce que voir le message est le résultat attendu.
    pub fn eval(&self, expression: &str) -> Result<String, LuaError> {
        crate::runtime::eval_expression(&self.lua, expression)
    }

    /// Globals de la session.
    #[must_use]
    pub fn globals(&self, include_stdlib: bool) -> Vec<GlobalEntry> {
        list_globals(&self.lua, include_stdlib)
    }

    /// Pose une valeur globale — l'éditeur de valeurs, appliqué à une session vivante.
    ///
    /// L'expression est évaluée par la VM : `999`, `'texte'` ou `{a=1}` sont tous acceptés, sans
    /// que l'appelant ait à typer quoi que ce soit.
    ///
    /// # Errors
    /// [`LuaError`] si l'expression est invalide.
    pub fn set_global(&self, name: &str, expression: &str) -> Result<(), LuaError> {
        self.lua
            .load(format!("{name} = {expression}"))
            .set_name("=set_global")
            .exec()?;
        Ok(())
    }

    /// Injecte un contexte natif typé dans la VM vivante et le conserve pour `reload()`.
    ///
    /// Les valeurs sont posées après les stubs : elles remplacent donc réellement les proxies
    /// d'accès manquant. Le contexte est remplacé en bloc pour qu'un ancien état de save/scene ne
    /// survive pas silencieusement à un changement d'écran.
    pub fn set_context(&mut self, context: RuntimeContext) -> Result<(), LuaError> {
        self.context.clear_replaced_by(&self.lua, &context)?;
        context.apply(&self.lua)?;
        self.context = context;
        Ok(())
    }

    /// Retourne une copie du contexte actuellement associé à la session.
    #[must_use]
    pub fn context(&self) -> RuntimeContext {
        self.context.clone()
    }

    /// Confronte ce que les scripts ont réclamé à ce que les binders fournissent.
    #[must_use]
    pub fn api_report(&self) -> ApiReport {
        let mut missing: Vec<String> = self
            .lua
            .globals()
            .get::<Table>("_HOST_MISSING")
            .map(|t| {
                t.pairs::<String, Value>()
                    .filter_map(Result::ok)
                    .map(|(k, _)| k)
                    .collect()
            })
            .unwrap_or_default();
        missing.sort_unstable();
        missing.dedup();

        ApiReport {
            missing,
            provided: self.registry.installed_names(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session() -> LuaSession {
        LuaSession::standard(false).expect("session")
    }

    /// La propriété qui manquait : l'état survit d'une évaluation à l'autre.
    #[test]
    fn la_session_conserve_son_etat() {
        let s = session();
        s.eval("compteur = 1").expect("eval");
        s.eval("compteur = compteur + 41").expect("eval");
        assert_eq!(s.eval("compteur").unwrap(), "42");
    }

    #[test]
    fn le_contexte_natif_type_survit_au_reload_et_ne_devient_pas_un_stub() {
        let mut s = session();
        let mut context = RuntimeContext::default();
        context.set_number("pieceIdx", 3.0);
        context.set_boolean("isGrayout", true);
        context.set_string("MENU_LINIT_NONE", "native-sentinel");
        let mut initial = context.clone();
        initial.set_number("oldSceneSlot", 9.0);
        s.set_context(initial).expect("contexte initial");
        s.exec(
            "context",
            br#"assert(pieceIdx == 3); assert(isGrayout == true); assert(MENU_LINIT_NONE == "native-sentinel")"#,
        )
        .expect("globals de contexte");
        s.set_context(context.clone())
            .expect("remplacement contexte");
        s.exec(
            "context-replacement",
            br#"assert(rawget(_G, "oldSceneSlot") == nil)"#,
        )
        .expect("ancien slot supprimé");
        assert!(s.api_report().missing.is_empty());
        assert_eq!(s.context(), context);

        s.reload().expect("reload");
        s.exec(
            "context-after-reload",
            br#"assert(pieceIdx == 3); assert(isGrayout == true); assert(MENU_LINIT_NONE == "native-sentinel")"#,
        )
        .expect("contexte après reload");
    }

    #[test]
    fn les_evenements_host_lua_reutilisent_la_vm_et_le_contexte() {
        let mut s = session();
        s.exec(
            "events",
            br#"
                calls = {}
                function OnOpenLayer(layer, index)
                    calls[#calls + 1] = layer + index + pieceIdx
                end
                function OnCloseEndLayer(layer, index)
                    calls[#calls + 1] = layer + index + pieceIdx
                end
            "#,
        )
        .expect("callbacks");
        let mut context = RuntimeContext::default();
        context.set_number("pieceIdx", 4.0);
        assert!(
            s.call_menu_callback("OnOpenLayer", &[10.0, 2.0], Some(context.clone()))
                .expect("OnOpenLayer")
        );
        assert!(
            s.call_menu_callback("OnCloseEndLayer", &[20.0, 1.0], Some(context))
                .expect("OnCloseEndLayer")
        );
        assert!(
            !s.call_menu_callback("OnChangeFocus", &[0.0, 0.0], None)
                .expect("callback absent")
        );
        assert_eq!(s.eval("calls[1] .. ',' .. calls[2]").unwrap(), "16,25");
    }

    #[test]
    fn les_evenements_host_preservent_types_nil_et_arite() {
        let mut s = session();
        s.exec(
            "typed-events",
            br#"
                function OnTyped(...)
                    argc = select('#', ...)
                    first_type = type(select(1, ...))
                    second_value = select(2, ...)
                    third_value = select(3, ...)
                    fourth_type = type(select(4, ...))
                end
            "#,
        )
        .expect("callback variadique");
        assert!(
            s.call_menu_callback_typed(
                "OnTyped",
                &[
                    CallbackArg::Number(7.0),
                    CallbackArg::Boolean(true),
                    CallbackArg::String("scene".to_string()),
                    CallbackArg::Nil,
                ],
                None,
            )
            .expect("callback typé")
        );
        assert_eq!(s.eval("argc .. '/' .. first_type .. '/' .. tostring(second_value) .. '/' .. third_value .. '/' .. fourth_type").unwrap(), "4/number/true/scene/nil");
    }

    #[test]
    fn un_evenement_de_layer_positionne_le_contexte_host_avant_lappel() {
        let mut s = LuaSession::standard(true).expect("session menu");
        s.exec(
            "layer-event",
            br#"
                function OnOpenLayer(layer)
                    funcLuaMenuCommand(0x2A64B198, 0x1234, 0, false)
                end
            "#,
        )
        .expect("callback de layer");
        assert!(
            s.call_menu_callback_typed("OnOpenLayer", &[CallbackArg::Number(0x77 as f64)], None,)
                .expect("OnOpenLayer")
        );
        let state = s.menu_state().expect("MenuState");
        let state = state.borrow();
        assert_eq!(state.current_layer, 0x77);
        assert!(!state.layers[&0x77].objects[&0x1234].visible);
        assert!(!state.layers.contains_key(&0));
    }

    #[test]
    fn typed_menu_callbacks_are_exact_and_unique() {
        let names = MenuCallback::ALL.map(MenuCallback::as_str);
        assert_eq!(
            names,
            [
                "PreStep",
                "Step",
                "PostStep",
                "SceneStep",
                "OnInit",
                "OnEnter",
                "OnSubEnter",
                "OnFunction",
                "OnBack",
                "OnSetupLayer",
                "OnOpenLayer",
                "OnCloseLayer",
                "OnOpenEndLayer",
                "OnCloseEndLayer",
                "OnUpdateLayer",
                "MoveFocusDec",
                "MoveFocusInc",
                "MoveFocusMtx",
                "OnChangeFocus",
                "OnDecideFocus",
                "OnChangeLayerGroup",
                "OnMouseMove",
                "OnMouseLDown",
                "OnMouseLOn",
                "OnMouseLUp",
            ]
        );
        assert_eq!(
            names
                .into_iter()
                .collect::<std::collections::BTreeSet<_>>()
                .len(),
            MenuCallback::ALL.len()
        );
    }

    #[test]
    fn runtime_event_sequence_preserves_layers_items_and_frames() {
        let item_counts = BTreeMap::from([(0x10, 2)]);
        let events = build_menu_runtime_events(&[0x10, 0x20], &item_counts, 2);

        assert_eq!(events.len(), 15);
        assert_eq!(
            events
                .iter()
                .map(|event| event.callback)
                .collect::<Vec<_>>(),
            [
                MenuCallback::OnSetupLayer,
                MenuCallback::OnOpenLayer,
                MenuCallback::OnEnter,
                MenuCallback::OnSetupLayer,
                MenuCallback::OnOpenLayer,
                MenuCallback::OnEnter,
                MenuCallback::OnSetupLayer,
                MenuCallback::OnOpenLayer,
                MenuCallback::OnEnter,
                MenuCallback::PreStep,
                MenuCallback::Step,
                MenuCallback::PostStep,
                MenuCallback::PreStep,
                MenuCallback::Step,
                MenuCallback::PostStep,
            ]
        );
        assert_eq!(
            events[0].args,
            [CallbackArg::Number(0x10 as f64), CallbackArg::Number(0.0)]
        );
        assert_eq!(
            events[3].args,
            [CallbackArg::Number(0x10 as f64), CallbackArg::Number(1.0)]
        );
        assert_eq!(
            events[6].args,
            [CallbackArg::Number(0x20 as f64), CallbackArg::Number(0.0)]
        );
        assert!(events[9..].iter().all(|event| event.args.is_empty()));
    }

    #[test]
    fn menu_scenario_replays_typed_events_and_measures_gaps() {
        let mut s = LuaSession::standard(true).expect("menu session");
        s.exec(
            "menu-events",
            br#"
                trace = ""
                function OnOpenEndLayer(layer, index, enabled)
                    trace = trace .. "O" .. index .. tostring(enabled) .. sceneSlot
                    funcLuaMenuCommand(0x2A64B198, 0x1234, 0, false)
                end
                function OnFunction()
                    error("function failure")
                end
                function OnBack()
                    trace = trace .. "B"
                end
            "#,
        )
        .expect("scenario callbacks");
        let mut context = RuntimeContext::default();
        context.set_string("sceneSlot", "S");
        let events = [
            MenuEvent::new(MenuCallback::OnOpenEndLayer)
                .with_args([
                    CallbackArg::Number(0x77 as f64),
                    CallbackArg::Number(7.0),
                    CallbackArg::Boolean(true),
                ])
                .with_context(context),
            MenuEvent::new(MenuCallback::OnMouseMove),
            MenuEvent::new(MenuCallback::OnFunction),
            MenuEvent::new(MenuCallback::OnBack),
        ];

        let report = s
            .dispatch_menu_events_with_limit(&events, None)
            .expect("scenario driver");
        assert_eq!(report.events_requested, 4);
        assert_eq!(report.events_dispatched, 3);
        assert_eq!(report.events_succeeded, 2);
        assert_eq!(
            report.callback_invocations,
            BTreeMap::from([
                (MenuCallback::OnBack, 1),
                (MenuCallback::OnFunction, 1),
                (MenuCallback::OnOpenEndLayer, 1),
            ])
        );
        assert_eq!(report.missing_callbacks, [MenuCallback::OnMouseMove]);
        assert_eq!(report.callback_errors.len(), 1);
        assert!(report.callback_errors[0].contains("function failure"));
        assert_eq!(s.eval("trace").unwrap(), "O7trueSB");

        let state = s.menu_state().expect("menu state");
        let state = state.borrow();
        assert_eq!(state.current_layer, 0x77);
        assert!(!state.layers[&0x77].objects[&0x1234].visible);
        assert!(!state.layers.contains_key(&0));
    }

    #[test]
    fn menu_scenario_bounds_a_callback_and_removes_the_hook() {
        let mut s = LuaSession::standard(true).expect("menu session");
        s.exec(
            "bounded-events",
            br#"function Step() while true do end end"#,
        )
        .expect("blocking callback");
        let report = s
            .dispatch_menu_events_with_limit(&[MenuEvent::new(MenuCallback::Step)], Some(10_000))
            .expect("driver captures the limit");
        assert_eq!(report.events_dispatched, 1);
        assert_eq!(report.events_succeeded, 0);
        assert_eq!(report.callback_errors.len(), 1);
        assert!(report.callback_errors[0].contains("execution limit reached"));
        s.exec("after-event-limit", b"event_driver_survived = true")
            .expect("VM remains usable after the scenario");
        assert_eq!(s.eval("event_driver_survived").unwrap(), "true");
    }

    #[test]
    fn la_session_persistante_resout_include_dans_la_meme_vm() {
        let logs: LogSink = Rc::new(RefCell::new(Vec::new()));
        let registry = HostRegistry::standard(Rc::clone(&logs));
        let module = br#"module_value = (rawget(_G, "module_value") or 0) + 1; return { value = module_value }"#
            .to_vec();
        let module_for_resolver = module.clone();
        let mut s = LuaSession::with_include(registry, logs, false, move |name| {
            (name == "LUA_TEST_MODULE").then(|| module_for_resolver.clone())
        })
        .expect("session avec include");

        s.exec(
            "main",
            br#"INCLUDE("LUA_TEST_MODULE"); main_value = module_value"#,
        )
        .expect("premier include");
        assert_eq!(s.eval("main_value").unwrap(), "1");
        assert_eq!(s.take_loaded_includes(), vec!["LUA_TEST_MODULE"]);
        s.reload().expect("rechargement");
        s.exec(
            "main",
            br#"INCLUDE("LUA_TEST_MODULE"); main_value = module_value"#,
        )
        .expect("include après rechargement");
        assert_eq!(s.eval("main_value").unwrap(), "1");
        assert_eq!(s.take_loaded_includes(), vec!["LUA_TEST_MODULE"]);
        s.exec("missing", br#"INCLUDE("LUA_MISSING"); missing_value = 1"#)
            .expect("include absent toléré");
        assert_eq!(s.take_missing_includes(), vec!["LUA_MISSING"]);
        assert!(s.take_missing_includes().is_empty());
    }

    #[test]
    fn la_session_indexe_un_include_vfs_versionne() {
        let logs: LogSink = Rc::new(RefCell::new(Vec::new()));
        let registry = HostRegistry::standard(Rc::clone(&logs));
        let paths = vec![
            "data/common/script/lua/menu/module_9.lua.bin".to_string(),
            "data/common/script/lua/menu/module_10.lua.bin".to_string(),
        ];
        let session = LuaSession::with_script_paths(registry, logs, false, paths, |path| {
            (path.ends_with("module_10.lua.bin")).then(|| b"vfs_value = 42".to_vec())
        })
        .expect("session VFS");
        session
            .exec("main", br#"INCLUDE("LUA_MODULE"); assert(vfs_value == 42)"#)
            .expect("include VFS versionné");
        assert_eq!(session.take_loaded_includes(), vec!["LUA_MODULE"]);
        session
            .exec_vfs("data/common/script/lua/menu/module_10.lua.bin")
            .expect("chunk principal VFS versionné");
        assert_eq!(session.eval("vfs_value").unwrap(), "42");
    }

    #[test]
    fn le_driver_menu_vfs_resout_le_chunk_principal_et_son_include() {
        let logs: LogSink = Rc::new(RefCell::new(Vec::new()));
        let registry = HostRegistry::standard(Rc::clone(&logs));
        let vm = crate::new_vm();
        let main = vm
            .load(r#"INCLUDE("LUA_INC"); function OnInit() menu_ready = included end"#)
            .into_function()
            .expect("chunk menu principal")
            .dump(false);
        let include = vm
            .load("included = true")
            .into_function()
            .expect("chunk include")
            .dump(false);
        let main_for_reader = main.clone();
        let include_for_reader = include.clone();
        let paths = vec![
            "data/common/script/lua/menu/main_1.lua.bin".to_string(),
            "data/common/script/lua/menu/inc_1.lua.bin".to_string(),
        ];
        let session = LuaSession::with_script_paths(registry, logs, true, paths, move |path| {
            if path.ends_with("main_1.lua.bin") {
                Some(main_for_reader.clone())
            } else if path.ends_with("inc_1.lua.bin") {
                Some(include_for_reader.clone())
            } else {
                None
            }
        })
        .expect("session VFS menu");
        let report = session
            .drive_menu_vfs_for_frames("LUA_MAIN", &[], &std::collections::BTreeMap::new(), 0)
            .expect("pilotage VFS");
        assert!(report.top_level_ok);
        assert!(report.decoded_instructions.unwrap_or(0) > 0);
        assert!(
            report
                .decoded_include_instructions
                .get("LUA_INC")
                .copied()
                .unwrap_or(0)
                > 0
        );
        assert_eq!(
            report.decoded_instructions_total,
            Some(
                report.decoded_instructions.unwrap()
                    + report.decoded_include_instructions["LUA_INC"]
            )
        );
        assert_eq!(report.on_init, Some(true));
        assert_eq!(session.eval("menu_ready").unwrap(), "true");
        assert_eq!(session.take_loaded_includes(), vec!["LUA_INC"]);
    }

    #[test]
    fn lexecution_vfs_borne_une_boucle_et_retire_le_hook() {
        let logs: LogSink = Rc::new(RefCell::new(Vec::new()));
        let registry = HostRegistry::standard(Rc::clone(&logs));
        let session = LuaSession::with_include(registry, logs, false, |name| {
            (name == "loop.lua.bin").then(|| b"while true do end".to_vec())
        })
        .expect("session VFS");
        let error = session
            .exec_vfs_with_limit("loop.lua.bin", Some(10_000))
            .expect_err("la boucle VFS doit être interrompue");
        assert!(error.to_string().contains("limite d'exécution"));
        session
            .exec("after-limit", b"survived = true")
            .expect("la VM reste utilisable après le hook");
        assert_eq!(session.eval("survived").unwrap(), "true");
    }

    #[test]
    fn la_session_menu_conserve_le_menu_state_de_la_vm_live() {
        let mut s = LuaSession::standard(true).expect("session menu");
        let bytes = s
            .lua()
            .load(
                &br#"
                function OnInit()
                    funcLuaMenuCommand(0x2A64B198, 0x1234, 0, false)
                end
            "#[..],
            )
            .into_function()
            .expect("compile menu")
            .dump(false);

        let report = s
            .drive_menu_for_frames(
                &bytes,
                "live-menu",
                &[],
                &std::collections::BTreeMap::new(),
                0,
            )
            .expect("drive menu");
        assert_eq!(report.on_init, Some(true));
        let state = s.menu_state().expect("MenuState conservé");
        assert!(!state.borrow().layers[&0].objects[&0x1234].visible);

        s.reload().expect("reload");
        assert!(
            s.menu_state()
                .expect("MenuState après reload")
                .borrow()
                .layers
                .is_empty()
        );
    }

    #[test]
    fn le_driver_session_injecte_les_comptes_de_scene_absents() {
        let s = LuaSession::standard(true).expect("session menu");
        let lua = s.lua();
        let bytes = lua
            .load(
                r#"function OnInit()
                    observed_count = funcLuaMenuCommand(0x4612788B, 0x1234)
                end"#,
            )
            .into_function()
            .expect("compilation menu")
            .dump(false);
        let counts = std::collections::BTreeMap::from([(0x1234_u32, 7_i32)]);
        s.drive_menu_for_frames(&bytes, "scene-count", &[], &counts, 0)
            .expect("driver");
        assert_eq!(s.eval("observed_count").unwrap(), "7");
    }

    #[test]
    fn le_driver_menu_borne_un_callback_et_retire_le_hook() {
        let s = LuaSession::standard(true).expect("session menu");
        let bytes = s
            .lua()
            .load(
                r#"function OnInit()
                    while true do end
                end"#,
            )
            .into_function()
            .expect("compilation menu")
            .dump(false);
        let report = s
            .drive_menu_for_frames_with_limit(
                &bytes,
                "loop-menu",
                &[],
                &std::collections::BTreeMap::new(),
                0,
                Some(10_000),
            )
            .expect("le driver capture l'erreur de limite");
        assert_eq!(report.on_init, Some(false));
        assert!(
            report
                .callback_errors
                .iter()
                .any(|error| error.contains("limite d'exécution"))
        );
        s.exec("after-menu-limit", b"menu_survived = true")
            .expect("la VM reste utilisable après le driver");
        assert_eq!(s.eval("menu_survived").unwrap(), "true");
    }

    #[test]
    fn le_driver_menu_initialise_un_chunk_une_seule_fois_dans_la_vm() {
        let s = LuaSession::standard(true).expect("session menu");
        let bytes = s
            .lua()
            .load(
                r#"local counts = { init = 0, frame = 0 }
                   function OnInit() counts.init = counts.init + 1 end
                   function Step() counts.frame = counts.frame + 1 end"#,
            )
            .into_function()
            .expect("compilation menu")
            .dump(false);
        let empty = std::collections::BTreeMap::new();
        let first = s
            .drive_menu_for_frames(&bytes, "persistent-menu", &[], &empty, 1)
            .expect("premier pilotage");
        let second = s
            .drive_menu_for_frames(&bytes, "persistent-menu", &[], &empty, 1)
            .expect("second pilotage");
        assert_eq!(first.on_init, Some(true));
        assert_eq!(second.on_init, None, "OnInit ne doit pas être rejoué");
        assert_eq!(first.callback_invocations.get("Step"), Some(&1));
        assert_eq!(second.callback_invocations.get("Step"), Some(&1));
    }

    #[test]
    fn attache_un_comportement_et_diffuse_les_callbacks() {
        let mut s = session();
        s.attach(
            "essai",
            br#"
            local M = { appels = 0 }
            function M.OnStart() M.appels = M.appels + 1 end
            function M.OnUpdate() M.appels = M.appels + 10 end
            comportement = M
            return M
            "#,
        )
        .expect("attachement");

        let b = &s.behaviours()[0];
        let defined = b.defined_callbacks();
        assert!(defined.contains(&"OnStart"), "callbacks : {defined:?}");
        assert!(defined.contains(&"OnUpdate"), "callbacks : {defined:?}");
        assert!(
            !defined.contains(&"OnDestroy"),
            "OnDestroy n'est pas défini : {defined:?}"
        );

        assert_eq!(s.broadcast("OnStart").unwrap(), 1);
        assert_eq!(s.broadcast("OnUpdate").unwrap(), 1);
        // Un callback qu'aucun script ne définit : diffusé à personne, sans erreur.
        assert_eq!(s.broadcast("OnDestroy").unwrap(), 0);

        assert_eq!(s.eval("comportement.appels").unwrap(), "11");
    }

    #[test]
    fn refuse_un_script_qui_ne_renvoie_pas_de_table() {
        let mut s = session();
        let err = match s.attach("pas_un_comportement", b"local x = 1") {
            Err(e) => e,
            Ok(_) => panic!("un script sans table ne doit pas être attaché"),
        };
        assert!(
            err.to_string().contains("doit renvoyer une table"),
            "message peu clair : {err}"
        );
    }

    /// Le rechargement doit VRAIMENT repartir de zéro : une définition retirée du script ne doit
    /// pas survivre. C'est tout l'argument d'Overload pour recréer le contexte.
    #[test]
    fn le_rechargement_efface_letat_precedent() {
        let mut s = session();
        s.eval("resteApres = 'oui'").expect("eval");
        assert_eq!(s.eval("resteApres").unwrap(), "oui");

        s.reload().expect("rechargement");
        // La VM est neuve : le global posé à la main a disparu. `nil` — et pas la valeur d'avant.
        assert_eq!(s.eval("type(rawget(_G, 'resteApres'))").unwrap(), "nil");
    }

    #[test]
    fn le_rechargement_reattache_les_comportements() {
        let mut s = session();
        s.attach("c", b"local M = {} function M.OnStart() end return M")
            .expect("attachement");
        assert_eq!(s.behaviours().len(), 1);

        s.reload().expect("rechargement");
        assert_eq!(
            s.behaviours().len(),
            1,
            "le comportement doit être ré-attaché"
        );
        assert_eq!(s.broadcast("OnStart").unwrap(), 1);
    }

    #[test]
    fn rapport_dapi_confronte_reclame_et_fourni() {
        let s = session();
        // `Debug` et `Math` sont fournis par les binders ; les deux autres non.
        s.eval("Debug.Log('ok') MOTEUR_INCONNU() AUTRE_APPEL()")
            .expect("eval");

        let report = s.api_report();
        assert!(report.provided.contains(&"Debug".to_string()));
        assert!(
            report.missing.contains(&"MOTEUR_INCONNU".to_string()),
            "{report:?}"
        );
        assert!(
            report.missing.contains(&"AUTRE_APPEL".to_string()),
            "{report:?}"
        );
        assert!(
            !report.missing.contains(&"Debug".to_string()),
            "un global fourni par un binder ne doit jamais être compté manquant : {report:?}"
        );
    }

    #[test]
    fn edite_une_valeur_dans_la_session_vivante() {
        let s = session();
        s.eval("pv = 100").expect("eval");
        s.set_global("pv", "250").expect("écriture");
        assert_eq!(s.eval("pv").unwrap(), "250");

        s.set_global("table_test", "{a = 1, b = 2}")
            .expect("écriture");
        assert_eq!(s.eval("table_test.b").unwrap(), "2");
    }

    #[test]
    fn capture_la_sortie_et_les_journaux() {
        let s = session();
        s.exec("t", b"print('sortie') Debug.LogWarning('attention')")
            .expect("exec");
        assert_eq!(s.take_output(), vec!["sortie".to_string()]);
        let logs = s.take_logs();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].message, "attention");
        // Le tampon est vidé par la prise : deux appels ne doivent pas rejouer les mêmes lignes.
        assert!(s.take_logs().is_empty());
    }
}
