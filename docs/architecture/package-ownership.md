# Package and dependency ownership

`PLAN.md` remains the execution plan. This document defines dependency and package boundaries;
it does not certify interface fidelity or complete migration of historical implementations.

## Dependency policy

The root `Cargo.toml` owns Rust dependency versions and paths. Maintained members inherit them,
with consumer-specific features, optional flags and target conditions kept at the consumer.
The root `Cargo.lock` is shared by Inacord and the engine/tool crates.

The root `package.json` owns Bun dependency versions through its workspace catalogue. Local
packages use `workspace:*`; external dependencies use `catalog:` or an explicitly named
compatibility catalogue. Peer requirements describe a published contract and are not rewritten
as installation pins. `bun.lock` records the resolved graph; a catalogue does not imply that
all upstream transitive dependencies share one version.

Run `bun run check:dependencies` to reject independent dependency declarations, missing catalogue
entries, duplicate workspace names and a second desktop lockfile. It checks the maintained
workspace membership rather than archive directories or generated/vendor code.

## One owner per responsibility

| Responsibility | Canonical owner | Consumers and compatibility surfaces |
| --- | --- | --- |
| Browser and desktop frontend source/build | `apps/nie-web` | `apps/inacord` delegates frontend commands and retains the Tauri host. |
| General UI primitives | `packages/ui` | Identical Inacord/wiki primitives re-export these implementations. |
| Game and resource interface composition | `packages/inacord-ui` | Both frontend targets consume its sprites, menus, Explorer reducers and controls. |
| Asset transport, capability and loading contracts | `packages/asset-source` | HTTP and native adapters provide bytes; components do not duplicate decoders. |
| Game file decoding | `nie-formats` | Native, Wasm, Explorer and tooling bindings reuse its parsers. |
| Resource inspection, media and local database sessions | `nie-explore` | Site routes, Tauri commands and portable byte adapters are thin consumers. |
| Game rules and runtime state | `nie-core`, `nie-data`, `nie-runtime`, `nie-lua` by domain | `packages/nie-game` holds existing portable client helpers; Azalee compatibility exports reuse them. |
| Typed wiki mirror queries | `nie-wiki` | Site, CLI and MCP reuse its query/card APIs. Existing desktop raw-query adapters remain a migration boundary. |
| Character candidate ranking | `nie-zukan::api` | Native, Wasm, site, CLI and MCP call the same ranking contract. Historical TypeScript matching pipelines are not declared migrated. |
| Native automation and command dispatch | `nie-cli`, with `nie-mcp` as its host | `packages/nie-bridge` owns the control client contract. The historical Bun MCP protocol facade remains separately tested. |
| Rust FFI consumption | `packages/nie` | `packages/nie-plugin` handles Bun file loading; domain algorithms stay in Rust. |
| Web publishing, storage and service adapters | Existing Azalee, storage, realtime and RAG hosts | Authentication and publishing remain service roles, not duplicated game engines. |

Shared ownership does not require merging unrelated roles into a single package. Compatibility
entrypoints stay until all consumers migrate and their gates pass. Vendored applications such
as `model-viewer` have independent embedded dependency graphs; changing direct Three imports
does not silently upgrade those bundles.

## Current version convergence

The frontend uses the already-present Vite 6 / React plugin 4 pair. Azalee's Vitest host declares
the same Vite dependency explicitly. Direct Three imports and their type package converge on
the existing desktop r185 versions. The r184-to-r185 source audit found only WebGL consumers
using ordinary transforms; rendered parity still requires its separate acceptance gates.

Inacord no longer declares a second frontend dependency set. Nie-web retains its direct imports
and build dependencies; shared libraries keep their own imports in their own manifests. An
unused frontend declaration is not evidence that the corresponding server capability was removed.
