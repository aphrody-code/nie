#!/usr/bin/env python3
"""Read an MSVC RTTI class's vtable out of a PE, on the binary you name.

Why this exists
---------------
`niers rtti` INGESTS classes into the knowledge base; nothing READ a vtable back, so every
attempt went through throwaway inline Python — and each one re-learned the same two traps.

Trap 1 — `rtti_class.vtable_vaddr` is NOT where the methods are. It is the slot holding the
Complete Object Locator pointer, i.e. `vtable - 8`. Reading from it yields an `.rdata` pointer
where a method is expected, which reads like a corrupt table rather than an off-by-one.

Trap 2 — the knowledge base is anchored on a DIFFERENT build than `dist/nie.exe`
(31 468 032 bytes / `4c2b91fb…` versus 33 918 464 / `b1fa04ea…`). Measured 2026-09-13, that
does NOT invalidate class addresses: 1 745 class names are common and all 1 745 carry the same
`vtable_vaddr`. Pass `--exe` explicitly anyway; the tool never guesses which binary you meant.

Usage
-----
    python3 scripts/re/vtable.py --exe dist/nie.exe --class CMenuListView
    python3 scripts/re/vtable.py --exe dist/nie.exe --vtable 0x141A5FFB8 --slots 32
"""

from __future__ import annotations

import argparse
import struct
from dataclasses import dataclass


@dataclass(frozen=True)
class Section:
    name: str
    rva: int
    vsize: int
    raw: int
    rsize: int


@dataclass
class Image:
    data: bytes
    base: int
    sections: list[Section]
    pdata_starts: frozenset[int]

    def offset(self, vaddr: int) -> tuple[int | None, str | None]:
        """File offset for a virtual address, and the section holding it."""
        rva = vaddr - self.base
        for section in self.sections:
            if section.rva <= rva < section.rva + max(section.vsize, section.rsize):
                return section.raw + (rva - section.rva), section.name
        return None, None

    def qword(self, vaddr: int) -> int | None:
        offset, _ = self.offset(vaddr)
        if offset is None:
            return None
        return struct.unpack_from("<Q", self.data, offset)[0]

    def cstring(self, vaddr: int, limit: int = 512) -> str:
        """A NUL-terminated string, bounded.

        The bound is not a nicety: scanning `.rdata` for vtables walks over data that is not a
        string at all, and an unbounded `index` raises instead of saying "not a name here".
        """
        offset, _ = self.offset(vaddr)
        if offset is None:
            return ""
        end = self.data.find(b"\0", offset, offset + limit)
        if end < 0:
            return ""
        return self.data[offset:end].decode("utf-8", "replace")


def load(path: str) -> Image:
    data = open(path, "rb").read()
    pe = struct.unpack_from("<I", data, 0x3C)[0]
    if data[pe : pe + 4] != b"PE\0\0":
        raise SystemExit(f"{path}: pas un PE")
    count = struct.unpack_from("<H", data, pe + 6)[0]
    optional = struct.unpack_from("<H", data, pe + 20)[0]
    base = struct.unpack_from("<Q", data, pe + 24 + 24)[0]
    sections = []
    for index in range(count):
        head = pe + 24 + optional + index * 40
        name = data[head : head + 8].rstrip(b"\0").decode()
        vsize, rva, rsize, raw = struct.unpack_from("<IIII", data, head + 8)
        sections.append(Section(name, rva, vsize, raw, rsize))

    starts: set[int] = set()
    for section in sections:
        if section.name != ".pdata":
            continue
        for index in range(section.rsize // 12):
            start, _end, _unwind = struct.unpack_from("<III", data, section.raw + index * 12)
            if start:
                starts.add(start + base)
    return Image(data, base, sections, frozenset(starts))


def type_descriptor_name(image: Image, vtable_slot: int) -> str | None:
    """The RTTI name a vtable declares, read through its Complete Object Locator."""
    col = image.qword(vtable_slot)
    if col is None:
        return None
    offset, _ = image.offset(col)
    if offset is None:
        return None
    # COL: signature, offset, cdOffset, pTypeDescriptor (RVA), pClassDescriptor, self (RVA).
    if offset + 16 > len(image.data):
        return None
    _sig, _off, _cd, td_rva = struct.unpack_from("<IIII", image.data, offset)
    if td_rva == 0 or image.offset(image.base + td_rva)[0] is None:
        return None
    # TypeDescriptor: vftable ptr (8), spare (8), then the decorated name.
    return image.cstring(image.base + td_rva + 16)


def find_class(image: Image, wanted: str) -> int | None:
    """Locate a class's COL slot by scanning `.rdata` for a vtable declaring that name.

    Scanning beats trusting a database keyed on another build: the answer comes from the file
    the caller named, so a mismatch shows up as "not found" instead of as a wrong address.
    """
    decorated = (f".?AV{wanted}@", )
    for section in image.sections:
        if section.name != ".rdata":
            continue
        start = image.base + section.rva
        for vaddr in range(start, start + section.rsize - 8, 8):
            name = type_descriptor_name(image, vaddr)
            if name and any(name.startswith(prefix) for prefix in decorated):
                # `.?AVFoo@ns@@` must match Foo exactly, not FooBar.
                if name.split("@")[0] == f".?AV{wanted}":
                    return vaddr
    return None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--exe", required=True, help="PE to read; never inferred")
    parser.add_argument("--class", dest="klass", help="undecorated RTTI class name")
    parser.add_argument("--vtable", help="COL slot address, as `niers rtti` stores it (hex)")
    parser.add_argument("--slots", type=int, default=24, help="how many method slots to print")
    args = parser.parse_args()

    image = load(args.exe)
    if args.vtable:
        slot = int(args.vtable, 16)
    elif args.klass:
        slot = find_class(image, args.klass)
        if slot is None:
            raise SystemExit(f"{args.klass}: aucune vtable ne declare ce nom dans {args.exe}")
    else:
        raise SystemExit("donner --class ou --vtable")

    name = type_descriptor_name(image, slot) or "?"
    print(f"{name}")
    print(f"  COL slot   0x{slot:X}   (ce que `rtti_class.vtable_vaddr` stocke)")
    print(f"  methodes a 0x{slot + 8:X}")

    seen: dict[int, int] = {}
    resolved = 0
    for index in range(args.slots):
        pointer = image.qword(slot + 8 + index * 8)
        if pointer is None:
            break
        _, section = image.offset(pointer)
        if section != ".text":
            print(f"  [{index:3}] 0x{pointer:012X}  hors .text — fin probable de la table")
            break
        is_start = pointer in image.pdata_starts
        resolved += is_start
        seen[pointer] = seen.get(pointer, 0) + 1
        mark = ".pdata-start" if is_start else "(pas un debut .pdata)"
        repeat = f"  x{seen[pointer]}" if seen[pointer] > 1 else ""
        print(f"  [{index:3}] 0x{pointer:012X}  {mark}{repeat}")
    print(f"  {resolved} slots tombent sur un debut de fonction du .pdata")
    partages = {p: n for p, n in seen.items() if n > 1}
    if partages:
        joint = ", ".join(f"0x{p:X} x{n}" for p, n in sorted(partages.items(), key=lambda kv: -kv[1]))
        print(f"  slots partages (souche par defaut, pas une methode propre) : {joint}")


if __name__ == "__main__":
    main()
