# /// script
# requires-python = ">=3.11"
# ///
"""Classe chaque unite de padding du recouvrement par sa composition d'octets.

But : savoir quelle part des 1 146 297 octets de padding .text est generable
par une regle pure (int3, nop canoniques MSVC) plutot que recopiee.
"""

import json
import sys
from collections import Counter
from pathlib import Path

FORGE = Path(sys.argv[1] if len(sys.argv) > 1 else "var/forge/cover.json")
EXE = Path(sys.argv[2] if len(sys.argv) > 2 else "nie.exe")

# Sequences nop multi-octets recommandees par Intel/AMD, telles que MSVC les emet.
NOPS = {
    1: [b"\x90"],
    2: [b"\x66\x90"],
    3: [b"\x0f\x1f\x00"],
    4: [b"\x0f\x1f\x40\x00"],
    5: [b"\x0f\x1f\x44\x00\x00"],
    6: [b"\x66\x0f\x1f\x44\x00\x00"],
    7: [b"\x0f\x1f\x80\x00\x00\x00\x00"],
    8: [b"\x0f\x1f\x84\x00\x00\x00\x00\x00"],
    9: [b"\x66\x0f\x1f\x84\x00\x00\x00\x00\x00"],
}


def classe(b: bytes) -> str:
    if not b:
        return "vide"
    if all(x == 0xCC for x in b):
        return "int3"
    if all(x == 0x00 for x in b):
        return "zero"
    if all(x == 0x90 for x in b):
        return "nop90"
    # Suite de nops canoniques concatenes (MSVC aligne parfois ainsi).
    reste = b
    while reste:
        for n in range(min(9, len(reste)), 0, -1):
            if reste[:n] in NOPS[n]:
                reste = reste[n:]
                break
        else:
            break
    if not reste:
        return "nop_canonique"
    # Melange int3 en queue apres des nops.
    if set(b) <= {0xCC, 0x90, 0x66, 0x0F, 0x1F, 0x00, 0x40, 0x44, 0x80, 0x84}:
        return "mixte_nop_int3"
    return "autre"


def main() -> None:
    cover = json.loads(FORGE.read_text())
    data = EXE.read_bytes()
    par_classe: Counter[str] = Counter()
    octets: Counter[str] = Counter()
    echantillons: dict[str, list[str]] = {}
    for u in cover["units"]:
        if u["kind"] != "padding":
            continue
        off, ln = u["file_off"], u["len"]
        b = data[off : off + ln]
        c = classe(b)
        par_classe[c] += 1
        octets[c] += ln
        echantillons.setdefault(c, [])
        if len(echantillons[c]) < 3:
            echantillons[c].append(f"{u['id']} off=0x{off:x} len={ln} {b[:24].hex()}")

    total_o = sum(octets.values())
    print(f"padding total : {sum(par_classe.values())} unites, {total_o} octets\n")
    for c, n in par_classe.most_common():
        print(f"  {c:16s} {n:8d} unites {octets[c]:10d} o  ({100 * octets[c] / total_o:6.2f}%)")
    print()
    for c in par_classe:
        if c in ("autre", "mixte_nop_int3"):
            for e in echantillons[c]:
                print(f"  [{c}] {e}")


main()
