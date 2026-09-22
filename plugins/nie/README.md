# NIE multi-host plugin

NIE is a shared Agent Skills and native Rust MCP package for Codex, Claude Code, and
Antigravity CLI (`agy`). The hosts share the same 18 skills and `nie-game` MCP server; only
their lightweight manifests differ.

## Start here

`re-workflow` is the entry-point skill: it teaches the atlas-driven reverse-engineering loop —
`nie atlas search` before any tree walk, `nie atlas gaps` to read the ranked road to 100 %,
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

## Rendu unifié

La surface Rust canonique est `nie-render3d` :

- CPU headless déterministe : GLB → RGBA8 avec z-buffer, culling, UV et Lambert ;
- GPU/WebGPU : viewport interactif avec le même cadrage caméra ;
- WASM : bindings du viewer et repli CPU sans accès système ;
- GUI/site/model-server : mêmes modèles GLB et mêmes limites d’entrée ;
- sécurité : `unsafe` interdit dans la crate, allocations dimensionnées et budgets contrôlés.

Le contrat de composition commun est `nie-render`; `nie-model-serve` reste l’amont HTTP de
résolution VFS/CRC/GLB et `nie-site` le gateway borné (`/assets/*`, `/readyz`).

Commandes de validation :

```text
cargo test -p nie-render3d --locked
cargo test -p nie-model-serve --locked
cargo test -p nie-site --locked --lib
cargo clippy -p nie-render3d -p nie-model-serve -p nie-site --all-targets --locked -- -D warnings
```

## Verification

```bash
python3 /home/ubuntu/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/nie
```

`plugins/nie` is the only checked-in plugin source. Host-local installation directories
are generated outside the repository; no runtime mirror is committed under `.agents/plugins`.
