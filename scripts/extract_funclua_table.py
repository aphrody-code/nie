#!/usr/bin/env python3
"""Extract the funcLuaMenuCommand dispatch table (cmdId -> handler) from nie.exe.

The game registers every menu command in a contiguous table of 16-byte entries
`{ handler: u64, cmdId: u32, pad: u32 }` in `.rdata`. This script parses the PE,
locates the table via a known cmdId anchor (SetIconSprite = 0x214DA123), walks the
contiguous run, validates against known reversed handlers, and writes the full map
to `data/re/funclua-cmdid-handlers.json`.

Why: that map (cmdId -> handler VA) unblocks reversing any funcLua command — look up
its handler, then disassemble it (r2 on nie.exe, image base 0x140000000). It had been
lost; this regenerates it from the binary. No external deps (pure stdlib).

Usage: python3 scripts/extract_funclua_table.py [path/to/nie.exe]
"""
import json
import struct
import sys
from pathlib import Path

# Anchor: SetIconSprite cmdId -> handler (verified). Used to locate + validate the table.
ANCHOR_CMDID = 0x214DA123
KNOWN = {  # cmdId -> handler VA, from prior r2 reversals — the extraction must match these.
    0x214DA123: 0x140CE74D0,  # SetIconSprite
    0x6A06BC75: 0x140CE6B20,  # SetSelectedIndex
    0x16C1C4C0: 0x140CD8E30,  # RegisterItemListCount
    0x65E825B1: 0x140CBF150,  # apply-global-config -> true
}


def parse_pe(data):
    """Return (image_base, [(va_start, va_end, raw_off)]) from the PE section table."""
    pe_off = struct.unpack_from("<I", data, 0x3C)[0]
    assert data[pe_off:pe_off + 4] == b"PE\0\0", "not a PE"
    num_sections = struct.unpack_from("<H", data, pe_off + 6)[0]
    opt_size = struct.unpack_from("<H", data, pe_off + 20)[0]
    opt_off = pe_off + 24
    # PE32+ optional header: ImageBase is a u64 at offset 24 of the optional header.
    image_base = struct.unpack_from("<Q", data, opt_off + 24)[0]
    sec_off = opt_off + opt_size
    sections = []
    for i in range(num_sections):
        s = sec_off + i * 40
        vsize = struct.unpack_from("<I", data, s + 8)[0]
        vaddr = struct.unpack_from("<I", data, s + 12)[0]
        raw = struct.unpack_from("<I", data, s + 20)[0]
        sections.append((image_base + vaddr, image_base + vaddr + vsize, raw, vaddr))
    return image_base, sections


def va_to_off(va, sections):
    for vstart, vend, raw, vaddr in sections:
        if vstart <= va < vend:
            return raw + (va - vstart)
    return None


def main():
    exe = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("data/nie.exe")
    data = exe.read_bytes()
    image_base, sections = parse_pe(data)
    code_lo, code_hi = image_base, image_base + 0x1000000  # handlers live in the code image

    # Find the anchor cmdId as a 4-byte LE immediate within the table's data section.
    needle = struct.pack("<I", ANCHOR_CMDID)
    anchor_off = None
    pos = 0
    while True:
        i = data.find(needle, pos)
        if i < 0:
            break
        # A table entry has the cmdId 8 bytes after a code-pointer handler.
        if i >= 8:
            h = struct.unpack_from("<Q", data, i - 8)[0]
            if code_lo <= h < code_hi and struct.unpack_from("<I", data, i + 4)[0] == 0:
                anchor_off = i - 8  # start of the 16-byte entry
                break
        pos = i + 1
    assert anchor_off is not None, "anchor cmdId not found as a table entry"

    def valid(off):
        if off < 0 or off + 16 > len(data):
            return False
        h, q2 = struct.unpack_from("<QQ", data, off)
        return code_lo <= h < code_hi and 0 < q2 < 0x100000000

    start = anchor_off
    while valid(start - 16):
        start -= 16
    end = anchor_off
    while valid(end + 16):
        end += 16
    end += 16

    table = {}
    for off in range(start, end, 16):
        h, cid = struct.unpack_from("<QI", data, off)
        table[f"0x{cid:08X}"] = f"0x{h:09X}"

    # Validate against known reversals — extraction is wrong if any mismatch.
    for cid, h in KNOWN.items():
        got = table.get(f"0x{cid:08X}")
        assert got == f"0x{h:09X}", f"mismatch 0x{cid:08X}: {got} != 0x{h:09X}"

    out = Path("data/re/funclua-cmdid-handlers.json")
    out.write_text(json.dumps(table, indent=0))
    print(f"funcLua dispatch table: {len(table)} entries -> {out}")
    print(f"  validated {len(KNOWN)}/{len(KNOWN)} known handlers (exact match)")


if __name__ == "__main__":
    main()
