# Canonical ownership matrix

**Status:** normative
**Scope:** post-Azalee ownership of IEVR capabilities

Each row identifies the library owner, allowed adapters, and the evidence expected before the
legacy implementation can be removed. An adapter may translate transport and presentation; it
must not reimplement parsing or domain rules.

| Capability | Canonical owner | Allowed adapters and presentation | Primary evidence |
|---|---|---|---|
| Game entities and typed tables | `nie-data`, `nie-wiki` | `nie-site`, `nie-cli`, MCP, Inacord | library tests; wiki route tests; meaningful row counts |
| Wiki search and cards | `nie-wiki::{query,cards,catalog}` | `/api/v1/wiki/*`, `WikiCards`, desktop wiki components | `nie-wiki` tests; `nie-site/tests/wiki_catalog.rs` |
| Names and localization | `nie-wiki::names`, `nie-site::i18n`, game text APIs | server pages, `useGameText`, `<GameText>` | shipped-locale tests; fallback and missing-description tests |
| Auras, tactics, passives, quests, shops, capsules, trophies, coaches, drops | matching `nie-wiki` modules | read-only HTTP and UI cards/details | route inventory plus collection/detail tests |
| Stats, comparison, random team, team builder | game-rule library and `nie-wiki` projection | HTTP POST contracts, desktop tools, CLI | deterministic fixtures; cross-adapter equality |
| Save decoding and roster resolution | format/save library, `nie-wiki` lookup | `nie-site::routes::save`, CLI, Inacord | malformed-input tests; roster ordering/deduplication tests |
| CPK and binary formats | `nie-formats` | CLI, native export, bounded read-only HTTP inspection | real-fixture and round-trip gates; no frontend decoder |
| Menu discovery and composition | `nie-formats::menu`, `nie-lua`, `nie-core` | `nie-site` menu routes, `nie-game`, WASM, Inacord | `just preuves`, composition counts, `just ecrans` |
| Main browser runtime | `nie-wasm` | `apps/nie-web` host | wasm target checks, smoke test, size budget |
| Lua browser runtime | `nie-lua-web` | on-demand menu replay | bytecode compatibility fixtures and runtime smoke test |
| Avatar data and assembly | `nie-data`, `nie-formats`, `nie-render3d` | `nie-cli avatar`, `packages/inacord-ui/src/avatar`, Inacord | reference/assembly tests; native and browser render evidence |
| 3D model decoding/rendering | `nie-formats`, `nie-render3d`, `nie-model-serve` | `nie-viewer-web`, Inacord viewport, read-only HTTP metadata | parser tests; CPU/GPU framing gates; viewer smoke tests |
| Gallery and media catalogue | `nie-wiki::gallery` and media/format crates | `packages/inacord-ui/src/gallery`, `CatalogMedia`, HTTP | catalogue provenance; filters/export tests; asset availability |
| Reverse-engineering and raw inspection | forge/RE crates and the atlas | Inacord author workspace, CLI, MCP | atlas references; bounded RE gates; never public by default |
| Account, news, moderation, association content | Rose Griffon `rg` | Azalee/Website applications | `rg` tests and deployment; outside the IEVR owner graph |

## HTTP contracts already owned here

The router in `crates/tools/nie-site/src/app.rs` is the route inventory. The wiki family includes
search, gallery, names, character, skill, item, team, comparison, random team, team builder,
auras, tactics, passives, quests, shops, capsules, costumes, stadiums, trophies, coaches, drops,
and invocation. Save roster resolution, 3D, menus, screens, text, formats, entities, rules, and
game-data contracts are separate bounded families.

Do not infer completion from route presence. A route is complete only when it returns a meaningful
non-empty payload where data exists, preserves pagination and error semantics, and is tested
against the library owner rather than a second fixture-only implementation.

## Adapter rules

### HTTP (`nie-site`)

- Read-only catalogue endpoints use explicit DTOs, pagination, bounded queries, and stable errors.
- Mutation or expensive decode contracts must state limits and must not expose arbitrary host
  paths.
- Register literal routes before catch-all routes and cover the route inventory in tests.

### CLI (`nie-cli`)

- Calls the same library function as HTTP/WASM.
- Human formatting belongs in the CLI; domain results remain serializable and reusable.
- A command is not evidence that browser or native adapters have parity.

### MCP

- `packages/mcp/src/tools/azalee.ts` is a compatibility name over local Rust/SQLite-backed reads.
- Keep tools read-only unless a separately authorized mutation contract exists.
- Do not make MCP the only caller or implementation of a capability.

### Browser and desktop

- `packages/inacord-ui` owns shared presentation and explicit public/authoring capability modes.
- `apps/nie-web` owns browser routing and host integration, not domain behavior.
- Inacord owns native filesystem/process privileges. Browser adapters must fail explicitly for
  unavailable native operations.

### WASM

- Keep the existing three-module architecture: main runtime, on-demand viewer, and Lua module.
- Native filesystem/database code must not enter a `wasm32-unknown-unknown` dependency graph.
- Do not add a fourth module without a measured capability and transfer-size justification.

## Data boundary

`niers` owns IEVR mirror reads and derived game-data indexes. Bun/TypeScript may consume stable
Rust contracts but must not become a second direct IEVR query layer. `rg` owns identity and
editorial records. Joining the two domains happens through explicit public identifiers and
contracts, never by importing the other repository's internal database client.
