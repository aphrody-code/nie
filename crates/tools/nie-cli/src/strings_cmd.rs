//! Extraction des chaînes littérales du binaire et ancrage **fonction → chaîne**.
//!
//! ## Pourquoi
//!
//! La table `str` de la base de connaissance était vide : aucune chaîne du binaire n'y était
//! adressée. Or une chaîne est l'ancre la moins ambiguë du reverse — une fonction qui référence
//! `"CHARA_PARAM_INFO"` charge des personnages, celle qui référence `"ACF file is not
//! registered."` parle à CriWare. Sans `str`, ces ancres n'existent que dans le désassembleur.
//!
//! `func_str_ref`, elle, n'était pas vide : elle porte les références **héritées de l'index
//! Ghidra**, repliées par inclusion sur les racines `.pdata` (`nie_re::pdata::rebuild_from_pdata`).
//! Ces lignes n'ont pas de provenance et sont massivement redondantes. Ce module en écrit d'autres,
//! **dérivées du désassemblage réel**, sous l'étiquette [`SOURCE`] : elles cohabitent sans se
//! confondre, et la colonne `source` permet de n'interroger que la vérité terrain.
//!
//! ## Méthode
//!
//! 1. `goblin` parse le PE : géométrie des sections et `ImageBase`.
//! 2. Balayage octet par octet des sections de données (`.rdata`, `.data`, `.rodata`) :
//!    - **ASCII** — suite d'octets imprimables terminée par un `NUL`, longueur ≥ `min_len` ;
//!    - **UTF-16LE** — suite d'unités `u16` textuelles (latin, kana, CJK, pleine chasse)
//!      terminée par `0x0000`, alignée, et **ne recouvrant aucune chaîne ASCII déjà retenue**
//!      (sans quoi tout texte ASCII se relit comme du CJK).
//!
//!      La terminaison `NUL` obligatoire est le filtre décisif : le compilateur met en commun
//!      des littéraux terminés, pas des fragments.
//! 3. Bornes de fonction : `.pdata` (`nie_re::pdata::parse_roots`), la vérité terrain — pas
//!    l'index Ghidra, dont les adresses sont désalignées.
//! 4. Décodage `iced-x86` de chaque corps de fonction ; une référence n'est retenue que si sa
//!    cible **coïncide exactement** avec le début d'une chaîne retenue :
//!    - `lea r64, [rip+disp32]` — la forme que MSVC émet pour l'adresse d'un littéral ;
//!    - `mov r64, imm64` — la forme absolue (rare en `/O2`, mais elle existe).
//!
//!      Les autres accès RIP-relatifs (`mov`/`cmp [rip+x]`) sont **comptés et non ingérés** :
//!      ils visent l'IAT et des variables, et un `mov rax, [rip+s]` qui tombe sur une chaîne
//!      lit ses huit premiers octets sans la « référencer » au sens d'une ancre.
//! 5. **Suffixes.** MSVC met les littéraux en commun par la fin : `"…/chara.cfg.bin"` et
//!    `"chara.cfg.bin"` partagent les mêmes octets, et le second n'a pas d'adresse propre — le
//!    `lea` vise l'**intérieur** de la chaîne longue. Ces cibles sont résolues en chaînes à part
//!    entière (l'octet visé démarre bien une suite terminée par `NUL`) et comptées séparément
//!    (`suffix=`) : rien n'est deviné, la chaîne suffixe est lue dans l'image.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use anyhow::{Context, Result, bail};
use goblin::pe::PE;
use iced_x86::{Decoder, DecoderOptions, Instruction, Mnemonic, OpKind};
use nie_index::rusqlite::{Connection, params};
use sha2::{Digest, Sha256};

/// Étiquette de provenance écrite dans `func_str_ref.source`.
///
/// Les lignes sans `source` (`NULL`) sont l'héritage de l'index Ghidra replié sur `.pdata` ;
/// celles-ci viennent du désassemblage du binaire.
const SOURCE: &str = "rdata-xref";

/// `kind` des arêtes fonction → chaîne écrites dans `xref` (`from_addr` = début de fonction,
/// `to_addr` = adresse de la chaîne). C'est la seule table qui conserve l'**adresse** de la
/// chaîne référencée ; `func_str_ref` n'en garde que le texte.
const XREF_KIND: &str = "str";

/// Sections de données balayées par défaut.
const DEFAULT_SECTIONS: &[&str] = &[".rdata", ".data", ".rodata"];

/// Garde-fou : longueur maximale décodée pour un corps de fonction.
const MAX_FUNC_LEN: u64 = 256 * 1024;

/// Longueur maximale d'une chaîne retenue, en octets. Au-delà, ce n'est plus un littéral mais
/// un bloc de données qui se lit par hasard comme du texte.
const MAX_STR_BYTES: usize = 8192;

/// Encodage d'une chaîne trouvée (colonne `str.kind`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Enc {
    /// Octets imprimables ASCII terminés par `NUL`.
    Ascii,
    /// Unités `u16` little-endian terminées par `0x0000`.
    Utf16,
}

impl Enc {
    fn tag(self) -> &'static str {
        match self {
            Self::Ascii => "ascii",
            Self::Utf16 => "utf16",
        }
    }
}

/// Une chaîne retenue, avec son adresse virtuelle.
struct FoundStr {
    vaddr: u64,
    /// Longueur en octets, terminateur exclu.
    len: usize,
    /// Indice de la section dans `Stats::par_section`.
    sec: usize,
    enc: Enc,
    value: String,
}

/// Options de la passe.
#[derive(Debug, Clone)]
pub struct Options {
    /// Longueur minimale retenue (caractères, pas octets).
    pub min_len: usize,
    /// Sections balayées ; vide = [`DEFAULT_SECTIONS`].
    pub sections: Vec<String>,
    /// Force l'identifiant de binaire au lieu de le résoudre par sha256.
    pub binary_id: Option<i64>,
    /// N'écrit ni `func_str_ref` ni `xref` (extraction des chaînes seule).
    pub no_xrefs: bool,
    /// Calcule tout, n'écrit rien.
    pub dry_run: bool,
    /// Affiche `n` chaînes en exemple (vérification à l'œil).
    pub sample: usize,
}

/// Compteurs d'une passe.
#[derive(Debug, Default, Clone)]
pub struct Stats {
    /// Binaire résolu dans la table `binary`.
    pub binary_id: i64,
    /// Chemin enregistré pour ce binaire.
    pub binary_path: String,
    /// Par section : `(nom, ascii, utf16)`.
    pub par_section: Vec<(String, usize, usize)>,
    /// Chaînes ASCII retenues.
    pub ascii: usize,
    /// Chaînes UTF-16LE retenues.
    pub utf16: usize,
    /// Candidates écartées car plus longues que [`MAX_STR_BYTES`].
    pub oversized: usize,
    /// Lignes réellement insérées dans `str` (hors doublons).
    pub str_inserted: usize,
    /// Racines `.pdata` du binaire.
    pub roots: usize,
    /// Racines qui correspondent à une ligne `function` du binaire ciblé.
    pub roots_mapped: usize,
    /// Corps de fonction décodés.
    pub funcs_scanned: usize,
    /// Instructions décodées.
    pub insns: u64,
    /// `lea r64, [rip+disp32]` rencontrés.
    pub lea_rip: u64,
    /// `lea` dont la cible est exactement le début d'une chaîne retenue.
    pub lea_hits: u64,
    /// `lea` dont la cible tombe à l'intérieur d'une chaîne (suffixe mis en commun par MSVC).
    pub lea_suffix: u64,
    /// Chaînes suffixes matérialisées et ajoutées à `str`.
    pub suffixes: usize,
    /// Corps de fonction interrompus sur des octets non décodables (données en ligne).
    pub bodies_truncated: usize,
    /// Fonctions distinctes portant au moins une chaîne.
    pub funcs_with_str: usize,
    /// `mov r64, imm64` dont l'immédiat est exactement le début d'une chaîne.
    pub imm_hits: u64,
    /// Accès RIP-relatifs **non-`lea`** tombant sur une chaîne — comptés, **non ingérés**.
    pub rip_other_hits: u64,
    /// Couples distincts (fonction, chaîne).
    pub pairs: usize,
    /// Lignes `func_str_ref` de source [`SOURCE`] effacées avant réécriture.
    pub str_refs_deleted: usize,
    /// Lignes `func_str_ref` insérées.
    pub str_refs_inserted: usize,
    /// Arêtes `xref` (`kind='str'`) insérées.
    pub xrefs_inserted: usize,
    /// Aucune écriture n'a eu lieu.
    pub dry_run: bool,
}

/// Un octet qui peut appartenir à un littéral C.
fn ascii_is_text(b: u8) -> bool {
    matches!(b, 0x20..=0x7E | b'\t' | b'\r' | b'\n')
}

/// Une unité UTF-16 qui peut appartenir à un littéral large.
///
/// Volontairement restreint aux blocs réellement utilisés par le jeu (latin, ponctuation
/// générale, kana, CJK, pleine chasse) : accepter tout le plan multilingue ferait passer
/// n'importe quel couple d'octets pour du texte.
fn wide_is_text(u: u16) -> bool {
    matches!(u,
        0x09 | 0x0A | 0x0D
        | 0x0020..=0x007E
        | 0x00A1..=0x00FF
        | 0x2010..=0x203A
        | 0x3000..=0x30FF
        | 0x4E00..=0x9FFF
        | 0xFF01..=0xFF5E
    )
}

/// Balaye les littéraux ASCII d'une section et marque leur emprise dans `covered`.
fn scan_ascii(
    data: &[u8],
    va: u64,
    sec: usize,
    min_len: usize,
    out: &mut Vec<FoundStr>,
    covered: &mut [bool],
    oversized: &mut usize,
) {
    let mut i = 0usize;
    while i < data.len() {
        if !ascii_is_text(data[i]) {
            i += 1;
            continue;
        }
        let mut j = i;
        while j < data.len() && ascii_is_text(data[j]) {
            j += 1;
        }
        // Terminaison NUL obligatoire : c'est elle qui distingue un littéral d'un fragment.
        if j < data.len() && data[j] == 0 && j - i >= min_len {
            if j - i > MAX_STR_BYTES {
                *oversized += 1;
            } else {
                // `ascii_is_text` garantit un contenu ASCII pur, donc UTF-8 valide.
                let value = String::from_utf8_lossy(&data[i..j]).into_owned();
                out.push(FoundStr {
                    vaddr: va + i as u64,
                    len: j - i,
                    sec,
                    enc: Enc::Ascii,
                    value,
                });
                covered[i..=j].fill(true);
            }
        }
        i = j + 1;
    }
}

/// Balaye les littéraux UTF-16LE d'une section, en écartant tout ce qui recouvre une chaîne
/// ASCII déjà retenue.
fn scan_utf16(
    data: &[u8],
    va: u64,
    sec: usize,
    min_len: usize,
    out: &mut Vec<FoundStr>,
    covered: &[bool],
    oversized: &mut usize,
) {
    let unit = |k: usize| -> u16 { u16::from_le_bytes([data[k], data[k + 1]]) };
    let mut i = 0usize;
    while i + 1 < data.len() {
        if !wide_is_text(unit(i)) {
            i += 2;
            continue;
        }
        let mut j = i;
        while j + 1 < data.len() && wide_is_text(unit(j)) {
            j += 2;
        }
        let units = (j - i) / 2;
        if j + 1 < data.len() && unit(j) == 0 && units >= min_len && !covered[i..j].contains(&true)
        {
            if j - i > MAX_STR_BYTES {
                *oversized += 1;
            } else {
                let codes: Vec<u16> = (i..j).step_by(2).map(unit).collect();
                if let Ok(value) = String::from_utf16(&codes) {
                    out.push(FoundStr {
                        vaddr: va + i as u64,
                        len: j - i,
                        sec,
                        enc: Enc::Utf16,
                        value,
                    });
                }
            }
        }
        i = j + 2;
    }
}

/// Index des chaînes retenues : appartenance exacte, et résolution des **suffixes**.
///
/// MSVC met les littéraux en commun par la fin : une chaîne suffixe n'a pas d'octets à elle,
/// seulement une adresse à l'intérieur de la chaîne longue. Une cible qui tombe strictement
/// dans une chaîne retenue démarre donc, par construction, une suite terminée par `NUL`.
struct StrIndex {
    /// Adresses de début, triées.
    starts: Vec<u64>,
    /// `(fin exclusive, indice dans `found`)`, aligné élément par élément sur `starts`.
    spans: Vec<(u64, usize)>,
    exact: HashSet<u64>,
}

impl StrIndex {
    /// `found` doit être trié par adresse croissante et dédoublonné.
    fn new(found: &[FoundStr]) -> Self {
        Self {
            starts: found.iter().map(|f| f.vaddr).collect(),
            spans: found
                .iter()
                .enumerate()
                .map(|(i, f)| (f.vaddr + f.len as u64, i))
                .collect(),
            exact: found.iter().map(|f| f.vaddr).collect(),
        }
    }

    /// `(indice de la chaîne contenante, décalage en octets)` si `t` tombe strictement à
    /// l'intérieur d'une chaîne retenue. Le décalage d'une chaîne large reste pair.
    fn suffix_of(&self, found: &[FoundStr], t: u64) -> Option<(usize, usize)> {
        let idx = self.starts.partition_point(|&s| s <= t);
        if idx == 0 {
            return None;
        }
        let (end, fi) = self.spans[idx - 1];
        let start = self.starts[idx - 1];
        if t <= start || t >= end {
            return None;
        }
        let off = (t - start) as usize;
        if found[fi].enc == Enc::Utf16 && !off.is_multiple_of(2) {
            return None;
        }
        Some((fi, off))
    }

    /// La cible désigne-t-elle une chaîne (début exact ou suffixe) ?
    fn hits(&self, found: &[FoundStr], t: u64) -> bool {
        self.exact.contains(&t) || self.suffix_of(found, t).is_some()
    }
}

/// Fabrique la chaîne suffixe située à `off` octets dans `src`.
fn suffix_str(src: &FoundStr, vaddr: u64, off: usize) -> FoundStr {
    let value = match src.enc {
        // Contenu ASCII : un décalage d'octets est un décalage de caractères.
        Enc::Ascii => src.value[off..].to_string(),
        Enc::Utf16 => src.value.chars().skip(off / 2).collect(),
    };
    FoundStr {
        vaddr,
        len: src.len - off,
        sec: src.sec,
        enc: src.enc,
        value,
    }
}

/// Géométrie d'une section chargée.
struct SecView<'a> {
    name: String,
    va: u64,
    data: &'a [u8],
}

/// Sections du PE effectivement présentes dans le fichier, par nom.
fn sections<'a>(pe: &PE, bytes: &'a [u8], wanted: &[String]) -> Vec<SecView<'a>> {
    let mut out = Vec::new();
    for s in &pe.sections {
        let Ok(name) = s.name() else { continue };
        if !wanted.iter().any(|w| w == name) {
            continue;
        }
        let off = s.pointer_to_raw_data as usize;
        // `virtual_size` déborde `size_of_raw_data` pour les sections à BSS (`.data`) :
        // seule la partie présente dans le fichier porte des octets lisibles.
        let len = s.virtual_size.min(s.size_of_raw_data) as usize;
        let Some(data) = bytes.get(off..off + len) else {
            continue;
        };
        out.push(SecView {
            name: name.to_string(),
            va: pe.image_base + u64::from(s.virtual_address),
            data,
        });
    }
    out
}

/// Résout le binaire ciblé : la vue `#pdata` en priorité (c'est elle qui porte les fonctions
/// aux bornes réelles), sinon la vue fichier.
fn resolve_binary(
    conn: &Connection,
    exe: &Path,
    sha: &str,
    forced: Option<i64>,
) -> Result<(i64, String)> {
    if let Some(id) = forced {
        let path: String = conn
            .query_row("SELECT path FROM binary WHERE id = ?1", [id], |r| r.get(0))
            .with_context(|| format!("aucun binaire d'id {id} dans la base"))?;
        return Ok((id, path));
    }
    let pdata_key = format!("{sha}-pdata");
    for key in [pdata_key.as_str(), sha] {
        let row = conn.query_row(
            "SELECT id, path FROM binary WHERE sha256 = ?1",
            [key],
            |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)),
        );
        if let Ok(found) = row {
            return Ok(found);
        }
    }
    let mut stmt = conn.prepare("SELECT id, sha256, path FROM binary ORDER BY id")?;
    let known: Vec<String> = stmt
        .query_map([], |r| {
            Ok(format!(
                "  id={} sha256={} {}",
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?
            ))
        })?
        .collect::<std::result::Result<_, _>>()?;
    bail!(
        "aucun binaire indexé ne correspond à {} (sha256 {sha}).\nBinaires connus :\n{}\n\
         Passer --binary-id <id> pour forcer, ou indexer ce binaire d'abord.",
        exe.display(),
        known.join("\n")
    );
}

/// Décode les corps de fonction et collecte les couples (début de fonction, adresse de chaîne).
fn scan_text(
    text: &[u8],
    text_va: u64,
    roots: &[nie_re::pdata::RootFn],
    found: &[FoundStr],
    known: &StrIndex,
    mapped: &HashSet<u64>,
    stats: &mut Stats,
) -> HashSet<(u64, u64)> {
    let text_end = text_va + text.len() as u64;
    let mut hits: HashSet<(u64, u64)> = HashSet::new();
    let mut insn = Instruction::default();

    for r in roots {
        if r.start < text_va || r.start >= text_end {
            continue;
        }
        let end = r.end.min(text_end).min(r.start + MAX_FUNC_LEN);
        if end <= r.start {
            continue;
        }
        let off = (r.start - text_va) as usize;
        let Some(slice) = text.get(off..off + (end - r.start) as usize) else {
            continue;
        };
        stats.funcs_scanned += 1;

        let mut dec = Decoder::with_ip(64, slice, r.start, DecoderOptions::NONE);
        while dec.can_decode() {
            dec.decode_out(&mut insn);
            if insn.is_invalid() {
                // Données en ligne : on arrête ce corps plutôt que d'émettre des références
                // issues d'une désynchronisation.
                stats.bodies_truncated += 1;
                break;
            }
            stats.insns += 1;

            if insn.is_ip_rel_memory_operand() {
                let t = insn.ip_rel_memory_address();
                if insn.mnemonic() == Mnemonic::Lea {
                    stats.lea_rip += 1;
                    if known.exact.contains(&t) {
                        stats.lea_hits += 1;
                        hits.insert((r.start, t));
                    } else if known.suffix_of(found, t).is_some() {
                        stats.lea_suffix += 1;
                        hits.insert((r.start, t));
                    }
                } else if known.hits(found, t) {
                    // Diagnostic seulement : ce n'est pas une prise d'adresse.
                    stats.rip_other_hits += 1;
                }
            }

            for i in 0..insn.op_count() {
                if insn.op_kind(i) == OpKind::Immediate64 {
                    let v = insn.immediate64();
                    if known.hits(found, v) {
                        stats.imm_hits += 1;
                        hits.insert((r.start, v));
                    }
                }
            }
        }
    }

    // Ne garde que les fonctions présentes en base : une racine sans ligne `function` n'a pas
    // d'ancre où accrocher sa chaîne.
    hits.retain(|(f, _)| mapped.contains(f));
    hits
}

/// Extrait les chaînes de `exe`, les ingère dans `str`, et — sauf `no_xrefs` — ancre les
/// fonctions qui les référencent dans `func_str_ref` et `xref`.
pub fn run(db: &nie_index::Db, exe: &Path, opts: &Options) -> Result<Stats> {
    let bytes = std::fs::read(exe).with_context(|| format!("lecture {}", exe.display()))?;
    let sha = hex::encode(Sha256::digest(&bytes));
    let pe = PE::parse(&bytes).with_context(|| format!("parse PE {}", exe.display()))?;

    let conn = db.conn();
    let (binary_id, binary_path) = resolve_binary(conn, exe, &sha, opts.binary_id)?;

    let wanted: Vec<String> = if opts.sections.is_empty() {
        DEFAULT_SECTIONS.iter().map(|s| (*s).to_string()).collect()
    } else {
        opts.sections.clone()
    };

    let mut stats = Stats {
        binary_id,
        binary_path,
        dry_run: opts.dry_run,
        ..Stats::default()
    };

    // --- 1. Chaînes ---------------------------------------------------------
    let mut found: Vec<FoundStr> = Vec::new();
    for (idx, sec) in sections(&pe, &bytes, &wanted).into_iter().enumerate() {
        let before = (stats.ascii, stats.utf16);
        let mut covered = vec![false; sec.data.len() + 1];
        let mut n = found.len();
        scan_ascii(
            sec.data,
            sec.va,
            idx,
            opts.min_len,
            &mut found,
            &mut covered,
            &mut stats.oversized,
        );
        stats.ascii += found.len() - n;
        n = found.len();
        scan_utf16(
            sec.data,
            sec.va,
            idx,
            opts.min_len,
            &mut found,
            &covered,
            &mut stats.oversized,
        );
        stats.utf16 += found.len() - n;
        stats
            .par_section
            .push((sec.name, stats.ascii - before.0, stats.utf16 - before.1));
    }
    found.sort_unstable_by_key(|f| f.vaddr);
    found.dedup_by_key(|f| f.vaddr);

    if opts.sample > 0 {
        for f in found.iter().take(opts.sample) {
            let sec = stats.par_section.get(f.sec).map_or("?", |s| s.0.as_str());
            println!("  0x{:x} {sec} {} {}", f.vaddr, f.enc.tag(), f.value);
        }
    }

    // --- 2. Références depuis .text ----------------------------------------
    let mut hits: HashSet<(u64, u64)> = HashSet::new();
    let mut fid: HashMap<u64, i64> = HashMap::new();
    if !opts.no_xrefs {
        let roots = nie_re::pdata::parse_roots(&bytes)?;
        stats.roots = roots.len();
        {
            let mut q = conn.prepare("SELECT vaddr, id FROM function WHERE binary_id = ?1")?;
            let rows = q.query_map([binary_id], |r| {
                Ok((r.get::<_, i64>(0)? as u64, r.get::<_, i64>(1)?))
            })?;
            for row in rows {
                let (v, id) = row?;
                fid.insert(v, id);
            }
        }
        let mapped: HashSet<u64> = roots
            .iter()
            .map(|r| r.start)
            .filter(|s| fid.contains_key(s))
            .collect();
        stats.roots_mapped = mapped.len();

        let text = pe
            .sections
            .iter()
            .find(|s| s.name().is_ok_and(|n| n.starts_with(".text")))
            .context("section .text introuvable")?;
        let toff = text.pointer_to_raw_data as usize;
        let tlen = text.virtual_size.min(text.size_of_raw_data) as usize;
        let tbytes = bytes
            .get(toff..toff + tlen)
            .context(".text hors des limites du fichier")?;
        let tva = pe.image_base + u64::from(text.virtual_address);

        let index = StrIndex::new(&found);
        hits = scan_text(tbytes, tva, &roots, &found, &index, &mapped, &mut stats);
        stats.pairs = hits.len();
        stats.funcs_with_str = hits.iter().map(|(f, _)| *f).collect::<HashSet<_>>().len();

        // Les cibles suffixes n'ont pas de ligne `str` : on les matérialise depuis la chaîne
        // qui les contient, sinon l'ancre pointerait sur une adresse sans texte.
        let mut extra: Vec<FoundStr> = Vec::new();
        for (_, t) in &hits {
            if index.exact.contains(t) {
                continue;
            }
            if let Some((fi, off)) = index.suffix_of(&found, *t) {
                extra.push(suffix_str(&found[fi], *t, off));
            }
        }
        extra.sort_unstable_by_key(|f| f.vaddr);
        extra.dedup_by_key(|f| f.vaddr);
        stats.suffixes = extra.len();
        found.extend(extra);
        found.sort_unstable_by_key(|f| f.vaddr);
        found.dedup_by_key(|f| f.vaddr);
    }

    if opts.dry_run {
        return Ok(stats);
    }

    // --- 3. Écriture --------------------------------------------------------
    let by_addr: HashMap<u64, &FoundStr> = found.iter().map(|f| (f.vaddr, f)).collect();
    conn.execute_batch("BEGIN")?;
    {
        let mut ins = conn.prepare_cached(
            "INSERT OR IGNORE INTO str(binary_id, vaddr, len, section, value, kind)
             VALUES(?1,?2,?3,?4,?5,?6)",
        )?;
        for f in &found {
            let sec = stats.par_section.get(f.sec).map_or("?", |s| s.0.as_str());
            stats.str_inserted += ins.execute(params![
                binary_id,
                f.vaddr as i64,
                f.len as i64,
                sec,
                f.value,
                f.enc.tag()
            ])?;
        }
    }
    if !opts.no_xrefs {
        stats.str_refs_deleted = conn.execute(
            "DELETE FROM func_str_ref WHERE binary_id = ?1 AND source = ?2",
            params![binary_id, SOURCE],
        )?;
        let mut ins = conn.prepare_cached(
            "INSERT INTO func_str_ref(binary_id, function_id, value, source) VALUES(?1,?2,?3,?4)",
        )?;
        let mut xins = conn.prepare_cached(
            "INSERT OR IGNORE INTO xref(binary_id, from_addr, to_addr, kind) VALUES(?1,?2,?3,?4)",
        )?;
        for (f, s) in &hits {
            let (Some(&id), Some(st)) = (fid.get(f), by_addr.get(s)) else {
                continue;
            };
            stats.str_refs_inserted += ins.execute(params![binary_id, id, st.value, SOURCE])?;
            stats.xrefs_inserted +=
                xins.execute(params![binary_id, *f as i64, *s as i64, XREF_KIND])?;
        }
    }
    conn.execute_batch("COMMIT")?;
    Ok(stats)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ascii_exige_la_terminaison_nul() {
        // "abcd\0" est retenu ; "efgh" sans NUL final ne l'est pas.
        let data = b"abcd\0efgh".to_vec();
        let mut out = Vec::new();
        let mut cov = vec![false; data.len() + 1];
        let mut over = 0;
        scan_ascii(&data, 0x1000, 0, 4, &mut out, &mut cov, &mut over);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].value, "abcd");
        assert_eq!(out[0].vaddr, 0x1000);
        assert_eq!(out[0].len, 4);
    }

    #[test]
    fn ascii_ecarte_les_trop_courtes() {
        let data = b"ab\0abcdef\0".to_vec();
        let mut out = Vec::new();
        let mut cov = vec![false; data.len() + 1];
        let mut over = 0;
        scan_ascii(&data, 0, 0, 4, &mut out, &mut cov, &mut over);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].value, "abcdef");
    }

    #[test]
    fn utf16_retenu_et_non_recouvrant() {
        let mut data = Vec::new();
        for c in "Menu".encode_utf16() {
            data.extend_from_slice(&c.to_le_bytes());
        }
        data.extend_from_slice(&0u16.to_le_bytes());
        let mut out = Vec::new();
        let cov = vec![false; data.len() + 1];
        let mut over = 0;
        scan_utf16(&data, 0x2000, 0, 4, &mut out, &cov, &mut over);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].value, "Menu");
        assert_eq!(out[0].enc, Enc::Utf16);
    }

    #[test]
    fn utf16_refuse_ce_qui_recouvre_une_ascii() {
        // "abcdefgh\0\0" se relit en UTF-16 comme du CJK : la couverture ASCII l'interdit.
        let data = b"abcdefgh\0\0".to_vec();
        let mut ascii = Vec::new();
        let mut cov = vec![false; data.len() + 1];
        let mut over = 0;
        scan_ascii(&data, 0, 0, 4, &mut ascii, &mut cov, &mut over);
        assert_eq!(ascii.len(), 1);
        let mut wide = Vec::new();
        scan_utf16(&data, 0, 0, 4, &mut wide, &cov, &mut over);
        assert!(wide.is_empty(), "recouvrement ASCII non filtré");
    }

    #[test]
    fn blocs_textuels_utf16_restreints() {
        assert!(wide_is_text(0x0041)); // 'A'
        assert!(wide_is_text(0x30A2)); // katakana ア
        assert!(wide_is_text(0x4E00)); // CJK 一
        assert!(!wide_is_text(0x0000));
        assert!(!wide_is_text(0x0007));
        assert!(!wide_is_text(0xD800)); // demi-paire de substitution
    }
}
