#!/usr/bin/env bash
# scripts/ops/model-serve-prewarm.sh
# Production-ready pre-warming pipeline for nie-model-serve (port 8790).
# Assembles and caches high-traffic 3D GLB character models and keshin in var/model-cache/.

set -euo pipefail

HOST="${MODEL_SERVE_HOST:-127.0.0.1}"
PORT="${MODEL_SERVE_PORT:-8790}"
BASE_URL="http://${HOST}:${PORT}"

# Health check first
if ! curl -fsS "${BASE_URL}/health" >/dev/null 2>&1; then
    echo "nie-model-serve is not responding at ${BASE_URL}/health" >&2
    exit 1
fi

echo "=== nie-model-serve 2026 Pre-warm Pipeline ==="
echo "Target: ${BASE_URL}"

# Priority character and asset codes for pre-assembly
TARGETS=(
    "c01000010" # Endou Mamoru / Mark Evans
    "c01000020" # Gouenji Shuuya / Axel Blaze
    "c01000030" # Kidou Yuuto / Jude Sharp
    "c01000040" # Fubuki Shirou / Shawn Froste
    "c01000050" # Kazemaru Ichirouta / Nathan Swift
    "c01000060" # Aphrodi / Byron Love
    "k000010"   # Majin The Hand (Keshin)
    "ka001901"  # Keshin Armed
)

success=0
total=${#TARGETS[@]}

for code in "${TARGETS[@]}"; do
    url="${BASE_URL}/model-full/${code}.glb"
    printf "Pre-warming %-12s ... " "${code}.glb"
    start=$(date +%s%N 2>/dev/null || date +%s)

    status=$(curl -s -o /dev/null -w "%{http_code}" "$url" || echo "000")
    end=$(date +%s%N 2>/dev/null || date +%s)

    if [ "$status" = "200" ]; then
        success=$((success + 1))
        echo "OK (HTTP 200)"
    else
        echo "FAIL (HTTP $status)"
    fi
done

echo "Pre-warming completed: ${success}/${total} assets ready in model cache."
