#!/usr/bin/env python3
"""Validation byte-exact de FUN_140090fa0 — multiplication de matrices 4x4 (row-major).

result = A * B   (A = param_2/rdx, B = param_3/r8, out = param_1/rcx)
result[i] = A[i][0]*B[0] + fma(A[i][1],B[1], ...) + fma(A[i][2],B[2]) + fma(A[i][3],B[3])
où B[k] est la ligne k de B, A[i][k] un scalaire broadcast, ordre d'accu FMA single-rounding.
"""
import struct
import math

from uemu import Emu, SCRATCH

VA = 0x140090FA0
A_ADDR = SCRATCH
B_ADDR = SCRATCH + 0x40
O_ADDR = SCRATCH + 0x80


def f32(x):
    try:
        return struct.unpack("<f", struct.pack("<f", x))[0]
    except OverflowError:
        # double trop grand pour f32 → sature en inf signé (le HW produit aussi
        # un inf ; ces cas sont filtrés ensuite par le test non-fini, pas comptés validés)
        return math.inf if x > 0 else -math.inf


def pack16(m):
    return struct.pack("<16f", *m)


def mirror(A, B):
    """A, B = listes de 16 f32 (row-major). Renvoie 16 f32 = A*B avec accu FMA exacte."""
    out = [0.0] * 16
    for i in range(4):
        a = A[i * 4 : i * 4 + 4]
        b0 = B[0:4]
        b1 = B[4:8]
        b2 = B[8:12]
        b3 = B[12:16]
        for j in range(4):
            acc = f32(a[0] * b0[j])
            acc = f32(math.fma(a[1], b1[j], acc))
            acc = f32(math.fma(a[2], b2[j], acc))
            acc = f32(math.fma(a[3], b3[j], acc))
            out[i * 4 + j] = acc
    return out


class LCG:
    def __init__(self, seed):
        self.s = seed & 0xFFFFFFFFFFFFFFFF

    def next_u32(self):
        self.s = (self.s * 6364136223846793005 + 1442695040888963407) & 0xFFFFFFFFFFFFFFFF
        return (self.s >> 32) & 0xFFFFFFFF

    def f32val(self, kind):
        u = self.next_u32()
        if kind == 0:
            # mantisse 23 bits pleine (rounding stress) + exposant borné [-20,20] +
            # signe aléatoire. Magnitude <= 2^20 → produits <= 2^40, sommes 4 termes
            # << f32 max (2^128) : exerce à fond l'arrondi sans jamais overflow.
            mant = u & 0x7FFFFF
            exp = ((u >> 23) % 41) - 20
            sign = -1.0 if (u >> 31) else 1.0
            v = (1.0 + mant / float(1 << 23)) * (2.0 ** exp)
            return f32(sign * v)
        if kind == 1:  # uniforme [-1000,1000]
            return (u / 0xFFFFFFFF) * 2000.0 - 1000.0
        if kind == 2:  # petits entiers (identités, rotations propres)
            return float((u % 21) - 10)
        if kind == 3:  # petits f32 autour de 1
            return (u / 0xFFFFFFFF) * 4.0 - 2.0
        return 0.0


def matgen(rng, kind):
    return [f32(rng.f32val(kind)) for _ in range(16)]


def main():
    e = Emu()
    rng = LCG(0xC0FFEE12345)
    N = 600
    fails = 0
    nan_skipped = 0

    # cas dédiés : identité, zéros, matrices connues
    fixed = []
    ident = [1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0]
    fixed.append((ident, ident))
    fixed.append((ident, [float(i + 1) for i in range(16)]))
    fixed.append(([float(i + 1) for i in range(16)], ident))
    fixed.append(([0.0] * 16, [float(i) for i in range(16)]))

    cases = list(fixed)
    for n in range(N):
        kind_a = n % 4
        kind_b = (n // 4) % 4
        cases.append((matgen(rng, kind_a), matgen(rng, kind_b)))

    for idx, (A, B) in enumerate(cases):
        # contient un NaN/inf en entrée ? on saute (le bit-pattern d'un NaN n'est
        # pas garanti reproductible entre HW/mirror — règle no-faux-FAIT : ne pas
        # compter ces cas comme validés, mais ne pas non plus mentir sur un échec).
        if any(not math.isfinite(x) for x in A + B):
            nan_skipped += 1
            continue

        out = e.call(
            VA,
            rcx=O_ADDR,
            rdx=A_ADDR,
            r8=B_ADDR,
            mem={A_ADDR: pack16(A), B_ADDR: pack16(B), O_ADDR: bytes(0x40)},
            read={O_ADDR: 0x40},
        )
        if out["error"]:
            print(f"[{idx}] ERREUR uemu: {out['error']}")
            fails += 1
            continue

        hw = out["mem"][O_ADDR]
        expect = pack16(mirror(A, B))

        # si le résultat HW contient un NaN/inf (overflow), le bit-pattern peut
        # diverger → on saute aussi (entrées finies mais produit non fini)
        hw_floats = struct.unpack("<16f", bytes(hw))
        if any(not math.isfinite(x) for x in hw_floats):
            nan_skipped += 1
            continue

        if bytes(hw) != expect:
            fails += 1
            if fails <= 5:
                print(f"[{idx}] MISMATCH")
                print("  A=", A)
                print("  B=", B)
                print("  hw    =", bytes(hw).hex())
                print("  mirror=", expect.hex())
        # else: OK

    total = len(cases)
    validated = total - fails - nan_skipped
    print(f"cas total={total}  validés(byte-exact)={validated}  sautés(NaN/inf)={nan_skipped}  fails={fails}")
    if fails == 0 and validated > 0:
        print("BYTE-EXACT")
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
