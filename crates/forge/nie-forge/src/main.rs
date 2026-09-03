//! CLI de la forge : `split` / `build` / `verify` / `report` / `match` / `unit`.
//!
//! Sortie **terse** (une ligne `clé=valeur`), conformément aux conventions du
//! projet ; les détails passent par `--json`.

#![forbid(unsafe_code)]

use anyhow::{Context, bail};
use clap::{Args, Parser, Subcommand};
use nie_forge::registry::MatchStatus;
use nie_forge::store::{ForgeStore, ReferenceBinary};
use nie_forge::{AsmSource, Registry, Report, lift_body};
use nie_pe::coff::CoffObject;
use nie_pe::{Cover, PeImage, UnitKind, diff, sha256_hex};
use std::path::{Path, PathBuf};

/// Forge de `nie.exe`.
#[derive(Debug, Parser)]
#[command(
    name = "nie-forge",
    about = "Produit nie.exe depuis le workspace Rust et mesure la part réellement générée",
    version
)]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

/// Emplacements communs.
#[derive(Debug, Args, Clone)]
struct Paths {
    /// Binaire de référence (défaut : `$NIE_EXE`, sinon `./nie.exe`).
    #[arg(long, global = true)]
    exe: Option<PathBuf>,
    /// Répertoire de travail de la forge (hors dépôt).
    #[arg(long, global = true, default_value = "var/forge")]
    forge: PathBuf,
    /// Registre de correspondance.
    #[arg(long, global = true, default_value = "forge/registry.json")]
    registry: PathBuf,
    /// Répertoire de la source assembleur régénérable.
    #[arg(long, global = true, default_value = "forge/asm")]
    asm: PathBuf,
    /// Base de connaissance RE : noms de fonctions et racines `.pdata`.
    #[arg(long, global = true, default_value = "var/niers.sqlite")]
    db: PathBuf,
}

impl Paths {
    fn exe_path(&self) -> anyhow::Result<PathBuf> {
        if let Some(p) = &self.exe {
            return Ok(p.clone());
        }
        if let Ok(p) = std::env::var("NIE_EXE") {
            let p = PathBuf::from(p);
            if p.is_file() {
                return Ok(p);
            }
        }
        let p = PathBuf::from("nie.exe");
        if p.is_file() {
            return Ok(p);
        }
        bail!("binaire de référence introuvable : passer --exe ou définir NIE_EXE")
    }

    fn registry_or_default(&self) -> anyhow::Result<Registry> {
        if self.registry.is_file() {
            Registry::load(&self.registry)
        } else {
            Ok(Registry {
                version: 1,
                target_sha256: None,
                entries: Vec::new(),
            })
        }
    }
}

#[derive(Debug, Subcommand)]
enum Cmd {
    /// Découpe le binaire de référence en unités (recouvrement total).
    Split {
        #[command(flatten)]
        paths: Paths,
    },
    /// Régénère le binaire depuis les unités et vérifie l'identité byte-à-byte.
    Build {
        #[command(flatten)]
        paths: Paths,
        /// Fichier produit.
        #[arg(long, default_value = "dist/nie.exe")]
        out: PathBuf,
    },
    /// Compare deux binaires.
    Verify {
        /// Référence.
        #[arg(long)]
        reference: PathBuf,
        /// Candidat.
        #[arg(long)]
        got: PathBuf,
    },
    /// Mesure la part du binaire produite par du code Rust.
    Report {
        #[command(flatten)]
        paths: Paths,
        /// Sortie JSON complète.
        #[arg(long)]
        json: bool,
    },
    /// Compare le codegen d'un symbole Rust aux octets originaux d'une fonction.
    Match {
        #[command(flatten)]
        paths: Paths,
        /// Objet COFF produit par `rustc --emit=obj`.
        #[arg(long)]
        obj: PathBuf,
        /// Symbole à extraire.
        #[arg(long)]
        symbol: String,
        /// Adresse virtuelle de la fonction cible (hex, ex. `0x141334600`).
        #[arg(long)]
        va: String,
    },
    /// Inspecte une unité du recouvrement.
    Unit {
        #[command(flatten)]
        paths: Paths,
        /// Adresse virtuelle contenue dans l'unité (hex).
        #[arg(long)]
        va: Option<String>,
        /// Identifiant exact de l'unité.
        #[arg(long)]
        id: Option<String>,
    },
    /// Compile des sources C avec MSVC et exige les octets originaux.
    ///
    /// Chaque fonction annotée `@nie <va>` est compilée, extraite de l'objet COFF
    /// et comparée byte-à-byte à l'unité correspondante. Le chemin principal du
    /// projet : `nie.exe` est lié par MSVC 14.44, donc le binaire peut être
    /// reproduit par le compilateur qui l'a produit, depuis du code source.
    Cc {
        #[command(flatten)]
        paths: Paths,
        /// Fichier `.c` ou répertoire à compiler (défaut : `src/decomp/functions`).
        #[arg(long, default_value = "src/decomp/functions")]
        src: PathBuf,
        /// Chemin explicite de `cl.exe` (sinon `$NIE_CL`, puis vswhere).
        #[arg(long)]
        cl: Option<PathBuf>,
        /// Inscrit les correspondances dans le registre.
        #[arg(long)]
        register: bool,
    },
    /// Relève les corps régénérables du binaire vers la source assembleur du dépôt.
    ///
    /// Chaque corps relevé est ré-encodé et comparé aux octets d'origine : seuls
    /// ceux qui coïncident **exactement** entrent dans la source.
    Lift {
        #[command(flatten)]
        paths: Paths,
        /// Longueur maximale des corps considérés (0 = sans limite).
        #[arg(long, default_value_t = 0)]
        max_len: usize,
        /// Fichier de sortie, dans le répertoire de source assembleur.
        #[arg(long, default_value = "lifted.s")]
        out: String,
        /// Nombre de causes de blocage affichées (0 = toutes).
        #[arg(long, default_value_t = 15)]
        top: usize,
    },
    /// Reporte le découpage et l'état de production dans la base de connaissance.
    ///
    /// Écrit la table `forge_unit` et la vue `v_forge_function` : chaque fonction
    /// de la base y gagne son offset, sa taille mesurée, sa nature et son statut
    /// (`produit`, `bloque` avec cause, `donnees_inline`, `regle`, `verbatim`).
    /// Rien n'est modifié dans `function` — le reverse garde ses colonnes.
    Kb {
        #[command(flatten)]
        paths: Paths,
    },
    /// Recense les corps de fonctions identiques : la liste de travail du portage.
    ///
    /// Un même corps partagé par N fonctions signifie qu'**une** implémentation
    /// Rust conforme fait basculer N unités d'un coup. C'est le meilleur levier
    /// de départ, et il est mesuré, pas supposé.
    Candidates {
        #[command(flatten)]
        paths: Paths,
        /// Longueur maximale du corps considéré.
        #[arg(long, default_value_t = 16)]
        max_len: usize,
        /// Nombre de groupes affichés.
        #[arg(long, default_value_t = 20)]
        top: usize,
        /// Ne garder que les corps sans relocation (comparables sans édition de liens).
        #[arg(long)]
        no_reloc: bool,
    },
}

fn parse_va(s: &str) -> anyhow::Result<u64> {
    let t = s.trim().trim_start_matches("0x").trim_start_matches("0X");
    u64::from_str_radix(t, 16).with_context(|| format!("adresse invalide : {s}"))
}

fn main() -> anyhow::Result<()> {
    match Cli::parse().cmd {
        Cmd::Split { paths } => cmd_split(&paths),
        Cmd::Build { paths, out } => cmd_build(&paths, &out),
        Cmd::Verify { reference, got } => cmd_verify(&reference, &got),
        Cmd::Report { paths, json } => cmd_report(&paths, json),
        Cmd::Match {
            paths,
            obj,
            symbol,
            va,
        } => cmd_match(&paths, &obj, &symbol, &va),
        Cmd::Unit { paths, va, id } => cmd_unit(&paths, va.as_deref(), id.as_deref()),
        Cmd::Candidates {
            paths,
            max_len,
            top,
            no_reloc,
        } => cmd_candidates(&paths, max_len, top, no_reloc),
        Cmd::Lift {
            paths,
            max_len,
            out,
            top,
        } => cmd_lift(&paths, max_len, &out, top),
        Cmd::Kb { paths } => cmd_kb(&paths),
        Cmd::Cc {
            paths,
            src,
            cl,
            register,
        } => cmd_cc(&paths, &src, cl.as_deref(), register),
    }
}

fn cmd_cc(paths: &Paths, src: &Path, cl: Option<&Path>, register: bool) -> anyhow::Result<()> {
    use nie_forge::cc;
    use nie_forge::registry::{MatchStatus, Proof, RegistryEntry};

    let exe = paths.exe_path()?;
    let store = ForgeStore::load(&paths.forge)?;
    let reference = ReferenceBinary::load_checked(&exe, &store.cover)?;
    let compiler = cc::find_cl(cl)?;

    let mut sources: Vec<PathBuf> = Vec::new();
    if src.is_dir() {
        for e in std::fs::read_dir(src)?.flatten() {
            let p = e.path();
            if p.extension().is_some_and(|x| x == "c") {
                sources.push(p);
            }
        }
        sources.sort();
    } else if src.is_file() {
        sources.push(src.to_path_buf());
    } else {
        bail!("source introuvable : {}", src.display());
    }

    let out_dir = paths.forge.join("cc");
    let mut registry = paths.registry_or_default()?;
    let mut matched = 0usize;
    let mut matched_bytes = 0usize;
    let mut rejected = 0usize;
    let mut annotated = 0usize;

    for s in &sources {
        let text =
            std::fs::read_to_string(s).with_context(|| format!("lecture de {}", s.display()))?;
        let anns = cc::parse_annotations(&text)?;
        if anns.is_empty() {
            continue;
        }
        annotated += anns.len();
        let obj = cc::compile(&compiler, s, &out_dir, &cc::default_flags())?;
        let coff = CoffObject::parse(std::fs::read(&obj)?)?;

        for a in anns {
            let Some(unit) = store.cover.find_va(a.va) else {
                eprintln!(
                    "rejet {} @ {:#x} : aucune unité à cette adresse",
                    a.symbol, a.va
                );
                rejected += 1;
                continue;
            };
            if unit.va != Some(a.va) {
                eprintln!(
                    "rejet {} @ {:#x} : l'unité {} commence à {:#x} (+{:#x} à l'intérieur)",
                    a.symbol,
                    a.va,
                    unit.id,
                    unit.va.unwrap_or_default(),
                    a.va - unit.va.unwrap_or_default()
                );
                rejected += 1;
                continue;
            }
            let original = &reference.bytes[unit.range()];
            let code = match coff.symbol_code(&a.symbol) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("rejet {} @ {:#x} : {e}", a.symbol, a.va);
                    rejected += 1;
                    continue;
                }
            };
            let d = diff::compare_masked(original, &code.bytes, &code.reloc_mask, 4);
            if d.is_identical() {
                matched += 1;
                matched_bytes += unit.len;
                println!(
                    "match sym={} va={:#x} len={} src={}",
                    a.symbol,
                    a.va,
                    unit.len,
                    s.display()
                );
                if register {
                    registry
                        .entries
                        .retain(|e| e.va_value().map(|v| v != a.va).unwrap_or(true));
                    registry.entries.push(RegistryEntry {
                        va: format!("{:#x}", a.va),
                        rust: None,
                        status: MatchStatus::Bytes,
                        proof: Some(Proof {
                            kind: "msvc".into(),
                            reference: s.display().to_string(),
                        }),
                        object: Some(obj.display().to_string().replace('\\', "/")),
                        symbol: Some(a.symbol.clone()),
                        note: None,
                    });
                }
            } else {
                rejected += 1;
                eprintln!(
                    "diff sym={} va={:#x} orig={} got={} differing={} ranges={:?}",
                    a.symbol,
                    a.va,
                    original.len(),
                    code.bytes.len(),
                    d.bytes_differing,
                    d.ranges
                );
            }
        }
    }

    if register {
        registry.target_sha256 = Some(store.cover.sha256.clone());
        registry.save(&paths.registry)?;
    }
    println!(
        "cc compiler={} version=\"{}\" sources={} annotated={} matched={} bytes={} rejected={} registered={}",
        compiler.display(),
        cc::cl_version(&compiler),
        sources.len(),
        annotated,
        matched,
        matched_bytes,
        rejected,
        register,
    );
    Ok(())
}

fn cmd_lift(paths: &Paths, max_len: usize, out: &str, top: usize) -> anyhow::Result<()> {
    let exe = paths.exe_path()?;
    let store = ForgeStore::load(&paths.forge)?;
    let reference = ReferenceBinary::load_checked(&exe, &store.cover)?;

    let mut src = AsmSource::default();
    let mut scanned = 0usize;
    let mut bytes = 0usize;
    for u in &store.cover.units {
        if !matches!(u.kind, UnitKind::Function | UnitKind::CodeResidue) {
            continue;
        }
        if max_len > 0 && u.len > max_len {
            continue;
        }
        scanned += 1;
        let (Some(va), Some(body)) = (u.va, reference.bytes.get(u.range())) else {
            continue;
        };
        if let Some(insns) = lift_body(body, va) {
            src.bodies.insert(va, insns);
            bytes += u.len;
        }
    }
    // La liste de courses du prochain lot d'instructions, triée par gain réel.
    // L'agrégation vit dans `nie_forge::lift` : l'onglet « Forge » de
    // `nie-explorer` appelle la même, pour que les deux ne divergent pas.
    let blockers = nie_forge::lift::blockers(&store.cover, &reference.bytes, max_len);

    // Noms issus de l'échafaudage RE : la source produite devient navigable.
    let re = nie_forge::ReNames::load(&paths.db)?;
    let named = src
        .bodies
        .keys()
        .filter(|va| re.get(**va).is_some())
        .count();
    let roots = store.cover.count_by_kind(UnitKind::Function);
    // Le recouvrement compte les racines `.pdata` **plus** les feuilles que
    // l'echafaudage RE a mesurees : un surplus est normal et attendu. Seul un
    // *deficit* est un signal — il voudrait dire que la forge a perdu des
    // racines que la base connait.
    if re.pdata_roots > roots {
        println!(
            "cross-check ALERTE racines_db={} unites_fonction_forge={} manquantes={}",
            re.pdata_roots,
            roots,
            re.pdata_roots - roots
        );
    } else if roots > re.pdata_roots {
        println!(
            "cross-check racines_pdata={} + feuilles_re={} = {} unites de fonction",
            re.pdata_roots,
            roots - re.pdata_roots,
            roots
        );
    }

    let path = paths.asm.join(out);
    src.save_annotated(
        &path,
        &format!(
            "nie.exe — corps de fonctions régénérables par nie-asm.\n\
             Source du dépôt : chaque ligne est réassemblée à la construction et doit\n\
             redonner les octets d'origine. Généré par `nie-forge lift`, éditable à la main.\n\
             cible sha256={}\n\
             corps={} octets={}",
            store.cover.sha256,
            src.len(),
            bytes
        ),
        &re.names,
    )?;
    println!(
        "lift out={} scanned={} lifted={} bytes={} named={} ratio={:.4}",
        path.display(),
        scanned,
        src.len(),
        bytes,
        named,
        if scanned == 0 {
            0.0
        } else {
            src.len() as f64 / scanned as f64
        },
    );
    // Le total dit ce qui reste a conquerir ; sans lui, une liste tronquee
    // laisse croire que les quinze premieres causes epuisent le sujet.
    println!(
        "blocages causes={} units={} bytes={}",
        blockers.len(),
        blockers.iter().map(|b| b.units).sum::<usize>(),
        blockers.iter().map(|b| b.bytes).sum::<usize>(),
    );
    // Deja trie par octets decroissants : la premiere ligne est la prochaine cible.
    let n = if top == 0 { blockers.len() } else { top };
    for b in blockers.into_iter().take(n) {
        println!(
            "blocker cause={} units={} bytes={} sample=\"{}\"",
            b.cause, b.units, b.bytes, b.sample
        );
    }
    Ok(())
}

fn cmd_kb(paths: &Paths) -> anyhow::Result<()> {
    let exe = paths.exe_path()?;
    let store = ForgeStore::load(&paths.forge)?;
    let reference = ReferenceBinary::load_checked(&exe, &store.cover)?;
    let img = PeImage::parse(reference.bytes.clone())?;
    let b = nie_forge::kb::synchroniser(&paths.db, &store.cover, &reference.bytes, Some(&img))?;
    println!(
        "kb db={} binary_id={} unites={} produites={} bloquees={} hors_decoupage={} tailles_divergentes={}",
        paths.db.display(),
        b.binary_id,
        b.unites,
        b.produites,
        b.bloquees,
        b.hors_decoupage,
        b.tailles_divergentes,
    );
    println!(
        "kb classes={} methodes={} resolues={} ({:.2}%)",
        b.classes,
        b.methodes,
        b.methodes_resolues,
        if b.methodes == 0 {
            0.0
        } else {
            b.methodes_resolues as f64 * 100.0 / b.methodes as f64
        },
    );
    Ok(())
}

fn cmd_split(paths: &Paths) -> anyhow::Result<()> {
    let exe = paths.exe_path()?;
    // Les fonctions mesurees par l'echafaudage RE decoupent le residu que
    // `.pdata` laisse : sans elles, 1,8 Mo de `.text` restent haches par les
    // seules bornes de remplissage, donc non relevables.
    let re = nie_forge::ReNames::load(&paths.db)?;
    // Une feuille dont l'adresse tombe au milieu d'une instruction coupe un
    // corps en deux : le relevé rejette les deux moitiés, et l'accuse ensuite
    // de l'encodeur. Le filtre ne retire que ce que le désassembleur infirme.
    let img = PeImage::parse(std::fs::read(&exe)?)?;
    let (feuilles, verdict) = nie_forge::bornes::valider(&img, &re.sized);
    println!(
        "bornes soumises={} retenues={} coupantes={} indecises={} octets_ecartes={}",
        verdict.soumises,
        verdict.retenues,
        verdict.coupantes,
        verdict.indecises,
        verdict.octets_ecartes,
    );
    // Deux passes : la première découpe, la seconde isole les données que MSVC
    // a déposées au milieu du code et qui rendaient irrelevable tout le corps
    // qui les entoure.
    let base = img.opt.image_base;
    let feuilles_rva: Vec<(u32, u32)> = feuilles
        .iter()
        .filter_map(|&(va, len)| u32::try_from(va.checked_sub(base)?).ok().map(|r| (r, len)))
        .collect();
    let brut = nie_pe::Cover::split_with(&img, &feuilles_rva)?;
    let (inline, bilan) = nie_forge::donnees::detecter(&img, &brut);
    println!(
        "donnees_inline unites={} octets={} donnees={} code_libere={} sandwichs={}",
        bilan.unites, bilan.octets, bilan.donnees, bilan.code_libere, bilan.sandwichs,
    );
    let cover = nie_pe::Cover::split_with_data(&img, &feuilles_rva, &inline)?;
    let store = ForgeStore::persist(&paths.forge, cover)?;
    let c = &store.cover;
    println!(
        "split exe={} sha256={} size={} units={} fns={} frags={} residue={} data={} gaps={} overlay={}",
        exe.display(),
        c.sha256,
        c.total_len,
        c.units.len(),
        c.count_by_kind(UnitKind::Function),
        c.count_by_kind(UnitKind::CodeFragment),
        c.bytes_by_kind(UnitKind::CodeResidue),
        c.bytes_by_kind(UnitKind::SectionData),
        c.count_by_kind(UnitKind::Gap),
        c.bytes_by_kind(UnitKind::Overlay),
    );
    Ok(())
}

fn cmd_build(paths: &Paths, out: &Path) -> anyhow::Result<()> {
    let exe = paths.exe_path()?;
    let store = ForgeStore::load(&paths.forge)?;
    let reference = ReferenceBinary::load_checked(&exe, &store.cover)?;
    let registry = paths.registry_or_default()?;
    let by_va = registry.by_va()?;
    let asm = AsmSource::load_dir(&paths.asm)?;

    let img = PeImage::parse(reference.bytes.clone())?;
    let headers = img.emit_headers();
    let hdr_range = img.pe_offset..(img.headers_end() - img.header_padding.len());

    let mut from_rust_units = 0usize;
    let mut from_rust_bytes = 0usize;
    let mut rejected: Vec<String> = Vec::new();

    let built = store.cover.assemble(|u| {
        // 1. En-têtes : calculés par nie-pe depuis les structures parsées.
        if u.kind == UnitKind::PeHeaders {
            from_rust_units += 1;
            from_rust_bytes += u.len;
            return headers.get(hdr_range.clone()).map(<[u8]>::to_vec);
        }
        // 2. Sections-tables (`.pdata`, `.reloc`) : ré-émises depuis leurs entrées.
        if u.kind == UnitKind::SectionData
            && let Some(sec) = u.section.as_deref()
            && let Some(bytes) = nie_pe::image::tables::emit_for(&img, sec)
            && bytes.len() == u.len
        {
            from_rust_units += 1;
            from_rust_bytes += u.len;
            return Some(bytes);
        }
        // 3. Unité dont la règle du linker est connue (bourrage `int3`) :
        //    régénérée sans consulter la référence.
        if let Some(bytes) = u.emit_rule() {
            from_rust_units += 1;
            from_rust_bytes += u.len;
            return Some(bytes);
        }
        // 4. Corps présent dans la source assembleur : réassemblé par nie-asm.
        if u.kind.is_code()
            && let Some(va) = u.va
            && let Some(bytes) = asm.emit(va)
        {
            if bytes.len() == u.len {
                from_rust_units += 1;
                from_rust_bytes += u.len;
                return Some(bytes);
            }
            rejected.push(format!(
                "{}:source assembleur de {} octets pour une unité de {}",
                u.id,
                bytes.len(),
                u.len
            ));
        }
        // 5. Fonction dont le codegen Rust coïncide : on émet le codegen, les champs
        //    relogés étant résolus depuis la disposition de référence (le calcul de
        //    disposition propre est un jalon ultérieur, jamais un faux « produit »).
        if let Some(e) = u.va.and_then(|va| by_va.get(&va))
            && e.status == MatchStatus::Bytes
            && let (Some(obj), Some(sym)) = (&e.object, &e.symbol)
        {
            match codegen_payload(Path::new(obj), sym, &reference.bytes[u.range()]) {
                Ok(bytes) => {
                    from_rust_units += 1;
                    from_rust_bytes += u.len;
                    return Some(bytes);
                }
                Err(err) => rejected.push(format!("{}:{err}", u.id)),
            }
        }
        reference.payload(u)
    })?;

    if let Some(dir) = out.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(out, &built).with_context(|| format!("écriture de {}", out.display()))?;

    let sha = sha256_hex(&built);
    let identical = sha == store.cover.sha256;
    println!(
        "build out={} size={} sha256={} identical={} rust_units={} rust_bytes={} rejected={}",
        out.display(),
        built.len(),
        sha,
        identical,
        from_rust_units,
        from_rust_bytes,
        rejected.len(),
    );
    for r in &rejected {
        eprintln!("rejet {r}");
    }
    if !identical {
        let d = diff::compare(&reference.bytes, &built, 8);
        eprintln!(
            "diff bytes={} ranges={:?} truncated={}",
            d.bytes_differing, d.ranges, d.truncated
        );
        bail!("le binaire produit diffère de la référence");
    }
    Ok(())
}

/// Charge un objet COFF, extrait le symbole, vérifie la coïncidence avec les
/// octets originaux et rend la charge utile prête à écrire.
fn codegen_payload(obj: &Path, symbol: &str, original: &[u8]) -> anyhow::Result<Vec<u8>> {
    let o = CoffObject::parse(
        std::fs::read(obj).with_context(|| format!("lecture de {}", obj.display()))?,
    )?;
    let code = o.symbol_code(symbol)?;
    if code.bytes.len() != original.len() {
        bail!(
            "taille codegen {} != taille originale {}",
            code.bytes.len(),
            original.len()
        );
    }
    let d = diff::compare_masked(original, &code.bytes, &code.reloc_mask, 4);
    if !d.is_identical() {
        bail!("codegen divergent ({} octets)", d.bytes_differing);
    }
    // Champs relogés : valeurs de la disposition de référence.
    let mut payload = code.bytes;
    for (i, m) in code.reloc_mask.iter().enumerate() {
        if *m {
            payload[i] = original[i];
        }
    }
    Ok(payload)
}

fn cmd_verify(reference: &Path, got: &Path) -> anyhow::Result<()> {
    let a = ReferenceBinary::load_raw(reference)?;
    let b = ReferenceBinary::load_raw(got)?;
    let d = diff::compare(&a.bytes, &b.bytes, 16);
    println!(
        "verify ref={} got={} identical={} differing={} ratio={:.9} ranges={}",
        reference.display(),
        got.display(),
        d.is_identical(),
        d.bytes_differing,
        d.ratio_identical(),
        d.ranges.len(),
    );
    for r in &d.ranges {
        eprintln!("diff off={:#x} len={}", r.off, r.len);
    }
    if !d.is_identical() {
        bail!("binaires différents");
    }
    Ok(())
}

fn cmd_report(paths: &Paths, json: bool) -> anyhow::Result<()> {
    let store = ForgeStore::load(&paths.forge)?;
    let registry = paths.registry_or_default()?;
    let asm = AsmSource::load_dir(&paths.asm)?;
    let mut report = Report::build(&store.cover, &registry, &asm)?;
    // Même règle que `build` : les sections-tables ré-émises comptent comme
    // produites (cf. `Report::add_emitted_tables`, partagé avec l'explorateur).
    if let Ok(exe) = paths.exe_path()
        && let Ok(bytes) = std::fs::read(&exe)
        && let Ok(img) = PeImage::parse(bytes)
    {
        report.add_emitted_tables(&store.cover, &img);
    }
    if json {
        println!("{}", serde_json::to_string_pretty(&report)?);
    } else {
        println!("{}", report.terse());
    }
    Ok(())
}

fn cmd_match(paths: &Paths, obj: &Path, symbol: &str, va: &str) -> anyhow::Result<()> {
    let exe = paths.exe_path()?;
    let img = PeImage::parse(std::fs::read(&exe)?)?;
    let cover = match ForgeStore::load(&paths.forge) {
        Ok(s) => s.cover,
        Err(_) => Cover::split(&img)?,
    };
    let va = parse_va(va)?;
    let unit = cover
        .find_va(va)
        .with_context(|| format!("aucune unité ne contient {va:#x}"))?;
    let original = img
        .bytes
        .get(unit.range())
        .context("unité hors du fichier")?;

    let o = CoffObject::parse(std::fs::read(obj)?)?;
    let code = o.symbol_code(symbol)?;
    let d = diff::compare_masked(original, &code.bytes, &code.reloc_mask, 8);
    println!(
        "match unit={} va={:#x} orig_len={} codegen_len={} reloc_masked={} identical={} differing={} ratio={:.6}",
        unit.id,
        va,
        original.len(),
        code.bytes.len(),
        code.reloc_mask.iter().filter(|m| **m).count(),
        d.is_identical(),
        d.bytes_differing,
        d.ratio_identical(),
    );
    for r in &d.ranges {
        eprintln!("diff off={:#x} len={}", r.off, r.len);
    }
    Ok(())
}

/// Vrai si le corps ne dépend d'aucune adresse : pas de branchement relatif, pas
/// d'opérande mémoire rip-relative, pas d'immédiat 64 bits. Un tel corps peut être
/// comparé au codegen rustc **sans édition de liens** — c'est la population où un
/// portage byte-exact est atteignable immédiatement.
fn is_self_contained(bytes: &[u8], va: u64) -> bool {
    use iced_x86::{Decoder, DecoderOptions, OpKind};
    let mut d = Decoder::with_ip(64, bytes, va, DecoderOptions::NONE);
    let mut consumed = 0usize;
    while d.can_decode() {
        let i = d.decode();
        if i.is_invalid() {
            return false;
        }
        consumed += i.len();
        if i.is_ip_rel_memory_operand() {
            return false;
        }
        for op in 0..i.op_count() {
            match i.op_kind(op) {
                OpKind::NearBranch16
                | OpKind::NearBranch32
                | OpKind::NearBranch64
                | OpKind::FarBranch16
                | OpKind::FarBranch32
                | OpKind::Immediate64 => return false,
                // Adresse absolue en déplacement (ni base ni index) : dépend de la
                // disposition de l'image.
                OpKind::Memory
                    if i.memory_base() == iced_x86::Register::None
                        && i.memory_index() == iced_x86::Register::None
                        && i.memory_displacement64() != 0 =>
                {
                    return false;
                }
                _ => {}
            }
        }
    }
    consumed == bytes.len()
}

fn cmd_candidates(paths: &Paths, max_len: usize, top: usize, no_reloc: bool) -> anyhow::Result<()> {
    use std::collections::HashMap;

    let exe = paths.exe_path()?;
    let store = ForgeStore::load(&paths.forge)?;
    let reference = ReferenceBinary::load_checked(&exe, &store.cover)?;

    struct Group {
        count: usize,
        len: usize,
        example: u64,
        self_contained: bool,
    }
    let mut groups: HashMap<Vec<u8>, Group> = HashMap::new();
    for u in &store.cover.units {
        // Les fonctions `.pdata` **et** les corps feuilles isolés du résidu : ces
        // derniers n'ont pas d'information d'unwind mais sont bien du code.
        if !matches!(u.kind, UnitKind::Function | UnitKind::CodeResidue) || u.len > max_len {
            continue;
        }
        let Some(body) = reference.bytes.get(u.range()) else {
            continue;
        };
        let va = u.va.unwrap_or_default();
        let e = groups.entry(body.to_vec()).or_insert_with(|| Group {
            count: 0,
            len: body.len(),
            example: va,
            self_contained: is_self_contained(body, va),
        });
        e.count += 1;
        e.example = e.example.min(va);
    }

    let mut rows: Vec<(&Vec<u8>, &Group)> = groups
        .iter()
        .filter(|(_, g)| !no_reloc || g.self_contained)
        .collect();
    rows.sort_by(|a, b| {
        (b.1.count * b.1.len)
            .cmp(&(a.1.count * a.1.len))
            .then(a.1.example.cmp(&b.1.example))
    });

    let covered_units: usize = rows.iter().map(|(_, g)| g.count).sum();
    let covered_bytes: usize = rows.iter().map(|(_, g)| g.count * g.len).sum();
    println!(
        "candidates groups={} units={} bytes={} max_len={} no_reloc={}",
        rows.len(),
        covered_units,
        covered_bytes,
        max_len,
        no_reloc,
    );
    for (body, g) in rows.into_iter().take(top) {
        let hex: String = body.iter().map(|b| format!("{b:02x}")).collect();
        println!(
            "group body={hex} len={} count={} bytes={} selfcontained={} example={:#x}",
            g.len,
            g.count,
            g.count * g.len,
            g.self_contained,
            g.example,
        );
    }
    Ok(())
}

fn cmd_unit(paths: &Paths, va: Option<&str>, id: Option<&str>) -> anyhow::Result<()> {
    let store = ForgeStore::load(&paths.forge)?;
    let unit = match (va, id) {
        (Some(v), _) => {
            let v = parse_va(v)?;
            store
                .cover
                .find_va(v)
                .with_context(|| format!("aucune unité ne contient {v:#x}"))?
        }
        (None, Some(i)) => store
            .cover
            .find(i)
            .with_context(|| format!("unité inconnue : {i}"))?,
        (None, None) => bail!("passer --va ou --id"),
    };
    println!(
        "unit id={} kind={} section={} off={:#x} len={} va={} sha256={}",
        unit.id,
        unit.kind.tag(),
        unit.section.as_deref().unwrap_or("-"),
        unit.file_off,
        unit.len,
        unit.va.map_or("-".into(), |v| format!("{v:#x}")),
        unit.sha256,
    );
    Ok(())
}
