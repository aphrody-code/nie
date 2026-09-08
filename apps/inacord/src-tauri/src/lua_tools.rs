//! Atelier Lua — façade IPC au-dessus de [`nie_lua`].
//!
//! Le moteur Level-5 « Lives » pilote ses menus, scènes et événements par des scripts Lua 5.2
//! livrés **uniquement compilés** (~1 100 `.lua.bin`). Jusqu'ici l'app savait seulement dire
//! « c'est du bytecode Lua » : ce module ouvre la chaîne complète — décoder, désassembler,
//! exécuter, inspecter, modifier.
//!
//! Tout s'appuie sur `nie-lua`, qui embarque la **VM exacte du jeu** (mlua, PUC-Rio 5.2.4
//! vendored) : le bytecode est exécuté par la même implémentation que `nie.exe`, pas
//! réinterprété.

use serde::Serialize;

/// En-tête + statistiques d'un chunk décodé.
#[derive(Serialize, specta::Type)]
pub struct LuaChunkInfoDto {
    /// Version Lua encodée dans l'en-tête (`82` = `0x52` = Lua 5.2).
    pub version: u32,
    /// `true` si petit-boutiste.
    pub little_endian: bool,
    /// Taille d'un `size_t` C (4 sur une cible 32 bits, 8 sur 64) — décale tout le fichier.
    pub size_size_t: u32,
    /// Nombre de paramètres de la fonction principale.
    pub num_params: u32,
    /// Instructions de la fonction principale.
    pub instructions: u32,
    /// Instructions au total, prototypes imbriqués compris.
    pub total_instructions: u32,
    /// Nombre de prototypes imbriqués (récursif).
    pub total_protos: u32,
    /// Constantes de la fonction principale.
    pub constants: u32,
    /// Upvalues de la fonction principale.
    pub upvalues: u32,
    /// Nom de source du bloc de débogage — vide si le chunk a été dépouillé.
    pub source: String,
    /// `true` si les tables de débogage sont présentes (lignes/locales) : c'est ce qui rend le
    /// désassemblage lisible.
    pub has_debug_info: bool,
    /// Chaînes du pool de constantes de tout l'arbre — ce que le script manipule réellement
    /// (noms de menus, clés de texte, appels moteur).
    pub strings: Vec<String>,
}

impl From<nie_lua::inspection::ChunkInfo> for LuaChunkInfoDto {
    fn from(value: nie_lua::inspection::ChunkInfo) -> Self {
        Self {
            version: value.version,
            little_endian: value.little_endian,
            size_size_t: value.size_size_t,
            num_params: value.num_params,
            instructions: value.instructions,
            total_instructions: value.total_instructions,
            total_protos: value.total_protos,
            constants: value.constants,
            upvalues: value.upvalues,
            source: value.source,
            has_debug_info: value.has_debug_info,
            strings: value.strings,
        }
    }
}

/// Décode un `.lua.bin` et renvoie son en-tête + ses statistiques.
///
/// # Errors
/// Message lisible si le tampon n'est pas du bytecode Lua 5.2 ou s'il est tronqué.
pub fn chunk_info(data: &[u8]) -> Result<LuaChunkInfoDto, String> {
    nie_lua::inspection::chunk_info(data)
        .map(LuaChunkInfoDto::from)
        .map_err(|error| error.to_string())
}

/// Désassemble un `.lua.bin` en listing lisible.
///
/// # Errors
/// Message lisible si le décodage échoue.
pub fn disassemble(data: &[u8]) -> Result<String, String> {
    nie_lua::inspection::disassemble(data).map_err(|error| error.to_string())
}

/// Résultat d'exécution renvoyé au frontend.
#[derive(Serialize, specta::Type)]
pub struct LuaExecResultDto {
    /// Lignes imprimées par `print`.
    pub stdout: Vec<String>,
    /// Message d'erreur du script, s'il a échoué (ce n'est PAS une erreur de commande : voir le
    /// message est le résultat attendu quand on mène un script au point).
    pub error: Option<String>,
    /// Valeurs retournées par le chunk.
    pub returned: Vec<String>,
    /// Globals hôtes appelés mais non définis — la surface d'API moteur que ce script réclame.
    pub missing_host_calls: Vec<String>,
    /// Durée d'exécution, en millisecondes.
    pub duration_ms: u32,
}

impl From<nie_lua::inspection::ExecutionResult> for LuaExecResultDto {
    fn from(value: nie_lua::inspection::ExecutionResult) -> Self {
        Self {
            stdout: value.stdout,
            error: value.error,
            returned: value.returned,
            missing_host_calls: value.missing_host_calls,
            duration_ms: value.duration_ms,
        }
    }
}

/// Exécute une source Lua ou un bytecode du jeu.
///
/// `with_menu_host` installe l'hôte de menu reversé (`nie_lua::install_menu_host`), ce qui permet
/// aux vrais scripts de menu d'aller bien au-delà du premier appel moteur.
///
/// # Errors
/// Message lisible si la VM ne peut pas être préparée.
pub fn execute(
    data: &[u8],
    chunk_name: &str,
    with_menu_host: bool,
    instruction_limit: Option<u32>,
) -> Result<LuaExecResultDto, String> {
    nie_lua::inspection::execute(data, chunk_name, with_menu_host, instruction_limit)
        .map(LuaExecResultDto::from)
        .map_err(|error| error.to_string())
}

/// Une valeur globale exposée à l'éditeur de valeurs.
#[derive(Serialize, specta::Type)]
pub struct LuaGlobalDto {
    /// Nom du global.
    pub name: String,
    /// Type Lua.
    pub type_name: String,
    /// Rendu texte de la valeur.
    pub value: String,
    /// Nombre d'entrées si c'est une table.
    pub len: Option<u32>,
}

impl From<nie_lua::inspection::Global> for LuaGlobalDto {
    fn from(value: nie_lua::inspection::Global) -> Self {
        Self {
            name: value.name,
            type_name: value.type_name,
            value: value.value,
            len: value.len,
        }
    }
}

/// Exécute un script puis renvoie l'état de ses globals — le pas « inspecter après exécution ».
///
/// Chaque appel repart d'une VM neuve : deux inspections successives ne doivent pas se contaminer,
/// et un script qui a corrompu son état ne doit pas empoisonner le suivant.
///
/// # Errors
/// Message lisible si la VM ne peut pas être préparée.
pub fn globals_after_run(
    data: &[u8],
    chunk_name: &str,
    with_menu_host: bool,
    overrides: &[(String, String)],
    include_stdlib: bool,
) -> Result<Vec<LuaGlobalDto>, String> {
    nie_lua::inspection::globals_after_run(
        data,
        chunk_name,
        with_menu_host,
        overrides,
        include_stdlib,
    )
    .map(|globals| globals.into_iter().map(LuaGlobalDto::from).collect())
    .map_err(|error| error.to_string())
}

/// Évalue une expression dans une VM neuve où `data` a d'abord été exécuté — la console.
///
/// # Errors
/// Message lisible si la VM ne peut pas être préparée.
pub fn eval(
    data: &[u8],
    chunk_name: &str,
    expression: &str,
    with_menu_host: bool,
) -> Result<String, String> {
    nie_lua::inspection::eval(data, chunk_name, expression, with_menu_host)
        .map_err(|error| error.to_string())
}
