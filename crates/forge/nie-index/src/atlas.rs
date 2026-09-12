//! Atlas — the single index over every reverse-engineering surface of the repository.
//!
//! One database (`var/nie-atlas.sqlite`) holds, in one place, what was until now spread
//! across a 19 GB knowledge base, a file tree (`data/re/`), a forge registry, four export
//! directories, thirty-odd Markdown documents and forty-five crates:
//!
//! | Surface | Table | Populated by |
//! |---|---|---|
//! | files of the RE/forge chain | `atlas_artifact` | [`Atlas::scan`] |
//! | Cargo workspace | `atlas_crate`, `atlas_crate_dep` | [`Atlas::import_crates`] |
//! | Markdown corpus and its claims | `atlas_doc`, `atlas_doc_section`, `atlas_doc_ref` | [`Atlas::import_docs`] |
//! | knowledge base digest | `atlas_kb_table`, `atlas_symbol`, `atlas_unit` | [`Atlas::import_kb`] |
//! | binaries | `atlas_binary` | [`Atlas::import_binaries`] |
//! | runnable tools | `atlas_tool` | [`Atlas::import_tools`], [`Atlas::import_repo_tools`] |
//! | measurements | `atlas_metric` | [`Atlas::record_metric`] |
//! | road to 100 % | `atlas_gap` | [`Atlas::refresh_gaps`] |
//! | autonomous loop | `atlas_run` | [`Atlas::record_run`] |
//!
//! Nothing here invents a number: every row carries the path, the table or the command it
//! was measured from, and [`Atlas::refresh_gaps`] only creates a gap for a metric that was
//! actually recorded.

use std::collections::{BTreeSet, HashSet};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, OptionalExtension, params};
use sha2::{Digest, Sha256};

use crate::{IndexError, Result};

/// Embedded atlas schema.
pub const ATLAS_SCHEMA: &str = include_str!("atlas.sql");

/// Schema version, stored under `atlas_meta.schema_version`.
pub const ATLAS_SCHEMA_VERSION: &str = "1";

/// Repository-relative default location of the atlas database.
pub const DEFAULT_ATLAS_PATH: &str = "var/nie-atlas.sqlite";

/// Redis database reserved for the atlas mirror (db0 = BFS frontier + bot, db1 = RAG
/// vectors, db3 = CPK/texture cache — see `docs/RE.md`).
pub const DEFAULT_ATLAS_REDIS: &str = "redis://127.0.0.1/4";

/// Roots walked by [`Atlas::scan`], relative to the repository. Explicit rather than
/// `.gitignore`-driven: `data/re/` is deliberately untracked, and `target/`/`node_modules/`
/// must never be walked.
pub const SCAN_ROOTS: &[&str] = &[
    "crates",
    "docs",
    "forge",
    "src",
    "data/re",
    "data/forge",
    "export",
    "data/export",
    "data/exports",
    "scripts",
    "python",
    "deploy",
    "dist",
    "refs",
];

/// Directory names never descended into, whatever the root.
const SKIP_DIRS: &[&str] = &[
    "target",
    "node_modules",
    ".git",
    ".next",
    "incremental",
    "__pycache__",
    ".venv",
];

/// Connection to the atlas database.
pub struct Atlas {
    conn: Connection,
    /// `true` when the SQLite build provides FTS5 and the mirror table exists.
    fts: bool,
}

/// One line of [`Atlas::status`].
#[derive(Debug, Default, Clone, serde::Serialize)]
pub struct Status {
    pub artifacts: i64,
    pub artifact_bytes: i64,
    pub crates: i64,
    pub docs: i64,
    pub doc_refs: i64,
    pub symbols: i64,
    pub units: i64,
    pub units_exact: i64,
    pub tools: i64,
    pub kb_tables: i64,
    pub kb_rows: i64,
    pub menu_screens: i64,
    pub gaps_open: i64,
    pub runs: i64,
}

/// Result of a filesystem scan.
#[derive(Debug, Default, Clone, Copy, serde::Serialize)]
pub struct ScanStats {
    pub files: usize,
    pub bytes: u64,
    pub hashed: usize,
    pub docs: usize,
    pub roots: usize,
}

/// Result of a knowledge-base import.
#[derive(Debug, Default, Clone, Copy, serde::Serialize)]
pub struct KbDigest {
    pub tables: usize,
    pub rows: i64,
    pub capped: usize,
    pub symbols: usize,
    pub units: usize,
    /// Last honest coverage row of the knowledge base, when it has one.
    pub coverage: Option<KbCoverage>,
}

/// Last row of the knowledge base's `coverage` table — the measurement `niers rebuild`
/// writes, copied verbatim rather than recomputed.
#[derive(Debug, Default, Clone, Copy, serde::Serialize)]
pub struct KbCoverage {
    pub total: i64,
    pub named: i64,
    pub classified: i64,
    pub pct: f64,
}

/// Result of a forge import (cover, lifted assembly, registry).
#[derive(Debug, Default, Clone, Copy, serde::Serialize)]
pub struct ForgeImport {
    pub units: usize,
    pub lifted: usize,
    pub registered: usize,
    pub exact: usize,
    pub cover_bytes: i64,
}

/// A ranked gap on the road to 100 %.
#[derive(Debug, Clone, serde::Serialize)]
pub struct Gap {
    pub area: String,
    pub metric: String,
    pub current: f64,
    pub target: f64,
    pub unit: String,
    pub weight: f64,
    pub status: String,
    pub action: Option<String>,
    pub evidence: Option<String>,
    pub remaining: f64,
    pub score: f64,
}

/// A search hit.
#[derive(Debug, Clone, serde::Serialize)]
pub struct Hit {
    pub kind: String,
    pub key: String,
    pub body: String,
    pub reference: Option<String>,
}

/// One measurement read back from `atlas_metric`: `(value, total, pct, source)`.
pub type MetricRow = (f64, Option<f64>, Option<f64>, String);

/// A runnable tool of the repository.
#[derive(Debug, Clone)]
pub struct ToolRecord {
    pub name: String,
    pub kind: String,
    pub path: Option<String>,
    pub summary: Option<String>,
}

/// One row of `atlas_menu_screen`.
#[derive(Debug, Clone, serde::Serialize)]
pub struct MenuScreenRecord {
    pub capture_file: String,
    pub screen_id: String,
    pub name: String,
    pub setting_cfg: Option<String>,
    pub pairing_status: String,
    pub referenced_objbins: i64,
    pub missing_objbins: i64,
    pub has_lua: bool,
    pub reference_image: Option<String>,
}

/// Scan tuning.
#[derive(Debug, Clone)]
pub struct ScanConfig {
    /// Repository root.
    pub root: PathBuf,
    /// Files larger than this are indexed without a SHA-256 (default 8 MiB).
    pub hash_limit: u64,
    /// Files larger than this are not read for line counting (default 4 MiB).
    pub text_limit: u64,
    /// Roots to walk, relative to `root`.
    pub roots: Vec<String>,
}

impl ScanConfig {
    /// Default configuration for a repository root.
    #[must_use]
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self {
            root: root.into(),
            hash_limit: 8 * 1024 * 1024,
            text_limit: 4 * 1024 * 1024,
            roots: SCAN_ROOTS.iter().map(|s| (*s).to_string()).collect(),
        }
    }
}

impl Atlas {
    /// Open (or create) the atlas at `path` and apply the schema.
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        if let Some(parent) = path.as_ref().parent()
            && !parent.as_os_str().is_empty()
        {
            std::fs::create_dir_all(parent).map_err(|e| IndexError::Other(e.to_string()))?;
        }
        let conn = Connection::open(path)?;
        let mut atlas = Self { conn, fts: false };
        atlas.init()?;
        Ok(atlas)
    }

    /// In-memory atlas (tests).
    pub fn open_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        let mut atlas = Self { conn, fts: false };
        atlas.init()?;
        Ok(atlas)
    }

    /// Apply the schema and probe FTS5 (idempotent).
    pub fn init(&mut self) -> Result<()> {
        self.conn.execute_batch(ATLAS_SCHEMA)?;
        self.fts = self
            .conn
            .execute_batch(
                "CREATE VIRTUAL TABLE IF NOT EXISTS atlas_fts
                 USING fts5(kind, key, body, ref UNINDEXED, tokenize='unicode61');",
            )
            .is_ok();
        self.set_meta("schema_version", ATLAS_SCHEMA_VERSION)?;
        self.set_meta("fts5", if self.fts { "1" } else { "0" })?;
        Ok(())
    }

    /// Read-only access to the connection.
    #[must_use]
    pub fn conn(&self) -> &Connection {
        &self.conn
    }

    /// Mutable access (bulk-load transactions).
    pub fn conn_mut(&mut self) -> &mut Connection {
        &mut self.conn
    }

    /// `true` when the full-text mirror is available.
    #[must_use]
    pub fn has_fts(&self) -> bool {
        self.fts
    }

    pub fn set_meta(&self, key: &str, value: &str) -> Result<()> {
        self.conn.execute(
            "INSERT INTO atlas_meta(key, value) VALUES(?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )?;
        Ok(())
    }

    pub fn get_meta(&self, key: &str) -> Result<Option<String>> {
        Ok(self
            .conn
            .query_row("SELECT value FROM atlas_meta WHERE key = ?1", [key], |r| {
                r.get(0)
            })
            .optional()?)
    }

    // ---------------------------------------------------------------- scan

    /// Walk the RE/forge surface of the repository and index every file.
    ///
    /// `tracked` holds the repository-relative paths reported by `git ls-files`; a path
    /// absent from it is indexed all the same, flagged untracked (that is the normal state
    /// of `data/re/`, which carries licensed material).
    pub fn scan(&mut self, cfg: &ScanConfig, tracked: &HashSet<String>) -> Result<ScanStats> {
        let mut stats = ScanStats::default();
        let tx = self.conn.transaction()?;
        {
            let mut upsert = tx.prepare(
                "INSERT INTO atlas_artifact(path, zone, kind, ext, bytes, sha256, mtime, lines, tracked, scanned_at)
                 VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9, datetime('now'))
                 ON CONFLICT(path) DO UPDATE SET
                     zone = excluded.zone, kind = excluded.kind, ext = excluded.ext,
                     bytes = excluded.bytes, sha256 = excluded.sha256, mtime = excluded.mtime,
                     lines = excluded.lines, tracked = excluded.tracked,
                     scanned_at = excluded.scanned_at",
            )?;
            let mut text = tx.prepare(
                "INSERT INTO atlas_text(kind, key, body, ref) VALUES('artifact', ?1, ?2, ?3)
                 ON CONFLICT(kind, key) DO UPDATE SET body = excluded.body, ref = excluded.ref",
            )?;

            for root in &cfg.roots {
                let abs = cfg.root.join(root);
                if !abs.exists() {
                    continue;
                }
                stats.roots += 1;
                let mut walker = ignore::WalkBuilder::new(&abs);
                walker
                    .standard_filters(false)
                    .hidden(false)
                    .follow_links(false)
                    .filter_entry(|entry| {
                        entry.file_name().to_str().is_none_or(|n| {
                            !SKIP_DIRS.contains(&n) && !n.ends_with(".sqlite-wal")
                        })
                    });
                for entry in walker.build().flatten() {
                    if !entry.file_type().is_some_and(|t| t.is_file()) {
                        continue;
                    }
                    let path = entry.path();
                    let Ok(rel) = path.strip_prefix(&cfg.root) else {
                        continue;
                    };
                    let rel = rel.to_string_lossy().replace('\\', "/");
                    let Ok(meta) = entry.metadata() else { continue };
                    let bytes = meta.len();
                    let mtime = meta
                        .modified()
                        .ok()
                        .and_then(|m| m.duration_since(UNIX_EPOCH).ok())
                        .map_or(0, |d| d.as_secs()) as i64;
                    let ext = path
                        .extension()
                        .and_then(|e| e.to_str())
                        .map(str::to_ascii_lowercase);
                    let kind = classify_kind(&rel, ext.as_deref());
                    let zone = classify_zone(&rel, kind);
                    let sha = if bytes <= cfg.hash_limit {
                        sha256_file(path).ok()
                    } else {
                        None
                    };
                    let lines = if is_text(kind) && bytes <= cfg.text_limit {
                        std::fs::read_to_string(path)
                            .ok()
                            .map(|s| s.lines().count() as i64)
                    } else {
                        None
                    };
                    if sha.is_some() {
                        stats.hashed += 1;
                    }
                    if kind == "md" {
                        stats.docs += 1;
                    }
                    stats.files += 1;
                    stats.bytes += bytes;

                    upsert.execute(params![
                        rel,
                        zone,
                        kind,
                        ext,
                        bytes as i64,
                        sha,
                        mtime,
                        lines,
                        i64::from(tracked.contains(&rel)),
                    ])?;
                    text.execute(params![
                        rel,
                        format!("{zone} {kind} {rel}"),
                        rel.clone()
                    ])?;
                }
            }
        }
        tx.commit()?;
        self.set_meta("scanned_files", &stats.files.to_string())?;
        self.refresh_fts()?;
        Ok(stats)
    }

    // -------------------------------------------------------------- crates

    /// Index the Cargo workspace: one row per crate, plus its internal dependencies.
    ///
    /// Reads `Cargo.toml` directly rather than shelling out to `cargo metadata`, which
    /// takes the workspace lock and would serialise the atlas behind any running build.
    pub fn import_crates(&mut self, root: &Path) -> Result<usize> {
        let mut manifests: Vec<(PathBuf, String)> = Vec::new();
        for tier in ["forge", "engine", "tools", "archive"] {
            let dir = root.join("crates").join(tier);
            let Ok(entries) = std::fs::read_dir(&dir) else {
                continue;
            };
            for entry in entries.flatten() {
                let manifest = entry.path().join("Cargo.toml");
                if manifest.is_file() {
                    manifests.push((manifest, tier.to_string()));
                }
            }
        }
        let Ok(apps) = std::fs::read_dir(root.join("apps")) else {
            return self.write_crates(root, &manifests);
        };
        for entry in apps.flatten() {
            for candidate in [entry.path().join("Cargo.toml"), entry.path().join("src-tauri/Cargo.toml")] {
                if candidate.is_file() {
                    manifests.push((candidate, "app".to_string()));
                }
            }
        }
        self.write_crates(root, &manifests)
    }

    fn write_crates(&mut self, root: &Path, manifests: &[(PathBuf, String)]) -> Result<usize> {
        let tx = self.conn.transaction()?;
        let mut count = 0usize;
        {
            let mut upsert = tx.prepare(
                "INSERT INTO atlas_crate(name, path, tier, version, description, files, loc,
                                         test_fns, unsafe_hits, extern_todo, n_deps, in_workspace)
                 VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)
                 ON CONFLICT(name) DO UPDATE SET
                     path = excluded.path, tier = excluded.tier, version = excluded.version,
                     description = excluded.description, files = excluded.files, loc = excluded.loc,
                     test_fns = excluded.test_fns, unsafe_hits = excluded.unsafe_hits,
                     extern_todo = excluded.extern_todo, n_deps = excluded.n_deps,
                     in_workspace = excluded.in_workspace",
            )?;
            let mut dep_stmt = tx.prepare(
                "INSERT INTO atlas_crate_dep(crate_id, dep, internal) VALUES(?1,?2,?3)
                 ON CONFLICT(crate_id, dep) DO UPDATE SET internal = excluded.internal",
            )?;
            let mut text = tx.prepare(
                "INSERT INTO atlas_text(kind, key, body, ref) VALUES('crate', ?1, ?2, ?3)
                 ON CONFLICT(kind, key) DO UPDATE SET body = excluded.body, ref = excluded.ref",
            )?;

            for (manifest, tier) in manifests {
                let Ok(raw) = std::fs::read_to_string(manifest) else {
                    continue;
                };
                let parsed = parse_manifest(&raw);
                let Some(name) = parsed.name else { continue };
                let dir = manifest.parent().unwrap_or(root);
                let rel_dir = dir
                    .strip_prefix(root)
                    .unwrap_or(dir)
                    .to_string_lossy()
                    .replace('\\', "/");
                let src = source_stats(&dir.join("src"));
                let in_workspace = i64::from(tier != "archive");

                upsert.execute(params![
                    name,
                    rel_dir,
                    tier,
                    parsed.version,
                    parsed.description,
                    src.files as i64,
                    src.loc as i64,
                    src.test_fns as i64,
                    src.unsafe_hits as i64,
                    src.extern_todo as i64,
                    parsed.deps.len() as i64,
                    in_workspace,
                ])?;
                let crate_id: i64 = tx.query_row(
                    "SELECT id FROM atlas_crate WHERE name = ?1",
                    [&name],
                    |r| r.get(0),
                )?;
                for dep in &parsed.deps {
                    let internal =
                        i64::from(dep.starts_with("nie-") || dep.starts_with("aphrody-"));
                    dep_stmt.execute(params![crate_id, dep, internal])?;
                }
                text.execute(params![
                    name,
                    format!(
                        "{name} {tier} {} {}",
                        rel_dir,
                        parsed.description.clone().unwrap_or_default()
                    ),
                    rel_dir
                ])?;
                count += 1;
            }
        }
        tx.commit()?;
        self.refresh_fts()?;
        Ok(count)
    }

    // ---------------------------------------------------------------- docs

    /// Index every Markdown document already seen by [`Atlas::scan`], plus the repository
    /// root documents, with their sections and the machine references they claim.
    pub fn import_docs(&mut self, root: &Path) -> Result<usize> {
        let mut paths: Vec<String> = self
            .conn
            .prepare("SELECT path FROM atlas_artifact WHERE kind = 'md' ORDER BY path")?
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<std::result::Result<_, _>>()?;
        if let Ok(entries) = std::fs::read_dir(root) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) == Some("md")
                    && let Some(name) = path.file_name().and_then(|n| n.to_str())
                {
                    paths.push(name.to_string());
                }
            }
        }
        paths.sort();
        paths.dedup();

        let tx = self.conn.transaction()?;
        let mut count = 0usize;
        {
            let mut doc_stmt = tx.prepare(
                "INSERT INTO atlas_doc(path, artifact_id, title, words, lines, headings,
                                       code_blocks, re_score, mtime)
                 VALUES(?1, (SELECT id FROM atlas_artifact WHERE path = ?1), ?2,?3,?4,?5,?6,?7,?8)
                 ON CONFLICT(path) DO UPDATE SET
                     artifact_id = excluded.artifact_id, title = excluded.title,
                     words = excluded.words, lines = excluded.lines, headings = excluded.headings,
                     code_blocks = excluded.code_blocks, re_score = excluded.re_score,
                     mtime = excluded.mtime",
            )?;
            let mut sec_stmt = tx.prepare(
                "INSERT INTO atlas_doc_section(doc_id, level, title, line) VALUES(?1,?2,?3,?4)
                 ON CONFLICT(doc_id, line) DO UPDATE SET
                     level = excluded.level, title = excluded.title",
            )?;
            let mut ref_stmt = tx.prepare(
                "INSERT OR IGNORE INTO atlas_doc_ref(doc_id, line, kind, value)
                 VALUES(?1,?2,?3,?4)",
            )?;
            let mut text = tx.prepare(
                "INSERT INTO atlas_text(kind, key, body, ref) VALUES('doc', ?1, ?2, ?3)
                 ON CONFLICT(kind, key) DO UPDATE SET body = excluded.body, ref = excluded.ref",
            )?;

            for rel in &paths {
                let abs = root.join(rel);
                let Ok(raw) = std::fs::read_to_string(&abs) else {
                    continue;
                };
                let doc = parse_markdown(&raw);
                let mtime = std::fs::metadata(&abs)
                    .and_then(|m| m.modified())
                    .ok()
                    .and_then(|m| m.duration_since(UNIX_EPOCH).ok())
                    .map_or(0, |d| d.as_secs()) as i64;

                doc_stmt.execute(params![
                    rel,
                    doc.title,
                    doc.words as i64,
                    doc.lines as i64,
                    doc.sections.len() as i64,
                    doc.code_blocks as i64,
                    doc.re_score as i64,
                    mtime,
                ])?;
                let doc_id: i64 =
                    tx.query_row("SELECT id FROM atlas_doc WHERE path = ?1", [rel], |r| {
                        r.get(0)
                    })?;
                for (level, title, line) in &doc.sections {
                    sec_stmt.execute(params![doc_id, *level as i64, title, *line as i64])?;
                }
                for (line, kind, value) in &doc.refs {
                    ref_stmt.execute(params![doc_id, *line as i64, kind, value])?;
                }
                let headings = doc
                    .sections
                    .iter()
                    .map(|(_, t, _)| t.as_str())
                    .collect::<Vec<_>>()
                    .join(" · ");
                text.execute(params![
                    rel,
                    format!("{} {headings}", doc.title.clone().unwrap_or_default()),
                    rel
                ])?;
                count += 1;
            }
        }
        tx.commit()?;
        self.refresh_fts()?;
        Ok(count)
    }

    // ------------------------------------------------------------------ kb

    /// Import the digest of the knowledge base: table inventory, named symbols, forge units.
    ///
    /// The 19 GB database is attached read-only and never written. Row counts are bounded by
    /// `row_cap` so a single `COUNT(*)` cannot walk a multi-million-row table for minutes;
    /// a table hitting the cap is recorded as `table-capped`.
    pub fn import_kb(&mut self, kb_path: &Path, row_cap: i64) -> Result<KbDigest> {
        let uri = format!(
            "file:{}?mode=ro",
            kb_path.to_string_lossy().replace('?', "%3f")
        );
        self.conn
            .execute_batch(&format!("ATTACH DATABASE '{uri}' AS kb"))?;
        let digest = self.import_kb_attached(row_cap);
        let _ = self.conn.execute_batch("DETACH DATABASE kb");
        let digest = digest?;
        self.set_meta("kb_path", &kb_path.to_string_lossy())?;
        self.refresh_fts()?;
        Ok(digest)
    }

    fn import_kb_attached(&mut self, row_cap: i64) -> Result<KbDigest> {
        let mut digest = KbDigest::default();
        let objects: Vec<(String, String)> = self
            .conn
            .prepare(
                "SELECT name, type FROM kb.sqlite_master
                 WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
            )?
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<std::result::Result<_, _>>()?;

        for (name, ty) in &objects {
            let sql = format!("SELECT COUNT(*) FROM (SELECT 1 FROM kb.\"{name}\" LIMIT {row_cap})");
            let Ok(rows) = self.conn.query_row(&sql, [], |r| r.get::<_, i64>(0)) else {
                continue;
            };
            let capped = rows >= row_cap;
            if capped {
                digest.capped += 1;
            }
            let kind = if capped {
                format!("{ty}-capped")
            } else {
                ty.clone()
            };
            self.conn.execute(
                "INSERT INTO atlas_kb_table(name, n_rows, kind, counted_at)
                 VALUES(?1,?2,?3, datetime('now'))
                 ON CONFLICT(name) DO UPDATE SET
                     n_rows = excluded.n_rows, kind = excluded.kind,
                     counted_at = excluded.counted_at",
                params![name, rows, kind],
            )?;
            digest.tables += 1;
            digest.rows += rows;
        }

        digest.symbols = self.copy_symbols()?;
        digest.units = self.copy_units()?;
        digest.coverage = self.kb_coverage()?;
        Ok(digest)
    }

    /// Read the last `coverage` row of the attached knowledge base.
    fn kb_coverage(&self) -> Result<Option<KbCoverage>> {
        Ok(self
            .conn
            .query_row(
                "SELECT total_funcs, named, classified, pct FROM kb.coverage
                 ORDER BY id DESC LIMIT 1",
                [],
                |r| {
                    Ok(KbCoverage {
                        total: r.get(0)?,
                        named: r.get(1)?,
                        classified: r.get(2)?,
                        pct: r.get(3)?,
                    })
                },
            )
            .optional()?)
    }

    /// Copy the named functions of the knowledge base (the part agents query by name).
    fn copy_symbols(&mut self) -> Result<usize> {
        let cols = self.kb_columns("function")?;
        if !cols.contains("vaddr") || !cols.contains("name") {
            return Ok(0);
        }
        let size = if cols.contains("size") { "size" } else { "0" };
        let src = if cols.contains("name_source") {
            "name_source"
        } else {
            "NULL"
        };
        let subsystem = if cols.contains("subsystem") {
            "subsystem"
        } else {
            "NULL"
        };
        let confidence = if cols.contains("confidence") {
            "confidence"
        } else {
            "0.0"
        };
        let sql = format!(
            "INSERT INTO atlas_symbol(vaddr, name, size, name_source, subsystem, confidence)
             SELECT vaddr, name, {size}, {src}, {subsystem}, {confidence}
             FROM kb.function WHERE name IS NOT NULL AND name <> ''
             ON CONFLICT(vaddr) DO UPDATE SET
                 name = excluded.name, size = excluded.size,
                 name_source = excluded.name_source, subsystem = excluded.subsystem,
                 confidence = excluded.confidence"
        );
        let n = self.conn.execute(&sql, [])?;
        self.conn.execute_batch(
            "INSERT INTO atlas_text(kind, key, body, ref)
             SELECT 'symbol', name, name || ' ' || COALESCE(subsystem,'') || ' ' ||
                    printf('0x%x', vaddr), printf('0x%x', vaddr)
             FROM atlas_symbol
             WHERE true
             ON CONFLICT(kind, key) DO UPDATE SET body = excluded.body, ref = excluded.ref",
        )?;
        Ok(n)
    }

    /// Copy the forge unit registry of the knowledge base (written by `nie-forge kb`).
    ///
    /// The column holding the state is `statut` on this schema; `status` is accepted too so
    /// a renamed column does not silently empty the import.
    fn copy_units(&mut self) -> Result<usize> {
        let cols = self.kb_columns("forge_unit")?;
        if !cols.contains("file_off") {
            return Ok(0);
        }
        let statut = if cols.contains("statut") {
            "statut"
        } else if cols.contains("status") {
            "status"
        } else {
            "'raw'"
        };
        let sql = format!(
            "INSERT INTO atlas_unit(file_off, vaddr, size, kind, status, origin)
             SELECT file_off, vaddr, size, kind, {statut}, 'kb.forge_unit' FROM kb.forge_unit
             WHERE true
             ON CONFLICT(file_off) DO UPDATE SET
                 vaddr = excluded.vaddr, size = excluded.size, kind = excluded.kind,
                 status = excluded.status, origin = excluded.origin"
        );
        Ok(self.conn.execute(&sql, [])?)
    }

    /// Column names of a table of the attached knowledge base, read from its DDL.
    ///
    /// `pragma_table_info` does not accept a schema-qualified name on every SQLite build;
    /// `kb.sqlite_master` always answers, whatever the attached schema.
    fn kb_columns(&self, table: &str) -> Result<BTreeSet<String>> {
        let ddl: Option<String> = self
            .conn
            .query_row(
                "SELECT sql FROM kb.sqlite_master WHERE name = ?1 AND type = 'table'",
                [table],
                |r| r.get(0),
            )
            .optional()?;
        Ok(ddl.map(|sql| columns_from_ddl(&sql)).unwrap_or_default())
    }

    // --------------------------------------------------------------- forge

    /// Import the forge state: the unit cover, the lifted assembly source, and the
    /// registry of functions whose compiled object reproduces the reference bytes.
    ///
    /// The knowledge-base table `forge_unit` is only written by `nie-forge kb`; when it is
    /// empty (it is, on this machine) the cover file is the real source, so the atlas reads
    /// it directly. Paths are resolved with their historical fallbacks: the CLI default
    /// (`forge/registry.json`) and the path actually written today (`data/forge/registry.json`)
    /// have diverged.
    pub fn import_forge(&mut self, root: &Path) -> Result<ForgeImport> {
        let mut out = ForgeImport::default();
        let cover = first_existing(root, &["var/forge/cover.json", "data/forge/cover.json"]);
        let lifted = first_existing(root, &["forge/asm/lifted.s", "data/forge/asm/lifted.s"]);
        let registry = first_existing(
            root,
            &["data/forge/registry.json", "forge/registry.json"],
        );

        if let Some(path) = cover {
            let file = std::fs::File::open(&path).map_err(|e| IndexError::Other(e.to_string()))?;
            let cover: CoverFile = serde_json::from_reader(std::io::BufReader::new(file))?;
            out.cover_bytes = cover.total_len;
            let tx = self.conn.transaction()?;
            {
                let mut stmt = tx.prepare(
                    "INSERT INTO atlas_unit(file_off, vaddr, size, name, kind, section, origin)
                     VALUES(?1,?2,?3,?4,?5,?6,'forge/cover.json')
                     ON CONFLICT(file_off) DO UPDATE SET
                         vaddr = excluded.vaddr, size = excluded.size, name = excluded.name,
                         kind = excluded.kind, section = excluded.section,
                         origin = excluded.origin",
                )?;
                for unit in &cover.units {
                    stmt.execute(params![
                        unit.file_off,
                        unit.va,
                        unit.len,
                        unit.id,
                        unit.kind,
                        unit.section
                    ])?;
                    out.units += 1;
                }
            }
            tx.commit()?;
            self.set_meta("forge_cover_sha256", &cover.sha256)?;
        }

        if let Some(path) = lifted {
            let body =
                std::fs::read_to_string(&path).map_err(|e| IndexError::Other(e.to_string()))?;
            let rel = relative(root, &path);
            let tx = self.conn.transaction()?;
            {
                let mut stmt = tx.prepare(
                    "UPDATE atlas_unit SET lang = 'asm', status = 'lifted', source_path = ?2
                     WHERE vaddr = ?1",
                )?;
                for line in body.lines() {
                    let Some((addr, _)) = line.split_once(':') else {
                        continue;
                    };
                    let Some(hex) = addr.trim().strip_prefix("0x") else {
                        continue;
                    };
                    let Ok(vaddr) = i64::from_str_radix(hex, 16) else {
                        continue;
                    };
                    out.lifted += stmt.execute(params![vaddr, rel])?;
                }
            }
            tx.commit()?;
        }

        if let Some(path) = registry {
            let file = std::fs::File::open(&path).map_err(|e| IndexError::Other(e.to_string()))?;
            let registry: RegistryFile = serde_json::from_reader(std::io::BufReader::new(file))?;
            let tx = self.conn.transaction()?;
            {
                let mut stmt = tx.prepare(
                    "UPDATE atlas_unit
                     SET lang = ?2, status = ?3, source_path = ?4, name = COALESCE(?5, name),
                         byte_exact = ?6
                     WHERE vaddr = ?1",
                )?;
                for entry in &registry.entries {
                    let Some(vaddr) = parse_hex(&entry.va) else {
                        continue;
                    };
                    let lang = if entry.rust.is_some() {
                        "rust"
                    } else if entry
                        .proof
                        .as_ref()
                        .and_then(|p| p.reference.as_deref())
                        .is_some_and(|r| r.ends_with(".c"))
                    {
                        "c"
                    } else {
                        "raw"
                    };
                    let exact = i64::from(entry.status.as_deref() == Some("bytes"));
                    let source = entry
                        .proof
                        .as_ref()
                        .and_then(|p| p.reference.clone())
                        .or_else(|| entry.object.clone());
                    let updated = stmt.execute(params![
                        vaddr,
                        lang,
                        entry.status.as_deref().unwrap_or("registered"),
                        source,
                        entry.symbol,
                        exact
                    ])?;
                    out.registered += updated;
                    if exact == 1 {
                        out.exact += updated;
                    }
                }
            }
            tx.commit()?;
        }
        Ok(out)
    }

    // ------------------------------------------------------------ binaries

    /// Record the binaries of the chain and whether the produced one matches the reference.
    ///
    /// `candidates` are `(path, role)` pairs; the reference is the one with role
    /// `reference`, and every other binary of the same size is compared byte for byte.
    pub fn import_binaries(&mut self, root: &Path, candidates: &[(String, String)]) -> Result<usize> {
        let mut reference: Option<(String, u64)> = None;
        let mut rows: Vec<(String, String, u64, Option<String>)> = Vec::new();
        for (rel, role) in candidates {
            let abs = root.join(rel);
            let Ok(meta) = std::fs::metadata(&abs) else {
                continue;
            };
            let sha = sha256_file(&abs).ok();
            if role == "reference" {
                reference = sha.clone().map(|s| (s, meta.len()));
            }
            rows.push((rel.clone(), role.clone(), meta.len(), sha));
        }
        let tx = self.conn.transaction()?;
        let mut count = 0usize;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO atlas_binary(path, role, bytes, sha256, identical, seen_at)
                 VALUES(?1,?2,?3,?4,?5, datetime('now'))
                 ON CONFLICT(path) DO UPDATE SET
                     role = excluded.role, bytes = excluded.bytes, sha256 = excluded.sha256,
                     identical = excluded.identical, seen_at = excluded.seen_at",
            )?;
            for (rel, role, bytes, sha) in &rows {
                let identical = match (&reference, sha) {
                    (Some((ref_sha, _)), Some(sha)) => Some(i64::from(ref_sha == sha)),
                    _ => None,
                };
                stmt.execute(params![rel, role, *bytes as i64, sha, identical])?;
                count += 1;
            }
        }
        tx.commit()?;
        Ok(count)
    }

    // --------------------------------------------------------------- tools

    /// Register runnable tools (CLI subcommands, binaries, MCP tools…).
    pub fn import_tools(&mut self, tools: &[ToolRecord]) -> Result<usize> {
        let tx = self.conn.transaction()?;
        let mut count = 0usize;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO atlas_tool(name, kind, path, summary) VALUES(?1,?2,?3,?4)
                 ON CONFLICT(kind, name) DO UPDATE SET
                     path = excluded.path, summary = excluded.summary",
            )?;
            let mut text = tx.prepare(
                "INSERT INTO atlas_text(kind, key, body, ref) VALUES('tool', ?1, ?2, ?3)
                 ON CONFLICT(kind, key) DO UPDATE SET body = excluded.body, ref = excluded.ref",
            )?;
            for tool in tools {
                stmt.execute(params![tool.name, tool.kind, tool.path, tool.summary])?;
                text.execute(params![
                    format!("{}:{}", tool.kind, tool.name),
                    format!(
                        "{} {} {}",
                        tool.name,
                        tool.kind,
                        tool.summary.clone().unwrap_or_default()
                    ),
                    tool.path
                ])?;
                count += 1;
            }
        }
        tx.commit()?;
        self.refresh_fts()?;
        Ok(count)
    }

    /// Register the tools the repository itself declares: `just` recipes and scripts.
    pub fn import_repo_tools(&mut self, root: &Path) -> Result<usize> {
        let mut tools = Vec::new();
        if let Ok(justfile) = std::fs::read_to_string(root.join("justfile")) {
            let mut pending: Option<String> = None;
            for line in justfile.lines() {
                if let Some(comment) = line.strip_prefix("# ") {
                    pending = Some(comment.trim().to_string());
                    continue;
                }
                if line.starts_with(char::is_whitespace) || line.trim().is_empty() {
                    if line.trim().is_empty() {
                        pending = None;
                    }
                    continue;
                }
                if let Some((head, _)) = line.split_once(':')
                    && !head.contains('=')
                    && !head.contains(' ')
                    && head.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
                    && !head.is_empty()
                {
                    tools.push(ToolRecord {
                        name: head.to_string(),
                        kind: "just".to_string(),
                        path: Some("justfile".to_string()),
                        summary: pending.clone(),
                    });
                }
                pending = None;
            }
        }
        for dir in ["scripts", "scripts/ops"] {
            let Ok(entries) = std::fs::read_dir(root.join(dir)) else {
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                let Some(ext) = path.extension().and_then(|e| e.to_str()) else {
                    continue;
                };
                if !matches!(ext, "sh" | "py" | "ts") {
                    continue;
                }
                let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                    continue;
                };
                let summary = std::fs::read_to_string(&path).ok().and_then(|s| {
                    s.lines()
                        .take(6)
                        .find(|l| l.starts_with("# ") && l.len() > 4)
                        .map(|l| l.trim_start_matches("# ").trim().to_string())
                });
                tools.push(ToolRecord {
                    name: name.to_string(),
                    kind: "script".to_string(),
                    path: Some(format!("{dir}/{name}")),
                    summary,
                });
            }
        }
        self.import_tools(&tools)
    }

    /// Import the 38 native menu screens and their paired assets from data/menu/screen-inventory.json
    pub fn import_menu(&mut self, root: &Path) -> Result<usize> {
        let inv_path = root.join("data/menu/screen-inventory.json");
        if !inv_path.exists() {
            return Ok(0);
        }
        let raw = std::fs::read_to_string(&inv_path)
            .map_err(|e| IndexError::Other(e.to_string()))?;
        let inventory: ScreenInventoryFile = serde_json::from_str(&raw)
            .map_err(|e| IndexError::Other(format!("invalid screen-inventory.json: {e}")))?;

        let tx = self.conn.transaction()?;
        let mut count = 0usize;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO atlas_menu_screen(capture_file, screen_id, name, setting_cfg, pairing_status,
                                              referenced_objbins, missing_objbins, has_lua, reference_image, updated_at)
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, datetime('now'))
                 ON CONFLICT(capture_file) DO UPDATE SET
                     screen_id = excluded.screen_id,
                     name = excluded.name,
                     setting_cfg = excluded.setting_cfg,
                     pairing_status = excluded.pairing_status,
                     referenced_objbins = excluded.referenced_objbins,
                     missing_objbins = excluded.missing_objbins,
                     has_lua = excluded.has_lua,
                     reference_image = excluded.reference_image,
                     updated_at = excluded.updated_at",
            )?;

            let mut text = tx.prepare(
                "INSERT INTO atlas_text(kind, key, body, ref) VALUES('menu_screen', ?1, ?2, ?3)
                 ON CONFLICT(kind, key) DO UPDATE SET body = excluded.body, ref = excluded.ref",
            )?;

            for entry in &inventory.entries {
                let screen_id = if entry.screen.is_empty() {
                    continue;
                } else {
                    &entry.screen
                };
                let recipe = entry.setting_recipes.first();
                let setting_cfg = recipe.map(|r| r.setting.as_str());
                let ref_objbins = recipe.map_or(0, |r| r.referenced_objbins);
                let miss_objbins = recipe.map_or(0, |r| r.missing_objbins);
                let has_lua = entry
                    .resource_counts
                    .as_ref()
                    .map_or(0, |r| if r.lua > 0 { 1 } else { 0 });

                stmt.execute(params![
                    entry.file,
                    screen_id,
                    screen_id,
                    setting_cfg,
                    entry.pairing_status,
                    ref_objbins as i64,
                    miss_objbins as i64,
                    has_lua,
                    entry.file,
                ])?;

                text.execute(params![
                    entry.file,
                    format!("menu screen {} {} {}", screen_id, entry.pairing_status, entry.file),
                    setting_cfg.unwrap_or(""),
                ])?;

                count += 1;
            }
        }
        tx.commit()?;
        self.set_meta("menu_screens", &count.to_string())?;
        self.refresh_fts()?;
        Ok(count)
    }

    // ------------------------------------------------------- metrics, gaps

    /// Record one measurement, with the command or table it came from.
    pub fn record_metric(
        &self,
        name: &str,
        value: f64,
        total: Option<f64>,
        source: &str,
        binary_sha: Option<&str>,
        note: Option<&str>,
    ) -> Result<()> {
        let pct = total.and_then(|t| (t > 0.0).then(|| value / t * 100.0));
        self.conn.execute(
            "INSERT INTO atlas_metric(name, value, total, pct, source, binary_sha, note)
             VALUES(?1,?2,?3,?4,?5,?6,?7)",
            params![name, value, total, pct, source, binary_sha, note],
        )?;
        Ok(())
    }

    /// Latest value recorded for a metric.
    pub fn latest_metric(&self, name: &str) -> Result<Option<MetricRow>> {
        Ok(self
            .conn
            .query_row(
                "SELECT value, total, pct, source FROM atlas_metric
                 WHERE name = ?1 ORDER BY id DESC LIMIT 1",
                [name],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .optional()?)
    }

    /// Upsert one gap of the road to 100 %.
    #[allow(clippy::too_many_arguments)]
    pub fn upsert_gap(
        &self,
        area: &str,
        metric: &str,
        current: f64,
        target: f64,
        unit: &str,
        weight: f64,
        action: Option<&str>,
        evidence: Option<&str>,
    ) -> Result<()> {
        let status = if current >= target { "done" } else { "open" };
        self.conn.execute(
            "INSERT INTO atlas_gap(area, metric, current, target, unit, weight, status, action, evidence, updated)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9, datetime('now'))
             ON CONFLICT(area) DO UPDATE SET
                 metric = excluded.metric, current = excluded.current, target = excluded.target,
                 unit = excluded.unit, weight = excluded.weight,
                 status = CASE WHEN atlas_gap.status = 'blocked' THEN 'blocked' ELSE excluded.status END,
                 action = COALESCE(excluded.action, atlas_gap.action),
                 evidence = excluded.evidence, updated = excluded.updated",
            params![area, metric, current, target, unit, weight, status, action, evidence],
        )?;
        Ok(())
    }

    /// Derive every gap from what the atlas actually measured.
    ///
    /// A gap is created only when its metric exists: an absent measurement leaves no row,
    /// rather than a zero that would read as "nothing done".
    pub fn refresh_gaps(&self) -> Result<usize> {
        let mut created = 0usize;

        // Forge identity: the produced binary against the reference, byte for byte.
        if let Some((identical, bytes)) = self
            .conn
            .query_row(
                "SELECT identical, bytes FROM atlas_binary WHERE role = 'produced'
                 ORDER BY seen_at DESC LIMIT 1",
                [],
                |r| Ok((r.get::<_, Option<i64>>(0)?, r.get::<_, i64>(1)?)),
            )
            .optional()?
        {
            let current = if identical == Some(1) { 100.0 } else { 0.0 };
            self.upsert_gap(
                "forge.identity",
                "dist/nie.exe byte-identical to the reference",
                current,
                100.0,
                "pct",
                10.0,
                Some("just forge"),
                Some(&format!("atlas_binary role=produced bytes={bytes}")),
            )?;
            created += 1;
        }

        // Forge units lifted to a byte-exact source.
        let (units, exact): (i64, i64) = self.conn.query_row(
            "SELECT COUNT(*), COALESCE(SUM(byte_exact), 0) FROM atlas_unit",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        if units > 0 {
            self.upsert_gap(
                "forge.units",
                "cover units whose registered source regenerates the exact bytes",
                exact as f64 / units as f64 * 100.0,
                100.0,
                "pct",
                4.0,
                Some("just forge-lift && just forge-cc"),
                Some(&format!("atlas_unit {exact}/{units}")),
            )?;
            created += 1;
        }

        // Knowledge-base coverage, as measured by the RE loop.
        for (metric, area, weight, action) in [
            (
                "forge.produced",
                "forge.produced",
                9.0,
                "just forge (split -> lift -> cc -> build)",
            ),
            ("forge.code_rust", "forge.code", 6.0, "nie-forge lift --max-len"),
            (
                "forge.lifted",
                "forge.lifted",
                5.0,
                "nie-forge lift (corps régénérables par nie-asm)",
            ),
            (
                "re.classified",
                "re.classified",
                6.0,
                "just re-rebuild",
            ),
            (
                "re.named",
                "re.named",
                5.0,
                // `just re-rebuild` et non les CLI brutes : docs/RE.md le dit, `disasm`
                // avant `rtti` rend un résultat incomplet SANS erreur.
                "just re-rebuild, puis niers seed-ui",
            ),
            ("proofs.ok", "proofs.uemu", 7.0, "just preuves"),
            ("pdata.text", "re.pdata-text", 4.0, "niers recover"),
            (
                // Mesuré par `cargo test -p nie-mcp --test re_real` : la part des fonctions
                // nommées de la KB qui commencent vraiment sur une racine `.pdata` du binaire
                // de référence. Un écart ici dit que la base décrit un AUTRE build.
                "re.pdata_corroboration",
                "re.anchoring",
                8.0,
                "ré-ancrer la KB sur le binaire de référence (just re-seed && just re-rebuild)",
            ),
        ] {
            if let Some((value, total, pct, source)) = self.latest_metric(metric)? {
                let current = pct.unwrap_or(value);
                self.upsert_gap(
                    area,
                    metric,
                    current,
                    100.0,
                    "pct",
                    weight,
                    Some(action),
                    Some(&format!(
                        "{source} value={value} total={}",
                        total.unwrap_or(0.0)
                    )),
                )?;
                created += 1;
            }
        }

        // Documentation actually anchored on the binary.
        let (docs, anchored): (i64, i64) = self.conn.query_row(
            "SELECT COUNT(*), COALESCE(SUM(CASE WHEN re_score > 0 THEN 1 ELSE 0 END), 0)
             FROM atlas_doc",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        if docs > 0 {
            self.upsert_gap(
                "docs.anchored",
                "documents carrying at least one verifiable machine reference",
                anchored as f64 / docs as f64 * 100.0,
                100.0,
                "pct",
                2.0,
                Some("niers atlas docs --orphans"),
                Some(&format!("atlas_doc {anchored}/{docs}")),
            )?;
            created += 1;
        }

        // Symbols ported to Rust: a named function whose name appears in a crate source.
        let (symbols, ported): (i64, i64) = self.conn.query_row(
            "SELECT COUNT(*), COALESCE(SUM(ported), 0) FROM atlas_symbol",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        if symbols > 0 && ported > 0 {
            self.upsert_gap(
                "port.symbols",
                "named symbols referenced by a Rust source of the workspace",
                ported as f64 / symbols as f64 * 100.0,
                100.0,
                "pct",
                3.0,
                Some("niers atlas link"),
                Some(&format!("atlas_symbol {ported}/{symbols}")),
            )?;
            created += 1;
        }

        // Menu screens from data/menu/ paired and verified.
        let (menu_screens, paired): (i64, i64) = self.conn.query_row(
            "SELECT COUNT(*), COALESCE(SUM(CASE WHEN pairing_status = 'resolved' THEN 1 ELSE 0 END), 0)
             FROM atlas_menu_screen",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        if menu_screens > 0 {
            self.upsert_gap(
                "menu.screens",
                "native menu screens indexed and paired with verified assets",
                paired as f64 / menu_screens as f64 * 100.0,
                100.0,
                "pct",
                5.0,
                Some("niers atlas menu"),
                Some(&format!("atlas_menu_screen {paired}/{menu_screens}")),
            )?;
            created += 1;
        }

        Ok(created)
    }

    /// Mark the symbols whose name appears verbatim in a Rust source of the workspace.
    ///
    /// This is the honest lower bound of "ported": a name quoted in a comment counts, an
    /// anonymous reimplementation does not. Matching is done on the identifier tokens of the
    /// sources, not on a substring search — `update` inside `CClass::update` must not make
    /// every method of the binary look ported, so a qualified name requires **all** of its
    /// segments to appear.
    pub fn link_ported_symbols(&mut self, root: &Path) -> Result<usize> {
        let names: Vec<(i64, String)> = self
            .conn
            .prepare("SELECT id, name FROM atlas_symbol")?
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<std::result::Result<_, _>>()?;
        if names.is_empty() {
            return Ok(0);
        }
        let mut tokens: HashSet<String> = HashSet::new();
        for tier in ["forge", "engine", "tools"] {
            collect_rust_tokens(&root.join("crates").join(tier), &mut tokens);
        }
        let mut hits = 0usize;
        let tx = self.conn.transaction()?;
        {
            let mut stmt = tx.prepare("UPDATE atlas_symbol SET ported = ?2 WHERE id = ?1")?;
            for (id, name) in &names {
                let ported = i64::from(name_is_ported(name, &tokens));
                if ported == 1 {
                    hits += 1;
                }
                stmt.execute(params![id, ported])?;
            }
        }
        tx.commit()?;
        Ok(hits)
    }

    /// Gaps ranked by remaining work × weight.
    pub fn gaps(&self, limit: usize) -> Result<Vec<Gap>> {
        let mut stmt = self.conn.prepare(
            "SELECT area, metric, current, target, unit, weight, status, action, evidence,
                    remaining, score
             FROM v_atlas_gap_ranked LIMIT ?1",
        )?;
        let rows = stmt
            .query_map([limit as i64], |r| {
                Ok(Gap {
                    area: r.get(0)?,
                    metric: r.get(1)?,
                    current: r.get(2)?,
                    target: r.get(3)?,
                    unit: r.get(4)?,
                    weight: r.get(5)?,
                    status: r.get(6)?,
                    action: r.get(7)?,
                    evidence: r.get(8)?,
                    remaining: r.get(9)?,
                    score: r.get(10)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// The next thing to work on: the highest-scoring open gap.
    pub fn next_gap(&self) -> Result<Option<Gap>> {
        Ok(self
            .gaps(8)?
            .into_iter()
            .find(|g| g.status == "open" || g.status == "running"))
    }

    /// Read every indexed native menu screen and its asset pairing.
    pub fn menu_screens(&self) -> Result<Vec<MenuScreenRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT capture_file, screen_id, name, setting_cfg, pairing_status,
                    referenced_objbins, missing_objbins, has_lua, reference_image
             FROM atlas_menu_screen ORDER BY screen_id, capture_file",
        )?;
        let rows = stmt
            .query_map([], |r| {
                Ok(MenuScreenRecord {
                    capture_file: r.get(0)?,
                    screen_id: r.get(1)?,
                    name: r.get(2)?,
                    setting_cfg: r.get(3)?,
                    pairing_status: r.get(4)?,
                    referenced_objbins: r.get(5)?,
                    missing_objbins: r.get(6)?,
                    has_lua: r.get::<_, i64>(7)? != 0,
                    reference_image: r.get(8)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Record one step of the autonomous loop.
    pub fn record_run(
        &self,
        step: &str,
        area: Option<&str>,
        ok: bool,
        duration_ms: i64,
        metrics: Option<&str>,
        log: Option<&str>,
    ) -> Result<i64> {
        self.conn.execute(
            "INSERT INTO atlas_run(step, area, ok, duration_ms, metrics, log)
             VALUES(?1,?2,?3,?4,?5,?6)",
            params![step, area, i64::from(ok), duration_ms, metrics, log],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Aggregate status of the atlas.
    pub fn status(&self) -> Result<Status> {
        Ok(self.conn.query_row(
            "SELECT artifacts, artifact_bytes, crates, docs, doc_refs, symbols, units,
                    units_exact, tools, kb_tables, kb_rows, menu_screens, gaps_open, runs
             FROM v_atlas_status",
            [],
            |r| {
                Ok(Status {
                    artifacts: r.get(0)?,
                    artifact_bytes: r.get(1)?,
                    crates: r.get(2)?,
                    docs: r.get(3)?,
                    doc_refs: r.get(4)?,
                    symbols: r.get(5)?,
                    units: r.get(6)?,
                    units_exact: r.get(7)?,
                    tools: r.get(8)?,
                    kb_tables: r.get(9)?,
                    kb_rows: r.get(10)?,
                    menu_screens: r.get(11)?,
                    gaps_open: r.get(12)?,
                    runs: r.get(13)?,
                })
            },
        )?)
    }

    /// Search every indexed surface at once.
    pub fn search(&self, query: &str, limit: usize) -> Result<Vec<Hit>> {
        let like = format!("%{query}%");
        let mut stmt = self.conn.prepare(
            "SELECT kind, key, body, ref FROM atlas_text
             WHERE key LIKE ?1 OR body LIKE ?1
             ORDER BY CASE WHEN key = ?2 THEN 0
                           WHEN key LIKE ?3 THEN 1
                           WHEN kind = 'symbol' THEN 2
                           WHEN kind = 'doc' THEN 3
                           ELSE 4 END,
                      length(key)
             LIMIT ?4",
        )?;
        let rows = stmt
            .query_map(
                params![like, query, format!("{query}%"), limit as i64],
                |r| {
                    Ok(Hit {
                        kind: r.get(0)?,
                        key: r.get(1)?,
                        body: r.get(2)?,
                        reference: r.get(3)?,
                    })
                },
            )?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Rebuild the FTS mirror when the SQLite build supports it (no-op otherwise).
    fn refresh_fts(&self) -> Result<()> {
        if !self.fts {
            return Ok(());
        }
        self.conn.execute_batch(
            "DELETE FROM atlas_fts;
             INSERT INTO atlas_fts(kind, key, body, ref)
             SELECT kind, key, body, ref FROM atlas_text;",
        )?;
        Ok(())
    }

    /// Mirror the hot part of the atlas into Redis so any agent or service reads it
    /// without opening SQLite: status, ranked gaps, tools, symbol → address.
    pub fn sync_redis(&self, url: &str, prefix: &str) -> Result<usize> {
        use redis::Commands;
        let client = redis::Client::open(url)?;
        let mut conn = client.get_connection()?;
        let mut written = 0usize;

        let status = self.status()?;
        let payload = serde_json::to_string(&status)?;
        let _: () = conn.set(format!("{prefix}:status"), payload)?;
        written += 1;

        let gaps = self.gaps(64)?;
        let _: () = conn.set(format!("{prefix}:gaps"), serde_json::to_string(&gaps)?)?;
        written += 1;
        for gap in &gaps {
            let _: () = conn.set(
                format!("{prefix}:gap:{}", gap.area),
                serde_json::to_string(gap)?,
            )?;
            written += 1;
        }

        let mut stmt = self
            .conn
            .prepare("SELECT name, vaddr FROM atlas_symbol ORDER BY name")?;
        let mut rows = stmt.query([])?;
        let mut pipe = redis::pipe();
        let mut pending = 0usize;
        while let Some(row) = rows.next()? {
            let name: String = row.get(0)?;
            let vaddr: i64 = row.get(1)?;
            // Le nom peut se répéter (même symbole à plusieurs adresses) : la clé inverse,
            // elle, est unique, et c'est elle qui répond « qu'y a-t-il en 0x… ».
            pipe.set(format!("{prefix}:sym:{name}"), format!("0x{vaddr:x}"))
                .ignore();
            pipe.set(format!("{prefix}:addr:0x{vaddr:x}"), &name).ignore();
            pending += 2;
            written += 2;
            if pending >= 2000 {
                let _: () = pipe.query(&mut conn)?;
                pipe = redis::pipe();
                pending = 0;
            }
        }
        if pending > 0 {
            let _: () = pipe.query(&mut conn)?;
        }

        let mut stmt = self
            .conn
            .prepare("SELECT kind, name, COALESCE(path, ''), COALESCE(summary, '') FROM atlas_tool")?;
        let mut rows = stmt.query([])?;
        let mut pipe = redis::pipe();
        while let Some(row) = rows.next()? {
            let kind: String = row.get(0)?;
            let name: String = row.get(1)?;
            let path: String = row.get(2)?;
            let summary: String = row.get(3)?;
            pipe.set(
                format!("{prefix}:tool:{kind}:{name}"),
                format!("{path}\t{summary}"),
            )
            .ignore();
            written += 1;
        }
        let _: () = pipe.query(&mut conn)?;

        let stamp = now_secs().to_string();
        let _: () = conn.set(format!("{prefix}:generated_at"), stamp)?;
        written += 1;
        Ok(written)
    }
}

// ------------------------------------------------------------------ helpers

/// `data/menu/screen-inventory.json` — the 38 native screens and their paired assets.
#[derive(Debug, Default, serde::Deserialize)]
struct ScreenInventoryFile {
    #[serde(default)]
    entries: Vec<ScreenInventoryEntry>,
}

#[derive(Debug, Default, serde::Deserialize)]
struct ScreenInventoryEntry {
    #[serde(default)]
    file: String,
    #[serde(default)]
    screen: String,
    #[serde(default)]
    pairing_status: String,
    #[serde(default)]
    setting_recipes: Vec<SettingRecipe>,
    #[serde(default)]
    resource_counts: Option<ResourceCounts>,
}

#[derive(Debug, Default, serde::Deserialize)]
struct SettingRecipe {
    #[serde(default)]
    setting: String,
    #[serde(default)]
    referenced_objbins: usize,
    #[serde(default)]
    missing_objbins: usize,
}

#[derive(Debug, Default, serde::Deserialize)]
struct ResourceCounts {
    #[serde(default)]
    lua: usize,
}

/// `var/forge/cover.json` — the total cover of the reference binary, written by
/// `nie-forge split`.
#[derive(Debug, serde::Deserialize)]
struct CoverFile {
    total_len: i64,
    sha256: String,
    units: Vec<CoverUnit>,
}

#[derive(Debug, serde::Deserialize)]
struct CoverUnit {
    id: String,
    kind: String,
    section: Option<String>,
    file_off: i64,
    len: i64,
    va: Option<i64>,
}

/// `data/forge/registry.json` — the functions whose compiled object was proven to
/// reproduce the reference bytes.
#[derive(Debug, serde::Deserialize)]
struct RegistryFile {
    #[serde(default)]
    entries: Vec<RegistryEntry>,
}

#[derive(Debug, serde::Deserialize)]
struct RegistryEntry {
    va: String,
    #[serde(default)]
    rust: Option<String>,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    proof: Option<RegistryProof>,
    #[serde(default)]
    object: Option<String>,
    #[serde(default)]
    symbol: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
struct RegistryProof {
    #[serde(default)]
    reference: Option<String>,
}

/// First path of `candidates` that exists under `root`.
fn first_existing(root: &Path, candidates: &[&str]) -> Option<PathBuf> {
    candidates
        .iter()
        .map(|c| root.join(c))
        .find(|p| p.is_file())
}

/// Path relative to the repository root, with forward slashes.
fn relative(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

/// Parse `0x14004d750` (or a decimal address) into an integer.
fn parse_hex(raw: &str) -> Option<i64> {
    let raw = raw.trim();
    raw.strip_prefix("0x")
        .or_else(|| raw.strip_prefix("0X"))
        .map_or_else(|| raw.parse::<i64>().ok(), |hex| i64::from_str_radix(hex, 16).ok())
}


fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

/// SHA-256 of a file, streamed.
pub fn sha256_file(path: &Path) -> std::io::Result<String> {
    use std::io::Read;
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 16];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex_lower(&hasher.finalize()))
}

fn hex_lower(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push_str(&format!("{b:02x}"));
    }
    out
}

/// File kind, from the extension and the path.
#[must_use]
pub fn classify_kind(rel: &str, ext: Option<&str>) -> &'static str {
    match ext {
        Some("s" | "asm" | "S") => "asm",
        Some("c") => "c",
        Some("h" | "hpp" | "hxx") => "h",
        Some("cpp" | "cc" | "cxx") => "cpp",
        Some("rs") => "rust",
        Some("md") => "md",
        Some("json") => "json",
        Some("ndjson" | "jsonl") => "ndjson",
        Some("sql") => "sql",
        Some("exe" | "dll") => "exe",
        Some("sqlite" | "db") => "sqlite",
        Some("py") => "python",
        Some("sh" | "bash") => "shell",
        Some("ps1") => "powershell",
        Some("ts" | "tsx" | "js" | "mjs") => "ts",
        Some("toml" | "yaml" | "yml" | "cfg" | "conf") => "config",
        Some("lua") => "lua",
        Some("csv" | "tsv") => "table",
        Some("png" | "jpg" | "jpeg" | "gif" | "webp" | "dds") => "image",
        Some("bin" | "cpk" | "g4tx" | "g4mg" | "g4mt" | "g4sk") => "bin",
        _ => {
            if rel.ends_with("justfile") {
                "config"
            } else {
                "other"
            }
        }
    }
}

/// Zone of the repository a path belongs to.
#[must_use]
pub fn classify_zone(rel: &str, kind: &str) -> &'static str {
    if rel.starts_with("crates/") {
        return if kind == "md" { "doc" } else { "crate" };
    }
    if rel.starts_with("docs/") || (kind == "md" && !rel.contains('/')) {
        return "doc";
    }
    if rel.starts_with("forge/") || rel.starts_with("data/forge") || rel.starts_with("src/decomp") {
        return "forge";
    }
    if rel.starts_with("export") || rel.starts_with("data/export") {
        return "export";
    }
    if rel.starts_with("data/re/") {
        return "re-data";
    }
    if rel.starts_with("scripts/") || rel.starts_with("python/") {
        return "script";
    }
    if rel.starts_with("dist/") || kind == "exe" {
        return "binary";
    }
    if kind == "sqlite" {
        return "db";
    }
    if rel.starts_with("refs/") {
        return "reference";
    }
    if rel.starts_with("deploy/") {
        return "deploy";
    }
    match kind {
        "md" => "doc",
        _ => "other",
    }
}

fn is_text(kind: &str) -> bool {
    matches!(
        kind,
        "asm"
            | "c"
            | "h"
            | "cpp"
            | "rust"
            | "md"
            | "json"
            | "ndjson"
            | "sql"
            | "python"
            | "shell"
            | "powershell"
            | "ts"
            | "config"
            | "lua"
            | "table"
    )
}

/// Minimal fields read out of a `Cargo.toml`.
#[derive(Debug, Default)]
struct Manifest {
    name: Option<String>,
    version: Option<String>,
    description: Option<String>,
    deps: Vec<String>,
}

/// Read `name`, `version`, `description` and the dependency names of a manifest.
///
/// A hand-rolled reader rather than a TOML dependency: the fields needed are all
/// top-of-table scalars and dependency keys, and the workspace has no `toml` crate.
fn parse_manifest(raw: &str) -> Manifest {
    let mut out = Manifest::default();
    let mut section = String::new();
    for line in raw.lines() {
        let line = line.trim();
        if line.starts_with('[') && line.ends_with(']') {
            section = line.trim_matches(['[', ']']).to_string();
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim().trim_matches('"');
        let value = value.trim();
        match section.as_str() {
            "package" => {
                let scalar = value.trim_matches(['"', '\'']).to_string();
                match key {
                    "name" => out.name = Some(scalar),
                    "version" => out.version = Some(scalar),
                    "description" => out.description = Some(scalar),
                    _ => {}
                }
            }
            "dependencies" | "dev-dependencies" | "build-dependencies"
                if !key.is_empty() && !key.starts_with('#') =>
            {
                out.deps.push(key.to_string());
            }
            _ => {}
        }
    }
    if out.version.as_deref() == Some("workspace") || out.version.is_none() {
        out.version = Some("workspace".to_string());
    }
    out
}

/// Aggregate counters over a crate's `src/`.
#[derive(Debug, Default, Clone, Copy)]
struct SourceStats {
    files: usize,
    loc: usize,
    test_fns: usize,
    unsafe_hits: usize,
    extern_todo: usize,
}

fn source_stats(src: &Path) -> SourceStats {
    let mut stats = SourceStats::default();
    let Ok(walker) = std::fs::read_dir(src) else {
        return stats;
    };
    let mut stack: Vec<PathBuf> = walker.flatten().map(|e| e.path()).collect();
    while let Some(path) = stack.pop() {
        if path.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&path) {
                stack.extend(entries.flatten().map(|e| e.path()));
            }
            continue;
        }
        if path.extension().and_then(|e| e.to_str()) != Some("rs") {
            continue;
        }
        let Ok(body) = std::fs::read_to_string(&path) else {
            continue;
        };
        stats.files += 1;
        stats.loc += body.lines().count();
        stats.test_fns += body.matches("#[test]").count() + body.matches("#[tokio::test]").count();
        stats.unsafe_hits += body.matches("unsafe ").count();
        stats.extern_todo += body.matches("// EXTERN:").count() + body.matches("todo!()").count();
    }
    stats
}

/// Collect the identifier tokens (length ≥ 4) of every Rust source under `dir`.
fn collect_rust_tokens(dir: &Path, out: &mut HashSet<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut stack: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();
    while let Some(path) = stack.pop() {
        if path.is_dir() {
            if path.file_name().and_then(|n| n.to_str()) == Some("target") {
                continue;
            }
            if let Ok(entries) = std::fs::read_dir(&path) {
                stack.extend(entries.flatten().map(|e| e.path()));
            }
            continue;
        }
        if path.extension().and_then(|e| e.to_str()) == Some("rs")
            && let Ok(body) = std::fs::read_to_string(&path)
        {
            for token in body.split(|c: char| !c.is_ascii_alphanumeric() && c != '_') {
                if token.len() >= 4 {
                    out.insert(token.to_string());
                }
            }
        }
    }
}

/// A symbol counts as ported when every meaningful segment of its name is an identifier of
/// the workspace: `CGameCameraCtrl::Update` needs both `CGameCameraCtrl` and `Update`.
fn name_is_ported(name: &str, tokens: &HashSet<String>) -> bool {
    let segments: Vec<&str> = name
        .split("::")
        .flat_map(|s| s.split(['<', '>', '(', ')', ' ', ',', '*', '&']))
        .map(str::trim)
        .filter(|s| s.len() >= 4)
        .collect();
    if segments.is_empty() {
        return false;
    }
    segments.iter().all(|s| tokens.contains(*s))
}

/// Parsed Markdown document.
#[derive(Debug, Default)]
struct ParsedDoc {
    title: Option<String>,
    words: usize,
    lines: usize,
    code_blocks: usize,
    re_score: usize,
    sections: Vec<(usize, String, usize)>,
    refs: Vec<(usize, &'static str, String)>,
}

/// Maximum references kept per document (a generated report can carry thousands).
const MAX_DOC_REFS: usize = 4000;

fn parse_markdown(raw: &str) -> ParsedDoc {
    let mut doc = ParsedDoc::default();
    let mut in_code = false;
    for (idx, line) in raw.lines().enumerate() {
        let line_no = idx + 1;
        doc.lines += 1;
        if line.trim_start().starts_with("```") {
            in_code = !in_code;
            if in_code {
                doc.code_blocks += 1;
            }
            continue;
        }
        doc.words += line.split_whitespace().count();
        if !in_code && let Some(level) = heading_level(line) {
            let title = line.trim_start_matches('#').trim().to_string();
            if doc.title.is_none() && level == 1 {
                doc.title = Some(title.clone());
            }
            doc.sections.push((level, title, line_no));
        }
        if doc.refs.len() < MAX_DOC_REFS {
            extract_refs(line, line_no, &mut doc.refs);
        }
    }
    if doc.title.is_none() {
        doc.title = doc.sections.first().map(|(_, t, _)| t.clone());
    }
    doc.re_score = doc
        .refs
        .iter()
        .filter(|(_, kind, _)| matches!(*kind, "vaddr" | "func" | "sha256" | "table"))
        .count();
    doc
}

fn heading_level(line: &str) -> Option<usize> {
    let hashes = line.chars().take_while(|c| *c == '#').count();
    (1..=6).contains(&hashes).then_some(hashes)
}

/// Pull the machine references out of one line: virtual addresses, `FUN_` names,
/// SHA-256 digests, knowledge-base tables, crates, commands and file paths.
fn extract_refs(line: &str, line_no: usize, out: &mut Vec<(usize, &'static str, String)>) {
    let bytes = line.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        // 0x… virtual address or constant.
        if bytes[i] == b'0' && i + 1 < bytes.len() && (bytes[i + 1] | 0x20) == b'x' {
            let start = i;
            let mut j = i + 2;
            while j < bytes.len() && (bytes[j].is_ascii_hexdigit() || bytes[j] == b'_') {
                j += 1;
            }
            let token: String = line[start..j].chars().filter(|c| *c != '_').collect();
            if token.len() >= 8 {
                out.push((line_no, "vaddr", token.to_ascii_lowercase()));
            }
            i = j;
            continue;
        }
        if !bytes[i].is_ascii_alphanumeric() && bytes[i] != b'_' && bytes[i] != b'/' {
            i += 1;
            continue;
        }
        let start = i;
        while i < bytes.len()
            && (bytes[i].is_ascii_alphanumeric()
                || matches!(bytes[i], b'_' | b'-' | b'/' | b'.' | b':'))
        {
            i += 1;
        }
        let token = &line[start..i];
        if token.len() < 3 {
            continue;
        }
        let trimmed = token.trim_matches(['.', ':', '/', '-']);
        if trimmed.len() < 3 {
            continue;
        }
        if trimmed.starts_with("FUN_") || trimmed.starts_with("LAB_") {
            out.push((line_no, "func", trimmed.to_string()));
        } else if trimmed.len() == 64 && trimmed.bytes().all(|b| b.is_ascii_hexdigit()) {
            out.push((line_no, "sha256", trimmed.to_ascii_lowercase()));
        } else if trimmed.starts_with("nie-") || trimmed.starts_with("aphrody-") {
            out.push((line_no, "crate", trimmed.to_string()));
        } else if trimmed.contains('/') && trimmed.contains('.') {
            out.push((line_no, "path", trimmed.to_string()));
            // `crates/forge/nie-re/src/lib.rs` names a crate as much as `nie-re` does.
            for segment in trimmed.split('/') {
                if segment.starts_with("nie-") || segment.starts_with("aphrody-") {
                    out.push((line_no, "crate", segment.to_string()));
                }
            }
        } else if matches!(
            trimmed,
            "function"
                | "xref"
                | "coverage"
                | "rtti_class"
                | "func_str_ref"
                | "forge_unit"
                | "pdata_func"
                | "hash_name"
                | "symbol"
                | "anchor"
        ) {
            out.push((line_no, "table", trimmed.to_string()));
        }
    }
    for keyword in ["niers ", "just ", "cargo "] {
        let mut from = 0usize;
        while let Some(pos) = line[from..].find(keyword) {
            let abs = from + pos + keyword.len();
            let rest = &line[abs..];
            let word: String = rest
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '-')
                .collect();
            if !word.is_empty() {
                out.push((
                    line_no,
                    "cmd",
                    format!("{}{word}", keyword.trim_end().to_string() + " "),
                ));
            }
            from = abs;
            if from >= line.len() {
                break;
            }
        }
    }
}

/// Column names read out of a `CREATE TABLE` statement.
fn columns_from_ddl(sql: &str) -> BTreeSet<String> {
    let Some(open) = sql.find('(') else {
        return BTreeSet::new();
    };
    let body = &sql[open + 1..sql.rfind(')').unwrap_or(sql.len())];
    let mut cols = BTreeSet::new();
    let mut depth = 0i32;
    for part in body.split(|c| {
        match c {
            '(' => depth += 1,
            ')' => depth -= 1,
            _ => {}
        }
        c == ',' && depth == 0
    }) {
        if let Some(name) = part.split_whitespace().next() {
            let name = name.trim_matches(['"', '`', '[', ']']);
            if !name.is_empty()
                && !matches!(
                    name.to_ascii_uppercase().as_str(),
                    "PRIMARY" | "UNIQUE" | "FOREIGN" | "CHECK" | "CONSTRAINT"
                )
            {
                cols.insert(name.to_string());
            }
        }
    }
    cols
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_applies_and_status_is_empty() {
        let atlas = Atlas::open_in_memory().unwrap();
        let status = atlas.status().unwrap();
        assert_eq!(status.artifacts, 0);
        assert_eq!(status.gaps_open, 0);
        assert_eq!(
            atlas.get_meta("schema_version").unwrap().as_deref(),
            Some(ATLAS_SCHEMA_VERSION)
        );
    }

    #[test]
    fn zones_and_kinds_follow_the_repository_layout() {
        assert_eq!(classify_kind("forge/asm/lifted.s", Some("s")), "asm");
        assert_eq!(classify_zone("forge/asm/lifted.s", "asm"), "forge");
        assert_eq!(classify_zone("crates/forge/nie-re/src/lib.rs", "rust"), "crate");
        assert_eq!(classify_zone("crates/forge/nie-re/README.md", "md"), "doc");
        assert_eq!(classify_zone("data/re/40-derived/x.json", "json"), "re-data");
        assert_eq!(classify_zone("dist/nie.exe", "exe"), "binary");
        assert_eq!(classify_zone("docs/RE.md", "md"), "doc");
        assert_eq!(classify_zone("AGENTS.md", "md"), "doc");
    }

    #[test]
    fn markdown_yields_sections_and_machine_references() {
        let raw = "# Titre\n\nLa fonction FUN_140452820 vit en 0x140452820 dans `crates/forge/nie-re/src/lib.rs`.\n\n## Mesure\n\n`niers coverage` lit la table function.\n";
        let doc = parse_markdown(raw);
        assert_eq!(doc.title.as_deref(), Some("Titre"));
        assert_eq!(doc.sections.len(), 2);
        assert!(doc.refs.iter().any(|(_, k, v)| *k == "func" && v == "FUN_140452820"));
        assert!(doc.refs.iter().any(|(_, k, v)| *k == "vaddr" && v == "0x140452820"));
        assert!(doc.refs.iter().any(|(_, k, v)| *k == "crate" && v == "nie-re"));
        assert!(doc.refs.iter().any(|(_, k, v)| *k == "cmd" && v == "niers coverage"));
        assert!(doc.refs.iter().any(|(_, k, v)| *k == "table" && v == "function"));
        assert!(doc.re_score > 0);
    }

    #[test]
    fn manifest_reader_extracts_name_and_deps() {
        let raw = "[package]\nname = \"nie-index\"\nversion.workspace = true\ndescription = \"index\"\n\n[dependencies]\nrusqlite = { workspace = true }\nserde.workspace = true\n";
        let manifest = parse_manifest(raw);
        assert_eq!(manifest.name.as_deref(), Some("nie-index"));
        assert_eq!(manifest.description.as_deref(), Some("index"));
        assert!(manifest.deps.iter().any(|d| d == "rusqlite"));
    }

    #[test]
    fn gaps_rank_by_remaining_times_weight() {
        let atlas = Atlas::open_in_memory().unwrap();
        atlas
            .upsert_gap("a", "m", 50.0, 100.0, "pct", 1.0, None, None)
            .unwrap();
        atlas
            .upsert_gap("b", "m", 90.0, 100.0, "pct", 10.0, None, None)
            .unwrap();
        atlas
            .upsert_gap("c", "m", 100.0, 100.0, "pct", 10.0, None, None)
            .unwrap();
        let gaps = atlas.gaps(10).unwrap();
        assert_eq!(gaps.len(), 2, "a done gap leaves the ranking");
        assert_eq!(gaps[0].area, "b");
        assert!((gaps[0].score - 100.0).abs() < 1e-9);
        assert_eq!(atlas.next_gap().unwrap().unwrap().area, "b");
    }

    #[test]
    fn refresh_gaps_only_uses_measured_metrics() {
        let atlas = Atlas::open_in_memory().unwrap();
        assert_eq!(atlas.refresh_gaps().unwrap(), 0, "no metric, no gap");
        atlas
            .record_metric("re.classified", 100_664.0, Some(108_650.0), "niers coverage", None, None)
            .unwrap();
        atlas.refresh_gaps().unwrap();
        let gaps = atlas.gaps(10).unwrap();
        assert_eq!(gaps.len(), 1);
        assert!((gaps[0].current - 92.649_79).abs() < 0.01);
    }

    #[test]
    fn search_matches_documents_and_symbols() {
        let atlas = Atlas::open_in_memory().unwrap();
        atlas
            .conn
            .execute(
                "INSERT INTO atlas_text(kind, key, body, ref) VALUES('symbol','CMenuAttachLocator','CMenuAttachLocator menu 0x14129','0x14129')",
                [],
            )
            .unwrap();
        let hits = atlas.search("AttachLocator", 5).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].kind, "symbol");
    }

    #[test]
    fn a_qualified_name_needs_every_segment() {
        let tokens: HashSet<String> = ["CGameCameraCtrl", "Update", "shoot"]
            .into_iter()
            .map(str::to_string)
            .collect();
        assert!(name_is_ported("CGameCameraCtrl::Update", &tokens));
        // `Update` seul ne doit pas faire passer toutes les méthodes du binaire pour portées.
        assert!(!name_is_ported("CKeeperCtrl::Update", &tokens));
        assert!(!name_is_ported("abc", &tokens), "trop court pour trancher");
    }

    #[test]
    fn ddl_columns_survive_nested_parentheses() {
        let cols = columns_from_ddl(
            "CREATE TABLE forge_unit (id INTEGER PRIMARY KEY, vaddr INTEGER NOT NULL, status TEXT DEFAULT ('raw'), UNIQUE(vaddr))",
        );
        assert!(cols.contains("vaddr"));
        assert!(cols.contains("status"));
        assert!(!cols.contains("UNIQUE"));
    }
}
