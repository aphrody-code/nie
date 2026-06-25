#!/usr/bin/env python3
"""Validation byte-exact de FUN_14168b5f0 (= strlen MSVC) via l'oracle uemu.

FUN_14168b5f0 : longueur d'une chaîne C terminée par NUL (rcx = char*).
Implémentation MSVC : préfixe non aligné octet-par-octet jusqu'à alignement 8, puis
détection SWAR du zéro-octet sur 8 octets ((~x ^ (x + 0x7efefefefefefeff)) & 0x8101010101010100).

Miroir Python = simple recherche du premier 0. On fuzze :
  - longueurs variées (0..~600) couvrant le préfixe non aligné + plusieurs blocs SWAR,
  - offsets d'alignement 0..7 du pointeur,
  - octets non nuls aléatoires (LCG déterministe) y compris valeurs 0xFE/0xFF/0x01
    qui stressent l'arithmétique du SWAR (carries 0x7efefefe…).
On compare rax (uemu) BYTE-EXACT à la longueur de référence.
"""
import sys
sys.path.insert(0, ".")
from uemu import Emu, SCRATCH

VA = 0x14168B5F0


class Lcg:
    """LCG déterministe (Numerical Recipes)."""
    def __init__(self, seed):
        self.s = seed & 0xFFFFFFFFFFFFFFFF

    def next(self):
        self.s = (self.s * 6364136223846793005 + 1442695040888963407) & 0xFFFFFFFFFFFFFFFF
        return (self.s >> 33) & 0xFFFFFFFF

    def rng(self, n):
        return self.next() % n


def mirror_strlen(data, off):
    """Miroir : longueur de la chaîne C démarrant à data[off]."""
    n = 0
    while data[off + n] != 0:
        n += 1
    return n


def main():
    e = Emu()
    rng = Lcg(0xC0FFEE_1234_5678)

    cases = 0
    fails = 0

    # 1) Cas déterministes de bord (longueurs 0..40 × tous les alignements).
    plan = []
    for off in range(8):
        for length in range(0, 41):
            plan.append((off, length, "edge"))

    # 2) Fuzz : longueurs aléatoires jusqu'à ~600 (plusieurs blocs SWAR), tous alignements,
    #    octets stressants (parfois forcés à 0x01/0xFE/0xFF).
    for _ in range(700):
        off = rng.rng(8)
        length = rng.rng(600)
        plan.append((off, length, "fuzz"))

    for off, length, kind in plan:
        # Construit un buffer : 'off' octets de garde quelconques, puis 'length' octets non nuls,
        # puis le NUL, puis du rembourrage non nul (pour s'assurer que seul le NUL termine).
        buf = bytearray()
        # garde avant le pointeur (n'affecte pas le résultat ; octets non nuls aléatoires)
        guard = bytearray()
        for _ in range(off):
            guard.append(1 + rng.rng(255))
        body = bytearray()
        for i in range(length):
            r = rng.rng(8)
            if kind == "fuzz" and r == 0:
                body.append(0xFF)
            elif kind == "fuzz" and r == 1:
                body.append(0xFE)
            elif kind == "fuzz" and r == 2:
                body.append(0x01)
            else:
                body.append(1 + rng.rng(255))
        # corps + NUL + 16 octets de rembourrage non nul (pour combler le bloc SWAR final)
        tail = bytearray(1 + rng.rng(255) for _ in range(16))
        data = bytes(guard) + bytes(body) + b"\x00" + bytes(tail)

        ptr = SCRATCH + 0x100  # marge avant pour rien lire avant le buffer
        full = data
        out = e.call(VA, rcx=ptr + off, mem={ptr: full}, read=None)
        if out.get("error"):
            print(f"ERREUR uemu off={off} len={length} kind={kind}: {out['error']}")
            fails += 1
            continue
        got = out["rax"]
        expect = mirror_strlen(full, off)
        assert expect == length, f"miroir incohérent: {expect} != {length}"
        if got != expect:
            print(f"MISMATCH off={off} len={length} kind={kind}: rax={got} expect={expect}")
            fails += 1
        cases += 1

    print(f"cas testés={cases} fails={fails}")
    if fails == 0:
        print("BYTE-EXACT")
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
