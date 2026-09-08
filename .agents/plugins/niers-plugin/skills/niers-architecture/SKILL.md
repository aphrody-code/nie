---
name: niers-architecture
description: Map maintained niers Rust crates and Bun packages to responsibilities, with IECODE provenance.
---

# niers architecture

`niers` has two maintained ecosystems: Rust under `crates/` and Bun/TypeScript under `packages/`
and `apps/`. IECODE C++ and .NET were exported to the historical repositories
[iecode-cpp](https://github.com/aphrody-code/iecode-cpp) and
[iecode-csharp](https://github.com/aphrody-code/iecode-csharp); they are not checkout, build, or
runtime dependencies.

## Rust ownership

- `nie-formats`: Level-5, Criware, VFS, and binary codecs.
- `nie-data`: typed game data and indexed tables.
- `nie-core`, `nie-camera`, `nie-lua`, `nie-game`, `nie-render3d`, `nie-runtime`: runtime,
  gameplay, menu, and rendering.
- `nie-viola`, `nie-steam`, `nie-save`: native modding, Steam acquisition, and saves.
- `nie-re`, `nie-index`, `nie-dump`, `nie-trace`, `nie-forge`: reverse engineering and binary
  production.
- `nie-cli`: the only user-facing CLI, named `niers`.

## Bun ownership

`packages/nie` and `packages/nie-plugin` expose Rust through FFI; `packages/asset-source` and
`packages/inacord-ui` provides shared contracts/UI; `apps/nie-web` and `apps/inacord`
are the web, desktop, and MCP hosts.

Before adding a parser or data family, search the owning Rust crate and consult
`docs/IECODE-MIGRATION.md`. A feature is not complete without a counted test or coverage gate.
