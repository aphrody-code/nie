# Agent memory, plugins and shell configuration

`plugins/nie` is the only checked-in skill source. Codex, Claude Code and Antigravity
use host adapter manifests from that directory; skills are not copied into another repository.
The two MCP JSON names are intentional adapters for host conventions and both start `nie-mcp`.

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
