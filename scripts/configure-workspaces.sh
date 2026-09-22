#!/usr/bin/env bash
# Configure one shell session for the two sibling workspaces without embedding checkout paths.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export NIE_REPO_ROOT="${NIE_REPO_ROOT:-$root}"
export NIE_GAME_DIR="${NIE_GAME_DIR:-$HOME/.local/share/Steam/iecode/inazuma}"
export NIE_BIN="${NIE_BIN:-$NIE_REPO_ROOT/target/release/nie}"
export IECODE_ROOT="${IECODE_ROOT:-$(cd "$NIE_REPO_ROOT/../iecode" 2>/dev/null && pwd || true)}"
export PATH="$NIE_REPO_ROOT/target/release:$NIE_REPO_ROOT/target/debug:$PATH"
if [ -n "${IECODE_ROOT:-}" ] && [ -d "$IECODE_ROOT" ]; then
	export PATH="$IECODE_ROOT/target/release:$IECODE_ROOT/target/debug:$PATH"
fi

if [ "${1:-}" = "--print" ]; then
	env | sort | grep -E '^(NIE|IECODE)_' || true
fi
