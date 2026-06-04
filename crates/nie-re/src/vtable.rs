//! Récupération des arêtes de **vtable** (cohésion de classe) pour classer le
//! résidu appelé uniquement par indirection.
//!
//! Une vtable MSVC est un tableau de pointeurs de fonctions en `.rdata`, propre
//! à **une** classe : toutes ses méthodes appartiennent au même sous-système.
//! `nie-re::rtti` a déjà localisé l'adresse de chaque vtable (le slot juste
//! **avant** les méthodes contient le pointeur `_RTTICompleteObjectLocator`).
//!
//! ## Méthode
//!
//! Pour chaque vtable connue (`rtti_class.vtable_vaddr`) :
//! 1. les pointeurs de méthodes commencent à `vtable_vaddr + 8` (le slot `+0`
//!    est le pointeur COL) ;
//! 2. on lit les `u64` consécutifs tant qu'ils pointent dans `.text` ; le
//!    premier hors `.text` (= COL de la vtable suivante) marque la fin ;
//! 3. chaque cible `.text` est une **méthode** de la classe. Si ce n'est pas
//!    une fonction connue (`.pdata` ne couvre pas les feuilles sans unwind),
//!    on l'**ajoute** comme nouveau nœud ;
//! 4. on relie les méthodes d'une même vtable par des arêtes de **cohésion**
//!    (étoile depuis la 1re méthode) en `xref` kind=`vtable` : la propagation
//!    diffuse alors le sous-système de classe à toutes les co-méthodes.

use anyhow::{Context, Result};
use goblin::pe::PE;
use hashbrown::HashSet;
use nie_index::{rusqlite, Db};
use tracing::info;

/// Statistiques de la récupération de vtables.
#[derive(Debug, Clone, Copy, Default)]
pub struct VtableStats {
    /// Vtables traitées (avec au moins une méthode).
    pub vtables: usize,
    /// Méthodes distinctes trouvées (cibles `.text`).
    pub methods: usize,
    /// Nouvelles fonctions feuilles ajoutées (méthodes hors `.pdata`).
    pub new_leaf_funcs: usize,
    /// Arêtes de cohésion insérées.
    pub cohesion_edges: usize,
}

/// Lit les vtables localisées par RTTI (`src_bin`), ajoute les méthodes feuilles
/// manquantes comme nœuds dans `dst_bin`, et insère les arêtes de cohésion de
/// classe (`kind='vtable'`) qui relient les co-méthodes pour la propagation.
pub fn vtable_edges_into(
    db: &mut Db,
    src_bin: i64,
    dst_bin: i64,
    exe_path: &std::path::Path,
) -> Result<VtableStats> {
    let bytes = std::fs::read(exe_path).with_context(|| format!("lecture {}", exe_path.display()))?;
    let pe = PE::parse(&bytes).context("goblin: parse PE")?;
    let image_base = pe.image_base;

    let text = pe
        .sections
        .iter()
        .find(|s| s.name().is_ok_and(|n| n.starts_with(".text")))
        .context(".text introuvable")?;
    let text_va = image_base + u64::from(text.virtual_address);
    let text_end = text_va + u64::from(text.virtual_size.min(text.size_of_raw_data));

    let rdata = pe
        .sections
        .iter()
        .find(|s| s.name().is_ok_and(|n| n.starts_with(".rdata")))
        .context(".rdata introuvable")?;
    let rdata_va = image_base + u64::from(rdata.virtual_address);
    let rdata_off = rdata.pointer_to_raw_data as usize;
    let rdata_len = rdata.virtual_size.min(rdata.size_of_raw_data) as usize;
    let rdata_bytes = bytes
        .get(rdata_off..rdata_off + rdata_len)
        .context(".rdata hors limites")?;
    // Lit un u64 LE à l'adresse virtuelle `va` si elle est dans `.rdata`.
    let rd_u64 = |va: u64| -> Option<u64> {
        if va < rdata_va {
            return None;
        }
        let off = (va - rdata_va) as usize;
        rdata_bytes.get(off..off + 8).map(|b| u64::from_le_bytes(b.try_into().unwrap()))
    };

    // Vtables localisées par RTTI.
    let vtables: Vec<u64> = {
        let mut q = db.conn().prepare(
            "SELECT vtable_vaddr FROM rtti_class WHERE binary_id=?1 AND vtable_vaddr IS NOT NULL",
        )?;
        q.query_map([src_bin], |r| r.get::<_, i64>(0).map(|v| v as u64))?
            .collect::<std::result::Result<_, _>>()?
    };

    // Fonctions connues de la cible.
    let mut known: HashSet<u64> = {
        let mut q = db.conn().prepare("SELECT vaddr FROM function WHERE binary_id=?1")?;
        q.query_map([dst_bin], |r| r.get::<_, i64>(0).map(|v| v as u64))?
            .collect::<std::result::Result<_, _>>()?
    };

    let mut stats = VtableStats::default();
    let mut all_methods: HashSet<u64> = HashSet::new();
    // Liste des vtables → méthodes (pour les arêtes après insertion des nœuds).
    let mut groups: Vec<Vec<u64>> = Vec::with_capacity(vtables.len());

    for vt in vtables {
        let mut methods = Vec::new();
        let mut k = 1u64; // saute le pointeur COL en +0
        while k < 256 {
            let Some(slot) = rd_u64(vt + k * 8) else { break };
            if (text_va..text_end).contains(&slot) {
                methods.push(slot);
                all_methods.insert(slot);
                k += 1;
            } else {
                break;
            }
        }
        if methods.len() >= 2 {
            stats.vtables += 1;
            groups.push(methods);
        }
    }
    stats.methods = all_methods.len();

    let tx = db.conn_mut().transaction()?;
    // 1. Ajoute les méthodes feuilles manquantes comme nœuds.
    {
        let mut ins = tx.prepare_cached(
            "INSERT OR IGNORE INTO function(binary_id, vaddr, name_source, subsystem, confidence)
             VALUES(?1,?2,'vtable','standalone',0.0)",
        )?;
        for &m in &all_methods {
            if !known.contains(&m) {
                ins.execute(rusqlite::params![dst_bin, m as i64])?;
                known.insert(m);
                stats.new_leaf_funcs += 1;
            }
        }
    }
    // 2. Arêtes de cohésion (étoile depuis la 1re méthode).
    {
        let mut ins = tx.prepare_cached(
            "INSERT OR IGNORE INTO xref(binary_id, from_addr, to_addr, kind) VALUES(?1,?2,?3,'vtable')",
        )?;
        for g in &groups {
            let hub = g[0] as i64;
            for &m in &g[1..] {
                if m as i64 != hub {
                    stats.cohesion_edges +=
                        ins.execute(rusqlite::params![dst_bin, hub, m as i64])?;
                }
            }
        }
    }
    tx.commit()?;

    info!(
        "vtable: {} vtables, {} méthodes, {} feuilles ajoutées, {} arêtes cohésion",
        stats.vtables, stats.methods, stats.new_leaf_funcs, stats.cohesion_edges
    );
    Ok(stats)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Vérifie qu'une étoile relie bien toutes les méthodes au pivot (logique
    /// de groupe — testée sans PE réel).
    #[test]
    fn etoile_relie_toutes_les_methodes() {
        let methods = [0x2000u64, 0x2100, 0x2200, 0x2300];
        let hub = methods[0];
        let edges: Vec<(u64, u64)> = methods[1..].iter().map(|&m| (hub, m)).collect();
        assert_eq!(edges.len(), 3);
        assert!(edges.iter().all(|&(h, _)| h == 0x2000));
        // chaque méthode (sauf le pivot) est atteinte.
        let reached: HashSet<u64> = edges.iter().map(|&(_, m)| m).collect();
        assert_eq!(reached.len(), 3);
        assert!(!reached.contains(&hub));
    }
}
