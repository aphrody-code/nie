//! Import a decoded Cross index into an explicitly named, new candidate database.
//! gzip -cd catalog-index.ndjson.gz | cargo run -p nie-wiki --example import_cross -- \
//!   var/cross-candidate.sqlite SOURCE_LABEL SHA256 /path/to/cross/documents

use std::{collections::BTreeMap, io, path::Path};

use anyhow::{Context, ensure};
use nie_wiki::cross::{self, Provenance};

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    ensure!(
        args.len() == 4 || (args.len() == 6 && args[4] == "--base-mirror"),
        "usage: import_cross CANDIDATE_DB SOURCE_LABEL SHA256 DOCUMENT_DIRECTORY [--base-mirror SOURCE_DB] < catalog.ndjson"
    );
    let candidate = Path::new(&args[0]);
    ensure!(
        !candidate.exists(),
        "candidate must be a new file; existing databases are never overwritten"
    );
    let mut documents = BTreeMap::new();
    for name in [
        "catalog-stats",
        "masterdata-schema",
        "enums",
        "extraction-status",
        "audio-manifest",
        "type-schema",
        "class-taxonomy",
        "asset-key-patterns",
    ] {
        let path = Path::new(&args[3]).join(format!("{name}.json"));
        documents.insert(
            name.to_owned(),
            serde_json::from_reader(
                std::fs::File::open(&path).with_context(|| format!("read {}", path.display()))?,
            )?,
        );
    }
    // create_new prevents accidental writes through an existing file or symlink.
    let file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(candidate)?;
    drop(file);
    let source = args
        .get(5)
        .map(|path| {
            rusqlite::Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
                .context("open base mirror read-only")
        })
        .transpose()?;
    if let Some(source) = &source {
        source.execute("VACUUM INTO ?1", [candidate.to_string_lossy().as_ref()])?;
    }
    let mut connection = rusqlite::Connection::open(candidate)?;
    let report = cross::import(
        &mut connection,
        io::stdin().lock(),
        &documents,
        &Provenance {
            source: args[1].clone(),
            sha256: args[2].clone(),
        },
    )?;
    if let Some(source) = &source {
        let tables = cross::verify_mirror_preserved(source, &connection)?;
        eprintln!(
            "Verified {tables} pre-existing inagle tables: all columns, IDs, rows and duplicate counts unchanged"
        );
    }
    println!("{}", serde_json::to_string_pretty(&report)?);
    Ok(())
}
