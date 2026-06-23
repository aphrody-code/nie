#!/usr/bin/env python3
"""Validation byte-exact : find d'une map intrusive de menu (`FUN_1402e2a10`, mode linéaire).

Primitive de lookup amont des écrans à liste (`CMenuListView`). On émule la fonction sur une map
synthétique en mode linéaire (`header[+0x20]==0`) et on compare l'index de nœud retourné au lookup
reversé (miroir du port `nie_core::intrusive_map`). Sort 0 si byte-exact.

Layout : entrées 0x10 o (clé i32 @+0) à `base+8` ; nœuds 6 o (`next` u16 @+2) à `base+nodes_off` ;
header `+8`=base, `+0x10`=tête, `+0x1c`=nodes_off, `+0x20`=0 (linéaire), `+0x24`=capacité.
"""
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from uemu import Emu, SCRATCH  # noqa: E402

HDR = SCRATCH + 0x100
BASE = SCRATCH + 0x4000
OFF = 0x200
CAP = 0x100


def build(entries, nexts, head):
    hdr = bytearray(0x40)
    struct.pack_into("<Q", hdr, 0x08, BASE)
    struct.pack_into("<H", hdr, 0x10, head)
    struct.pack_into("<I", hdr, 0x1C, OFF)
    struct.pack_into("<I", hdr, 0x20, 0)
    struct.pack_into("<H", hdr, 0x24, CAP)
    data = bytearray(0x400)
    for i, k in enumerate(entries):
        struct.pack_into("<i", data, 8 + i * 0x10, k)
    for i, nx in enumerate(nexts):
        struct.pack_into("<H", data, OFF + i * 6 + 2, nx)
    return bytes(hdr), bytes(data)


def emu_find(e, key, entries, nexts, head):
    hdr, data = build(entries, nexts, head)
    out = e.call(0x1402E2A10, rcx=HDR, rdx=key & 0xFFFFFFFF, mem={HDR: hdr, BASE: data})
    rax = out["rax"]
    return ((rax - BASE - OFF) // 6) if rax else None


def reversed_find(key, entries, nexts, head):
    """Miroir Python du port Rust (branche linéaire reversée)."""
    if head >= CAP:
        return None
    idx = head
    while True:
        if idx < len(entries) and entries[idx] == key:
            return idx
        nx = nexts[idx] if idx < len(nexts) else 0xFFFF
        if nx >= CAP:
            return None
        idx = nx


CASES = [
    # (entries, nexts, head, [clés à tester])
    ([100, 200, 300], [1, 2, 0xFFFF], 0, [100, 200, 300, 999]),
    ([100, 200, 300], [1, 2, 0xFFFF], 1, [100, 200, 300]),
    ([42], [0x100], 0, [42, 0]),
    ([7, 8, 9, 10], [1, 2, 3, 0x100], 0, [7, 10, 11]),
]

e = Emu()
fails = 0
total = 0
for entries, nexts, head, keys in CASES:
    for k in keys:
        total += 1
        got = emu_find(e, k, entries, nexts, head)
        exp = reversed_find(k, entries, nexts, head)
        if got != exp:
            fails += 1
            print(f"  ✗ head={head} find({k}): uemu={got} ≠ reversé={exp}")
print(f"intrusive_map: {total} lookups ; {'BYTE-EXACT' if not fails else f'{fails} DIVERGENCES'}")
sys.exit(1 if fails else 0)
