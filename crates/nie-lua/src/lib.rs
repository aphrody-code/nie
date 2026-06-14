//! `nie-lua` — la VM Lua **réelle** du jeu (mlua, PUC-Rio Lua 5.2.4 vendored).
//!
//! Le moteur Level-5 « Lives » pilote ses menus, scènes et événements par des scripts
//! Lua 5.2 compilés en bytecode (`.lua.bin`, ~616 fichiers sous `data/common/script/lua/`).
//! Reproduire le jeu À L'IDENTIQUE impose d'exécuter CES scripts dans LEUR VM exacte —
//! pas une réinterprétation. mlua avec `lua52` + `vendored` embarque PUC-Rio Lua 5.2.4,
//! la même implémentation que le jeu, et charge le **bytecode** directement.
//!
//! (iecode, faute de VM 5.2 native en C#, décompile via `unluac` puis réinterprète sous
//! MoonSharp — chemin lossy ; ici on exécute le bytecode d'origine.)
//!
//! ## `unsafe`
//!
//! Charger du bytecode Lua arbitraire exige `Lua::unsafe_new` (un bytecode malformé peut
//! corrompre la VM) : cette crate est donc volontairement hors `forbid(unsafe_code)`.

use thiserror::Error;

/// Signature d'un chunk de bytecode Lua 5.2 PUC-Rio : `1B 4C 75 61` (`\x1bLua`) + `0x52`.
pub const LUA52_BYTECODE_SIGNATURE: [u8; 5] = [0x1B, 0x4C, 0x75, 0x61, 0x52];

/// Erreurs de chargement/exécution d'un script du jeu.
#[derive(Debug, Error)]
pub enum LuaError {
    /// Le tampon ne commence pas par la signature bytecode Lua 5.2.
    #[error("pas un bytecode Lua 5.2 (signature {0:02x?} attendue)")]
    NotLua52Bytecode([u8; 5]),
    /// Erreur remontée par la VM mlua (chargement ou exécution).
    #[error("erreur VM Lua : {0}")]
    Vm(#[from] mlua::Error),
}

/// Vrai si `data` commence par la signature d'un bytecode Lua 5.2 PUC-Rio.
#[must_use]
pub fn is_lua52_bytecode(data: &[u8]) -> bool {
    data.len() >= 5 && data[..5] == LUA52_BYTECODE_SIGNATURE
}

/// Crée une VM Lua 5.2 capable de charger du bytecode (bibliothèques non sandboxées).
///
/// Note : `Lua::unsafe_new` est requis pour `ChunkMode::Binary`.
#[must_use]
pub fn new_vm() -> mlua::Lua {
    // SAFETY: on exécute du bytecode du jeu (de confiance) ; unsafe_new active le chargement
    // de chunks binaires, indispensable pour les .lua.bin.
    unsafe { mlua::Lua::unsafe_new() }
}

/// **Charge** (compile) un chunk de bytecode `.lua.bin` du jeu dans `lua`, sans l'exécuter.
///
/// Prouve que la VM accepte le bytecode du jeu (= même implémentation Lua). Retourne la
/// fonction Lua compilée prête à être appelée (une fois les fonctions hôtes injectées).
///
/// # Errors
/// [`LuaError::NotLua52Bytecode`] si la signature est absente ; [`LuaError::Vm`] si mlua
/// refuse le bytecode (version/format incompatibles).
pub fn load_bytecode(
    lua: &mlua::Lua,
    data: &[u8],
    name: &str,
) -> Result<mlua::Function, LuaError> {
    if !is_lua52_bytecode(data) {
        let mut sig = [0u8; 5];
        sig.copy_from_slice(&data[..5.min(data.len())]);
        return Err(LuaError::NotLua52Bytecode(sig));
    }
    let func = lua
        .load(data)
        .set_name(name)
        .set_mode(mlua::ChunkMode::Binary)
        .into_function()?;
    Ok(func)
}

/// Installe la fonction hôte `INCLUDE(name)` — le **système de modules** du moteur : le
/// script appelle `INCLUDE("…")`, l'hôte résout le nom en bytecode `.lua.bin` (via `resolver`)
/// et l'exécute dans la MÊME VM. Renvoie les valeurs du module inclus (ou rien si introuvable,
/// comportement aligné sur iecode `DefaultLuaHost`).
///
/// `resolver` : nom logique d'include → bytecode du module (typiquement adossé au VFS).
///
/// # Errors
/// [`mlua::Error`] si l'enregistrement de la fonction échoue.
pub fn install_include<F>(lua: &mlua::Lua, resolver: F) -> mlua::Result<()>
where
    F: Fn(&str) -> Option<Vec<u8>> + 'static,
{
    let f = lua.create_function(move |lua, name: String| {
        let Some(bytes) = resolver(&name) else {
            return Ok(mlua::MultiValue::new()); // introuvable → vide (comme iecode)
        };
        // Un module peut être du bytecode (.lua.bin) ou de la source ; on tente le bytecode.
        let mode = if is_lua52_bytecode(&bytes) {
            mlua::ChunkMode::Binary
        } else {
            mlua::ChunkMode::Text
        };
        let func = lua
            .load(&bytes)
            .set_name(format!("@{name}"))
            .set_mode(mode)
            .into_function()?;
        func.call::<mlua::MultiValue>(())
    })?;
    lua.globals().set("INCLUDE", f)?;
    Ok(())
}

/// Exécute un script `.lua.bin` du jeu dans une VM instrumentée et retourne la liste TRIÉE
/// des **globals hôtes** qu'il référence (fonctions/tables fournies par le moteur C++).
///
/// Technique : une métatable sur `_G` dont `__index` enregistre chaque accès à un global
/// indéfini et renvoie un stub appelable (qui renvoie lui-même un stub), afin que le script
/// s'exécute le plus loin possible sans planter. Donne la **surface d'API hôte** réelle à
/// implémenter pour faire tourner ce menu. Ne prétend pas exécuter la logique — c'est un
/// outil de bring-up moteur.
///
/// # Errors
/// [`LuaError`] si le bytecode est invalide ou si l'instrumentation échoue.
pub fn discover_host_calls(data: &[u8], name: &str) -> Result<Vec<String>, LuaError> {
    let lua = new_vm();
    // Instrumentation : enregistre tout global indéfini, renvoie un stub appelable récursif.
    lua.load(
        r#"
        _HOST_SEEN = {}
        local function stub() return setmetatable({}, { __call = function() return stub() end }) end
        setmetatable(_G, { __index = function(_, k)
            _HOST_SEEN[k] = (_HOST_SEEN[k] or 0) + 1
            return stub()
        end })
        "#,
    )
    .set_name("<host-recorder>")
    .exec()?;

    let func = load_bytecode(&lua, data, name)?;
    // pcall : on tolère une erreur d'exécution (stubs imparfaits) ; on veut juste la collecte.
    let _ = func.call::<()>(());

    let seen: mlua::Table = lua.globals().get("_HOST_SEEN")?;
    let mut names: Vec<String> = Vec::new();
    for pair in seen.pairs::<String, i64>() {
        let (k, _) = pair?;
        names.push(k);
    }
    names.sort();
    Ok(names)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// La VM exécute du Lua 5.2 SOURCE (sanity de l'intégration mlua/PUC 5.2.4).
    #[test]
    fn vm_runs_source_lua52() {
        let lua = new_vm();
        let v: i64 = lua.load("local a=2 return a*21").eval().expect("eval");
        assert_eq!(v, 42);
        // bit32 = bibliothèque spécifique à Lua 5.2 (absente en 5.1/5.3) → confirme la version.
        let b: i64 = lua.load("return bit32.band(0xF0, 0x3C)").eval().expect("bit32");
        assert_eq!(b, 0x30);
    }

    /// `is_lua52_bytecode` reconnaît la signature.
    #[test]
    fn detects_bytecode_signature() {
        assert!(is_lua52_bytecode(&[0x1B, 0x4C, 0x75, 0x61, 0x52, 0x00]));
        assert!(!is_lua52_bytecode(b"-- source lua"));
        assert!(!is_lua52_bytecode(&[0x1B, 0x4C, 0x75, 0x61, 0x51])); // 5.1
    }

    /// **Bout-en-bout sur le vrai jeu** : charge un `.lua.bin` réel dans la VM 5.2.
    /// Prouve que mlua (PUC 5.2.4) accepte le bytecode du moteur — la fondation pour
    /// exécuter la logique réelle du jeu. Gated sur l'install Steam.
    #[test]
    fn loads_real_game_lua_bytecode() {
        let dir = std::env::var("NIE_GAME_DIR").unwrap_or_else(|_| {
            "/mnt/c/Program Files (x86)/Steam/steamapps/common/INAZUMA ELEVEN Victory Road"
                .to_string()
        });
        let data_dir = std::path::Path::new(&dir).join("data");
        if !data_dir.join("cpk_list.cfg.bin").exists() {
            eprintln!("skip loads_real_game_lua_bytecode : jeu absent");
            return;
        }
        let mut vfs = nie_formats::vfs::Vfs::new();
        if vfs.init(&data_dir).is_err() {
            eprintln!("skip : vfs.init KO");
            return;
        }
        let Some(path) = vfs
            .iter()
            .map(|(p, _)| p.to_string())
            .find(|p| p.ends_with(".lua.bin"))
        else {
            eprintln!("skip : aucun .lua.bin");
            return;
        };
        let bytes = vfs.read(&path).expect("read .lua.bin");
        eprintln!(
            "script={path} taille={} signature={:02x?}",
            bytes.len(),
            &bytes[..5.min(bytes.len())]
        );
        assert!(
            is_lua52_bytecode(&bytes),
            "le .lua.bin du jeu doit être un bytecode Lua 5.2 ; en-tête {:02x?}",
            &bytes[..8.min(bytes.len())]
        );
        let lua = new_vm();
        match load_bytecode(&lua, &bytes, &path) {
            Ok(_func) => eprintln!("OK : bytecode du jeu chargé dans la VM Lua 5.2 réelle (mlua)"),
            Err(e) => panic!("mlua refuse le bytecode du jeu : {e}"),
        }
    }

    /// Bring-up moteur : exécute de vrais scripts de menu et révèle la **surface d'API hôte**
    /// (fonctions du moteur C++ que les scripts appellent) à implémenter pour les faire tourner.
    #[test]
    fn discover_host_api_of_real_menus() {
        let dir = std::env::var("NIE_GAME_DIR").unwrap_or_else(|_| {
            "/mnt/c/Program Files (x86)/Steam/steamapps/common/INAZUMA ELEVEN Victory Road"
                .to_string()
        });
        let data_dir = std::path::Path::new(&dir).join("data");
        if !data_dir.join("cpk_list.cfg.bin").exists() {
            eprintln!("skip discover_host_api_of_real_menus : jeu absent");
            return;
        }
        let mut vfs = nie_formats::vfs::Vfs::new();
        if vfs.init(&data_dir).is_err() {
            eprintln!("skip : vfs.init KO");
            return;
        }
        // Quelques scripts de menu réels.
        let scripts: Vec<String> = vfs
            .iter()
            .map(|(p, _)| p.to_string())
            .filter(|p| p.starts_with("data/common/script/lua/menu/") && p.ends_with(".lua.bin"))
            .take(5)
            .collect();
        if scripts.is_empty() {
            eprintln!("skip : aucun script de menu");
            return;
        }
        let mut union: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
        for path in &scripts {
            let Ok(bytes) = vfs.read(path) else { continue };
            match discover_host_calls(&bytes, path) {
                Ok(names) => {
                    eprintln!("\n{path}\n  → {} globals hôtes : {:?}", names.len(), names);
                    union.extend(names);
                }
                Err(e) => eprintln!("{path} : {e}"),
            }
        }
        eprintln!(
            "\n=== UNION API hôte sur {} menus ({} fonctions) ===\n{:#?}",
            scripts.len(),
            union.len(),
            union
        );
        assert!(!union.is_empty(), "les scripts doivent référencer des fonctions hôtes");
    }

    /// Bring-up moteur, couche 2 : avec un VRAI `INCLUDE` adossé au VFS, un script de menu
    /// charge ses modules → révèle l'API hôte PLUS PROFONDE (ce que les modules appellent).
    #[test]
    fn run_menu_with_real_include() {
        use std::cell::RefCell;
        use std::rc::Rc;
        let dir = std::env::var("NIE_GAME_DIR").unwrap_or_else(|_| {
            "/mnt/c/Program Files (x86)/Steam/steamapps/common/INAZUMA ELEVEN Victory Road"
                .to_string()
        });
        let data_dir = std::path::Path::new(&dir).join("data");
        if !data_dir.join("cpk_list.cfg.bin").exists() {
            eprintln!("skip run_menu_with_real_include : jeu absent");
            return;
        }
        let mut vfs = nie_formats::vfs::Vfs::new();
        if vfs.init(&data_dir).is_err() {
            eprintln!("skip : vfs.init KO");
            return;
        }
        // Index basename(.lua.bin, minuscule) → chemin VFS (résolution rapide des includes).
        let mut by_base: std::collections::HashMap<String, String> = std::collections::HashMap::new();
        for (p, _) in vfs.iter() {
            if let Some(b) = p.rsplit('/').next()
                && b.ends_with(".lua.bin")
            {
                by_base.entry(b.to_ascii_lowercase()).or_insert_with(|| p.to_string());
            }
        }
        let vfs = Rc::new(vfs);
        let by_base = Rc::new(by_base);
        let requested: Rc<RefCell<Vec<(String, bool)>>> = Rc::new(RefCell::new(Vec::new()));

        // Choisir un script de menu réel.
        let Some(top) = vfs
            .iter()
            .map(|(p, _)| p.to_string())
            .find(|p| p.starts_with("data/common/script/lua/menu/") && p.ends_with(".lua.bin"))
        else {
            eprintln!("skip : aucun script menu");
            return;
        };
        let top_bytes = vfs.read(&top).expect("read top");

        let lua = new_vm();
        {
            let vfs = Rc::clone(&vfs);
            let by_base = Rc::clone(&by_base);
            let requested = Rc::clone(&requested);
            install_include(&lua, move |name| {
                // Essais de résolution : <name>.lua.bin, <name> tel quel, basename.
                let cands = [
                    format!("{}.lua.bin", name.to_ascii_lowercase()),
                    name.to_ascii_lowercase(),
                ];
                let mut found = None;
                for c in &cands {
                    if let Some(path) = by_base.get(c) {
                        found = vfs.read(path).ok();
                        break;
                    }
                }
                requested.borrow_mut().push((name.to_string(), found.is_some()));
                found
            })
            .expect("install INCLUDE");
        }
        // Recorder pour les AUTRES globals hôtes (INCLUDE est déjà réel).
        lua.load(
            r#"_HOST_SEEN={}
               local function stub() return setmetatable({},{__call=function() return stub() end}) end
               setmetatable(_G,{__index=function(_,k) _HOST_SEEN[k]=(_HOST_SEEN[k] or 0)+1; return stub() end})"#,
        )
        .exec()
        .expect("recorder");

        let func = load_bytecode(&lua, &top_bytes, &top).expect("load top");
        let run = func.call::<()>(());
        eprintln!("\nscript={top}\n exécution : {run:?}");
        // Jalon : le bytecode RÉEL du jeu s'EXÉCUTE dans la VM (au-delà du simple chargement).
        assert!(run.is_ok(), "le script du jeu doit s'exécuter sans erreur VM : {run:?}");
        eprintln!(" includes demandés :");
        for (n, ok) in requested.borrow().iter() {
            eprintln!("   - {n}  [{}]", if *ok { "résolu" } else { "INTROUVABLE" });
        }
        let seen: mlua::Table = lua.globals().get("_HOST_SEEN").unwrap();
        let mut deeper: Vec<String> = seen.pairs::<String, i64>().filter_map(Result::ok).map(|(k, _)| k).collect();
        deeper.sort();
        eprintln!(" API hôte profonde ({}) : {:?}", deeper.len(), deeper);
    }
}
