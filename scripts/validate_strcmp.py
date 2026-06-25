#!/usr/bin/env python3
"""Validation byte-exact de FUN_14168b570 = strcmp (MSVC SIMD-optimisé) via uemu.

Convention x64 : rcx=_Str1, rdx=_Str2. Retour dans rax :
  0                    si chaines egales
  1                    si premier octet different : str1[i] > str2[i] (non signe)
  0xFFFFFFFFFFFFFFFF   si str1[i] < str2[i]  (sbb rax,rax ; or rax,1 sur 64 bits)

Le chemin rapide lit 8 octets a la fois (str1 8-aligne + garde de page) ; le chemin
octet-par-octet gere le reste. Les deux donnent la meme semantique strcmp non signe.
On fuzze : alignements de str1, prefixes partages, chaines egales, garbage divergent
apres le NUL (exerce la divergence de chunk au-dela du terminateur), et la garde de page.
"""
import sys
from uemu import Emu, SCRATCH

VADDR = 0x14168B570

# --- miroir Python de la semantique ---------------------------------------
def mirror_strcmp(s1: bytes, s2: bytes) -> int:
    """s1/s2 = octets de la chaine SANS le NUL terminateur. Retourne rax attendu (u64)."""
    n = min(len(s1), len(s2))
    for i in range(n):
        a, b = s1[i], s2[i]  # octets non signes
        if a != b:
            return 1 if a > b else 0xFFFFFFFFFFFFFFFF
    # prefixe commun jusqu'a min ; le plus court a un NUL (0) ici
    if len(s1) == len(s2):
        return 0
    # la chaine la plus courte a 0 a la position n, l'autre a un octet > 0
    if len(s1) < len(s2):
        # str1[n] = 0 < str2[n]  -> a<b
        return 0xFFFFFFFFFFFFFFFF
    else:
        return 1


# --- PRNG LCG deterministe -------------------------------------------------
class LCG:
    def __init__(self, seed):
        self.s = seed & 0xFFFFFFFFFFFFFFFF

    def next(self):
        self.s = (self.s * 6364136223846793005 + 1442695040888963407) & 0xFFFFFFFFFFFFFFFF
        return (self.s >> 17) & 0xFFFFFFFF

    def rint(self, lo, hi):
        return lo + self.next() % (hi - lo + 1)


def rand_str(rng: LCG, max_len: int) -> bytes:
    n = rng.rint(0, max_len)
    out = bytearray()
    for _ in range(n):
        # octets 1..255 (jamais 0 = pas de NUL embarque) ; biais vers ascii bas
        if rng.rint(0, 3) == 0:
            out.append(rng.rint(1, 255))
        else:
            out.append(rng.rint(0x41, 0x7A))
    return bytes(out)


def build_buf(s: bytes, total: int, rng: LCG, garbage_after_nul: bool) -> bytes:
    """Chaine + NUL + remplissage (zeros, ou garbage aleatoire si demande)."""
    b = bytearray(total)
    b[: len(s)] = s
    # NUL deja a len(s) (zero-init)
    if garbage_after_nul:
        for i in range(len(s) + 1, total):
            b[i] = rng.rint(1, 255)
    return bytes(b)


def run():
    e = Emu()
    rng = LCG(0xC0FFEE1234567890)

    # Deux regions bien separees dans SCRATCH (0x20000000, taille 0x100000).
    BASE1 = SCRATCH + 0x10000
    BASE2 = SCRATCH + 0x40000
    BUFSZ = 64

    fails = 0
    cases = 0

    def one(s1: bytes, s2: bytes, off1: int, off2: int, garbage: bool, eq_pad: bool, tag: str):
        nonlocal fails, cases
        cases += 1
        p1 = BASE1 + off1
        p2 = BASE2 + off2
        # Pour les chaines EGALES dont on veut exercer le retour-0 du chemin rapide,
        # les deux buffers doivent etre identiques (meme padding zero) -> eq_pad.
        g = False if eq_pad else garbage
        buf1 = build_buf(s1, BUFSZ, rng, g)
        buf2 = build_buf(s2, BUFSZ, rng, g)
        out = e.call(VADDR, rcx=p1, rdx=p2, mem={p1: buf1, p2: buf2}, read={})
        if out.get("error"):
            print(f"[ERR] {tag}: emu error {out['error']!r} s1={s1!r} s2={s2!r}")
            fails += 1
            return
        got = out["rax"] & 0xFFFFFFFFFFFFFFFF
        exp = mirror_strcmp(s1, s2)
        if got != exp:
            fails += 1
            if fails <= 20:
                print(f"[FAIL] {tag}: got={got:#018x} exp={exp:#018x} "
                      f"off1={off1} off2={off2} g={g} s1={s1!r} s2={s2!r}")

    # 1) Fuzz general : alignements varies, chaines aleatoires, parfois prefixe commun.
    for _ in range(500):
        off1 = rng.rint(0, 7)          # exerce test cl,7 (alignement str1)
        off2 = rng.rint(0, 7)
        s1 = rand_str(rng, 24)
        kind = rng.rint(0, 3)
        if kind == 0:
            s2 = s1                      # egales
            one(s1, s2, off1, off2, garbage=False, eq_pad=True, tag="eq")
        elif kind == 1:
            # prefixe commun puis divergence
            pre = s1[: rng.rint(0, len(s1))]
            tail = rand_str(rng, 8)
            s2 = pre + tail
            one(s1, s2, off1, off2, garbage=True, eq_pad=False, tag="prefix")
        elif kind == 2:
            s2 = rand_str(rng, 24)       # independante
            one(s1, s2, off1, off2, garbage=True, eq_pad=False, tag="indep")
        else:
            # egales mais avec garbage divergent apres le NUL (robustesse chemin rapide)
            one(s1, s1, off1, off2, garbage=True, eq_pad=False, tag="eq_garbage")

    # 2) Cas-bords explicites.
    edge = [
        (b"", b""),
        (b"", b"a"),
        (b"a", b""),
        (b"a", b"a"),
        (b"a", b"b"),
        (b"b", b"a"),
        (b"abc", b"abc"),
        (b"abc", b"abd"),
        (b"abc", b"abcd"),
        (b"abcd", b"abc"),
        (b"abcdefgh", b"abcdefgh"),         # exactement 8 (un chunk plein, pas de NUL)
        (b"abcdefgh", b"abcdefgi"),
        (b"abcdefghij", b"abcdefghij"),     # > 8 : deux chunks
        (b"abcdefghij", b"abcdefghik"),
        (b"\xff", b"\x01"),                 # octets non signes
        (b"\x01", b"\xff"),
        (b"\x80abc", b"\x7fabc"),
        (b"A" * 23, b"A" * 23),
        (b"A" * 23, b"A" * 22 + b"B"),
    ]
    for a in range(8):
        for s1, s2 in edge:
            one(s1, s2, a, (a + 3) & 7, garbage=True, eq_pad=(s1 == s2),
                tag=f"edge_a{a}")

    # 3) Garde de page : placer str2 a < 8 octets de la fin de page -> chemin octet.
    #    (SCRATCH+0x40000) & 0xfff == 0 ; offset 0xFFA donne page-offset 0xFFA > 0xff8.
    for pg_off in (0xFF9, 0xFFA, 0xFFC, 0xFFE):
        for s1, s2 in [(b"abcdefghij", b"abcdefghij"),
                       (b"abcdefghij", b"abcdefghik"),
                       (b"hello world test", b"hello world test"),
                       (b"hello world test", b"hello world tesu")]:
            cases += 1
            p1 = BASE1
            p2 = SCRATCH + 0x80000 + pg_off  # region distincte, pres d'un bord de page
            eqp = (s1 == s2)
            buf1 = build_buf(s1, BUFSZ, rng, False)
            buf2 = build_buf(s2, BUFSZ, rng, False)
            out = e.call(VADDR, rcx=p1, rdx=p2, mem={p1: buf1, p2: buf2})
            got = out["rax"] & 0xFFFFFFFFFFFFFFFF
            exp = mirror_strcmp(s1, s2)
            if got != exp:
                fails += 1
                print(f"[FAIL] pageguard off={pg_off:#x}: got={got:#018x} exp={exp:#018x} "
                      f"s1={s1!r} s2={s2!r}")

    print(f"cas={cases} echecs={fails}")
    if fails == 0:
        print("BYTE-EXACT")
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(run())
