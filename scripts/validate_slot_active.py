#!/usr/bin/env python3
"""Validateur byte-exact pour FUN_1405a0df0 (@0x1405a0df0) — prédicat « élément actif ? ».

FUN_1405a0df0(rcx=conteneur, edx=index) :
    p = FUN_14059f770(rcx, edx)        # accesseur d'élément (16 octets/élément), borné
    a = *(i32*)(p + 8)                 # champ d'état de l'élément
    b = *(i32*)(p + 0)                 # champ secondaire
    return (a != 0 && (a != 1 || b != 0)) ? 1 : 0

L'accesseur FUN_14059f770 est une fonction distincte (infrastructure de conteneur) ; ici on la laisse
s'exécuter dans uemu en montant un conteneur factice tel que le chemin « index positif » renvoie un
pointeur vers une zone scratch dont on contrôle field0/field8. On FUZZ donc le PRÉDICAT (la logique
propre à FUN_1405a0df0) sur tout l'espace (field0, field8), comparé byte-exact à e.call(0x1405a0df0).

Layout du chemin positif de FUN_14059f770 :
    r9 = [rcx+0x20] ; rax = [r9] + index*16 ; if rax < [rcx+0x10] return rax
"""
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from uemu import Emu, SCRATCH

VA = 0x1405A0DF0

# --- agencement du conteneur factice dans la page scratch ---
CONT = SCRATCH + 0x1000   # objet conteneur (rcx)
HOLDER = SCRATCH + 0x2000  # [rcx+0x20] -> HOLDER ; [HOLDER] = BASE
BASE = SCRATCH + 0x3000   # base du tableau d'éléments
BOUND = SCRATCH + 0x80000  # [rcx+0x10] : borne supérieure (doit dépasser p)
INDEX = 1                 # index positif -> p = BASE + INDEX*16
P = BASE + INDEX * 16     # pointeur d'élément renvoyé par l'accesseur


def u32le(v):
    return struct.pack("<I", v & 0xFFFFFFFF)


def model(field0, field8):
    """Miroir Python du prédicat FUN_1405a0df0 (comparaisons i32 ; renvoie 0/1)."""
    a = field8 & 0xFFFFFFFF
    b = field0 & 0xFFFFFFFF
    # a != 0 && (a != 1 || b != 0)
    return 1 if (a != 0 and (a != 1 or b != 0)) else 0


def emu_call(e, field0, field8):
    mem = {
        CONT + 0x10: struct.pack("<Q", BOUND),
        CONT + 0x20: struct.pack("<Q", HOLDER),
        HOLDER: struct.pack("<Q", BASE),
        # élément : [P]=field0 (puis padding), [P+8]=field8 (puis padding)
        P: u32le(field0) + u32le(0) + u32le(field8) + u32le(0),
    }
    out = e.call(VA, rcx=CONT, rdx=INDEX, mem=mem)
    if out.get("error"):
        raise RuntimeError(f"uemu fault: {out['error']}")
    return out["rax"]


def lcg(seed):
    s = seed & 0xFFFFFFFFFFFFFFFF
    while True:
        s = (s * 6364136223846793005 + 1442695040888963407) & 0xFFFFFFFFFFFFFFFF
        yield s


def main():
    e = Emu()

    # bords intéressants pour chaque champ (i32)
    edges = [0, 1, 2, 3, 0x16, -1, -2, 0x7FFFFFFF, 0x80000000, 0xFFFFFFFF, 0x55555555, 100, -100]
    cases = []
    for a in edges:
        for b in edges:
            cases.append((b, a))  # (field0, field8)

    # fuzz aléatoire seedé
    g = lcg(0xDEADBEEF1234)
    for _ in range(500):
        r = next(g)
        field0 = (r & 0xFFFFFFFF)
        field8 = ((r >> 32) & 0xFFFFFFFF)
        # biaiser souvent field8 vers 0/1 pour couvrir les branches fines
        if (r >> 60) & 1:
            field8 = (r >> 32) & 1
        cases.append((field0, field8))

    ndiv = 0
    for i, (field0, field8) in enumerate(cases):
        exp = model(field0, field8)
        got = emu_call(e, field0, field8)
        if got != exp:
            ndiv += 1
            if ndiv <= 20:
                print(f"DIVERGE cas#{i} field0={field0:#x} field8={field8:#x} : model={exp} uemu={got}")
    if ndiv:
        print(f"ÉCHEC : {ndiv}/{len(cases)} divergences")
        sys.exit(1)
    print(f"OK byte-exact : {len(cases)} cas validés (predicat FUN_1405a0df0 via uemu)")
    sys.exit(0)


if __name__ == "__main__":
    main()
