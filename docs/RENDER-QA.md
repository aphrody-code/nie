# Rendering: graphics backends, and visual QA of a GLB

Moved out of `README.md` on 2026-09-19, where it was crowding the quick start.

## Platform support

The same binary serves a headless Linux server and a Windows workstation:

| | Linux server | Windows workstation |
| --- | --- | --- |
| Graphics backend | Vulkan — lavapipe when there is no hardware | **D3D12** first, Vulkan as fallback |
| Adapter | the only one, software | `HighPerformance` → the discrete GPU |

Backends are probed **one at a time, in order**. Handing wgpu a combined mask lets *it* pick, and
its order is not ours. Override with `NIE_WGPU_BACKEND` (`dx12`, `vulkan`, `metal`, `gl`), or force
the software path with `NIE_WGPU_FORCE_FALLBACK=1`.

Verified on an RTX 4070: D3D12, Vulkan and the software rasteriser produce captures with the
**same SHA-256**. A pixel gate held on a GPU-less server therefore reproduces on a workstation.

## Visual QA of an assembled GLB

`niers render` produces reviewable artefacts from an assembled GLB: a lossless PNG for a stable
reference view, and a looping GIF turntable for silhouette, UV and texture checks. It keeps the
same camera framing across runs, and bounds dimensions and frame count so an accidental command
cannot exhaust the workstation.

```bash
# A reproducible real-character probe: Shawn Froste's c02023290 model.
niers render glb-png c02023290.glb -o shawn.png --width 2048 --height 2048 \
  --gpu --backend dx12 --hardware-only
niers render glb-gif c02023290.glb -o shawn-turntable.gif --width 720 --height 720 \
  --frames 24 --fps 12 --gpu --backend dx12 --hardware-only
```

Without `--gpu`, the deterministic CPU renderer is used. `--gpu` creates one renderer for the
entire export, uses linear texture filtering and smooth shading, and composites the transparent
viewport over the same opaque QA background as CPU captures. `--hardware-only` turns a missing
real adapter into a clear failure instead of silently testing a software adapter.

**A PNG or GIF is a visual inspection aid, not proof of pixel-perfect equivalence to an in-game
screenshot.** Compare against a capture made with the same camera, and record the backend.

## The three rasterisers must agree

`nie-render3d` carries a CPU rasteriser, a GPU path and a scene renderer, and they have silently
disagreed twice — on field of view (horizontal vs vertical half-angle: IoU 100 % at 128×128,
**26 %** at 256×128) and on winding (glTF front faces are CCW, and Y-down screen space makes their
area negative). Both are fixed; both were invisible to the tests that existed, because the
CPU↔GPU test only ever measured a square viewport and the GPU sets `cull_mode: None`.

A viewport is never square, and `native-viewer.ts` falls back to the CPU rasteriser when WebGPU
is absent — so the same model changed size with the browser. Check a non-square viewport before
concluding two rasterisers agree.
