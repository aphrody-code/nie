#!/usr/bin/env bash
# release-desktop.sh — pipeline de release COMPLET pour l'app desktop niers (nie-explorer).
#   bump versions → sync lockfiles → build signé (msi+nsis) → tag+push → GitHub Release
#   → (option) redeploy azalee.
#
# Remplace la séquence manuelle du 2026-08-08 (bump Cargo.toml/package.json à la main,
# `cargo update --workspace`, `bun install`, `bunx tauri signer generate`, build, `gh release
# create` avec upload manuel des 5 assets) par UNE commande idempotente et rejouable.
#
# Usage :
#   TAURI_SIGNING_PRIVATE_KEY_PATH=~/.tauri/niers.key ./scripts/release-desktop.sh 0.5.0
#   ./scripts/release-desktop.sh 0.5.0 --ship-azalee   # + redeploy azalee (rare, cf. NOTE ci-dessous)
#
# NOTE — le côté VPS n'a PAS besoin d'être redéployé à chaque release : `azalee.rosegriffon.fr/
# tools/niers` et `/tools/niers/latest.json` lisent la dernière release GitHub EN DIRECT
# (`apps/azalee/lib/niers-releases.ts`, revalidate=3600s) — ce script suffit à lui seul à publier
# une version que l'updater Tauri ET la page de download verront sous 1h max, sans toucher au VPS.
# `--ship-azalee` ne sert que si le CODE d'azalee (pas niers) a aussi changé entre-temps.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="${1:-}"
SHIP_AZALEE=0
for arg in "$@"; do [ "$arg" = "--ship-azalee" ] && SHIP_AZALEE=1; done
if [ -z "$VERSION" ] || [[ "$VERSION" == --* ]]; then
	echo "Usage: $0 <version, ex: 0.5.0> [--ship-azalee]" >&2
	exit 1
fi
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
	echo "ERREUR: version attendue au format X.Y.Z (reçu: $VERSION)" >&2
	exit 1
fi
TAG="v$VERSION"

# ── 0. Garde-fous ────────────────────────────────────────────────────────────────────────
[ -z "$(git status --porcelain)" ] || { echo "ERREUR: arbre de travail non propre — commit/stash d'abord." >&2; exit 1; }
[ "$(git rev-parse --abbrev-ref HEAD)" = "main" ] || { echo "ERREUR: doit être sur main (workflow main direct, cf. CLAUDE.md)." >&2; exit 1; }
git rev-parse "$TAG" >/dev/null 2>&1 && { echo "ERREUR: le tag $TAG existe déjà." >&2; exit 1; }
command -v gh >/dev/null || { echo "ERREUR: gh CLI introuvable." >&2; exit 1; }
KEY_PATH="${TAURI_SIGNING_PRIVATE_KEY_PATH:-$HOME/.tauri/niers.key}"
[ -f "$KEY_PATH" ] || {
	echo "ERREUR: clé de signature absente ($KEY_PATH)." >&2
	echo "  Génère-la une fois avec : bunx tauri signer generate -w $KEY_PATH --ci" >&2
	echo "  Puis colle la clé publique dans apps/nie-explorer/src-tauri/tauri.conf.json (plugins.updater.pubkey)." >&2
	exit 1
}

echo "▸ [1/7] bump version → $VERSION (workspace Cargo + Bun)…"
sed -i "s/^version = \"[0-9]*\.[0-9]*\.[0-9]*\"/version = \"$VERSION\"/" Cargo.toml
sed -i "s/\"version\": \"[0-9]*\.[0-9]*\.[0-9]*\"/\"version\": \"$VERSION\"/" package.json
for f in apps/nie-decode/package.json apps/nie-explorer/package.json \
         packages/nie/package.json packages/nie-catalog/package.json \
         packages/nie-plugin/package.json packages/nie-util/package.json; do
	[ -f "$f" ] && sed -i "s/\"version\": \"[0-9]*\.[0-9]*\.[0-9]*\"/\"version\": \"$VERSION\"/" "$f"
done
sed -i "s/^version = \"[0-9]*\.[0-9]*\.[0-9]*\"/version = \"$VERSION\"/" apps/nie-explorer/src-tauri/Cargo.toml
sed -i "s/\"version\": \"[0-9]*\.[0-9]*\.[0-9]*\"/\"version\": \"$VERSION\"/" apps/nie-explorer/src-tauri/tauri.conf.json

echo "▸ [2/7] sync lockfiles (Cargo.lock + bun.lock)…"
cargo update --workspace --offline 2>/dev/null || cargo update --workspace
(cd apps/nie-explorer/src-tauri && cargo update --workspace --offline 2>/dev/null || cargo update --workspace)
bun install

echo "▸ [3/7] sanity check (cargo check workspace + src-tauri)…"
cargo check --workspace
(cd apps/nie-explorer/src-tauri && cargo check)

echo "▸ [4/7] zip extension Blender (tools/niers, hors __pycache__)…"
BLENDER_VERSION="$(grep -m1 '^version' tools/niers/blender_manifest.toml | sed -E 's/.*"([0-9.]+)".*/\1/')"
ZIP_STAGE="$(mktemp -d)"
mkdir -p "$ZIP_STAGE/niers"
cp -r tools/niers/. "$ZIP_STAGE/niers/"
find "$ZIP_STAGE" -iname "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
BLENDER_ZIP="$ROOT/apps/nie-explorer/src-tauri/target/release/bundle/niers-$BLENDER_VERSION.zip"
(cd "$ZIP_STAGE" && zip -qr "$BLENDER_ZIP" niers)
rm -rf "$ZIP_STAGE"
echo "  → $BLENDER_ZIP (addon v$BLENDER_VERSION)"

echo "▸ [5/7] build desktop signé (msi + nsis, minisign)…"
(
	cd apps/nie-explorer
	export TAURI_SIGNING_PRIVATE_KEY="$KEY_PATH"
	export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"
	bun run tauri build
)
BUNDLE="apps/nie-explorer/src-tauri/target/release/bundle"
MSI="$BUNDLE/msi/niers_${VERSION}_x64_en-US.msi"
NSIS="$BUNDLE/nsis/niers_${VERSION}_x64-setup.exe"
for f in "$MSI" "$MSI.sig" "$NSIS" "$NSIS.sig"; do
	[ -f "$f" ] || { echo "ERREUR: artefact attendu absent: $f" >&2; exit 1; }
done

echo "▸ [6/7] commit + tag $TAG + push…"
git add Cargo.toml Cargo.lock package.json bun.lock \
        apps/nie-decode/package.json apps/nie-explorer/package.json apps/nie-explorer/src-tauri/Cargo.toml \
        apps/nie-explorer/src-tauri/Cargo.lock apps/nie-explorer/src-tauri/tauri.conf.json \
        packages/nie/package.json packages/nie-catalog/package.json packages/nie-plugin/package.json packages/nie-util/package.json
git commit -m "chore(release): bump $VERSION"
git tag -a "$TAG" -m "niers $TAG"
git push origin main
git push origin "$TAG"

echo "▸ [7/7] GitHub Release $TAG (upload msi+nsis+sig+blender zip)…"
gh release create "$TAG" \
	--title "niers $TAG" \
	--notes "App desktop (Tauri v2) signée minisign + extension Blender v$BLENDER_VERSION. Détail : docs/PLAN.md, docs/ROADMAP-100.md, apps/nie-explorer/ROADMAP.md." \
	"$MSI" "$MSI.sig" "$NSIS" "$NSIS.sig" "$BLENDER_ZIP"

echo "✓ Release $TAG publiée : https://github.com/aphrody-code/niers/releases/tag/$TAG"
echo "  → azalee.rosegriffon.fr/tools/niers + /latest.json se mettront à jour tout seuls (≤1h, cache dynamique)."

if [ "$SHIP_AZALEE" = "1" ]; then
	echo "▸ [bonus] --ship-azalee : redeploy azalee sur le VPS (scripts/redeploy-niers-tools.sh, dépôt rg)…"
	ssh ovh-vps-ubuntu-direct 'bash /home/ubuntu/rg/scripts/redeploy-niers-tools.sh' \
		|| ssh ovh-vps-ubuntu 'bash /home/ubuntu/rg/scripts/redeploy-niers-tools.sh'
fi
