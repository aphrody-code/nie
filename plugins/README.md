# Published extensions

The directories in this folder are versioned deliverables for external hosts.

| Extension | Hosts | Contents |
|---|---|---|
| [`nie/`](nie) | Codex, Claude Code, Antigravity (`agy`) | Host adapters, 18 NIE skills, and the native Rust `nie` MCP declaration |
| [`nie-blender/`](nie-blender) | Blender | G4 asset import, character/map/animation/camera/texture workflows, and native-base patch export |

`nie` follows the multi-host layout used by Aphrody's YOLO package: Codex uses
`.codex-plugin/plugin.json`, Claude Code uses `.claude-plugin/plugin.json` and the local
marketplace, while `agy` uses the root `plugin.json` and `mcp_config.json`. All hosts execute the
same portable native Rust MCP server.

Before adding an ignore rule that affects this directory, check every candidate with
`git check-ignore -v <path>`. These files are product deliverables and must remain present in a
fresh clone.
