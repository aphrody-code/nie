#!/usr/bin/env bash
# Build reproductible de la surface WebAssembly (nie-wasm) pour azalee.
#
# Étapes (best practices wasm-bindgen) :
#   1. cargo build --release --target wasm32-unknown-unknown
#   2. wasm-bindgen --target web            (glue ESM + .d.ts)
#   3. wasm-opt -O3                          (taille -~15 % + vitesse runtime)
#   4. patch Turbopack : `new URL(..., import.meta.url)` -> throw (force module_or_path)
#   5. copie vers azalee (lib/nie-wasm-web/ + public/wasm/)
#
# La version du CLI wasm-bindgen DOIT égaler le pin `=0.2.121` du workspace.
set -euo pipefail

ROOT="/home/ubuntu/niers"
AZALEE="/home/ubuntu/rg/apps/azalee"
PKG="$ROOT/crates/nie-wasm/pkg"
WASM="$ROOT/target/wasm32-unknown-unknown/release/nie_wasm.wasm"

cd "$ROOT"

# 0. Garde-fou : versions alignées.
pin="$(grep -oE 'wasm-bindgen = \{ version = "=[0-9.]+"' Cargo.toml | grep -oE '[0-9.]+' | head -1)"
cli="$(wasm-bindgen --version | grep -oE '[0-9.]+' | head -1)"
[ "$pin" = "$cli" ] || { echo "ERREUR: wasm-bindgen CLI $cli != pin $pin"; exit 1; }

echo "[1/5] cargo build release wasm32…"
cargo build -p nie-wasm --target wasm32-unknown-unknown --release

echo "[2/5] wasm-bindgen --target web…"
wasm-bindgen "$WASM" --out-dir "$PKG" --target web

echo "[3/5] wasm-opt -O3…"
before=$(stat -c%s "$PKG/nie_wasm_bg.wasm")
wasm-opt -O3 "$PKG/nie_wasm_bg.wasm" -o "$PKG/nie_wasm_bg.wasm"
after=$(stat -c%s "$PKG/nie_wasm_bg.wasm")
echo "      $before -> $after octets ($(( (before-after)*100/before )) % en moins)"

echo "[4/5] patch Turbopack…"
sed -i "s|module_or_path = new URL('nie_wasm_bg.wasm', import.meta.url);|throw new Error(\"nie-wasm: module_or_path requis\");|" "$PKG/nie_wasm.js"

echo "[5/5] copie vers azalee…"
cp "$PKG/nie_wasm.js" "$PKG/nie_wasm.d.ts" "$AZALEE/lib/nie-wasm-web/"
cp "$PKG/nie_wasm_bg.wasm" "$AZALEE/public/wasm/"

echo "OK — wasm déployable ($after octets). Rebuild azalee + deploy ensuite."
