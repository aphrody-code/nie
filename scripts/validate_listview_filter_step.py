#!/usr/bin/env python3
"""Validation byte-exact : le pas d'une vue-liste DERIVEE boucle, la base non.

Cible : `0x14102B170` — creneau 58 de `game::CMenuListViewCharaFilter`, qui REDEFINIT le pas par
page de `lives::CMenuListView`. Ce n'est pas une variante du calcul de base : c'est un autre
modele. La base deplace la ligne de tete `[+0x12C]` et ECRETE ; celle-ci deplace l'index
SELECTIONNE `[+0x138]` de ±1 et BOUCLE.

    lea ecx,[rsi*2-1]      ; direction : dl=0 -> -1, dl=1 -> +1
    add ecx,[rbx+138h]     ; applique a la selection
    jns  -> borne haute    ; negatif -> [rbx+0xC8] - 1  (dernier)
    cmp ecx,edi ; cmovge ecx,0   ; >= compte -> 0       (premier)

L'emulation s'arrete a `0x14102B1B9`, juste avant l'acces a la table `[rbx+0x198B0]` : l'index
est deja calcule dans `ecx` a ce point, et la table demanderait un objet entier.

256 octets contre 820 pour le creneau 58 de base : la redefinition est plus SIMPLE, pas plus
riche — elle ne gere pas de fenetre, seulement un curseur circulaire.

Usage : NIE_EXE=dist/nie.exe python3 scripts/validate_listview_filter_step.py
"""
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from uemu import Emu, SCRATCH  # noqa: E402

# (fonction, arret, compte) — l'arret est juste apres le `cmovge`, quand l'index est calcule.
# `CharaFilter` lit son compte dans `[this+0xC8]` ; les deux autres le CODENT EN DUR a 2, ce que
# le compte ci-dessous reproduit cote miroir. 207 octets a 13 pres pour les jumelles, et c'est
# precisement dans ces 13 octets que tient la difference qui compte.
CIBLES = [
    ("CharaFilter",        0x14102B170, 0x14102B1B9, None),
    ("ItemFilter",         0x14109ADD0, 0x14109AE12, 2),
    ("SoccerSpiritFilter", 0x14119B5F0, 0x14119B632, 2),
]
FN = 0x14102B170
STOP = 0x14102B1B9
THIS = SCRATCH + 0x3000
SIZE = 0x400


def build(count, selected, anchor=0):
    o = bytearray(SIZE)
    struct.pack_into("<i", o, 0x0C8, count)     # le nombre d'entrees du filtre
    struct.pack_into("<i", o, 0x134, anchor)
    struct.pack_into("<i", o, 0x138, selected)
    return bytes(o)


def i32(v):
    v &= 0xFFFFFFFF
    return v - 0x1_0000_0000 if v & 0x8000_0000 else v


def mirror(count, selected, forward):
    """Le miroir, ecrit depuis les instructions."""
    nxt = selected + (1 if forward else -1)
    if nxt < 0:
        return count - 1
    if nxt >= count:
        return 0
    return nxt


CASES = [
    (5, 0), (5, 1), (5, 4),
    (1, 0),
    (8, 7), (8, 0), (8, 3),
    (2, 1),
]

e = Emu()
ok = bad = total = 0
for nom, fn, stop, fixe in CIBLES:
    # Le registre qui porte l'index differe : `ecx` chez CharaFilter, `r11d` chez les jumelles.
    registre = "rcx" if fixe is None else "r11"
    cas = CASES if fixe is None else [(fixe, s) for s in range(fixe)]
    for count, selected in cas:
        for forward in (True, False):
            total += 1
            want = mirror(count, selected, forward)
            out = e.call(fn, rcx=THIS, rdx=1 if forward else 0, r8=0, r9=0,
                         mem={THIS: build(count, selected)}, stop=stop)
            got = i32(out["reg"][registre])
            if got == want:
                ok += 1
            else:
                bad += 1
                print(f"✗ {nom} count={count} selected={selected} avant={forward} :"
                      f" jeu={got} miroir={want}")
print(f"{ok} ✓ / {bad} ✗  sur {total} cas ({len(CIBLES)} classes)")
sys.exit(1 if bad else 0)
