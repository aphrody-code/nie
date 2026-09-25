# IECODE migration ledger

`nie` is now the only implementation shipped in this repository. The former native and .NET
toolkits were exported at their final tested revisions to [iecode-cpp](https://github.com/aphrody-code/iecode-cpp)
and [iecode-csharp](https://github.com/aphrody-code/iecode-csharp). They remain historical references,
not build dependencies. The sibling `../iecode` Rust workspace is different: it IS a build
dependency (see below).

## Mapping

| Legacy area | Rust owner in `nie` | Migration status | Compatibility evidence |
|---|---|---|---|
| CPK/CRI-FS, UTF, ACB/AWB/USM, ADX/HCA | `nie-formats` | complete | format unit tests and real-fixture gates |
| Level-5 CFG/RDBN/T2B, G4*, OBJBIN, MEVBIN, NAVM, P3LIP | `nie-formats` | complete for supported formats | parser tests, VFS dispatch, coverage matrix |
| CPK dump/pack/merge/crypto and presets | `nie-viola` | complete | real-game dump, resume, merge and round-trip checks |
| Steam session, depot resolution, download and token store | `nie-steam` | complete | Rust crate tests; live Steam is credential-gated |
| Lua bytecode VM, includes and menu host | `nie-lua` | complete for the shipped host surface | 1,197-script audit and menu golden tests |
| menu layouts, sprites, models and GLB export | `nie-game`, `nie-render3d`, `nie-formats` | complete for the documented surface | render and geometry gates |
| game data, passive skills and typed tables | `nie-data` | complete for the indexed datasets | data crate tests and site coverage |
| RE/index/dump/trace tooling | `nie-re`, `nie-dump`, `nie-index`, `nie-trace`, `nie-forge` | complete for the current workflows | workspace gates and forge identity report |
| native FFI and Bun/WASM integration | `nie-ffi`, `nie-wasm`, `packages/nie-plugin` | complete | FFI build and Bun type/test gates |
| C++ runtime/gameplay prototype | no shipped replacement; `nie-game` is the maintained runtime boundary | retired from this repository | retained only in the dedicated historical repository |
| .NET CLI façade | `nie-cli` | retired; all maintained commands are native Rust | `scripts/sync-gamedata.ts` uses `nie` directly |

## Portable crates owned by `../iecode` (2026-09-22)

The flow also runs the other way. Six portable crates that carry no Inazuma-specific logic moved
**out** of `crates/` into the sibling `iecode` repository's Rust workspace, and nie consumes them
through path dependencies in the root `Cargo.toml` `[workspace.dependencies]` (checked
2026-09-25, `grep -n '\.\./iecode' Cargo.toml`):

| iecode package | Alias used in nie | Path |
|---|---|---|
| `iecode-re` (generic PE/ELF/Mach-O triage, hashing, strings, x86 disassembly) | `aphrody-re` | `../iecode/crates/re` |
| `iecode-sql` | `nie-sql` | `../iecode/crates/sql` |
| `iecode-video` | `nie-video` | `../iecode/crates/video` |
| `iecode-emu` (DS/3DS/Wii/Android backend registry, no emulator core) | `nie-emu` | `../iecode/crates/emu` |
| `iecode-geom` | `nie-geom` | `../iecode/crates/geom` |
| `iecode-tasks` | `nie-tasks` | `../iecode/crates/tasks` |

No duplicate source copy remains under `crates/`. The crates are package-ready for crates.io, but
publication needs a `CARGO_REGISTRY_TOKEN` that is not configured; **until they are published,
the `../iecode` path edges stay**, because removing them breaks the passing workspace build. A
checkout of nie therefore needs a sibling `iecode` checkout to build. Dropping the path edges is an
open item in [`PLAN.md`](../PLAN.md).

## Retired build surface

The root CMake/vcpkg files, `src/`, `csharp/`, `IECODE.sln`, and the C# benchmark are removed from
the repository. No Cargo, Bun, CI, or deployment target references those trees as an executable
dependency. Historical mentions in design and provenance documents identify the source of a port;
they are not supported commands.

## Verification record

Measured on Windows, 2026-09-07, before removal:

- C# Release build: 0 warnings, 0 errors; tests: 272 passed, 2 failed on encrypted external-data
  fixtures.
- C++ Release build: successful; direct test runner: 468 passed, 6 disabled.
- Rust/Bun gates after removal are the authoritative gates for this checkout.

Re-run the repository gates after any migration change:

```text
cargo check --workspace --tests
cargo clippy -p nie-cli --bins --tests -- -D warnings
bun run typecheck
bun run test
```
