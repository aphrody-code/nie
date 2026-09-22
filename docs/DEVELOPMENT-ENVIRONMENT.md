# Development environment

The Linux environment has two layers:

- `~/.config/nie/environment.env` contains non-secret machine paths and is sourced by Bash.
- `.env.local` contains the private union required by the monorepo. `.env` is a local symlink to
  it for tools that only understand the conventional name. Both names are ignored by Git and the
  target is mode `0600`.

Install or refresh the environment without printing credentials:

```bash
bash scripts/install-shell-environment.sh
```

The installer merges missing variables from the existing VPS-owned files under
`~/.config/nie/`, installs symlinks for built Rust commands into `~/.local/bin`, enables the
repository with direnv, and adds an idempotent Bash hook. It does not rotate credentials, replace
an existing regular `.env`, download the game, or grant broad filesystem permissions.

The repository-scoped `.envrc`, Codex config, and Claude config activate nie only when the
working directory is this checkout. The machine PATH contains command directories, never the game
asset directory. `NIE_GAME_DIR` and `IEVR_GAME_DIR` identify the VFS root; `NIE_GAME_PATH`
identifies the Steam/Proton install root.

Antigravity currently stores plugin enablement globally. The installed `~/.local/bin/agy` wrapper
serializes launches, enables nie only for a working directory below this checkout, and disables
it again when the session exits. This prevents a completed project session from leaving the
plugin active in unrelated repositories.

Validate without displaying values:

```bash
direnv exec . bash -lc 'test -f "$NIE_GAME_DIR/data/cpk_list.cfg.bin"'
direnv exec . bash -lc 'command -v nie nie-mcp steam steamcmd cargo bun uv codex claude agy'
```

Rollback consists of removing the marked block from `~/.bashrc`, removing
`~/.config/nie/environment.env`, running `direnv deny`, and removing the local `.env` symlink.
Remove `/etc/profile.d/nie-path.sh` with administrator privileges to roll back the system PATH,
and restore the previous `~/.local/bin/agy` launcher to remove the agy scope guard. The installer
never deletes the underlying `.env.local` or any credential source.

On the current containerized VPS host, `/etc` maps newly installed files to uid/gid 65534 and
rejects `chown root:root` with `EPERM`, including through the escalated execution path. The fragment
is therefore accepted only with mode `0644`, after verifying that `ubuntu` cannot modify it.
