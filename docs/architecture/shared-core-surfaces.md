# Shared core and product surfaces

This repository has one implementation owner per capability. Product surfaces are bindings, not
alternative homes for business logic.

## Dependency direction

```text
nie-formats / nie-lua / nie-data
             ↓
        nie-explore
             ↓
 asset-source + inacord-ui (portable contracts and presentation)
       ↓          ↓          ↓          ↓          ↓
   nie-site     nie-cli    nie-web   Inacord/mobile  MCP/API/future hosts
```

The core owns VFS listing, search, format decoding, asset identity, state transitions and
portable validation. Rust and TypeScript bindings translate transport concerns only. A host may
declare capabilities (for example disk writes or Blender) but must not silently reimplement a
missing operation or invent a successful result.

## Surface rules

- `nie-explore` is the owner for listing/search/preview/export contracts shared by site, CLI and
  Inacord. HTTP, Tauri, CLI and MCP handlers call it through thin adapters.
- `packages/asset-source` is the host-neutral resource contract. Web and desktop adapters provide
  bytes, URLs and capabilities; components never inspect Tauri, HTTP or filesystem globals.
- `packages/inacord-ui` owns portable Explorer presentation, tabs/history reducers, geometry and
  tokens. `apps/nie-web` and Inacord mount the same Explorer surface and supply only adapters.
- Mobile, MCP, API and future services must consume these same contracts. New surface-specific
  logic requires a capability or transport adapter, never a second domain implementation.
- Compatibility facades remain until every consumer has migrated; removal is a separate measured
  batch.

## Required proof

Every shared capability needs reducer/contract tests, one adapter test per host, and a rendered
interaction check. Explorer parity additionally requires same viewport, locale, theme, data state,
asset provenance, screenshot hash and per-region comparison. Passing HTTP requests or a typecheck
alone is not proof of visual or behavioral parity.

## Delivery order

1. Extract and test the core owner.
2. Keep CLI, site, desktop and WASM compatibility facades green.
3. Migrate the shared UI and state reducers.
4. Add mobile, MCP and API bindings over the same owner.
5. Run contract, interaction, cross-target and visual gates before committing a coherent batch.
