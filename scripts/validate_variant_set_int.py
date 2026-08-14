#!/usr/bin/env python3
"""Validateur byte-exact de FUN_1405992a0 (@0x1405992a0, nie_eacpatched.exe).

Sémantique (désassemblée + confirmée ici) :

    undefined8 FUN_1405992a0(undefined2 *param_1, longlong param_2) {
        uVar1 = *(ushort *)(*(longlong *)(param_2 + 8) + 0x18);  // u16 source
        FUN_140595cb0(param_1);   // destructeur de variante (clear de la valeur précédente)
        *(uint *)(param_1 + 4) = (uint)uVar1;  // *(u32*)(param_1+8) = source
        *param_1 = 1;                          // *(u16*)param_1 = 1 (tag « entier court »)
        return 0;
    }

ASM :
    mov rax,[rdx+8]            ; node = *(param_2+8)
    mov rdi,rcx               ; rdi = param_1 (rcx reste = param_1)
    movzx ebx,word[rax+0x18]  ; uVar1 = u16 @ node+0x18 (lu AVANT le call)
    call 0x140595cb0          ; clear(param_1) — rcx = param_1
    mov [rdi+8],ebx           ; *(u32*)(param_1+8) = source (high 2 octets = 0)
    mov word[rdi],1           ; *(u16*)param_1 = 1

Le destructeur FUN_140595cb0 commence par `movzx ecx,word[rcx]; test ecx,ecx; je ret` :
si le tag (u16 @ offset 0) de la variante vaut 0 → no-op pur (pas d'écriture, pas de call
indirect vtable). On valide donc sur le domaine REPRODUCTIBLE « variante vide » (tag=0),
qui est l'usage « poser une valeur fraîche ». Les écritures finales ne touchent que +0..+2
(tag=1) et +8..+12 (valeur) ; +2..+8 et +12..+16 sont préservés.
"""
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from uemu import Emu, SCRATCH

VA = 0x1405992A0

P1 = SCRATCH + 0x1000   # param_1 : variante de sortie (16 octets)
P2 = SCRATCH + 0x2000   # param_2 : contexte (pointeur node @ +8)
NODE = SCRATCH + 0x3000  # node : u16 source @ +0x18


def model(variant_in: bytes, source: int) -> bytes:
    """Miroir Python : variante vide (tag 0) en entrée → écrit valeur puis tag, préserve le reste."""
    out = bytearray(variant_in)
    struct.pack_into("<I", out, 8, source & 0xFFFF)  # *(u32*)(+8) = source (zero-étendu)
    struct.pack_into("<H", out, 0, 1)                # *(u16*)(+0) = 1
    return bytes(out)


def main() -> int:
    e = Emu()
    # LCG déterministe (Numerical Recipes).
    state = 0xC0FFEE_1234567 & 0xFFFFFFFFFFFFFFFF

    def rng():
        nonlocal state
        state = (state * 6364136223846793005 + 1442695040888963407) & 0xFFFFFFFFFFFFFFFF
        return state >> 16

    # Cas limites + aléatoires.
    sources = [0, 1, 2, 0x7F, 0x80, 0xFF, 0x100, 0x7FFF, 0x8000, 0xFFFE, 0xFFFF]
    cases = [(s, b"\x00" * 16) for s in sources]
    # Avec garbage dans les octets préservés (tag forcé à 0 pour rester no-op).
    for _ in range(500):
        s = rng() & 0xFFFF
        g = bytearray(struct.pack("<16B", *[rng() & 0xFF for _ in range(16)]))
        g[0] = 0  # tag u16 = 0 → destructeur no-op (domaine reproductible)
        g[1] = 0
        cases.append((s, bytes(g)))

    ok = 0
    for idx, (source, variant_in) in enumerate(cases):
        mem = {
            P1: variant_in,
            P2: b"\x00" * 8 + struct.pack("<Q", NODE),   # *(param_2+8) = NODE
            NODE: b"\x00" * 0x18 + struct.pack("<H", source) + b"\x00" * 6,
        }
        out = e.call(VA, rcx=P1, rdx=P2, mem=mem, read={P1: 16})
        if out.get("error"):
            print(f"[{idx}] ERREUR uemu: {out['error']} (source={source:#06x})")
            return 1
        got = bytes(out["mem"][P1])
        want = model(variant_in, source)
        if got != want:
            print(f"[{idx}] DIVERGENCE source={source:#06x}")
            print(f"  in  ={variant_in.hex()}")
            print(f"  got ={got.hex()}")
            print(f"  want={want.hex()}")
            return 1
        ok += 1

    print(f"OK byte-exact : {ok}/{len(cases)} cas (FUN_1405992a0)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
