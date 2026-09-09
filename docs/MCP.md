# Native Rust MCP server

Measured state on 2026-09-07: `niers-game` is a fully native Rust MCP server provided by the
`crates/tools/nie-mcp` crate and the equivalent `niers mcp` command. It replaces the former
`apps/nie-mcp` server, which depended on Bun, the TypeScript SDK, Zod, and FFI.

## Architecture

The `nie-mcp` binary is a thin binding over the `nie-cli` library. The server implementation
lives in `crates/tools/nie-cli/src/mcp.rs` and uses the official Rust SDK `rmcp`, pinned to the
same reviewed commit as the sibling `aphrody-mcp` server:

```toml
rmcp = { git = "https://github.com/modelcontextprotocol/rust-sdk.git", rev = "cc66e3091e1584f48ee1e0058a2a1201a1d35c81", features = ["server", "transport-io", "macros", "schemars"] }
```

MCP uses stdio. stdout is reserved exclusively for JSON-RPC frames; diagnostics and bridge logs
go to stderr. Input schemas are derived with `schemars`, and `tools/list` is the executable
source of truth for the tool inventory.

CLI commands are not relaunched as subprocesses. `nie-cli` exposes a library target and shared
dispatch function. Output capture is thread-local, bounded to 8 MiB, and blocking work runs
outside Tokio async tasks. The small `src/bin.rs` remains the terminal binding.

```text
MCP client ──stdio──> nie-mcp / niers mcp
                         │
                         ├── rmcp + schemars schemas
                         ├── in-process nie-cli dispatch
                         ├── Rust VFS / format / RE / repository crates
                         └── WebSocket 127.0.0.1:8791/bridge ──> Inacord
```

## Tool surface: 56 tools

Forty `cli_*` tools cover exactly the forty top-level commands other than `mcp`. Every tool uses
the common `{ "args": string[] }` input. These are the same arguments that follow the command in
the terminal, keeping Clap as the single source of truth for nested commands and options.

| Family | Tools |
|---|---|
| Forge and RE | `cli_seed`, `cli_seed_ui`, `cli_strings`, `cli_coverage`, `cli_queue`, `cli_propagate`, `cli_rtti`, `cli_index`, `cli_disasm`, `cli_pdata`, `cli_rebuild`, `cli_recover` |
| Formats and VFS | `cli_viola`, `cli_format`, `cli_decode`, `cli_refresh_typed_json`, `cli_convert`, `cli_vfs` |
| Game and content | `cli_steam`, `cli_info`, `cli_render`, `cli_lua`, `cli_lua_run`, `cli_lua_audit`, `cli_img`, `cli_mode`, `cli_icons`, `cli_avatar`, `cli_save`, `cli_wiki`, `cli_uniform_map`, `cli_textures`, `cli_menu_predecode`, `cli_vn`, `cli_video` |
| System and control | `cli_computer_use`, `cli_mod`, `cli_find`, `cli_grep`, `cli_mem` |

Sixteen compatibility names preserve the former Bun server API:

| Domain | Native tools |
|---|---|
| Service | `aphrody_api_health` |
| VFS and assets | `vfs_list`, `vfs_search`, `vfs_stat`, `vfs_cat`, `asset_get` |
| RE database | `re_query`, `re_function`, `re_coverage` |
| Repository | `repo_read` |
| Inacord | `explorer_status`, `explorer_navigate`, `explorer_open`, `explorer_tab`, `explorer_toast` |
| Game | `game_launch` |

A compatibility-tool failure is returned as an MCP result with `isError: true`. Every `cli_*`
tool returns the structured envelope `{ success, stdout, stderr, error, truncated }`, allowing a
client to distinguish Clap or domain errors without parsing free-form output.

`re_query` opens `NIERS_SQLITE` read-only, validates both SQL shape and SQLite's
`Statement::readonly`, bounds rows, preserves large integers, and formats address columns as
hexadecimal. VFS operations call `nie-formats` directly, while `repo_read` reuses the confined
repository API from `nie-explore`.

`asset_get` decodes `raw`, `cfg`, `tex`, and `audio` in memory. Compatibility mode `model` calls
`nie-model-serve` through a native Rust HTTP client with a 30-second timeout, streaming reads,
and an 8 MiB `maxBytes` ceiling. If `Content-Length` already exceeds the ceiling, the body is not
downloaded and the exact URL is returned. Full conversion and rendering workflows remain
available through `cli_convert` and `cli_render`.

## Inacord bridge

The Rust server listens only on `ws://127.0.0.1:8791/bridge`. `NIERS_BRIDGE_PORT` can override
the port. The bridge is optional: a busy port or absent UI does not disable other MCP tools.

The versioned protocol remains in `packages/nie-bridge/src/protocol.ts` as the WebView client
contract. Its former `Bun.serve` implementation has been removed. The Rust server validates the
HTTP path, `hello` frame, protocol version, requested tab, and bounds each reply wait to five
seconds. A new connection cleanly replaces the previous one.

## Running and configuration

From the repository root:

```bash
cargo run --release --quiet --package nie-mcp --
# equivalent binding
cargo run --quiet --package nie-cli -- mcp
```

Portable project configuration:

```json
{
  "mcpServers": {
    "niers-game": {
      "type": "stdio",
      "command": "cargo",
      "args": ["run", "--release", "--quiet", "--package", "nie-mcp", "--"]
    }
  }
}
```

For a desktop client launched from another directory, Inacord adds
`--manifest-path <repository>/Cargo.toml`. The four versioned declarations are `.mcp.json`,
`.codex/config.toml`, `plugins/niers-plugin/mcp_config.json`, and
`.agents/plugins/niers-plugin/mcp_config.json`.

Recognized environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `NIERS_REPO` | root inferred from the manifest | `repo_read`, `game_launch`, and generated configuration |
| `NIE_GAME_DIR` | native `nie-formats` resolution | VFS and game data |
| `NIERS_SQLITE` | `<repo>/var/niers.sqlite` | read-only RE tools |
| `NIE_APHRODY_API_URL` | `http://127.0.0.1:8085` | `aphrody_api_health` compatibility |
| `MODEL_SERVE_URL` | `http://127.0.0.1:8790` | `asset_get` with `decode: "model"` |
| `NIERS_BRIDGE_PORT` | `8791` | local Inacord bridge |
| `NIERS_GAME_EXE` | `nie.exe` | executable launched by `game_launch` |

## Verification and maintenance

Run the scoped gates with:

```bash
cargo test -p nie-cli --lib mcp::
cargo test -p nie-mcp --test stdio_smoke
cargo clippy -p nie-cli --lib --bins --tests -- -D warnings
cargo clippy -p nie-mcp --bins --tests -- -D warnings
bun test packages/nie-bridge
bunx tsc --noEmit -p packages/nie-bridge/tsconfig.json
```

The protocol smoke test starts the real binary, initializes MCP, checks all 56 tools, and calls
`cli_info` over clean stdout. The bridge test performs a real WebSocket round trip with the
historical client contract. Every new top-level CLI command must add its `cli_*` binding and
update the verified count. Every bridge protocol change must update both the TypeScript client
and the Rust test.
