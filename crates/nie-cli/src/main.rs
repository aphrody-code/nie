//! `niers` — pilote la boucle RE autonome (seed → propagate → coverage) et la frontière redis.
#![forbid(unsafe_code)]

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
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env().add_directive(tracing::Level::INFO.into()))
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
    println!("seed: {} fonctions, {} appels, {} str-refs, {} consts, {} globals, {} ancres",
        stats.functions, stats.xrefs, stats.str_refs, stats.consts, stats.globals, stats.anchors);
    println!("couverture: {}/{} classifiées ({:.2}%), {} nommées", cov.classified, cov.total, cov.pct, cov.named);
    Ok(())
}

fn coverage(db_path: &std::path::Path) -> anyhow::Result<()> {
    let db = nie_index::Db::open(db_path)?;
    let bin: i64 = db
        .conn()
        .query_row("SELECT id FROM binary ORDER BY id LIMIT 1", [], |r| r.get(0))
        .context("aucun binaire indexé — lancer `niers seed` d'abord")?;
    let cov = nie_index::query::coverage(db.conn(), bin)?;
    println!("couverture: {}/{} fonctions classifiées ({:.2}%), {} nommées", cov.classified, cov.total, cov.pct, cov.named);
    println!("\npar sous-système :");
    for (ns, n) in nie_index::query::by_subsystem(db.conn(), bin)? {
        println!("  {ns:<16} {n}");
    }
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

    println!("propagation terminée : {} rounds", stats.rounds);
    println!();
    println!("ancres posées par mécanisme :");
    println!("  chaînes (str)    : {}", stats.anchored_str);
    println!("  RTTI             : {}", stats.anchored_rtti);
    println!("  constante-magic  : {}", stats.anchored_const);
    println!("  total ancres     : {}", stats.anchored_str + stats.anchored_rtti + stats.anchored_const);
    println!();
    println!(
        "couverture AVANT : {}/{} ({:.2}%)",
        stats.classified_before, stats.total, stats.coverage_before
    );
    println!(
        "couverture APRÈS  : {}/{} ({:.2}%)",
        stats.classified_after, stats.total, stats.coverage_after
    );
    println!(
        "gain propagation  : {} fonctions nouvellement étiquetées",
        stats.labeled
    );
    println!(
        "gain total        : +{} (+{:.2}%)",
        stats.classified_after - stats.classified_before,
        stats.coverage_after - stats.coverage_before
    );

    // Top sous-systèmes après propagation.
    let by_sub = nie_index::query::by_subsystem(db.conn(), bin)?;
    println!();
    println!("répartition par sous-système :");
    for (ns, n) in &by_sub {
        println!("  {ns:<18} {n}");
    }

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

    println!("RTTI parsing terminé :");
    println!("  candidats COL trouvés : {}", stats.candidates);
    println!("  TypeDescriptors valides : {}", stats.valid_type_descs);
    println!("  classes ingérées : {}", stats.classes_ingested);
    println!("  relations d'héritage : {}", stats.bases_ingested);
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

    println!("indexation terminée :");
    println!("  format : {}", stats.format);
    println!("  sections ingérées : {}", stats.sections);
    println!("  imports ingérés : {}", stats.imports);
    println!("  exports ingérés : {}", stats.exports);
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

    println!("désassemblage terminé :");
    println!("  fonctions balayées : {}", stats.functions_scanned);
    println!("  instructions décodées : {}", stats.instructions_decoded);
    println!("  call (toutes formes) : {}", stats.call_insns);
    println!("  call directs (rel32) : {}", stats.call_near);
    println!("  jmp directs (tail-calls) : {}", stats.jmp_near);
    println!("  arêtes via thunk (jmp-relais) : {}", stats.thunk_resolved);
    println!("  cibles directes non résolues : {}", stats.near_target_miss);
    println!("  arêtes candidates : {}", stats.edges_candidates);
    println!("  arêtes NOUVELLES (manquées par Ghidra) : {}", stats.edges_new);
    Ok(())
}
