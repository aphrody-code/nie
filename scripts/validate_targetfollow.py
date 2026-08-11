#!/usr/bin/env python3
"""3e physique reversée + VALIDÉE byte-exact : game::BallMoveTargetFollow::vmethod_3 @0x14133c080.

Suit une cible avec easing linéaire borné + clamp de la composante y. Utilise SSE3/4 (haddps/insertps/
sqrtps) + FMA3 à opérande mémoire — tous émulés en logiciel par uemu (extension oracle).

Formule reversée (consts .data lus = 0) :
    t += dt
    target_y = max(target.y, bound)            (bound = obj[0x94|0x98] selon flag obj[0x9c])
    delta    = target_clamped - origin          (origin = input[0x10])
    ease     = (duration>0) ? clamp(t/duration, 0, 1) : 1
    step[i]  = fma(delta[i] - sub_c[i], ease, fma_c[i])     (sub_c, fma_c = 0)
    new_pos  = origin + step                     → [rdx]
"""
import struct
import sys

import pefile

from uemu import SCRATCH, Emu

pe = pefile.PE(EXE, fast_load=True)
_base = pe.OPTIONAL_HEADER.ImageBase


def read4f(va):
    for s in pe.sections:
        a = _base + s.VirtualAddress
        if a <= va < a + max(s.Misc_VirtualSize, len(s.get_data())):
            d = s.get_data()[va - a:va - a + 16]
            return struct.unpack("<4f", d) if len(d) >= 16 else (0.0, 0.0, 0.0, 0.0)
    return (0.0, 0.0, 0.0, 0.0)


SUB_C = read4f(0x14133C121 + 0xE0520F)
FMA_C = read4f(0x14133C143 + 0xE051ED)
OBJ, IN, OUT = SCRATCH, SCRATCH + 0x2000, SCRATCH + 0x4000
e = Emu()


def f32(x):
    return struct.unpack("<f", struct.pack("<f", x))[0]


def emulate(target, bound, flag, dur, t0, origin, dt):
    obj = bytearray(0x100)
    struct.pack_into("<4f", obj, 0x70, *target, 0.0)
    struct.pack_into("<f", obj, 0x94, bound)
    struct.pack_into("<f", obj, 0x98, bound)
    obj[0x9C] = flag
    struct.pack_into("<f", obj, 0xAC, dur)
    struct.pack_into("<f", obj, 0xB4, t0)
    inp = bytearray(0x40)
    struct.pack_into("<4f", inp, 0x10, *origin, 0.0)
    struct.pack_into("<f", inp, 0x38, dt)
    out = e.call(0x14133C080, rcx=OBJ, rdx=OUT, r8=IN,
                 mem={OBJ: bytes(obj), IN: bytes(inp), OUT: bytes(16)}, read={OUT: 16}, stub_calls=True)
    return struct.unpack("<4f", out["mem"][OUT])[:3], out["error"]


def formula(target, bound, dur, t0, origin, dt):
    t = f32(t0 + dt)
    ty = max(target[1], bound)  # clamp y
    tgt = (target[0], ty, target[2])
    delta = [f32(tgt[i] - origin[i]) for i in range(3)]
    ease = f32(min(max(f32(t / dur), 0.0), 1.0)) if dur > 0 else 1.0
    import math
    step = [f32(math.fma(f32(delta[i] - SUB_C[i]), ease, FMA_C[i])) for i in range(3)]
    return tuple(f32(origin[i] + step[i]) for i in range(3))


CASES = [
    ((5.0, 8.0, 5.0), 0.0, 0, 2.0, 0.0, (0.0, 0.0, 0.0), 0.5),     # ease 0.25
    ((10.0, -3.0, 2.0), 1.0, 0, 4.0, 1.0, (1.0, 1.0, 1.0), 1.0),   # y clamp -3→1, ease 0.5
    ((3.0, 3.0, 3.0), 0.0, 0, 1.0, 0.0, (0.0, 0.0, 0.0), 5.0),     # t>dur → ease clamp 1
]
errs = []
for c in CASES:
    got, err = emulate(*c)
    exp = formula(c[0], c[1], c[3], c[4], c[5], c[6])
    if err:
        errs.append(f"{c}: émulation {err}")
    elif any(struct.pack("<f", got[i]) != struct.pack("<f", exp[i]) for i in range(3)):
        errs.append(f"{c}: got {got} != {exp}")

if errs:
    print("ÉCHEC TargetFollow :")
    for x in errs:
        print("  -", x)
    sys.exit(1)
print(f"✓ VALIDÉ byte-exact ({len(CASES)} cas) : BallMoveTargetFollow::vmethod_3 — physique (SSE3/4+FMA) == binaire.")
print(f"  consts .data : sub={SUB_C[:3]} fma={FMA_C[:3]}")
print("→ 3e physique de gameplay reversée + validée (oracle étendu haddps/insertps/sqrtps/mem-FMA).")
