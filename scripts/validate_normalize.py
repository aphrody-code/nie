#!/usr/bin/env python3
"""5e brique physique : normalisation vectorielle inlinée de game::BallMoveRate::vmethod_3
(plage 0x141339484→0x1413394B1), validée byte-exact via injection XMM (uemu étendu).

Séquence (entrée xmm8 = vecteur ; xmm7 = 1.0 ; xmm6 = 0) :
    len = sqrt((x²+y²)+(z²+0))          (insertps zéro-w + mulps + 2×haddps + sqrtps)
    si len > 0 : dir = v * (1/len)       (divss 1/len ; shufps broadcast ; mulps) → xmm1
    sinon : dir = (valeur init de xmm1)
→ xmm1 = dir, xmm3 = len.
"""
import struct, sys
from uemu import Emu
e = Emu()
def f32(x): return struct.unpack("<f", struct.pack("<f", x))[0]

def emulate(v):
    out = e.call(0x141339484, xmm_in={8: (v[0], v[1], v[2], 0.0), 7: (1.0, 0, 0, 0),
                 6: (0.0, 0, 0, 0), 1: (0.0, 0, 0, 0)}, stop=0x1413394B1, read_xmm=[1, 3])
    return out["xmm"][1], out["xmm"][3][0]

def formula(v):
    x, y, z = f32(v[0]), f32(v[1]), f32(v[2])
    length = f32(f32(f32(f32(x*x) + f32(y*y)) + f32(f32(z*z) + 0.0)) ** 0.5)
    if length > 0.0:
        inv = f32(1.0 / length)
        return (f32(x*inv), f32(y*inv), f32(z*inv), 0.0), length
    return (0.0, 0.0, 0.0, 0.0), length

errs = []
for v in [(3.0, 4.0, 0.0), (1.0, 2.0, 2.0), (-5.0, 0.0, 12.0), (0.0, 0.0, 0.0), (0.3, -0.4, 0.5)]:
    (gd, gl) = emulate(v); (ed, el) = formula(v)
    if struct.pack("<f", gl) != struct.pack("<f", el):
        errs.append(f"{v}: len got {gl} != {el}")
    for i in range(3):
        if struct.pack("<f", gd[i]) != struct.pack("<f", ed[i]):
            errs.append(f"{v}: dir[{i}] got {gd[i]} != {ed[i]}")

if errs:
    print("ÉCHEC normalize :")
    for x in errs[:10]: print("  -", x)
    sys.exit(1)
print(f"✓ VALIDÉ byte-exact ({5} cas) : normalisation vectorielle (BallMoveRate) == binaire.")
print("  sqrt((x²+y²)+(z²+0)) puis v·(1/len) ; len≤0 → zéro. (injection XMM uemu)")
