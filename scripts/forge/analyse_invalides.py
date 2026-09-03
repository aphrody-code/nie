# /// script
# requires-python = ">=3.11"
# dependencies = ["iced-x86"]
# ///
"""Ventile les unites de code que le desassemblage lineaire refuse.

`nie-forge lift` les agrege sous la cause « invalide » — 1 052 unites,
467 473 octets, le plus gros blocage restant. Savoir OU le decodage casse dit
s'il s'agit de donnees inseres dans .text, d'unites tronquees, ou d'un vrai
manque du desassembleur.
"""

import json
import sys
from collections import Counter
from pathlib import Path

from iced_x86 import Decoder, DecoderOptions

COVER = Path(sys.argv[1] if len(sys.argv) > 1 else "var/forge/cover.json")
EXE = Path(sys.argv[2] if len(sys.argv) > 2 else "nie.exe")


def echec(data: bytes, va: int):
    """Rend (offset de l'echec, motif) ou None si tout se decode."""
    dec = Decoder(64, data, ip=va, options=DecoderOptions.NONE)
    pos = 0
    for insn in dec:
        if insn.is_invalid:
            return pos, "opcode"
        pos += insn.len
    if pos != len(data):
        return pos, "tronquee"
    return None


def main() -> None:
    cover = json.loads(COVER.read_text())
    data = EXE.read_bytes()
    motifs: Counter[str] = Counter()
    octets: Counter[str] = Counter()
    par_kind: Counter[str] = Counter()
    queue = Counter()
    exemples: dict[str, list[str]] = {}

    for u in cover["units"]:
        if u["kind"] not in ("function", "code_residue"):
            continue
        b = data[u["file_off"] : u["file_off"] + u["len"]]
        r = echec(b, u["va"] or 0)
        if r is None:
            continue
        pos, motif = r
        cle = f"{u['kind']}/{motif}"
        motifs[cle] += 1
        octets[cle] += u["len"]
        par_kind[u["kind"]] += 1
        # Distance entre l'echec et la fin de l'unite : un echec tout a la fin
        # signale une unite coupee, un echec au milieu signale des donnees.
        reste = u["len"] - pos
        queue[min(reste, 16)] += 1
        exemples.setdefault(cle, [])
        if len(exemples[cle]) < 4:
            exemples[cle].append(
                f"{u['id']} len={u['len']} echec_a={pos} reste={reste}"
            )

    print(f"unites refusees : {sum(motifs.values())}, {sum(octets.values())} octets\n")
    for cle, n in motifs.most_common():
        print(f"  {cle:26s} {n:6d} unites {octets[cle]:9d} o")
    print("\noctets restants apres le point d'echec (16 = 16 ou plus) :")
    for k in sorted(queue):
        print(f"  reste={k:2d} : {queue[k]:6d}")
    print()
    for cle, ex in exemples.items():
        for e in ex:
            print(f"  [{cle}] {e}")


main()
