#!/usr/bin/env python3
"""Oracle byte-exact pour FUN_140071d70 — ctor lives::CEffectObjComponent.

La fonction prend rcx = ptr struct (208 / 0xd0 octets), zero-fill + valeurs par
défaut + pose la vtable lives::CEffectObjComponent::vftable au +0x00, et incrémente
le compteur global d'instances _DAT_141c3b144 (inc dword, 32 bits). Renvoie rcx.

On compare BYTE-EXACT le buffer 0xd0 muté ET le compteur, avec un buffer d'entrée
fuzzé (LCG) pour PROUVER l'ensemble exact des octets écrits vs préservés
(0x7a,0x7b,0xae,0xaf,0xce,0xcf jamais touchés).
"""
import struct
import sys

import sys as _sys
from pathlib import Path as _Path
_sys.path.insert(0, str(_Path(__file__).resolve().parent))
from uemu import Emu, SCRATCH

VADDR = 0x140071D70
N = 0xD0  # taille struct
COUNTER_VA = 0x141C3B144  # _DAT_141c3b144 (compteur d'instances, inc dword)
COUNTER_SLOT = 0x141C3B140  # on fournit 16 octets autour pour vérif des voisins
VTABLE_CEFFECTOBJ = 0x1417B8F50  # lives::CEffectObjComponent::vftable (lea final)


def mirror(buf: bytes, counter: int):
    """Miroir Python de la sémantique du ctor."""
    b = bytearray(buf)  # préserve les octets non écrits
    # movups xmm0(=0) sur [0x00,0x60) + tous les writes r8(=0) <0x60 sont 0
    for i in range(0x60):
        b[i] = 0
    # qword [0x54] = 0x3f800000  (1.0f @0x54, 0 @0x58)
    struct.pack_into("<Q", b, 0x54, 0x3F800000)
    # dword [0x5c] = 1
    struct.pack_into("<I", b, 0x5C, 1)
    # vtable @0x00 (le TAddPropertyCreator est posé puis écrasé par celle-ci)
    struct.pack_into("<Q", b, 0x00, VTABLE_CEFFECTOBJ)
    # qwords 0x60/0x68/0x70 = 0 ; word 0x78 = 0
    struct.pack_into("<Q", b, 0x60, 0)
    struct.pack_into("<Q", b, 0x68, 0)
    struct.pack_into("<Q", b, 0x70, 0)
    struct.pack_into("<H", b, 0x78, 0)
    # boucle 3×12 octets : [0x7c,0xa0) = 0 (les 3 octets lus de pile non-init = 0 en env propre)
    for i in range(0x7C, 0xA0):
        b[i] = 0
    # qword 0xa0 = 0
    struct.pack_into("<Q", b, 0xA0, 0)
    # dword 0xa8 = 0x41200000 (10.0f)
    struct.pack_into("<I", b, 0xA8, 0x41200000)
    # word 0xac = 0
    struct.pack_into("<H", b, 0xAC, 0)
    # qword 0xb0 = 0
    struct.pack_into("<Q", b, 0xB0, 0)
    # qword 0xb8 = 0x41f00000 (30.0f @0xb8, 0 @0xbc)
    struct.pack_into("<Q", b, 0xB8, 0x41F00000)
    # dword 0xc0 = 0
    struct.pack_into("<I", b, 0xC0, 0)
    # dword 0xc4 = 0x10000 ; dword 0xc8 = 0x10000
    struct.pack_into("<I", b, 0xC4, 0x10000)
    struct.pack_into("<I", b, 0xC8, 0x10000)
    # word 0xcc = 0x100
    struct.pack_into("<H", b, 0xCC, 0x100)
    return bytes(b), (counter + 1) & 0xFFFFFFFF


def lcg(seed):
    s = seed & 0xFFFFFFFFFFFFFFFF
    while True:
        s = (s * 6364136223846793005 + 1442695040888963407) & 0xFFFFFFFFFFFFFFFF
        yield (s >> 33) & 0xFF


def main():
    e = Emu()
    rng = lcg(0xC0FFEE123)
    ncases = 600
    for case in range(ncases):
        buf = bytes(next(rng) for _ in range(N))
        counter = 0
        for k in range(4):
            counter |= next(rng) << (8 * k)
        counter &= 0xFFFFFFFF
        # 16 octets autour du compteur : voisins doivent rester inchangés
        slot = bytearray(16)
        for k in range(16):
            slot[k] = next(rng)
        struct.pack_into("<I", slot, COUNTER_VA - COUNTER_SLOT, counter)

        out = e.call(
            VADDR,
            rcx=SCRATCH,
            mem={SCRATCH: buf, COUNTER_SLOT: bytes(slot)},
            read={SCRATCH: N, COUNTER_SLOT: 16},
        )
        if out.get("error"):
            print(f"[case {case}] ERREUR uemu: {out['error']}")
            return 1
        got = bytes(out["mem"][SCRATCH])
        got_slot = bytes(out["mem"][COUNTER_SLOT])
        got_counter = struct.unpack_from("<I", got_slot, COUNTER_VA - COUNTER_SLOT)[0]

        exp, exp_counter = mirror(buf, counter)
        # voisins du compteur inchangés
        exp_slot = bytearray(slot)
        struct.pack_into("<I", exp_slot, COUNTER_VA - COUNTER_SLOT, exp_counter)

        if out["rax"] != SCRATCH:
            print(f"[case {case}] rax {out['rax']:#x} != rcx {SCRATCH:#x}")
            return 1
        if got != exp:
            diffs = [i for i in range(N) if got[i] != exp[i]]
            print(f"[case {case}] MISMATCH struct aux offsets {[hex(d) for d in diffs[:16]]}")
            for d in diffs[:8]:
                print(f"   +0x{d:03x}: uemu={got[d]:#04x} mirror={exp[d]:#04x}")
            return 1
        if got_slot != bytes(exp_slot):
            print(f"[case {case}] MISMATCH compteur/voisins")
            print(f"   uemu={got_slot.hex()} mirror={bytes(exp_slot).hex()}")
            print(f"   counter in {counter:#x} uemu_out {got_counter:#x} exp {exp_counter:#x}")
            return 1

    print(f"BYTE-EXACT — {ncases} cas (struct 0xd0 + compteur + voisins) identiques au bit près.")
    # échantillon golden pour les tests Rust
    buf0 = bytes(N)
    out = e.call(VADDR, rcx=SCRATCH, mem={SCRATCH: buf0, COUNTER_SLOT: bytes(16)},
                 read={SCRATCH: N, COUNTER_SLOT: 16})
    blob = bytes(out["mem"][SCRATCH])
    nz = [(o, struct.unpack_from("<I", blob, o)[0]) for o in range(0, N, 4)
          if struct.unpack_from("<I", blob, o)[0]]
    print("golden (entrée nulle) mots non nuls:")
    for o, w in nz:
        print(f"   +0x{o:03x}: {w:#010x}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
