#!/usr/bin/env bash
# Décompile par-VA les fonctions de jeu encore non portées, en réutilisant le projet Ghidra
# déjà analysé (var/ghidra-proj/niers_nie) — PAS de ré-analyse (-noanalysis -process).
# Pré-requis : l'analyse Ghidra initiale (analyzeHeadless -import) doit être TERMINÉE.
# Sortie : un .c par fonction dans var/ghidra-decompile/.
set -euo pipefail
cd "$(dirname "$0")/.."

EXE_NAME="nie_eacpatched.exe"
PROJ_DIR="var/ghidra-proj"
PROJ_NAME="niers_nie"
SCRIPTS=".agents/skills/ghidra-headless/scripts/ghidra_scripts"
OUT="var/ghidra-decompile"
mkdir -p "$OUT"

# Cibles = step (slot 4, vtable+0x20) des contrôleurs ball-move non portés + calc d'arrêt gardien.
#   1413359b0 = Bezier/MultiBezier/RealSkillShootBezier (step partagé)
#   1413385c0 = Goalnet      1413390d0 = Rate      14133a8f0 = Dribble      14133ae10 = Normal
#   1413dcfe0 = keeper save-calc (slot 10)          1413dcf50 = keeper (slot 2)
export GHIDRA_VAS="${GHIDRA_VAS:-1413359b0,1413385c0,1413390d0,14133a8f0,14133ae10,1413dcfe0,1413dcf50}"
export GHIDRA_OUTPUT_DIR="$OUT"

echo "décompilation par-VA: $GHIDRA_VAS"
analyzeHeadless "$PROJ_DIR" "$PROJ_NAME" \
  -process "$EXE_NAME" -noanalysis \
  -scriptPath "$SCRIPTS" -postScript DecompileVAs.java
echo "→ sorties dans $OUT/"
