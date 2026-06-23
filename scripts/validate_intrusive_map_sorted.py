#!/usr/bin/env python3
"""Validation byte-exact : recherche binaire du mode TRIÉ de la map de menu (`FUN_1402b4160`).

Mode trié (`header[+0x20]!=0`) de `FUN_1402e2a10` : binary-search sur un tableau d'index trié
`puVar7=base+[+0x20]` (u16), clés `entries[puVar7[i]].key` croissantes (u32). Renvoie la position
triée (leftmost-equal si `param_3==null`) ou `0xffff` ; `param_3` (out) = position d'insertion sur
échec. **Fuzz seedé** (arbres aléatoires avec doublons, cibles présentes/absentes/bords, deux modes
out) comparé byte-exact à l'oracle uemu. Sort 0 si byte-exact. Miroir = port `nie_core::intrusive_map`.
"""
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from uemu import Emu, SCRATCH  # noqa: E402

HDR = SCRATCH + 0x100
BASE = SCRATCH + 0x4000
SOFF = 0x400
OUT = SCRATCH + 0x200


def emu(e, keys, perm, target, out_mode):
    n = len(perm)
    hdr = bytearray(0x40)
    struct.pack_into("<Q", hdr, 0x08, BASE)
    struct.pack_into("<H", hdr, 0x14, n)
    struct.pack_into("<I", hdr, 0x20, SOFF)
    data = bytearray(0x1000)
    for i, p in enumerate(perm):
        struct.pack_into("<I", data, 8 + p * 0x10, keys[i] & 0xFFFFFFFF)
    for i, p in enumerate(perm):
        struct.pack_into("<H", data, SOFF + i * 2, p)
    mem = {HDR: bytes(hdr), BASE: bytes(data)}
    if out_mode:
        mem[OUT] = b"\xAA\xAA"
    out = e.call(0x1402B4160, rcx=HDR, rdx=target & 0xFFFFFFFF,
                 r8=(OUT if out_mode else 0), mem=mem, read=({OUT: 2} if out_mode else None))
    ov = struct.unpack("<H", out["mem"][OUT])[0] if out_mode else None
    return out["rax"] & 0xFFFF, ov


def mirror(sk, target, out_mode):
    """Miroir du port Rust nie_core::intrusive_map::IntrusiveMapSorted::search."""
    target &= 0xFFFFFFFF
    n = len(sk)
    if n == 0:
        return 0xffff, None
    u6 = 0
    if (sk[0] & 0xFFFFFFFF) < target:
        if (sk[n - 1] & 0xFFFFFFFF) <= target:
            if (sk[n - 1] & 0xFFFFFFFF) < target:
                return 0xffff, ((n - 1) if out_mode else None)
            if out_mode:
                return (n - 1), None
            if sk[n - 2] == target:
                u5 = n - 1
                while True:
                    u3 = u5 - 1
                    u5 = u3
                    if sk[u3 - 1] != target:
                        break
                return u5, None
            return n - 1, None
        if n > 2:
            lo, hi = 1, n - 2
            if hi != 0:
                while True:
                    mid = ((hi - lo) >> 1) + lo
                    u6 = mid
                    km = sk[mid] & 0xFFFFFFFF
                    if km == target:
                        if out_mode:
                            return mid, None
                        if sk[mid - 1] == target:
                            u5 = mid
                            while True:
                                u3 = u5 - 1
                                u5 = u3
                                if sk[u5 - 1] != target:
                                    break
                            return u3, None
                        return mid, None
                    if target < km:
                        if mid == 0:
                            break
                        hi = mid - 1
                    else:
                        lo = mid + 1
                    if lo > hi:
                        break
        return 0xffff, (u6 if out_mode else None)
    if (sk[0] & 0xFFFFFFFF) <= target:
        return 0, None
    return 0xffff, (0 if out_mode else None)


def lcg(state):
    while True:
        state = (state * 6364136223846793005 + 1442695040888963407) & ((1 << 64) - 1)
        yield (state >> 33) & 0x7FFFFFFF


e = Emu()
rng = lcg(0xC0FFEE)
fails = total = 0
for _ in range(700):
    n = next(rng) % 18 + 1
    keys = sorted((next(rng) % 14) for _ in range(n))
    perm = list(range(n))
    for i in range(n - 1, 0, -1):  # Fisher-Yates déterministe
        j = next(rng) % (i + 1)
        perm[i], perm[j] = perm[j], perm[i]
    targets = set(keys) | {keys[0] - 1, keys[-1] + 1, 0, 0xFFFFFFFF, next(rng) % 16}
    for tg in targets:
        for om in (False, True):
            total += 1
            er, eo = emu(e, keys, perm, tg, om)
            mr, mo = mirror(keys, tg, om)
            okp = er == mr
            oko = (not om) or (mr != 0xffff) or (eo == mo)
            if not (okp and oko):
                fails += 1
                if fails <= 10:
                    print(f"  ✗ sk={keys} tg={tg & 0xFFFFFFFF:#x} out={om}: uemu=({er:#x},{eo}) mir=({mr:#x},{mo})")
print(f"intrusive_map (trié/binary-search): {total} cas ; {'BYTE-EXACT' if not fails else f'{fails} DIVERGENCES'}")
sys.exit(1 if fails else 0)
