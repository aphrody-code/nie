# Benchmarks

The benchmark surface is Rust-only. Historical C++ and C# comparison harnesses were exported
with their source trees and are no longer invoked by repository scripts.

## Reproducible local run

```powershell
cargo build --release -p nie-bench
cargo bench -p nie-formats
cargo bench -p nie-site
```

Record CPU, OS, Rust toolchain, commit, input fixture identity, and the measured sample count with
each result. Never include copyrighted game payloads in a benchmark artifact.

## Release gate

`scripts/build-release.ps1` builds `nie-cli` and runs its tests. `scripts/package-release.ps1`
packages `target/release/niers.exe`; neither script requires CMake, vcpkg, .NET, or an external
toolkit.
