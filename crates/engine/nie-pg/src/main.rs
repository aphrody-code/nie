//! Thin CLI over the `nie-pg` library.
//!
//! ```text
//! nie-pg migrate
//! nie-pg import [--prefix data/common/gamedata/] [--limit N]
//! nie-pg status
//! ```
//! Connection: `NIE_PG_URL` (or `DATABASE_URL`), e.g. `host=127.0.0.1 user=nie_owner dbname=nie`.
//! The transport is plaintext: local databases only (loopback or socket).

use anyhow::{Context, Result, bail};
use clap::{Parser, Subcommand};
use nie_pg::{ImportOutcome, decode, is_cfgbin_path, migrate, store_file};
use tokio_postgres::{Client, NoTls};

#[derive(Parser)]
#[command(name = "nie-pg", about = "IEVR VFS cfg.bin -> PostgreSQL (schema nie)")]
struct Cli {
    #[arg(long, env = "NIE_PG_URL")]
    url: Option<String>,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Creates or upgrades schema `nie`.
    Migrate,
    /// Imports the VFS cfg.bin files (NIE_GAME_DIR) incrementally.
    Import {
        /// Only VFS paths starting with this prefix.
        #[arg(long, default_value = "")]
        prefix: String,
        /// Maximum number of files (0 = all).
        #[arg(long, default_value_t = 0)]
        limit: usize,
    },
    /// Prints imported volumes.
    Status,
    /// Checks that the game install is complete (every referenced CPK present). No database.
    Check,
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    if matches!(cli.command, Command::Check) {
        return check();
    }
    let url = cli
        .url
        .or_else(|| std::env::var("DATABASE_URL").ok())
        .context("NIE_PG_URL or DATABASE_URL is required")?;
    let mut client = connect(&url).await?;
    match cli.command {
        Command::Migrate => {
            let done = migrate(&mut client).await?;
            println!("migrations applied: {done:?}");
        }
        Command::Import { prefix, limit } => {
            migrate(&mut client).await?;
            import(&mut client, &prefix, limit).await?;
        }
        Command::Status => status(&client).await?,
        Command::Check => unreachable!("handled before connecting"),
    }
    Ok(())
}

/// Compares the CPKs `cpk_list.cfg.bin` references with the packs on disk, so a partial
/// copy of the game is reported before an import rather than as thousands of skipped files.
fn check() -> Result<()> {
    let vfs = nie_formats::vfs::open_game().context("VFS not found (NIE_GAME_DIR)")?;
    let packs = vfs.game_data_dir().join("packs");
    let mut referenced: std::collections::BTreeMap<&str, (usize, usize)> = Default::default();
    for (path, entry) in vfs.iter() {
        if entry.cpk_filename.is_empty() {
            continue;
        }
        let slot = referenced.entry(entry.cpk_filename.as_str()).or_default();
        slot.0 += 1;
        if is_cfgbin_path(path) {
            slot.1 += 1;
        }
    }
    let missing: Vec<_> = referenced
        .iter()
        .filter(|(cpk, _)| !packs.join(cpk).is_file())
        .collect();
    let lost =
        |i: fn(&(usize, usize)) -> usize| -> usize { missing.iter().map(|(_, c)| i(c)).sum() };
    let total = |i: fn(&(usize, usize)) -> usize| -> usize { referenced.values().map(i).sum() };
    println!("vfs: {}", vfs.game_data_dir().display());
    println!(
        "cpk: {} referenced, {} present, {} missing",
        referenced.len(),
        referenced.len() - missing.len(),
        missing.len()
    );
    println!(
        "files: {} / {} readable | cfg.bin: {} / {} readable",
        total(|c| c.0) - lost(|c| c.0),
        total(|c| c.0),
        total(|c| c.1) - lost(|c| c.1),
        total(|c| c.1)
    );
    if missing.is_empty() {
        println!("complete");
        Ok(())
    } else {
        bail!(
            "incomplete game install: {} CPK missing under {}",
            missing.len(),
            packs.display()
        )
    }
}

async fn connect(url: &str) -> Result<Client> {
    let (client, connection) = tokio_postgres::connect(url, NoTls)
        .await
        .context("cannot connect to PostgreSQL")?;
    tokio::spawn(async move {
        if let Err(error) = connection.await {
            eprintln!("PostgreSQL connection lost: {error}");
        }
    });
    Ok(client)
}

async fn import(client: &mut Client, prefix: &str, limit: usize) -> Result<()> {
    let vfs = nie_formats::vfs::open_game().context("VFS not found (NIE_GAME_DIR)")?;
    let mut paths: Vec<String> = vfs
        .iter()
        .map(|(path, _)| path)
        .filter(|path| is_cfgbin_path(path) && path.starts_with(prefix))
        .map(str::to_owned)
        .collect();
    paths.sort_unstable();
    // `open_game` silently falls back to any extracted tree it finds, including this
    // repository's `data/`; say which VFS was opened so an empty import is never mistaken
    // for "nothing to do".
    eprintln!(
        "vfs: {} ({} entries, {} cfg.bin under '{prefix}')",
        vfs.game_data_dir().display(),
        vfs.asset_count(),
        paths.len()
    );
    if limit > 0 {
        paths.truncate(limit);
    }
    let (mut written, mut unchanged, mut rows) = (0u64, 0u64, 0u64);
    let mut skipped: Vec<(String, String)> = Vec::new();
    for (i, path) in paths.iter().enumerate() {
        let decoded = match vfs
            .read(path)
            .map_err(anyhow::Error::from)
            .and_then(|b| Ok(decode(&b)?))
        {
            Ok(decoded) => decoded,
            Err(error) => {
                skipped.push((path.clone(), error.to_string()));
                continue;
            }
        };
        match store_file(client, path, &decoded)
            .await
            .with_context(|| format!("import {path}"))?
        {
            ImportOutcome::Unchanged => unchanged += 1,
            ImportOutcome::Written { rows: n } => {
                written += 1;
                rows += n;
            }
        }
        if (i + 1) % 1000 == 0 {
            eprintln!("{}/{} files", i + 1, paths.len());
        }
    }
    println!(
        "files: {} | written: {written} | unchanged: {unchanged} | skipped: {} | rows: {rows}",
        paths.len(),
        skipped.len()
    );
    // Group by reason with sizes stripped, so a systematic gap reads as one line.
    let mut reasons: std::collections::BTreeMap<String, (usize, &str)> = Default::default();
    for (path, reason) in &skipped {
        let key = reason.split(" (").next().unwrap_or(reason).to_owned();
        reasons.entry(key).or_insert((0, path)).0 += 1;
    }
    for (reason, (count, example)) in &reasons {
        println!("  skipped {count}: {reason} (e.g. {example})");
    }
    if paths.is_empty() {
        bail!("no cfg.bin under prefix '{prefix}'");
    }
    Ok(())
}

async fn status(client: &Client) -> Result<()> {
    let row = client
        .query_one(
            "SELECT (SELECT count(*) FROM nie.cfgbin_file WHERE format = 'rdbn'),
                    (SELECT count(*) FROM nie.cfgbin_file WHERE format = 't2b'),
                    (SELECT count(*) FROM nie.rdbn_value),
                    (SELECT count(*) FROM nie.t2b_entry),
                    (SELECT count(*) FROM nie.t2b_var)",
            &[],
        )
        .await?;
    let n = |i: usize| row.get::<_, i64>(i);
    println!(
        "rdbn: {} files, {} values | t2b: {} files, {} entries, {} variables",
        n(0),
        n(2),
        n(1),
        n(3),
        n(4)
    );
    Ok(())
}
