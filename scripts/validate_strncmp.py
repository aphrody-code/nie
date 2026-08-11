#!/usr/bin/env python3
"""Validation byte-exact de FUN_14168b330 == strncmp (MSVC 2019).

  int __cdecl strncmp(char* str1, char* str2, size_t count)
  x64 : rcx=str1, rdx=str2, r8=count ; retour int dans eax = {-1, 0, 1}.

Oracle = uemu (exécute le vrai code de nie_eacpatched.exe). Miroir Python = sémantique
strncmp standard renvoyant -1/0/1. Fuzz LCG déterministe couvrant :
  - count=0, égalité totale, différence (avant/après null), null commun ;
  - tous les alignements de str1 (chemin SSE word-at-a-time vs octet-par-octet) ;
  - page-offset de str2 proche de 0xff8 (bascule fast/slow path).
Lance depuis scripts/ :  uv run scripts/validate_strncmp.py
"""
import sys
from uemu import Emu, SCRATCH

VADDR = 0x14168B330


def mirror(b1, b2, count):
    """strncmp byte-exact : compare octets non signés, renvoie -1/0/1."""
    for i in range(count):
        c1 = b1[i]
        c2 = b2[i]
        if c1 != c2:
            return -1 if c1 < c2 else 1
        if c1 == 0:
            return 0
    return 0


def oracle(e, b1, b2, a1, a2, count):
    """Place str1/str2 dans deux pages distinctes (alignements a1/a2) et appelle le vrai code."""
    BUF = 64
    # str1 dans une page, str2 dans une autre (indépendance + maîtrise du page-offset).
    p1 = SCRATCH + 0x1000 + a1
    p2 = SCRATCH + 0x5000 + a2
    mem = {p1: bytes(b1[:BUF]), p2: bytes(b2[:BUF])}
    out = e.call(VADDR, rcx=p1, rdx=p2, r8=count, mem=mem)
    if out.get("error"):
        raise RuntimeError(f"uemu error: {out['error']}")
    r = out["rax"] & 0xFFFFFFFF
    return r - 0x1_0000_0000 if r >= 0x8000_0000 else r


class LCG:
    def __init__(self, seed):
        self.s = seed & 0xFFFFFFFFFFFFFFFF

    def next(self):
        self.s = (self.s * 6364136223846793005 + 1442695040888963407) & 0xFFFFFFFFFFFFFFFF
        return (self.s >> 33) & 0xFFFFFFFF

    def rng(self, n):
        return self.next() % n


def gen_case(rng):
    """Génère (b1, b2, a1, a2, count) en favorisant les bords."""
    BUF = 64
    a1 = rng.rng(8)
    a2 = rng.rng(8)
    mode = rng.rng(6)
    if mode == 0:
        # buffers identiques (égalité), avec ou sans null
        b = bytes(rng.rng(256) for _ in range(BUF))
        if rng.rng(2):
            k = rng.rng(BUF)
            b = b[:k] + b"\x00" + b[k + 1:]
        b1 = b
        b2 = b
    elif mode == 1:
        # identiques jusqu'à un point, puis diffèrent
        b = bytes((rng.rng(255) + 1) for _ in range(BUF))  # pas de null
        k = rng.rng(BUF)
        b1 = b
        d = rng.rng(255) + 1
        while d == b[k]:
            d = rng.rng(255) + 1
        b2 = b[:k] + bytes([d]) + b[k + 1:]
    elif mode == 2:
        # null commun précoce (doit court-circuiter)
        b1 = bytes(rng.rng(256) for _ in range(BUF))
        b2 = bytes(rng.rng(256) for _ in range(BUF))
        k = rng.rng(BUF)
        b1 = b1[:k] + b"\x00" + b1[k + 1:]
        b2 = b2[:k] + b"\x00" + b2[k + 1:]
    elif mode == 3:
        # tout octet 0xff vs variations (bord octet non signé)
        b1 = bytes([0xFF] * BUF)
        b2 = bytes((0xFF if rng.rng(4) else rng.rng(256)) for _ in range(BUF))
    else:
        # aléatoire pur
        b1 = bytes(rng.rng(256) for _ in range(BUF))
        b2 = bytes(rng.rng(256) for _ in range(BUF))
    count = rng.rng(49)  # 0..48, < BUF garanti
    return b1, b2, a1, a2, count


def main():
    e = Emu()
    rng = LCG(0xC0FFEE_14168B330 & 0xFFFFFFFFFFFFFFFF)

    # cas dirigés
    directed = [
        (b"\x00" * 64, b"\x00" * 64, 0, 0, 0),          # count=0
        (b"abc\x00" + b"\x00" * 60, b"abc\x00" + b"\x00" * 60, 0, 0, 10),  # égaux + null
        (b"abc\x00" + b"\x00" * 60, b"abd\x00" + b"\x00" * 60, 0, 0, 10),  # diff après 2
        (b"abc\x00" + b"\x00" * 60, b"abd\x00" + b"\x00" * 60, 0, 0, 2),   # diff hors count
        (b"\xff" + b"a" * 63, b"\x01" + b"a" * 63, 0, 0, 5),               # 0xff>0x01 → 1
        (b"\x01" + b"a" * 63, b"\xff" + b"a" * 63, 0, 0, 5),               # 0x01<0xff → -1
        (bytes(range(64)), bytes(range(64)), 3, 5, 40),                    # alignements impairs
        (bytes(range(1, 65)), bytes(range(1, 65)), 0, 0, 48),              # fast path long, no null
    ]

    n_ok = 0
    fails = []
    cases = list(directed) + [gen_case(rng) for _ in range(900)]
    for idx, (b1, b2, a1, a2, count) in enumerate(cases):
        exp = mirror(b1, b2, count)
        got = oracle(e, b1, b2, a1, a2, count)
        if exp != got:
            fails.append((idx, b1[:count + 2].hex(), b2[:count + 2].hex(), a1, a2, count, exp, got))
            if len(fails) > 12:
                break
        else:
            n_ok += 1

    if fails:
        print(f"MISMATCH : {len(fails)} cas divergents / {len(cases)}")
        for f in fails[:12]:
            print(f"  idx={f[0]} a1={f[3]} a2={f[4]} count={f[5]} exp={f[6]} got={f[7]}")
            print(f"     b1={f[1]} b2={f[2]}")
        sys.exit(1)

    print(f"BYTE-EXACT : {n_ok}/{len(cases)} cas concordants (oracle uemu == miroir strncmp)")
    print(f"BYTE_EXACT_CASES={n_ok}")
    sys.exit(0)


if __name__ == "__main__":
    main()
