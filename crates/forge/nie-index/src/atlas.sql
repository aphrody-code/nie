-- Atlas schema — the single index over every reverse-engineering surface of the
-- repository: measured artefacts, crates, documentation, knowledge-base digest,
-- forge units, binaries, tools, metrics and the ranked road to 100 %.
--
-- The atlas lives in its own database (`var/nie-atlas.sqlite`) so it stays small,
-- portable and cheap to rebuild; `var/niers.sqlite` (19 GB knowledge base) is read
-- through ATTACH and only its digest is copied here. Every table is idempotent
-- (`INSERT … ON CONFLICT`) so a rescan never duplicates a row.
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS atlas_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Every file of the repository that belongs to the RE/forge chain.
-- zone: re-data|forge|export|doc|crate|script|binary|db|vfs|other
-- kind: asm|c|h|rust|md|json|ndjson|sql|exe|sqlite|python|shell|ts|bin|other
CREATE TABLE IF NOT EXISTS atlas_artifact (
    id         INTEGER PRIMARY KEY,
    path       TEXT NOT NULL UNIQUE,
    zone       TEXT NOT NULL,
    kind       TEXT NOT NULL,
    ext        TEXT,
    bytes      INTEGER NOT NULL,
    sha256     TEXT,
    mtime      INTEGER NOT NULL,
    lines      INTEGER,
    tracked    INTEGER NOT NULL DEFAULT 0,
    scanned_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_artifact_zone ON atlas_artifact(zone, kind);
CREATE INDEX IF NOT EXISTS idx_artifact_sha  ON atlas_artifact(sha256);
CREATE INDEX IF NOT EXISTS idx_artifact_ext  ON atlas_artifact(ext);

-- Cargo workspace members. tier: forge|engine|tools|archive|app
CREATE TABLE IF NOT EXISTS atlas_crate (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    path        TEXT NOT NULL,
    tier        TEXT NOT NULL,
    version     TEXT,
    description TEXT,
    files       INTEGER NOT NULL DEFAULT 0,
    loc         INTEGER NOT NULL DEFAULT 0,
    test_fns    INTEGER NOT NULL DEFAULT 0,
    unsafe_hits INTEGER NOT NULL DEFAULT 0,
    extern_todo INTEGER NOT NULL DEFAULT 0,
    n_deps      INTEGER NOT NULL DEFAULT 0,
    in_workspace INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS atlas_crate_dep (
    crate_id INTEGER NOT NULL REFERENCES atlas_crate(id) ON DELETE CASCADE,
    dep      TEXT NOT NULL,
    internal INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (crate_id, dep)
);

-- Markdown corpus. `re_score` ranks how much a document is about the binary
-- (hex addresses, function names, forge/KB vocabulary) so `atlas docs --re`
-- separates the real RE documentation from product prose.
CREATE TABLE IF NOT EXISTS atlas_doc (
    id          INTEGER PRIMARY KEY,
    path        TEXT NOT NULL UNIQUE,
    artifact_id INTEGER REFERENCES atlas_artifact(id) ON DELETE SET NULL,
    title       TEXT,
    words       INTEGER NOT NULL DEFAULT 0,
    lines       INTEGER NOT NULL DEFAULT 0,
    headings    INTEGER NOT NULL DEFAULT 0,
    code_blocks INTEGER NOT NULL DEFAULT 0,
    re_score    INTEGER NOT NULL DEFAULT 0,
    mtime       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_doc_score ON atlas_doc(re_score DESC);

CREATE TABLE IF NOT EXISTS atlas_doc_section (
    id     INTEGER PRIMARY KEY,
    doc_id INTEGER NOT NULL REFERENCES atlas_doc(id) ON DELETE CASCADE,
    level  INTEGER NOT NULL,
    title  TEXT NOT NULL,
    line   INTEGER NOT NULL,
    UNIQUE (doc_id, line)
);

-- Cross-links extracted from the documents: what a doc says about the machine.
-- kind: vaddr|func|crate|path|table|cmd|sha256|metric
CREATE TABLE IF NOT EXISTS atlas_doc_ref (
    id     INTEGER PRIMARY KEY,
    doc_id INTEGER NOT NULL REFERENCES atlas_doc(id) ON DELETE CASCADE,
    line   INTEGER NOT NULL,
    kind   TEXT NOT NULL,
    value  TEXT NOT NULL,
    UNIQUE (doc_id, line, kind, value)
);
CREATE INDEX IF NOT EXISTS idx_doc_ref_value ON atlas_doc_ref(kind, value);

-- Inventory of the knowledge base (`var/niers.sqlite`): one row per table, so the
-- atlas knows everything the 19 GB database holds without copying it.
CREATE TABLE IF NOT EXISTS atlas_kb_table (
    name       TEXT PRIMARY KEY,
    n_rows     INTEGER NOT NULL DEFAULT 0,
    kind       TEXT NOT NULL DEFAULT 'table',
    counted_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Named symbols copied from the knowledge base (the part an agent actually queries).
CREATE TABLE IF NOT EXISTS atlas_symbol (
    id          INTEGER PRIMARY KEY,
    vaddr       INTEGER NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    size        INTEGER NOT NULL DEFAULT 0,
    name_source TEXT,
    subsystem   TEXT,
    confidence  REAL NOT NULL DEFAULT 0.0,
    ported      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_symbol_name ON atlas_symbol(name);
CREATE INDEX IF NOT EXISTS idx_symbol_sub  ON atlas_symbol(subsystem);

-- Forge units: the pieces the reference binary is cut into, and how each one is
-- produced today. `file_off` is the identity (it exists for every unit, including the
-- headers and the data sections, where `vaddr` is null) — same key as `forge_unit` in
-- the knowledge base.
-- lang: raw|asm|c|rust ; status: raw|lifted|registered|byte-exact|blocked
CREATE TABLE IF NOT EXISTS atlas_unit (
    id          INTEGER PRIMARY KEY,
    file_off    INTEGER NOT NULL UNIQUE,
    vaddr       INTEGER,
    size        INTEGER NOT NULL DEFAULT 0,
    name        TEXT,
    kind        TEXT,
    section     TEXT,
    lang        TEXT NOT NULL DEFAULT 'raw',
    status      TEXT NOT NULL DEFAULT 'raw',
    source_path TEXT,
    byte_exact  INTEGER NOT NULL DEFAULT 0,
    origin      TEXT
);
CREATE INDEX IF NOT EXISTS idx_unit_status ON atlas_unit(status);
CREATE INDEX IF NOT EXISTS idx_unit_vaddr  ON atlas_unit(vaddr);

-- Binaries seen by the atlas. role: reference|produced|patched|other
CREATE TABLE IF NOT EXISTS atlas_binary (
    id        INTEGER PRIMARY KEY,
    path      TEXT NOT NULL UNIQUE,
    role      TEXT NOT NULL,
    bytes     INTEGER NOT NULL,
    sha256    TEXT,
    identical INTEGER,
    seen_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The tool surface: what an agent can actually run.
-- kind: rust-bin|cli-cmd|cli-subcmd|script|just|mcp-tool|bun-cli
CREATE TABLE IF NOT EXISTS atlas_tool (
    id      INTEGER PRIMARY KEY,
    name    TEXT NOT NULL,
    kind    TEXT NOT NULL,
    path    TEXT,
    summary TEXT,
    UNIQUE (kind, name)
);

-- Measurement timeline. Every number the loop takes lands here, with its source,
-- so a claim can always be traced back to the command that produced it.
CREATE TABLE IF NOT EXISTS atlas_metric (
    id         INTEGER PRIMARY KEY,
    ts         TEXT NOT NULL DEFAULT (datetime('now')),
    name       TEXT NOT NULL,
    value      REAL NOT NULL,
    total      REAL,
    pct        REAL,
    source     TEXT NOT NULL,
    binary_sha TEXT,
    note       TEXT
);
CREATE INDEX IF NOT EXISTS idx_metric_name ON atlas_metric(name, ts DESC);

-- The road to 100 %: one measurable gap per area, ranked by weight × remaining.
-- status: open|running|blocked|done
CREATE TABLE IF NOT EXISTS atlas_gap (
    id       INTEGER PRIMARY KEY,
    area     TEXT NOT NULL UNIQUE,
    metric   TEXT NOT NULL,
    current  REAL NOT NULL DEFAULT 0.0,
    target   REAL NOT NULL DEFAULT 100.0,
    unit     TEXT NOT NULL DEFAULT 'pct',
    weight   REAL NOT NULL DEFAULT 1.0,
    status   TEXT NOT NULL DEFAULT 'open',
    action   TEXT,
    evidence TEXT,
    updated  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Autonomous workflow runs: what the loop did, and what it measured afterwards.
CREATE TABLE IF NOT EXISTS atlas_run (
    id          INTEGER PRIMARY KEY,
    ts          TEXT NOT NULL DEFAULT (datetime('now')),
    step        TEXT NOT NULL,
    area        TEXT,
    ok          INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    metrics     TEXT,
    log         TEXT
);
CREATE INDEX IF NOT EXISTS idx_run_ts ON atlas_run(ts DESC);

-- Searchable text of everything above (docs, symbols, tools, artefacts).
-- Source of truth for `atlas search`; an FTS5 mirror is created when the SQLite
-- build supports it, otherwise the LIKE path over this table is used.
CREATE TABLE IF NOT EXISTS atlas_text (
    id   INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,
    key  TEXT NOT NULL,
    body TEXT NOT NULL,
    ref  TEXT,
    UNIQUE (kind, key)
);
CREATE INDEX IF NOT EXISTS idx_text_kind ON atlas_text(kind);

-- Aggregate status, one row.
CREATE VIEW IF NOT EXISTS v_atlas_status AS
SELECT
    (SELECT COUNT(*) FROM atlas_artifact)                          AS artifacts,
    (SELECT COALESCE(SUM(bytes), 0) FROM atlas_artifact)           AS artifact_bytes,
    (SELECT COUNT(*) FROM atlas_crate)                             AS crates,
    (SELECT COUNT(*) FROM atlas_doc)                               AS docs,
    (SELECT COUNT(*) FROM atlas_doc_ref)                           AS doc_refs,
    (SELECT COUNT(*) FROM atlas_symbol)                            AS symbols,
    (SELECT COUNT(*) FROM atlas_unit)                              AS units,
    (SELECT COUNT(*) FROM atlas_unit WHERE byte_exact = 1)         AS units_exact,
    (SELECT COUNT(*) FROM atlas_tool)                              AS tools,
    (SELECT COUNT(*) FROM atlas_kb_table)                          AS kb_tables,
    (SELECT COALESCE(SUM(n_rows), 0) FROM atlas_kb_table)          AS kb_rows,
    (SELECT COUNT(*) FROM atlas_gap WHERE status <> 'done')        AS gaps_open,
    (SELECT COUNT(*) FROM atlas_run)                               AS runs;

-- Gaps ranked by the work they actually represent.
CREATE VIEW IF NOT EXISTS v_atlas_gap_ranked AS
SELECT area, metric, current, target, unit, weight, status, action, evidence,
       (target - current) AS remaining,
       (target - current) * weight AS score
FROM atlas_gap
WHERE status <> 'done'
ORDER BY score DESC;
