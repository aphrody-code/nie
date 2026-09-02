#!/usr/bin/env bash
# next-build.sh — build Next standalone pour Azalee.
#
# IMPORTANT — runtime de build = Node (PAS Bun) :
#   Bun (1.3.x ET 1.4-canary) déclenche un bug de PRERENDER de la page synthétique
#   `/_global-error` de Next 16 : `TypeError: null is not an object (evaluating
#   'k.H.useContext')` — dispatcher React null dans le OuterLayoutRouter interne de
#   Next, avant même la 1re page. Le bug est 100% reproductible (vanilla Next 16 +
#   Bun, sans aucun code azalee) et avorte l'export AVANT l'émission du standalone
#   (`.next/standalone/.../server.js` ABSENT) → impossible de déployer.
#   Sous Node (/usr/bin/node, v22+) le prerender passe.
#
#   En contrepartie, le cache SQLite embarqué (`lib/supabase/sqlite-client.ts`)
#   utilisait `bun:sqlite` (indispo sous Node) → fallback Postgres → timeouts >60s
#   sur les milliers de fiches perso. Résolu : `node:sqlite` (`DatabaseSync`,
#   Node >= 22) via `process.getBuiltinModule` côté build.
#
# On valide le succès sur la PRÉSENCE d'un BUILD_ID FRAIS + server.js.
set -uo pipefail

NODE_BIN="${NODE_BIN:-/usr/bin/node}"
# Sur le VPS, /usr/bin/node (v22+) existe et est requis (azalee self-host).
# Ailleurs, fallback sur le node du PATH (toujours du vrai Node ici, jamais Bun).
if [ ! -x "$NODE_BIN" ]; then
	NODE_BIN="$(command -v node || true)"
fi
if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
	echo "✗ node introuvable (NODE_BIN='$NODE_BIN') — build impossible" >&2
	exit 127
fi
APP_NAME=$(basename "$(pwd)")
SERVER_JS=".next/standalone/apps/$APP_NAME/server.js"

# TMPDIR sur disque (PAS le tmpfs /tmp, RAM-backed et souvent plein sur ce VPS) :
# un /tmp saturé fait crasher le sous-process babel-loader (SIGTERM/EDQUOT).
BUILD_TMP="${BUILD_TMP:-$HOME/.azalee-build-tmp}"
mkdir -p "$BUILD_TMP"

build_start=$(date +%s)
env TMPDIR="$BUILD_TMP" \
	NODE_ENV=production NODE_NO_WARNINGS=1 \
	"$NODE_BIN" node_modules/next/dist/bin/next build --turbopack "$@"
rc=$?

if [ -f .next/BUILD_ID ] && [ "$(stat -c %Y .next/BUILD_ID)" -ge "$build_start" ]; then
	if [ "$APP_NAME" = "azalee" ] && [ ! -f "$SERVER_JS" ]; then
		echo "✗ build réellement échoué — server.js absent pour azalee" >&2
		exit 1
	fi
	if [ "$rc" -ne 0 ]; then
		echo "⚠ build OK (BUILD_ID $(cat .next/BUILD_ID)) — code retour $rc ignoré (artefacts présents)" >&2
	fi
	exit 0
fi

echo "✗ build réellement échoué — BUILD_ID absent ou non mis à jour (exit $rc)" >&2
exit "$([ "$rc" -ne 0 ] && echo "$rc" || echo 1)"
