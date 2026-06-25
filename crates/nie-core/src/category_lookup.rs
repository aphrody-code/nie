//! Recherche de la catégorie (rangée) d'un identifiant dans une table 14×29 —
//! port byte-exact de `FUN_140d3bac0` de `nie_eacpatched.exe`.
//!
//! Sémantique. La fonction reçoit `param_1` (rcx, pointeur d'objet), `param_2`
//! (edx, identifiant 32 bits à chercher) et `param_3` (r8b, drapeau). Elle lit la
//! table `table = *(u64*)(param_1 + 0x1758)` puis balaie **14 rangées** (`r = 0..13`)
//! de **29 entrées** chacune. Chaque entrée fait `0x10` octets ; ses deux premiers
//! `i32` sont des identifiants. La rangée `r` commence à `table + r*0x82c` et les
//! entrées à l'offset `+0x80` :
//!
//! ```text
//! id0 = *(i32*)(table + r*0x82c + 0x80 + e*0x10)        // piVar1[-1]
//! id1 = *(i32*)(table + r*0x82c + 0x84 + e*0x10)        // piVar1[0]
//! ```
//!
//! Dès qu'`id0 == param_2` ou `id1 == param_2`, la fonction renvoie l'indice de
//! rangée `r` (0..13) — c'est la **catégorie** de l'identifiant. Si aucune des 14
//! rangées ne contient `param_2` :
//!   - si `param_3 != 0` → renvoie `0x0e` (14, sentinelle « non catégorisé ») ;
//!   - sinon → renvoie `0` si l'octet de mode global vaut `2`, sinon `2`.
//!
//! L'octet de mode est lu via le singleton `*(u64*)0x141fa8fc0` :
//! `*(u8*)(*(u64*)(singleton + 0x69a0) + 0x2ca97f)`. Dans le binaire le test est
//! `octet != 2 ? 2 : 0`. Ici on l'expose en paramètre `mode_special = (octet == 2)`.
//!
//! Note. La valeur de retour est sémantiquement un indice/énum dans `0..=14`
//! (le code original utilise `rax & 0xff`). Dans la branche `param_3 != 0`, le
//! binaire laisse des octets de poids fort « parasites » (un pointeur périmé dans
//! `rax`, écrasé seulement sur `al`) ; ce sont des résidus de registre sans valeur
//! sémantique. Le miroir d'oracle reproduit aussi ces octets parasites (validé
//! byte-exact sur les 64 bits), mais le port Rust renvoie l'indice invariant `u8`.
//!
//! La branche « globale » présente dans le *corps* de boucle de la décompile
//! (`if 0xd < (byte)uVar4 …`) est **morte** : `uVar4` vaut toujours `0..13` dans le
//! corps, donc la condition `0xd < uVar4` n'est jamais vraie. Seul le chemin de
//! repli (post-boucle, `param_3 == 0`) lit l'octet de mode.
//!
//! Validation. `scripts/validate_category_lookup.py` confronte ce miroir à l'oracle uemu
//! (Unicorn sur le PE réel) : 600 cas (fuzz LCG seedé — tables aléatoires, ids dans
//! et hors pool, `param_3` ∈ {0,1}, octet de mode ∈ {2, autre}, ids négatifs)
//! couvrant les quatre branches (found / fallback0 / fallback2 / ret0e) —
//! **tous byte-exacts** sur les 64 bits de `rax`.

/// Pas (en octets) d'une rangée de la table.
pub const ROW_STRIDE: usize = 0x82C;
/// Nombre de rangées (catégories).
pub const N_ROWS: u8 = 14;
/// Nombre d'entrées par rangée.
pub const N_ENTRIES: usize = 0x1D;
/// Pas (en octets) d'une entrée.
pub const ENTRY_STRIDE: usize = 0x10;
/// Offset de la première entrée dans une rangée (id0 ; id1 est à +4).
pub const ENTRY_OFF0: usize = 0x80;
/// Sentinelle « non catégorisé » renvoyée si `param_3 != 0` et aucun match.
pub const SENTINEL_NOT_FOUND: u8 = 0x0E;
/// Taille minimale (octets) requise pour la table.
pub const REQUIRED_LEN: usize =
    (N_ROWS as usize - 1) * ROW_STRIDE + ENTRY_OFF0 + (N_ENTRIES - 1) * ENTRY_STRIDE + 8;

/// Lit un `i32` little-endian à `off` ; renvoie `None` si hors borne.
#[inline]
fn read_i32(table: &[u8], off: usize) -> Option<i32> {
    let end = off.checked_add(4)?;
    let slice = table.get(off..end)?;
    Some(i32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]))
}

/// Recherche la catégorie de `target` dans `table` (port de `FUN_140d3bac0`).
///
/// - `table` : bloc pointé par `*(param_1 + 0x1758)` (≥ [`REQUIRED_LEN`] octets).
/// - `target` : identifiant à chercher (`param_2`).
/// - `force_sentinel` : `param_3 != 0`.
/// - `mode_special` : l'octet de mode global vaut `2`.
///
/// Renvoie l'indice de rangée `0..=13` si trouvé ; sinon `14` quand
/// `force_sentinel`, sinon `0` quand `mode_special`, sinon `2`.
pub fn find_id_category(table: &[u8], target: i32, force_sentinel: bool, mode_special: bool) -> u8 {
    let mut row: u8 = 0;
    while row < N_ROWS {
        let row_base = (row as usize) * ROW_STRIDE + ENTRY_OFF0;
        let mut e = 0;
        while e < N_ENTRIES {
            let off = row_base + e * ENTRY_STRIDE;
            // id0 = [off], id1 = [off+4] ; comparaison 32 bits (cmp dword, edx)
            if read_i32(table, off) == Some(target) || read_i32(table, off + 4) == Some(target) {
                return row;
            }
            e += 1;
        }
        row += 1;
    }
    // aucun match dans les 14 rangées
    if force_sentinel {
        SENTINEL_NOT_FOUND
    } else if mode_special {
        0
    } else {
        2
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Construit une table de test remplie de `-1` (vide) puis place quelques ids.
    fn make_table() -> alloc::vec::Vec<u8> {
        let mut t = alloc::vec![0u8; REQUIRED_LEN];
        let put = |t: &mut [u8], row: usize, ent: usize, col: usize, val: i32| {
            let off = row * ROW_STRIDE + ENTRY_OFF0 + ent * ENTRY_STRIDE + col * 4;
            t[off..off + 4].copy_from_slice(&val.to_le_bytes());
        };
        for row in 0..N_ROWS as usize {
            for ent in 0..N_ENTRIES {
                put(&mut t, row, ent, 0, -1);
                put(&mut t, row, ent, 1, -1);
            }
        }
        // ids connus (cf. cas golden capturés de l'oracle uemu)
        put(&mut t, 0, 0, 0, 1001);
        put(&mut t, 3, 5, 1, 2002);
        put(&mut t, 13, 28, 0, 3003);
        put(&mut t, 7, 12, 0, 777);
        put(&mut t, 7, 12, 1, 778);
        t
    }

    extern crate alloc;

    #[test]
    fn golden_found() {
        let t = make_table();
        // valeurs capturées de l'oracle uemu (FUN_140d3bac0)
        assert_eq!(find_id_category(&t, 1001, false, false), 0x00);
        assert_eq!(find_id_category(&t, 2002, false, false), 0x03); // col1
        assert_eq!(find_id_category(&t, 3003, false, false), 0x0d); // dernière rangée/entrée
        assert_eq!(find_id_category(&t, 777, true, false), 0x07); // match prime sur force_sentinel
        assert_eq!(find_id_category(&t, 778, false, true), 0x07);
    }

    #[test]
    fn golden_fallback() {
        let t = make_table();
        // 9999 absent de la table
        assert_eq!(find_id_category(&t, 9999, false, false), 0x02); // octet != 2
        assert_eq!(find_id_category(&t, 9999, false, true), 0x00); // octet == 2
    }

    #[test]
    fn golden_sentinel() {
        let t = make_table();
        // force_sentinel court-circuite le test de l'octet de mode
        assert_eq!(find_id_category(&t, 9999, true, false), 0x0e);
        assert_eq!(find_id_category(&t, 9999, true, true), 0x0e);
    }

    #[test]
    fn golden_minus_one_matches_empty() {
        let t = make_table();
        // la table est remplie de -1 -> -1 matche dès la rangée 0
        assert_eq!(find_id_category(&t, -1, false, false), 0x00);
    }
}
