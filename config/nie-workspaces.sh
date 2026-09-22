#!/usr/bin/env bash
# Source this file from ~/.bashrc or ~/.profile. It is intentionally quiet for SSH/scp.
_nie_workspace_script="${NIE_REPO_ROOT:-${HOME}/nie}/scripts/configure-workspaces.sh"
[ -f "$_nie_workspace_script" ] && . "$_nie_workspace_script"
unset _nie_workspace_script
