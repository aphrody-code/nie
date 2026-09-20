# Azalee migration and ownership

**Status:** active migration ledger
**Scope:** the legacy Azalee game-data, tooling, media, avatar, menu, 3D, and wiki surfaces
**Last reviewed:** 2026-09-20

This directory defines what must move from the historical Azalee application into `niers`, what
must remain in the Rose Griffon repository, and which implementation owns each capability after
the migration.

It is an appendix to [`PLAN.md`](../../PLAN.md). `PLAN.md` remains the active execution plan and
decision ledger. If a status statement here conflicts with measured code or `PLAN.md`, measure the
current checkout, update both documents, and treat the code plus its tests as the operational
truth.

## The boundary in one sentence

Azalee in `rg` may remain a public editorial wiki, account, news, and community frontend; it must
not own game parsing, FFI, WebAssembly runtimes, avatar reconstruction, menu reconstruction, raw
asset galleries, model rendering, save decoding, or game-data tools. Those capabilities belong to
the reusable Rust libraries and thin adapters in `niers`.

Do not create a new `apps/azalee` in this repository. Browser delivery uses `apps/nie-web`, native
delivery uses Inacord, HTTP uses `nie-site`, and data/query behavior belongs in Rust libraries.

## Reading order

1. [`OWNERSHIP.md`](OWNERSHIP.md) — canonical owner and adapter for every migrated capability.
2. [`MIGRATION.md`](MIGRATION.md) — work ledger, dependency order, and compatibility policy.
3. [`OPERATIONS.md`](OPERATIONS.md) — build, release, deployment, data, and rollback boundaries.
4. [`ACCEPTANCE.md`](ACCEPTANCE.md) — tests and evidence required before a migration item is done.

## Vocabulary

| Term | Meaning in these documents |
|---|---|
| **Azalee frontend** | The public wiki/editorial application still maintained in `/home/ubuntu/rg/apps/azalee`. |
| **legacy Azalee surface** | A game-engine or tooling feature formerly embedded in that frontend. |
| **`niers` owner** | The Rust library that implements behavior independently of HTTP, CLI, MCP, browser, or desktop. |
| **adapter** | A thin caller of an owner: `nie-site`, `nie-cli`, MCP, WASM, Inacord, or `nie-web`. |
| **compatibility route** | A temporary old contract backed by the canonical owner, with a named removal condition. |
| **editorial data** | News, association content, accounts, moderation, and other non-game domain data owned by `rg`. |
| **IEVR data** | Game entities, assets, formats, rules, saves, menus, models, and derived indexes owned by `niers`. |

## Non-negotiable rules

- A CLI, HTTP route, MCP tool, React component, and WASM export are adapters, never independent
  implementations.
- Extract behavior into a Rust library first, test it there, then attach adapters.
- `rg` must not vendor a `nie_*.wasm`, native FFI binding, CPK decoder, model viewer, or game dump
  to restore a removed Azalee feature.
- Public DTOs expose stable domain fields, not filesystem paths, process identity, service names,
  repository fingerprints, or secrets.
- The game VFS names resources. Machine-readable routes, filenames, variables, types, and schemas
  use English and preserve the VFS `snake_case` identifier where one exists.
- Game interface strings come from the shipped game text through the canonical text contracts.
  Hand-written interface text is localized explicitly and never presented as game-authored text.
- Do not copy copyrighted game dumps into Git. Derived manifests require provenance, a generator,
  and a reproducible validation command.
- Production configuration is versioned under `deploy/`. Do not document `/etc` as the source.

## Current source-of-truth map

- Data and query layer: [`crates/tools/nie-wiki`](../../crates/tools/nie-wiki)
- HTTP routes: [`crates/tools/nie-site/src/routes`](../../crates/tools/nie-site/src/routes)
- Browser application: [`apps/nie-web`](../../apps/nie-web)
- Shared UI: [`packages/inacord-ui`](../../packages/inacord-ui)
- Native/CLI entrypoint: [`crates/tools/nie-cli`](../../crates/tools/nie-cli)
- WASM runtime: [`crates/engine/nie-wasm`](../../crates/engine/nie-wasm)
- 3D runtime: `nie-render3d`, `nie-viewer-web`, and `nie-model-serve`
- Format decoding: `nie-formats`
- Game rules: `nie-core` and the relevant domain crates
- MCP compatibility: [`packages/mcp/src/tools/azalee.ts`](../../packages/mcp/src/tools/azalee.ts)
- Active decisions and volatile measurements: [`PLAN.md`](../../PLAN.md)

## Historical decision trail

The migration is a sequence, not a single restorable commit. The Rose Griffon history records the
removal of menu/game surfaces, the transfer of game data/assets and services to `niers`, the CPK
UI purge, and the deployment boundary. The `niers` history then records the Rust ownership of
Azalee and Inagle capabilities. Historical commits explain intent; they are not a reason to reset
either dirty worktree or restore an old application wholesale.

Any future migration change must update the ledger in [`MIGRATION.md`](MIGRATION.md), run the
relevant gates in [`ACCEPTANCE.md`](ACCEPTANCE.md), and add only the durable result and next
measurable action to `PLAN.md`.
