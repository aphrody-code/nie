# /// script
# requires-python = ">=3.11"
# dependencies = ["pefile"]
# ///
"""Verifie si les vtable_vaddr de la base pointent la ou on croit.

`nie-forge kb` lit 0 methode sur 1 745 classes : soit l'adresse designe le
complete object locator plutot que la premiere methode, soit elle vient d'un
agencement qui n'est pas celui du binaire livre. Ce script tranche.
"""

import sqlite3
import sys
from pathlib import Path

import pefile

DB = Path(sys.argv[1] if len(sys.argv) > 1 else "var/niers.sqlite")
EXE = Path(sys.argv[2] if len(sys.argv) > 2 else "nie.exe")


def main() -> None:
    pe = pefile.PE(str(EXE), fast_load=True)
    base = pe.OPTIONAL_HEADER.ImageBase
    data = pe.get_memory_mapped_image()
    execs = [
        (s.VirtualAddress, s.VirtualAddress + s.Misc_VirtualSize)
        for s in pe.sections
        if s.Characteristics & 0x20000020
    ]

    def est_code(va: int) -> bool:
        rva = va - base
        return any(a <= rva < b for a, b in execs)

    def mot(va: int) -> int | None:
        rva = va - base
        if rva < 0 or rva + 8 > len(data):
            return None
        return int.from_bytes(data[rva : rva + 8], "little")

    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    rows = con.execute(
        "SELECT name, vtable_vaddr FROM rtti_class WHERE vtable_vaddr IS NOT NULL"
    ).fetchall()
    print(f"{len(rows)} classes avec adresse de vtable\n")

    stats = {"pointe_code": 0, "pointe_ailleurs": 0, "hors_image": 0,
             "code_a_+8": 0, "code_a_-8": 0}
    for _, va in rows:
        m = mot(va)
        if m is None:
            stats["hors_image"] += 1
            continue
        if est_code(m):
            stats["pointe_code"] += 1
        else:
            stats["pointe_ailleurs"] += 1
            m8 = mot(va + 8)
            if m8 is not None and est_code(m8):
                stats["code_a_+8"] += 1
            m_8 = mot(va - 8)
            if m_8 is not None and est_code(m_8):
                stats["code_a_-8"] += 1

    for k, v in stats.items():
        print(f"  {k:16s} {v:5d}")

    # Ces adresses tombent-elles seulement dans une section du fichier ?
    dedans = sum(1 for _, va in rows if mot(va) is not None)
    print(f"\n  adresses lisibles dans l'image : {dedans}/{len(rows)}")
    # Et dans quelle section vivent-elles ?
    par_sec: dict[str, int] = {}
    for _, va in rows:
        rva = va - base
        nom = "hors"
        for s in pe.sections:
            if s.VirtualAddress <= rva < s.VirtualAddress + s.Misc_VirtualSize:
                nom = s.Name.rstrip(b"\x00").decode()
                break
        par_sec[nom] = par_sec.get(nom, 0) + 1
    print(f"  sections : {par_sec}")


main()
