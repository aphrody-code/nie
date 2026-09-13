#!/usr/bin/env python3
"""Full extent of a function, following CONTIGUOUS `.pdata` chunks.

Why this exists
---------------
MSVC splits one function across several `.pdata` entries whose ranges touch end-to-end, each
with its own unwind info. Reading only the entry that contains your address truncates the body
— measured on `lives::CMenuListView`, `0x140542B80` looks 87 bytes long and its arithmetic lives
in the next 486. A scroll step then reads as a stub, and a method that writes a field reads as
one that does not.

A chunk is taken as a continuation when the previous range ENDS exactly where it begins. That is
the same criterion the unwind chain uses and it is checkable from the file alone, without
trusting a symbol table anchored on another build.

Usage
-----
    python3 scripts/re/extent.py --exe dist/nie.exe 0x140542B80
    python3 scripts/re/extent.py --exe dist/nie.exe 0x140542B80 0x140542840 --json
"""

from __future__ import annotations

import argparse
import json
import struct


def pdata_ranges(data: bytes) -> tuple[int, list[tuple[int, int, int]]]:
    pe = struct.unpack_from("<I", data, 0x3C)[0]
    count = struct.unpack_from("<H", data, pe + 6)[0]
    optional = struct.unpack_from("<H", data, pe + 20)[0]
    base = struct.unpack_from("<Q", data, pe + 24 + 24)[0]
    for index in range(count):
        head = pe + 24 + optional + index * 40
        if data[head : head + 8].rstrip(b"\0") != b".pdata":
            continue
        _vsize, _rva, rsize, raw = struct.unpack_from("<IIII", data, head + 8)
        out = []
        for entry in range(rsize // 12):
            start, end, unwind = struct.unpack_from("<III", data, raw + entry * 12)
            if start:
                out.append((base + start, base + end, unwind))
        out.sort()
        return base, out
    raise SystemExit("pas de section .pdata")


def extent(ranges: list[tuple[int, int, int]], address: int) -> tuple[int, int, list[tuple[int, int]]]:
    """(start, end, chunks) for the function covering `address`, chunks chained by adjacency."""
    index = None
    for position, (start, end, _unwind) in enumerate(ranges):
        if start <= address < end:
            index = position
            break
    if index is None:
        raise SystemExit(f"0x{address:X} n'est dans aucune entree .pdata")

    first = index
    while first > 0 and ranges[first - 1][1] == ranges[first][0]:
        first -= 1
    last = index
    while last + 1 < len(ranges) and ranges[last][1] == ranges[last + 1][0]:
        last += 1
    chunks = [(s, e) for s, e, _ in ranges[first : last + 1]]
    return chunks[0][0], chunks[-1][1], chunks


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--exe", required=True)
    parser.add_argument("addresses", nargs="+", help="hex addresses inside the functions")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    data = open(args.exe, "rb").read()
    _base, ranges = pdata_ranges(data)

    report = []
    for text in args.addresses:
        address = int(text, 16)
        start, end, chunks = extent(ranges, address)
        report.append({"query": address, "start": start, "end": end, "size": end - start, "chunks": chunks})

    if args.json:
        print(json.dumps(report, indent=2))
        return
    for row in report:
        pieces = " + ".join(f"{e - s}" for s, e in row["chunks"])
        note = "" if len(row["chunks"]) == 1 else f"   <- {len(row['chunks'])} fragments : {pieces}"
        print(f"0x{row['query']:X}  ->  0x{row['start']:X}..0x{row['end']:X}  {row['size']} o{note}")


if __name__ == "__main__":
    main()
