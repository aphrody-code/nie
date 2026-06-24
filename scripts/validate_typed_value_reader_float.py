#!/usr/bin/env python3
"""Validation byte-exact : lecteur de valeur typée « read-next-FLOAT » (`FUN_140051fc0`, 331 callers).

Sibling FLOAT de `read_next_int` (`FUN_140051f40`) : même lecture de tag 2-bit + avance d'index, mais
renvoie un **f32** (dans `xmm0` — Ghidra a typé la fonction `void` en perdant ce retour). Tag 1 →
`(f32)i32` (cvtsi2ss, arrondi au plus proche = `as f32` de Rust) ; tag 2 → le f32 brut ; sinon 0.0.

On lit `xmm0` via uemu et on compare bit-à-bit (valeurs finies → round-trip `struct.pack` exact) +
l'index avancé. Sort 0 si byte-exact. Miroir = port `nie_core::typed_value_reader::read_next_float`.
"""
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from uemu import Emu, SCRATCH  # noqa: E402

PARAM = SCRATCH + 0x100
OBJ = SCRATCH + 0x200
TAGS = SCRATCH + 0x400
DATA = SCRATCH + 0x600


def f32(x):
    return struct.unpack("<f", struct.pack("<f", x))[0]


def build(tags, values, index):
    param = bytearray(0x10)
    struct.pack_into("<Q", param, 0, OBJ)
    struct.pack_into("<i", param, 8, index)
    obj = bytearray(0x20)
    struct.pack_into("<Q", obj, 8, TAGS)
    struct.pack_into("<Q", obj, 0x10, DATA)
    tagbuf = bytearray((len(tags) + 3) // 4 + 8)
    for i, t in enumerate(tags):
        tagbuf[i >> 2] |= (t & 3) << ((i & 3) * 2)
    return bytes(param), bytes(obj), bytes(tagbuf), b"".join(values)


def emu_read(e, tags, values, index):
    param, obj, tagbuf, databuf = build(tags, values, index)
    out = e.call(0x140051FC0, rcx=PARAM, mem={PARAM: param, OBJ: obj, TAGS: tagbuf, DATA: databuf},
                 read={PARAM + 8: 4}, read_xmm=[0])
    f = out["xmm"][0][0]  # lane 0 de xmm0
    new_idx = struct.unpack("<i", out["mem"][PARAM + 8])[0]
    return struct.pack("<f", f), new_idx


def mirror_read(tags, values, index):
    tag = tags[index]
    new_idx = index + 1
    if tag == 1:
        iv = struct.unpack("<i", values[index])[0]
        f = f32(float(iv))  # cvtsi2ss : i32 → f32, arrondi au plus proche pair
    elif tag == 2:
        f = struct.unpack("<f", values[index])[0]  # f32 brut (passthrough)
    else:
        f = 0.0
    return struct.pack("<f", f), new_idx


def lcg(state):
    while True:
        state = (state * 6364136223846793005 + 1442695040888963407) & ((1 << 64) - 1)
        yield (state >> 33) & 0x7FFFFFFF


# floats finis variés (round-trip pack exact ; on évite NaN dont les bits ne survivent pas au tuple)
EDGE_F = [0.0, 1.0, -1.0, 1.5, 255.0, 1e20, -1e20, 16777217.0, 0.1, -0.0]
# ints variés incl. > 2^24 (arrondi cvtsi2ss)
EDGE_I = [0, 1, -1, 42, -7, 16777217, 16777219, -16777219, 2147483647, -2147483648, 123456789]

e = Emu()
rng = lcg(0xF10A7)
fails = total = 0
for _ in range(700):
    n = next(rng) % 12 + 1
    tags = [next(rng) % 4 for _ in range(n)]
    values = []
    for _ in range(n):
        r = next(rng) % 3
        if r == 0:
            values.append(struct.pack("<i", EDGE_I[next(rng) % len(EDGE_I)]))
        elif r == 1:
            values.append(struct.pack("<f", EDGE_F[next(rng) % len(EDGE_F)]))
        else:
            values.append(struct.pack("<I", (next(rng) ^ (next(rng) << 1)) & 0xFFFFFFFF))
    index = next(rng) % n
    total += 1
    er = emu_read(e, tags, values, index)
    mr = mirror_read(tags, values, index)
    if er != mr:
        fails += 1
        if fails <= 10:
            ev = struct.unpack("<f", er[0])[0]
            mv = struct.unpack("<f", mr[0])[0]
            print(f"  ✗ tags={tags} idx={index} tag={tags[index]} val={values[index].hex()}: "
                  f"uemu={ev}({er[1]}) ≠ miroir={mv}({mr[1]})")
print(f"typed value reader FLOAT (FUN_140051fc0): {total} cas ; {'BYTE-EXACT' if not fails else f'{fails} DIVERGENCES'}")
sys.exit(1 if fails else 0)
