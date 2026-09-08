# Shared Three.js editor viewport

`Viewport3D.tsx` owns the existing multi-asset WebGL editor viewport. Hosts supply
assembled GLB payloads and `services.decodeBase64`; the component has no desktop
API, VFS transport, filesystem, or application-alias imports. Rust continues to
own native format decoding and model assembly.

The desktop `components/editor/Viewport3D.tsx` is a compatibility binding. Its
existing callers (`EditorView` and lazy `ModelPreview`) retain their props and
type imports. It injects the existing byte conversion utility.

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

## Preview and reconstruction adapters

`ModelViewerSurface` owns the shared gallery/detail lifecycle of the existing model-viewer
adapter. Azalee wrappers retain their dialogs, downloads, visibility suspension, availability
checks, rotation and shadow settings. The host loader retains local Draco, Basis and Meshopt
configuration. Do not replace this adapter with the editor's unconfigured GLTFLoader and lose
compressed-model support. This is a compatibility rendering backend, not another editor.

The optional `character-renderer.ts` implementation has one library home here and an Azalee
re-export. No current mounted consumer was found; its cel/outline behavior is retained without
claiming that it is an active application feature.

The Rust `RustModelViewport` remains the separate game reconstruction adapter. It is not the
Inacord editor renderer and does not currently implement the editor's selection/TRS contracts.
All new editor features extend `Viewport3D`; all preview lifecycle changes extend the shared
preview adapter. Consolidating these rendering backends requires measured compressed-format,
material, camera and editing parity first; source ownership is unified, backend parity is not
asserted by this extraction.
