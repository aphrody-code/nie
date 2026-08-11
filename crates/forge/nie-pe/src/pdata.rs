//! Découverte des bornes de fonctions via la table `.pdata` (x86-64 unwind).
//!
//! `.pdata` est la **vérité terrain** des bornes de code : chaque `RUNTIME_FUNCTION`
//! (12 octets : `begin_rva`, `end_rva`, `unwind_rva`) décrit une région exacte. Les
//! entrées portant `UNW_FLAG_CHAININFO` sont des **fragments** rattachés à une
//! fonction parente — ce ne sont pas des débuts de fonction, mais ce sont bien des
//! octets de code : la forge les conserve comme régions, en les marquant.
//!
//! Limite assumée : `.pdata` ne couvre pas les fonctions feuilles sans cadre de
//! pile. C'est un **plancher** autoritaire, pas un plafond — le reste du `.text`
//! devient du résidu explicitement compté (jamais silencieusement ignoré).

use crate::image::PeImage;

/// `UNW_FLAG_CHAININFO` : l'entrée est un fragment chaîné.
pub const UNW_FLAG_CHAININFO: u8 = 0x4;

/// Une région de code décrite par `.pdata`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct CodeRange {
    /// RVA de début.
    pub begin: u32,
    /// RVA de fin (exclusive).
    pub end: u32,
    /// RVA de l'`UNWIND_INFO` associé.
    pub unwind: u32,
    /// Vrai si l'entrée est un fragment chaîné (pas un début de fonction).
    pub chained: bool,
}

impl CodeRange {
    /// Longueur en octets.
    #[must_use]
    pub fn len(&self) -> usize {
        self.end.saturating_sub(self.begin) as usize
    }

    /// Vrai si la région est vide (entrée dégénérée).
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.end <= self.begin
    }
}

/// Statistiques du balayage `.pdata`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct PdataStats {
    /// Entrées `RUNTIME_FUNCTION` lues.
    pub entries: usize,
    /// Entrées marquées `UNW_FLAG_CHAININFO`.
    pub chained: usize,
    /// Entrées racines (vraies entrées de fonction).
    pub roots: usize,
    /// Entrées dégénérées écartées (`end <= begin`).
    pub degenerate: usize,
}

/// Lit toutes les régions de code de la table `.pdata` d'une image.
///
/// Retourne les régions triées par RVA de début, plus les statistiques.
/// Si l'image n'a pas de répertoire `Exception`, retourne une liste vide.
#[must_use]
pub fn scan(img: &PeImage) -> (Vec<CodeRange>, PdataStats) {
    let mut stats = PdataStats::default();
    let Some(dir) = img.opt.directories.get(3).copied() else {
        return (Vec::new(), stats);
    };
    if dir.rva == 0 || dir.size == 0 {
        return (Vec::new(), stats);
    }
    let Some(table) = img.slice_rva(dir.rva, dir.size as usize) else {
        return (Vec::new(), stats);
    };

    let n = table.len() / 12;
    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        let e = &table[i * 12..i * 12 + 12];
        let begin = u32::from_le_bytes([e[0], e[1], e[2], e[3]]);
        let end = u32::from_le_bytes([e[4], e[5], e[6], e[7]]);
        let unwind = u32::from_le_bytes([e[8], e[9], e[10], e[11]]);
        stats.entries += 1;
        if end <= begin {
            stats.degenerate += 1;
            continue;
        }
        let chained = img
            .slice_rva(unwind & !1, 1)
            .is_some_and(|u| (u[0] >> 3) & UNW_FLAG_CHAININFO != 0);
        if chained {
            stats.chained += 1;
        } else {
            stats.roots += 1;
        }
        out.push(CodeRange {
            begin,
            end,
            unwind,
            chained,
        });
    }
    out.sort_unstable();
    (out, stats)
}

/// Rattache les **fragments chaînés** à la région qui les précède.
///
/// Attention au piège : MSVC pose les fonctions bout à bout, sans bourrage. Un
/// critère de fusion purement géométrique (« contiguë ⇒ fusionner ») souderait
/// donc deux fonctions **distinctes** en une seule unité — ce qui rend ensuite
/// leur adresse de départ introuvable. Seul le drapeau `UNW_FLAG_CHAININFO`
/// autorise la fusion : une racine reste toujours une unité à part.
#[must_use]
pub fn merge(ranges: &[CodeRange]) -> Vec<CodeRange> {
    let mut out: Vec<CodeRange> = Vec::with_capacity(ranges.len());
    for r in ranges {
        match out.last_mut() {
            Some(prev) if r.chained && r.begin <= prev.end => {
                prev.end = prev.end.max(r.end);
            }
            _ => out.push(*r),
        }
    }
    out
}

/// Ré-émet la section `.pdata` **depuis ses entrées parsées**.
///
/// `.pdata` est un tableau de `RUNTIME_FUNCTION` (trois `u32` : début, fin,
/// unwind), suivi du bourrage d'alignement de section. Le régénérer depuis les
/// triplets lus est de la même nature que la ré-émission des en-têtes : la
/// structure est comprise et reconstruite, pas recopiée en bloc.
///
/// Retourne `None` si l'image n'a pas de section `.pdata` exploitable, ou si le
/// bourrage de fin n'est pas nul (auquel cas il faudrait le modéliser aussi
/// plutôt que de le supposer).
#[must_use]
pub fn emit(img: &PeImage) -> Option<Vec<u8>> {
    let sec = img.section(".pdata")?;
    let dir = img.opt.directories.get(3).copied()?;
    if dir.rva != sec.virtual_address {
        return None;
    }
    let table = img.slice_rva(dir.rva, dir.size as usize)?;
    let raw = sec.size_raw as usize;

    let mut out = Vec::with_capacity(raw);
    for e in table.chunks_exact(12) {
        let begin = u32::from_le_bytes([e[0], e[1], e[2], e[3]]);
        let end = u32::from_le_bytes([e[4], e[5], e[6], e[7]]);
        let unwind = u32::from_le_bytes([e[8], e[9], e[10], e[11]]);
        out.extend_from_slice(&begin.to_le_bytes());
        out.extend_from_slice(&end.to_le_bytes());
        out.extend_from_slice(&unwind.to_le_bytes());
    }
    if out.len() > raw {
        return None;
    }
    // Le reste de la section est le bourrage d'alignement du linker : il doit
    // être nul, sinon il porte de l'information qu'on ne saurait régénérer.
    let start = sec.ptr_raw as usize + out.len();
    if img
        .bytes
        .get(start..sec.ptr_raw as usize + raw)?
        .iter()
        .any(|b| *b != 0)
    {
        return None;
    }
    out.resize(raw, 0);
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn range(begin: u32, end: u32, chained: bool) -> CodeRange {
        CodeRange {
            begin,
            end,
            unwind: 0,
            chained,
        }
    }

    #[test]
    fn rattache_les_fragments_sans_souder_deux_fonctions() {
        let r = vec![
            range(0x1000, 0x1010, false), // fonction A
            range(0x1010, 0x1020, true),  // fragment de A → fusionne
            range(0x1020, 0x1030, false), // fonction B, contiguë : NE DOIT PAS fusionner
            range(0x1040, 0x1050, true),  // fragment orphelin, non contigu
        ];
        let m = merge(&r);
        assert_eq!(m.len(), 3);
        assert_eq!((m[0].begin, m[0].end), (0x1000, 0x1020));
        assert_eq!(m[0].len(), 0x20);
        assert!(!m[0].chained);
        assert_eq!(
            (m[1].begin, m[1].end),
            (0x1020, 0x1030),
            "une fonction collée à la précédente garde son adresse propre"
        );
        assert_eq!((m[2].begin, m[2].end), (0x1040, 0x1050));
    }

    #[test]
    fn region_degeneree_est_vide() {
        let r = CodeRange {
            begin: 0x20,
            end: 0x20,
            unwind: 0,
            chained: false,
        };
        assert!(r.is_empty());
        assert_eq!(r.len(), 0);
    }
}
