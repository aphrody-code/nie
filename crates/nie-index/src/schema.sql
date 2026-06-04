-- Schéma de la base de connaissance niers. Tout ce que la boucle RE découvre ou
-- importe (savoir fusionné iecode/inagle) est durable ici. WAL pour concurrence workers.
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Binaire cible (nie.exe / nie_eacpatched.exe).
CREATE TABLE IF NOT EXISTS binary (
    id        INTEGER PRIMARY KEY,
    path      TEXT NOT NULL,
    sha256    TEXT NOT NULL UNIQUE,
    arch      TEXT NOT NULL,
    bits      INTEGER NOT NULL,
    base_addr INTEGER NOT NULL,
    size      INTEGER NOT NULL,
    pdb_ref   TEXT,
    compiled  TEXT,
    indexed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS section (
    id        INTEGER PRIMARY KEY,
    binary_id INTEGER NOT NULL REFERENCES binary(id) ON DELETE CASCADE,
    name      TEXT NOT NULL,
    vaddr     INTEGER NOT NULL,
    vsize     INTEGER NOT NULL,
    paddr     INTEGER NOT NULL,
    psize     INTEGER NOT NULL,
    perm      TEXT NOT NULL,
    UNIQUE(binary_id, name)
);

-- Fonctions découvertes. name_source : re|rtti|xref|seed|ml|manual.
-- subsystem/role/pagerank/ret_type/params proviennent du seed Ghidra (nie-index.json) ;
-- la boucle de propagation raffine subsystem + confidence.
CREATE TABLE IF NOT EXISTS function (
    id          INTEGER PRIMARY KEY,
    binary_id   INTEGER NOT NULL REFERENCES binary(id) ON DELETE CASCADE,
    vaddr       INTEGER NOT NULL,
    size        INTEGER NOT NULL DEFAULT 0,
    name        TEXT,
    name_source TEXT,
    confidence  REAL NOT NULL DEFAULT 0.0,
    cc          TEXT,
    n_args      INTEGER,
    complexity  INTEGER NOT NULL DEFAULT 0,
    n_calls_out INTEGER NOT NULL DEFAULT 0,
    n_calls_in  INTEGER NOT NULL DEFAULT 0,
    subsystem   TEXT,
    subsys_src  TEXT,
    role        TEXT,
    pagerank    REAL NOT NULL DEFAULT 0.0,
    ret_type    TEXT,
    params      TEXT,
    n_lines     INTEGER NOT NULL DEFAULT 0,
    UNIQUE(binary_id, vaddr)
);
CREATE INDEX IF NOT EXISTS idx_function_name ON function(binary_id, name);
CREATE INDEX IF NOT EXISTS idx_function_subsystem ON function(binary_id, subsystem);

-- Globals (DAT_*) référencés par les fonctions (97k dans nie-index.json).
CREATE TABLE IF NOT EXISTS glob (
    id        INTEGER PRIMARY KEY,
    binary_id INTEGER NOT NULL REFERENCES binary(id) ON DELETE CASCADE,
    vaddr     INTEGER NOT NULL,
    name      TEXT,
    ty        TEXT,
    UNIQUE(binary_id, vaddr)
);

-- Strings référencées par une fonction (st de nie-index.json) = ancres de propagation.
CREATE TABLE IF NOT EXISTS func_str_ref (
    id          INTEGER PRIMARY KEY,
    binary_id   INTEGER NOT NULL REFERENCES binary(id) ON DELETE CASCADE,
    function_id INTEGER NOT NULL REFERENCES function(id) ON DELETE CASCADE,
    value       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_func_str_ref_fn ON func_str_ref(function_id);
CREATE INDEX IF NOT EXISTS idx_func_str_ref_val ON func_str_ref(value);

-- Constantes hex utilisées par une fonction (hx) — utile pour matcher des magics de format.
CREATE TABLE IF NOT EXISTS func_const (
    id          INTEGER PRIMARY KEY,
    function_id INTEGER NOT NULL REFERENCES function(id) ON DELETE CASCADE,
    value       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_func_const_fn ON func_const(function_id);
CREATE INDEX IF NOT EXISTS idx_func_const_val ON func_const(value);

-- Références croisées (call/data/code) entre adresses.
CREATE TABLE IF NOT EXISTS xref (
    id        INTEGER PRIMARY KEY,
    binary_id INTEGER NOT NULL REFERENCES binary(id) ON DELETE CASCADE,
    from_addr INTEGER NOT NULL,
    to_addr   INTEGER NOT NULL,
    kind      TEXT NOT NULL,
    UNIQUE(binary_id, from_addr, to_addr, kind)
);
CREATE INDEX IF NOT EXISTS idx_xref_to ON xref(binary_id, to_addr);
CREATE INDEX IF NOT EXISTS idx_xref_from ON xref(binary_id, from_addr);

-- Strings (ancres de propagation : "CHARA_PARAM_INFO" → loader perso).
CREATE TABLE IF NOT EXISTS str (
    id        INTEGER PRIMARY KEY,
    binary_id INTEGER NOT NULL REFERENCES binary(id) ON DELETE CASCADE,
    vaddr     INTEGER NOT NULL,
    len       INTEGER NOT NULL,
    section   TEXT,
    value     TEXT NOT NULL,
    UNIQUE(binary_id, vaddr)
);
CREATE INDEX IF NOT EXISTS idx_str_value ON str(value);

-- Classes RTTI MSVC récupérées (moteur Level-5 "Lives" : lives::*).
CREATE TABLE IF NOT EXISTS rtti_class (
    id              INTEGER PRIMARY KEY,
    binary_id       INTEGER NOT NULL REFERENCES binary(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    mangled         TEXT,
    namespace       TEXT,
    vtable_vaddr    INTEGER,
    type_desc_vaddr INTEGER,
    UNIQUE(binary_id, name)
);

-- Hiérarchie d'héritage RTTI.
CREATE TABLE IF NOT EXISTS rtti_base (
    id            INTEGER PRIMARY KEY,
    class_id      INTEGER NOT NULL REFERENCES rtti_class(id) ON DELETE CASCADE,
    base_class_id INTEGER NOT NULL REFERENCES rtti_class(id) ON DELETE CASCADE,
    offset        INTEGER NOT NULL DEFAULT 0,
    UNIQUE(class_id, base_class_id)
);

-- Symboles (imports/exports + seed).
CREATE TABLE IF NOT EXISTS symbol (
    id        INTEGER PRIMARY KEY,
    binary_id INTEGER NOT NULL REFERENCES binary(id) ON DELETE CASCADE,
    name      TEXT NOT NULL,
    vaddr     INTEGER,
    kind      TEXT NOT NULL,
    lib       TEXT,
    UNIQUE(binary_id, name, kind)
);

-- Formats Level-5 documentés (savoir iecode/inagle fusionné). source : iecode|inagle|re.
CREATE TABLE IF NOT EXISTS format (
    id     INTEGER PRIMARY KEY,
    name   TEXT NOT NULL UNIQUE,
    magic  TEXT,
    source TEXT NOT NULL,
    doc    TEXT
);

CREATE TABLE IF NOT EXISTS format_field (
    id        INTEGER PRIMARY KEY,
    format_id INTEGER NOT NULL REFERENCES format(id) ON DELETE CASCADE,
    offset    INTEGER,
    size      INTEGER,
    ty        TEXT,
    name      TEXT NOT NULL,
    note      TEXT
);

-- Tables hash→nom d'inagle (CRC32/FNV des IDs : des milliers d'ancres). kind : chara|skill|item|...
CREATE TABLE IF NOT EXISTS hash_name (
    id     INTEGER PRIMARY KEY,
    hash   INTEGER NOT NULL,
    kind   TEXT NOT NULL,
    name   TEXT NOT NULL,
    source TEXT NOT NULL,
    UNIQUE(hash, kind)
);
CREATE INDEX IF NOT EXISTS idx_hash_name ON hash_name(hash);

-- Ancres de vérité pour la propagation de labels.
CREATE TABLE IF NOT EXISTS anchor (
    id         INTEGER PRIMARY KEY,
    binary_id  INTEGER NOT NULL REFERENCES binary(id) ON DELETE CASCADE,
    vaddr      INTEGER NOT NULL,
    label      TEXT NOT NULL,
    kind       TEXT NOT NULL,
    source     TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 1.0,
    UNIQUE(binary_id, vaddr, label)
);

-- Hypothèses ML/heuristiques (claims scorés). status : open|confirmed|rejected.
CREATE TABLE IF NOT EXISTS hypothesis (
    id         INTEGER PRIMARY KEY,
    binary_id  INTEGER NOT NULL REFERENCES binary(id) ON DELETE CASCADE,
    subject    TEXT NOT NULL,
    claim      TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0.0,
    source     TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Snapshots de couverture (progression vers 100%).
CREATE TABLE IF NOT EXISTS coverage (
    id          INTEGER PRIMARY KEY,
    binary_id   INTEGER NOT NULL REFERENCES binary(id) ON DELETE CASCADE,
    ts          TEXT NOT NULL DEFAULT (datetime('now')),
    total_funcs INTEGER NOT NULL,
    named       INTEGER NOT NULL,
    classified  INTEGER NOT NULL,
    pct         REAL NOT NULL
);
