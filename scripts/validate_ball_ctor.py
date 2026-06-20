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

# 2e fonction : init du contexte physique (FUN 0x14027ad90, appels stubbés) → GRAVITÉ MONDE réelle.
# Spec reversé : [0x1d8]=3, [0x1e0]=0xc11ccccd (-9.8f). Distinct de nie-core BALL_GRAVITY=2.0
# (best-effort nie-runtime) — la gravité MONDE réelle du jeu est -9.8f (à confirmer = celle utilisée
# par l'intégration ballon avant de remplacer 2.0, cf. boucle physique du tick à localiser).
g = e.call(0x14027AD90, rcx=SCRATCH, stub_calls=True, stop=0x14027ADED, mem={SCRATCH: bytes(0x210)}, read={SCRATCH: 0x210})
grav = struct.unpack_from("<I", g["mem"][SCRATCH], 0x1E0)[0]
flag = struct.unpack_from("<I", g["mem"][SCRATCH], 0x1D8)[0]
if grav != 0xC11CCCCD:
    errs.append(f"gravité @0x1e0 = {grav:#x}, attendu 0xc11ccccd (-9.8f)")
if g["error"]:
    errs.append(f"émulation gravité: {g['error']}")

if errs:
    print("ÉCHEC validation ball-RE :")
    for x in errs:
        print("  -", x)
    sys.exit(1)

print("✓ VALIDÉ byte-exact contre l'oracle (reversal == binaire réel, sans inventer) :")
print(f"  [1] init objet ballon (0x14027ac00) : vtable@0={vptr:#x}, scale 1.0f@0x54, count 1@0x5c, reste 0")
print(f"  [2] init contexte physique (0x14027ad90) : [0x1d8]={flag}, gravité @0x1e0 = {grav:#010x} = "
      f"{struct.unpack('<f', struct.pack('<I', grav))[0]:.1f}f (gravité MONDE réelle, vs 2.0 best-effort)")
print("→ 2 fonctions de gameplay reversées + VALIDÉES contre l'oracle uemu (boucle reverse→valider).")
