#!/usr/bin/env python3
"""Validation byte-exact : « find first active entry » via table de handles (`FUN_1411da770`, 27c).

Logique moteur (lookup d'entité par handle validé). Lit le singleton manager `DAT_141fa8e70` :
  - count   = `*(u32)(mgr + 0x110)` ;
  - records = `*(ptr)(mgr + 0x80)`  (enregistrements de **0x1480** o : génération `u16 @ +0x1462`,
    drapeau actif `u8 @ +0x48`) ;
  - handles = `*(ptr)(mgr + 0x118)` (tableau de handles `u32` = `(génération << 16) | (index+1)`).
Pour `i` dans `[0, count)` : `h = handles[i]` ; si `h==0` → renvoie 0 ; `rec = records[(h&0xffff)-1]` ;
si `rec.gen != (h>>16)` → renvoie 0 ; si `rec.actif==1` → renvoie `rec` (pointeur) ; sinon continue.
→ renvoie le **1er record actif**, mais BAILE (0) au 1er handle nul/génération-incohérente.

On fournit le manager + arrays en mémoire uemu (global non dégénéré, paramétré) et on compare l'index
de record renvoyé. Fuzz seedé (handles valides/nuls/gén-incohérents, actifs variés). Sort 0 si
byte-exact. Miroir = port `nie_core::handle_table`.
"""
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from uemu import Emu, SCRATCH  # noqa: E402

MGR = SCRATCH + 0x100
RECS = SCRATCH + 0x10000  # loin (records 0x1480 chacun)
HANDLES = SCRATCH + 0x2000
DAT = 0x141FA8E70
REC_STRIDE = 0x1480


def build(records, handles):
    """records: liste de (gen, actif) ; handles: liste de u32."""
    mgr = bytearray(0x140)
    struct.pack_into("<I", mgr, 0x110, len(handles))
    struct.pack_into("<Q", mgr, 0x80, RECS)
    struct.pack_into("<Q", mgr, 0x118, HANDLES)
    recbuf = bytearray(REC_STRIDE * (len(records) + 1))
    for i, (gen, act) in enumerate(records):
        struct.pack_into("<H", recbuf, i * REC_STRIDE + 0x1462, gen & 0xFFFF)
        recbuf[i * REC_STRIDE + 0x48] = act & 0xFF
    hbuf = b"".join(struct.pack("<I", h & 0xFFFFFFFF) for h in handles)
    datptr = struct.pack("<Q", MGR)
    return bytes(mgr), bytes(recbuf), hbuf, datptr


def emu_find(e, records, handles):
    mgr, recbuf, hbuf, datptr = build(records, handles)
    out = e.call(0x1411DA770, mem={MGR: mgr, RECS: recbuf, HANDLES: hbuf, DAT: datptr})
    rax = out["rax"]
    return None if rax == 0 else (rax - RECS) // REC_STRIDE


def mirror_find(records, handles):
    for i in range(len(handles)):
        h = handles[i] & 0xFFFFFFFF
        if h == 0:
            return None
        idx = (h & 0xFFFF) - 1
        gen, act = records[idx]
        if (gen & 0xFFFF) != (h >> 16):
            return None
        if act == 1:
            return idx
    return None


def lcg(state):
    while True:
        state = (state * 6364136223846793005 + 1442695040888963407) & ((1 << 64) - 1)
        yield (state >> 33) & 0x7FFFFFFF


e = Emu()
rng = lcg(0x8AD1E)
fails = total = 0
for _ in range(400):
    nrec = next(rng) % 8 + 1
    # records : gen aléatoire (petit), actif 0/1
    records = [(next(rng) % 4 + 1, next(rng) % 2) for _ in range(nrec)]
    ncount = next(rng) % 6 + 1
    handles = []
    for _ in range(ncount):
        r = next(rng) % 10
        if r == 0:
            handles.append(0)  # handle nul → bail
        else:
            ri = next(rng) % nrec  # index valide
            gen = records[ri][0]
            if r == 1:
                gen = (gen + 1) & 0xFFFF  # génération incohérente → bail
            handles.append((gen << 16) | (ri + 1))
    total += 1
    er = emu_find(e, records, handles)
    mr = mirror_find(records, handles)
    if er != mr:
        fails += 1
        if fails <= 8:
            print(f"  ✗ records={records} handles={[hex(h) for h in handles]}: uemu={er} ≠ miroir={mr}")
print(f"handle table find-active (FUN_1411da770): {total} cas ; {'BYTE-EXACT' if not fails else f'{fails} DIVERGENCES'}")
sys.exit(1 if fails else 0)
