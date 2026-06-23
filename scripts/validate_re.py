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
    ("validate_targetfollow.py", "BallMoveTargetFollow — suivi cible (SSE3/4 haddps/insertps/sqrtps + FMA mem)"),
    ("validate_trajectory.py", "Trajectoires MULTI-FRAMES (parabola/lerp/targetfollow, état réinjecté) — révèle le clamp+snap de Lerp"),
    ("validate_goalnet.py", "BallMoveGoalnet nearest-point — argmin dist² (insertps/mulps/haddps, first-win)"),
    ("validate_uemu_xmm.py", "Extension uemu injection/lecture XMM0-15 (fragments réels)"),
    ("validate_normalize.py", "Normalisation vectorielle BallMoveRate (réciproque-produit, len>0) — via injection XMM"),
    ("validate_dribble_vel.py", "Vitesse BallMoveDribble (pos-prev)·(1/dt) — via injection XMM"),
    ("validate_bezier.py", "Point Bezier quadratique BallMoveBezier (de Casteljau FMA) — fonction complète émulée"),
    ("validate_rate_progress.py", "Progression scalaire BallMoveRate (recalcul taux + avance) — fonction complète émulée"),
    ("validate_normal_vel.py", "Intégration de vitesse BallMoveNormal (s=(dt·accel+v)·factor ; dir=signe·dir) — fonction complète émulée"),
    ("validate_path_eval.py", "Path-eval cinématique BallMoveRate (projectile XZ+Y) — gravité runtime résolue (.bss init)"),
    ("validate_getcomponent.py", "Modélisation ECS GetComponent (marche de liste) — débloque les fonctions composant-dépendantes"),
    ("validate_keeper_reach.py", "Portée d'arrêt keeper = min(dive·scale) — vpermilps/blendvps émulés"),
    ("validate_reflect.py", "Réflexion de collision BallMoveNormal v-2(v·n)n — injection XMM"),
    ("validate_menu_setting.py", "Décodeur valeurs typées objet-menu CMenuStateMachine (FUN_141290fc0, +0x590..0x5ba)"),
    ("validate_intrusive_map.py", "Find map intrusive de menu mode linéaire (FUN_1402e2a10) — primitive list-view"),
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
