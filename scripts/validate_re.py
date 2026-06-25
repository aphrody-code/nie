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
    ("validate_typed_value_reader_float.py", "Lecteur read-next-FLOAT de valeur typée (FUN_140051fc0, 331 callers) — sibling float, cvtsi2ss, fuzz"),
    ("validate_handle_table.py", "Find-first-active via table de handles validés (FUN_1411da770) — génération anti-stale, fuzz"),
    ("validate_quat_mul.py", "Produit de quaternions Hamilton (FUN_14007faf0) — SSE scalaire sans FMA, fuzz 1096 cas"),
    ("validate_mat4_mul.py", "Multiplication matrices 4×4 row-major (FUN_140090fa0) — mulps+3×vfmadd231ps, fuzz 604 cas"),
    ("validate_byte_keyed_table.py", "Lookup table records 8o par clé 1 octet (FUN_140d8f2b0) — scan linéaire first-win, fuzz 608 cas"),
    ("validate_fixed_slot_append.py", "Append élément 0xB8 à tableau capacité fixe (FUN_140506730) — côté ÉCRITURE, fuzz 600 cas"),
    ("validate_category_lookup.py", "Catégorie d'un id dans table 14×29 (FUN_140d3bac0) — 4 branches found/fallback/sentinelle, fuzz 600 cas"),
    ("validate_strcmp.py", "strcmp MSVC SIMD (FUN_14168b570) — comparaison C non signée -1/0/1, fuzz 668 cas"),
    ("validate_strncmp.py", "strncmp MSVC (FUN_14168b330) — comparaison C bornée non signée, fuzz 908 cas"),
    ("validate_strlen.py", "strlen MSVC SWAR (FUN_14168b5f0) — longueur chaîne C, fuzz 1028 cas"),
    ("validate_entry_offset.py", "Adresse d'élément table 14×29×3 (FUN_140d3b8f0) — sibling de category_lookup, fuzz 24800 cas"),
    ("validate_effect_obj_ctor.py", "Ctor lives::CEffectObjComponent (FUN_140071d70) — struct 0xD0 + compteur, fuzz 600 cas"),
    ("validate_typed_list_iter.py", "Deref+avance itérateur liste typée 2-bit (FUN_140052040) — sentinelles/bases/NULL, fuzz 800 cas"),
    ("validate_imm_batcher.py", "Assembleur primitives mode immédiat (FUN_14075c030) — transform+émission 5 modes, fuzz 800 cas"),
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
