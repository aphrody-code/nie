#!/usr/bin/env python3
"""Validation byte-exact de FUN_140d3b8f0 via l'oracle uemu.

FUN_140d3b8f0(param_1, param_2:byte, param_3:byte, param_4:u32) -> u64
  Calcule l'adresse d'un élément dans une table multi-dimensionnelle :
    base = *(u64*)(param_1 + 0x1758)
    return base + ((uVar2 + 8) << 4) + uVar1*0x2b8 + uVar3*0x82c
  avec :
    uVar2 = param_4 if param_4 < 0x1d else 0          (index 0..28, stride 0x10, +8)
    uVar1 = param_3 if param_3 < 3  else 0            (index 0..2,  stride 0x2b8)
    uVar3 = param_2 if param_2 < 14 else (gb!=2 ? 2:0) (index 0..13, stride 0x82c)
  gb = octet singleton *(*(u64*)0x141fa8fc0 + 0x69a0) + 0x2ca97f) — n'est lu QUE si param_2>=14.

Le port renvoie l'OFFSET invariant (sans la base runtime).
"""
import struct
import sys

import sys as _sys
from pathlib import Path as _Path
_sys.path.insert(0, str(_Path(__file__).resolve().parent))
from uemu import Emu, SCRATCH

VA = 0x140D3B8F0

# Disposition mémoire (tout dans SCRATCH, pré-mappé, 1 MiB) :
P1 = SCRATCH                         # rcx = param_1 ; base lue à P1+0x1758
GLOBAL_VAR = 0x141FA8FC0            # variable globale dans l'image PE (load -> P)
P = SCRATCH + 0x20000              # valeur du singleton (pointeur)
Q_SLOT = P + 0x69A0                # P+0x69a0 contient Q
BYTE_ADDR = SCRATCH + 0x90000      # octet lu à Q+0x2ca97f
Q = BYTE_ADDR - 0x2CA97F           # valeur Q telle que Q+0x2ca97f == BYTE_ADDR

assert 0 <= Q_SLOT - SCRATCH < 0x100000
assert 0 <= BYTE_ADDR - SCRATCH < 0x100000


def model(base, p2, p3, p4, gb):
    p2 &= 0xFF
    p3 &= 0xFF
    p4 &= 0xFFFFFFFF
    gb &= 0xFF
    if p2 < 14:
        uv3 = p2
    else:
        uv3 = 0 if gb == 2 else 2
    uv2 = p4 if p4 < 0x1D else 0
    uv1 = p3 if p3 < 3 else 0
    offset = ((uv2 + 8) << 4) + uv1 * 0x2B8 + uv3 * 0x82C
    return (base + offset) & 0xFFFFFFFFFFFFFFFF


def run_emu(e, base, p2, p3, p4, gb):
    mem = {
        P1 + 0x1758: struct.pack("<Q", base & 0xFFFFFFFFFFFFFFFF),
        GLOBAL_VAR: struct.pack("<Q", P),
        Q_SLOT: struct.pack("<Q", Q & 0xFFFFFFFFFFFFFFFF),
        BYTE_ADDR: bytes([gb & 0xFF]),
    }
    out = e.call(VA, rcx=P1, rdx=p2 & 0xFF, r8=p3 & 0xFF, r9=p4 & 0xFFFFFFFF, mem=mem)
    if out.get("error"):
        raise RuntimeError(f"uemu error: {out['error']}")
    return out["rax"]


def lcg(seed):
    x = seed & 0xFFFFFFFFFFFFFFFF
    while True:
        x = (x * 6364136223846793005 + 1442695040888963407) & 0xFFFFFFFFFFFFFFFF
        yield x


def main():
    e = Emu()
    cases = []

    # Bords exhaustifs : param_2 autour de 14, param_3 autour de 3, param_4 autour de 29.
    bases = [0, 0x1000, 0x140000000, 0xDEADBEEF, 0xFFFFFFFFFFFFFF00]
    gbs = [0, 1, 2, 3, 0xFF]
    for base in bases:
        for p2 in range(0, 20):
            for p3 in range(0, 6):
                for p4 in [0, 1, 27, 28, 29, 30, 100, 0xFFFFFFFF]:
                    for gb in gbs:
                        cases.append((base, p2, p3, p4, gb))

    # Fuzz seedé LCG.
    rng = lcg(0xC0FFEE140D3B8F0)
    for _ in range(800):
        a = next(rng)
        b = next(rng)
        base = a & 0xFFFFFFFFFFFFFFFF
        p2 = (b >> 0) & 0xFF
        p3 = (b >> 8) & 0xFF
        p4 = (b >> 16) & 0xFFFFFFFF
        gb = (a >> 56) & 0xFF
        cases.append((base, p2, p3, p4, gb))

    fails = 0
    checked = 0
    for (base, p2, p3, p4, gb) in cases:
        got = run_emu(e, base, p2, p3, p4, gb)
        exp = model(base, p2, p3, p4, gb)
        checked += 1
        if got != exp:
            fails += 1
            if fails <= 20:
                print(f"MISMATCH base={base:#x} p2={p2} p3={p3} p4={p4} gb={gb}: "
                      f"emu={got:#x} model={exp:#x} diff={got-exp}")

    print(f"cas vérifiés: {checked}")
    if fails == 0:
        print("BYTE-EXACT")
        return 0
    print(f"ÉCHECS: {fails}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
