#!/usr/bin/env python3
"""Validation byte-exact : lookup d'enregistrement par clé 40 bits (`FUN_1404af530`, 69 callers).

Table d'enregistrements de **0xb0 octets** (`param_1+0x68`=ptr, `param_1+0x70`=count u32,
`param_1+0x81`=flag trié). Clé **40 bits** = `(u32 @ rec+0xa0) << 8 | (u8 @ rec+0xa4)`. La requête
est `(param_2:u32, param_3:u8)` → même clé 40 bits. Deux modes :
  - flag==0 : **scan linéaire** (renvoie le 1er rec dont la clé == requête, sinon 0) ;
  - flag!=0 : **recherche binaire** (records triés par clé 40 bits croissante).
Le binaire décale les clés de `<<24` et compare en u64 non signé (bijection sur 40 bits ⇒ équivalent
à comparer la clé 40 bits ; le fuzz le prouve). Renvoie le **pointeur** du rec → on décode en index.

Fuzz seedé des deux modes (clés présentes/absentes/bords/doublons). Sort 0 si byte-exact.
Miroir = port `nie_core::keyed_record_table`.
"""
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from uemu import Emu, SCRATCH  # noqa: E402

HDR = SCRATCH + 0x100
RECS = SCRATCH + 0x1000
STRIDE = 0xB0


def build(keys, sorted_flag):
    hdr = bytearray(0x90)
    struct.pack_into("<Q", hdr, 0x68, RECS)
    struct.pack_into("<I", hdr, 0x70, len(keys))
    hdr[0x81] = 1 if sorted_flag else 0
    data = bytearray(STRIDE * (len(keys) + 1))
    for i, k in enumerate(keys):
        hi = (k >> 8) & 0xFFFFFFFF  # u32 @ +0xa0
        lo = k & 0xFF               # u8  @ +0xa4
        struct.pack_into("<I", data, i * STRIDE + 0xA0, hi)
        data[i * STRIDE + 0xA4] = lo
    return bytes(hdr), bytes(data)


def emu_lookup(e, keys, sorted_flag, query):
    hdr, data = build(keys, sorted_flag)
    p2 = (query >> 8) & 0xFFFFFFFF
    p3 = query & 0xFF
    out = e.call(0x1404AF530, rcx=HDR, rdx=p2, r8=p3, mem={HDR: hdr, RECS: data})
    rax = out["rax"]
    return None if rax == 0 else (rax - RECS) // STRIDE


def mirror_lookup(keys, sorted_flag, query):
    """Miroir du port Rust (clé 40 bits ; <<24 omis car bijection ordre-préservante)."""
    if (query >> 8) & 0xFFFFFFFF == 0:  # param_2 == 0 → le binaire renvoie 0 d'emblée
        return None
    n = len(keys)
    if n == 0:
        return None
    if not sorted_flag:
        for i in range(n):
            if keys[i] == query:
                return i
        return None
    # recherche binaire (records triés croissants par clé 40 bits)
    hi = n - 1
    lo = 0
    while lo <= hi:
        span = hi - lo
        adj = span + 1
        if adj < 0:
            adj = span + 2
        mid = (adj >> 1) + lo
        rk = keys[mid]
        if query == rk:
            return mid
        nxt_hi = mid - 1
        if rk <= query:
            lo = mid + 1
            nxt_hi = hi
        hi = nxt_hi
    return None


def lcg(state):
    while True:
        state = (state * 6364136223846793005 + 1442695040888963407) & ((1 << 64) - 1)
        yield (state >> 33) & 0x7FFFFFFF


e = Emu()
rng = lcg(0x4E40A5)
fails = total = 0
for _ in range(500):
    n = next(rng) % 16 + 1
    # clés 40 bits à partie HAUTE non nulle (key >= 256), domaine restreint → doublons.
    base_keys = [((next(rng) % 40 + 1) << 8) | (next(rng) % 6) for _ in range(n)]
    for sorted_flag in (False, True):
        keys = sorted(base_keys) if sorted_flag else list(base_keys)
        # cibles : présentes, absentes, bords, + une clé partie-haute nulle (doit donner None)
        targets = set(keys) | {((next(rng) % 44) << 8) | 3, (1 << 40) - 1, 0, 0x42}
        for tg in targets:
            total += 1
            er = emu_lookup(e, keys, sorted_flag, tg)
            mr = mirror_lookup(keys, sorted_flag, tg)
            # En mode linéaire avec doublons, l'index exact compte ; en trié les doublons rendent
            # n'importe quel index valide — on vérifie que la CLÉ trouvée correspond.
            ok = (er == mr)
            if not ok and sorted_flag and er is not None and mr is not None:
                ok = keys[er] == keys[mr] == tg
            if not ok:
                fails += 1
                if fails <= 8:
                    print(f"  ✗ sorted={sorted_flag} keys={keys} tg={tg}: uemu={er} ≠ miroir={mr}")
print(f"keyed record lookup (FUN_1404af530): {total} cas ; {'BYTE-EXACT' if not fails else f'{fails} DIVERGENCES'}")
sys.exit(1 if fails else 0)
