# Operations, data, and deployment boundary

**Status:** normative operational guide
**Scope:** building and shipping the capabilities migrated from Azalee

## Separate products and release lanes

The Rose Griffon Azalee frontend and the `niers` site are separate deployable products. Migrating
a capability to `niers` does not authorize deploying, restarting, or rewriting the other
repository. It also does not make the legacy Azalee deployment scripts canonical.

For this repository:

- `bun run release:all` is the only whole-repository release orchestrator.
- `bun run deploy:target web` is the supported targeted web publisher.
- `scripts/release-inacord.ts` owns Inacord distribution.
- `deploy/nginx` and `deploy/systemd` are the versioned infrastructure sources.
- Production mutation must use the repository publisher and its health checks/rollback, never a
  hand-written symlink swap or direct copy into `/etc`.

An ordinary build is not a deployment. Build output must never resolve to the live bundle target.

## Data ownership and provenance

### IEVR mirror

The Rust wiki/site owns IEVR mirror reads. Consumers use typed library queries or bounded API
contracts. A TypeScript frontend must not open the mirror as a second query implementation.

Every mirror-dependent feature must define:

- required tables/views and stable identifiers;
- behavior when the mirror is absent, invalid, or stale;
- maximum query/page size;
- meaningful health evidence, not only successful SQLite open;
- schema or projection compatibility tests.

### `data/azalee`

Treat `data/azalee` as a migration holding area, not a permanent ownership declaration. For each
tracked file, record:

| Field | Required value |
|---|---|
| Producer | crate/script/external source that creates it |
| Provenance | game path, public source, or authored source |
| Consumer | exact source paths or generated contract |
| Regeneration | deterministic command, inputs, and expected schema |
| Validation | count/hash/schema check with non-zero expectations |
| Destination | canonical crate/package/data directory |
| Retention | migrate, regenerate, archive as evidence, or delete after callers disappear |

Never commit raw copyrighted dumps merely because the old Azalee tree contained an index derived
from them.

## Browser and WASM operations

The browser build has three measured modules with different loading boundaries:

1. `nie-wasm` — main runtime, paid by every game visitor;
2. `nie-viewer-web` — on-demand 3D viewer fallback;
3. `nie-lua-web` — Lua runtime with its own Emscripten toolchain.

Use the canonical build scripts in `apps/nie-web/scripts`. Preserve wasm-bindgen version
alignment, feature validation, smoke tests, atomic artifact publication, and byte budgets. Do not
copy a built module into `rg` or add a legacy Azalee-specific builder.

The initial browser readiness path must remain free of optional gallery, model, texture, audio,
video, menu-replay, and secondary-scene preloads. Load migrated capabilities on demand.

### Split VFS candidate

Build native archives from a licensed installation into a fresh candidate directory. Existing
outputs are refused, and the split manifest is written only after every archive succeeds:

```text
niers vfs bundle --profile aphrody_lean --screen main_menu --locale fr \
  --game-dir <licensed-installation> --out <new-candidate>.nievfs \
  --split-dir <new-candidate-directory>
NIERS_VFS_BUNDLE_DIR=<absolute-candidate-directory> bun run --cwd apps/nie-web build
```

The existing Vite pipeline stages the four content-addressed archives under `static/game/vfs`,
checks SHA-256 and disjoint manifest paths, then the canonical precompression step produces Brotli
and Zstandard variants. This is not publication. The readiness gate still downloads no archive:
Lua menu entry requests `menu` only after readiness, and media consumers request cold archives by
exact resource path. Rust verifies all entry CRCs before mounting. Lua, layout composition, fonts,
localized text and media share mounted bytes. Installations without a manifest retain individual
VFS reads. This integration does not certify the remaining native menu-manager reconstruction.

## Configuration

- Validate environment-derived paths and URLs at the boundary.
- Do not expose absolute host paths in public responses.
- Keep secrets out of generated client configuration and logs.
- Prefer capability discovery endpoints to duplicated frontend constants.
- Locale, theme, density, font scale, reduced motion, and UI zoom are runtime preferences, not
  reasons to fork a game-data implementation.

## Rollback

A release candidate must retain the previous immutable bundle/artifact and roll back when health
or meaningful interaction checks fail. A successful process start is insufficient. Validate a
non-empty content-backed response for each migrated family included in the release.

Compatibility rollback restores the previous adapter or route, not the removed implementation.
If rollback requires restoring vendored FFI/WASM/3D code to Azalee, the migration was not isolated
correctly.

## Observability

For each public migrated surface, record:

- route or entrypoint;
- owner crate and adapter;
- latency/size bound where relevant;
- empty versus unavailable semantics;
- a payload or interaction probe;
- the exact release commit.

Logs and errors must not reveal repository identity, machine paths, versions, tokens, or internal
service topology.
