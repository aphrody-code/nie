#!/usr/bin/env python3
"""Suite de régression des validations byte-exact RE (oracle uemu vs binaire réel).

Exécute toutes les fonctions reversées + validées contre l'émulation Unicorn du binaire. Garde-fou
contre toute dérive (de uemu, du binaire monté, ou d'un port). Lancer :
    .venv/bin/python scripts/validate_re.py

Chaque entrée prouve qu'une logique reversée correspond BYTE-EXACT au binaire (règle no-faux-FAIT).
À étendre à chaque nouvelle fonction validée (BallMove*, keeper, action…).
"""
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent
PY = HERE.parent / ".venv" / "bin" / "python"

# (script, description) — chaque script sort 0 si la validation byte-exact passe.
SUITE = [
    ("validate_ball_ctor.py", "init objet ballon + contexte physique (gravité -9.8f) — SSE"),
    ("validate_parabola.py", "BallMoveSimpleParabora — trajectoire projectile (SSE)"),
    ("validate_lerp.py", "BallMoveLerp — interpolation adoucie (SSE + FMA3 émulée)"),
]

ok = 0
for script, desc in SUITE:
    r = subprocess.run([str(PY), str(HERE / script)], capture_output=True, text=True)
    passed = r.returncode == 0
    print(f"  [{'✓' if passed else '✗'}] {script:24} — {desc}")
    if not passed:
        print("      " + (r.stdout + r.stderr).strip().replace("\n", "\n      "))
    ok += passed

print(f"\n{ok}/{len(SUITE)} validations byte-exact vs binaire réel.")
sys.exit(0 if ok == len(SUITE) else 1)
