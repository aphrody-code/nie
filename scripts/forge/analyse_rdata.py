# /// script
# requires-python = ">=3.11"
# dependencies = ["pefile"]
# ///
"""Ventile le contenu de .rdata par poste structurel.

.rdata est aujourd'hui une seule unite de 4 399 616 octets, comptee verbatim.
Savoir ce qu'elle contient dit quelle part est re-emissible depuis ses
structures (comme .pdata et .reloc le sont deja) et quelle part demandera un
decoupage plus fin.
"""

import sys
from pathlib import Path

import pefile

EXE = Path(sys.argv[1] if len(sys.argv) > 1 else "nie.exe")

NOMS = [
    "EXPORT", "IMPORT", "RESOURCE", "EXCEPTION", "SECURITY", "BASERELOC",
    "DEBUG", "ARCHITECTURE", "GLOBALPTR", "TLS", "LOAD_CONFIG", "BOUND_IMPORT",
    "IAT", "DELAY_IMPORT", "COM_DESCRIPTOR", "RESERVED",
]


def main() -> None:
    pe = pefile.PE(str(EXE), fast_load=True)
    pe.parse_data_directories()
    base = pe.OPTIONAL_HEADER.ImageBase

    secs = {}
    for s in pe.sections:
        nom = s.Name.rstrip(b"\x00").decode("ascii", "replace")
        secs[nom] = (s.VirtualAddress, s.Misc_VirtualSize, s.PointerToRawData, s.SizeOfRawData)
    rva0, vsize, _, raw = secs[".rdata"]
    rva1 = rva0 + vsize
    print(f".rdata rva=0x{rva0:x}..0x{rva1:x}  vsize={vsize}  raw={raw}\n")

    print("data directories tombant dans .rdata :")
    total_dir = 0
    for i, d in enumerate(pe.OPTIONAL_HEADER.DATA_DIRECTORY):
        if d.Size == 0 or d.VirtualAddress == 0:
            continue
        dedans = rva0 <= d.VirtualAddress < rva1
        marque = "  <-- .rdata" if dedans else ""
        if dedans:
            total_dir += d.Size
        print(f"  {NOMS[i]:16s} rva=0x{d.VirtualAddress:08x} size={d.Size:9d}{marque}")
    print(f"\n  couvert par les directories : {total_dir} o "
          f"({100 * total_dir / vsize:.2f}% de .rdata)\n")

    # Imports : descripteurs + hint/name + thunks
    n_dll = n_fn = 0
    for entry in getattr(pe, "DIRECTORY_ENTRY_IMPORT", []) or []:
        n_dll += 1
        n_fn += len(entry.imports)
    print(f"imports : {n_dll} DLL, {n_fn} fonctions")

    # Descripteurs de type RTTI : chaines '.?AV' / '.?AU' dans .rdata
    data = pe.get_memory_mapped_image()[rva0:rva1]
    n_rtti = data.count(b".?AV") + data.count(b".?AU")
    print(f"descripteurs de type RTTI (.?AV/.?AU) : {n_rtti}")

    # Densite d'octets nuls : les vtables et pointeurs relogeables sont denses,
    # les zones de bourrage non.
    nuls = data.count(0)
    print(f"octets nuls : {nuls} ({100 * nuls / len(data):.2f}%)")

    # Relocations tombant dans .rdata : chaque entree = un pointeur absolu,
    # donc une vtable, un COL ou une table de sauts.
    n_reloc = 0
    for r in getattr(pe, "DIRECTORY_ENTRY_BASERELOC", []) or []:
        for e in r.entries:
            if e.type != 0 and rva0 <= e.rva < rva1:
                n_reloc += 1
    print(f"relocations dans .rdata : {n_reloc} pointeurs absolus "
          f"({8 * n_reloc} octets, {100 * 8 * n_reloc / vsize:.2f}% de .rdata)")


main()
