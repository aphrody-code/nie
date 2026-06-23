#!/usr/bin/env python3
"""4e brique physique : chercheur de point de filet le plus proche de game::BallMoveGoalnet::vmethod_3
(@0x1413385C0, boucle initiale) — VALIDÉ byte-exact contre l'oracle uemu.

Géométrie pure (le reste de Goalnet, après l'appel 0x1413378C0, est hors-scope) :
    target = context[0x15F0..0x15FC]   (xy via movsd@0x15F0, z via movss@0x15F8)
    pour i in 0..obj[0x140] : point = obj[0x890 + i*0x760] (Vec3)
        d2 = (dx*dx + dy*dy) + (dz*dz + 0)    (insertps zéro-w + mulps + 2×haddps, f32)
        si d2 < min (init FLT_MAX) : nearest = i ; min = d2     (comiss/jae → strict <, first-win)
    → obj[0x1020] = nearest (init -1)

On monte l'objet + la table + la cible, émule (stub_calls : l'appel post-boucle 0x1413378C0 est
stubé ; nearest est écrit AVANT), et on compare obj[0x1020] au calcul f32 Python. BYTE-EXACT.
"""
import struct
import sys

from uemu import SCRATCH, Emu

VADDR = 0x1413385C0
OBJ = SCRATCH                 # rcx : l'objet BallMoveGoalnet
INP = SCRATCH + 0x8000        # r8  : input ; [INP] = pointeur contexte
CTX = SCRATCH + 0xA000        # contexte : [0x15F0..] = position cible
OUT = SCRATCH + 0xC000        # rdx (non lu)
STRIDE = 0x760


def f32(x):
    return struct.unpack("<f", struct.pack("<f", x))[0]


def nearest_formula(points, target):
    """argmin du d2 reversé, en f32, first-win (init FLT_MAX, idx -1)."""
    best_i, best_d2 = -1, float("inf")
    for i, p in enumerate(points):
        dx, dy, dz = f32(p[0] - target[0]), f32(p[1] - target[1]), f32(p[2] - target[2])
        d2 = f32(f32(f32(dx * dx) + f32(dy * dy)) + f32(f32(dz * dz) + 0.0))
        if d2 < best_d2:  # comiss/jae → maj si d2 < min (strict)
            best_d2, best_i = d2, i
    return best_i


def emulate(points, target):
    obj = bytearray(0x3000)
    obj[0x1069] = 0  # flag : doit être 0 pour entrer la boucle
    struct.pack_into("<I", obj, 0x140, len(points))  # count
    struct.pack_into("<i", obj, 0x1020, -1)  # nearest init
    for i, p in enumerate(points):
        struct.pack_into("<4f", obj, 0x890 + i * STRIDE, p[0], p[1], p[2], 0.0)
    inp = bytearray(0x20)
    struct.pack_into("<Q", inp, 0, CTX)  # [r8] = pointeur contexte
    ctx = bytearray(0x1700)
    struct.pack_into("<4f", ctx, 0x15F0, target[0], target[1], target[2], 0.0)
    e = Emu()
    out = e.call(VADDR, rcx=OBJ, rdx=OUT, r8=INP,
                 mem={OBJ: bytes(obj), INP: bytes(inp), CTX: bytes(ctx), OUT: bytes(16)},
                 read={OBJ + 0x1020: 4}, stub_calls=True)
    return struct.unpack("<i", out["mem"][OBJ + 0x1020])[0]


CASES = [
    ([(5.0, 0.0, 0.0), (1.0, 1.0, 1.0), (-3.0, 2.0, 4.0)], (0.0, 0.0, 0.0)),   # le plus proche = 1
    ([(10.0, 10.0, 10.0), (0.5, 0.5, 0.5)], (0.0, 0.0, 0.0)),                  # = 1
    ([(2.0, 0.0, 0.0), (0.0, 2.0, 0.0), (0.0, 0.0, 1.5)], (0.1, 0.1, 0.1)),    # = 2 (dz=1.4)
    ([(1.0, 1.0, 1.0), (1.0, 1.0, 1.0)], (0.0, 0.0, 0.0)),                     # égalité → first (0)
]
errs = []
for pts, tgt in CASES:
    got = emulate(pts, tgt)
    exp = nearest_formula(pts, tgt)
    if got != exp:
        errs.append(f"points={pts} target={tgt}: uemu nearest={got} != formule={exp}")

if errs:
    print("ÉCHEC Goalnet nearest :")
    for x in errs:
        print("  -", x)
    sys.exit(1)
print(f"✓ VALIDÉ byte-exact ({len(CASES)} cas) : BallMoveGoalnet nearest-point — argmin d2 == binaire.")
print("→ 4e brique physique (géométrie de filet de but) reversée + validée vs oracle.")
