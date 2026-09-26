# Published extensions

The directories in this folder are versioned deliverables for external hosts.

| Extension | Hosts | Contents |
|---|---|---|
| [`nie-blender/`](nie-blender) | Blender | G4 asset import, character/map/animation/camera/texture workflows, and native-base patch export |

The NIE agent plugin was merged into the single Aphrody plugin
(`../aphrody-os/plugins/aphrody`, enable `aphrody@aphrody-os`) on 2026-09-26; its MCP tools are
the `nie.*` family of `aphrody-mcp`.

Before adding an ignore rule that affects this directory, check every candidate with
`git check-ignore -v <path>`. These files are product deliverables and must remain present in a
fresh clone.
