//! `niers` — pilote la boucle RE autonome (seed → propagate → coverage) et la frontière redis.
#![forbid(unsafe_code)]
#![allow(clippy::pedantic)]

use std::path::PathBuf;

use anyhow::Context;
use clap::{Parser, Subcommand};
use sha2::{Digest, Sha256};

/// Image base de nie.exe (PE32+ Level-5).
const NIE_IMAGE_BASE: i64 = 0x1_4000_0000;

/// Parse une adresse décimale ou hexadécimale (`0x...`).
fn parse_addr(s: &str) -> Result<i64, String> {
    match s.strip_prefix("0x").or_else(|| s.strip_prefix("0X")) {
        Some(hex) => u64::from_str_radix(hex, 16).map(|v| v as i64).map_err(|e| e.to_string()),
        None => s.parse::<i64>().map_err(|e| e.to_string()),
    }
}

#[derive(Parser)]
#[command(name = "niers", about = "Boucle RE + réimplémentation Rust d'Inazuma Eleven: Victory Road")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Importe le savoir fusionné (index Ghidra nie-index.json) dans la base de connaissance.
    Seed {
        /// Base sqlite cible.
        #[arg(long, default_value = "var/niers.sqlite")]
        db: PathBuf,
        /// Fichier research/nie-index.json.
        #[arg(long)]
        json: PathBuf,
        /// Binaire nie.exe (pour calculer sha256/taille). Optionnel.
        #[arg(long)]
        exe: Option<PathBuf>,
    },
    /// Affiche la couverture (fonctions classifiées) du binaire indexé.
    Coverage {
        #[arg(long, default_value = "var/niers.sqlite")]
        db: PathBuf,
    },
    /// Opérations sur la frontière BFS redis.
    Queue {
        #[command(subcommand)]
        op: QueueOp,
        #[arg(long, env = "NIERS_REDIS", default_value = "redis://127.0.0.1/")]
        redis: String,
        #[arg(long, default_value = "nie")]
        tag: String,
    },
    /// Propage les labels sur le call-graph (auto-ML, ancrage strings + label-spreading).
    Propagate {
        #[arg(long, default_value = "var/niers.sqlite")]
        db: PathBuf,
        #[arg(long, default_value_t = 16)]
        rounds: usize,
    },
    /// Extrait les classes RTTI MSVC depuis nie_eacpatched.exe et les ingère dans la base.
    Rtti {
        /// Base sqlite cible.
        #[arg(long, default_value = "var/niers.sqlite")]
        db: PathBuf,
        /// Chemin vers nie_eacpatched.exe (ou nie.exe).
        #[arg(long)]
        exe: PathBuf,
    },
    /// Triage PE/ELF via aphrody-re : sections + imports/exports ingérés dans la base.
    Index {
        /// Base sqlite cible.
        #[arg(long, default_value = "var/niers.sqlite")]
        db: PathBuf,
        /// Binaire à indexer.
        #[arg(long)]
        exe: PathBuf,
    },
    /// Récupère les arêtes d'appel manquantes par désassemblage iced-x86 de `.text`.
    Disasm {
        /// Base sqlite cible.
        #[arg(long, default_value = "var/niers.sqlite")]
        db: PathBuf,
        /// Binaire à désassembler (nie_eacpatched.exe ou nie.exe).
        #[arg(long)]
        exe: PathBuf,
    },
    /// Découvre les fonctions AUTORITAIRES via `.pdata` et mesure le désalignement Ghidra.
    Pdata {
        /// Base sqlite cible.
        #[arg(long, default_value = "var/niers.sqlite")]
        db: PathBuf,
        /// Binaire PE x64 (nie_eacpatched.exe ou nie.exe).
        #[arg(long)]
        exe: PathBuf,
    },
    /// Refonde la carte sur `.pdata` (vrais débuts), ré-ancre Ghidra, disasm + propage. Couverture HONNÊTE.
    Rebuild {
        /// Base sqlite cible.
        #[arg(long, default_value = "var/niers.sqlite")]
        db: PathBuf,
        /// Binaire PE x64.
        #[arg(long)]
        exe: PathBuf,
        #[arg(long, default_value_t = 16)]
        rounds: usize,
    },
}

#[derive(Subcommand)]
enum QueueOp {
    /// Empile une adresse (décimale ou hex `0x...`).
    Push {
        #[arg(value_parser = parse_addr)]
        addr: i64,
    },
    /// Dépile la prochaine adresse.
    Pop,
    /// Taille de la frontière.
    Len,
    /// Vide la frontière.
    Reset,
}

fn main() -> anyhow::Result<()> {
    // CLI interne (consommé par l'agent) : sortie minimale. `RUST_LOG=info` réactive les traces.
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env().add_directive(tracing::Level::WARN.into()))
        .init();
    let cli = Cli::parse();
    match cli.cmd {
        Cmd::Seed { db, json, exe } => seed(&db, &json, exe.as_deref()),
        Cmd::Coverage { db } => coverage(&db),
        Cmd::Queue { op, redis, tag } => queue(op, &redis, &tag),
        Cmd::Propagate { db, rounds } => propagate(&db, rounds),
        Cmd::Rtti { db, exe } => rtti(&db, &exe),
        Cmd::Index { db, exe } => index(&db, &exe),
        Cmd::Disasm { db, exe } => disasm(&db, &exe),
        Cmd::Pdata { db, exe } => pdata(&db, &exe),
        Cmd::Rebuild { db, exe, rounds } => rebuild(&db, &exe, rounds),
    }
}

fn seed(db_path: &std::path::Path, json: &std::path::Path, exe: Option<&std::path::Path>) -> anyhow::Result<()> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let mut db = nie_index::Db::open(db_path).context("ouverture base")?;

    let (sha, size, path_str) = match exe {
        Some(p) => {
            let bytes = std::fs::read(p).with_context(|| format!("lecture {}", p.display()))?;
            let mut h = Sha256::new();
            h.update(&bytes);
            (hex::encode(h.finalize()), bytes.len() as i64, p.display().to_string())
        }
        None => ("unknown-nie-index".to_string(), 0, "nie.exe".to_string()),
    };
    let bin = db.upsert_binary(&path_str, &sha, "x86_64", 64, NIE_IMAGE_BASE, size, None, None)?;

    let stats = nie_seed::nie_index_json::ingest_file(&mut db, bin, json)?;
    let cov = db.snapshot_coverage(bin)?;
    println!(
        "seed fn={} call={} str={} const={} glob={} anchor={} cov={}/{} ({:.2}%)",
        stats.functions, stats.xrefs, stats.str_refs, stats.consts, stats.globals, stats.anchors,
        cov.classified, cov.total, cov.pct
    );
    Ok(())
}

fn coverage(db_path: &std::path::Path) -> anyhow::Result<()> {
    let db = nie_index::Db::open(db_path)?;
    let bin: i64 = db
        .conn()
        .query_row("SELECT id FROM binary ORDER BY id LIMIT 1", [], |r| r.get(0))
        .context("aucun binaire indexé — lancer `niers seed` d'abord")?;
    let cov = nie_index::query::coverage(db.conn(), bin)?;
    let by_sub = nie_index::query::by_subsystem(db.conn(), bin)?;
    let subs = by_sub.iter().map(|(ns, n)| format!("{ns}={n}")).collect::<Vec<_>>().join(" ");
    println!("cov {}/{} ({:.2}%) named={} | {}", cov.classified, cov.total, cov.pct, cov.named, subs);
    Ok(())
}

fn queue(op: QueueOp, redis: &str, tag: &str) -> anyhow::Result<()> {
    let mut f = nie_queue::Frontier::connect(redis, tag)?;
    match op {
        QueueOp::Push { addr } => {
            let added = f.push(addr)?;
            println!("{}", if added { "ajoutée" } else { "déjà vue" });
        }
        QueueOp::Pop => match f.pop()? {
            Some(a) => println!("0x{a:x}"),
            None => println!("(frontière vide)"),
        },
        QueueOp::Len => println!("frontière: {} | vues: {}", f.len()?, f.seen_count()?),
        QueueOp::Reset => {
            f.reset()?;
            println!("frontière réinitialisée");
        }
    }
    Ok(())
}

fn propagate(db_path: &std::path::Path, rounds: usize) -> anyhow::Result<()> {
    let mut db = nie_index::Db::open(db_path).context("ouverture base")?;
    let bin: i64 = db
        .conn()
        .query_row("SELECT id FROM binary ORDER BY id LIMIT 1", [], |r| r.get(0))
        .context("aucun binaire indexé — lancer `niers seed` d'abord")?;

    let stats = nie_re::loop_db::propagate_db(&mut db, bin, rounds)
        .context("propagation")?;

    println!(
        "propagate rounds={} anchors(str/rtti/const)={}/{}/{} cov {:.2}%->{:.2}% (+{} fn)",
        stats.rounds, stats.anchored_str, stats.anchored_rtti, stats.anchored_const,
        stats.coverage_before, stats.coverage_after, stats.classified_after - stats.classified_before
    );
    Ok(())
}

fn rtti(db_path: &std::path::Path, exe_path: &std::path::Path) -> anyhow::Result<()> {
    let mut db = nie_index::Db::open(db_path).context("ouverture base")?;
    let bin: i64 = db
        .conn()
        .query_row("SELECT id FROM binary ORDER BY id LIMIT 1", [], |r| r.get(0))
        .context("aucun binaire indexé — lancer `niers seed` d'abord")?;

    let bytes = std::fs::read(exe_path)
        .with_context(|| format!("lecture {}", exe_path.display()))?;

    let stats = nie_re::rtti::parse_and_ingest(&mut db, bin, &bytes)
        .context("parsing RTTI")?;

    println!(
        "rtti col={} td={} classes={} bases={}",
        stats.candidates, stats.valid_type_descs, stats.classes_ingested, stats.bases_ingested
    );
    Ok(())
}

fn index(db_path: &std::path::Path, exe_path: &std::path::Path) -> anyhow::Result<()> {
    let mut db = nie_index::Db::open(db_path).context("ouverture base")?;
    let bin: i64 = db
        .conn()
        .query_row("SELECT id FROM binary ORDER BY id LIMIT 1", [], |r| r.get(0))
        .context("aucun binaire indexé — lancer `niers seed` d'abord")?;

    let stats = nie_re::indexer::triage_into(&mut db, bin, exe_path)
        .context("indexation PE")?;

    println!(
        "index fmt={} sections={} imports={} exports={}",
        stats.format, stats.sections, stats.imports, stats.exports
    );
    Ok(())
}

fn disasm(db_path: &std::path::Path, exe_path: &std::path::Path) -> anyhow::Result<()> {
    let mut db = nie_index::Db::open(db_path).context("ouverture base")?;
    let bin: i64 = db
        .conn()
        .query_row("SELECT id FROM binary ORDER BY id LIMIT 1", [], |r| r.get(0))
        .context("aucun binaire indexé — lancer `niers seed` d'abord")?;

    let stats = nie_re::disasm::recover_call_edges(&mut db, bin, exe_path)
        .context("désassemblage des arêtes d'appel")?;

    println!(
        "disasm insn={} call={} jmp={} thunk={} miss={} cand={} new={}",
        stats.instructions_decoded, stats.call_near, stats.jmp_near, stats.thunk_resolved,
        stats.near_target_miss, stats.edges_candidates, stats.edges_new
    );
    Ok(())
}

fn pdata(db_path: &std::path::Path, exe_path: &std::path::Path) -> anyhow::Result<()> {
    let mut db = nie_index::Db::open(db_path).context("ouverture base")?;
    let bin: i64 = db
        .conn()
        .query_row("SELECT id FROM binary ORDER BY id LIMIT 1", [], |r| r.get(0))
        .context("aucun binaire indexé — lancer `niers seed` d'abord")?;

    let stats = nie_re::pdata::discover_into(&mut db, bin, exe_path)
        .context("découverte .pdata")?;

    let pct_aligned = if stats.ghidra_total > 0 {
        100.0 * stats.overlap_ghidra as f64 / stats.ghidra_total as f64
    } else {
        0.0
    };
    println!(
        "pdata entries={} chained={} roots={} inserted={} | ghidra {}/{} aligned ({:.1}%) inside_body={}",
        stats.entries, stats.chained_fragments, stats.roots, stats.inserted,
        stats.overlap_ghidra, stats.ghidra_total, pct_aligned, stats.ghidra_inside_body
    );
    Ok(())
}

fn rebuild(db_path: &std::path::Path, exe_path: &std::path::Path, rounds: usize) -> anyhow::Result<()> {
    let mut db = nie_index::Db::open(db_path).context("ouverture base")?;
    let src_bin: i64 = db
        .conn()
        .query_row("SELECT id FROM binary ORDER BY id LIMIT 1", [], |r| r.get(0))
        .context("aucun binaire indexé — lancer `niers seed` d'abord")?;

    // Binaire cible distinct (vérité .pdata) : sha dérivé pour ne pas écraser la source.
    let (path_str, src_sha): (String, String) = db.conn().query_row(
        "SELECT path, sha256 FROM binary WHERE id=?1",
        [src_bin],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let dst_bin = db.upsert_binary(
        &format!("{path_str}#pdata"),
        &format!("{src_sha}-pdata"),
        "x86_64",
        64,
        NIE_IMAGE_BASE,
        0,
        None,
        None,
    )?;

    let rb = nie_re::pdata::rebuild_from_pdata(&mut db, src_bin, dst_bin, exe_path)?;
    let vt = nie_re::vtable::vtable_edges_into(&mut db, src_bin, dst_bin, exe_path)?;
    let dis = nie_re::disasm::recover_call_edges(&mut db, dst_bin, exe_path)?;
    let prop = nie_re::loop_db::propagate_db(&mut db, dst_bin, rounds)?;

    println!(
        "rebuild roots={} str={} ce={} rtti={} | vtable methods={} leaf+={} edges={} | disasm new={} | cov={}/{} ({:.2}%)",
        rb.roots, rb.str_refs_moved, rb.ce_edges_mapped, rb.rtti_copied,
        vt.methods, vt.new_leaf_funcs, vt.cohesion_edges,
        dis.edges_new, prop.classified_after, prop.total, prop.coverage_after
    );
    Ok(())
}
