#!/usr/bin/env bash
# Packaging distribuable des binaires JEU niers — Linux (portable) + Windows (cross mingw-w64).
#
# À lancer depuis une machine Linux. Sur un poste Windows, `cargo build --release` produit
# directement des binaires MSVC natifs, qui exploitent D3D12 : ce script ne sert pas là.
#
# Produit dans dist/ :
#   niers-<ver>-linux-x86_64.tar.gz    (binaires portables, target-cpu=x86-64-v2)
#   niers-<ver>-windows-x86_64.zip     (PE32+ cross-compilés via x86_64-w64-mingw32-gcc)
#
# Binaires jouables empaquetés : nie-game, nie-headless, nie-play, nie-runtime, nie-match3d.
# Les binaires RE/serveur (niers, nie-model-serve) ne sont pas distribués : ils dépendent d'un
# environnement de service (SQLite, redis) plutôt que d'un poste de jeu.
#
# Prérequis : rustup target x86_64-pc-windows-gnu, x86_64-w64-mingw32-gcc, zip. Le linker Windows
# est configuré dans .cargo/config.toml. `mold` est utilisé s'il est présent, sinon le linker par
# défaut — aucun des deux n'est requis.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
VER="$(grep -m1 '^version' Cargo.toml | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo 0.1.0)"

PKGS=(-p nie-game -p nie-headless -p nie-play -p nie-runtime)
BINS=(nie-game nie-headless nie-play nie-runtime nie-match3d)

DIST="$ROOT/dist"
rm -rf "$DIST"
mkdir -p "$DIST"

# ── Linux portable ───────────────────────────────────────────────────────────
# `RUSTFLAGS` de l'environnement REMPLACE les rustflags de la cible : on y remet le v0 mangling,
# on fixe le plancher d'ISA à x86-64-v2 (portable, et surtout stable d'une machine à l'autre —
# `native` changerait l'ordre des opérations flottantes et casserait les goldens byte-exacts), et
# on n'ajoute mold que s'il est réellement installé.
MOLD_FLAG=""
command -v mold >/dev/null 2>&1 && MOLD_FLAG="-C link-arg=-fuse-ld=mold"
echo "[linux] build portable (x86-64-v2)…"
RUSTFLAGS="-C symbol-mangling-version=v0 $MOLD_FLAG -C target-cpu=x86-64-v2" \
	cargo build --release "${PKGS[@]}"
LX="$DIST/niers-$VER-linux-x86_64"
mkdir -p "$LX"
for b in "${BINS[@]}"; do
	cp "target/release/$b" "$LX/" 2>/dev/null && echo "  + $b"
done
[ -f README.md ] && cp README.md "$LX/"
tar -czf "$DIST/niers-$VER-linux-x86_64.tar.gz" -C "$DIST" "$(basename "$LX")"

# ── Windows (cross mingw) ────────────────────────────────────────────────────
echo "[windows] cross-compile mingw-w64…"
cargo build --release --target x86_64-pc-windows-gnu "${PKGS[@]}"
WIN="$DIST/niers-$VER-windows-x86_64"
mkdir -p "$WIN"
for b in "${BINS[@]}"; do
	cp "target/x86_64-pc-windows-gnu/release/$b.exe" "$WIN/" 2>/dev/null && echo "  + $b.exe"
done
[ -f README.md ] && cp README.md "$WIN/"
(cd "$DIST" && zip -qr "niers-$VER-windows-x86_64.zip" "$(basename "$WIN")")

echo "OK — paquets :"
ls -lh "$DIST"/*.tar.gz "$DIST"/*.zip 2>/dev/null | awk '{print "  " $5, $9}'
