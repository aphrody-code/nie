#!/usr/bin/env python3
"""6e brique physique : vitesse de balle de game::BallMoveDribble::vmethod_3 (plage 0x14133AA69→
0x14133AA9A), validée byte-exact via injection XMM (uemu étendu).

    delta = pos - prev                       (subps, 4 lanes)
    si dt > 0 : vel = delta · (1/dt)          (divss 1/dt ; shufps broadcast ; mulps)
    sinon : vel = delta
Entrées : xmm2 = pos, xmm10 = prev, xmm3 = dt(scalaire), xmm9 = 0. Sortie : xmm2 = vel.
(Le comiss dt vs 0 est à 0x14133AA69 → on démarre là pour fixer les flags du jbe.)
"""
import struct, sys
from uemu import Emu
e = Emu()
def f32(x): return struct.unpack("<f", struct.pack("<f", x))[0]

def emulate(pos, prev, dt):
    out = e.call(0x14133AA69, xmm_in={2: (pos[0], pos[1], pos[2], 0.0),
                 10: (prev[0], prev[1], prev[2], 0.0), 3: (dt, 0, 0, 0), 9: (0.0, 0, 0, 0)},
                 stop=0x14133AA9A, read_xmm=[2])
    return out["xmm"][2][:3], out["error"]

def formula(pos, prev, dt):
    d = [f32(pos[i] - prev[i]) for i in range(3)]
    if dt > 0.0:
        inv = f32(1.0 / f32(dt))
        return tuple(f32(d[i] * inv) for i in range(3))
    return tuple(d)

errs = []
for pos, prev, dt in [((5.0,8.0,3.0),(1.0,2.0,3.0),0.5), ((10.0,0.0,-4.0),(2.0,1.0,0.0),0.25),
                      ((1.0,1.0,1.0),(1.0,1.0,1.0),1.0), ((3.0,3.0,3.0),(0.0,0.0,0.0),0.0)]:
    got, err = emulate(pos, prev, dt); exp = formula(pos, prev, dt)
    if err: errs.append(f"{pos},{prev},{dt}: émul {err}")
    elif any(struct.pack("<f", got[i]) != struct.pack("<f", exp[i]) for i in range(3)):
        errs.append(f"{pos},{prev},{dt}: got {got} != {exp}")

if errs:
    print("ÉCHEC vitesse Dribble :")
    for x in errs: print("  -", x)
    sys.exit(1)
print(f"✓ VALIDÉ byte-exact ({4} cas) : vitesse Dribble (pos-prev)·(1/dt) == binaire.")
