#!/usr/bin/env python3
"""Validation byte-exact : la position d'une cellule = base + translation[index].

Cible : la sequence `0x140544DF6`..`0x140544E4E` du creneau 73 de `lives::CMenuListView`
(`0x140544BD0`, 1324 o sur 7 fragments) — la passe de placement que le creneau 9 appelle par
`[vt+0x248]` quand l'ecran est STABILISE.

Ce qui est prouve : l'index de cellule selectionne dans une table de pas 48 octets, dont x, y et
z sont lus a +0x0C, +0x1C et +0x2C (la colonne de translation d'une affine 4x3, trois rangees de
16), puis additionnes a une position de base.

Emulation en TRANCHE : on demarre a `0x140544DF6`, pas au prologue, donc l'etat que le prologue
avait etabli est reconstitue par `reg_in` (`rbx`, `r13`) et par une ecriture directe dans la pile
pour `[rsp+50h]`. Le point d'arret est `0x140544E4E`, juste apres le `addps` : la somme est alors
dans `xmm2`, avant que le widget ne la recoive.

Usage : NIE_EXE=dist/nie.exe python3 scripts/validate_listview_cell_position.py
"""
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from uemu import Emu, SCRATCH  # noqa: E402

DEBUT = 0x140544DF6
ARRET = 0x140544E4E
PORTEUR = SCRATCH + 0x5000      # l'objet dont `[+0x198]` pointe la table
TABLE = SCRATCH + 0x6000        # les matrices affines, 48 octets chacune
INDICES = SCRATCH + 0x7000      # la table d'indices de cellules
BASE = SCRATCH + 0x8000         # la position de base lue par `movups xmm2,[r13]`
OBJ = SCRATCH + 0x9000          # l'objet teste par `cmp byte [rbx+1D8h],0`


def affine(x, y, z):
    """Une 4x3 : trois rangees de 16 octets, translation en +0x0C/+0x1C/+0x2C."""
    m = bytearray(48)
    struct.pack_into("<f", m, 0x0C, x)
    struct.pack_into("<f", m, 0x1C, y)
    struct.pack_into("<f", m, 0x2C, z)
    return bytes(m)


def emu(e, cellules, index, base):
    table = b"".join(affine(*c) for c in cellules)
    indices = struct.pack(f"<{len(cellules)}i", *range(len(cellules)))
    porteur = bytearray(0x200)
    struct.pack_into("<Q", porteur, 0x198, TABLE)
    obj = bytearray(0x200)                      # `[rbx+1D8h] == 0` : le chemin qui additionne
    out = e.call(
        DEBUT,
        rax=index,                              # `movsxd rdx,eax` : le rang dans la table d'indices
        rcx=INDICES,
        reg_in={"rbx": OBJ, "r13": BASE, "rdi": OBJ},
        mem={
            INDICES: indices,
            TABLE: table,
            PORTEUR: bytes(porteur),
            OBJ: bytes(obj),
            BASE: struct.pack("<4f", *base, 0.0),
        },
        stop=ARRET,
        read_xmm=[2],
    )
    if out["error"]:
        raise RuntimeError(out["error"])
    return out["xmm"][2][:3]


CAS = [
    ([(0.0, 0.0, 0.0)], 0, (0.0, 0.0, 0.0)),
    ([(10.0, 20.0, 30.0)], 0, (0.0, 0.0, 0.0)),
    ([(10.0, 20.0, 30.0)], 0, (1.0, 2.0, 3.0)),
    ([(1.5, -2.5, 0.25), (100.0, 200.0, 300.0)], 1, (0.5, 0.5, 0.5)),
    ([(0.0, 72.0, 0.0), (0.0, 144.0, 0.0), (0.0, 216.0, 0.0)], 2, (640.0, 100.0, 0.0)),
]

e = Emu()
ok = bad = 0
for cellules, index, base in CAS:
    attendu = tuple(b + t for b, t in zip(base, cellules[index]))
    # La pile : `[rsp+50h]` porte le porteur de la table.
    sonde = e.call(DEBUT, stop=DEBUT)
    rsp = sonde["rsp_in"]
    porteur = bytearray(0x200)
    struct.pack_into("<Q", porteur, 0x198, TABLE)
    table = b"".join(affine(*c) for c in cellules)
    out = e.call(
        DEBUT, rax=index, rcx=INDICES,
        reg_in={"rbx": OBJ, "r13": BASE, "rdi": OBJ},
        mem={
            INDICES: struct.pack(f"<{len(cellules)}i", *range(len(cellules))),
            TABLE: table,
            PORTEUR: bytes(porteur),
            OBJ: bytes(bytearray(0x200)),
            BASE: struct.pack("<4f", *base, 0.0),
            rsp + 0x50: struct.pack("<Q", PORTEUR),
        },
        stop=ARRET, read_xmm=[2],
    )
    if out["error"]:
        print(f"✗ index={index} : {out['error']}")
        bad += 1
        continue
    got = tuple(round(v, 4) for v in out["xmm"][2][:3])
    want = tuple(round(v, 4) for v in attendu)
    if got == want:
        ok += 1
    else:
        bad += 1
        print(f"✗ index={index} base={base} : jeu={got} miroir={want}")
print(f"{ok} ✓ / {bad} ✗  sur {len(CAS)} cas")
sys.exit(1 if bad else 0)
