#!/usr/bin/env python3
"""Validation byte-exact : itérateur « entrée suivante de même clé » (`FUN_140541de0`).

Complète l'API *read* du conteneur trié de menu (`IntrusiveMapSorted`) : après `find`, énumère un
run de doublons (multimap). Étant donné le **nœud courant** (`param_2`), la fonction lit sa position
triée `pos = node[+4]`, calcule l'entrée à la position triée suivante `next = sorted[pos+1]`, et
renvoie le nœud suivant `base+nodes_off+next*6` UNIQUEMENT si `key[next] == key[courant]` ; sinon 0.
Termine aussi si `pos >= count-1` (signé) ou `next >= cap`.

**Fuzz seedé** : arbres triés aléatoires AVEC doublons (clés croissantes, permutation Fisher-Yates),
chaque entrée testée comme nœud courant, comparé byte-exact à l'oracle uemu. Le buffer est *bien
formé* — `node[+4]` = permutation inverse (position triée de l'entrée) — domaine réel de la fonction.
Sort 0 si byte-exact. Miroir = port `nie_core::intrusive_map::IntrusiveMapSorted::next_equal`.
"""
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from uemu import Emu, SCRATCH  # noqa: E402

HDR = SCRATCH + 0x100
BASE = SCRATCH + 0x4000
NOFF = 0x200  # nodes_off (header[+0x1c])
SOFF = 0x400  # sorted_off (header[+0x20])
CAP = 0x100  # capacité (header[+0x24])


def build(keys_by_entry, sorted_arr):
    """Buffer bien formé : entrées (clé i32 @+0, 0x10 o), nœuds (pos triée u16 @+4, 6 o), index trié."""
    n = len(sorted_arr)
    inv = [0] * n  # inv[entry] = position triée de l'entrée
    for i, ent in enumerate(sorted_arr):
        inv[ent] = i
    hdr = bytearray(0x40)
    struct.pack_into("<Q", hdr, 0x08, BASE)
    struct.pack_into("<H", hdr, 0x14, n)
    struct.pack_into("<I", hdr, 0x1C, NOFF)
    struct.pack_into("<I", hdr, 0x20, SOFF)
    struct.pack_into("<H", hdr, 0x24, CAP)
    data = bytearray(0x1000)
    for e_idx, k in enumerate(keys_by_entry):
        struct.pack_into("<i", data, 8 + e_idx * 0x10, k)
        struct.pack_into("<H", data, NOFF + e_idx * 6 + 4, inv[e_idx])
    for i, ent in enumerate(sorted_arr):
        struct.pack_into("<H", data, SOFF + i * 2, ent)
    return bytes(hdr), bytes(data)


def emu_next(e, keys_by_entry, sorted_arr, cur_entry):
    hdr, data = build(keys_by_entry, sorted_arr)
    node_ptr = BASE + NOFF + cur_entry * 6
    out = e.call(0x140541DE0, rcx=HDR, rdx=node_ptr, mem={HDR: hdr, BASE: data})
    rax = out["rax"]
    return None if rax == 0 else (rax - BASE - NOFF) // 6


def mirror_next(keys_by_entry, sorted_arr, cur_entry):
    """Miroir du port Rust : raisonne en positions triées sur un buffer bien formé."""
    n = len(sorted_arr)
    inv = [0] * n
    for i, ent in enumerate(sorted_arr):
        inv[ent] = i
    pos = inv[cur_entry]
    if pos >= n - 1:  # (int)pos < (int)(count - 1)
        return None
    next_entry = sorted_arr[pos + 1]
    if next_entry >= CAP:
        return None
    if keys_by_entry[next_entry] == keys_by_entry[cur_entry]:
        return next_entry
    return None


def lcg(state):
    while True:
        state = (state * 6364136223846793005 + 1442695040888963407) & ((1 << 64) - 1)
        yield (state >> 33) & 0x7FFFFFFF


e = Emu()
rng = lcg(0xBADF00D)
fails = total = 0
for _ in range(900):
    n = next(rng) % 16 + 1
    keys = sorted((next(rng) % 6) for _ in range(n))  # petit domaine → beaucoup de doublons
    perm = list(range(n))
    for i in range(n - 1, 0, -1):  # Fisher-Yates déterministe → sorted_arr
        j = next(rng) % (i + 1)
        perm[i], perm[j] = perm[j], perm[i]
    # keys_by_entry : l'entrée perm[i] porte la i-ème clé triée.
    keys_by_entry = [0] * n
    for i, ent in enumerate(perm):
        keys_by_entry[ent] = keys[i]
    for cur_entry in range(n):
        total += 1
        er = emu_next(e, keys_by_entry, perm, cur_entry)
        mr = mirror_next(keys_by_entry, perm, cur_entry)
        if er != mr:
            fails += 1
            if fails <= 10:
                print(f"  ✗ keys={keys} sorted={perm} cur={cur_entry}: uemu={er} ≠ miroir={mr}")
print(f"intrusive_map (next-equal): {total} cas ; {'BYTE-EXACT' if not fails else f'{fails} DIVERGENCES'}")
sys.exit(1 if fails else 0)
