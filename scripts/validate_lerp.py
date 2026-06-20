#!/usr/bin/env python3
"""2e physique de gameplay (FMA) reversée + VALIDÉE byte-exact contre l'oracle uemu.

Cible : `game::BallMoveLerp::vmethod_3` @0x141339ba0 (exe courant, leaf, SSE + FMA3 vfmadd231ps —
émulé en logiciel par uemu). Interpolation adoucie (quartic ease-out) entre origin et target :

    t   += dt
    s    = t / duration
    ease = clamp(1 - (s-1)⁴, 0, 1)
    pos  = origin + ease·(target - origin)     (FMA : ease·(target-origin) + origin)

Offsets : target@[rcx+0x60], t@[rcx+0xa0], duration@[rcx+0xa4] (objet) ; dt@[r8+0x38],
origin@[[r8]+0x1410]. Sortie → [rdx].

VALIDATION : émule la fonction RÉELLE (FMA émulée) avec des floats connus et compare position/t au
calcul f32 de la formule reversée (ordre des ops, FMA via math.fma→f32) — BYTE-EXACT.
"""
import math
import struct
import sys

from uemu import SCRATCH, Emu

VADDR = 0x141339BA0
OBJ = SCRATCH
IN = SCRATCH + 0x2000
ENDOBJ = SCRATCH + 0x4000
OUT = SCRATCH + 0x6000


def f32(x):
    return struct.unpack("<f", struct.pack("<f", x))[0]


target = (10.0, 20.0, 30.0, 0.0)   # [rcx+0x60]
origin = (1.0, 2.0, 3.0, 0.0)      # [[r8]+0x1410]
t0, dur, dt = 0.0, 2.0, 0.5

obj = bytearray(0x100)
struct.pack_into("<4f", obj, 0x60, *target)
struct.pack_into("<f", obj, 0xA0, t0)
struct.pack_into("<f", obj, 0xA4, dur)
inp = bytearray(0x40)
struct.pack_into("<Q", inp, 0, ENDOBJ)
struct.pack_into("<f", inp, 0x38, dt)
eo = bytearray(0x1420)
struct.pack_into("<4f", eo, 0x1410, *origin)

e = Emu()
out = e.call(VADDR, rcx=OBJ, rdx=OUT, r8=IN,
             mem={OBJ: bytes(obj), IN: bytes(inp), ENDOBJ: bytes(eo), OUT: bytes(16)},
             read={OUT: 16, OBJ + 0xA0: 4})
got_pos = struct.unpack("<4f", out["mem"][OUT])
got_t = struct.unpack("<f", out["mem"][OBJ + 0xA0])[0]

# Formule reversée en f32 (ordre des ops du binaire).
tnew = f32(t0 + dt)
s = f32(tnew / dur)
e2 = f32(f32(s - 1.0) * f32(s - 1.0))
e4 = f32(e2 * e2)
ease = f32(max(min(f32(1.0 - e4), 1.0), 0.0))
exp_pos = tuple(f32(math.fma(ease, f32(target[i] - origin[i]), origin[i])) for i in range(4))

errs = []
for i in range(3):
    if struct.pack("<f", got_pos[i]) != struct.pack("<f", exp_pos[i]):
        errs.append(f"pos[{i}] got {got_pos[i]} != {exp_pos[i]}")
if struct.pack("<f", got_t) != struct.pack("<f", tnew):
    errs.append(f"t got {got_t} != {tnew}")
if out["error"]:
    errs.append(f"émulation: {out['error']}")

if errs:
    print("ÉCHEC validation lerp :")
    for x in errs:
        print("  -", x)
    sys.exit(1)

print("✓ VALIDÉ byte-exact : BallMoveLerp::vmethod_3 (0x141339ba0) — physique (SSE+FMA) == binaire réel.")
print(f"  ease = {ease} (quartic ease-out)   |   pos = {got_pos[:3]}   |   t = {got_t}")
print("→ 2e physique de gameplay (avec FMA3 émulée) REVERSÉE + VALIDÉE contre l'oracle.")
