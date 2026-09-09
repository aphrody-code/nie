# NIERS multi-host plugin

NIERS is a shared Agent Skills and native Rust MCP package for Codex, Claude Code, and
Antigravity CLI (`agy`). The hosts share the same 17 skills and `niers-game` MCP server; only
their lightweight manifests differ.

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
bun test packages/mcp/test/plugin.test.ts
```

The checked-in `.agents/plugins/niers-plugin` directory is a runtime mirror. Its manifests, MCP
declarations, README, and skills must remain aligned with this source plugin.
