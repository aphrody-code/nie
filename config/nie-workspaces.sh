#!/usr/bin/env bash
# Source this file from ~/.bashrc or ~/.profile. It is intentionally quiet for SSH/scp.
_nie_workspace_root="${NIE_REPO_ROOT:-}"
if [ -z "$_nie_workspace_root" ]; then
	for _nie_candidate in "$HOME/nie" "$HOME/nie"; do
		if [ -f "$_nie_candidate/scripts/configure-workspaces.sh" ]; then
			_nie_workspace_root="$_nie_candidate"
			break
		fi
	done
fi
_nie_workspace_script="${_nie_workspace_root}/scripts/configure-workspaces.sh"
[ -f "$_nie_workspace_script" ] && . "$_nie_workspace_script"
unset _nie_workspace_root _nie_candidate
unset _nie_workspace_script
