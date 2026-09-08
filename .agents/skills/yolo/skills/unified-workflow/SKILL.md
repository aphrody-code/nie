---
name: unified-workflow
description: Route Aphrody, WinClean, niers, Ghidra and Computer Use work through bounded runs with manifests, evidence and explicit proof levels.
---

# Unified workflow

Use this skill for any non-trivial task that crosses Aphrody, WinClean, niers,
Ghidra, a visible Windows surface or a live MCP endpoint. Read
`docs/WORKFLOW-UNIFIE.md` in the Aphrody repository first; it is the normative
contract and is synchronized from the niers specification.

## Start every run

Create a unique, bounded run directory under `var/runs/<run-id>/` with:

```text
pending/ results/ logs/ evidence/ manifest.json
```

The manifest must record `run_id`, `requested_scope`, `tool_versions`, `inputs`,
`actions`, `outputs`, `status` and `evidence`. Keep secrets, private dumps and
large assets outside the run; record a hash and a local reference instead.
Never reuse another agent's run directory.

## Route before acting

- Data, VFS, Level-5 formats, batch, render or reports: start with `niers`.
- Binary reverse engineering: verify the input and hash with `niers` or
  `aphrody-re`, then use the currently open Ghidra CodeBrowser session.
- Windows application or game state: observe with WinClean or Computer Use,
  capture PID/window state, perform the bounded action, then observe again.
- UI/assets: launch the real consumer and inspect the produced artifact;
  off-screen output is not proof of in-game fidelity.
- Aphrody publication: validate the bounded route locally, probe the live
  response, and keep the response plus hash in `evidence/`.

Do not turn WinClean or Computer Use into a source of truth. Do not treat a
plugin manifest, MCP declaration, successful build or open window as runtime
proof. Do not expose arbitrary repository reads over HTTP.

## Proof levels

Use the highest level actually established and state lower levels explicitly:

| Level | Evidence required |
|---|---|
| P0 | configuration or declared tool |
| P1 | local command completed with exit code 0 |
| P2 | output artifact inspected |
| P3 | real UI, game, endpoint or service observed |
| P4 | bounded run, manifest, hashes and independent test |

Code delivery needs P2. Runtime and deployment claims need P3/P4. Mark
hypotheses and unvalidated surfaces in the report.

## MCP and safety gates

Use the MCP server already declared by the active plugin/project. Do not add a
cross-repository stdio path or copy a token into config merely to make a tool
appear available. For optional surfaces (WinClean, Ghidra, Computer Use or
niers), verify live availability before claiming P3. MCP stdio diagnostics go
to stderr; stdout remains JSON-RPC.

For destructive Windows or external operations, state the exact target and
impact before execution. Bound relaunches and follow the new PID; never use
`pkill -f`. Preserve unrelated working-tree changes.

## Completion report

Finish with the run path, changed artifacts, commands/tests and their exit
codes, evidence level per claim, verified facts, hypotheses and limits. A
`results/manifest.json` from one run may become a hashed `pending/` input to
the next run.
