# Provenance

`niers` is the maintained implementation and the only build/runtime surface in this repository.

| Area | Maintained owner | Historical source |
|---|---|---|
| Formats, VFS, data, Lua, runtime and rendering | Rust crates under `crates/` | [iecode-cpp](https://github.com/aphrody-code/iecode-cpp), [iecode-csharp](https://github.com/aphrody-code/iecode-csharp) |
| Web, desktop UI and integrations | `apps/`, `packages/` | this repository |
| Reverse engineering and binary production | `crates/forge/` | this repository and the measured game executable |

The C++ and C# trees were exported at their final tested revisions on 2026-09-07 and are not
dependencies of Cargo, Bun, CI, deployment, or release packaging. The detailed source-to-crate
ledger is [`docs/IECODE-MIGRATION.md`](docs/IECODE-MIGRATION.md).

Game assets and signed third-party launch components remain external and are never versioned here.
See [`NOTICE`](NOTICE) and [`LICENSE`](LICENSE) for the applicable attribution and distribution
boundary.
