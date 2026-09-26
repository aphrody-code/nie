# Agent memory, plugins and shell configuration

The NIE agent skills live in the single Aphrody plugin (`../aphrody-os/plugins/aphrody`, marketplace
`aphrody-os`); the former `plugins/nie` plugin and `nie-marketplace` were merged there on 2026-09-26.
Codex, Claude Code and Antigravity enable `aphrody@aphrody-os` from this repository. The NIE MCP
tools are the `nie.*` family of `aphrody-mcp`, which runs `nie-mcp` as a child process.

Run a dry report first, then update only the generated adapter note:

```sh
bun scripts/sync-memory-to-agy.ts
bun scripts/sync-memory-to-agy.ts --apply
```

The script hashes Markdown notes, removes exact duplicates from the generated view, preserves all
source notes, and writes `nie-workspace.md` for the three host adapters. It never deletes memory,
credentials or plugin directories.

For shells, source `config/nie-workspaces.sh` from the user profile. It derives `NIE_REPO_ROOT`
from the checkout and discovers the sibling IECODE checkout as `../iecode`; override either with
an environment variable. The shared installer is quiet and works in login, interactive and
non-interactive Bash sessions:

```sh
. "$NIE_REPO_ROOT/config/nie-workspaces.sh"
nie --version
```

System-wide profile policy should source the same file through `/etc/profile.d/nie-workspaces.sh`
on managed hosts; user policy should source it from `~/.bashrc` and `~/.profile`. Installation is
deliberately separate from the repository script so an agent cannot overwrite shell profiles
implicitly.
