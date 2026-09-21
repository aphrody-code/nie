#!/usr/bin/env bash
# Repository-scoped niers environment. Safe to source repeatedly.

if [ -n "${NIERS_ENV_ACTIVE:-}" ]; then
    return 0
fi
export NIERS_ENV_ACTIVE=1

niers_env_root=$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)

niers_path_prepend() {
    [ -d "$1" ] || return 0
    case ":${PATH:-}:" in
        *":$1:"*) ;;
        *) PATH="$1${PATH:+:$PATH}" ;;
    esac
}

niers_path_dedupe() {
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

if [ -r "$HOME/.config/niers/environment.env" ]; then
    set -a
    # shellcheck disable=SC1091
    . "$HOME/.config/niers/environment.env"
    set +a
fi

if [ -r "$niers_env_root/.env.local" ]; then
    set -a
    # shellcheck disable=SC1091
    . "$niers_env_root/.env.local"
    set +a
elif [ -r "$niers_env_root/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    . "$niers_env_root/.env"
    set +a
fi

export NIERS_REPO="${NIERS_REPO:-$niers_env_root}"
export NIE_GAME_DIR="${NIE_GAME_DIR:-$HOME/.local/share/Steam/iecode/inazuma}"
export IEVR_GAME_DIR="${IEVR_GAME_DIR:-$NIE_GAME_DIR}"
export NIE_GAME_PATH="${NIE_GAME_PATH:-$NIE_GAME_DIR}"
export STEAM_LIBRARY_PATH="${STEAM_LIBRARY_PATH:-$HOME/.local/share/Steam}"
export NIE_RUNTIME_BASE="${NIE_RUNTIME_BASE:-$HOME/.local/share/niers/runtime}"
export NIE_STEAM_TOKEN_STORE="${NIE_STEAM_TOKEN_STORE:-$HOME/.local/share/niers/steam-tokens.json}"
export STEAM_TOKEN_STORE="${STEAM_TOKEN_STORE:-$NIE_STEAM_TOKEN_STORE}"
export NIE_ATLAS_DB="${NIE_ATLAS_DB:-$niers_env_root/var/nie-atlas.sqlite}"
export NIE_WIKI_DB="${NIE_WIKI_DB:-$niers_env_root/var/nie-wiki.sqlite}"

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

niers_path_dedupe
niers_path_prepend "/usr/games"
niers_path_prepend "$HOME/.bun/bin"
niers_path_prepend "$HOME/.cargo/bin"
niers_path_prepend "$HOME/.local/bin"
export PATH

unset niers_env_root
unset -f niers_path_dedupe niers_path_prepend
