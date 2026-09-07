# IECODE absorption — closed

The absorption gate is closed. `niers` is the maintained CLI and Rust implementation; the former
C++ and C# trees are no longer part of this checkout.

The complete source-to-crate mapping, compatibility boundary, measured pre-removal gates, and
historical repository links live in [`IECODE-MIGRATION.md`](IECODE-MIGRATION.md).

The retained implementation boundaries are:

- `nie-formats` for binary formats and VFS parsing;
- `nie-viola` for dump, pack, merge, and CRI crypto;
- `nie-steam` for Steam acquisition;
- `nie-lua`, `nie-game`, and `nie-render3d` for runtime/menu/rendering;
- `nie-data`, `nie-re`, `nie-forge`, and `nie-cli` for data and tooling.

No command should reintroduce a process delegation to `iecode`, `dotnet`, CMake, or vcpkg. New
format gaps are tracked in the active [`PLAN.md`](../PLAN.md) and must be implemented in the
corresponding Rust crate with a counted verification gate.
