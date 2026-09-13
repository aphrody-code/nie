#!/usr/bin/env python3
"""Validation byte-exact : le pas de defilement d'une ligne de `lives::CMenuListView`.

Cible : `0x140542B80` dans `dist/nie.exe` (creneau 59 de la vtable, COL `0x141A5FFB8`). Deux
fragments `.pdata` contigus, `..0x140542BD7` puis `..0x140542DBD` — le second est une
continuation sans prologue, donc la fonction fait 573 octets et non 87.

Ce que ce script prouve : le miroir Python ci-dessous rend EXACTEMENT ce que la fonction du jeu
ecrit dans `[this+0x12C]` (ligne de tete), `[this+0x134]` (ancre) et `[this+0x138]` (index
selectionne), sur une grille de cas. Il ne prouve PAS quelle entree clavier appelle ce creneau.

L'emulation s'arrete a `0x140542CD5`, juste avant les deux appels virtuels (`[vt+1E0h]`,
`[vt+230h]`) : ils notifient, ils ne calculent pas, et les emuler demanderait une vtable entiere.
Toutes les ecritures mesurees ont deja eu lieu a ce point.

Usage : NIE_EXE=dist/nie.exe python3 scripts/validate_listview_scroll.py
"""
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from uemu import Emu, SCRATCH  # noqa: E402

FN = 0x140542B80
STOP = 0x140542CD5
THIS = SCRATCH + 0x1000
SIZE = 0x200

# Les gardes lues dans le prologue. Une seule mal posee et la fonction sort sans rien ecrire,
# ce qui se lit comme « le pas ne fait rien » au lieu de « le cas de test est mal monte ».
GUARDS = {0x1B6: 0, 0x1AF: 0, 0x1AC: 1, 0x1BB: 0, 0x1AE: 1}


def build(total, columns, top, anchor, selected, c0, c4, flag1c7=0):
    o = bytearray(SIZE)
    struct.pack_into("<i", o, 0x0C0, c0)
    struct.pack_into("<i", o, 0x0C4, c4)
    struct.pack_into("<i", o, 0x0D4, columns)
    struct.pack_into("<i", o, 0x12C, top)
    struct.pack_into("<i", o, 0x134, anchor)
    struct.pack_into("<i", o, 0x138, selected)
    struct.pack_into("<i", o, 0x140, total)
    struct.pack_into("<i", o, 0x19C, 0)
    for off, val in GUARDS.items():
        o[off] = val
    o[0x1C7] = flag1c7
    return bytes(o)


def i32(v):
    v &= 0xFFFFFFFF
    return v - 0x1_0000_0000 if v & 0x8000_0000 else v


def emu(e, case, forward):
    obj = build(**case)
    out = e.call(FN, rcx=THIS, rdx=1 if forward else 0, mem={THIS: obj}, read={THIS: SIZE}, stop=STOP)
    got = out["mem"][THIS]
    return tuple(i32(struct.unpack_from("<i", got, off)[0]) for off in (0x12C, 0x134, 0x138))


def mirror(case, forward):
    """Miroir du desassemblage, ecrit depuis les instructions et rien d'autre."""
    total, columns = case["total"], case["columns"]
    top, anchor, selected = case["top"], case["anchor"], case["selected"]
    c0, c4, flag = case["c0"], case["c4"], case.get("flag1c7", 0)

    # `cdq ; idiv` : division SIGNEE, tronquee vers zero — pas le `//` de Python.
    rows = int(total / columns) if columns else 0
    rem = total - rows * columns
    partial = False
    if selected < rem:
        rows += 1
    elif flag != 0 and rem > 0:
        partial = True
        rows += 1

    delta = anchor - top
    if forward:
        if c4 + c0 + top >= rows:
            return (top, anchor, selected)        # butee : rien n'est ecrit
        probe = c4 + c0 + top + 1
        new_top = top + 1
        if probe > rows:
            new_top = rows - c0 - c4
        new_anchor = new_top + delta
        if partial and selected >= rem and rows - 1 == new_anchor:
            selected = rem - 1
        return (new_top, new_anchor, selected)

    floor = -c0
    if top <= floor:
        return (top, anchor, selected)            # butee haute : rien n'est ecrit
    new_top = top - 1
    if new_top < floor:
        new_top = floor
    return (new_top, new_top + delta, selected)


CASES = [
    dict(total=40, columns=4, top=0, anchor=0, selected=0, c0=3, c4=0),
    dict(total=40, columns=4, top=3, anchor=5, selected=12, c0=3, c4=0),
    dict(total=40, columns=4, top=7, anchor=7, selected=28, c0=3, c4=0),
    dict(total=40, columns=4, top=-3, anchor=-1, selected=0, c0=3, c4=0),
    dict(total=41, columns=4, top=2, anchor=4, selected=1, c0=2, c4=1),
    dict(total=41, columns=4, top=2, anchor=4, selected=3, c0=2, c4=1, flag1c7=1),
    dict(total=7, columns=3, top=0, anchor=0, selected=6, c0=1, c4=0),
    dict(total=1, columns=1, top=0, anchor=0, selected=0, c0=1, c4=0),
    dict(total=0, columns=4, top=0, anchor=0, selected=0, c0=2, c4=0),
    dict(total=100, columns=5, top=10, anchor=12, selected=55, c0=4, c4=2),
    # La butee exacte vers le bas : `margin + visible + top >= rows` n'est pas devinable,
    # elle se demande. rows=20, c0=4, c4=2 -> le dernier pas possible part de top=13.
    dict(total=100, columns=5, top=13, anchor=15, selected=55, c0=4, c4=2),
    dict(total=100, columns=5, top=14, anchor=16, selected=55, c0=4, c4=2),
    dict(total=100, columns=5, top=15, anchor=17, selected=55, c0=4, c4=2),
]

e = Emu()
ok = bad = 0
for case in CASES:
    for forward in (True, False):
        want = mirror(case, forward)
        try:
            got = emu(e, case, forward)
        except Exception as exc:  # noqa: BLE001
            print(f"✗ {case} avant={forward} : {type(exc).__name__} {exc}")
            bad += 1
            continue
        if got == want:
            ok += 1
        else:
            bad += 1
            print(f"✗ {case} avant={forward}\n    jeu    {got}\n    miroir {want}")
print(f"{ok} ✓ / {bad} ✗  sur {len(CASES) * 2} cas")
sys.exit(1 if bad else 0)
