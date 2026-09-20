# Verification and acceptance gates

**Status:** required checklist
**Scope:** proof that an Azalee capability is owned and safely delivered by `niers`

## Evidence levels

Do not collapse these into a single “green” claim:

1. **Source evidence** — owner and adapters are structurally separated.
2. **Unit evidence** — pure behavior is tested in the owner crate.
3. **Integration evidence** — adapters agree on production-shaped fixtures.
4. **Build evidence** — supported targets compile and package.
5. **Visual/interaction evidence** — rendered output and controls behave correctly.
6. **Production evidence** — exact released commit answers meaningful live probes.

## Baseline repository gates

Run the narrowest relevant commands first, then the repository gates required by the changed
surface:

```text
cargo clippy -p <library-crate> --lib --tests -- -D warnings
cargo clippy -p <binary-crate> --bins --tests -- -D warnings
cargo check --workspace --tests
cargo check -p nie-wasm --target wasm32-unknown-unknown --locked
bun run typecheck
bun run test
bun run check:layers
bun run check:dependencies
bun run docs:check
git diff --check
```

Use `cargo check -p inacord` for desktop changes. Do not substitute a whole-workspace release
build when a bounded crate gate answers the question.

## Capability-specific gates

### Wiki and game data

- Test collection and detail routes.
- Assert non-zero rows when the fixture/mirror contains the entity family.
- Cover unknown identifiers, absent mirror, schema mismatch, pagination bounds, filtering, sort,
  locale, and duplicate-name behavior.
- Compare the Rust query result with every active adapter on identical IDs.
- Run `crates/tools/nie-site/tests/routes.rs` and `tests/wiki_catalog.rs` when route inventory or
  projections change.

### Tools and rules

- Use deterministic serialized inputs and outputs.
- Compare HTTP, CLI, and UI-visible results.
- Cover invalid limits, duplicate entries, empty teams, impossible formations, and numeric bounds.
- Keep random generation seeded and replayable in tests.

### Save reader

- Cover supported save versions and truncated/corrupt input.
- Enforce input-size and roster-size bounds.
- Preserve input order where the contract promises it and document deduplication.
- Test canonical `/api/v1/save/roster` and any still-supported compatibility contract.

### Formats, FFI, and WASM

- Exercise real-format fixtures without committing raw game dumps.
- Run native and wasm target checks for shared code.
- Verify wasm instantiation and at least one meaningful exported operation.
- Measure the optimized artifact against its budget and report compressed size using the canonical
  build quality.
- Ensure native-only modules do not enter the browser graph.

### Avatar, menu, gallery, and 3D

- Verify data/scene contracts before testing presentation.
- Run browser and native interactions: keyboard, pointer, touch, resize, reduced motion, and
  unavailable-backend behavior.
- For menu reconstruction, run `just preuves <pattern>` and `just ecrans`; HTTP 200 alone is not
  visual evidence, and transparent/empty canvases must fail the check.
- For 3D, cover non-square viewport framing, winding/culling, missing textures, fallback backend,
  selection, gizmos, and transparent reference layers when applicable.
- For gallery/media, cover filtering, pagination, export/download, unavailable assets, and safe
  content types.

## Decommissioning scan in `rg`

Before declaring an Azalee surface removed, scan the application, package manifest, lockfile,
navigation, sitemap, configuration, scripts, tests, and public assets for:

```text
ffi
nie-wasm / nie_wasm
cpk-wasm
model-viewer
@react-three / three
@theatre
mp4-muxer
VRoid game-avatar routes
legacy /avatar, /menu, /gallery, /modeles, /textures, /sons, /videos, /tools, /save, /demo routes
```

Review matches semantically. Do not remove profile avatars, generic gallery UI used by the wiki,
or historical documentation that clearly labels itself as evidence.

Also verify:

- every navigation destination exists;
- removed routes are absent from sitemap and metadata;
- CSP no longer contains exceptions required only by deleted code;
- service-worker and precache lists contain no removed artifact;
- package and lockfile no longer retain orphaned heavy dependencies;
- Website/Azalee shared-file invariants still pass or the product-boundary divergence is explicit.

## Acceptance record template

Add a measured record to the relevant change or `PLAN.md`:

```text
Capability:
Owner crate/function:
Adapters changed:
Legacy paths removed:
Fixtures/data source:
Commands run:
Tests/assertions or records checked:
Artifacts and sizes:
Visual/interaction evidence:
Production commit and probe (if deployed):
Remaining gap and next measurable action:
```

A skipped gate must include the concrete external blocker. Resource pressure, unavailable game
data, or missing credentials are blockers; they are not successful validation.
