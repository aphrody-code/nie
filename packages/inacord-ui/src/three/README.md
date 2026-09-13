# Shared Three.js editor viewport

`Viewport3D.tsx` owns the existing multi-asset WebGL editor viewport. Hosts supply
assembled GLB payloads and `services.decodeBase64`; the component has no desktop
API, VFS transport, filesystem, or application-alias imports. Rust continues to
own native format decoding and model assembly.

The desktop `components/editor/Viewport3D.tsx` is a compatibility binding. It injects the
existing byte conversion utility. Its only caller is `EditorView`: `ModelPreview`, the
Explorer's preview pane, moved to `RustModelViewport` on 2026-09-13 — it showed one model with
`selectedId` permanently `null` and no gizmo, so it was paying for a second rendering engine and
using none of what distinguishes it.

Preserved capabilities include multi-asset loading and disposal, scene outliner
records and statistics, raycast selection, transform gizmos and callbacks,
wireframe and grid toggles, orbit controls, camera presets, automatic framing,
resize observation, GPU context lifecycle, and loading/error/empty overlays.
Transforms remain local to the mounted session. Asset keys retain their current
immutable-payload contract; changing bytes under an existing key is not a reload
API.

This extraction does not change material presentation or add Draco/KTX loaders.
Compressed model-viewer consumers retain their supported loader adapter until
their complete feature contract can be migrated. The native Rust renderer remains
the separate reconstructed-game target; this authoring viewport is not evidence
of native rendering parity.

## The other renderer, and what still separates them

`RustModelViewport` (`../shell/rust-model-viewport.tsx`) is the OTHER model surface in this
repository, and it is the one every page uses: `/avatar`, `/models-3d` and the game viewer all
reach `nie-render3d` through WebGPU, its WebGL 2 backend in `nie-viewer-web`, or the CPU
rasteriser, in that order (`apps/nie-web/src/game/native-viewer.ts`). That chain replaced a
445-line TypeScript WebGL viewer in 2026-09; this file is what is left of the same class.

What keeps them apart is measured, not rhetorical. `WebViewer` holds ONE model and exposes
orbit, resize and render. This viewport holds several assets at once and adds ray picking, a
node outliner with per-mesh statistics, transform gizmos, wireframe and a grid. Nothing in
`nie-render3d` performs picking today — `rg 'raycast|ray_'` over the crate returns only
`depth_or_array_layers`. Retiring this file therefore means writing multi-asset scenes,
picking and gizmo interaction in Rust first; until then, deleting it would remove editing,
not duplication.

The scene DOCUMENT is no longer duplicated: `SceneDocumentV2` in `nie-render3d` is the one
model, and `nie-editor`'s `EditorSession` is the one session, shared by the native editor and
the browser bindings. This component still keeps its own React state for the loaded GLB nodes,
which are sub-nodes of an asset and have no representation in that document.
