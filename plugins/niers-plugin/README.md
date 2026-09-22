# NIERS multi-host plugin

NIERS is a shared Agent Skills and native Rust MCP package for Codex, Claude Code, and
Antigravity CLI (`agy`). The hosts share the same 18 skills and `niers-game` MCP server; only
their lightweight manifests differ.

## Start here

`re-workflow` is the entry-point skill: it teaches the atlas-driven reverse-engineering loop —
`niers atlas search` before any tree walk, `niers atlas gaps` to read the ranked road to 100 %,
`scripts/atlas-loop.sh` to run one measured, bounded tick. See `docs/ATLAS.md` in the
repository.

## Requirements

- The `nie-mcp` executable on `PATH` (available from the Inacord download hub). No source
  checkout or Rust toolchain is required at runtime.

## Host adapters

| Host | Manifest | MCP declaration |
|---|---|---|
| Codex | `.codex-plugin/plugin.json` | `.mcp.json` |
| Claude Code | `.claude-plugin/plugin.json` | `.mcp.json` |
| Antigravity CLI (`agy`) | `plugin.json` | `mcp_config.json` |

All MCP declarations start the same installed native Rust server:

```text
nie-mcp
```

The Claude marketplace manifest at `../.claude-plugin/marketplace.json` exposes this plugin from
the repository's `plugins/` directory. The root `plugin.json` follows the same Antigravity
adapter convention used by Aphrody's YOLO package.

## Verification

```bash
python3 /home/ubuntu/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/niers-plugin
```

`plugins/niers-plugin` is the only checked-in plugin source. Host-local installation directories
are generated outside the repository; no runtime mirror is committed under `.agents/plugins`.
