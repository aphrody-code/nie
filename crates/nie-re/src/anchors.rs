//! Ancrage de fonctions par leurs références de chaînes.
//!
//! Avant la propagation de labels, on parcourt `func_str_ref` et on assigne
//! un sous-système à toute fonction dont une chaîne référencée correspond à
//! une règle connue (correspondance partielle, insensible à la casse).
//! Les fonctions ainsi ancrées sont verrouillées dans le [`PropagationGraph`]
//! (leur label ne sera jamais écrasé par la propagation).
//!
//! La table de règles est une liste ordonnée `(motif, sous-système)`. Le
//! premier motif qui correspond est retenu (règles plus spécifiques en tête).

use anyhow::Result;
use nie_index::rusqlite::Connection;
use tracing::debug;

/// Une règle d'ancrage : si la chaîne contient `pattern` (casse-insensible)
/// le sous-système est `subsystem`.
#[derive(Debug, Clone, Copy)]
pub struct Rule {
    /// Sous-chaîne à chercher (comparée en minuscules).
    pub pattern: &'static str,
    /// Sous-système assigné si la règle correspond.
    pub subsystem: &'static str,
}

/// Table de règles d'ancrage par chaînes. Ordre décroissant de spécificité :
/// les motifs les plus précis sont en tête pour court-circuiter les motifs
/// généraux.
pub static RULES: &[Rule] = &[
    // Audio (CriWare / HCA)
    Rule { pattern: "criatom",   subsystem: "audio" },
    Rule { pattern: "criware",   subsystem: "audio" },
    Rule { pattern: "criadx",    subsystem: "audio" },
    Rule { pattern: "hca",       subsystem: "audio" },
    Rule { pattern: "adxf",      subsystem: "audio" },
    Rule { pattern: "acb",       subsystem: "audio" },
    Rule { pattern: "cri_atom",  subsystem: "audio" },
    // Render / DirectX
    Rule { pattern: "d3d11",     subsystem: "render" },
    Rule { pattern: "d3d12",     subsystem: "render" },
    Rule { pattern: "dxgi",      subsystem: "render" },
    Rule { pattern: "dxbc",      subsystem: "render" },
    Rule { pattern: "hlsl",      subsystem: "render" },
    Rule { pattern: "g4tx",      subsystem: "render" },
    Rule { pattern: "shader",    subsystem: "render" },
    // Scripting (Lua)
    Rule { pattern: "lua_",      subsystem: "script" },
    Rule { pattern: "lua state", subsystem: "script" },
    Rule { pattern: "luastate",  subsystem: "script" },
    Rule { pattern: "luaerror",  subsystem: "script" },
    Rule { pattern: ".lua",      subsystem: "script" },
    // Fichiers virtuels / CPK
    Rule { pattern: "cpk",       subsystem: "vfs" },
    Rule { pattern: ".g4pk",     subsystem: "vfs" },
    Rule { pattern: ".g4md",     subsystem: "vfs" },
    Rule { pattern: "g4pk",      subsystem: "vfs" },
    Rule { pattern: "pakfile",   subsystem: "vfs" },
    // Gameplay / football
    Rule { pattern: "soccer",    subsystem: "gameplay" },
    Rule { pattern: "ball",      subsystem: "gameplay" },
    Rule { pattern: "formation", subsystem: "gameplay" },
    Rule { pattern: "shoot",     subsystem: "gameplay" },
    Rule { pattern: "dribble",   subsystem: "gameplay" },
    Rule { pattern: "goal",      subsystem: "gameplay" },
    // Menu / UI
    Rule { pattern: "cmenu",     subsystem: "menu" },
    Rule { pattern: "menulist",  subsystem: "menu" },
    Rule { pattern: "menuview",  subsystem: "menu" },
    Rule { pattern: "menu",      subsystem: "menu" },
    // Personnages / données IEVR
    Rule { pattern: "chara_param", subsystem: "chara" },
    Rule { pattern: "chara",      subsystem: "chara" },
    // Physique (PhysX)
    Rule { pattern: "physx",     subsystem: "physics" },
    Rule { pattern: "physics",   subsystem: "physics" },
    Rule { pattern: "pxshared",  subsystem: "physics" },
    Rule { pattern: "npc",       subsystem: "physics" },
    // Réseau / plateformes
    Rule { pattern: "eos",       subsystem: "network" },
    Rule { pattern: "steam",     subsystem: "network" },
    Rule { pattern: "lobby",     subsystem: "network" },
    Rule { pattern: "matchmak",  subsystem: "network" },
    Rule { pattern: "session",   subsystem: "network" },
    // Animation
    Rule { pattern: "animation", subsystem: "animation" },
    Rule { pattern: "motion",    subsystem: "animation" },
    Rule { pattern: "bone",      subsystem: "animation" },
    Rule { pattern: "attach",    subsystem: "animation" },
];

/// Applique toutes les règles à une valeur de chaîne et renvoie le
/// sous-système correspondant au premier motif qui correspond, ou `None`.
#[must_use]
pub fn classify_str(value: &str) -> Option<&'static str> {
    let lower = value.to_lowercase();
    for rule in RULES {
        if lower.contains(rule.pattern) {
            return Some(rule.subsystem);
        }
    }
    None
}

/// Résultat de l'ancrage par chaînes.
#[derive(Debug, Default, Clone, Copy)]
pub struct AnchorStats {
    /// Fonctions ayant reçu une ancre (nouvelles ou mise à jour).
    pub anchored: usize,
}

/// Parcourt `func_str_ref` et pose des ancres (`subsystem` + `subsys_src='str'`)
/// sur les fonctions dont le sous-système est encore `'standalone'` ou `NULL`,
/// en appliquant [`RULES`]. Opère sous une seule transaction.
///
/// Les fonctions déjà classifiées (subsystem hors standalone/NULL) ne sont
/// pas modifiées : leur label est supposé fiable.
pub fn anchor_by_strings(conn: &Connection, binary_id: i64) -> Result<AnchorStats> {
    // Charge toutes les paires (function_id, vaddr, str_value) pour les
    // fonctions encore non classifiées.
    let mut stmt = conn.prepare(
        "SELECT DISTINCT f.id, f.vaddr, sr.value
         FROM function f
         JOIN func_str_ref sr ON sr.function_id = f.id
         WHERE f.binary_id = ?1
           AND (f.subsystem IS NULL
                OR f.subsystem = 'standalone')",
    )?;

    // Collecte avant modification pour ne pas tenir le statement ouvert lors
    // des UPDATE.
    let rows: Vec<(i64, i64, String)> = stmt
        .query_map([binary_id], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?))
        })?
        .collect::<std::result::Result<_, _>>()?;

    // Pour chaque fonction, prend le premier sous-système trouvé parmi toutes
    // ses chaînes (ordre de la requête).
    let mut best: hashbrown::HashMap<i64, (&'static str, i64)> = hashbrown::HashMap::new();
    for (fid, vaddr, value) in &rows {
        if let Some(sub) = classify_str(value) {
            best.entry(*fid).or_insert((sub, *vaddr));
        }
    }

    let mut anchored = 0usize;
    for (fid, (sub, _vaddr)) in &best {
        conn.execute(
            "UPDATE function SET subsystem=?1, subsys_src='str', confidence=0.8
             WHERE id=?2",
            nie_index::rusqlite::params![sub, fid],
        )?;
        debug!(fid, sub, "ancre str posée");
        anchored += 1;
    }

    Ok(AnchorStats { anchored })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_str_audio() {
        assert_eq!(classify_str("criAtom_OpenWithId"), Some("audio"));
        assert_eq!(classify_str("hca_decode"), Some("audio"));
    }

    #[test]
    fn classify_str_render() {
        assert_eq!(classify_str("d3d11CreateDevice"), Some("render"));
        assert_eq!(classify_str("G4TX_MAGIC"), Some("render"));
    }

    #[test]
    fn classify_str_vfs() {
        assert_eq!(classify_str("cpkFilename"), Some("vfs"));
    }

    #[test]
    fn classify_str_gameplay() {
        assert_eq!(classify_str("BallMoveNormal"), Some("gameplay"));
        assert_eq!(classify_str("SoccerManager"), Some("gameplay"));
    }

    #[test]
    fn classify_str_chara() {
        assert_eq!(classify_str("CHARA_PARAM_INFO"), Some("chara"));
    }

    #[test]
    fn classify_str_no_match() {
        assert_eq!(classify_str("E2009011412"), None);
        assert_eq!(classify_str("xyz_unknown_data"), None);
    }

    #[test]
    fn classify_str_case_insensitive() {
        assert_eq!(classify_str("CriAtom_OpenEx"), Some("audio"));
        assert_eq!(classify_str("CRIATOM"), Some("audio"));
    }
}
