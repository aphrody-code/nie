# IECODE migration ledger

`niers` is now the only implementation shipped in this repository. The former native and .NET
toolkits were exported at their final tested revisions to [iecode-cpp](https://github.com/aphrody-code/iecode-cpp)
and [iecode-csharp](https://github.com/aphrody-code/iecode-csharp). They remain historical references,
not build dependencies.

## Mapping

| Legacy area | Rust owner in `niers` | Migration status | Compatibility evidence |
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
| .NET CLI façade | `nie-cli` | retired; all maintained commands are native Rust | `scripts/sync-gamedata.ts` uses `niers` directly |

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
