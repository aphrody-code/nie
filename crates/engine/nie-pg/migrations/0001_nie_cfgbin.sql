-- Schema `nie`: IEVR VFS cfg.bin files, decoded from the binary (no JSON step).
--
-- Boundary with Azalée (rg): this schema is separate from `public.inagle_*`. nie never
-- writes to `public`; readers get `nie_reader` (USAGE + SELECT only).
-- Idempotent: safe to replay on an existing database.

CREATE SCHEMA IF NOT EXISTS nie;

CREATE TABLE IF NOT EXISTS nie.schema_version (
    version    integer PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);

-- One VFS cfg.bin file. `sha256` makes imports incremental: an unchanged file is not
-- rewritten, a changed file is replaced in one transaction (cascade).
CREATE TABLE IF NOT EXISTS nie.cfgbin_file (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    path        text        NOT NULL UNIQUE,
    format      text        NOT NULL CHECK (format IN ('rdbn', 't2b')),
    sha256      bytea       NOT NULL CHECK (octet_length(sha256) = 32),
    byte_size   integer     NOT NULL CHECK (byte_size >= 0),
    imported_at timestamptz NOT NULL DEFAULT now()
);

-- RDBN: typed lists. `kind` is the binary RdbnFieldType code
-- (3 bool, 4 byte, 5 short, 6 int, 9 act_type, 10 flag, 13 float, 15 hash, 18 rates,
-- 19 position, 20 condition, 21 short_tuple); -1 = blob, -2 = unreadable value.
CREATE TABLE IF NOT EXISTS nie.rdbn_list (
    id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    file_id   bigint  NOT NULL REFERENCES nie.cfgbin_file (id) ON DELETE CASCADE,
    ord       integer NOT NULL,
    name      text    NOT NULL,
    type_name text    NOT NULL,
    UNIQUE (file_id, ord)
);

CREATE TABLE IF NOT EXISTS nie.rdbn_value (
    list_id    bigint   NOT NULL REFERENCES nie.rdbn_list (id) ON DELETE CASCADE,
    row_idx    integer  NOT NULL,
    field_idx  smallint NOT NULL,
    field_name text     NOT NULL,
    kind       smallint NOT NULL,
    v_int      bigint,
    v_real     double precision,
    v_text     text,
    v_vec      real[],
    v_bytes    bytea,
    PRIMARY KEY (list_id, row_idx, field_idx)
);

CREATE INDEX IF NOT EXISTS rdbn_value_field_name ON nie.rdbn_value (field_name);

-- T2B: entry tree (parent_idx NULL at the root) and typed variables
-- (`kind` 0 = text, 1 = integer, 2 = float).
CREATE TABLE IF NOT EXISTS nie.t2b_entry (
    file_id    bigint   NOT NULL REFERENCES nie.cfgbin_file (id) ON DELETE CASCADE,
    idx        integer  NOT NULL,
    parent_idx integer,
    depth      smallint NOT NULL,
    name       text     NOT NULL,
    PRIMARY KEY (file_id, idx)
);

CREATE INDEX IF NOT EXISTS t2b_entry_name ON nie.t2b_entry (name);

CREATE TABLE IF NOT EXISTS nie.t2b_var (
    file_id   bigint   NOT NULL,
    entry_idx integer  NOT NULL,
    ord       smallint NOT NULL,
    kind      smallint NOT NULL CHECK (kind IN (0, 1, 2)),
    v_int     integer,
    v_real    real,
    v_text    text,
    PRIMARY KEY (file_id, entry_idx, ord),
    FOREIGN KEY (file_id, entry_idx) REFERENCES nie.t2b_entry (file_id, idx) ON DELETE CASCADE
);

-- Read-only role without login: grant it to Azalée's application role
-- (`GRANT nie_reader TO <azalee_role>;`), never write privileges.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nie_reader') THEN
        CREATE ROLE nie_reader NOLOGIN;
    END IF;
END
$$;

GRANT USAGE ON SCHEMA nie TO nie_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA nie TO nie_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA nie GRANT SELECT ON TABLES TO nie_reader;
REVOKE CREATE ON SCHEMA nie FROM PUBLIC;

INSERT INTO nie.schema_version (version) VALUES (1) ON CONFLICT DO NOTHING;
