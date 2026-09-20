# Migration ledger and execution plan

**Status:** active
**Goal:** retire every legacy Azalee game-engine/tooling implementation after proving its `niers`
owner and adapters

## Definition of migrated

A capability is migrated only when:

1. one Rust library owns its parsing or domain behavior;
2. required HTTP, CLI, MCP, WASM, browser, and desktop adapters call that owner;
3. fixtures and production-shaped data exercise the owner;
4. the old Azalee route, component, asset, dependency, API, and deployment hook are removed;
5. navigation, sitemap, metadata, redirects, tests, lockfiles, and documentation no longer point
   at the removed surface;
6. acceptance gates pass and their counts are recorded.

Copying a React page, vendoring a WASM artifact, or proxying the old service does not satisfy the
definition.

## Capability ledger

| Legacy Azalee area | Target in `niers` | Current direction | Remaining proof/action |
|---|---|---|---|
| Native FFI and Bun decoder bridge | `nie-formats`, `nie-ffi`, thin host binding | retired from Azalee | keep FFI out of the public wiki; verify no reverse dependency from `rg` |
| Vendored `nie_wasm` | `nie-wasm` built by the canonical web pipeline | owned here | preserve smoke, feature, size, and cross-host gates |
| Avatar workshop | avatar libraries plus `inacord-ui` and Inacord | owned here | close feature/visual gaps using measured game references; do not restore `/avatar` in Azalee |
| Menu explorer/runtime | menu/ Lua/core crates and menu HTTP routes | owned here | resolve named visibility/transform gaps; validate images with `just ecrans` |
| Raw asset gallery | `nie-wiki::gallery`, media formats, shared gallery UI | owned here | classify every retained `data/azalee` artifact and prove provenance |
| 3D viewer and model gallery | `nie-render3d`, `nie-viewer-web`, model server | owned here | maintain WebGPU/WebGL behavior and explicit fallback coverage |
| CPK explorer | `nie-formats`, CLI, author-only Inacord inspection | retired from public Azalee | keep raw filesystem/hex/edit controls behind author capability |
| Stats calculator | shared rule library plus tool adapters | owned here | cross-check CLI/HTTP/UI outputs on identical fixtures |
| Character comparator | shared rule/query library | owned here | deterministic comparison contract and browser interaction test |
| Random team and team builder | shared game/team libraries | owned here | formation/constraint fixtures and persistence contract |
| Translator | game text contracts | owned here | cover shipped locales and unsupported-locale behavior |
| Save reader | save/format library and roster endpoint | owned here | malformed/cross-version fixtures; remove compatibility route when callers are gone |
| Video/audio/textures | format/media crates and on-demand catalogues | owned here | codec/asset provenance and browser playback/download tests |
| Wiki data and cards | `nie-wiki`, `nie-site`, shared wiki UI | owned here for IEVR data | keep editorial/account concerns in `rg`; measure collection parity |

Statuses above are architectural direction, not immutable completion claims. `PLAN.md`, current
tests, and generated route/capability inventories provide the mutable state.

## Execution order

### Phase 1 — inventory and freeze the boundary

- Generate route, package, dependency, asset, and deployment inventories in both repositories.
- Mark each legacy Azalee surface as editorial, IEVR read-only, authoring, or runtime.
- Reject new game-engine code in `rg/apps/azalee` through review and automated scans.
- Catalogue `data/azalee` by producer, license/provenance, consumer, regeneration command, and
  intended owner. Do not delete ambiguous data until consumers and provenance are known.

### Phase 2 — establish the library owner

- Move reusable behavior into the crate named in `OWNERSHIP.md`.
- Add unit tests with real-format or production-shaped fixtures.
- Remove framework, HTTP, CLI, filesystem-host, and presentation assumptions from the owner.
- For reverse-engineered behavior, attach machine evidence and use `just preuves` where suitable.

### Phase 3 — attach adapters

- Add or update `nie-site` DTOs and bounded routes.
- Keep `nie-cli` and MCP as thin callers.
- Expose browser-safe functions through the existing WASM modules only when browser execution is
  required; prefer HTTP for server-owned data.
- Reuse `packages/inacord-ui` for browser/desktop presentation with explicit capability flags.

### Phase 4 — prove parity

- Compare owner results across at least two adapters using the same serialized fixture.
- Test error, empty, pagination, locale, and malformed-input paths.
- For visual features, compare rendered output, interactions, responsive behavior, reduced
  motion, keyboard access, and touch targets.
- For game reconstruction, use image evidence and game-derived inputs rather than screenshots of
  the legacy Azalee implementation as the sole oracle.

### Phase 5 — decommission the legacy surface in `rg`

For each removed feature, delete and verify all of the following:

- route directory and route handlers;
- API proxy or compatibility handler;
- client/server components and tests;
- vendored WASM, decoder, model-viewer, Draco/Basis, menu, and generated index artifacts;
- package dependencies and TypeScript ambient types;
- navigation, search, home cards, sitemap, metadata, Open Graph, redirects, CSP exceptions, ads
  exclusions, service worker/precache, screenshots, release scripts, and monitoring probes;
- stale imports, route strings, lockfile entries, generated build output, and documentation.

Preserve unrelated concepts with the same name. A user profile avatar is not the game avatar
workshop; a wiki gallery card is not the raw asset gallery.

### Phase 6 — remove compatibility

- Instrument and identify every caller before removing an old path.
- Publish an explicit canonical replacement in the response or documentation.
- Keep a compatibility route only when a real caller remains and the route delegates to the same
  library owner.
- Give each compatibility route an owner, removal condition, and regression test. Indefinite
  aliases are migration debt.

## Repository-specific checklist

### `niers`

- [ ] Library owner is named and contains the behavior.
- [ ] HTTP/CLI/MCP/WASM/native adapters are thin.
- [ ] Public and authoring capabilities are separated.
- [ ] Route and capability inventories include the new surface.
- [ ] Data provenance and generators are documented.
- [ ] Narrow tests, layer/dependency gates, and relevant Rust gates pass.
- [ ] `PLAN.md` records the durable result and next measurable action.

### `rg`

- [ ] No legacy FFI, WASM, CPK, game avatar, menu, raw gallery, 3D, or tool implementation remains
  in Azalee.
- [ ] Wiki/editorial pages do not import a removed viewer or tool.
- [ ] Navigation and sitemap contain no dead destination.
- [ ] Shared Website/Azalee twins are either byte-identical or have a documented product-boundary
  divergence with a test.
- [ ] Package manifests and lockfile contain no orphaned engine/viewer dependency.
- [ ] Type checks, route tests, unit tests, and production builds pass under normal resource
  conditions.

## Known documentation debt

The following documents or comments must be reconciled rather than copied as current truth:

- `docs/SITE.md` descriptions that equate the whole wiki product with the removed implementation;
- `docs/architecture/package-ownership.md` references to legacy Azalee hosts and viewer stacks;
- `docs/architecture/desktop-site-capabilities.md` entrypoint and capability assumptions;
- `docs/AVATAR.md` references to the former Azalee `/avatar` facade;
- `deploy/README.md` references to a Bun-owned IEVR wiki deployment;
- legacy deployment comments and compatibility names that imply Azalee is deployed from this
  repository.

Resolve them in bounded documentation batches after checking the current code. Do not rewrite
unrelated historical evidence that clearly labels itself as historical.
