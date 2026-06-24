#!/usr/bin/env python3
"""Validation byte-exact : lecteur de valeur typée « read-next-int » (`FUN_140051f40`, 1696 callers).

Itérateur du système de valeurs typées (cf. A1 `menu_setting`/`FUN_141290fc0`). Chaque valeur a un
**tag 2-bit** dans un tableau packé (4 tags/octet). `read_next_int(param)` :
  - i = param[8] (index courant, i32) ;
  - tag = tags[i/4] >> ((i%4)*2) & 3  (tags = obj[8], obj = param[0]) ;
  - param[8] = i+1  (avance l'itérateur) ;
  - tag==1 → renvoie data[i] (i32 brut) ; tag==2 → cvttss2si(data[i] en f32) ; sinon → 0.
    (data = obj[0x10], valeurs 4 o.)

LANDMINE : `cvttss2si` (x86) tronque vers zéro et renvoie **0x80000000** pour NaN/inf/hors-i32 ;
`f as i32` de Rust SATURE → divergent. On fuzz avec des floats limites (NaN, ±inf, ±2^31, 1e20,
fractionnaires) pour verrouiller la sémantique. Sort 0 si byte-exact. Miroir = port `nie_core`.
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


def build(tags, values, index):
    """tags: liste d'entiers 0..3 ; values: liste de mots 4 o (bytes) ; index: i32."""
    param = bytearray(0x10)
    struct.pack_into("<Q", param, 0, OBJ)
    struct.pack_into("<i", param, 8, index)
    obj = bytearray(0x20)
    struct.pack_into("<Q", obj, 8, TAGS)
    struct.pack_into("<Q", obj, 0x10, DATA)
    tagbuf = bytearray((len(tags) + 3) // 4 + 8)
    for i, t in enumerate(tags):
        tagbuf[i >> 2] |= (t & 3) << ((i & 3) * 2)
    databuf = bytearray()  # data lue à DATA + i*4 (PAS de préfixe : le binaire n'a pas de +8 ici)
    for v in values:
        databuf += v
    return bytes(param), bytes(obj), bytes(tagbuf), bytes(databuf)


def emu_read(e, tags, values, index):
    param, obj, tagbuf, databuf = build(tags, values, index)
    mem = {PARAM: param, OBJ: obj, TAGS: tagbuf, DATA: databuf}
    out = e.call(0x140051F40, rcx=PARAM, mem=mem, read={PARAM + 8: 4})
    rax = out["rax"] & 0xFFFFFFFF
    ret = rax - (1 << 32) if rax & 0x80000000 else rax  # i32 signé
    new_idx = struct.unpack("<i", out["mem"][PARAM + 8])[0]
    return ret, new_idx


def cvttss2si(bits):
    """x86 CVTTSS2SI exact : tronque vers zéro ; NaN/inf/hors-i32 → 0x80000000 (=-2^31)."""
    import math
    f = struct.unpack("<f", struct.pack("<I", bits & 0xFFFFFFFF))[0]
    if f != f or math.isinf(f):  # NaN ou ±inf → indefinite
        return -(1 << 31)
    t = math.trunc(f)
    if t > 0x7FFFFFFF or t < -(1 << 31):
        return -(1 << 31)
    return t


def mirror_read(tags, values, index):
    """Miroir du port Rust read_next_int (domaine réel : index >= 0)."""
    i = index
    corr = (i >> 31) & 3  # 0 si i>=0
    ic = i + corr
    byteoff = ic >> 2
    slot = (ic & 3) - corr
    shift = (slot * 2) & 0x1F
    tagbyte = 0
    packed = bytearray((len(tags) + 3) // 4 + 8)
    for k, t in enumerate(tags):
        packed[k >> 2] |= (t & 3) << ((k & 3) * 2)
    tagbyte = packed[byteoff]
    tag = (tagbyte >> shift) & 3
    new_idx = i + 1
    if tag == 1:
        ret = struct.unpack("<i", values[i])[0]
    elif tag == 2:
        ret = cvttss2si(struct.unpack("<I", values[i])[0])
    else:
        ret = 0
    return ret, new_idx


def lcg(state):
    while True:
        state = (state * 6364136223846793005 + 1442695040888963407) & ((1 << 64) - 1)
        yield (state >> 33) & 0x7FFFFFFF


EDGE_FLOATS = [
    0x7FC00000, 0x7F800000, 0xFF800000,           # NaN, +inf, -inf
    0x4F000000, 0xCF000000,                         # +2^31, -2^31
    0x3FC00000, 0xBFC00000,                         # 1.5, -1.5
    0x60AD78EC, 0xE0AD78EC,                         # ~1e20, -1e20
    0x00000000, 0x80000000, 0x3F800000, 0x437F0000,  # 0, -0, 1.0, 255.0
]
e = Emu()
rng = lcg(0x7ED0)
fails = total = 0
for _ in range(800):
    n = next(rng) % 12 + 1
    tags = [next(rng) % 4 for _ in range(n)]
    values = []
    for _ in range(n):
        if next(rng) & 1:
            values.append(struct.pack("<I", EDGE_FLOATS[next(rng) % len(EDGE_FLOATS)]))
        else:
            values.append(struct.pack("<I", next(rng) ^ (next(rng) << 1) & 0xFFFFFFFF))
    index = next(rng) % n  # domaine réel : 0 <= index < n
    total += 1
    er = emu_read(e, tags, values, index)
    mr = mirror_read(tags, values, index)
    if er != mr:
        fails += 1
        if fails <= 10:
            print(f"  ✗ tags={tags} idx={index} tag={tags[index]} val={values[index].hex()}: "
                  f"uemu={er} ≠ miroir={mr}")
print(f"typed value reader (FUN_140051f40): {total} cas ; {'BYTE-EXACT' if not fails else f'{fails} DIVERGENCES'}")
sys.exit(1 if fails else 0)
