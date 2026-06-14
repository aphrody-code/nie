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
}
