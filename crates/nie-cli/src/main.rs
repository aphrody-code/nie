//! `niers` — pilote la boucle RE autonome (seed → propagate → coverage) et la frontière redis.
#![forbid(unsafe_code)]

use std::path::PathBuf;

use anyhow::Context;
use clap::{Parser, Subcommand};
use sha2::{Digest, Sha256};

/// Image base de nie.exe (PE32+ Level-5).
const NIE_IMAGE_BASE: i64 = 0x1_4000_0000;

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
    /// Propage les labels sur le call-graph (auto-ML). Câblage en cours.
    Propagate {
        #[arg(long, default_value = "var/niers.sqlite")]
        db: PathBuf,
        #[arg(long, default_value_t = 16)]
        rounds: usize,
    },
}

#[derive(Subcommand)]
enum QueueOp {
    /// Empile une adresse.
    Push { addr: i64 },
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
    // Câblage Db → PropagationGraph en cours d'implémentation par la boucle.
    let _db = nie_index::Db::open(db_path)?;
    println!("propagate: {rounds} rounds — câblage call-graph → label-spreading en cours (nie-re::propagate prêt, intégration DB à finaliser)");
    Ok(())
}
