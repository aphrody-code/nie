# Repository map

This repository has one native IEVR owner: the Rust engine and its tools.

| Surface | Owner | Role |
| --- | --- | --- |
| Native game engine and formats | `crates/engine/*` | VFS, decoders, game rules, Lua and rendering |
| Wiki library | `crates/tools/nie-wiki` | Read-only mirror queries and domain projections |
| Native site | `crates/tools/nie-site` | HTTP pages and API routes |
| Native CLI | `crates/tools/nie-cli` | One terminal interface for game data and tooling |
| Native MCP | `crates/tools/nie-cli` and `crates/tools/nie-mcp` | Rust command owner with a native stdio transport |
| Web client | `apps/nie-web` | WASM/desktop UI consuming the native contracts |
| Scheduled jobs | `packages/cron` | Editorial and operational jobs only; no IEVR writer |

## Data boundary

IEVR data comes from the verified VFS and the read-only SQLite mirror at
`var/mirror.sqlite`. Rust owns parsing, joins, validation and game semantics. Bun may
transport JSON or implement non-game operational glue, but it must not recreate a game-data
parser or write an alternate wiki database.

The deleted Azalée Next application, Azalée TypeScript library, and Inagle TypeScript toolkit
are not compatibility targets. New consumers must call `nie-wiki`, `nie-site`, or `nie-cli`.

## Rules

- Keep machine-facing identifiers, schemas and documentation in English.
- Put reusable behavior in a library; keep CLI, HTTP, MCP and UI layers thin.
- Never use Supabase or a network database as the source for IEVR data.
- Never commit generated game dumps or captures; preserve user-owned `data/` and `var/` content.
