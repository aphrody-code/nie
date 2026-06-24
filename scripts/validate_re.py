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
    ("validate_intrusive_map_sorted.py", "Recherche binaire mode trié de la map de menu (FUN_1402b4160) — fuzz seedé"),
    ("validate_intrusive_map_next.py", "Itérateur next-equal du conteneur trié (FUN_140541de0) — énum. de run multimap, fuzz"),
    ("validate_intrusive_map_c.py", "2e instanciation du conteneur (FUN_14050b0b0, entrées 0xc) — généralisation entry_stride, fuzz 2 modes"),
    ("validate_intrusive_map_d.py", "3e instanciation du conteneur (FUN_1401f5ab0, entrées 0x18, clé @+0) — généralisation key_base, fuzz 2 modes"),
    ("validate_intrusive_map_pop.py", "pop_front liste active du conteneur (FUN_140453570) — côté ÉCRITURE, mutation byte-exact, fuzz"),
    ("validate_intrusive_map_e.py", "4e instanciation du conteneur (FUN_1404523c0, entrées 0x28, clé @+0) — template à 4 strides, fuzz 2 modes"),
    ("validate_path_stem.py", "File-stem de chemin d'asset (FUN_140452820) — basename sans dernière ext, strrchr SSE, fuzz"),
    ("validate_typed_value_reader.py", "Lecteur read-next-int de valeur typée (FUN_140051f40, 1696 callers) — tags 2-bit + cvttss2si exact, fuzz"),
    ("validate_affine_compose.py", "Composition de matrices affines 3×4 (FUN_14007f8f0) — FMA fusée, transform pipeline, fuzz"),
    ("validate_keyed_record_lookup.py", "Lookup record 0xb0 par clé 40-bit (FUN_1404af530) — linéaire/binaire + early-exit param_2==0, fuzz"),
    ("validate_aspect_viewport.py", "Viewport letterbox/pillarbox au ratio (FUN_14045ff50) — rendu, division entière exacte, fuzz"),
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
