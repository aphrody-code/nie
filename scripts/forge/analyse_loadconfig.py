# /// script
# requires-python = ">=3.11"
# dependencies = ["pefile"]
# ///
"""Detaille le Load Config de nie.exe et la table Control Flow Guard.

La table CFG liste les RVA de toutes les cibles d'appel indirect valides.
Si elle est presente, elle est entierement derivable des bornes de fonctions
que la forge connait deja : un poste structurel, pas de la donnee opaque.
"""

import sys
from pathlib import Path

import pefile

EXE = Path(sys.argv[1] if len(sys.argv) > 1 else "nie.exe")


def main() -> None:
    pe = pefile.PE(str(EXE), fast_load=True)
    pe.parse_data_directories()
    lc = getattr(pe, "DIRECTORY_ENTRY_LOAD_CONFIG", None)
    if lc is None:
        print("pas de load config")
        return
    s = lc.struct
    base = pe.OPTIONAL_HEADER.ImageBase
    champs = [
        "Size", "GuardCFCheckFunctionPointer", "GuardCFDispatchFunctionPointer",
        "GuardCFFunctionTable", "GuardCFFunctionCount", "GuardFlags",
        "GuardAddressTakenIatEntryTable", "GuardAddressTakenIatEntryCount",
        "GuardLongJumpTargetTable", "GuardLongJumpTargetCount",
        "SEHandlerTable", "SEHandlerCount", "DynamicValueRelocTableOffset",
    ]
    for c in champs:
        v = getattr(s, c, None)
        if v:
            print(f"  {c:34s} = 0x{v:x} ({v})")

    tbl = getattr(s, "GuardCFFunctionTable", 0)
    cnt = getattr(s, "GuardCFFunctionCount", 0)
    flags = getattr(s, "GuardFlags", 0)
    if not tbl or not cnt:
        print("\npas de table CFG")
        return
    # Les bits 28-31 de GuardFlags donnent le nombre d'octets de metadonnees
    # apres chaque RVA de 4 octets.
    stride = 4 + ((flags >> 28) & 0xF)
    rva_tbl = tbl - base
    taille = cnt * stride
    print(f"\ntable CFG : rva=0x{rva_tbl:x} entrees={cnt} stride={stride} "
          f"taille={taille} o ({100 * taille / pe.OPTIONAL_HEADER.SizeOfImage:.2f}% de l'image)")

    sec = next(x for x in pe.sections
               if x.VirtualAddress <= rva_tbl < x.VirtualAddress + x.Misc_VirtualSize)
    print(f"  vit dans {sec.Name.rstrip(chr(0).encode()).decode()} "
          f"({taille} o = {100 * taille / sec.Misc_VirtualSize:.2f}% de la section)")

    data = pe.get_memory_mapped_image()
    rvas = []
    for i in range(cnt):
        off = rva_tbl + i * stride
        rvas.append(int.from_bytes(data[off:off + 4], "little"))
    tri = rvas == sorted(rvas)
    print(f"  strictement croissante : {tri}")
    print(f"  premiere=0x{rvas[0]:x} derniere=0x{rvas[-1]:x}")
    if stride > 4:
        meta = {}
        for i in range(cnt):
            off = rva_tbl + i * stride + 4
            meta[data[off]] = meta.get(data[off], 0) + 1
        print(f"  metadonnees : {dict(sorted(meta.items(), key=lambda kv: -kv[1])[:8])}")


main()
