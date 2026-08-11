#!/usr/bin/env python3
"""Oracle byte-exact pour FUN_140506730 (append d'un élément dans un tableau à capacité fixe).

Struct param_1 :
  +0x60 : ptr base tableau (u64)
  +0x6c : capacité (u32)
  +0x70 : nombre d'éléments (u32)
Élément = 0xb8 octets. Si base!=0 et count<cap : init élément[count] avec constantes + 4 params,
puis count++. param_2=rdx (à +0xa8), param_3=r8 (à +0), param_4=r9 (à +0x38), param_5=stack (à +0x70).

Lance depuis scripts/ : uv run scripts/validate_fixed_slot_append.py
"""
import struct
import sys

from uemu import Emu, SCRATCH, STACK

VADDR = 0x140506730
ELEM = 0xB8
STRUCT_VA = SCRATCH
ARRAY_VA = SCRATCH + 0x10000
MAXCAP = 12
ARRAY_SZ = MAXCAP * ELEM
# 5e arg sur la pile : rsp_entry+0x28 = (STACK+0x8_0000-8)+0x28
ARG5_VA = STACK + 0x8_0000 + 0x20


def f32_bits(x):
    return struct.unpack("<I", struct.pack("<f", x))[0]


F1_0 = f32_bits(1.0)  # 0x3f800000
F2_0 = f32_bits(2.0)  # 0x40000000


def mirror(prior: bytes, base_nonzero: bool, cap: int, count: int,
           p2: int, p3: int, p4: int, p5: int):
    """Reproduit l'effet sur (tableau, count). Renvoie (nouvel_array_bytes, nouveau_count)."""
    arr = bytearray(prior)
    new_count = count
    if base_nonzero and count < cap:
        e = count * ELEM

        def w32(off, val):
            arr[off:off + 4] = struct.pack("<I", val & 0xFFFFFFFF)

        def w16(off, val):
            arr[off:off + 2] = struct.pack("<H", val & 0xFFFF)

        def w8(off, val):
            arr[off] = val & 0xFF

        def w64(off, val):
            arr[off:off + 8] = struct.pack("<Q", val & 0xFFFFFFFFFFFFFFFF)

        # boucle 1 : 3 sous-blocs de 0x38, rax = e+8+s
        for i in range(3):
            s = i * 0x38
            r = e + 8 + s
            w32(r - 4, 0)
            w64(r, F1_0)            # qword 0x3f800000
            w64(r + 8, F1_0)        # qword 0x3f800000
            w32(r + 0x10, F2_0)     # dword 0x40000000
            w64(r + 0x20, 0)
            w16(r + 0x28, 0)
            w8(r + 0x2a, 0)
            w32(r + 0x2c, 0)
        # après-boucle
        w32(e + 0xb0, 0)
        w32(e + 0xb4, F1_0)
        w32(e + 0xa8, 0)
        w8(e + 0xac, 1)
        w32(e + 0xa8, p2)          # écrase le 0
        # boucle 2 : params p3,p4,p5 aux offsets 0, 0x38, 0x70
        w32(e + 0x00, p3)
        w32(e + 0x38, p4)
        w32(e + 0x70, p5)
        new_count = count + 1
    return bytes(arr), new_count


def build_struct(base_va, cap, count):
    b = bytearray(0x80)
    b[0x60:0x68] = struct.pack("<Q", base_va)
    b[0x6c:0x70] = struct.pack("<I", cap)
    b[0x70:0x74] = struct.pack("<I", count)
    return bytes(b)


# LCG déterministe (Numerical Recipes)
class Rng:
    def __init__(self, seed):
        self.s = seed & 0xFFFFFFFFFFFFFFFF

    def u32(self):
        self.s = (self.s * 6364136223846793005 + 1442695040888963407) & 0xFFFFFFFFFFFFFFFF
        return (self.s >> 32) & 0xFFFFFFFF

    def below(self, n):
        return self.u32() % n

    def bytes(self, n):
        return bytes(self.u32() & 0xFF for _ in range(n))


def run():
    e = Emu()
    rng = Rng(0xC0FFEE1234)
    N = 600
    fails = 0
    for case in range(N):
        # mode : 0 base=0, 1 count>=cap, sinon append
        mode = rng.below(5)
        cap = 1 + rng.below(MAXCAP)
        if mode == 0:
            base_nonzero = False
            count = rng.below(cap + 1)
        elif mode == 1:
            base_nonzero = True
            count = cap + rng.below(3)  # >= cap
        else:
            base_nonzero = True
            count = rng.below(cap)  # < cap -> append
        p2 = rng.u32()
        p3 = rng.u32()
        p4 = rng.u32()
        p5 = rng.u32()

        prior = rng.bytes(ARRAY_SZ)
        base_va = ARRAY_VA if base_nonzero else 0
        struct_bytes = build_struct(base_va, cap, count)

        mem = {
            STRUCT_VA: struct_bytes,
            ARRAY_VA: prior,             # toujours rempli (la fonction ne lit pas si base=0)
            ARG5_VA: struct.pack("<I", p5),
        }
        out = e.call(
            VADDR,
            rcx=STRUCT_VA,
            rdx=p2,
            r8=p3,
            r9=p4,
            mem=mem,
            read={ARRAY_VA: ARRAY_SZ, STRUCT_VA: 0x80},
        )
        if out["error"]:
            print(f"case {case}: ERREUR uemu = {out['error']}")
            fails += 1
            continue
        got_arr = bytes(out["mem"][ARRAY_VA])
        got_struct = bytes(out["mem"][STRUCT_VA])
        got_count = struct.unpack_from("<I", got_struct, 0x70)[0]

        exp_arr, exp_count = mirror(prior, base_nonzero, cap, count, p2, p3, p4, p5)

        ok = True
        if got_count != exp_count:
            ok = False
            print(f"case {case}: count attendu {exp_count} obtenu {got_count}")
        if got_arr != exp_arr:
            ok = False
            # localiser le 1er octet divergent
            for j in range(ARRAY_SZ):
                if got_arr[j] != exp_arr[j]:
                    print(f"case {case}: array diff @+0x{j:x} (elem {j//ELEM} off 0x{j%ELEM:x}) "
                          f"exp {exp_arr[j]:#04x} got {got_arr[j]:#04x} "
                          f"[mode={mode} cap={cap} count={count}]")
                    break
        if not ok:
            fails += 1
            if fails > 6:
                break
    if fails == 0:
        print(f"BYTE-EXACT — {N}/{N} cas OK (append tableau fixe FUN_140506730)")
        return 0
    print(f"ECHEC — {fails} cas divergents")
    return 1


if __name__ == "__main__":
    sys.exit(run())
