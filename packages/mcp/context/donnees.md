# Game data boundary

The native Rust stack reads verified Inazuma Eleven: Victory Road assets from the VFS and
serves the read-only SQLite mirror at `var/mirror.sqlite`.

```text
nie.exe data/CPK/VFS
        -> nie-formats / nie-data
        -> nie-wiki read-only projections
        -> nie-site, nie-cli, native MCP and nie-web
```

The mirror is an immutable read source for consumers. It is never populated by a TypeScript
parser, Supabase, or an HTTP writer in a runtime request. The `inagle_*` table prefix is a
legacy schema identifier retained for snapshot compatibility; it is not a package owner.

Use the surfaces in this order:

1. `nie-cli wiki ...` or the native MCP wiki tools for domain operations.
2. `nie-site` API routes for HTTP clients.
3. `db_tables`, `db_schema` and read-only `db_query` only for bounded inspection.
4. `nie-cli` VFS/format commands for raw game assets.

No non-VFS editorial dataset is part of the IEVR wiki contract.
