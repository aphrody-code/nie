#!/usr/bin/env python3
"""Validation byte-exact de FUN_14007faf0 (produit de quaternions Hamilton q1*q2).

Layout quaternion : float[4] = (x, y, z, w) avec w = scalaire (index 3).
ABI : rcx=param_1 (q1), rdx=param_2 (out), r8=param_3 (q2). out = q1 * q2.

Ordre d'accumulation tiré de l'asm (mulss/addss/subss scalaires, AUCUNE FMA) :
  out[0] = ((x2*w1 + w2*x1) + z2*y1) - y2*z1
  out[1] = ((w2*y1 + w1*y2) + x2*z1) - x1*z2
  out[2] = ((w1*z2 + w2*z1) + x1*y2) - x2*y1
  out[3] = ((w1*w2 - x2*x1) - y1*y2) - z2*z1
La multiplication f32 est commutative et exacte au bit ; seul l'ordre des +/- importe.
"""
import ctypes
import struct
import sys

from uemu import Emu, SCRATCH

VA = 0x14007FAF0
Q1 = SCRATCH + 0x000
OUT = SCRATCH + 0x100
Q2 = SCRATCH + 0x200


def f32(x):
    """Arrondi f32 round-to-nearest-even, sature à +/-inf (comme SSE).
    Calcul en f64 puis arrondi : pour add/sub double-rounding inoffensif (53 >= 2*24+2),
    pour mul le produit de deux f32 est exact en f64 → arrondi unique."""
    return ctypes.c_float(x).value


def quat_mul(q1, q2):
    """Miroir de la sémantique f32 ; ordre d'accumulation identique à l'asm."""
    m = f32
    x1, y1, z1, w1 = (m(v) for v in q1)  # inputs déjà f32 (comme stockés en mémoire émulée)
    x2, y2, z2, w2 = (m(v) for v in q2)
    o0 = m(m(m(m(x2 * w1) + m(w2 * x1)) + m(z2 * y1)) - m(y2 * z1))
    o1 = m(m(m(m(w2 * y1) + m(w1 * y2)) + m(x2 * z1)) - m(x1 * z2))
    o2 = m(m(m(m(w1 * z2) + m(w2 * z1)) + m(x1 * y2)) - m(x2 * y1))
    o3 = m(m(m(m(w1 * w2) - m(x2 * x1)) - m(y1 * y2)) - m(z2 * z1))
    return (o0, o1, o2, o3)


def emu_call(e, q1, q2):
    out = e.call(
        VA,
        rcx=Q1,
        rdx=OUT,
        r8=Q2,
        mem={
            Q1: struct.pack("<4f", *q1),
            Q2: struct.pack("<4f", *q2),
            OUT: b"\xaa" * 16,  # poison
        },
        read={OUT: 16},
    )
    if out.get("error"):
        # ret bancal capture quand même la mémoire ; on tolère seulement si on lit l'out
        pass
    raw = out["mem"][OUT]
    return struct.unpack("<4f", raw)


# PRNG LCG déterministe (Numerical Recipes)
class LCG:
    def __init__(self, seed):
        self.s = seed & 0xFFFFFFFFFFFFFFFF

    def next_u32(self):
        self.s = (self.s * 6364136223846793005 + 1442695040888963407) & 0xFFFFFFFFFFFFFFFF
        return (self.s >> 33) & 0xFFFFFFFF

    def f(self, lo, hi):
        return lo + (self.next_u32() / 0xFFFFFFFF) * (hi - lo)


def bits(x):
    return struct.unpack("<I", struct.pack("<f", f32(x)))[0]


def is_nan_bits(b):
    return (b & 0x7F800000) == 0x7F800000 and (b & 0x007FFFFF) != 0


def main():
    e = Emu()
    rng = LCG(0xC0FFEE1234)

    cases = []
    # bords explicites
    specials = [0.0, -0.0, 1.0, -1.0, 0.5, -0.5, 2.0, 1e-20, -1e-20, 1e20, -1e20,
                float("inf"), float("-inf"), 3.14159265, -2.71828, 0.70710678]
    # quelques quaternions normalisés-ish + paires de spéciaux
    for a in specials:
        for b in specials[:6]:
            cases.append(((a, b, a, b), (b, a, b, a)))
    # fuzz aléatoire
    for _ in range(800):
        q1 = tuple(f32(rng.f(-10, 10)) for _ in range(4))
        q2 = tuple(f32(rng.f(-10, 10)) for _ in range(4))
        cases.append((q1, q2))
    # fuzz petites valeurs (subnormaux possibles)
    for _ in range(200):
        q1 = tuple(f32(rng.f(-1e-30, 1e-30)) for _ in range(4))
        q2 = tuple(f32(rng.f(-1e30, 1e30)) for _ in range(4))
        cases.append((q1, q2))

    fails = 0
    nan_cases = 0
    finite_comps = 0
    for i, (q1, q2) in enumerate(cases):
        emu = emu_call(e, q1, q2)
        mir = quat_mul(q1, q2)
        for k in range(4):
            be = bits(emu[k])
            bm = bits(mir[k])
            if is_nan_bits(be) and is_nan_bits(bm):
                nan_cases += 1
                continue  # payload NaN = artefact HW, canonicalisé
            finite_comps += 1
            if be != bm:
                fails += 1
                if fails <= 20:
                    print(f"MISMATCH case {i} comp {k}: q1={q1} q2={q2}")
                    print(f"  emu={emu[k]!r} (0x{be:08x})  mir={mir[k]!r} (0x{bm:08x})")
                break

    print(f"\n{len(cases)} cas, {finite_comps} comparaisons finies/inf byte-exact, "
          f"{nan_cases} NaN canonicalisés, {fails} mismatch")
    if fails == 0:
        print("BYTE-EXACT")
        sys.exit(0)
    sys.exit(1)


if __name__ == "__main__":
    main()
