#!/usr/bin/env bash
# Install the nie developer shell integration on a Linux host.
# This script is idempotent and never prints secret values.
set -euo pipefail

repo_root=$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
private_dir="$HOME/.config/nie"
private_env="$repo_root/.env.local"
user_env="$private_dir/environment.env"
profile_marker='# >>> nie developer environment >>>'

umask 077
mkdir -p "$private_dir" "$HOME/.local/bin"
touch "$private_env"
chmod 600 "$private_env"

has_env_key() {
    local key=$1
    awk -F= -v wanted="$key" '
        /^[[:space:]]*(export[[:space:]]+)?[A-Za-z_][A-Za-z0-9_]*=/ {
            candidate=$1
            sub(/^[[:space:]]*export[[:space:]]+/, "", candidate)
            sub(/[[:space:]]+$/, "", candidate)
            if (candidate == wanted) found=1
        }
        END { exit(found ? 0 : 1) }
    ' "$private_env"
}

merge_private_env() {
    local source=$1 line key
    [ -r "$source" ] || return 0
    chmod 600 "$source"
    while IFS= read -r line || [ -n "$line" ]; do
        case "$line" in
            ''|'#'*) continue ;;
            export\ *) key=${line#export }; key=${key%%=*} ;;
            [A-Za-z_]*=*) key=${line%%=*} ;;
            *) continue ;;
        esac
        case "$key" in
            *[!A-Za-z0-9_]*|'') continue ;;
        esac
        if ! has_env_key "$key"; then
            printf '%s\n' "$line" >> "$private_env"
        fi
    done < "$source"
}

for source in \
    "$private_dir/steam.env" \
    "$private_dir/cron.env" \
    "$private_dir/github.env" \
    "$private_dir/supabase.env" \
    "$private_dir/vercel.env" \
do
    merge_private_env "$source"
done

if [ ! -e "$repo_root/.env" ]; then
    ln -s .env.local "$repo_root/.env"
elif [ -L "$repo_root/.env" ] && [ "$(readlink "$repo_root/.env")" = '.env.local' ]; then
    :
else
    printf 'Refusing to replace existing %s/.env\n' "$repo_root" >&2
    exit 1
fi

{
    printf 'NIE_REPO=%q\n' "$repo_root"
    printf 'NIE_GAME_DIR=%q\n' "$HOME/.local/share/Steam/iecode/inazuma"
    printf 'IEVR_GAME_DIR=%q\n' "$HOME/.local/share/Steam/iecode/inazuma"
    printf 'NIE_GAME_PATH=%q\n' "$HOME/.local/share/Steam/iecode/inazuma"
    printf 'STEAM_LIBRARY_PATH=%q\n' "$HOME/.local/share/Steam"
    printf 'NIE_RUNTIME_BASE=%q\n' "$HOME/.local/share/nie/runtime"
    printf 'NIE_STEAM_TOKEN_STORE=%q\n' "$HOME/.local/share/nie/steam-tokens.json"
    printf 'STEAM_TOKEN_STORE=%q\n' "$HOME/.local/share/nie/steam-tokens.json"
    printf 'STEAM_COMPAT_CLIENT_INSTALL_PATH=%q\n' "$HOME/.local/share/Steam"
    printf 'STEAM_COMPAT_DATA_PATH=%q\n' "$HOME/.local/share/nie/runtime/proton-prefix"
    printf 'WINEPREFIX=%q\n' "$HOME/.local/share/nie/runtime/proton-prefix/pfx"
} > "$user_env"
chmod 600 "$user_env"

if ! grep -Fq "$profile_marker" "$HOME/.bashrc"; then
    # The quoted text is intentionally written literally to ~/.bashrc.
    # shellcheck disable=SC2016
    {
        printf '\n%s\n' "$profile_marker"
        printf '[ -r "$HOME/.config/nie/environment.env" ] && set -a && . "$HOME/.config/nie/environment.env" && set +a\n'
        printf 'nie_path_seen=:; nie_path_clean=; old_ifs=$IFS; IFS=:\n'
        printf 'for nie_dir in $PATH; do case "$nie_path_seen" in *":$nie_dir:"*) ;; *) nie_path_seen="$nie_path_seen$nie_dir:"; nie_path_clean="${nie_path_clean:+$nie_path_clean:}$nie_dir" ;; esac; done\n'
        printf 'IFS=$old_ifs; PATH=$nie_path_clean; export PATH; unset nie_dir nie_path_seen nie_path_clean old_ifs\n'
        printf 'command -v direnv >/dev/null 2>&1 && eval "$(direnv hook bash)"\n'
        printf '# <<< nie developer environment <<<\n'
    } >> "$HOME/.bashrc"
fi

system_profile=$(mktemp)
trap 'rm -f "$system_profile"' EXIT
# The quoted text is intentionally written literally to /etc/profile.d.
# shellcheck disable=SC2016
{
    printf '%s\n' '# nie command search path; project secrets remain repository-scoped.'
    printf '%s\n' 'if [ -n "${HOME:-}" ]; then'
    printf '%s\n' '  nie_path_seen=:; nie_path_clean=; old_ifs=$IFS; IFS=:'
    printf '%s\n' '  for nie_dir in $PATH; do case "$nie_path_seen" in *":$nie_dir:"*) ;; *) nie_path_seen="$nie_path_seen$nie_dir:"; nie_path_clean="${nie_path_clean:+$nie_path_clean:}$nie_dir" ;; esac; done'
    printf '%s\n' '  IFS=$old_ifs; PATH=$nie_path_clean'
    printf '%s\n' '  for nie_dir in "$HOME/.local/bin" "$HOME/.cargo/bin" "$HOME/.bun/bin" /usr/games; do'
    printf '%s\n' '    [ -d "$nie_dir" ] || continue'
    printf '%s\n' '    case ":$PATH:" in *":$nie_dir:"*) ;; *) PATH="$nie_dir:$PATH" ;; esac'
    printf '%s\n' '  done'
    printf '%s\n' '  export PATH'
    printf '%s\n' '  unset nie_dir nie_path_seen nie_path_clean old_ifs'
    printf '%s\n' 'fi'
} > "$system_profile"
if command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
    sudo install -o root -g root -m 644 "$system_profile" /etc/profile.d/nie-path.sh
else
    printf 'system PATH skipped: passwordless sudo unavailable; user PATH is configured\n' >&2
fi

bash "$repo_root/scripts/installer-binaires.sh"
direnv allow "$repo_root"

printf 'nie environment installed: %s private keys, .env -> .env.local, user PATH ready\n' \
    "$(awk -F= '/^[[:space:]]*(export[[:space:]]+)?[A-Za-z_][A-Za-z0-9_]*=/{count++} END{print count+0}' "$private_env")"
