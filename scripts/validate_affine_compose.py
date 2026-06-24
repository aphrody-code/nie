#!/usr/bin/env python3
"""Validation byte-exact : composition de matrices affines 3×4 (`FUN_14007f8f0`, 61 callers).

Géométrie du moteur : `out = a ∘ b`. Chaque matrice est **3 lignes de 4 floats** (4e ligne implicite
`[0,0,0,1]`, lue de la constante `.rdata` `_DAT_141866910`). Pour chaque ligne `r` de `a` (vec4) :
  out[r][j] = r.x*b0[j]  (mul) ;  += r.y*b1[j] ; += r.z*b2[j] ; += r.w*P3[j]   (chaque += = FMA fusée)
avec P3 = [0,0,0,1]. Le binaire utilise `vfmadd231ps` (FMA) → le port DOIT utiliser `mul_add` dans le
même ordre d'accumulation (sinon dérive de dernier bit). Fuzz seedé de matrices finies, comparées
bit-à-bit (12 floats) à l'oracle uemu. Sort 0 si byte-exact. Miroir = port `nie_core::affine`.
"""
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from uemu import Emu, SCRATCH  # noqa: E402

IN1 = SCRATCH + 0x100
OUT = SCRATCH + 0x200
IN2 = SCRATCH + 0x300
CONST_VA = 0x141866910  # _DAT_141866910 = [0,0,0,1]


def fma(a, b, c):
    """FMA f32 fusée (un seul arrondi), via float64 puis arrondi f32 — comme le hardware/uemu."""
    import math
    r = math.fma(a, b, c) if hasattr(math, "fma") else (a * b + c)
    return f32(r)


def f32(x):
    return struct.unpack("<f", struct.pack("<f", x))[0]


def emu_compose(e, a, b):
    in1 = b"".join(struct.pack("<4f", *a[r]) for r in range(3))
    in2 = b"".join(struct.pack("<4f", *b[r]) for r in range(3))
    mem = {IN1: in1, IN2: in2, OUT: b"\x00" * 48, CONST_VA: struct.pack("<4f", 0, 0, 0, 1)}
    out = e.call(0x14007F8F0, rcx=IN1, rdx=OUT, r8=IN2, mem=mem, read={OUT: 48})
    raw = out["mem"][OUT]
    return [list(struct.unpack_from("<4f", raw, r * 16)) for r in range(3)]


P3 = (0.0, 0.0, 0.0, 1.0)


def mirror_compose(a, b):
    """Miroir du port : out[r][j] = fma-chain(r.x*b0[j], r.y*b1[j], r.z*b2[j], r.w*P3[j])."""
    out = [[0.0] * 4 for _ in range(3)]
    for r in range(3):
        row = a[r]
        for j in range(4):
            t0 = f32(f32(row[0]) * f32(b[0][j]))
            t1 = fma(row[1], b[1][j], t0)
            t2 = fma(row[2], b[2][j], t1)
            t3 = fma(row[3], P3[j], t2)
            out[r][j] = t3
    return out


def bits(rows):
    return [struct.unpack("<I", struct.pack("<f", v))[0] for row in rows for v in row]


def lcg(state):
    while True:
        state = (state * 6364136223846793005 + 1442695040888963407) & ((1 << 64) - 1)
        yield (state >> 33) & 0x7FFFFFFF


def randf(rng):
    # floats finis variés : [-100,100] avec fractions + quelques entiers/zéros
    v = (next(rng) % 200001 - 100000) / 1000.0
    return f32(v)


e = Emu()
rng = lcg(0x3AFF1)
fails = total = 0
for _ in range(700):
    a = [[randf(rng) for _ in range(4)] for _ in range(3)]
    b = [[randf(rng) for _ in range(4)] for _ in range(3)]
    total += 1
    er = emu_compose(e, a, b)
    mr = mirror_compose(a, b)
    if bits(er) != bits(mr):
        fails += 1
        if fails <= 6:
            print(f"  ✗ a={a}\n    b={b}\n    uemu={er}\n    mir ={mr}")

# Cas identité : b = identité affine → out == a (bit-exact).
ident = [[1.0, 0, 0, 0], [0, 1.0, 0, 0], [0, 0, 1.0, 0]]
a = [[1.5, -2.0, 3.25, 1.0], [0.5, 4.0, -1.0, 0.0], [7.0, 8.0, 9.0, 1.0]]
total += 1
er = emu_compose(e, a, ident)
if bits(er) != bits(a):
    fails += 1
    print(f"  ✗ identité: uemu={er} ≠ a={a}")

print(f"affine compose 3x4 (FUN_14007f8f0): {total} cas ; {'BYTE-EXACT' if not fails else f'{fails} DIVERGENCES'}")
sys.exit(1 if fails else 0)
