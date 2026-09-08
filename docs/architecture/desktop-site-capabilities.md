# Desktop and site capability bindings

Source inventory, 2026-09-08. Implementation status below is source inspection, not a
record of passing build, browser, or deployment gates. The active gate ledger is `PLAN.md`.

| Desktop or Azalee capability | Existing shared owner | Site binding | Remaining distinction |
| --- | --- | --- | --- |
| VFS browse and original bytes | `nie-formats::vfs` | `/b`, `/f/{path}` | Desktop filesystem destinations are host operations. |
| Config and geometry decoding | `nie-formats`, `nie-data` | `/api/v1/formats/decode/{path}`, `/api/v1/donnees/famille/{key}` | Config inspection preserves canonical `lists`/`entries`; desktop joined catalogue DTO parity is not established. |
| Sprite, font and menu inspection | `nie-formats` | `/api/v1/inspect/*` | Inspection is not native screen rendering parity. |
| Lua bytecode and menu callbacks | `nie-lua` | `/api/v1/lua/*`, `/api/v1/menu/runtime/{screen}` | Bounded native replay; unrestricted evaluation and desktop process attachment are not exposed. |
| ACB, AWB, UTF/ACF and USM metadata | `nie-explore::native_metadata`, `native_audio`, `native_video` | `/api/v1/formats/decode/{path}` | Source size bounds apply; MPEG-2 playback, complex synth execution and synchronized USM playback remain unsupported here. |
| Export formats, output names and conversion | `nie-explore::export` | `/api/v1/export/formats/{path}`, `/api/v1/export/file/{path}` | Explicit AWB waveform/USM channel selection; contextual GLB and named ACB cue export are not supplied by this route. |
| Desktop related-file search | `nie-explore::related::legacy_search` | Preserved Tauri compatibility facade | The historical substring search is not a dependency graph and is not used for automatic preloading. |
| Native declared relationships | `nie-explore::related::inspect` | `/api/v1/resources/related/{path}` | OBJBIN paths are exact declarations with explicit locale substitution. Same-stem model peers are separate naming candidates. Font atlas, material and motion target associations remain unresolved. |
| Motion clip inspection | `nie-explore::motion` | `/api/v1/motion/clips/{path}` | Clip metadata does not establish a skeleton or runtime animation binding. |
| Assembled models | Existing assembly and model service | `/api/v1/3d/*`, `/model/*` | These preserve existing service contracts; no complete desktop viewport parity claim. |
| Character growth and comparison | `nie-core` | `/api/v1/regles/*`, `/api/v1/growth/interpolate` | Interpolation requires explicit native control points. |
| Joined Inagle character cards and learned skills | `nie-wiki::cards` using existing `query` joins | `/api/v1/wiki/characters/{id}` | Exact character ID; unknown skills and absent native anchors remain explicit. Raw merged mirror blobs are not public card fields. |
| CLI cross-family wiki search | `nie-wiki::query::search_all` | `/api/v1/wiki/search?q=...` | Existing per-family search limits are preserved; this is not an exhaustive paginated catalogue. |
| Camera and navmesh previews | `nie-explore::spatial_preview` | `/api/v1/preview/camera/{path}`, `/api/v1/preview/navmesh/{path}` | Extracted desktop projections, not runtime scene playback. |
| Azalee save roster resolution | Existing site save resolver | `/api/v1/save/roster` | Identifiers are resolved without uploading a complete local save. |

Remaining portable gaps include joined video catalogue DTO parity. Desktop save/mod staging,
local disk discovery, clipboard, Blender/editor
launch, process tracing and MCP installation require a host context. They are not mapped to
public server operations. Azalee authentication, administration, VRoid, editorial publication
and RAG integrations remain separate services; their existence is not backend parity.

Related-resource responses expose only indexed logical game paths. Consumers may preload
resolved, readable `declared` references. They must not reinterpret `namingCandidates` as confirmed
material, texture, animation or font bindings. Missing and unresolved relationships remain
explicit instead of choosing an unrelated file by substring or basename.
