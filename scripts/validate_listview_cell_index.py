#!/usr/bin/env python3
"""Validation byte-exact : l'index d'une CELLULE boucle, la vue non.

Cible : `0x140543760` (creneau 60 de `lives::CMenuListView`, 587 o sur 5 fragments). C'est la
boucle qui re-indexe les cellules visibles apres un defilement. Ce qu'elle ecrit dans
`[cell+0x154]` est MODULAIRE sur `[cell+0x150]` — la ou `step_row`/`step_page` ECRETENT sans
boucler au niveau de la vue.

Harnais : `stub_calls=True` fait rendre a chaque `call` un pointeur frais, alloue par bonds de
0x1000 depuis `STUB_HEAP`. Les champs de la cellule sont donc SEMES a l'adresse que le n-ieme
appel rendra — `mem=` ecrit avant `emu_start`, et la zone est deja mappee, donc aucune
modification d'`uemu.py` n'est necessaire. Le rang de l'appel est verifie, pas suppose : si le
compte est faux, l'ecriture n'atterrit pas et le cas echoue au lieu de passer.

Usage : NIE_EXE=dist/nie.exe python3 scripts/validate_listview_cell_index.py
"""
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import uemu  # noqa: E402
from uemu import Emu, SCRATCH  # noqa: E402

FN = 0x140543760
THIS = SCRATCH + 0x2000
VTABLE = SCRATCH + 0x4000
CELL_CALL_RANK = 5          # verifie plus bas : la cellule vient du 5e `call` stubbe
CELL = uemu.STUB_HEAP + 0x1000 * CELL_CALL_RANK


def this_object(cells, stride, top, focus):
    o = bytearray(0x200)
    struct.pack_into("<Q", o, 0x000, VTABLE)
    struct.pack_into("<i", o, 0x0C8, stride)
    struct.pack_into("<i", o, 0x0E8, cells)      # diviseur ET borne de boucle : jamais 0
    struct.pack_into("<i", o, 0x12C, top)        # la ligne de tete, celle que `step_row` deplace
    struct.pack_into("<i", o, 0x198, focus)      # `-1` bascule sur la valeur des parametres
    o[0x1C2] = 1                                  # coupe le second garde
    return bytes(o)


def cell_object(count, index_before=0x7777):
    o = bytearray(0x200)
    struct.pack_into("<i", o, 0x148, 1)           # non nul : sans quoi le champ n'est pas touche
    struct.pack_into("<h", o, 0x150, count)
    struct.pack_into("<h", o, 0x154, index_before)
    return bytes(o)


def i16(v):
    v &= 0xFFFF
    return v - 0x10000 if v & 0x8000 else v


def emu(e, cells, stride, top, focus, count, row, column):
    out = e.call(
        FN, rcx=THIS, rdx=row, r8=column, r9=0,
        mem={
            THIS: this_object(cells, stride, top, focus),
            VTABLE: bytes(0x400),
            CELL: cell_object(count),
        },
        read={CELL: 0x200},
        stub_calls=True,
    )
    cell = out["mem"][CELL]
    return i16(struct.unpack_from("<h", cell, 0x154)[0]), i16(struct.unpack_from("<h", cell, 0x156)[0]), cell[0x161]


def mirror(raw, count):
    """`[cell+0x154]` = raw ramene modulo `count`, aux bornes seulement."""
    if raw >= count:
        return 0
    if raw < 0:
        return count - 1
    return raw


# L'index BRUT n'est pas celui des parametres : la fonction le tire de son propre etat,
# `si = (top + [this+0x198]) % cells`, division NON SIGNEE. Quand `[+0x198]` vaut -1 elle
# retombe sur `(row * stride + column) % cells`, calcule dans le prologue. Les deux chemins
# sont couverts. Le `count` de la cellule fait ensuite le modulo qui nous interesse.
# (cells, stride, top, focus, count, row, column)
CASES = [
    (4, 10, 0, 0, 8, 0, 0),      # brut 0
    (4, 10, 1, 2, 8, 0, 0),      # brut 3, count 8 -> 3
    (4, 10, 1, 2, 2, 0, 0),      # brut 3 >= count 2 -> 0   (LE BOUCLAGE)
    (8, 10, 3, 4, 8, 0, 0),      # brut 7, count 8 -> 7
    (8, 10, 3, 4, 4, 0, 0),      # brut 7 >= count 4 -> 0
    (8, 10, 0, 5, 6, 0, 0),      # brut 5 < count 6 -> 5
    (4, 10, 0, -1, 8, 0, 3),     # repli parametres : (0*10+3)%4 = 3
    (4, 10, 0, -1, 2, 0, 3),     # repli + bouclage : 3 >= 2 -> 0
    (8, 10, 0, -1, 8, 1, 2),     # repli : (1*10+2)%8 = 4
    (4, 10, 6, 3, 8, 0, 0),      # l'anneau se referme : (6+3)%4 = 1, count 8 -> 1
    (4, 10, 7, 1, 8, 0, 0),      # (7+1)%4 = 0
]

e = Emu()
ok = bad = 0
for cells, stride, top, focus, count, row, column in CASES:
    raw = ((row * stride + column) % cells) if focus == -1 else ((top + focus) % cells)
    want = mirror(raw, count)
    try:
        got, got_raw, changed = emu(e, cells, stride, top, focus, count, row, column)
    except Exception as exc:  # noqa: BLE001
        print(f"✗ cells={cells} count={count} focus={focus} : {type(exc).__name__} {exc}")
        bad += 1
        continue
    if got_raw != raw:
        print(f"✗ cells={cells} count={count} focus={focus} : brut jeu={got_raw} calcule={raw}")
        bad += 1
        continue
    if got == want:
        ok += 1
    else:
        bad += 1
        print(f"✗ cells={cells} count={count} raw={raw} : jeu={got} miroir={want}")
print(f"{ok} ✓ / {bad} ✗  sur {len(CASES)} cas")
sys.exit(1 if bad else 0)
