#!/usr/bin/env bash
# Repository-scoped nie environment. Safe to source repeatedly.

if [ -n "${NIE_ENV_ACTIVE:-}" ]; then
    return 0
fi
export NIE_ENV_ACTIVE=1

nie_env_root=$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)

nie_path_prepend() {
    [ -d "$1" ] || return 0
    case ":${PATH:-}:" in
        *":$1:"*) ;;
        *) PATH="$1${PATH:+:$PATH}" ;;
    esac
}

nie_path_dedupe() {
    local entry deduped='' old_ifs=$IFS
    IFS=:
    for entry in ${PATH:-}; do
        [ -n "$entry" ] || continue
        case ":$deduped:" in
            *":$entry:"*) ;;
            *) deduped="${deduped:+$deduped:}$entry" ;;
        esac
    done
    IFS=$old_ifs
    PATH=$deduped
}

if [ -r "$HOME/.config/nie/environment.env" ]; then
    set -a
    # shellcheck disable=SC1091
    . "$HOME/.config/nie/environment.env"
    set +a
fi

if [ -r "$nie_env_root/.env.local" ]; then
    set -a
    # shellcheck disable=SC1091
    . "$nie_env_root/.env.local"
    set +a
elif [ -r "$nie_env_root/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    . "$nie_env_root/.env"
    set +a
fi

export NIE_REPO="${NIE_REPO:-${NIE_REPO:-$nie_env_root}}"
export NIE_REPO="${NIE_REPO:-$NIE_REPO}"
export NIE_GAME_DIR="${NIE_GAME_DIR:-$HOME/.local/share/Steam/iecode/inazuma}"
export IEVR_GAME_DIR="${IEVR_GAME_DIR:-$NIE_GAME_DIR}"
export NIE_GAME_PATH="${NIE_GAME_PATH:-$NIE_GAME_DIR}"
export STEAM_LIBRARY_PATH="${STEAM_LIBRARY_PATH:-$HOME/.local/share/Steam}"
export NIE_RUNTIME_BASE="${NIE_RUNTIME_BASE:-$HOME/.local/share/nie/runtime}"
export NIE_STEAM_TOKEN_STORE="${NIE_STEAM_TOKEN_STORE:-$HOME/.local/share/nie/steam-tokens.json}"
export STEAM_TOKEN_STORE="${STEAM_TOKEN_STORE:-$NIE_STEAM_TOKEN_STORE}"
export NIE_ATLAS_DB="${NIE_ATLAS_DB:-$nie_env_root/var/nie-atlas.sqlite}"
export NIE_WIKI_DB="${NIE_WIKI_DB:-$nie_env_root/var/nie-wiki.sqlite}"

# ── Compiler Caching & Fast Linking (2026 Optimization) ──────────────────────
if [ -z "${RUSTC_WRAPPER:-}" ] && command -v sccache >/dev/null 2>&1; then
    export RUSTC_WRAPPER=sccache
    export SCCACHE_DIR="${SCCACHE_DIR:-$HOME/.cache/sccache}"
    export SCCACHE_CACHE_SIZE="${SCCACHE_CACHE_SIZE:-10G}"
fi

if command -v mold >/dev/null 2>&1 && [ "$(uname -s)" = "Linux" ]; then
    case "${RUSTFLAGS:-}" in
        *"-fuse-ld=mold"*) ;;
        *) export RUSTFLAGS="${RUSTFLAGS:+$RUSTFLAGS }-C link-arg=-fuse-ld=mold" ;;
    esac
fi

nie_path_dedupe
nie_path_prepend "/usr/games"
nie_path_prepend "$HOME/.bun/bin"
nie_path_prepend "$HOME/.cargo/bin"
nie_path_prepend "$HOME/.local/bin"
export PATH

unset nie_env_root
unset -f nie_path_dedupe nie_path_prepend
