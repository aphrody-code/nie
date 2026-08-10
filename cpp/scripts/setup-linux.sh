#!/bin/bash
# setup-linux.sh — Bootstrap iecode CLI for Linux
# Usage: ./scripts/setup-linux.sh

set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_TYPE="${1:-release}"

echo "=== iecode CLI — Linux Setup ==="
echo "    Root    : $ROOT"
echo "    Type    : $BUILD_TYPE"

# ── 1. Check dependencies ─────────────────────────────────────
echo ""
echo "[1/3] Checking dependencies..."

for cmd in cmake ninja gcc g++ git; do
  if ! command -v $cmd &> /dev/null; then
    echo "  [KO] $cmd not found. Install with:"
    case $cmd in
      cmake) echo "    apt install cmake" ;;
      ninja) echo "    apt install ninja-build" ;;
      gcc|g++) echo "    apt install build-essential" ;;
      git) echo "    apt install git" ;;
    esac
    exit 1
  fi
done

echo "  [OK] cmake, ninja, gcc, g++, git present"

# ── 2. vcpkg setup ─────────────────────────────────────────────
VCPKG_ROOT="${VCPKG_ROOT:-$HOME/vcpkg}"
if [ ! -d "$VCPKG_ROOT" ]; then
  echo "[2/3] Cloning vcpkg to $VCPKG_ROOT..."
  git clone https://github.com/microsoft/vcpkg.git "$VCPKG_ROOT"
  cd "$VCPKG_ROOT"
  ./bootstrap-vcpkg.sh
  cd "$ROOT"
fi

export VCPKG_ROOT

echo "  [OK] vcpkg: $VCPKG_ROOT"

# ── 3. Configure & build ───────────────────────────────────────
echo "[3/3] Configuring cmake ($BUILD_TYPE)..."
cmake --preset linux-gcc
cmake --build --preset linux-gcc --parallel $(nproc)

echo ""
echo "=== Build complete ==="
echo "    Binary: $ROOT/build/linux-gcc/cli/iecode"
echo "    Next: ./scripts/test-all.sh"
