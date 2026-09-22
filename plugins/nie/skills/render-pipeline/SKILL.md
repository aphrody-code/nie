---
name: nie-render-pipeline
description: Surface Rust unifiée de rendu NIE pour CPU, GPU, WASM, GUI, site et nie-model-serve.
---

# NIE render pipeline

## Canonical crates

- `crates/engine/nie-render3d`: GLB, rastériseur CPU, wgpu et viewer web.
- `crates/engine/nie-render`: contrat RGBA8, composition bornée 2D/3D et adaptateurs runtime.
- `crates/tools/nie-model-serve`: résolution VFS/CRC, assemblage GLB et cache HTTP.
- `crates/tools/nie-site`: gateway public, cache/ETag, proxy borné et readiness.

## Invariants

- `nie-render3d::render::render` reste déterministe et headless.
- Le cadrage CPU/GPU est partagé par `FOCALE`, `DISTANCE_CAMERA` et `TILT`.
- Toute entrée image vérifie dimensions, multiplication et budget avant allocation.
- Les chemins VFS passent par la normalisation du site ou les gardes de l'amont.
- Aucun secret, chemin absolu ou accès système ne traverse la surface WASM.

## Gates

```text
cargo fmt --all -- --check
cargo test -p nie-render3d -p nie-render -p nie-model-serve -p nie-site --locked
cargo clippy -p nie-render3d -p nie-render -p nie-model-serve -p nie-site --all-targets --locked -- -D warnings
```
