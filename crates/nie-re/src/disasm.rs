//! Récupération des arêtes d'appel manquantes par désassemblage indépendant de `.text`.
//!
//! L'index Ghidra (`nie-index.json`) fournit le call-graph `ce`, mais son
//! export est lacunaire : ~6 000 fonctions n'ont **aucune** arête `call` et
//! restent des îlots inatteignables par la propagation de labels. Ce module
//! désassemble la section `.text` du binaire avec `iced-x86` (pur Rust),
//! résout les cibles directes des instructions `call`/`jmp` (opérande
//! `rel32`) et insère dans `xref` (kind=`call`) les arêtes que Ghidra a
//! manquées.
//!
//! ## Méthode
//!
//! 1. `goblin` parse le PE → `ImageBase` et géométrie de `.text`.
//! 2. On charge depuis la base les adresses de début des fonctions situées
//!    dans `.text`, triées. Les tailles de fonction étant inconnues, la fin
//!    d'une fonction est bornée par le début de la suivante : on décode
//!    chaque corps depuis son entrée (frontière d'instruction sûre).
//! 3. À chaque `call`/`jmp` direct (opérande `NearBranch64`), si la cible est
//!    **exactement** le début d'une fonction connue, on enregistre l'arête
//!    `appelant → cible`.
//! 4. Le filtre « cible = début de fonction connu » élimine quasiment tous
//!    les faux positifs (sauts internes, désync sur des données inline).
//!
//! ## Limites (honnêteté)
//!
//! - Les appels **indirects** (`call rax`, vtables, `call [rip+disp]` vers
//!   l'IAT) ne sont pas résolus (pas d'analyse de flot de données ici) :
//!   NON_FAIT — c'est le résidu structurel après cette passe.
//! - Une désynchronisation sur des données inline dans `.text` reste possible ;
//!   son impact est borné par la validation des cibles (une arête fortuite
//!   exige que des octets parasites décodent en `E8`/`E9` vers un début de
//!   fonction réel, ce qui est rare et toléré par le vote majoritaire de la
//!   propagation).

use anyhow::{Context, Result};
use goblin::pe::PE;
use hashbrown::HashSet;
use iced_x86::{Decoder, DecoderOptions, FlowControl, Instruction, OpKind};
use nie_index::{rusqlite, Db};
use tracing::info;

/// Longueur maximale décodée par fonction (garde-fou si l'écart jusqu'au
/// début suivant est anormal — section mal bornée ou données inattendues).
const MAX_FUNC_LEN: u64 = 256 * 1024;

/// Statistiques de la récupération d'arêtes par désassemblage.
#[derive(Debug, Clone, Copy, Default)]
pub struct DisasmStats {
    /// Fonctions dont le corps a été décodé.
    pub functions_scanned: usize,
    /// Instructions décodées au total.
    pub instructions_decoded: u64,
    /// Instructions `call` (toutes formes : directes + indirectes).
    pub call_insns: u64,
    /// `call` **directs** (opérande `rel32` → cible statique).
    pub call_near: u64,
    /// `jmp` **directs** (opérande `rel32`, tail-calls / thunks).
    pub jmp_near: u64,
    /// Arêtes obtenues en suivant **un** relais (`jmp rel32`) — thunks
    /// d'édition de liens incrémentale MSVC (`call thunk; thunk: jmp réel`).
    pub thunk_resolved: u64,
    /// Branches directes near non résolues même via un relais (sauts internes,
    /// thunks IAT indirects, désync) — non retenues.
    pub near_target_miss: u64,
    /// Arêtes candidates distinctes (cible = début de fonction connu).
    pub edges_candidates: usize,
    /// Arêtes réellement nouvelles insérées dans `xref` (absentes de Ghidra).
    pub edges_new: usize,
}

/// Résultat brut du balayage de `.text` (avant écriture en base).
struct ScanResult {
    edges: HashSet<(i64, i64)>,
    functions_scanned: usize,
    instructions_decoded: u64,
    call_insns: u64,
    call_near: u64,
    jmp_near: u64,
    thunk_resolved: u64,
    near_target_miss: u64,
}

/// Suit **un seul** relais depuis `target` : si `target` n'est pas un début de
/// fonction connu mais pointe sur un `jmp rel32` interne (thunk d'édition de
/// liens incrémentale MSVC), renvoie la cible finale si c'est un début de
/// fonction connu. Renvoie `None` pour les thunks IAT (`jmp [rip+disp]`), les
/// cibles internes et les données.
///
/// L'appelant a déjà vérifié que `target` n'est **pas** dans `starts_set`.
fn resolve_thunk_hop(
    target: i64,
    text_bytes: &[u8],
    text_va: u64,
    text_end_va: u64,
    starts_set: &HashSet<i64>,
) -> Option<i64> {
    let tv = target as u64;
    if tv < text_va || tv >= text_end_va {
        return None;
    }
    let off = (tv - text_va) as usize;
    // 16 octets couvrent toute instruction de saut x86-64.
    let slice = text_bytes.get(off..(off + 16).min(text_bytes.len()))?;
    let mut dec = Decoder::with_ip(64, slice, tv, DecoderOptions::NONE);
    if !dec.can_decode() {
        return None;
    }
    let mut insn = Instruction::default();
    dec.decode_out(&mut insn);
    if insn.is_invalid()
        || insn.flow_control() != FlowControl::UnconditionalBranch
        || insn.op0_kind() != OpKind::NearBranch64
    {
        return None;
    }
    let real = insn.near_branch64() as i64;
    starts_set.contains(&real).then_some(real)
}

/// Décode `.text` fonction par fonction et collecte les arêtes `call`/`jmp`
/// directes dont la cible est un début de fonction connu.
///
/// `starts` doit être trié croissant et `starts_set` en contenir exactement
/// les mêmes éléments (validation O(1) des cibles).
fn scan_text(
    text_bytes: &[u8],
    text_va: u64,
    text_end_va: u64,
    starts: &[i64],
    starts_set: &HashSet<i64>,
) -> ScanResult {
    let mut edges: HashSet<(i64, i64)> = HashSet::new();
    let mut insn = Instruction::default();
    let mut res = ScanResult {
        edges: HashSet::new(),
        functions_scanned: 0,
        instructions_decoded: 0,
        call_insns: 0,
        call_near: 0,
        jmp_near: 0,
        thunk_resolved: 0,
        near_target_miss: 0,
    };

    for (i, &f) in starts.iter().enumerate() {
        let fv = f as u64;
        if fv < text_va || fv >= text_end_va {
            continue;
        }
        // Fin = début de fonction suivant (ou fin de .text), bornée.
        let next = starts.get(i + 1).map_or(text_end_va, |&s| s as u64).min(text_end_va);
        let end = next.min(fv + MAX_FUNC_LEN);
        if end <= fv {
            continue;
        }
        let off = (fv - text_va) as usize;
        let len = (end - fv) as usize;
        let Some(slice) = text_bytes.get(off..off + len) else {
            continue;
        };

        res.functions_scanned += 1;
        let mut decoder = Decoder::with_ip(64, slice, fv, DecoderOptions::NONE);
        while decoder.can_decode() {
            decoder.decode_out(&mut insn);
            if insn.is_invalid() {
                // Octets non décodables (données inline) : on arrête ce corps
                // plutôt que d'émettre des instructions trompeuses.
                break;
            }
            res.instructions_decoded += 1;

            let fc = insn.flow_control();
            let is_call = fc == FlowControl::Call;
            if is_call {
                res.call_insns += 1;
            } else if fc != FlowControl::UnconditionalBranch {
                continue;
            }
            // Seules les branches directes near (rel32) portent une cible
            // statiquement résoluble.
            if insn.op0_kind() != OpKind::NearBranch64 {
                continue;
            }
            if is_call {
                res.call_near += 1;
            } else {
                res.jmp_near += 1;
            }
            let target = insn.near_branch64() as i64;
            if target == f {
                continue;
            }
            if starts_set.contains(&target) {
                edges.insert((f, target));
            } else if let Some(real) =
                resolve_thunk_hop(target, text_bytes, text_va, text_end_va, starts_set)
            {
                if real != f {
                    edges.insert((f, real));
                    res.thunk_resolved += 1;
                }
            } else {
                res.near_target_miss += 1;
            }
        }
    }

    res.edges = edges;
    res
}

/// Convertit le résultat brut du balayage en statistiques publiques (avant
/// écriture en base : `edges_new` reste à 0).
impl ScanResult {
    fn to_stats(&self) -> DisasmStats {
        DisasmStats {
            functions_scanned: self.functions_scanned,
            instructions_decoded: self.instructions_decoded,
            call_insns: self.call_insns,
            call_near: self.call_near,
            jmp_near: self.jmp_near,
            thunk_resolved: self.thunk_resolved,
            near_target_miss: self.near_target_miss,
            edges_candidates: self.edges.len(),
            edges_new: 0,
        }
    }
}

/// Désassemble `.text` du binaire `exe_path`, résout les arêtes d'appel
/// directes manquantes et les insère dans `xref` (kind=`call`).
///
/// Idempotent : `INSERT OR IGNORE` sur l'unicité `(binary_id, from, to, kind)`.
/// `edges_new` compte uniquement les arêtes absentes du call-graph existant.
pub fn recover_call_edges(db: &mut Db, binary_id: i64, exe_path: &std::path::Path) -> Result<DisasmStats> {
    let bytes = std::fs::read(exe_path).with_context(|| format!("lecture {}", exe_path.display()))?;
    let pe = PE::parse(&bytes).context("goblin: parse PE")?;
    let image_base = pe.image_base;

    let text = pe
        .sections
        .iter()
        .find(|s| s.name().is_ok_and(|n| n.starts_with(".text")))
        .context("section .text introuvable")?;
    let text_va = image_base + text.virtual_address as u64;
    let text_raw_off = text.pointer_to_raw_data as usize;
    let text_len = u64::from(text.virtual_size).min(u64::from(text.size_of_raw_data));
    let text_end_va = text_va + text_len;
    let text_bytes = bytes
        .get(text_raw_off..text_raw_off + text_len as usize)
        .context(".text hors des limites du fichier")?;

    // Débuts de fonction situés dans .text (exclut les ~192 fonctions
    // synthétiques nommées, hors plage réelle).
    let mut starts: Vec<i64> = {
        let mut stmt = db.conn().prepare(
            "SELECT vaddr FROM function WHERE binary_id=?1 AND vaddr>=?2 AND vaddr<?3 ORDER BY vaddr",
        )?;
        stmt.query_map(
            rusqlite::params![binary_id, text_va as i64, text_end_va as i64],
            |r| r.get::<_, i64>(0),
        )?
        .collect::<std::result::Result<_, _>>()?
    };
    starts.sort_unstable();
    starts.dedup();
    let starts_set: HashSet<i64> = starts.iter().copied().collect();
    info!(
        "disasm: {} débuts de fonction dans .text [{:#x}, {:#x})",
        starts.len(),
        text_va,
        text_end_va
    );

    let scan = scan_text(text_bytes, text_va, text_end_va, &starts, &starts_set);
    info!(
        "disasm: {} fonctions, {} instructions, {} call directs, {} jmp directs, {} via thunk, {} ratées, {} arêtes candidates",
        scan.functions_scanned,
        scan.instructions_decoded,
        scan.call_near,
        scan.jmp_near,
        scan.thunk_resolved,
        scan.near_target_miss,
        scan.edges.len()
    );

    let before: i64 = db.conn().query_row(
        "SELECT COUNT(*) FROM xref WHERE binary_id=?1 AND kind='call'",
        [binary_id],
        |r| r.get(0),
    )?;
    {
        let tx = db.conn_mut().transaction()?;
        {
            let mut stmt = tx.prepare_cached(
                "INSERT OR IGNORE INTO xref(binary_id, from_addr, to_addr, kind) VALUES(?1,?2,?3,'call')",
            )?;
            for (from, to) in &scan.edges {
                stmt.execute(rusqlite::params![binary_id, from, to])?;
            }
        }
        tx.commit()?;
    }
    let after: i64 = db.conn().query_row(
        "SELECT COUNT(*) FROM xref WHERE binary_id=?1 AND kind='call'",
        [binary_id],
        |r| r.get(0),
    )?;

    let mut stats = scan.to_stats();
    stats.edges_new = (after - before).max(0) as usize;
    info!(
        "disasm: {} nouvelles arêtes call insérées (total {} → {})",
        stats.edges_new, before, after
    );
    Ok(stats)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Encode `E8 rel32` (`call`) à `ip` vers `target` (5 octets).
    fn call_rel32(ip: u64, target: u64) -> [u8; 5] {
        let next = ip + 5;
        let rel = (target as i64 - next as i64) as i32;
        let b = rel.to_le_bytes();
        [0xE8, b[0], b[1], b[2], b[3]]
    }

    /// Encode `E9 rel32` (`jmp`) à `ip` vers `target` (5 octets).
    fn jmp_rel32(ip: u64, target: u64) -> [u8; 5] {
        let next = ip + 5;
        let rel = (target as i64 - next as i64) as i32;
        let b = rel.to_le_bytes();
        [0xE9, b[0], b[1], b[2], b[3]]
    }

    /// Construit un `.text` synthétique : base 0x1000, fonctions A=0x1000,
    /// B=0x2000, C=0x3000. A appelle B (call) et saute vers C (tail-call),
    /// s'appelle elle-même (auto-arête à filtrer) et appelle 0x1234 (cible
    /// inconnue à filtrer).
    #[test]
    fn resout_call_et_jmp_directs_filtre_auto_et_inconnu() {
        let text_va = 0x1000u64;
        let mut buf = vec![0xCCu8; 0x2001]; // couvre [0x1000, 0x3001)
        let put = |buf: &mut Vec<u8>, va: u64, bytes: &[u8]| {
            let off = (va - text_va) as usize;
            buf[off..off + bytes.len()].copy_from_slice(bytes);
        };
        // A @0x1000 : call B, jmp-tail C, call self, call inconnu, ret.
        put(&mut buf, 0x1000, &call_rel32(0x1000, 0x2000));
        put(&mut buf, 0x1005, &call_rel32(0x1005, 0x1000)); // self
        put(&mut buf, 0x100A, &call_rel32(0x100A, 0x1234)); // inconnu
        put(&mut buf, 0x100F, &jmp_rel32(0x100F, 0x3000)); // tail-call C
        put(&mut buf, 0x1014, &[0xC3]); // ret
        // B @0x2000 : ret. C @0x3000 : ret.
        put(&mut buf, 0x2000, &[0xC3]);
        put(&mut buf, 0x3000, &[0xC3]);

        let starts: Vec<i64> = vec![0x1000, 0x2000, 0x3000];
        let starts_set: HashSet<i64> = starts.iter().copied().collect();
        let text_end_va = text_va + buf.len() as u64;

        let res = scan_text(&buf, text_va, text_end_va, &starts, &starts_set);

        assert!(res.edges.contains(&(0x1000, 0x2000)), "call A→B doit être trouvé");
        assert!(res.edges.contains(&(0x1000, 0x3000)), "tail-call A→C doit être trouvé");
        assert!(!res.edges.contains(&(0x1000, 0x1000)), "auto-arête doit être filtrée");
        assert!(
            !res.edges.iter().any(|&(_, to)| to == 0x1234),
            "cible inconnue (non-début de fonction) doit être filtrée"
        );
        assert_eq!(res.edges.len(), 2, "exactement 2 arêtes valides");
        assert_eq!(res.functions_scanned, 3);
        assert!(res.call_near >= 3, "3 call directs au moins");
        assert!(res.jmp_near >= 1, "1 jmp direct au moins");
    }

    /// Une cible qui n'est pas un début de fonction connu est rejetée même
    /// proche d'une fonction réelle (validation stricte par `starts_set`).
    #[test]
    fn cible_non_debut_de_fonction_rejetee() {
        let text_va = 0x1000u64;
        let mut buf = vec![0xCCu8; 0x40]; // [0x1000, 0x1040)
        // call vers 0x1030 : DANS .text mais pas un début de fonction connu.
        buf[0..5].copy_from_slice(&call_rel32(0x1000, 0x1030));
        buf[5] = 0xC3;
        let starts: Vec<i64> = vec![0x1000]; // seul 0x1000 est une fonction
        let starts_set: HashSet<i64> = [0x1000i64].into_iter().collect();
        let text_end_va = text_va + buf.len() as u64;
        let res = scan_text(&buf, text_va, text_end_va, &starts, &starts_set);
        assert!(res.edges.is_empty(), "0x1030 n'est pas un début de fonction → aucune arête");
        assert!(res.call_near >= 1, "le call direct a bien été compté");
        assert_eq!(res.near_target_miss, 1, "la cible non-fonction est comptée comme ratée");
    }

    /// `call thunk` puis `thunk: jmp real_func` (édition de liens incrémentale
    /// MSVC) : l'arête doit être résolue vers la vraie fonction via un relais.
    #[test]
    fn suit_un_thunk_jmp_vers_la_vraie_fonction() {
        let text_va = 0x1000u64;
        let mut buf = vec![0xCCu8; 0x2001]; // [0x1000, 0x3001)
        let put = |buf: &mut Vec<u8>, va: u64, bytes: &[u8]| {
            let off = (va - text_va) as usize;
            buf[off..off + bytes.len()].copy_from_slice(bytes);
        };
        // A @0x1000 appelle le thunk @0x1500 (pas un début de fonction).
        put(&mut buf, 0x1000, &call_rel32(0x1000, 0x1500));
        put(&mut buf, 0x1005, &[0xC3]);
        // Thunk @0x1500 : jmp B @0x2000.
        put(&mut buf, 0x1500, &jmp_rel32(0x1500, 0x2000));
        // B @0x2000 : ret.
        put(&mut buf, 0x2000, &[0xC3]);

        // Seules A et B sont des débuts de fonction ; le thunk n'en est pas un.
        let starts: Vec<i64> = vec![0x1000, 0x2000];
        let starts_set: HashSet<i64> = starts.iter().copied().collect();
        let text_end_va = text_va + buf.len() as u64;

        let res = scan_text(&buf, text_va, text_end_va, &starts, &starts_set);

        assert!(
            res.edges.contains(&(0x1000, 0x2000)),
            "l'arête A→B doit être résolue à travers le thunk : {:?}",
            res.edges
        );
        assert_eq!(res.thunk_resolved, 1, "exactement une résolution via thunk");
    }

    /// Diagnostic manuel (ignoré) : décode une fonction connue du vrai binaire
    /// et imprime ses branches near résolues, pour comparer aux callees Ghidra.
    /// `NIE_EXE=<chemin> NIE_FUNC=0x140024b80 cargo test -p nie-re diag_decode -- --ignored --nocapture`
    #[test]
    #[ignore = "diagnostic manuel : nécessite NIE_EXE + NIE_FUNC"]
    fn diag_decode_known_function() {
        let exe = std::env::var("NIE_EXE").expect("NIE_EXE");
        let func = std::env::var("NIE_FUNC").expect("NIE_FUNC");
        let func = u64::from_str_radix(func.trim_start_matches("0x"), 16).unwrap();
        let bytes = std::fs::read(&exe).unwrap();
        let pe = PE::parse(&bytes).unwrap();
        let image_base = pe.image_base;
        let text = pe
            .sections
            .iter()
            .find(|s| s.name().is_ok_and(|n| n.starts_with(".text")))
            .unwrap();
        let text_va = image_base + text.virtual_address as u64;
        let text_raw_off = text.pointer_to_raw_data as usize;
        eprintln!(
            "image_base={:#x} .text va={:#x} raw_off={:#x} vsize={:#x} rawsize={:#x}",
            image_base, text_va, text_raw_off, text.virtual_size, text.size_of_raw_data
        );
        let window: usize = std::env::var("NIE_LEN").ok().and_then(|s| s.parse().ok()).unwrap_or(768);
        let off = (func - text_va) as usize + text_raw_off;
        let slice = &bytes[off..(off + window).min(bytes.len())];
        let mut dec = Decoder::with_ip(64, slice, func, DecoderOptions::NONE);
        let mut insn = Instruction::default();
        let mut fmt = iced_x86::IntelFormatter::new();
        let mut out = String::new();
        let mut steps = 0;
        while dec.can_decode() && steps < 4000 {
            dec.decode_out(&mut insn);
            if insn.is_invalid() {
                eprintln!("{:#x}: <invalide>", insn.ip());
                break;
            }
            out.clear();
            use iced_x86::Formatter;
            fmt.format(&insn, &mut out);
            let fc = insn.flow_control();
            let tgt = if insn.op0_kind() == OpKind::NearBranch64
                && matches!(
                    fc,
                    FlowControl::Call
                        | FlowControl::UnconditionalBranch
                        | FlowControl::ConditionalBranch
                )
            {
                format!(" -> {:#x}", insn.near_branch64())
            } else {
                String::new()
            };
            eprintln!("{:#x}: {}{}", insn.ip(), out, tgt);
            if fc == FlowControl::Return {
                break;
            }
            steps += 1;
        }
    }

    /// Un thunk d'import (`jmp [rip+disp]`, opérande mémoire) ne doit PAS
    /// produire d'arête interne (c'est un appel d'import, pas une fonction du
    /// jeu).
    #[test]
    fn thunk_import_indirect_pas_d_arete() {
        let text_va = 0x1000u64;
        let mut buf = vec![0xCCu8; 0x600];
        let put = |buf: &mut Vec<u8>, va: u64, bytes: &[u8]| {
            let off = (va - text_va) as usize;
            buf[off..off + bytes.len()].copy_from_slice(bytes);
        };
        // A @0x1000 appelle le thunk @0x1500.
        put(&mut buf, 0x1000, &call_rel32(0x1000, 0x1500));
        put(&mut buf, 0x1005, &[0xC3]);
        // Thunk @0x1500 : jmp qword ptr [rip+0x200000] (FF 25 disp32) = IAT.
        put(&mut buf, 0x1500, &[0xFF, 0x25, 0x00, 0x00, 0x20, 0x00]);

        let starts: Vec<i64> = vec![0x1000];
        let starts_set: HashSet<i64> = starts.iter().copied().collect();
        let text_end_va = text_va + buf.len() as u64;

        let res = scan_text(&buf, text_va, text_end_va, &starts, &starts_set);

        assert!(res.edges.is_empty(), "un thunk IAT indirect ne produit pas d'arête interne");
        assert_eq!(res.thunk_resolved, 0);
        assert_eq!(res.near_target_miss, 1);
    }
}
