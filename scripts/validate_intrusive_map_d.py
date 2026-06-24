#!/usr/bin/env python3
"""Validation byte-exact : TROISIÈME instanciation du conteneur map intrusive (`FUN_1401f5ab0`).

`FUN_1401f5ab0` est le MÊME conteneur dual-mode que `FUN_1402e2a10`/`FUN_14050b0b0` — header
identique (+8 base, +0x10 tête, +0x14 count, +0x1c nodes_off, +0x20 sorted_off, +0x24 cap), nœuds
6 o (next u16 @+2), recherche binaire trié — à DEUX détails près : **entrées de 0x18 o** ET **clé
i32 @ entrée+0** (PAS +8 comme les familles 0xc/0x10). Renvoie directement le NŒUD dans les 2 modes.

But : prouver que le port Rust généralisé (`IntrusiveMap{Linear,Sorted}` paramétré par `entry_stride`
ET `key_base`) est byte-exact contre une TROISIÈME fonction réelle → le conteneur est un *template*
instancié aux strides {0xc, 0x10, 0x18} / key_base {8, 8, 0}. Triple-validation anti-faux-FAIT. Les
miroirs (linéaire indexé par nœud ; trié sur clés triées) sont stride/offset-agnostiques. Sort 0 si
byte-exact. Fuzz seedé des deux modes (chaînes linéaires acycliques).
"""
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from uemu import Emu, SCRATCH  # noqa: E402

HDR = SCRATCH + 0x100
BASE = SCRATCH + 0x4000
NOFF = 0x200  # nodes_off
SOFF = 0x400  # sorted_off (mode trié)
CAP = 0x100
STRIDE = 0x18  # 3e instanciation
KEY_BASE = 0   # clé @ entrée+0 (PAS +8 comme les familles 0xc/0x10)


def _hdr(head, count, sorted_off):
    h = bytearray(0x40)
    struct.pack_into("<Q", h, 0x08, BASE)
    struct.pack_into("<H", h, 0x10, head)
    struct.pack_into("<H", h, 0x14, count)
    struct.pack_into("<I", h, 0x1C, NOFF)
    struct.pack_into("<I", h, 0x20, sorted_off)
    struct.pack_into("<H", h, 0x24, CAP)
    return bytes(h)


# ── Mode linéaire (header[+0x20]==0) ──────────────────────────────────────────
def emu_linear(e, entries, nexts, head, key):
    hdr = _hdr(head, 0, 0)
    data = bytearray(0x1000)
    for i, k in enumerate(entries):
        struct.pack_into("<i", data, KEY_BASE + i * STRIDE, k)
    for i, nx in enumerate(nexts):
        struct.pack_into("<H", data, NOFF + i * 6 + 2, nx)
    out = e.call(0x1401F5AB0, rcx=HDR, rdx=key & 0xFFFFFFFF, mem={HDR: hdr, BASE: bytes(data)})
    rax = out["rax"]
    return None if rax == 0 else (rax - BASE - NOFF) // 6


def mirror_linear(entries, nexts, head, key):
    """Miroir de IntrusiveMapLinear::find (indexé par nœud, stride-agnostique)."""
    if head >= CAP:
        return None
    idx = head
    for _ in range(len(entries) + 2):  # garde-fou : un conteneur valide est acyclique
        if idx < len(entries) and entries[idx] == key:
            return idx
        nx = nexts[idx] if idx < len(nexts) else 0xFFFF
        if nx >= CAP:
            return None
        idx = nx
    return None


# ── Mode trié (header[+0x20]!=0) ──────────────────────────────────────────────
def emu_sorted(e, keys, perm, target):
    n = len(perm)
    hdr = _hdr(0, n, SOFF)
    data = bytearray(0x1000)
    for i, p in enumerate(perm):
        struct.pack_into("<I", data, KEY_BASE + p * STRIDE, keys[i] & 0xFFFFFFFF)
        struct.pack_into("<H", data, SOFF + i * 2, p)
    out = e.call(0x1401F5AB0, rcx=HDR, rdx=target & 0xFFFFFFFF, mem={HDR: hdr, BASE: bytes(data)})
    rax = out["rax"]
    return None if rax == 0 else (rax - BASE - NOFF) // 6  # index d'entrée du nœud renvoyé


def mirror_sorted_pos(sk, target):
    """Position triée leftmost-equal (miroir de IntrusiveMapSorted::search, with_out=False)."""
    target &= 0xFFFFFFFF
    n = len(sk)
    if n == 0:
        return 0xFFFF
    if (sk[0] & 0xFFFFFFFF) < target:
        if (sk[n - 1] & 0xFFFFFFFF) <= target:
            if (sk[n - 1] & 0xFFFFFFFF) < target:
                return 0xFFFF
            if n >= 2 and sk[n - 2] == target:
                u5 = n - 1
                while True:
                    u3 = u5 - 1
                    u5 = u3
                    if sk[u3 - 1] != target:
                        break
                return u5
            return n - 1
        if n > 2:
            lo, hi = 1, n - 2
            if hi != 0:
                while True:
                    mid = ((hi - lo) >> 1) + lo
                    km = sk[mid] & 0xFFFFFFFF
                    if km == target:
                        if sk[mid - 1] == target:
                            u5 = mid
                            while True:
                                u3 = u5 - 1
                                u5 = u3
                                if sk[u5 - 1] != target:
                                    break
                            return u3
                        return mid
                    if target < km:
                        if mid == 0:
                            break
                        hi = mid - 1
                    else:
                        lo = mid + 1
                    if lo > hi:
                        break
        return 0xFFFF
    if (sk[0] & 0xFFFFFFFF) <= target:
        return 0
    return 0xFFFF


def mirror_sorted_entry(keys, perm, target):
    """find_entry = entry index = perm[find_position] ; None si absent ou entrée >= cap."""
    pos = mirror_sorted_pos(keys, target)
    if pos == 0xFFFF:
        return None
    ent = perm[pos]
    return None if ent >= CAP else ent


def lcg(state):
    while True:
        state = (state * 6364136223846793005 + 1442695040888963407) & ((1 << 64) - 1)
        yield (state >> 33) & 0x7FFFFFFF


e = Emu()
rng = lcg(0x0C0FFEE5)
fails = total = 0

# Linéaire : chaînes ACYCLIQUES (un vrai conteneur n'a pas de cycle ; sinon le do-while boucle).
# On câble une liste chaînée valide : permutation des nœuds, chacun pointe le suivant, dernier=cap.
for _ in range(180):
    n = next(rng) % 14 + 1
    entries = [next(rng) % 20 for _ in range(n)]
    order = list(range(n))
    for i in range(n - 1, 0, -1):  # Fisher-Yates → ordre de chaînage
        j = next(rng) % (i + 1)
        order[i], order[j] = order[j], order[i]
    nexts = [0xFFFF] * n
    for i in range(n - 1):
        nexts[order[i]] = order[i + 1]  # order[-1] garde 0xFFFF (sentinelle)
    head = order[0] if (next(rng) & 7) else CAP + 1  # 1/8 : tête hors capacité → map vide
    for key in set(entries) | {next(rng) % 22, 999}:
        total += 1
        er = emu_linear(e, entries, nexts, head, key)
        mr = mirror_linear(entries, nexts, head, key)
        if er != mr:
            fails += 1
            if fails <= 8:
                print(f"  ✗ LIN head={head} key={key} entries={entries} next={nexts}: uemu={er} ≠ {mr}")

# Trié : arbres triés aléatoires avec doublons, cibles présentes/absentes/bords.
for _ in range(400):
    n = next(rng) % 16 + 1
    keys = sorted((next(rng) % 12) for _ in range(n))
    perm = list(range(n))
    for i in range(n - 1, 0, -1):
        j = next(rng) % (i + 1)
        perm[i], perm[j] = perm[j], perm[i]
    for tg in set(keys) | {keys[0] - 1, keys[-1] + 1, 0, 0xFFFFFFFF, next(rng) % 14}:
        total += 1
        er = emu_sorted(e, keys, perm, tg)
        mr = mirror_sorted_entry(keys, perm, tg)
        if er != mr:
            fails += 1
            if fails <= 8:
                print(f"  ✗ SORT keys={keys} perm={perm} tg={tg & 0xFFFFFFFF:#x}: uemu={er} ≠ {mr}")

print(f"intrusive_map (stride 0x18, FUN_1401f5ab0): {total} cas ; {'BYTE-EXACT' if not fails else f'{fails} DIVERGENCES'}")
sys.exit(1 if fails else 0)
