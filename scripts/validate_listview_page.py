#!/usr/bin/env python3
"""Validation byte-exact : le pas PAR PAGE de `lives::CMenuListView`.

Cible : `0x140542840` dans `dist/nie.exe` (creneau 58 de la vtable). Frere du creneau 59, meme
prologue de gardes, mais il deplace l'ANCRE de la marge `[+0xC4]` au lieu de la tete de 1.

Deux fragments `.pdata` contigus : `..0x1405428D3` puis `..0x140542B6C` (812 octets au total).

L'arret depend du chemin PREDIT par le miroir : `0x140542A23` quand il annonce un mouvement
(juste avant les deux notifications virtuelles), `0x140542A51` quand il annonce une butee. Une
prediction fausse ne peut pas passer pour un succes : l'emulation n'atteint alors jamais son
point d'arret et remonte une erreur.

Le chemin de DELEGATION (`[+0xC8] > 1` et `r9b == 0` -> `jmp [vt+1C8h]`) est evite en posant
`[+0xC8] = 1` : il sort de la fonction vers une vtable, pas vers un calcul.

Usage : NIE_EXE=dist/nie.exe python3 scripts/validate_listview_page.py
"""
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from uemu import Emu, SCRATCH  # noqa: E402

FN = 0x140542840
STOP_MOVED = 0x140542A23
STOP_STILL = 0x140542A51
THIS = SCRATCH + 0x1000
SIZE = 0x200

GUARDS = {0x1B6: 0, 0x1AF: 0, 0x1AC: 1, 0x1BB: 0, 0x1AE: 1, 0x1C3: 0}


def build(total, columns, top, anchor, selected, visible, margin, flag1b3=0):
    o = bytearray(SIZE)
    struct.pack_into("<i", o, 0x0C0, visible)
    struct.pack_into("<i", o, 0x0C4, margin)
    struct.pack_into("<i", o, 0x0C8, 1)       # coupe la delegation
    struct.pack_into("<i", o, 0x0D4, columns)
    struct.pack_into("<i", o, 0x0E8, 1)       # diviseur du chemin de butee
    struct.pack_into("<i", o, 0x128, 0)
    struct.pack_into("<i", o, 0x12C, top)
    struct.pack_into("<i", o, 0x134, anchor)
    struct.pack_into("<i", o, 0x138, selected)
    struct.pack_into("<i", o, 0x140, total)
    struct.pack_into("<i", o, 0x19C, 0)
    for off, val in GUARDS.items():
        o[off] = val
    o[0x1B3] = flag1b3
    return bytes(o)


def i32(v):
    v &= 0xFFFFFFFF
    return v - 0x1_0000_0000 if v & 0x8000_0000 else v


def mirror(case, forward):
    """Miroir du desassemblage de `0x140542840`."""
    total, columns = case["total"], case["columns"]
    top, anchor, selected = case["top"], case["anchor"], case["selected"]
    visible, margin, flag = case["visible"], case["margin"], case.get("flag1b3", 0)

    if columns == 0:
        return (top, anchor, selected), False
    quotient = int(total / columns)
    remainder = total - quotient * columns
    rows = quotient if selected >= remainder else quotient + 1   # cmovge

    if forward:
        last = rows - 1
        if last <= anchor:
            return (top, anchor, selected), False
        new_anchor = anchor + margin
        if new_anchor > last:
            new_anchor = last
        if margin >= rows:
            return (top, new_anchor, selected), True             # seule l'ancre bouge
        if flag == 0:
            new_top = new_anchor - visible - margin + 1
            return (new_top, new_anchor, selected), True
        delta = anchor - top
        new_top = new_anchor - margin if delta >= margin else new_anchor - visible
        if new_top + margin >= last:
            new_top = rows - margin - 1
        return (new_top, new_anchor, selected), True

    if anchor <= 0:
        return (top, anchor, selected), False
    new_anchor = max(anchor - margin, 0)
    if margin >= rows:
        return (top, new_anchor, selected), True
    new_top = new_anchor - visible
    if flag != 0:
        candidate = max(top - margin, -visible)                  # cmovge sur -visible
        if candidate < new_top:
            new_top = candidate
            new_anchor = candidate + visible
    return (new_top, new_anchor, selected), True


def emu(e, case, forward, moved):
    obj = build(**case)
    out = e.call(
        FN, rcx=THIS, rdx=1 if forward else 0, r8=0, r9=1,
        mem={THIS: obj}, read={THIS: SIZE}, stop=STOP_MOVED if moved else STOP_STILL,
    )
    got = out["mem"][THIS]
    return tuple(i32(struct.unpack_from("<i", got, off)[0]) for off in (0x12C, 0x134, 0x138))


CASES = [
    dict(total=40, columns=4, top=0, anchor=0, selected=0, visible=3, margin=3),
    dict(total=40, columns=4, top=0, anchor=3, selected=0, visible=3, margin=3),
    dict(total=40, columns=4, top=2, anchor=5, selected=12, visible=3, margin=3),
    dict(total=40, columns=4, top=0, anchor=9, selected=0, visible=3, margin=3),
    dict(total=100, columns=5, top=4, anchor=8, selected=55, visible=4, margin=4),
    dict(total=100, columns=5, top=4, anchor=8, selected=55, visible=4, margin=4, flag1b3=1),
    dict(total=41, columns=4, top=1, anchor=4, selected=1, visible=2, margin=2),
    dict(total=7, columns=3, top=0, anchor=0, selected=6, visible=1, margin=1),
    dict(total=0, columns=4, top=0, anchor=0, selected=0, visible=2, margin=2),
]

e = Emu()
ok = bad = 0
for case in CASES:
    for forward in (True, False):
        want, moved = mirror(case, forward)
        try:
            got = emu(e, case, forward, moved)
        except Exception as exc:  # noqa: BLE001
            print(f"✗ {case} avant={forward} : {type(exc).__name__} {exc}")
            bad += 1
            continue
        if got == want:
            ok += 1
        else:
            bad += 1
            print(f"✗ {case} avant={forward} bouge={moved}\n    jeu    {got}\n    miroir {want}")
print(f"{ok} ✓ / {bad} ✗  sur {len(CASES) * 2} cas")
sys.exit(1 if bad else 0)
