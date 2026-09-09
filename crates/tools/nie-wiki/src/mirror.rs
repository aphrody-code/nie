//! Resolve the read-only SQLite materialization of the game VFS.
//!
//! Resolution order:
//! 1. `--db` (highest priority)
//! 2. `NIE_WIKI_DB` or `SQLITE_DB_PATH`
//! 3. `var/mirror.sqlite`, then the newest `inagle-*.sqlite` snapshot in
//!    `var/miroir` or `data/backups`.
//!
//! Supabase and other network databases are deliberately not accepted here. The
//! `inagle_*` tables must be produced from the local game/VFS or zukan source.

use std::path::{Path, PathBuf};

use anyhow::{Context, bail};
use rusqlite::{Connection, OpenFlags};

/// Open the resolved SQLite mirror in read-only mode.
///
/// # Erreurs
///
/// Retourne une erreur si aucun miroir n'est trouvé ou si l'ouverture échoue.
pub fn open(db_override: Option<&Path>) -> anyhow::Result<Connection> {
    let path = resolve(db_override)?;
    tracing::debug!("game mirror SQLite: {}", path.display());
    let conn = Connection::open_with_flags(
        &path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .with_context(|| format!("ouverture SQLite {}", path.display()))?;
    // Enable WAL read access for a mirror that is being refreshed locally.
    conn.pragma_update(None, "journal_mode", "WAL").ok();
    Ok(conn)
}

/// Return the resolved SQLite mirror path.
pub fn resolve(db_override: Option<&Path>) -> anyhow::Result<PathBuf> {
    // 1. Explicit --db path.
    if let Some(p) = db_override {
        if p.exists() {
            return Ok(p.to_path_buf());
        }
        bail!("specified database does not exist: {}", p.display());
    }

    // 2. Environment variables.
    for var in &["NIE_WIKI_DB", "SQLITE_DB_PATH"] {
        if let Ok(v) = std::env::var(var) {
            let p = PathBuf::from(&v);
            if p.exists() {
                return Ok(p);
            }
        }
    }

    // 3. Repository-local game mirror and inagle snapshots.
    let primary = PathBuf::from("var/mirror.sqlite");
    if primary.is_file() && primary.metadata().is_ok_and(|m| m.len() > 0) {
        return Ok(primary);
    }
    let mut candidates = Vec::new();
    for dir in [PathBuf::from("var/miroir"), PathBuf::from("data/backups")] {
        if dir.is_dir() {
            candidates.extend(latest_sqlite_in(&dir));
        }
    }
    if let Some(latest) = candidates.into_iter().max() {
        return Ok(latest);
    }

    bail!(
        "no game SQLite mirror found — use --db, NIE_WIKI_DB, var/mirror.sqlite, or place an \
         inagle-*.sqlite snapshot in data/backups"
    )
}

/// Find non-empty `inagle-*.sqlite` snapshots.
///
/// Zero-byte files still being created are ignored.
fn latest_sqlite_in(dir: &Path) -> Option<PathBuf> {
    let mut entries: Vec<PathBuf> = std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.extension().is_some_and(|ext| ext == "sqlite")
                && p.file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.starts_with("inagle-"))
                // Ignore empty files that are still being created.
                && p.metadata().is_ok_and(|m| m.len() > 0)
        })
        .collect();
    entries.sort();
    entries.into_iter().next_back()
}

/// Execute a query that maps rows into caller-defined values.
///
/// Commodité pour les appels one-off sans paramètres typés complexes.
pub fn query_rows<F, T>(
    conn: &Connection,
    sql: &str,
    params: &[&dyn rusqlite::ToSql],
    map: F,
) -> anyhow::Result<Vec<T>>
where
    F: Fn(&rusqlite::Row<'_>) -> rusqlite::Result<T>,
{
    let mut stmt = conn.prepare(sql).context("preparing SQL")?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(params.iter().copied()), map)
        .context("executing SQL")?;
    let mut results = Vec::new();
    for row in rows {
        results.push(row.context("reading row")?);
    }
    Ok(results)
}

/// Same as [`query_rows`], returning `None` when no row exists.
pub fn query_one<F, T>(
    conn: &Connection,
    sql: &str,
    params: &[&dyn rusqlite::ToSql],
    map: F,
) -> anyhow::Result<Option<T>>
where
    F: Fn(&rusqlite::Row<'_>) -> rusqlite::Result<T>,
{
    let mut stmt = conn.prepare(sql).context("preparing SQL")?;
    let mut rows = stmt
        .query_map(rusqlite::params_from_iter(params.iter().copied()), map)
        .context("executing SQL")?;
    match rows.next() {
        None => Ok(None),
        Some(r) => Ok(Some(r.context("reading row")?)),
    }
}

/// Merge `data` JSON with `sheet_data`, giving non-empty `sheet_data` precedence.
pub fn merge_data_sheet(data: Option<&str>, sheet_data: Option<&str>) -> serde_json::Value {
    let base = data
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or(serde_json::Value::Object(Default::default()));
    let overlay = sheet_data
        .filter(|s| !s.is_empty() && *s != "null")
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or(serde_json::Value::Object(Default::default()));

    match (base, overlay) {
        (serde_json::Value::Object(mut b), serde_json::Value::Object(o)) => {
            for (k, v) in o {
                b.insert(k, v);
            }
            serde_json::Value::Object(b)
        }
        // Si l'un n'est pas un objet, sheet_data gagne entièrement si présent.
        (_b, serde_json::Value::Object(o)) if !o.is_empty() => serde_json::Value::Object(o),
        (b, _) => b,
    }
}
