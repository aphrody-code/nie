#!/usr/bin/env python3
"""VRAIE physique de gameplay reversée + VALIDÉE byte-exact contre l'oracle uemu.

Cible : `game::BallMoveSimpleParabora::vmethod_3` @0x141334600 (exe courant, leaf pur, 0 appel,
17 ops SSE). Trajectoire de projectile parabolique. REVERSAL depuis l'asm :

    new_pos = p0 + v*dt + 0.5*a*dt²     (mulps 0.5 ; *accel ; *dt ; *dt ; + (p0 + v*dt))
    v       = v + a*dt                  (intégration de la vitesse)
    t       = t + dt                    (avance temps)
    renvoie : encore en mouvement (t+dt < t_max)

Offsets (validés par le désassemblage) — objet (rcx) : accel@0x160, vel@0x180, t@0x190, t_max@0x170 ;
input (r8) : pos0@0x10, dt@0x38 ; sortie : new_pos → [rdx].

VALIDATION : on émule la fonction RÉELLE avec des floats connus, et on compare la sortie (position,
vitesse, t) au calcul Rust/Python de la formule reversée — BYTE-EXACT (bits f32). Si OK → la physique
parabolique est fidèlement reversée, prouvée contre le binaire, sans inventer ni lancer le jeu.
"""
import struct
import sys

from uemu import SCRATCH, Emu

VADDR = 0x141334600
OBJ = SCRATCH            # rcx : l'objet BallMoveSimpleParabora
IN = SCRATCH + 0x2000    # r8  : les paramètres d'entrée
OUT = SCRATCH + 0x4000   # rdx : la position de sortie


def vec(x, y, z, w=0.0):
    return struct.pack("<4f", x, y, z, w)


def f4(b):
    return struct.unpack("<4f", b)


# Valeurs de test (4 lanes ; w=0).
p0 = (1.0, 2.0, 3.0, 0.0)
v = (4.0, 5.0, 6.0, 0.0)
a = (0.0, -9.8, 0.0, 0.0)   # gravité sur Y
dt = 0.5
t0, t_max = 0.0, 10.0

obj = bytearray(0x200)
struct.pack_into("<4f", obj, 0x160, *a)
struct.pack_into("<4f", obj, 0x180, *v)
struct.pack_into("<f", obj, 0x190, t0)
struct.pack_into("<f", obj, 0x170, t_max)
inp = bytearray(0x40)
struct.pack_into("<4f", inp, 0x10, *p0)
struct.pack_into("<f", inp, 0x38, dt)

e = Emu()
out = e.call(VADDR, rcx=OBJ, rdx=OUT, r8=IN, mem={OBJ: bytes(obj), IN: bytes(inp), OUT: bytes(16)},
             read={OUT: 16, OBJ + 0x180: 16, OBJ + 0x190: 4})

got_pos = f4(out["mem"][OUT])
got_vel = f4(out["mem"][OBJ + 0x180])
got_t = struct.unpack("<f", out["mem"][OBJ + 0x190])[0]

def f32(x):
    return struct.unpack("<f", struct.pack("<f", x))[0]  # arrondi simple précision


def bits(x):
    return struct.unpack("<I", struct.pack("<f", x))[0]


# Formule reversée, calculée en f32 dans l'ORDRE EXACT des ops SSE du binaire (pas en float64).
af, vf, p0f, dtf = [f32(x) for x in a], [f32(x) for x in v], [f32(x) for x in p0], f32(dt)
# term1 = ((0.5*a)*dt)*dt = ½·a·dt²  ;  term2 = (dt*v)+p0  ;  pos = term1+term2
exp_pos = tuple(
    f32(f32(f32(f32(0.5 * af[i]) * dtf) * dtf) + f32(f32(dtf * vf[i]) + p0f[i])) for i in range(4)
)
exp_vel = tuple(f32(vf[i] + f32(dtf * af[i])) for i in range(4))  # vel + dt*accel
exp_t = f32(t0 + dtf)


errs = []
for i in range(4):
    if bits(got_pos[i]) != bits(exp_pos[i]):
        errs.append(f"pos[{i}] got {got_pos[i]} != attendu {exp_pos[i]}")
    if bits(got_vel[i]) != bits(exp_vel[i]):
        errs.append(f"vel[{i}] got {got_vel[i]} != attendu {exp_vel[i]}")
if bits(got_t) != bits(exp_t):
    errs.append(f"t got {got_t} != attendu {exp_t}")
if out["error"]:
    errs.append(f"émulation: {out['error']}")

if errs:
    print("ÉCHEC validation parabole :")
    for x in errs:
        print("  -", x)
    sys.exit(1)

print("✓ VALIDÉ byte-exact : BallMoveSimpleParabora::vmethod_3 (0x141334600) — physique == binaire réel.")
print(f"  new_pos = {got_pos[:3]}  (= p0 + v·dt + ½·a·dt²)")
print(f"  new_vel = {got_vel[:3]}  (= v + a·dt)   |   t = {got_t}")
print("→ VRAIE intégration physique de gameplay REVERSÉE + VALIDÉE contre l'oracle (sans inventer).")
