#!/usr/bin/env bash
# setup-wsl.sh — Bootstrap iecode build environment in WSL2 (Ubuntu 24.04)
# Usage: bash cli/scripts/setup-wsl.sh [--vcpkg-root <path>] [--compiler gcc|clang|both]
set -euo pipefail

VCPKG_ROOT="${VCPKG_ROOT:-$HOME/vcpkg}"
COMPILER="${COMPILER:-both}"
IECODE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLI_ROOT="$IECODE_ROOT/cli"
START_TS=$(date +%s)

# ── Parse args ────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --vcpkg-root) VCPKG_ROOT="$2"; shift 2 ;;
        --compiler)   COMPILER="$2";   shift 2 ;;
        *) echo "Unknown arg: $1"; exit 1 ;;
    esac
done

step() { echo; echo "==> $*"; }
ok()   { echo "    [OK] $*"; }
warn() { echo "    [!!] $*"; }

echo "=== iecode — WSL2 Setup ==="
echo "    iecode   : $IECODE_ROOT"
echo "    vcpkg    : $VCPKG_ROOT"
echo "    compiler : $COMPILER"

# ── 1. System packages ────────────────────────────────────────────────────────
step "[1/5] APT packages..."
sudo apt-get update -qq
sudo apt-get install -y --no-install-recommends \
    build-essential \
    git \
    curl \
    wget \
    zip \
    unzip \
    tar \
    pkg-config \
    cmake \
    ninja-build \
    ccache \
    nasm \
    autoconf \
    automake \
    libtool \
    python3 \
    python3-pip \
    libx11-dev \
    libxft-dev \
    libxext-dev \
    libwayland-dev \
    libxkbcommon-dev \
    libgl1-mesa-dev \
    libegl1-mesa-dev \
    libvulkan-dev \
    libssl-dev \
    libpq-dev \
    libudev-dev \
    libdbus-1-dev \
    libibus-1.0-dev \
    libpulse-dev \
    libasound2-dev \
    libfontconfig1-dev \
    libfreetype-dev \
    patchelf \
    strace
ok "APT done"

# ── 2. GCC / Clang ────────────────────────────────────────────────────────────
step "[2/5] Compilers..."
install_gcc() {
    sudo apt-get install -y --no-install-recommends gcc-14 g++-14
    sudo update-alternatives --install /usr/bin/gcc gcc /usr/bin/gcc-14 100
    sudo update-alternatives --install /usr/bin/g++ g++ /usr/bin/g++-14 100
    ok "GCC 14 installed"
}
install_clang() {
    sudo apt-get install -y --no-install-recommends clang-18 clang++-18 lld-18 lldb-18
    sudo update-alternatives --install /usr/bin/clang   clang   /usr/bin/clang-18   100
    sudo update-alternatives --install /usr/bin/clang++ clang++ /usr/bin/clang++-18 100
    ok "Clang 18 installed"
}

case "$COMPILER" in
    gcc)   install_gcc ;;
    clang) install_clang ;;
    both)  install_gcc; install_clang ;;
esac

# ── 3. vcpkg ─────────────────────────────────────────────────────────────────
step "[3/5] vcpkg ($VCPKG_ROOT)..."
if [[ ! -f "$VCPKG_ROOT/vcpkg" ]]; then
    if [[ ! -d "$VCPKG_ROOT/.git" ]]; then
        git clone https://github.com/microsoft/vcpkg.git "$VCPKG_ROOT" --depth=1
    fi
    pushd "$VCPKG_ROOT" > /dev/null
    ./bootstrap-vcpkg.sh -disableMetrics
    popd > /dev/null
    ok "vcpkg bootstrapped"
else
    ok "vcpkg already installed"
fi

# ── 4. Shell env (.bashrc / .profile) ────────────────────────────────────────
step "[4/5] Shell env..."
ENV_BLOCK="
# iecode build env
export VCPKG_ROOT=\"$VCPKG_ROOT\"
export PATH=\"\$VCPKG_ROOT:\$PATH\"
export VCPKG_FEATURE_FLAGS=manifests
export VCPKG_DISABLE_METRICS=1
"
for rc in "$HOME/.bashrc" "$HOME/.profile"; do
    if ! grep -q 'VCPKG_ROOT' "$rc" 2>/dev/null; then
        echo "$ENV_BLOCK" >> "$rc"
        ok "Added env to $rc"
    else
        ok "Env already in $rc"
    fi
done
export VCPKG_ROOT="$VCPKG_ROOT"
export PATH="$VCPKG_ROOT:$PATH"
export VCPKG_FEATURE_FLAGS=manifests
export VCPKG_DISABLE_METRICS=1

# ── 5. CMake configure ────────────────────────────────────────────────────────
step "[5/5] CMake configure + vcpkg install..."
cd "$CLI_ROOT"

build_preset() {
    local preset="$1"
    echo "  Preset: $preset"
    cmake --preset "$preset" 2>&1 | tail -5
    cmake --build --preset "$preset" --parallel "$(nproc)" 2>&1 | tail -10
    ok "$preset built"
}

case "$COMPILER" in
    gcc)   build_preset linux-gcc ;;
    clang) build_preset linux-clang ;;
    both)
        build_preset linux-gcc
        build_preset linux-clang
        ;;
esac

# ── Summary ───────────────────────────────────────────────────────────────────
ELAPSED=$(( $(date +%s) - START_TS ))
echo
echo "=== Setup done in ${ELAPSED}s ==="
echo "    GCC binary  : $CLI_ROOT/build/linux-gcc/cli/iecode"
echo "    Clang binary: $CLI_ROOT/build/linux-clang/cli/iecode"
echo
echo "    Quick build:"
echo "      cmake --workflow --preset linux-gcc"
echo "      cmake --workflow --preset linux-clang"
