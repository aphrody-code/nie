#!/usr/bin/env python3
"""1ʳᵉ reversal de logique VALIDÉE byte-exact contre l'oracle uemu.

Cible : l'init de l'objet ballon (cluster 0x14027ab50 ; partie init émulée depuis 0x14027ac00,
après l'alloc, rax = ptr struct). REVERSAL depuis l'asm (désassemblage capstone) :
    - zéro les octets 0x00..0x5F ;
    - pose un pointeur de VTABLE à l'offset 0 (deux lea/store ; valeur = adresse image, dépend du
      layout → on valide « pointeur de code dans l'image » plutôt que la valeur absolue) ;
    - [0x54] = 0x3f800000 (= 1.0f, échelle par défaut) ;
    - [0x5c] = 1 (compteur/flag) ;
    - tout le reste = 0.

VALIDATION : on émule la fonction réelle via uemu et on assert que le struct capturé correspond
EXACTEMENT à ce spec reversé. Si OK → la reversal est fidèle, prouvée contre le vrai binaire, sans
inventer. C'est la boucle reverse→valider que l'oracle débloque.
"""
import struct
import sys

from uemu import SCRATCH, Emu

N = 0x140
e = Emu()
# Émule l'init du ctor (depuis 0x14027ac00, après l'alloc, rax=ptr struct) jusqu'à la fin .pdata.
# (Émulation mi-fonction propre, err=None ; le call-stubbing depuis le vrai début donne le MÊME
# struct mais déclenche une lecture tardive via la vtable de l'objet alloué — non bloquant.)
out = e.call(0x14027AC00, rax=SCRATCH, mem={SCRATCH: bytes(N)}, read={SCRATCH: N}, stop=0x14027ACA1)
blob = out["mem"][SCRATCH]

errs = []


def u32(off):
    return struct.unpack_from("<I", blob, off)[0]


def u64(off):
    return struct.unpack_from("<Q", blob, off)[0]


# Spec reversé (offsets 4-octets), tout doit valoir 0 SAUF ceux listés.
EXPECT = {0x54: 0x3F800000, 0x58: 0, 0x5C: 1}
VTABLE_OFF = 0  # pointeur de code (8 octets)

vptr = u64(VTABLE_OFF)
IMG_LO, IMG_HI = 0x140000000, 0x142600000
if not (IMG_LO <= vptr < IMG_HI):
    errs.append(f"vtable@0 = {vptr:#x} hors image [{IMG_LO:#x},{IMG_HI:#x})")

for off in range(0, N, 4):
    if off < 8:
        continue  # couvert par le pointeur vtable (8 octets)
    got = u32(off)
    want = EXPECT.get(off, 0)
    if got != want:
        errs.append(f"+0x{off:03x}: got {got:#010x}, attendu {want:#010x}")

if out["error"]:
    errs.append(f"émulation: {out['error']}")

if errs:
    print("ÉCHEC validation ball-ctor :")
    for x in errs:
        print("  -", x)
    sys.exit(1)

print("✓ VALIDÉ byte-exact : init objet ballon (0x14027ac00) — reversal == binaire réel.")
print(f"  vtable@0 = {vptr:#x} (code, dans l'image)")
print(f"  +0x54 = {u32(0x54):#010x} = {struct.unpack('<f', struct.pack('<I', u32(0x54)))[0]}f (scale)")
print(f"  +0x5c = {u32(0x5C)} (count)  | reste = 0  ✓")
print("→ 1ʳᵉ logique de gameplay REVERSÉE + VALIDÉE contre l'oracle (sans inventer, sans lancer le jeu).")
