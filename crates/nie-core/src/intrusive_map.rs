//! Map intrusive du moteur Level-5 (`lives::`) — **branche linéaire** de `FUN_1402e2a10`
//! (`@0x1402e2a10`, `nie_eacpatched.exe`), la primitive de lookup amont des écrans à liste
//! (`CMenuListView` : shop / inventaire / roster / formation…).
//!
//! ## Disposition mémoire (reversée + validée uemu)
//!
//! La structure est deux tableaux parallèles dans un même buffer de données, indexés par le
//! **même** index de nœud `u16` :
//! - **entrées** à `base + 8`, `0x10` octets chacune, **clé `i32` en `+0`** ;
//! - **nœuds** à `base + nodes_off`, `6` octets chacun, **`next: u16` en `+2`** (chaînage).
//!
//! Les champs de l'en-tête de map (offsets dans la struct `param_1` de nie.exe) :
//! `+0x08` = pointeur `base` ; `+0x10` = index de tête ; `+0x1c` = `nodes_off` ; `+0x20` = 0
//! pour le **mode linéaire** (≠ 0 = mode haché, hors de ce port) ; `+0x24` = capacité/sentinelle
//! (un `next ≥ cap` termine la chaîne).
//!
//! Le `find` du binaire renvoie l'**adresse du nœud** trouvé (`base + nodes_off + idx*6`) ou `0` ;
//! ce port renvoie l'**index** de nœud équivalent (`Option<u16>`), invariant indépendant de
//! l'adresse de base.
//!
//! ## Validation
//!
//! Oracle **uemu byte-exact** (`scripts/uemu.py` → `validate_intrusive_map.py`) : émulation de
//! `FUN_1402e2a10` sur une map synthétique (mode linéaire), comparaison de l'index de nœud
//! retourné. Les tests ci-dessous reproduisent les sorties de l'oracle.
//!
//! Le **mode haché** (`+0x20 ≠ 0`, via le sous-hash `FUN_1402b4160`) n'est PAS porté ici
//! (dépendance amont distincte, non validée en isolation) — discipline anti-faux-FAIT.

extern crate alloc;

/// Vue en lecture d'une map intrusive en **mode linéaire** (`header[+0x20] == 0`).
#[derive(Debug, Clone, Copy)]
pub struct IntrusiveMapLinear<'a> {
    /// Buffer de données (= `*(base)` = champ `+0x08` du binaire) : entrées à `+8`, nœuds à `nodes_off`.
    pub buf: &'a [u8],
    /// Index du nœud de tête (`header[+0x10]`).
    pub head: u16,
    /// Offset du tableau de nœuds dans `buf` (`header[+0x1c]`).
    pub nodes_off: u32,
    /// Capacité/sentinelle (`header[+0x24]`) : `head ≥ cap` ou `next ≥ cap` termine la chaîne.
    pub cap: u16,
}

#[inline]
fn read_i32(buf: &[u8], off: usize) -> Option<i32> {
    let b = buf.get(off..off + 4)?;
    Some(i32::from_le_bytes([b[0], b[1], b[2], b[3]]))
}

#[inline]
fn read_u16(buf: &[u8], off: usize) -> Option<u16> {
    let b = buf.get(off..off + 2)?;
    Some(u16::from_le_bytes([b[0], b[1]]))
}

impl IntrusiveMapLinear<'_> {
    /// Index du nœud dont l'entrée porte `key`, en suivant la chaîne depuis `head` ; `None` si
    /// absent (ou tête ≥ capacité). Port byte-exact de la branche `*(int*)(param_1+0x20)==0` de
    /// `FUN_1402e2a10` : l'entrée du nœud courant est comparée (do-while), puis on suit `next`
    /// tant que `next < cap`.
    #[must_use]
    pub fn find(&self, key: i32) -> Option<u16> {
        if self.head >= self.cap {
            return None; // `if (head < cap && …)` du binaire
        }
        let mut idx = self.head;
        loop {
            // Entrée `idx` : clé i32 à `base + 8 + idx*0x10`.
            let ekey = read_i32(self.buf, 8 + idx as usize * 0x10)?;
            if ekey == key {
                return Some(idx);
            }
            // Nœud `idx` : `next` u16 à `base + nodes_off + idx*6 + 2`.
            let next = read_u16(self.buf, self.nodes_off as usize + idx as usize * 6 + 2)?;
            if next >= self.cap {
                return None; // fin de chaîne (`while (node.next < cap)`)
            }
            idx = next;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::vec;
    use alloc::vec::Vec;

    /// Construit le buffer de données de l'oracle : entrées 0x10 o (clé i32 @+0) à `+8`,
    /// nœuds 6 o (`next` u16 @+2) à `nodes_off`.
    fn build(entries: &[i32], nexts: &[u16], nodes_off: usize) -> Vec<u8> {
        let mut buf = vec![0u8; 0x400];
        for (i, &k) in entries.iter().enumerate() {
            buf[8 + i * 0x10..8 + i * 0x10 + 4].copy_from_slice(&k.to_le_bytes());
        }
        for (i, &nx) in nexts.iter().enumerate() {
            buf[nodes_off + i * 6 + 2..nodes_off + i * 6 + 4].copy_from_slice(&nx.to_le_bytes());
        }
        buf
    }

    /// Reproduit l'oracle uemu : chaîne node0(100)→node1(200)→node2(300)→stop.
    #[test]
    fn matches_uemu_oracle_chain() {
        let buf = build(&[100, 200, 300], &[1, 2, 0xFFFF], 0x200);
        let m = IntrusiveMapLinear { buf: &buf, head: 0, nodes_off: 0x200, cap: 0x100 };
        assert_eq!(m.find(100), Some(0), "node0");
        assert_eq!(m.find(200), Some(1), "node1");
        assert_eq!(m.find(300), Some(2), "node2");
        assert_eq!(m.find(999), None, "absent");
    }

    /// Tête au milieu de la chaîne : on ne voit que la queue.
    #[test]
    fn head_mid_chain() {
        let buf = build(&[100, 200, 300], &[1, 2, 0xFFFF], 0x200);
        let m = IntrusiveMapLinear { buf: &buf, head: 1, nodes_off: 0x200, cap: 0x100 };
        assert_eq!(m.find(100), None, "100 hors de la sous-chaîne depuis la tête 1");
        assert_eq!(m.find(200), Some(1));
        assert_eq!(m.find(300), Some(2));
    }

    /// Tête ≥ capacité → map vide (branche d'entrée non prise).
    #[test]
    fn head_at_or_past_cap_is_empty() {
        let buf = build(&[100], &[0xFFFF], 0x200);
        let m = IntrusiveMapLinear { buf: &buf, head: 0x100, nodes_off: 0x200, cap: 0x100 };
        assert_eq!(m.find(100), None);
    }

    /// Élément unique (next ≥ cap dès le 1er nœud).
    #[test]
    fn single_element() {
        let buf = build(&[42], &[0x100], 0x200);
        let m = IntrusiveMapLinear { buf: &buf, head: 0, nodes_off: 0x200, cap: 0x100 };
        assert_eq!(m.find(42), Some(0));
        assert_eq!(m.find(0), None);
    }
}
