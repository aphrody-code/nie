#!/usr/bin/env python3
"""Validation byte-exact : `pop_front` de la liste active du conteneur de menu (`FUN_140453570`).

Côté ÉCRITURE du conteneur (les find A2a-A2e = côté lecture). Les nœuds 6 o sont une liste
**doublement chaînée** : prev u16 @+0, next u16 @+2 (sortpos @+4). L'en-tête porte un curseur de
tête `+0x16`, une queue `+0x18`, un compteur `+0x1a` (+ `+0x1c` nodes_off, `+0x24` cap).

`FUN_140453570(hdr)` détache le nœud de tête (curseur) :
  - curseur >= cap → liste vide → renvoie 0, aucune mutation ;
  - tête == queue → dernier élément → tête=queue=0xffff, count-- , renvoie le nœud ;
  - sinon → nouvelle tête = courant.next ; new_head.prev = 0xffff ; curseur = next ; count-- ;
    renvoie l'ancien nœud de tête.

Mutant mais SANS vtable ni global ⇒ isolable. On compare BYTE-EXACT (valeur de retour + champs
d'en-tête mutés + champ prev du nouveau nœud de tête) à l'oracle uemu. Fuzz seedé de listes
doublement chaînées valides (ordre aléatoire) + cas liste-vide. Miroir = port `nie_core`.
"""
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from uemu import Emu, SCRATCH  # noqa: E402

HDR = SCRATCH + 0x100
BASE = SCRATCH + 0x4000
NOFF = 0x200
CAP = 0x100
NBUF = 0x400  # taille du buffer de nœuds lu en retour


def build(order, n_nodes):
    """En-tête + buffer : liste doublement chaînée suivant `order` (ordre tête→queue)."""
    hdr = bytearray(0x40)
    struct.pack_into("<Q", hdr, 0x08, BASE)
    cursor = order[0] if order else 0xFFFF
    tail = order[-1] if order else 0xFFFF
    struct.pack_into("<H", hdr, 0x16, cursor)
    struct.pack_into("<H", hdr, 0x18, tail)
    struct.pack_into("<H", hdr, 0x1A, len(order))
    struct.pack_into("<I", hdr, 0x1C, NOFF)
    struct.pack_into("<H", hdr, 0x24, CAP)
    data = bytearray(NBUF)
    # init tous les nœuds avec prev/next sentinelle
    for i in range(n_nodes):
        struct.pack_into("<H", data, NOFF + i * 6 + 0, 0xFFFF)
        struct.pack_into("<H", data, NOFF + i * 6 + 2, 0xFFFF)
    for i, nd in enumerate(order):
        prev = order[i - 1] if i > 0 else 0xFFFF
        nxt = order[i + 1] if i < len(order) - 1 else 0xFFFF
        struct.pack_into("<H", data, NOFF + nd * 6 + 0, prev)
        struct.pack_into("<H", data, NOFF + nd * 6 + 2, nxt)
    return bytes(hdr), bytes(data)


def emu_pop(e, order, n_nodes):
    hdr, data = build(order, n_nodes)
    out = e.call(0x140453570, rcx=HDR, mem={HDR: hdr, BASE: data},
                 read={HDR + 0x16: 6, BASE: NBUF})
    rax = out["rax"]
    popped = None if rax == 0 else (rax - BASE - NOFF) // 6
    h = out["mem"][HDR + 0x16]
    cursor, tail, count = struct.unpack("<HHH", h)
    nodes = out["mem"][BASE]
    return popped, cursor, tail, count, nodes


def mirror_pop(order, n_nodes):
    """Miroir du port Rust IntrusiveListCursor::pop_front (mute en place)."""
    data = bytearray(NBUF)
    for i in range(n_nodes):
        struct.pack_into("<H", data, NOFF + i * 6 + 0, 0xFFFF)
        struct.pack_into("<H", data, NOFF + i * 6 + 2, 0xFFFF)
    for i, nd in enumerate(order):
        prev = order[i - 1] if i > 0 else 0xFFFF
        nxt = order[i + 1] if i < len(order) - 1 else 0xFFFF
        struct.pack_into("<H", data, NOFF + nd * 6 + 0, prev)
        struct.pack_into("<H", data, NOFF + nd * 6 + 2, nxt)
    cursor = order[0] if order else 0xFFFF
    tail = order[-1] if order else 0xFFFF
    count = len(order)
    if cursor >= CAP:
        return None, cursor, tail, count, bytes(data)
    popped = cursor
    if tail == cursor:
        cursor = 0xFFFF
        tail = 0xFFFF
        count = (count - 1) & 0xFFFF
        return popped, cursor, tail, count, bytes(data)
    nxt = struct.unpack_from("<H", data, NOFF + popped * 6 + 2)[0]
    if nxt >= CAP:
        return None, cursor, tail, count, bytes(data)  # garde-fou (le binaire ferait un déréf NULL)
    struct.pack_into("<H", data, NOFF + nxt * 6 + 0, 0xFFFF)  # new_head.prev = sentinelle
    cursor = nxt
    count = (count - 1) & 0xFFFF
    return popped, cursor, tail, count, bytes(data)


def lcg(state):
    while True:
        state = (state * 6364136223846793005 + 1442695040888963407) & ((1 << 64) - 1)
        yield (state >> 33) & 0x7FFFFFFF


e = Emu()
rng = lcg(0xF00DBEEF)
fails = total = 0

# Listes valides aléatoires de tailles variées (ordre tête→queue = permutation).
for _ in range(700):
    n = next(rng) % 20 + 1
    n_nodes = n + (next(rng) % 6)  # quelques nœuds libres en plus (hors liste)
    order = list(range(n))
    for i in range(n - 1, 0, -1):
        j = next(rng) % (i + 1)
        order[i], order[j] = order[j], order[i]
    total += 1
    er = emu_pop(e, order, n_nodes)
    mr = mirror_pop(order, n_nodes)
    if er != mr:
        fails += 1
        if fails <= 8:
            print(f"  ✗ order={order}: uemu=({er[0]},{er[1]:#x},{er[2]:#x},{er[3]}) "
                  f"mir=({mr[0]},{mr[1]:#x},{mr[2]:#x},{mr[3]}) nodes_eq={er[4]==mr[4]}")

# Cas liste vide (curseur sentinelle) → aucune mutation, renvoie 0.
total += 1
er = emu_pop(e, [], 8)
mr = mirror_pop([], 8)
if er != mr:
    fails += 1
    print(f"  ✗ vide: uemu={er[:4]} mir={mr[:4]}")

print(f"intrusive_map (pop_front, FUN_140453570): {total} cas ; {'BYTE-EXACT' if not fails else f'{fails} DIVERGENCES'}")
sys.exit(1 if fails else 0)
