# /// script
# requires-python = ">=3.11"
# dependencies = ["iced-x86"]
# ///
"""Chiffre ce qu'un decoupage code/donnees rapporterait dans .text.

Une unite refusee par le desassemblage n'est pas perdue en entier : la part
qui precede le point d'echec est du code valide. Ce script mesure cette part,
puis cherche si le decodage reprend apres la zone fautive — auquel cas l'unite
est un sandwich code/donnees/code, et non du code casse.
"""

import json
import sys
from collections import Counter
from pathlib import Path

from iced_x86 import Decoder, DecoderOptions

COVER = Path(sys.argv[1] if len(sys.argv) > 1 else "var/forge/cover.json")
EXE = Path(sys.argv[2] if len(sys.argv) > 2 else "nie.exe")


def decodable(data: bytes, va: int) -> int:
    """Octets decodes avant le premier opcode invalide."""
    dec = Decoder(64, data, ip=va, options=DecoderOptions.NONE)
    pos = 0
    for insn in dec:
        if insn.is_invalid:
            return pos
        pos += insn.len
    return pos


def reprend(data: bytes, va: int, depuis: int) -> int | None:
    """Cherche un offset >= depuis a partir duquel tout le reste se decode.

    Rend l'offset de reprise, ou None. Les jump tables etant alignees sur 4,
    on ne teste que les offsets multiples de 4 — sinon le cout explose.
    """
    for off in range(depuis, len(data), 4):
        if decodable(data[off:], va + off) == len(data) - off:
            return off
    return None


def main() -> None:
    cover = json.loads(COVER.read_text())
    data = EXE.read_bytes()

    total_unites = 0
    total_octets = 0
    code_avant = 0
    code_apres = 0
    donnees = 0
    sandwich = 0
    sans_reprise = 0
    tailles_donnees: Counter[int] = Counter()

    for u in cover["units"]:
        if u["kind"] not in ("function", "code_residue"):
            continue
        b = data[u["file_off"] : u["file_off"] + u["len"]]
        va = u["va"] or 0
        n = decodable(b, va)
        if n == len(b):
            continue
        total_unites += 1
        total_octets += len(b)
        code_avant += n
        r = reprend(b, va, n)
        if r is None:
            sans_reprise += 1
            donnees += len(b) - n
        else:
            sandwich += 1
            donnees += r - n
            code_apres += len(b) - r
            tailles_donnees[min((r - n) // 8 * 8, 64)] += 1

    print(f"unites refusees      : {total_unites}")
    print(f"octets en jeu        : {total_octets}")
    print(f"  code avant l'echec : {code_avant} ({100 * code_avant / total_octets:.1f}%)")
    print(f"  donnees            : {donnees} ({100 * donnees / total_octets:.1f}%)")
    print(f"  code apres reprise : {code_apres} ({100 * code_apres / total_octets:.1f}%)")
    print(f"\n  sandwich code/donnees/code : {sandwich} unites")
    print(f"  sans reprise               : {sans_reprise} unites")
    print(f"\n  code total recuperable : {code_avant + code_apres} octets")
    print("\ntaille de la zone de donnees (bucket de 8, 64 = 64 ou plus) :")
    for k in sorted(tailles_donnees):
        print(f"  {k:3d} : {tailles_donnees[k]:5d}")


main()
